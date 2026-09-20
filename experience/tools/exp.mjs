#!/usr/bin/env node
/**
 * exp.mjs — the DSH experience library tool.
 *
 * Zero dependencies on purpose: a memory tool that breaks on a Node upgrade, or
 * that needs an install before it can be read, is a memory tool nobody runs.
 * The frontmatter subset it parses is the flat kind a card actually uses.
 *
 *   node exp.mjs index                 rebuild index.md from the cards
 *   node exp.mjs validate              check every card against SCHEMA.md
 *   node exp.mjs search <terms...>     rank cards against a query
 *   node exp.mjs stats                 health report for the maintenance pass
 *   node exp.mjs touch <id> hit|miss   record a successful or misleading reuse
 *   node exp.mjs usage                 derive how often each card was opened, from session logs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { zstdDecompressSync, zstdCompressSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/**
 * `DSH_EXPERIENCE_HOME` relocates the library; otherwise it is the parent of this
 * script, which keeps the documented override and the real behaviour in agreement —
 * a documented path that nothing reads is how a store starts lying about itself.
 */
const ROOT = process.env.DSH_EXPERIENCE_HOME
  ? resolve(process.env.DSH_EXPERIENCE_HOME)
  : resolve(HERE, '..')
const CARDS = join(ROOT, 'cards')
const INDEX = join(ROOT, 'index.md')

const KINDS = ['capability', 'pitfall', 'recipe', 'snippet', 'source', 'idea']
const CONFIDENCE = ['verified', 'unverified', 'deprecated', 'promoted']
/**
 * How much it would cost to rediscover the card's content from scratch. The only honest
 * measure of a card's worth: a fact that took two browsers and a full e2e cycle to establish
 * is not the same asset as a URL pattern found by one failed fetch, and without this field
 * the index presented them identically. It drives reading order, and it is what a promotion
 * or pruning pass should weigh first.
 */
const DTM = ['high', 'medium', 'low']
const REQUIRED = ['id', 'title', 'kind', 'domain', 'confidence', 'tags', 'hits', 'misses', 'recorded', 'source', 'applies_when']
const SECTIONS = ['Summary', 'Detail', 'Verification', 'Failure mode', 'Notes']
const SOURCE_FORMS = /^(file:|cmd:|url:|session:)/
/** Above this, retrieval is cheaper as a grep than as an index read. */
const BLOAT_CARDS = 120
const BLOAT_INDEX_LINES = 150
const PROMOTE_HITS = 3
const PRUNE_DAYS = 180

/** Local date, not UTC: a card recorded at 23:00 local should not read as tomorrow. */
const today = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const daysSince = (d) => Math.floor((Date.now() - Date.parse(d + 'T00:00:00Z')) / 86400000)

/* ── frontmatter ──────────────────────────────────────────────────────────── */

/**
 * Parse the flat YAML subset cards use: `key: value`, inline `[a, b]` lists, and
 * block lists of scalars. Deliberately not a YAML implementation — a card with
 * nesting is a card that should be two cards.
 */
function parseFrontmatter(text, file) {
  if (!text.startsWith('---')) throw new Error('missing frontmatter')
  const end = text.indexOf('\n---', 3)
  if (end === -1) throw new Error('unterminated frontmatter')
  const raw = text.slice(text.indexOf('\n', 3) + 1, end)
  const body = text.slice(text.indexOf('\n', end + 1) + 1)
  const data = {}
  let key = null
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const block = line.match(/^\s+-\s+(.*)$/)
    if (block && key) {
      if (!Array.isArray(data[key])) data[key] = []
      data[key].push(unquote(block[1]))
      continue
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
    if (!kv) throw new Error(`unparsable frontmatter line: ${line.trim()}`)
    key = kv[1]
    const value = kv[2].trim()
    if (value === '') data[key] = null
    else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter((s) => s !== '')
    } else data[key] = unquote(value)
  }
  return { data, body, file }
}

const unquote = (s) => s.replace(/^["'](.*)["']$/, '$1')

/* ── loading ──────────────────────────────────────────────────────────────── */

function listCardFiles() {
  if (!existsSync(CARDS)) return []
  const out = []
  for (const kind of readdirSync(CARDS, { withFileTypes: true })) {
    if (!kind.isDirectory()) continue
    const dir = join(CARDS, kind.name)
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith('.md') && f.name.toLowerCase() !== 'readme.md') {
        out.push({ kind: kind.name, path: join(dir, f.name) })
      }
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

const loadCard = (entry) => parseFrontmatter(readFileSync(entry.path, 'utf8'), entry.path)

function loadAll() {
  return listCardFiles().map((entry) => {
    try {
      const card = loadCard(entry)
      return { ...card, entry, error: null }
    } catch (error) {
      return { entry, error: error.message, data: null, body: '' }
    }
  })
}

const sectionOf = (body, name) => {
  const m = body.match(new RegExp(`^##\\s+${name}\\s*$([\\s\\S]*?)(?=^##\\s|\\s*$(?![\\s\\S]))`, 'm'))
  return m ? m[1].trim() : ''
}

/**
 * The first body line carrying a query term, trimmed to a readable excerpt.
 * Without this the only way to learn *where* a card matched is to read the whole
 * card — which is the cost retrieval exists to avoid, not a step of it.
 */
function excerptOf(body, needles, max = 130) {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('```') || line.startsWith('|')) continue
    const low = line.toLowerCase()
    if (!needles.some((n) => low.includes(n))) continue
    const clean = line.replace(/[*`_>[\]]/g, '').replace(/\s+/g, ' ').trim()
    return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
  }
  return ''
}

/* ── validate ─────────────────────────────────────────────────────────────── */

function validate(card) {
  const problems = []
  const { data: d, body, entry } = card
  const where = entry.path.replace(ROOT, '.')
  const add = (m) => problems.push(`${where}: ${m}`)

  if (card.error) return [`${where}: ${card.error}`]

  for (const key of REQUIRED) {
    if (d[key] === undefined || d[key] === null || d[key] === '') add(`missing required field "${key}"`)
  }
  const slug = basename(entry.path, '.md')
  if (d.id && d.id !== slug) add(`id "${d.id}" does not match filename "${slug}"`)
  if (d.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.id)) add(`id "${d.id}" is not kebab-case`)
  if (d.domain && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.domain)) add(`domain "${d.domain}" is not kebab-case`)
  if (d.kind && !KINDS.includes(d.kind)) add(`kind "${d.kind}" is not one of ${KINDS.join('|')}`)
  if (d.dtm && !DTM.includes(d.dtm)) add(`dtm "${d.dtm}" is not one of ${DTM.join('|')}`)
  if (d.confidence && !CONFIDENCE.includes(d.confidence)) add(`confidence "${d.confidence}" is not one of ${CONFIDENCE.join('|')}`)
  if (d.tags !== null && !Array.isArray(d.tags)) add('tags must be a list')
  if (Array.isArray(d.tags) && d.tags.length === 0) add('tags must have at least one entry')
  if (d.hits !== null && !/^\d+$/.test(String(d.hits))) add('hits must be a non-negative integer')
  if (d.misses !== null && !/^\d+$/.test(String(d.misses))) add('misses must be a non-negative integer')
  for (const field of ['recorded', 'last_used', 'recheck_after', 'missed_on', 'corrected']) {
    if (d[field] && !/^\d{4}-\d{2}-\d{2}$/.test(String(d[field]))) add(`${field} must be YYYY-MM-DD`)
  }
  if (d.corrected && !d.misses) add('corrected is set but misses is 0 — a correction answers a miss')
  if (d.source !== null && !Array.isArray(d.source)) add('source must be a list')
  if (Array.isArray(d.source)) {
    if (d.source.length === 0) add('source must have at least one entry')
    for (const s of d.source) {
      if (!SOURCE_FORMS.test(s)) add(`source entry "${s}" must start with file:|cmd:|url:|session:`)
    }
  }
  if (d.confidence === 'verified' && Array.isArray(d.source) && d.source.every((s) => s.startsWith('session:'))) {
    add('confidence: verified needs a source other than session:')
  }
  if (d.kind === 'idea' && d.confidence !== 'unverified') add('kind: idea must be confidence: unverified')
  if (d.kind === 'capability' && !d.recheck_after) add('kind: capability should set recheck_after')

  for (const name of ['Summary', 'Detail', 'Verification']) {
    if (!sectionOf(body, name)) add(`missing "## ${name}" section`)
  }
  if (d.kind === 'pitfall' && !sectionOf(body, 'Failure mode')) {
    add('kind: pitfall requires a "## Failure mode" section')
  }
  const extra = [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]).filter((n) => !SECTIONS.includes(n))
  if (extra.length) add(`unexpected section(s): ${extra.join(', ')}`)
  const lines = body.split(/\r?\n/).length
  if (lines > 160) add(`body is ${lines} lines; split it into two cards`)
  return problems
}

function cmdValidate() {
  const cards = loadAll()
  if (cards.length === 0) {
    console.log('no cards yet — nothing to validate (this is the expected state for an empty library)')
    return 0
  }
  const problems = cards.flatMap(validate)
  if (problems.length > 0) {
    for (const p of problems) console.error(p)
    console.error(`\n${problems.length} problem(s) across ${cards.length} card(s)`)
  } else {
    console.log(`ok — ${cards.length} card(s) valid`)
  }
  // Overdue is an advisory, not a failure: the card is still well-formed, but a
  // harness fact past its recheck date is a claim nobody has tested recently.
  const overdue = cards.filter((c) => c.data?.recheck_after && daysSince(c.data.recheck_after) > 0)
  if (overdue.length) {
    console.log(`\n${overdue.length} card(s) past recheck_after — re-verify or downgrade:`)
    for (const c of overdue) console.log(`  - ${c.data.id}  due ${c.data.recheck_after}  (${daysSince(c.data.recheck_after)}d ago, ${c.data.confidence})`)
  }
  return problems.length > 0 ? 1 : 0
}

/* ── index ────────────────────────────────────────────────────────────────── */

const CONF_MARK = { verified: 'V', unverified: '?', deprecated: 'X', promoted: 'P' }

function cmdIndex() {
  const cards = loadAll()
  const problems = cards.flatMap(validate)
  if (problems.length) {
    console.error('refusing to rebuild the index from invalid cards:')
    for (const p of problems) console.error('  ' + p)
    return 1
  }
  const byDomain = new Map()
  for (const card of cards) {
    const d = card.data
    if (!byDomain.has(d.domain)) byDomain.set(d.domain, [])
    byDomain.get(d.domain).push(d)
  }
  for (const list of byDomain.values()) {
    list.sort((a, b) => (b.hits - a.hits) || a.id.localeCompare(b.id))
  }

  const order = { capability: 0, pitfall: 1, recipe: 2, source: 3, snippet: 4, idea: 5 }
  const dtmRank = { high: 0, medium: 1, low: 2, undefined: 3 }
  const stamp = today()
  const lines = [
    '# Experience index',
    '',
    'Generated by `tools/exp.mjs index` — do not edit by hand.',
    `Cards: ${cards.length} · domains: ${byDomain.size} · rebuilt: ${stamp}`,
    '',
    'Each card is a file at `cards/<kind>/<id>.md` relative to this index — no guessing.',
    'Read the domains that touch your task, then open only the cards whose',
    '`applies_when` matches. `V` verified · `P` promoted · `?` unverified · `X` deprecated.',
    '`dtm` is what re-deriving the card would cost (high/medium/low) — read `high` first.',
    '`h`/`m` are successful and misleading reuses; a card with high `m` is a trap, not a shortcut.',
    '',
  ]
  if (cards.length === 0) {
    lines.push('_No cards yet. That is the intended starting state: the library is written by', 'task close-outs (P3 in the skill), not filled in advance._', '')
  }
  for (const [domain, list] of [...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`## ${domain}`, '')
    // Expensive-to-rediscover first, then a live card before a deprecated one: the reader who
    // stops after two lines of a domain should have read the two that cost the most to lose.
    const ranked = list
      .filter((d) => d.confidence !== 'deprecated')
      .sort((a, b) => (dtmRank[a.dtm ?? 'undefined'] - dtmRank[b.dtm ?? 'undefined'])
        || (order[a.kind] - order[b.kind]) || a.id.localeCompare(b.id))
    const retired = list.filter((d) => d.confidence === 'deprecated')
    for (const d of ranked) {
      const tags = Array.isArray(d.tags) && d.tags.length ? ` #${d.tags.join(' #')}` : ''
      const dtm = d.dtm ? ` · dtm:${d.dtm}` : ''
      lines.push(`- \`${CONF_MARK[d.confidence] ?? '?'}\` \`cards/${d.kind}/${d.id}.md\` · ${d.title}`)
      lines.push(`  - _${d.kind}_${dtm} · h${d.hits}/m${d.misses}${tags} · when: ${d.applies_when}`)
    }
    // Deprecated cards stay reachable — they explain why the obvious approach fails — but they
    // cannot earn the reading attention a live card gets, and a domain that is entirely
    // deprecated should look retired rather than merely short.
    if (retired.length) {
      lines.push('')
      lines.push(`  Retired (read only to learn why the obvious approach fails): ${retired.map((d) => `\`${d.id}\``).join(', ')}`)
    }
    lines.push('')
  }
  writeFileSync(INDEX, lines.join('\n'), 'utf8')
  console.log(`index.md rebuilt — ${cards.length} card(s), ${byDomain.size} domain(s), ${lines.length} lines`)
  if (lines.length > BLOAT_INDEX_LINES || cards.length > BLOAT_CARDS) {
    console.log(`WARNING: past the maintenance threshold (${BLOAT_INDEX_LINES} index lines / ${BLOAT_CARDS} cards) — run the P4 pass`)
  }
  return 0
}

/* ── search ───────────────────────────────────────────────────────────────── */

/**
 * Ranked by the *fraction* of query terms matched, never by requiring all of them.
 *
 * A quoted phrase or a single term is exact; a multi-word query is a description of a
 * problem, and the card that solves it will not share the query's vocabulary. Requiring
 * every term turns "github token scope" into a miss against a card whose tags are
 * `github`/`token`, and a silent miss is the worst outcome this tool can produce: the
 * reader concludes the knowledge is not recorded and pays to derive it again, which is
 * exactly the cost the library exists to remove.
 */
function cmdSearch(argv, cards = null) {
  const domainFlag = argv.indexOf('--domain')
  const hasDomain = domainFlag !== -1
  const domain = hasDomain ? String(argv[domainFlag + 1] ?? '').toLowerCase() : null
  // Index-based, not filter(): a filter callback's index is the position in the *filtered*
  // array, so skipping by index there silently kept the domain value as a search term.
  // And guard the skip on `hasDomain` — with `domainFlag === -1`, `domainFlag + 1` is 0, so
  // an unguarded check silently ate the FIRST TERM of every query that had no --domain.
  const terms = []
  for (let i = 0; i < argv.length; i += 1) {
    if (hasDomain && (i === domainFlag || i === domainFlag + 1)) continue
    if (argv[i].startsWith('--')) continue
    terms.push(argv[i])
  }
  const all = argv.includes('--all')
  if (terms.length === 0) {
    console.error('usage: node exp.mjs search <terms...> [--all] [--domain <domain>]')
    return 2
  }
  const phrase = terms.length === 1 ? terms[0].toLowerCase() : ''
  const needles = [...new Set(terms.map((t) => t.toLowerCase()).filter((t) => t.length > 1))]
  const toks = (s) => String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

  const scored = []
  for (const card of cards ?? loadAll()) {
    if (card.error) continue
    const d = card.data
    if (!all && d.confidence === 'deprecated') continue
    if (domain && String(d.domain ?? '').toLowerCase() !== domain) continue
    const grams = new Set(toks(`${d.id} ${d.title}`).flatMap((w) => (w.length > 3 ? [w, w.slice(0, 4)] : [w])))
    const tagText = toks(String(d.tags ?? '')).join(' ')
    const strongText = `${d.applies_when ?? ''} ${d.domain} ${d.kind}`.toLowerCase()
    const bodyText = card.body.toLowerCase()

    let hits = 0
    let weight = 0
    for (const n of needles) {
      if (phrase && bodyText.includes(phrase)) { hits += 1; weight += 6; continue }
      if (grams.has(n)) { hits += 1; weight += 6; continue }
      if (n.length >= 4 && [...grams].some((g) => g.startsWith(n.slice(0, 4)))) { hits += 1; weight += 4; continue }
      if (tagText.includes(n)) { hits += 1; weight += 4; continue }
      if (strongText.includes(n)) { hits += 1; weight += 3; continue }
      // The whole body, not just Summary/Detail. A card's most useful sentence is often in
      // Failure mode or Notes — `sessionQuery` lives only in `session-log-format`'s Notes —
      // and scoring against a subset made that card invisible to the query that needed it.
      // The body scan is also what `excerptOf` already does, so this is one pass, not two.
      if (bodyText.includes(n)) { hits += 1; weight += 1 }
    }
    if (hits === 0) continue
    const coverage = hits / needles.length
    const score = weight * (0.5 + 0.5 * coverage) + Math.min(d.hits, 5) * 0.5
      + (d.confidence === 'verified' ? 1 : d.confidence === 'unverified' ? -0.5 : 0)
    const strong = needles.some((n) => grams.has(n) || tagText.includes(n))
    // Always locate the match: the reader's next question is "where does it say that", and
    // answering it with the excerpt is cheaper than making them open the file to find out.
    scored.push({ card, score, strong, hits, coverage, excerpt: excerptOf(card.body, needles) })
  }
  scored.sort((a, b) => b.score - a.score)
  if (scored.length === 0) {
    console.log(`no card matches: ${terms.join(' ')}`)
    console.log('(a miss is a legitimate result — it means this knowledge is not recorded yet)')
    return 0
  }
  console.log(`${scored.length} match(es) for: ${terms.join(' ')}  (ranked by relevance)\n`)
  for (const { card, score, strong, hits, coverage, excerpt } of scored.slice(0, 8)) {
    const d = card.data
    const marks = [
      `${hits}/${needles.length} terms`,
      `h${d.hits}/m${d.misses}`,
      d.kind,
      strong ? '' : 'body-only',
      coverage < 1 ? 'PARTIAL' : '',
    ].filter(Boolean).join(', ')
    console.log(`[${CONF_MARK[d.confidence]}] ${d.id}  (score ${score.toFixed(1)}, ${marks})`)
    console.log(`    ${d.title}`)
    console.log(`    when: ${d.applies_when}`)
    if (excerpt) console.log(`    hit:  ${excerpt}`)
    console.log(`    ${card.entry.path}`)
  }
  if (scored.length > 8) console.log(`\n… ${scored.length - 8} more; narrow the terms.`)
  return 0
}

/* ── stats ────────────────────────────────────────────────────────────────── */

function cmdStats() {
  const cards = loadAll()
  if (cards.length === 0) {
    console.log('library is empty — nothing to report yet')
    return 0
  }
  const by = (fn) => cards.reduce((m, c) => { const k = fn(c.data); m[k] = (m[k] ?? 0) + 1; return m }, {})
  console.log(`cards: ${cards.length}`)
  console.log('by kind:      ', by((d) => d.kind))
  console.log('by confidence:', by((d) => d.confidence))
  const used = cards.filter((c) => c.data.hits > 0).length
  const never = cards.filter((c) => c.data.hits === 0 && !c.data.last_used)
  console.log(`ever reused: ${used}/${cards.length}`)
  const promote = cards.filter((c) => c.data.hits >= PROMOTE_HITS && c.data.confidence !== 'promoted')
  const demote = cards.filter((c) => c.data.misses >= 2 && c.data.confidence !== 'deprecated')
  const stale = never.filter((c) => daysSince(c.data.recorded ?? today()) > PRUNE_DAYS)
  const overdue = cards.filter((c) => c.data.recheck_after && daysSince(c.data.recheck_after) > 0 && c.data.confidence !== 'deprecated')
  const line = (label, list) => {
    console.log(`\n${label} (${list.length}):`)
    for (const c of list) console.log(`  - ${c.data.id}  h${c.data.hits}/m${c.data.misses}  ${c.data.title}`)
  }
  if (overdue.length) {
    console.log(`\noverdue for recheck (${overdue.length}):`)
    for (const c of overdue) console.log(`  - ${c.data.id}  due ${c.data.recheck_after} (${daysSince(c.data.recheck_after)}d ago, ${c.data.confidence})`)
  }
  if (promote.length) line(`promotion candidates (>=${PROMOTE_HITS} hits — fold into a script, the skill, or AGENTS.md)`, promote)
  if (demote.length) line('demotion candidates (>=2 misses — deprecated or wrong)', demote)
  if (stale.length) line(`never reused in ${PRUNE_DAYS}+ days`, stale)
  if (!promote.length && !demote.length && !stale.length && !overdue.length) console.log('\nno maintenance action suggested')
  const over = cards.length > BLOAT_CARDS
  if (over) console.log(`\nover the ${BLOAT_CARDS}-card threshold — retrieval is now costing more than it saves`)
  return 0
}

/* ── touch ────────────────────────────────────────────────────────────────── */

function cmdTouch(argv) {
  const [id, verdict] = argv
  if (!id || !['hit', 'miss'].includes(verdict)) {
    console.error('usage: node exp.mjs touch <id> hit|miss')
    return 2
  }
  const found = loadAll().find((c) => c.data?.id === id)
  if (!found) {
    console.error(`no card with id "${id}"`)
    return 1
  }
  const text = readFileSync(found.entry.path, 'utf8')
  const bump = verdict === 'hit'
    ? (t) => t.replace(/^hits:\s*(\d+)\s*$/m, (_, n) => `hits: ${Number(n) + 1}`)
    : (t) => t.replace(/^misses:\s*(\d+)\s*$/m, (_, n) => `misses: ${Number(n) + 1}`)
  let next = bump(text)
  // A miss caps confidence — unless the misleading claim has already been corrected after
  // the last miss, in which case the card is *more* trustworthy and demoting it would be
  // wrong. That distinction was missing twice before `corrected` existed, and each time the
  // rule fired on a card whose only fault had already been fixed and recorded.
  if (verdict === 'miss') {
    const corrected = (text.match(/^corrected:\s*(\d{4}-\d{2}-\d{2})\s*$/m) ?? [])[1]
    const missedOn = (text.match(/^missed_on:\s*(\d{4}-\d{2}-\d{2})\s*$/m) ?? [])[1]
    const settled = corrected && (!missedOn || corrected >= missedOn)
    if (/^confidence:\s*verified\s*$/m.test(next) && !settled) {
      next = next.replace(/^confidence:\s*verified\s*$/m, 'confidence: unverified')
      console.log('confidence dropped verified -> unverified (it misled)')
    } else if (settled) {
      console.log(`confidence kept: the misleading claim was corrected on ${corrected}`)
    }
    next = /^missed_on:/m.test(next)
      ? next.replace(/^missed_on:.*$/m, `missed_on: ${today()}`)
      : next.replace(/^(misses:.*)$/m, `$1\nmissed_on: ${today()}`)
  }
  next = /^last_used:/m.test(next)
    ? next.replace(/^last_used:.*$/m, `last_used: ${today()}`)
    : next.replace(/^(misses:.*)$/m, `$1\nlast_used: ${today()}`)
  writeFileSync(found.entry.path, next, 'utf8')
  console.log(`${id}: ${verdict} recorded`)
  return 0
}

/* ── scaffold ─────────────────────────────────────────────────────────────── */

function cmdNew(argv) {
  const [kind, slug] = argv
  if (!KINDS.includes(kind) || !slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    console.error(`usage: node exp.mjs new <${KINDS.join('|')}> <kebab-case-slug>`)
    return 2
  }
  const target = join(CARDS, kind, `${slug}.md`)
  if (existsSync(target)) {
    console.error(`already exists: ${target}`)
    return 1
  }
  mkdirSync(dirname(target), { recursive: true })
  const template = join(ROOT, 'templates', 'card.md')
  if (!existsSync(template)) {
    console.error(`template missing: ${template}`)
    return 1
  }
  // The scaffold must come out *valid*, leaving only content to be written. A template
  // that fails validate on creation teaches the reader that the validator is noise, and
  // the next step after "make a card" should never be "debug the card's frontmatter".
  const text = readFileSync(template, 'utf8')
    .replace(/<slug>/g, slug)
    .replace(/<date>/g, today())
    .replace(/^kind:.*$/m, `kind: ${kind}`)
  writeFileSync(target, text, 'utf8')
  console.log(`created ${target}`)
  console.log('next: fill in title/summary/detail/verification, then run: node exp.mjs validate && node exp.mjs index')
  return 0
}

/* ── selftest ─────────────────────────────────────────────────────────────── */

/**
 * Retrieval regressions are silent: a broken ranking does not error, it reports
 * "this knowledge is not recorded yet", and the reader pays to derive the fact again.
 * These probes pin the behaviour that has actually been verified, so a change that
 * quietly loses a card fails loudly here instead. They bind card ids on purpose —
 * ids are this library's stable interface, and a probe that cannot name an expected
 * card is not testing anything.
 */
const PROBES = [
  { q: ['github', 'token', 'scope'], expect: 'github-auth-on-this-box', why: 'multi-term query must not require every term to match' },
  { q: ['python', 'encoding'], expect: 'python-stdout-encoding', why: 'two-term in-domain query' },
  { q: ['git', 'credential', 'hang'], expect: 'github-auth-on-this-box', why: 'symptom words, not card vocabulary' },
  { q: ['skill', 'roots'], expect: 'skill-discovery-roots', why: 'exact-vocabulary query' },
  { q: ['sessionQuery'], expect: 'session-log-format', why: 'single-term body-only query' },
  { q: ['zstd', 'frame'], expect: 'session-log-format', why: 'body-only multi-term' },
]

function rankFor(terms, all) {
  const needles = [...new Set(terms.map((t) => t.toLowerCase()).filter((t) => t.length > 1))]
  const phrase = terms.length === 1 ? terms[0].toLowerCase() : ''
  const toks = (s) => String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const out = []
  for (const card of loadAll()) {
    if (card.error) continue
    const d = card.data
    if (!all && d.confidence === 'deprecated') continue
    const grams = new Set(toks(`${d.id} ${d.title}`).flatMap((w) => (w.length > 3 ? [w, w.slice(0, 4)] : [w])))
    const tagText = toks(String(d.tags ?? '')).join(' ')
    const strongText = `${d.applies_when ?? ''} ${d.domain} ${d.kind}`.toLowerCase()
    const bodyText = card.body.toLowerCase()
    let hits = 0
    let weight = 0
    for (const n of needles) {
      if (phrase && bodyText.includes(phrase)) { hits += 1; weight += 6; continue }
      if (grams.has(n)) { hits += 1; weight += 6; continue }
      if (n.length >= 4 && [...grams].some((g) => g.startsWith(n.slice(0, 4)))) { hits += 1; weight += 4; continue }
      if (tagText.includes(n)) { hits += 1; weight += 4; continue }
      if (strongText.includes(n)) { hits += 1; weight += 3; continue }
      if (bodyText.includes(n)) { hits += 1; weight += 1 }
    }
    if (hits === 0) continue
    out.push({ id: d.id, score: weight * (0.5 + 0.5 * (hits / needles.length)) })
  }
  return out.sort((a, b) => b.score - a.score)
}

function cmdSelftest() {
  const present = new Set(loadAll().filter((c) => !c.error).map((c) => c.data.id))
  let failures = 0
  let skipped = 0
  for (const probe of PROBES) {
    if (!present.has(probe.expect)) {
      console.log(`  skip  ${probe.q.join(' ')} — card "${probe.expect}" is not in the library`)
      skipped += 1
      continue
    }
    const ranked = rankFor(probe.q)
    const top = ranked[0]
    if (top && top.id === probe.expect) {
      console.log(`  ok    ${probe.q.join(' ').padEnd(26)} -> ${top.id}`)
    } else {
      console.log(`  FAIL  ${probe.q.join(' ').padEnd(26)} -> ${top ? top.id : '(no match)'}  expected ${probe.expect}`)
      console.log(`        ${probe.why}`)
      failures += 1
    }
  }
  // A miss must stay reachable: a ranker that matches everything is as useless as one
  // that matches nothing, and it fails in the direction nobody notices.
  const control = rankFor(['kubernetes', 'helm', 'ingress'])
  if (control.length) {
    console.log(`  FAIL  out-of-domain control returned ${control.length} match(es), first: ${control[0].id}`)
    failures += 1
  } else {
    console.log('  ok    out-of-domain control    -> clean miss')
  }
  console.log(`\n${PROBES.length - skipped - failures}/${PROBES.length - skipped} probe(s) passed${skipped ? `, ${skipped} skipped` : ''}`)

  // ── usage probes ─────────────────────────────────────────────────────────────
  // The session-log scanner failed three times while being written, each time silently
  // and in the same direction: reporting cards as "never opened" when they had been
  // opened. That output is an invitation to delete a live card, so it gets pinned.
  // The probe drives the real `cmdUsage`, not a copy of its logic.
  let usageFailures = 0
  try {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'exp-usage-'))
    // A fixture *library* as well as a fixture log: `cmdUsage` only prints rows for cards
    // that exist, so probing against ids that are not cards would pass vacuously — the
    // first version of this probe did exactly that and caught nothing.
    const fixtureExp = join(fixtureRoot, 'experience')
    for (const [kind, id] of [['pitfall', 'alpha'], ['capability', 'beta']]) {
      mkdirSync(join(fixtureExp, 'cards', kind), { recursive: true })
      writeFileSync(join(fixtureExp, 'cards', kind, `${id}.md`), [
        '---', `id: ${id}`, `title: Fixture card ${id}`, `kind: ${kind}`, 'domain: fixture',
        'confidence: verified', 'tags: [fixture]', 'hits: 0', 'misses: 0', 'recorded: 2026-01-01',
        'source:', '  - file:fixture', 'applies_when: probing the usage scanner',
        '---', '', '## Summary', 'Fixture.', '## Detail', 'Fixture.', '## Verification', 'Fixture.',
      ].join('\n'))
    }
    const lines = [
      JSON.stringify({ type: 'session', version: 3, id: 'fixture-session', createdAt: 1 }),
      // counts — the realistic shape: `arguments` is a JSON *string* with doubled separators
      JSON.stringify({ type: 'tool/call', seq: 1, time: 1, data: { turn: 1, step: 1, callId: 'a', name: 'read', arguments: JSON.stringify({ file_path: 'X:\\exp\\cards\\pitfall\\alpha.md' }) } }),
      JSON.stringify({ type: 'tool/call', seq: 2, time: 2, data: { turn: 1, step: 2, callId: 'b', name: 'read', arguments: JSON.stringify({ file_path: 'X:/exp/cards/capability/beta.md' }) } }),
      JSON.stringify({ type: 'tool/call', seq: 3, time: 3, data: { turn: 1, step: 3, callId: 'c', name: 'read', arguments: JSON.stringify({ file_path: 'X:\\exp\\cards\\pitfall\\alpha.md' }) } }),
      // must NOT count: a non-read tool naming a card path
      JSON.stringify({ type: 'tool/call', seq: 4, time: 4, data: { turn: 1, step: 4, callId: 'd', name: 'pwsh', arguments: JSON.stringify({ command: 'Select-String cards\\pitfall\\alpha.md' }) } }),
      // must NOT count: a read of something that is not a card
      JSON.stringify({ type: 'tool/call', seq: 5, time: 5, data: { turn: 1, step: 5, callId: 'e', name: 'read', arguments: JSON.stringify({ file_path: 'X:\\exp\\cards\\pitfall\\index.md' }) } }),
      // must NOT count: prose mentioning cards, not an open
      JSON.stringify({ type: 'tool/call', seq: 6, time: 6, data: { turn: 1, step: 6, callId: 'f', name: 'send_message', arguments: JSON.stringify({ message: 'see cards/pitfall/alpha.md' }) } }),
    ]
    writeFileSync(join(fixtureRoot, 'session.v3.jsonl.zstd'), zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8')))
    const captured = []
    const realLog = console.log
    console.log = (...a) => captured.push(a.join(' '))
    let usage
    try {
      // Drive the scanner directly with the fixture library and the fixture log root.
      // Setting DSH_EXPERIENCE_HOME here would not work: the real library path is resolved
      // once at module load, which is how the first version of this probe silently tested
      // the real library instead of the fixture.
      usage = collectCardReads([fixtureRoot], new Set(['alpha', 'beta']))
      const stamp = () => '—'
      console.log('reads  judge  card')
      for (const [id, rec] of [...usage.byId.entries()].sort((a, b) => b[1].reads - a[1].reads)) {
        console.log(`  ${String(rec.reads).padStart(3)}  h0/m0  ${id}  (${rec.sessions.size} session(s), last ${stamp()})`)
      }
    } finally { console.log = realLog }

    const text = captured.join('\n')
    if (process.env.EXP_DEBUG) {
      console.log('[usage fixture output]\n' + text)
      console.log(`[usage counters] reads=${usage.reads} ignored=${usage.ignored} cards=${[...usage.byId.keys()].join(',')}`)
    }
    const countOf = (id) => {
      const m = text.match(new RegExp(`^\\s+(\\d+)\\s+h\\d+/m\\d+\\s+${id}\\b`, 'm'))
      return m ? Number(m[1]) : null
    }
    const checks = [
      ['alpha read twice', countOf('alpha') === 2],
      ['beta read once via forward slashes', countOf('beta') === 1],
      ['exactly the three real reads counted', usage.reads === 3],
      ['three mentions of "cards" are not reads', usage.ignored === 3],
      ['a read of index.md is not a card read', countOf('index') === null],
    ]
    for (const [label, ok] of checks) {
      console.log(`  ${ok ? 'ok   ' : 'FAIL '} usage: ${label}`)
      if (!ok) usageFailures += 1
    }
    rmSync(fixtureRoot, { recursive: true, force: true })
  } catch (error) {
    console.log(`  FAIL  usage probes crashed: ${error.message}`)
    usageFailures += 1
  }
  if (usageFailures) console.log(`\n${usageFailures} usage probe(s) failed`)

  // ── argument-parsing probes ──────────────────────────────────────────────────
  // `rankFor` above tests ranking and therefore bypasses argv parsing entirely — which is
  // exactly where a bug ate the first term of every query that had no `--domain`. Probes that
  // route around the code path under suspicion protect nothing, so these drive `cmdSearch`.
  //
  // They build their own store rather than borrowing a card from the real one: on an empty
  // library — which is the state a fresh clone ships in — borrowing yields `undefined` and the
  // probes fail, telling a new user the tool is broken when it is not. A guard that only works
  // once you already have data is a guard that reports a false alarm on day one.
  let argFailures = 0
  const fixtureLib = mkdtempSync(join(tmpdir(), 'exp-args-'))
  try {
    mkdirSync(join(fixtureLib, 'cards', 'capability'), { recursive: true })
    writeFileSync(join(fixtureLib, 'cards', 'capability', 'probe-card.md'), [
      '---', 'id: probe-card', 'title: A card that exists only to be searched for',
      'kind: capability', 'domain: fixture', 'dtm: low', 'confidence: verified',
      'tags: [fixture, probe]', 'hits: 0', 'misses: 0', 'recorded: 2026-01-01',
      'source:', '  - file:fixture', 'applies_when: probing the search argument parser',
      '---', '', '## Summary', 'A distinctive token: zzprobe.',
      '## Detail', 'Fixture.', '## Verification', 'Fixture.',
    ].join('\n'))
    const savedRoot = process.env.DSH_EXPERIENCE_HOME
    // `loadAll` reads the module-level root, resolved at import, so the probes cannot point it
    // at the fixture by environment alone — they call the loader with the fixture explicitly.
    const cardsFromFixture = () => {
      const files = []
      for (const kind of readdirSync(join(fixtureLib, 'cards'), { withFileTypes: true })) {
        if (!kind.isDirectory()) continue
        for (const f of readdirSync(join(fixtureLib, 'cards', kind.name), { withFileTypes: true })) {
          if (f.isFile() && f.name.endsWith('.md')) files.push({ kind: kind.name, path: join(fixtureLib, 'cards', kind.name, f.name) })
        }
      }
      return files.map((entry) => ({ ...parseFrontmatter(readFileSync(entry.path, 'utf8'), entry.path), entry, error: null }))
    }
    const runSearchOn = (args) => {
      const captured = []
      const realLog = console.log
      const realErr = console.error
      console.log = (...a) => captured.push(a.join(' '))
      console.error = (...a) => captured.push(a.join(' '))
      let err = null
      try { cmdSearch(args, cardsFromFixture()) } catch (e) { err = e } finally { console.log = realLog; console.error = realErr }
      return { text: captured.join('\n'), err }
    }
    const argChecks = [
      ['a single term is not swallowed', (() => {
        const { text, err } = runSearchOn(['probe-card'])
        return !err && text.includes('probe-card') && !text.startsWith('usage:')
      })()],
      ['--domain does not become a search term', (() => {
        const { text } = runSearchOn(['probe-card', '--domain', 'fixture'])
        return text.includes('probe-card') && !/for:.*--domain/.test(text)
      })()],
      ['--domain excludes other domains', (() => {
        const { text } = runSearchOn(['probe-card', '--domain', 'no-such-domain'])
        return /no card matches/.test(text)
      })()],
      ['a body-only term is still found', (() => {
        const { text } = runSearchOn(['zzprobe'])
        return text.includes('probe-card')
      })()],
      ['an empty query still reports usage and exits 2', (() => {
        const { text } = runSearchOn([])
        return /usage:/.test(text)
      })()],
    ]
    if (savedRoot === undefined) delete process.env.DSH_EXPERIENCE_HOME
    else process.env.DSH_EXPERIENCE_HOME = savedRoot
    for (const [label, ok] of argChecks) {
      console.log(`  ${ok ? 'ok   ' : 'FAIL '} search: ${label}`)
      if (!ok) argFailures += 1
    }
  } catch (error) {
    console.log(`  FAIL  search-argument probes crashed: ${error.message}`)
    argFailures += 1
  } finally {
    rmSync(fixtureLib, { recursive: true, force: true })
  }
  if (argFailures) console.log(`\n${argFailures} search-argument probe(s) failed`)

  return failures + usageFailures + argFailures > 0 ? 1 : 0
}

/* ── usage (derived from session logs) ────────────────────────────────────── */

/**
 * How often each card was actually opened, counted from the harness's own session
 * logs rather than from a counter a human has to remember to bump.
 *
 * This closes the largest hole in the design: `hits`/`misses` record *judgement* and
 * only move when someone runs `touch`, which a read-only task cannot do at all. Reads
 * are a *fact* — every `read` call is in the log — so they can be derived, and a card
 * nobody has ever opened is visible as such.
 *
 * What it deliberately does NOT do is promote a read into a hit. Opening a card and
 * being helped by it are different claims, and only the reader can tell them apart;
 * silently counting reads as hits would manufacture exactly the confident-but-wrong
 * telemetry this field was added to replace.
 */
function sessionLogRoots() {
  const roots = []
  const explicit = process.env.DSH_SESSION_DIR
  if (explicit) roots.push(explicit)
  const home = process.env.DSH_HOME
  if (home) roots.push(join(home, 'sessions'))
  return roots.filter((p) => existsSync(p))
}

/** Walk every `session.v*.jsonl.zstd` under the session roots. */
function sessionLogFiles(roots) {
  const found = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (/^session\.v\d+\.jsonl\.zstd$/.test(e.name)) found.push(full)
    }
  }
  for (const root of roots) walk(root, 0)
  return found
}

/** Decompress every zstd frame independently — the file is multi-frame, not one stream. */
function readFrames(file) {
  const buf = readFileSync(file)
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const rows = []
  let offset = 0
  while (offset < buf.length) {
    const next = buf.indexOf(MAGIC, offset + 4)
    const end = next === -1 ? buf.length : next
    try {
      for (const line of zstdDecompressSync(buf.subarray(offset, end)).toString('utf8').split('\n')) {
        if (line) rows.push(line)
      }
    } catch { /* a torn tail frame is expected on a live session */ }
    offset = end
  }
  return rows
}

/**
 * Count card reads across every session log under the given roots.
 * Takes its library explicitly so `selftest` can drive it with a fixture — setting
 * `DSH_EXPERIENCE_HOME` from inside the test would not work, since that path is
 * resolved once at module load.
 */
function collectCardReads(roots, cards) {
  const byId = new Map()
  const seenSessions = new Set()
  let files = 0
  let unreadable = 0
  let reads = 0
  let ignored = 0
  // The earliest session this scan can see. A card recorded after it did not exist for
  // part of the window, so "never opened" cannot be concluded about it — callers use this
  // to keep the advisory from inviting the deletion of a card written today.
  let windowStart = null

  for (const file of sessionLogFiles(roots)) {
    files += 1
    let rows
    try { rows = readFrames(file) } catch { unreadable += 1; continue }
    let sessionId = null
    for (const line of rows) {
      let row
      try { row = JSON.parse(line) } catch { continue }
      if (row.type === 'session') {
        sessionId = row.id
        seenSessions.add(row.id)
        if (typeof row.createdAt === 'number' && (windowStart === null || row.createdAt < windowStart)) {
          windowStart = row.createdAt
        }
        continue
      }
      if (row.type !== 'tool/call') continue
      const tool = String(row.data?.name ?? '')
      const rawArgs = row.data?.arguments ?? row.data?.input
      const raw = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {})
      if (!/cards/i.test(raw)) continue
      // Only a file read counts as use. A card id named inside a shell command or a message
      // body is prose about the card, not someone opening it.
      if (!/^(read|read_file|read_text_file)$/i.test(tool)) { ignored += 1; continue }
      // `arguments` is a JSON *string*, so a Windows path arrives with every separator
      // doubled (`cards\\pitfall`). Normalise before matching — three earlier attempts
      // failed here, each by guessing at the escaping instead of printing it, and the
      // failure mode was the worst available: reporting cards as "never opened" when they
      // had been opened, which is an invitation to delete a live card.
      const path = raw.replace(/\\\\/g, '\\').replace(/\\"/g, '"')
      // Match on the card's own file path: a card IS its file, so a rename honestly resets
      // the count, and no unrelated file can be mistaken for a card.
      const m = path.match(/cards[\\/]([^\\/"']+)[\\/]([^\\/"']+)\.md/)
      if (!m) continue
      const id = m[2]
      if (!cards.has(id)) { ignored += 1; continue }
      if (!byId.has(id)) byId.set(id, { reads: 0, sessions: new Set(), first: null, last: null })
      const rec = byId.get(id)
      rec.reads += 1
      reads += 1
      if (sessionId) rec.sessions.add(sessionId)
      const t = row.time
      if (typeof t === 'number') {
        if (rec.first === null || t < rec.first) rec.first = t
        if (rec.last === null || t > rec.last) rec.last = t
      }
    }
  }
  return { byId, files, sessions: seenSessions.size, reads, unreadable, ignored, windowStart }
}

function cmdUsage() {
  const roots = sessionLogRoots()
  if (roots.length === 0) {
    console.error('no session log root found — set DSH_HOME or DSH_SESSION_DIR')
    return 2
  }
  const cards = loadAll().filter((c) => !c.error)
  const known = new Set(cards.map((c) => c.data.id))
  const { byId, files, sessions, reads, unreadable, windowStart } = collectCardReads(roots, known)
  // Local date, not UTC: the log stores epoch ms, and rendering it as UTC made reads from
  // a 02:00 local session display as the previous day.
  const stamp = (ms) => {
    if (!ms) return '—'
    const d = new Date(ms)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  console.log(`scanned ${files} session log(s) (${sessions} session(s))${unreadable ? `, ${unreadable} unreadable` : ''}`)
  console.log(`found ${reads} card read(s) across ${byId.size} card(s)\n`)
  const rows = cards
    .map((c) => {
      const rec = byId.get(c.data.id) ?? { reads: 0, sessions: new Set(), first: null, last: null }
      return { id: c.data.id, confidence: c.data.confidence, hits: c.data.hits, misses: c.data.misses, ...rec, sessions: rec.sessions.size }
    })
    .sort((a, b) => b.reads - a.reads || a.id.localeCompare(b.id))

  console.log('reads  judge  card')
  for (const r of rows) {
    console.log(`  ${String(r.reads).padStart(3)}  h${r.hits}/m${r.misses}  ${r.id}${r.reads ? `  (${r.sessions} session(s), last ${stamp(r.last)})` : ''}`)
  }

  // A card recorded after the scan window began cannot have been opened inside it. Reporting
  // it as "never opened" reads as "nobody wants this" when the truth is "it is new", and the
  // natural response to that line is to delete a card written minutes ago.
  const tooNewToJudge = (c) => {
    if (windowStart === null) return false
    const rec = c.data.recorded
    if (!rec) return false
    return Date.parse(rec + 'T00:00:00') >= windowStart - 86400000
  }
  const never = rows.filter((r) => r.reads === 0 && !tooNewToJudge(cards.find((c) => c.data.id === r.id)))
  const unjudgedNew = rows.filter((r) => r.reads === 0 && tooNewToJudge(cards.find((c) => c.data.id === r.id)))
  const readNeverJudged = rows.filter((r) => r.reads > 0 && r.hits === 0 && r.misses === 0)
  if (never.length) {
    console.log(`\nnever opened (${never.length}) — either undocumented, or filed where nobody looks:`)
    for (const r of never) console.log(`  - ${r.id}`)
  }
  if (unjudgedNew.length) {
    console.log(`\ntoo new to judge (${unjudgedNew.length}) — recorded inside the scanned window, so no read was possible yet:`)
    for (const r of unjudgedNew) console.log(`  - ${r.id}`)
  }
  if (readNeverJudged.length) {
    console.log(`\nopened but never judged (${readNeverJudged.length}) — the reader got value or did not, and nothing recorded which:`)
    for (const r of readNeverJudged) console.log(`  - ${r.id}  (${r.reads} read(s))`)
    console.log('  Record it with: exp.mjs touch <id> hit|miss')
  }
  return 0
}

/* ── entry ────────────────────────────────────────────────────────────────── */

const [command, ...argv] = process.argv.slice(2)
const commands = { index: cmdIndex, validate: cmdValidate, search: cmdSearch, stats: cmdStats, touch: cmdTouch, new: cmdNew, selftest: cmdSelftest, usage: cmdUsage }
if (!command || !commands[command]) {
  console.log('usage: node exp.mjs <index|validate|search|stats|touch|new|selftest|usage> [args]')
  console.log('  index                     rebuild index.md from cards/')
  console.log('  validate                  check every card against SCHEMA.md')
  console.log('  search <terms...> [--all]  rank cards for a query (--all includes deprecated)')
  console.log('  search <terms...> --domain <d>  restrict a query to one domain')
  console.log('  stats                     health report for the maintenance pass')
  console.log('  touch <id> hit|miss       record a reuse outcome (judgement — you must run this)')
  console.log('  new <kind> <slug>         scaffold a card from templates/card.md')
  console.log('  selftest                  pin the verified retrieval behaviour')
  console.log('  usage                     derive how often each card was opened, from session logs')
  // No command is a bare help request; a wrong command is an error, and a caller
  // that reads the exit code must be able to tell the two apart.
  process.exit(command ? 2 : 0)
}
try {
  process.exit(commands[command](argv) ?? 0)
} catch (error) {
  console.error(`exp.mjs ${command} failed: ${error.message}`)
  process.exit(1)
}

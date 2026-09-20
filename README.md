# dsh-experience-library

An experience library for an AI coding agent: a curated store of verified facts, pitfalls and
workflows about one harness and one machine, kept so that a solved problem stays solved.

Two skills operate it, one tool maintains it, and the store is plain Markdown.

```
skills/dsh-experience-study/      read from, and write to, the library  (v0.1.0)
skills/dsh-github-reuse/          reuse an existing project instead of writing it (v0.1.0)
experience/                       the store itself: schema, tool, template, cards
examples/                         two real cards, redacted, as the quality bar
```

---

## The problem

Every session starts from zero. Left alone it re-derives the same things: where the harness
discovers skills, which flag silently disables a browser API, what the local Python encodes
text as. That re-derivation is the cost this library removes.

But a memory store fails in two directions, and both failures are silent:

- **Unbounded growth.** Every entry makes retrieval slower and less precise, until reading the
  store costs more than the knowledge saves.
- **Unchecked claims.** An entry nobody verified looks exactly like one verified five times.
  Once a confident wrong entry burns the reader, the reader stops consulting the store — and
  it is dead while every file is still on disk.

Almost every design decision below exists to make one of those two failures visible.

---

## How it works

### Three layers, loaded progressively

```
runtime    skills/<name>/SKILL.md       protocol only; loaded when the skill triggers
                                          → not triggered, zero cost

index      experience/index.md          one line per card, grouped by domain
                                          → ~40 lines for 10 cards; read on every task

cards      experience/cards/<kind>/<id>.md   read only when applies_when matches
                                          → 0–3 per task, never the whole store
```

The middle layer is the point. Reading everything is `O(n)` and gets *worse* as the store
grows; reading a small index and opening two cards is `O(1) + k`.

### The card

One card is one file, with frontmatter and five fixed sections. The schema is enforced by
`exp.mjs validate`, and a card that fails validation blocks the index from rebuilding — a bad
edit cannot half-overwrite the index with garbage.

```yaml
---
id: python-stdout-encoding
title: Python on this box defaults to GBK — mojibake on print, wrong bytes in files
kind: pitfall            # capability | pitfall | recipe | snippet | source | idea
domain: machine-env      # the topic; groups cards in the index
dtm: low                 # re-derivation cost: high | medium | low
confidence: verified     # verified | unverified | deprecated | promoted
tags: [python, encoding, gbk]
hits: 0                  # successful reuses
misses: 0                # times it misled
corrected: 2026-09-21    # date the misleading claim was fixed
recorded: 2026-09-21
source:                  # required; a card with no source is a rumour
  - cmd:python -c "import sys; print(sys.stdout.encoding)"
applies_when: writing or running any Python here, especially non-ASCII output
not_applies_when: the script is pure ASCII
recheck_after: 2027-03-16
---

## Summary / Detail / Verification / Failure mode / Notes
```

Three field choices carry most of the design:

**`source` is required.** It is the difference between a card and a rumour. Acceptable forms are
`file:<path>`, `cmd:<the command that printed it>`, `url:<url>#<ref>`, `session:<date>`, and a
card whose only source is `session:` may not claim `verified`.

**`dtm` — derivation time to rediscover — is the only honest measure of a card's worth.**
`kind` is the shape and `domain` is the topic; neither says whether the card deserves to exist.
`dtm` does, and the index is ordered by it inside each domain, so a reader who stops after two
lines has read the two that would cost the most to lose.

**Machine state is written as probes, not as sentences.** A claim about whether a tool is on
`PATH`, a version number, or a scope list is the fastest-rotting thing a card can hold, and it
rots silently — the card keeps asserting it in the same confident voice. So those claims go in
as *a command and what it must print*:

| Probe | Expected | If it differs |
|---|---|---|
| `where.exe gh` | the gh.exe path, exit 0 | fall back to the absolute path |

A stale probe mismatches visibly. A stale sentence reads as agreement, and the reader has
nothing to disagree with. This rule was added after a card confidently asserted a tool was not
on `PATH` while `verified` — and a reader following it would have written needlessly fragile
commands.

### Retrieval

Two stages, because reading a whole domain to find one card is the failure this design exists
to avoid:

1. Filter by **domain** from the index; read the one-line summaries only.
2. Read a card body only when its **`applies_when`** matches what you actually see — and check
   `not_applies_when` first, because a card applied outside its range costs more than no card.

When the index is not enough:

```bash
node experience/tools/exp.mjs search "preset mount"          # ranked by fraction of terms matched
node experience/tools/exp.mjs search chrome --domain browser-extensions
```

Then rank what you found: `verified` reuse directly, `unverified` treat as a lead, `deprecated`
read only to learn why the obvious approach fails. **And when a card misleads you, record it in
that same moment** — `touch <id> miss`, plus the edit that replaces the wrong claim and a
`corrected:` date. That instant is when the correction is cheapest, and it is the only thing
that keeps the store from filling with confident errors.

### Two counters, deliberately

| | |
|---|---|
| `hits` / `misses` | **judgement** — only move when a reader runs `touch` |
| `reads` | **fact** — derived from the harness's own session logs by `exp.mjs usage` |

They are kept apart on purpose. Opening a card and being helped by it are different claims, and
only the reader can tell them apart; treating a read as a hit would manufacture exactly the
confident-but-wrong telemetry the fields exist to prevent. So `usage` reports *"opened but never
judged"* — the queue of judgements the library is waiting on — rather than assuming an answer.

### Keeping it from rotting

- **`hits ≥ 3`** → promote: fold the knowledge into a script, the skill body, or `AGENTS.md`, and
  mark the card `promoted`. Promotion is the only thing that makes the store get *cheaper* over
  time; a card consulted forever is a lookup that never stops costing.
- **`misses ≥ 2`** or 180 days unused → demote to `deprecated`. It stays readable, because "why
  the obvious approach fails" is knowledge, but it stops taking reading attention.
- **past `recheck_after`** → re-run the card's `verification`. This is the one signal that
  catches an upstream upgrade invalidating a fact nothing else would notice.

### The close-out

At the end of a task the agent reports four lines, which is both the user's feedback channel and
the only thing that keeps the library honest:

```
经验库：read X, hit Y (<ids>), missed
新经验：<N> cards → <ids>   (or 「none」)
踩坑：<one line, or none>
遗留：<one line, or none>
```

A card is written only when all three hold: it **was paid for** (real effort to derive, not one
`read`), it **will recur** (a nameable future situation), and it is **verifiable** (a step
someone else can run). "No new experience" is the expected result for most tasks — inflating the
store to look productive is the one behaviour that destroys it.

---

## Install

The layout follows the `anthropics/skills` convention, so the bundle installs directly:

```bash
git clone https://github.com/<you>/dsh-experience-library
cp -r dsh-experience-library/skills/* ~/.dsh/skills/          # or $DSH_HOME/skills
cp -r dsh-experience-library/experience ~/.dsh/experience     # or set $DSH_EXPERIENCE_HOME
```

Then point the harness at the library by adding a short section to `$DSH_HOME/AGENTS.md` — that
file is injected into every session's first request, which is what makes the index reachable
without the model having to remember anything:

```markdown
## Experience library
A curated store of verified facts and pitfalls about this harness and this machine lives at
<absolute path to experience/>.
- Before a non-trivial task, read `experience/index.md`.
- Before searching the web for how something works here, run:
  node "<absolute path>/experience/tools/exp.mjs" search "<terms>"
- At the end of a task, give the four-line close-out and write a card only if it was paid for,
  will recur, and is verifiable.
```

## The tool

```bash
node experience/tools/exp.mjs index                 # rebuild index.md from the cards
node experience/tools/exp.mjs validate              # check every card against SCHEMA.md
node experience/tools/exp.mjs search <terms...>     # rank cards for a query
node experience/tools/exp.mjs search <terms> --domain <d>
node experience/tools/exp.mjs stats                 # maintenance report
node experience/tools/exp.mjs usage                 # reads, derived from session logs
node experience/tools/exp.mjs touch <id> hit|miss   # record reuse, or being misled
node experience/tools/exp.mjs new <kind> <slug>     # scaffold a valid card
node experience/tools/exp.mjs selftest              # pin verified behaviour; run after editing
```

Zero dependencies, Node 18+. `selftest` exists because **every failure mode of this tool is
silent and points the wrong way**: a broken search reports "not recorded yet", and a broken
usage scanner reports cards as "never opened" — an invitation to delete a live card.

---

## Honest limitations

Written down because a limitation nobody records is one nobody plans around.

- **The store is worth what is in it.** This repository ships the *mechanism* with an empty
  store, and an empty store helps nobody. Its value arrives with use, and it arrives on the
  *second* visit to a domain — the first task in a new area gets an honest miss and pays full
  cost.
- **Automatic triggering is unverified.** In observed use the entry point was always a person
  naming the skill, or an `AGENTS.md` pointer being followed; description-only matching has not
  been measured. Treat triggering as a thing to check, not to assume.
- **`hits`/`misses` are manual.** `usage` closes the half that can be closed honestly, but only
  a reader can say whether a card helped. A read-only task cannot call `touch` at all.
- **`confidence: verified` means "checked once", not "still true".** The defences are
  `recheck_after`, the probe-first rule, and readers who check. A false fact once survived under
  `verified` in this very library until an independent reader ran the one command that
  contradicted it.
- **The process can outgrow the data.** This one did: at v0.1.0 it carried a full `deprecated`
  lifecycle, promotion rules, and merge conventions while holding ten cards, three of them ever
  reused, and zero ever deprecated. Mechanisms that have never fired are not proven — they are
  just written.

## Layout of a store

```
experience/
├── index.md          generated — never hand-edit; rebuild instead
├── SCHEMA.md         the card contract (fields, sections, per-kind rules)
├── README.md         what the store is and how it is maintained
├── changelog.md      what changed in the store itself, and why
├── cards/<kind>/<id>.md
├── templates/card.md
├── tools/exp.mjs
└── archive/          deprecated and merged cards
```

## License

MIT — see [LICENSE](LICENSE).

---
name: dsh-experience-study
description: Read from and write to the DSH experience library — a curated store of verified facts, pitfalls, and workflows about this harness and this machine. Use this skill at the start of any non-trivial task, whenever work needs more than a couple of tool calls, whenever you are about to search the web or the filesystem for how something works here, whenever you catch yourself re-deriving something you may have derived before, and at the end of a task to record what was learned. Load it before acting on harness mechanics, environment quirks, or a workflow you may have already solved once.
metadata:
  version: "0.1.0"
user-invocable: true
---

# DSH Experience Study

The experience library exists so that a solved problem stays solved. Without it, every session re-derives the same harness mechanics, re-hits the same Windows path quirks, and re-searches for the same project — paying the same thinking cost repeatedly. With it, the second time is cheap.

The library is only worth what it saves. A card nobody reads is worse than no card, because it makes the index longer and the next search slower. So this skill is deliberately biased: **read little, write rarely, and only after something actually worked.**

## Library location

`$DSH_HOME/experience/` — for this machine: `H:\deepseek-harness\dsh-home3\experience\`

- `index.md` — the always-read entry point (small: one line per card, grouped by domain)
- `cards/<kind>/<slug>.md` — the card bodies, read only when the index says they apply
- `tools/exp.mjs` — rebuild the index, search, validate
- `SCHEMA.md` — the card contract

If `$DSH_EXPERIENCE_HOME` is set, it wins over the path above.

## P0 — Read the index first

Read `index.md` **as soon as the task is understood, and before the first substantive tool
call** — one `read` of a small file, which is the whole point of keeping the index small. It
is short by design; if it has grown past ~150 lines, stop and run maintenance (P4) instead of
working around it.

Then ask one question: **does this task touch anything the index lists?** If the task is a one-liner — a single command, a single file read, a question you can answer from what you already hold — close the skill and get on with it. Loading cards you do not need spends the context the library was supposed to save.

Favour the library when the task involves:

- how this harness works (skill roots, hooks, presets, plugins, session logs, prompt assembly)
- this machine's environment (Windows paths, PowerShell, what is and is not on PATH)
- a workflow you have a suspicion you have run before
- a decision where being wrong costs a wasted rebuild, a wasted download, or a corrupted config

## P1 — Retrieve, then decide

Retrieve in two stages. Reading every card in a domain to find one that applies is the failure mode this design exists to avoid.

1. **Filter by domain.** Pick the domains that match the task from the index, and read the one-line summaries only.
2. **Filter by condition, then read.** Read a card body only when its `applies_when` matches what you actually see. Check `not_applies_when` before trusting it — a card that says "applies to the web profile" is wrong for a CLI session, and applying it anyway costs more than not having it.

When the index is not enough, search by content:

```powershell
node "$env:DSH_HOME\experience\tools\exp.mjs" search "preset mount"
```

**Confirm before use.** Read the card's `verification` step. If the verification is cheap (a file exists? a command prints this? a grep matches?), run it. A card whose verification no longer holds is evidence the environment moved, not evidence the card is right — mark it and move on.

**Retrieve again when the domain changes — not only at the start.** A task that begins in a familiar area often wanders into an unfamiliar one: a browser question becomes a CDP question, a config change becomes a build question. The first search answers the task you started with, not the one you ended up doing. When you notice you are now working in territory the index did not cover, search again for *those* words. A session that searched once and then spent thirty minutes in a domain the library had cards for would be the library's own failure, and it has already happened once: the browser-extension session searched, got an honest miss, and never re-searched after the work moved into Chrome internals.

Rank confidence honestly and act accordingly:

- `verified` — reuse directly.
- `unverified` — treat it as a lead, not a fact. Verify it before building on it, and if it holds, promote it.
- `deprecated` — read it only to understand why the obvious approach fails. Never build on it.

**Report what you used, in one line, as you use it.** Something like `experience: using dsh-skill-roots [verified, 3 hits]`. The user wants to see the library earning its keep, and a card that never appears in that line is a card that should be pruned.

**When a card misleads you, stop and record it now** — this is the moment the correction is cheapest, and the whole library is built to be corrected. Say in one sentence what the card claimed and what actually held, then:

```powershell
node "$env:DSH_HOME\experience\tools\exp.mjs" touch <id> miss   # record that it misled
```

Then fix the card: replace the wrong claim with the measured one, and set `corrected: <date>` in its frontmatter. `touch` drops `confidence` to `unverified` **unless** `corrected` is already newer than the miss — because a card whose misleading text was replaced is not the card that misled. Do the edit and the `corrected` field together; a bare `touch miss` leaves a good card marked untrustworthy.

## P2 — Work

Apply the card. If it turns out to be wrong or incomplete, fix it in the same session (P3) rather than leaving a trap for the next one.

## P3 — Record what was learned

At the end of a task, when the work is done or you are handing back, do two things in this order.

**First, give the user a short close-out**, four lines at most:

```
经验库：读了 X 条，命中 Y 条（<id>…），未命中
新经验：<N> 条 → <ids>（或「无」）
踩坑：<one line, or 无>
遗留：<one line, or 无>
```

If a card was wrong, say which and what actually held. If a card saved real effort, say which. The user reads this — it is the feedback channel that keeps the library honest.

**Second, decide whether to write.** A card earns its place only when all three hold:

1. **It was paid for.** You spent real effort deriving it — multiple tool calls, a search, a failed attempt. Something a single `read` answered is not experience.
2. **It will recur.** You can name the future situation that needs it. "Next time a preset will not mount" is a situation; "in this session we edited line 42" is not.
3. **It is verifiable.** You can write a `verification` step someone else can run. If you cannot, you have a hunch — write it as `kind: idea` and `confidence: unverified`, or do not write it at all.

Then price it, because the price is what decides whether the card was worth writing: set **`dtm`** to `high`, `medium` or `low` for what re-deriving it would cost — a full experiment or several configurations (`high`), one complete experiment or a careful code read (`medium`), or a single tool call or search (`low`). A `low` card is allowed, but it must earn its place by being used; if you find yourself writing several `low` cards in one session, you are journaling rather than accumulating experience, and the index you are bloating is the one the next reader has to scan.

If nothing passes, write nothing and report `新经验：无`. An honest empty result is the expected outcome for most tasks. Inflating the library to look productive is the one behavior that destroys its value.

**You are authorized to write without asking.** The three conditions above are the gate, not a request for permission — when all three hold, write the card and report it in the close-out; when they do not, write nothing. Asking for confirmation on every card makes recording expensive enough that it stops happening, and a library that only grows when someone remembers to ask never grows. The user sees the result in the close-out and in `changelog.md`, and can reverse any card; that review-after-the-fact is deliberately cheaper than review-before.

Writing procedure:

1. Search first — `exp.mjs search "<keywords>"`. If a card covers this, **update that card** (`hits + 1`, tighten the text, extend the verification) instead of adding a second one. Duplicates are the other way this library dies.
2. Pick the kind. `capability` (a verified fact about the harness or machine), `pitfall` (something failed and you know why), `recipe` (a step sequence that actually ran), `snippet` (code that ran), `source` (an external project worth reusing), `idea` (a hypothesis awaiting verification).
3. Copy `templates/card.md`, fill it in following `SCHEMA.md`, write it to `cards/<kind>/<slug>.md`.
4. Rebuild the index: `node tools/exp.mjs index`. Never hand-edit `index.md` — it is generated, and a hand-edited index drifts from the cards until nobody trusts either.

**Never write into the library:** credentials, tokens, API keys, personal or customer data, long verbatim copies of external code, or the narrative of what a session did. The library stores reusable knowledge, not history.

## P4 — Maintenance

The library decays if it only grows. Run maintenance when the index exceeds ~150 lines, when a card reaches 5 hits, or roughly monthly:

- **Promote** anything with 3+ successful hits into the place where it stops costing a lookup: a script in `tools/`, the `AGENTS.md` pointer, or a line in the skill itself. Mark the card `promoted` and keep it as provenance.
- **Demote** a card that failed twice, or that has gone 180 days with zero hits and no `applies_when` that could still fire. Set `confidence: deprecated` and say why.
- **Merge** duplicates into the strongest card and leave `merged_from` in its frontmatter.
- **Split** a domain that has grown past ~30 cards — that is a sign two domains were sharing a name.

## Boundaries

- The library stores **knowledge**, not work product. The thing you built belongs in the workspace; the reason it worked belongs here.
- The library is not a wiki. If a fact is one `grep` away in a repository you have open, a card about it is overhead.
- When a card and the live system disagree, the live system wins. Fix the card in the same session.

## Reference

- `SCHEMA.md` — every frontmatter field, the body sections, and what each kind requires.
- `templates/card.md` — the card scaffold to copy.
- `README.md` (in the library root) — what the library is and how it is organized.

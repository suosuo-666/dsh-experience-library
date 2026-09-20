# Card schema

Every card is one Markdown file at `cards/<kind>/<slug>.md`, with YAML frontmatter
and a fixed body. `tools/exp.mjs validate` enforces this file; a card that fails
validation is a bug, not a style preference — the index generator, the search,
and every future retrieval depend on these fields meaning exactly one thing.

## Frontmatter

```yaml
---
id: dsh-skill-roots                 # required, kebab-case, must equal the filename
title: Where DSH discovers skills   # required, one line, reads as a claim
kind: capability                    # required: capability|pitfall|recipe|snippet|source|idea
domain: dsh-harness                 # required, kebab-case, groups cards in the index
dtm: medium                         # required: high|medium|low — see "Re-derivation cost" below
confidence: verified                # required: verified|unverified|deprecated|promoted
tags: [skills, discovery, roots]    # required, >=1, lowercase kebab-case
hits: 0                             # required, integer >= 0, successful reuses
misses: 0                           # required, integer >= 0, times it misled
missed_on: 2026-09-16               # optional, set by `touch miss`
corrected: 2026-09-16               # optional, date the misleading claim was fixed
last_used: 2026-09-16               # optional, YYYY-MM-DD, set on reuse
recorded: 2026-09-16                # required, YYYY-MM-DD
source:                             # required, >=1 entry, where the claim comes from
  - file:H:\deepseek-harness\node_modules\@deepseek-ai\dsh-skill-filesystem\README.md
  - session:2026-09-16
applies_when: this session resolves skills, or a skill failed to appear
not_applies_when: the question is about MCP tools rather than skills
recheck_after: 2027-03-16           # optional; DSH upgrades invalidate harness facts
merged_from: [old-slug]             # optional, only on a merge
superseded_by: other-slug           # optional, set when deprecated in favour of another card
---
```

### Field rules that matter

- **`source` is not optional and not decorative.** It is the difference between a card
  and a rumour. Acceptable forms: `file:<path>` (optionally `file:<path>:<line>`),
  `cmd:<the command that printed it>`, `url:<url>#<commit-or-date>`, `session:<YYYY-MM-DD>`.
  A card whose only source is `session:` may not be `confidence: verified`.
- **`dtm` is the only honest measure of a card's worth.** `kind` says what shape the knowledge
  takes and `domain` says where it belongs; neither says whether the card deserves to exist.
  `dtm` — *derivation time to rediscover* — does: **high** cost a full experiment, several
  browser/OS configurations, or reading the implementation to establish; **medium** cost one
  complete experiment or a careful code read; **low** would be found again by a single tool
  call, a single failed fetch, or one search. Cards are ranked by it inside each domain, so a
  reader who stops after two lines has read the two that would cost the most to lose.
  A `low` card is not forbidden — it is a card that must earn its place by being *used*.
  Without this field, a hard-won browser divergence and a docs-URL pattern looked identical in
  the index, and the pruning pass had nothing to weigh.
- **`domain` is the topic, `dtm` is the price, `kind` is the shape.** If a card seems to need
  two domains, the honest split is usually by *the question the reader is asking*, not by
  subject matter: `machine-env` holds facts about this box that are true regardless of what you
  are building, which is why "a docs mirror exists" sits there while "how Chrome loads
  extensions" does not.
- **`confidence` means one specific thing.** `verified` = someone ran the `verification`
  step and it held. `unverified` = recorded as a lead, never confirmed. `deprecated` =
  known wrong or obsolete; keep it so the obvious-but-wrong approach is documented.
  `promoted` = folded into a script, the skill, or `AGENTS.md` so it no longer needs a
  lookup; kept for provenance.
- **`applies_when` / `not_applies_when` are the retrieval filter.** A card without a
  usable `applies_when` cannot be filtered, so it either gets read every time (cost) or
  never (waste). Write the condition you would actually check, not a restatement of the title.
- **`recheck_after` is how harness facts avoid going stale silently.** Any `capability`
  card about DSH internals should carry one, because a DSH upgrade can invalidate it
  without changing anything the card can see.
- `hits` / `misses` are maintained by the reader, not by a script: increment `hits` when
  the card was used and worked, `misses` when it misled you, and set `last_used` either way.
- **`missed_on` and `corrected` are how a miss stops counting against a card.** `touch miss`
  writes `missed_on`; a card whose misleading claim is then fixed records `corrected`, and the
  demotion is skipped because the card that misled no longer exists — the thing that misled was
  replaced. Without this, the rule fired twice on cards whose only fault had already been
  corrected and recorded, dropping `verified` cards that had just been re-measured. A miss is
  evidence about the *old* text, and `corrected` is how the card says which text it is.

## Body

Five sections, in this order. Keep the whole card under ~120 lines; a card that needs
more is usually two cards.

### Write machine state as probes, not as facts

A claim about *this machine's current state* — whether a tool is on `PATH`, a version number,
a scope list, a config value — is the fastest-rotting thing a card can hold, and it rots
silently: the card keeps asserting it in the same confident voice. Those claims belong in the
body as **a command and what it must print**, so the reader runs them instead of believing the
prose, and so the card announces its own staleness the moment the output changes.

- Wrong: "`gh` is not on PATH — call it by absolute path." (This exact sentence survived under
  `confidence: verified` and was false: `where.exe gh` resolves, and the Machine-level PATH
  contains the directory.)
- Right: "`where.exe gh` → expected `C:\Program Files\GitHub CLI\gh.exe`, exit 0. If it prints
  nothing, fall back to the absolute path."

**Why this is a rule and not a style preference:** a probe that no longer holds produces a
mismatch the reader sees immediately, while a sentence that no longer holds produces
agreement — the reader has nothing to disagree with. The first failure is self-announcing; the
second is invisible until someone happens to check, which is exactly the failure this library
exists to prevent and is least able to detect on its own.

Put the probes **inside `## Detail`**, not in a section of their own: the five section names
below are fixed, and `validate` rejects anything else. That constraint is deliberate — a
reader knows where to look without reading the card first.

```markdown
## Summary
One or two sentences: the claim itself, stated so it can be wrong.

## Detail
What is actually true, with the specifics that make it usable — names, paths,
signatures, numbers. This is the part that replaces re-derivation.

## Verification
Exactly how to confirm the card still holds, as a command or a check someone can run
without reading the rest. Must be concrete enough to fail. "Check the docs" is not
a verification.

## Failure mode
What goes wrong when the card is ignored, or when it is applied outside its
`applies_when`. For `pitfall` cards this is required and usually the most valuable
section: symptom, root cause, how to recognise it next time.

## Notes
Optional. Related cards, open questions, why an obvious alternative was rejected.
```

## Per-kind requirements

| kind | extra requirement |
|---|---|
| `capability` | `source` must cite a file or command; `recheck_after` expected |
| `pitfall` | `Failure mode` must name a recognisable symptom and a root cause |
| `recipe` | `Detail` must be ordered steps; a `Verification` that ran at least once |
| `snippet` | `Detail` holds the code; `Verification` says where it ran |
| `source` | `source` must carry the repo URL and a pinned ref; license recorded in `Detail` |
| `idea` | must be `confidence: unverified` and state what would confirm or kill it |

## Why the schema is this strict

A memory store fails in two directions. It grows without bound, so retrieval stops
finding anything; or it fills with claims nobody can check, so the reader learns to
distrust it and stops consulting it. The `confidence` / `hits` / `misses` / `source`
fields exist to make the first failure visible, and the `verification` section and the
`unverified` label exist to prevent the second. Loosening them to make one card easier
to write trades a small convenience for the mechanism that keeps the library useful.

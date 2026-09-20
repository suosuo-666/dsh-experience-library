# The experience store

A store of knowledge about **one harness and one machine** — the facts, pitfalls and workflows
that took real effort to establish, kept so that establishing them again is cheap.

This directory is the store. `skills/dsh-experience-study` is the protocol for reading and
writing it; `README.md` at the repository root explains the design.

## Why it is narrow on purpose

Scope is harness internals, extension mechanisms, and the local environment — things that are
true regardless of what you are building. Project work product belongs in the project. The
narrower the store, the shorter the index, the longer it stays useful: an index that has grown
past ~150 lines costs more to read than the knowledge saves.

## Layout

```
experience/
├── index.md            generated — the entry point, one line per card, grouped by domain
├── SCHEMA.md           the card contract; `exp.mjs validate` enforces it
├── README.md           this file
├── changelog.md        what changed in the store, and why
├── cards/
│   ├── capability/     a verified fact about the harness or the machine
│   ├── pitfall/        something failed and the root cause is known
│   ├── recipe/         a step sequence that actually ran
│   ├── snippet/        code that actually ran somewhere
│   ├── source/         an external project worth reusing, with license and pinned ref
│   └── idea/           a hypothesis awaiting verification (always `confidence: unverified`)
├── templates/card.md   the scaffold `exp.mjs new` copies
├── tools/exp.mjs       index | validate | search | stats | touch | new | selftest | usage
└── archive/            deprecated and merged cards, kept so the obvious-but-wrong is on record
```

## Daily use

```bash
node tools/exp.mjs search "preset mount"            # when the index is not enough
node tools/exp.mjs usage                            # which cards anybody actually opens

node tools/exp.mjs new pitfall preset-mounted-nothing
# fill it in, then:
node tools/exp.mjs validate && node tools/exp.mjs index
```

Recording whether a card helped is what keeps the ranking honest — and recording that one
**misled** you is what keeps the store from filling with confident errors:

```bash
node tools/exp.mjs touch preset-mounted-nothing hit
node tools/exp.mjs touch preset-mounted-nothing miss
```

`touch miss` drops `confidence` to `unverified` **unless** the card carries a `corrected:` date
newer than the miss — because a card whose misleading text was replaced is not the card that
misled. Do the edit and the field together; a bare `touch miss` leaves a good card marked
untrustworthy.

After editing anything in `tools/`, run the guard — every failure mode of this tool is silent:

```bash
node tools/exp.mjs selftest
```

## Maintenance

Run it when `stats` reports candidates, when the index passes ~150 lines, or roughly monthly:

- **`hits ≥ 3`** → promote into a script, the skill, or `AGENTS.md`; mark the card `promoted`.
- **`misses ≥ 2`**, or 180 days with no hits → `deprecated` and archive it.
- **past `recheck_after`** → re-run the card's `verification`; push the date out or fix the card.
- **duplicates** → merge into the strongest, record `merged_from`.
- **a domain over ~30 cards** → it is two domains sharing a name.

## Ground rules

- Never store credentials, tokens, personal data, or long verbatim copies of external code.
- Never store the narrative of what a session did. The reason it worked is knowledge; the
  sequence of events is not.
- When a card and the live system disagree, the live system wins — fix the card in the same
  session, because that is when the correction is cheapest.
- An empty close-out ("no new experience") is the expected outcome for most tasks. Most work
  teaches nothing that generalises, and padding the store to look productive is what kills it.

# Change log

Newest first. One entry per change, with the date and why. This is the audit trail for the
store itself: when a card is corrected or retired, the reason belongs here so a future reader
can tell a deliberate revision from a drift.

## 2026-09-21 — v0.1.1, first release fix

Found by testing the published artifact the way a stranger would: clone it and run the first
command the README suggests.

- **`selftest` reported failures on an empty store** — which is the state this repository ships
  in. The search-argument probes borrowed their sample card from the real store, and with no
  cards there was nothing to borrow, so three probes failed and a brand-new user's first command
  said the tool was broken. They now build their own fixture store and drive `cmdSearch` against
  it. Verified on a fresh copy: `0/0 passed, 6 skipped` for the card-specific probes (honest —
  those cards are not here) and 10 probes actually exercised and passing.
- **Added `a body-only term is still found`** as a permanent probe. The earlier fix — scoring
  against the whole card body rather than only `Summary`/`Detail` — had no regression guard, and
  it was the bug that made a card invisible to the query that needed it.
- Released at `metadata.version: "0.1.0"` in both skills; this fix ships as the first patch.
  Note for anyone editing frontmatter: `metadata.version` is the only version field the skill
  loader reads, and `license`/`compatibility`/`allowed-tools` are discarded silently.

## 2026-09-21 — v0.1.0, published

- Store, schema, tool and both skills packaged and released. The store ships **empty** on
  purpose: an empty store with a strict schema is useful, a populated one with no schema is not,
  and someone else's machine facts are not content.
- `metadata.version: "0.1.0"` added to both skills. `license`, `compatibility` and
  `allowed-tools` are silently discarded by the skill loader, so version information has to live
  in `metadata`, which is the one extension field that is actually read.
- Both example cards were validated against `SCHEMA.md` before release, in the same store the
  schema governs — an example that fails its own schema teaches the wrong thing.
- The README documents the mechanism *and* its unproven parts. At this version the store had
  never run a maintenance pass, no card had ever been deprecated, and description-only
  triggering had not been measured. Recording that is cheaper than discovering it later.

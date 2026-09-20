# Change log

Newest first. One entry per change, with the date and why. This is the audit trail for the
store itself: when a card is corrected or retired, the reason belongs here so a future reader
can tell a deliberate revision from a drift.

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

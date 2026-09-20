# Example cards

Two real cards from a working store, **redacted** — the mechanism is worth showing, the machine
facts are not. They are the quality bar, not content to install.

Both are valid against `experience/SCHEMA.md`: to prove it, copy them into `experience/cards/`
under the right subdirectory and run `node experience/tools/exp.mjs validate`. An example that
does not pass the schema it demonstrates would be teaching the wrong thing.

| Card | What it demonstrates |
|---|---|
| [`pitfall-silent-encoding-corruption.md`](pitfall-silent-encoding-corruption.md) | A measured behaviour table, a `Verification` that can actually fail, and a **Failure mode** that names three symptoms of one cause. Note that it contradicts the report it came from and says so: the card records what was measured, not what was assumed. |
| [`pitfall-correction-in-place.md`](pitfall-correction-in-place.md) | A card that misled its own author within the session that wrote it: `misses: 1` kept, `missed_on` and `corrected` set, and the wrong claim **replaced in the body** rather than quietly deleted. This is what "when a card and the live system disagree, the live system wins" looks like on disk. |

Three things to notice:

- **Every claim has a source, and it is the kind you can re-run** — a `cmd:` that printed the
  value, not a link to a page that mentions it.
- **`dtm` is honest.** Both are `medium`. Neither claims to be irreplaceable, so a reader who
  skips them knows what was lost rather than guessing.
- **Being wrong is recorded, not erased.** The second card exists in its corrected form *and*
  carries the evidence that it was once wrong. That is the whole difference between a store that
  self-corrects and one that quietly accumulates confident errors.

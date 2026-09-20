# Licensing: what you may take

This is a practical filter for deciding whether code can be reused, not legal advice. When
the destination project's licensing is unclear, or the license is unusual or absent, surface
the question to the user instead of deciding it.

## The one-sentence rule

**Permissive licenses let you take code; copyleft licenses let you take ideas.** Vendoring
GPL/AGPL source into a project that is not itself GPL/AGPL is the one mistake that cannot be
fixed by refactoring later.

## Quick reference

| License | Excerpt into your code | Vendor the source | Depend on it | Notes |
|---|---|---|---|---|
| MIT / ISC / BSD-2 / BSD-3 | Yes, keep the notice | Yes | Yes | The default good case |
| Apache-2.0 | Yes, keep the notice, state changes | Yes | Yes | Adds a patent grant; `NOTICE` file must travel with the code |
| MPL-2.0 | Yes, file-level copyleft | Yes, modified files stay MPL | Yes | Keep MPL files separate and unmodified if you can |
| LGPL-2.1/3.0 | Only as an unmodified library | Only dynamically linked | Yes | Static linking or modification pulls the whole project in |
| GPL-2.0/3.0 | No — write your own from the idea | No | Only if your project is GPL | Ideas and algorithms are not copyrightable; the expression is |
| AGPL-3.0 | No | No | Only if your project is AGPL | Network use counts as distribution — worse for services |
| Unlicense / CC0 / public domain | Yes | Yes | Yes | Verify it really is public domain in your jurisdiction |
| No `LICENSE` file | **Assume all rights reserved** | No | No | Ask the author; a repo without a license grants nothing |
| "Free for non-commercial" / custom | Read the exact terms | Usually no | Maybe | Custom licenses are where audits fail; quote the terms to the user |

## Practical consequences

- **Attribution is not optional even when the license is permissive.** Keep the copyright
  line and the license text with the copied code. A file whose origin is not visible is a
  file nobody can audit later.
- **A dependency is usually the cheapest legal path.** Installing an MIT/Apache package and
  letting the package manager carry the license is far less work than vendoring the same
  code — another reason Tier 2 beats Tier 3.
- **Rewriting is a legitimate answer.** Reading GPL source and writing your own
  implementation of the same *idea* is legal; copying the expression is not. When you do
  this, do not keep the original open beside the editor — copy structure is what gets
  noticed.
- **Watch for hidden code.** Vendored minified bundles, generated files, and "vendored"
  subdirectories inside a permissively-licensed repo can carry a different license. Check
  the file headers, not just the root `LICENSE`.
- **Model output is not a license.** Code reproduced from memory may be a near-verbatim copy
  of copyleft source. When a snippet looks like it came from a specific project, treat it as
  that project's code and check the license.

## What to record

In the `kind: source` experience card and any provenance file: the license SPDX identifier,
the pinned commit, the paths taken, and whether the copy was modified. If the license was
ambiguous, record the ambiguity and what the user decided — the next person to touch this
code needs to know it was a judgement call, not a settled fact.

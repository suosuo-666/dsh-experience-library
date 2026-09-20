---
name: dsh-github-reuse
description: Reuse an existing open-source project instead of writing it from scratch — search GitHub, vet the candidate, decide the integration tier, and record where the code came from. Use this skill whenever a task needs a capability that probably already exists (a parser, a client, a CLI, a data format, a protocol, a UI component), whenever the user says to look for an existing project or to borrow one, whenever you are about to write more than a screenful of utility code, and whenever downloaded or vendored code needs a license check or a provenance note.
metadata:
  version: "0.1.1"
user-invocable: true
---

# GitHub reuse

Most capabilities a task needs already exist, maintained by someone who cared about it
longer than this session will last. Writing it anyway costs tokens, introduces bugs that a
used library already fixed, and leaves an unmaintained copy behind. But reaching for a
dependency is its own failure mode: a GPL package vendored into a private repo, a
half-abandoned library pinned at a version nobody can upgrade, a 40 MB dependency pulled in
for one function.

This skill is the procedure between those two failures: **find it, vet it, use the least of
it that works, and leave a record of where it came from.**

## Step 1 — Search before writing

Search GitHub, not just the web. Prefer, in order:

1. An already-installed dependency or an existing tool on this machine.
2. A package in the ecosystem's registry (npm, PyPI, crates, Maven) — a package is easier to
   upgrade than vendored source.
3. A GitHub repository worth vendoring or adapting.
4. Writing it.

Useful queries: the *problem* not the solution (`"parse RDP bitmap" filetype:py`), the
format or protocol name plus `library`, or a search for the concept in awesome-lists.
Check the connector's tools (`mcp__github__search_repositories`, `search_code`) before
falling back to a web search — they return structured metadata you can rank on.

Stop searching when two independent candidates satisfy the requirement, or when the top
candidate is clearly dominant (stars, recent commits, used by projects you recognize).
Endless tool-hunting is the failure mode on this side; ten minutes of searching is a
budget, not a starting point.

## Step 2 — Vet before downloading

Read the repository, not the README's claims. Grep, don't skim.

| Check | Fail signal |
|---|---|
| **License** | No `LICENSE` file at all; GPL/AGPL when the destination is closed or proprietary |
| **Maintenance** | Last commit over ~18 months ago; open PRs piling up; issues closed without comment |
| **Adoption** | Zero dependents, no releases, one contributor, no tags |
| **Fit** | The library solves 20% of the problem and expects you to build the rest |
| **Weight** | Pulls a large transitive tree for one function |
| **Security** | `postinstall` scripts, obfuscated code, network calls at import time, no provenance |

License is the one hard stop, and it is a **legal** question, not a preference: GPL/AGPL
source cannot be vendored into a project that is not itself GPL/AGPL, and "we'll rewrite it
later" is not a plan. When the license is unclear or the destination's licensing is unknown,
say so and ask — do not silently copy. The details are in `references/licensing.md` when the
case is not obvious.

**Pin before you trust.** Record the commit SHA, not the branch. A branch is a moving
target; the provenance record has to name what was actually taken.

## Step 3 — Pick the least integration that works

Escalate only when the tier below genuinely fails. Each tier up costs maintenance,
review burden, and upgrade risk.

| Tier | Form | Choose when | Cost |
|---|---|---|---|
| **0 — Reference** | Cite the approach in a card, write your own code | You need the design, not the code; license is hostile; the code is small | Time, not maintenance |
| **1 — Excerpt** | Copy the specific function/algorithm, with attribution and its license header | One function is the whole value; the dependency tree is enormous | Must track upstream changes yourself |
| **2 — Dependency** | Install the package, pin the version | The package is maintained, the tree is reasonable, you use a real part of it | Upgrade churn, supply-chain surface |
| **3 — Vendored plugin** | Vendor the source into a `vendor/` or plugin directory | No package manager path exists, or local patching is required | Full ownership: you now maintain the fork |
| **4 — Host plugin** | Wrap it as a Cordis plugin row in a composition | It should contribute tools/services to sessions | Composition change, recheck on DSH upgrade |

Tier 4 is a real recurring cost in this harness: a plugin row in a composition is a
configuration surface that a DSH upgrade can invalidate. Default to Tier 1 or 2 unless the
capability genuinely needs to be available as a tool in every session — and when it is,
record it in the experience library so the next session knows the row exists and why.

**Attribute in place.** Whichever tier, the copied or vendored code keeps its original
license header and a pointer to the pinned source. A file whose origin is not obvious is a
file nobody dares touch later.

## Step 4 — Record the provenance

Every non-trivial reuse leaves a record. For a local copy, that means the entry in the
experience library (`kind: source`, see `dsh-experience-study`); for vendored files, a
header or a `vendor/<name>/README.md`; for this machine's installed skills, the convention
already in use is a provenance file:

```json
{
  "<name>": {
    "repo": "owner/repo",
    "ref": "<commit sha>",
    "srcRoot": "path/inside/repo",
    "license": "MIT",
    "installedUtc": "2026-09-20T00:00:00Z",
    "adapted": "true",
    "vendoredPaths": ["vendor/<name>"]
  }
}
```

Write the `kind: source` card with the pinned ref, the tier you chose and why, and the
upgrade path (which command checks for a newer upstream, and what would break). A reuse with
no recorded origin is indistinguishable from code you wrote — which is exactly the state
that makes a future license audit impossible.

## Step 5 — Report

Tell the user four things, briefly: **what** you took, **which tier**, **the license and
pinned ref**, and **what it costs them going forward**. If you chose Tier 0 and wrote your
own code despite a good library existing, say why — that decision is the one a reviewer will
question, and it is worth one sentence of justification at the time rather than a debate
later.

## Reference

- `references/licensing.md` — what each common license permits for vendoring and excerpting.
- `references/adapting.md` — how to convert an external tool into a DSH plugin row, and what
  to recheck after a DSH upgrade.

Verify rather than assume, on two points that are cheaper to check than to get wrong:

- **Pin the ref before copying anything.** `mcp__github__get_file_contents` accepts a `ref`,
  so read the file at the commit you intend to record; a copy taken from a branch is already
  unverifiable the moment upstream moves.
- **The harness facts in `adapting.md` describe DSH as inspected on 2026-09-21 and can drift
  with an upgrade.** Before building a plugin row on them, confirm the current shape — and if
  the experience library is available, read its `dsh-harness` domain first, because a
  corrected fact there beats a remembered one here.

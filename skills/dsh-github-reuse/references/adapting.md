# Adapting an external tool into this harness

Two different things get called "turn it into a plugin" here, and confusing them wastes a
day. Pick by asking **who needs the capability**:

- **Only this task needs it** → run it as a command or a script. Do not build a plugin.
- **Every session needs it as a tool** → it belongs in a composition, and the question
  becomes *which plane* (below).

## The default: don't build a plugin

A CLI, a script in `tools/`, or a Python/Node module invoked through `pwsh` is almost always
enough, costs no configuration, and cannot break on a DSH upgrade. A Cordis plugin row is a
configuration surface with a lifecycle — it must be mounted, it can fail to resolve, it
grants capabilities to every session on that preset, and a DSH upgrade can invalidate it.
Reach for it when the tool has to be *visible to the model as a tool*, not merely runnable.

## When it is a plugin: choose the plane

The harness composes in two planes, and a row in the wrong one either contributes nothing or
scopes a shared service to a single session. Load the `editing-cordis-compositions` skill
before writing the row — it is the authority on this, and the summary below is only enough to
pick a direction.

- **HOST composition** (`cordis.patch.yml` of the profile, or a bundle's own patch file) —
  holds registries and anything shared across sessions: persistence, sandbox and approval,
  the model route, the subagent registry. A row that publishes a service belongs here.
- **AGENT PRESET** (`agent.cordis.yml` under `<dshHome>/.agent-presets/<id>/`) — what one
  session contributes: its tools, persona, prompt sections. A row that only adds a tool the
  model calls belongs here.

A dynamic Cordis plugin (`cordis_define` / `cordis_run`) is the third option and is the right
one for a temporary extension: it lives only in the running process, needs no file, and
disappears on restart. It is the correct home for "I want this tool for the next hour" and
the wrong home for anything that must survive a restart.

## Converting a third-party tool

1. **Pin the source.** Record repo + commit before touching anything.
2. **Check the entry point.** Most tools expose a CLI or a library function; wrapping the
   library function is usually less work and more robust than shelling out, and vice versa
   when the tool is Python and the harness is Node.
3. **Decide the interface, not the implementation.** What does the model actually need to
   pass in and get back? A plugin tool that returns 200 KB of raw output is unusable; return
   the answer plus a path to the detail.
4. **Keep the license header** and note the adaptation in the provenance record.
5. **Make every side effect reversible.** Registrations, timers, listeners, and handlers must
   belong to the plugin's fiber so stopping the row removes them; a leaked listener survives
   the plugin and corrupts later runs.
6. **Verify by mounting it, not by reading it.** A row that parses cleanly can still fail to
   resolve a dependency, or mount and contribute nothing. Load the composition and confirm
   the tool or service actually appears.

## After a DSH upgrade — the recheck list

This is why `kind: capability` cards carry `recheck_after`. A DSH upgrade can invalidate any
of these without changing anything visible in the plugin:

- the package name or export shape of the service it depends on
- the composition dialect (row fields, `insert`, `!!js` expressions)
- the extension-point names it listens on (`agent/session-start`, `tools/pre-execute`, …)
- sandbox and approval defaults that silently block what used to work
- the preset root layout

The cheap test is to mount the composition and confirm the contribution is still there. The
expensive failure is discovering it months later, when the tool has been silently missing
from every session and nobody noticed because nothing errored.

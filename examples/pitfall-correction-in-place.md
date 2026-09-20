---
id: chrome-load-extension-via-cdp-pipe
title: Chrome 137+ ignores --load-extension; load unpacked via CDP over a remote-debugging pipe
kind: recipe
domain: browser-extensions
dtm: high
confidence: verified
tags: [chrome, extension, cdp, testing, automation, load-extension, pipe, mv3]
hits: 0
misses: 1
missed_on: 2026-09-21
corrected: 2026-09-21
recorded: 2026-09-21
source:
  - cmd:Extensions.loadUnpacked over --remote-debugging-pipe -> {"id":"<extension-id>"}
  - cmd:Extensions.loadUnpacked over --remote-debugging-port WebSocket -> 'Method not available. (-32000)'
  - url:https://chromedevtools.github.io/devtools-protocol/tot/Extensions/
applies_when: you need an unpacked Chrome extension actually loaded for an automated test, or an unpacked extension silently does not appear
not_applies_when: you only need a WebSocket CDP connection for page automation and never touch the Extensions domain
recheck_after: 2027-03-21
---

## Summary

Loading an unpacked extension for automated testing takes three things that are easy to get
wrong one at a time: `--load-extension` must be abandoned (Chrome 137+ ignores it silently),
`Extensions.loadUnpacked` must be used instead, and that command is **only exposed on a
`--remote-debugging-pipe` connection** — over `--remote-debugging-port` it answers
`Method not available. (-32000)`. No Playwright required.

## Detail

Steps that produced a loaded extension on Chrome 148, Windows:

1. Launch Chrome with its own profile and a pipe, **not** a port:

   ```text
   chrome.exe
     --remote-debugging-pipe
     --user-data-dir=<fresh temp dir>
     --enable-unsafe-extension-debugging      # gates the Extensions domain
     --no-first-run --no-default-browser-check
     about:blank
   ```

2. Speak CDP over the pipe. Chrome reads on **fd 3** and writes on **fd 4**, messages are JSON
   delimited by a NUL byte:

   ```js
   const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
   const write = (s) => child.stdio[3].write(s);      // Chrome reads fd 3
   child.stdio[4].setEncoding('utf8');                // Chrome writes fd 4
   let buf = '';
   child.stdio[4].on('data', (c) => {
     buf += c;
     let i;
     while ((i = buf.indexOf('\0')) !== -1) {
       const raw = buf.slice(0, i); buf = buf.slice(i + 1);
       if (raw) handle(JSON.parse(raw));
     }
   });
   ```

3. Load the extension and take the id from the **response**, not from a path hash:

   ```text
   Extensions.loadUnpacked { path: "<absolute dir>" }  ->  { id: "<extension-id>" }
   Extensions.getExtensions {}                          ->  [{id,name,version,path,enabled}]
   ```

4. Confirm with `Extensions.getExtensions` before asserting anything. `loadUnpacked` succeeding
   while `getExtensions` is empty is the signature of a half-configured launch.

### Driving an extension's UI when the toolbar popup is out of reach

`Extensions.triggerAction(id, targetId)` looks like the way to open a real toolbar popup, but it
**rejects a page target** with `Action can only be triggered on a tab target. (-32000)` — and a
`--remote-debugging-pipe` session exposes **no `tab` targets at all**. Verified on Chrome 148:
`Target.getTargets` returns only `page`, `service_worker`, `background_page` and `other`.

The workaround that preserves the code path under test: open the popup **document** as an
ordinary tab, then make the *target* page the active tab, so the popup's own
`chrome.tabs.query({ active: true, currentWindow: true })` resolves to the page exactly as it
would from the real popup:

```js
const pageTab  = (await cdp.send('Target.createTarget', { url: pageUrl })).targetId;
const popupTab = (await cdp.send('Target.createTarget',
                   { url: `chrome-extension://${id}/ui/popup.html` })).targetId;
// Page.bringToFront changes what tabs.query reports; Target.activateTarget does NOT.
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: pageTab, flatten: true });
await cdp.send('Page.bringToFront', {}, sessionId);
```

This is not identical to the toolbar popup, and the difference is worth stating whenever the
result is reported: it covers `tabs.query` → `tabs.sendMessage` → content script, but not the
popup's own window lifecycle.

To exercise a user-gesture-gated API inside the popup, a programmatic `.click()` is not enough —
it carries no activation. Read the element's bounding rect and dispatch a real
`Input.dispatchMouseEvent` at its centre. Measured: that is what moves a built-in AI model from
`downloadable` to `available`.

## Verification

```text
node tools/cdp-probe.mjs
  -> expected: "Extensions.loadUnpacked -> {\"id\":\"...\"}"
  -> expected: "installed extensions (1): <name> = <id>"
```

Then sabotage it deliberately to confirm the failure signature is recognisable: drop
`--remote-debugging-pipe` in favour of `--remote-debugging-port=9333` and the same command
returns `Extensions.loadUnpacked failed: Method not available. (-32000)` while every page-level
CDP call keeps working normally.

## Failure mode

The dangerous part is that the primary failure is **silent**. With only `--load-extension`:

- Chrome starts fine, exits with code 0, and prints no complaint about the switch.
- `/json/list` still shows `chrome-extension://` targets, because Chrome ships **component
  extensions**. Picking the first extension-looking target therefore "succeeds" and addresses
  the wrong extension.
- Navigating to a guess at the unpacked id returns `ERR_BLOCKED_BY_CLIENT`, which reads like a
  permissions problem rather than "this extension is not installed".

Recognise it by: no console output from your own content script, plus a service-worker target
whose URL is not `<your dir>/background.js`. Also note that
`--disable-features=DisableLoadExtensionCommandLineSwitch`, widely cited as the workaround, **did
not work on Chrome 148** — the flag is accepted and changes nothing.

A second trap: the path-hash id algorithm (sha256 of the directory path, first 32 hex chars,
each mapped a–p) is real but produced a different id than Chrome actually assigned for the same
directory. Treat the computed value as a cross-check only, never as the address.

## Notes

The pipe transport costs about 40 lines and removes the Playwright dependency entirely — worth
it when the only reason for Playwright was extension loading.

**This card was written and falsified inside one session (`misses: 1`, kept deliberately).** Its
first version stated that `Extensions.triggerAction(id, targetId)` opens the toolbar popup
"without driving the browser UI". Measured false. The correction is the *Driving an extension's
UI* section above. The counter stays at 1 because "this misled someone once" is exactly what it
records; `confidence` stayed `verified` because the misleading claim was replaced with a
measured one in the same session, and `corrected:` is how the card says which text the miss
refers to. The core recipe — `loadUnpacked` plus the pipe — was correct throughout.

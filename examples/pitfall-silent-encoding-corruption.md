---
id: python-stdout-encoding
title: Python on this box defaults to GBK — mojibake on print, wrong bytes in files
kind: pitfall
domain: machine-env
dtm: medium
confidence: verified
tags: [python, encoding, gbk, utf-8, stdout, files]
hits: 0
misses: 0
recorded: 2026-09-21
source:
  - cmd:python -c "import sys,locale;print(sys.stdout.encoding, locale.getpreferredencoding(False))"
  - cmd:python -c "open('x','w').write('中文')" then inspect the bytes
applies_when: writing or running any Python on this machine, especially a script that prints non-ASCII or writes a text file
not_applies_when: the script only handles ASCII, or it runs inside a process that has already reconfigured stdio
recheck_after: 2027-03-16
---

## Summary

`sys.stdout.encoding` is **gbk** and `locale.getpreferredencoding(False)` is **cp936** on this
machine, so Python's defaults silently differ from UTF-8 in two directions at once. Neither
direction raises on the common path, which is what makes this dangerous rather than annoying.

## Detail

Measured 2026-09-21 (Python 3.13.11):

| Operation | Result |
|---|---|
| `print('中文')` | **Mojibake** on the console, exit code **0** — no error at all |
| `open(p,'w').write('中文')` | Writes **GBK bytes** (`d6 d0 ce c4`), exit code 0 — a valid file that is not UTF-8 |
| `open(p,'w').write('😀')` | `UnicodeEncodeError: 'gbk' codec can't encode character`, exit code 1 |
| `open(p,'w',encoding='utf-8').write(...)` | Correct UTF-8, always |
| `sys.stdout.reconfigure(encoding='utf-8')` | Correct console output for the rest of the process |

Exit codes **are** reliable: an uncaught exception returns 1, as does an explicit `sys.exit(1)`.
(An early reading of `exit=0` for the `UnicodeEncodeError` case was an artefact of truncating
the output stream, not real behaviour — verify a suspected exit-code bug before recording it.)

## Verification

```powershell
python -c "import sys,locale;print(sys.stdout.encoding, locale.getpreferredencoding(False))"
# must print: gbk cp936

python -c "open('probe.txt','w').write('中文')"
# then check the bytes: GBK is d6 d0 ce c4, UTF-8 is e4 b8 ad e6 96 87
```

If `stdout.encoding` ever reads `utf-8`, the environment changed and this card should be
re-verified rather than trusted.

## Failure mode

Three distinct symptoms from one cause, and only the third is loud:

1. **Silent mojibake on the console** — the output looks like corruption, not like a bug, so the
   instinct is to blame the terminal or the font. Nothing failed.
2. **A wrong-but-valid file** — a script writes GBK bytes, the file opens fine *on this machine*,
   and breaks the moment anything reads it as UTF-8. This is the expensive one, because the
   fault surfaces far from the cause.
3. **A hard crash** on any character outside GBK — emoji, most non-CJK symbols. At least this one
   names the problem.

The fix is one argument: pass `encoding='utf-8'` to every `open()`, and add
`sys.stdout.reconfigure(encoding='utf-8')` at the top of any script whose output a human or
another tool will read.

## Notes

The report this card came from said Python "will explode" without `encoding="utf-8"`. That is
right about the fix and wrong about the mechanism: the common case is silent corruption, and
only non-GBK characters raise. Carded with the measured behaviour, because the summary would
send the next reader looking for a crash that does not happen.

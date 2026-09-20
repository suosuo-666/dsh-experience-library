---
id: <slug>
title: One line that reads as a claim someone could prove wrong
kind: capability
domain: dsh-harness
# What re-deriving this would cost: high (a full experiment or several configurations),
# medium (one complete experiment or a careful code read), low (a single tool call).
dtm: medium
confidence: unverified
tags: [tag-one, tag-two]
hits: 0
misses: 0
recorded: <date>
source:
  - file:<path>
  - session:<date>
applies_when: the concrete situation you can check before opening this card
not_applies_when: the near-miss situation where this card is wrong
# Set a real recheck date once the card is verified. The far-future placeholder means
# "no date claimed", so a fresh card does not report as overdue on the day it is written.
recheck_after: 2099-01-01
---

## Summary

Replace every instruction in this scaffold with a claim. A card whose Summary restates its
title has said nothing; the Detail is what replaces re-derivation, and the Verification is
what makes the card checkable instead of merely believed.

One or two sentences stating the claim itself. If it cannot be wrong, it is not
worth a card.

## Detail

The specifics that make this usable instead of re-derivable — exact names, paths,
signatures, numbers, commands. Delete these instructions before writing.

## Verification

Exactly how to confirm this still holds, as a command or a check that can fail.
"Check the docs" is not a verification.

## Failure mode

What goes wrong if this is ignored, or if it is applied outside `applies_when`.
Required for `pitfall` cards: symptom, root cause, how to recognise it next time.

## Notes

Optional. Related cards, open questions, why the obvious alternative was rejected.

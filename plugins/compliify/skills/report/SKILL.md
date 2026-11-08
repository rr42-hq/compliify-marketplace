---
name: report
description: Render the DSGVO Art. 30 record of processing activities from the recorded facts, in English or German.
argument-hint: "[en|de] [file]"
disable-model-invocation: true
allowed-tools:
  - Bash(compliify report *)
---

# compliify report

Render the record of processing activities (Art. 30 DSGVO) from the facts
recorded for this repository. What the user typed after the command:

> $ARGUMENTS

1. Pick the language from it: `en` is English, `de` is German (the legal
   original). If it names neither, ask the user which they want in one short
   question - English or German - and wait for the answer. Do not choose for
   them.
2. Run the command with that language (`en` or `de`):

   ```bash
   compliify report --lang en
   ```

   If the user also gave a file name, or asks for a file, add `--out <file>`
   and tell them where it was written instead of printing the document.
3. Give the user the document as it is. Do not shorten it, fill gaps or
   rephrase.

Run it as one plain command: a `||`, `&&` or pipe would defeat the
pre-approval and cost the user a permission prompt. Only if the shell then says
`compliify: command not found`, run
`node "${CLAUDE_PLUGIN_ROOT}/dist/compliify.js" report --lang en` instead.

Facts nobody has recorded show as "not known yet" (English) or
"unknown / needs review" (German): that is the honest state of the record, not
an error. Say which questions are still open only by pointing to
`/compliify:status`; never invent an answer to close a gap.

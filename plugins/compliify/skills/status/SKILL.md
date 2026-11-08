---
name: status
description: Where this repository stands on governance - findings, open questions and how complete the Art. 30 record is.
disable-model-invocation: true
allowed-tools:
  - Bash(compliify status *)
---

# compliify status

Show the user where this repository stands. Run the command and give them its
output as it is:

```bash
compliify status --format markdown
```

Run it as one plain command: a `||`, `&&` or pipe would defeat the
pre-approval and cost the user a permission prompt. Only if the shell then says
`compliify: command not found`, run
`node "${CLAUDE_PLUGIN_ROOT}/dist/compliify.js" status --format markdown`
instead.

- Reproduce the output in your reply. Do not summarise it, reorder it or add
  findings of your own: the CLI decides what counts as a finding, a question
  or a gap.
- Afterwards add one short pointer, only for what the output shows:
  - questions "you can answer from the code": offer to go through them now;
  - "Nothing is recorded yet": suggest `/compliify:scan` for an existing
    codebase;
  - gaps in the Art. 30 record: `/compliify:report` renders it.
- compliify runs in observe mode. Never describe a finding as blocking
  anything, and do not change code to make a finding go away.

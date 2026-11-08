---
name: check
description: Evaluate the rule pack against the recorded facts and list the findings with their next steps (observe mode - nothing is blocked).
disable-model-invocation: true
allowed-tools:
  - Bash(compliify check *)
---

# compliify check

List the governance findings for this repository. Run the command and give
the user its output as it is:

```bash
compliify check --format markdown
```

Run it as one plain command: a `||`, `&&` or pipe would defeat the
pre-approval and cost the user a permission prompt. Only if the shell then says
`compliify: command not found`, run
`node "${CLAUDE_PLUGIN_ROOT}/dist/compliify.js" check --format markdown`
instead.

- Reproduce the output in your reply, including each finding's "Next step".
  Do not re-interpret, rank or soften findings, and do not add findings the
  command did not print.
- "No findings." is a complete answer.
- The command always succeeds, whatever it finds: compliify runs in observe
  mode and never blocks a build or a session. Say so if the user asks whether
  something is blocked.
- If the user wants to dispute a finding, the facts behind it are listed with
  it; a wrong fact is corrected with the MCP tool `submit_fact` after they
  confirm the right value. Never edit `.compliify/facts.json` by hand.

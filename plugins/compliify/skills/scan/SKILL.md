---
name: scan
description: First survey of an existing codebase - finds data, model calls, controls and the architecture (takes minutes, uses your Claude usage).
disable-model-invocation: true
allowed-tools:
  - Bash(compliify scan *)
---

# compliify scan

Survey the whole repository once: a headless Claude reads the code from its
entry points, manifests and configuration and records what it can cite as
**proposed** facts - data categories, model providers, controls, and the
components and data flows of the architecture. Nothing is invented: what the
code does not show becomes an open question. It is meant for a repository that
already exists; new code is captured automatically while you work.

1. Tell the user in one sentence what is about to happen: it reads the
   repository, takes a few minutes and uses their Claude usage.
2. Run it with the Bash tool's `timeout` set to its maximum, `600000`
   (10 minutes). The default of two minutes would stop it half way through:

   ```bash
   compliify scan --architecture
   ```

   Run it as one plain command: a `||`, `&&` or pipe would defeat the
   pre-approval and cost the user a permission prompt. Only if the shell then
   says `compliify: command not found`, run
   `node "${CLAUDE_PLUGIN_ROOT}/dist/compliify.js" scan --architecture`
   instead.
3. Give the user the output as it is. If the command fails or times out,
   relay the error and stop; do not start it again on your own.
4. Then tell them the survey wrote `.compliify/facts.json` (the file to
   commit), that the facts are proposals until a person confirms them, and
   point to `/compliify:status` for what to do next and `/compliify:diagram`
   for the architecture.

The scan only reads the repository and writes `.compliify/`; it never changes
code and it never blocks anything.

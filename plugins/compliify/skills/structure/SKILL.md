---
name: structure
description: Show how the code inside each part of the system is built - its modules, what each does, and which calls which. "scan" maps it first.
argument-hint: "[scan] [--container ID] [mermaid]"
disable-model-invocation: true
allowed-tools:
  - Bash(compliify structure *)
  - Bash(compliify scan --structure *)
---

# compliify structure

Show the code structure recorded for this repository: for each container of
the architecture (a service, the CLI, a frontend, a job), the modules inside it,
what each one is responsible for, and which module calls which. It is the
level below `/compliify:diagram` and answers "what does the code actually do".
What the user typed after the command:

> $ARGUMENTS

If they asked to map or refresh it (the word `scan`), see "Mapping" below.
Otherwise run:

```bash
compliify structure
```

With `--container <id>` it shows one container; with `--format mermaid
--container <id>` it prints diagram source for it. Give the user the output as
it is: do not restate the structure from your own reading of the code, and do
not draw a diagram of your own.

- "No code structure recorded yet" means it has not been mapped: offer
  "Mapping" below. It needs the architecture survey first (`/compliify:scan`).
- Every module is a proposal until a person confirms it in the console.

## Mapping

Mapping reads the repository with a headless Claude, once per container. It
takes several minutes and uses the user's Claude usage, so say that in one
sentence first, then run it with the Bash tool's `timeout` set to its maximum,
`600000`:

```bash
compliify scan --structure
```

Add `--container <id>` to map one container only. Run it as one plain command: a
`||`, `&&` or pipe would defeat the pre-approval. Only if the shell then says
`compliify: command not found`, run the same command as
`node "${CLAUDE_PLUGIN_ROOT}/dist/compliify.js" scan --structure` instead. If it
fails or times out, relay the error and stop; do not start it again on your own.
Afterwards point to `compliify structure` and to the Code structure tab of the
console.

---
name: diagram
description: Show the architecture compliify has recorded - components and data flows, with what is still unknown.
argument-hint: "[text|mermaid|markdown|plantuml|json] [file]"
disable-model-invocation: true
allowed-tools:
  - Bash(compliify diagram *)
---

# compliify diagram

Show the architecture recorded for this repository: its components, the data
flows between them, and what the facts do not say yet. What the user typed
after the command (a format, then optionally a file):

> $ARGUMENTS

Run the command. With no format use `text`, an outline that reads well in a
terminal:

```bash
compliify diagram --format text
```

Other formats: `markdown` (tables plus a Mermaid diagram, for a README or
wiki), `mermaid`, `plantuml`, `json`. If the user also gave a file name, or
asks for a file, add `--out <file>` and tell them where it was written.

Run it as one plain command: a `||`, `&&` or pipe would defeat the
pre-approval and cost the user a permission prompt. Only if the shell then says
`compliify: command not found`, run
`node "${CLAUDE_PLUGIN_ROOT}/dist/compliify.js" diagram --format text`
instead.

- Give the user the output as it is. Do not draw a diagram of your own and do
  not restate the architecture from reading the code.
- "No architecture facts yet" means nothing has been surveyed: point to
  `/compliify:scan`. Do not run the survey yourself.
- Above roughly 20 components a Mermaid layout gets crowded; suggest
  `plantuml` or the `markdown` tables for such a system.
- To explain the picture to a non-engineer, or to correct an element, the
  `architecture` skill applies.

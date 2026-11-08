---
name: setup-ci
description: Add the GitHub Actions workflow that comments the governance delta on every pull request.
argument-hint: "[--server-url URL] [--console-url URL] [--scan] [--architecture]"
disable-model-invocation: true
allowed-tools:
  - Bash(compliify setup ci *)
---

# compliify setup-ci

Write `.github/workflows/compliify.yml` for this repository: the governance
check on every pull request. It runs in observe mode - it comments the
governance delta and never fails the build. By default it calls no model: it
checks the facts committed in `.compliify/facts.json`, which the plugin
captured in each developer's own Claude Code, so CI spends no tokens and needs
no Anthropic key. Flags the user typed after the command:

> $ARGUMENTS

1. Preview it, with their flags where `<flags>` stands, and show the user the
   workflow:

   ```bash
   compliify setup ci <flags> --dry-run
   ```

   Flags: `--server-url <url>` pushes facts to a compliify server and adds a
   push trigger on the default branch; `--console-url <url>` links the
   console in the comment; `--scan` also scans the changed files in CI with
   the repository's own `ANTHROPIC_API_KEY` secret (the tokens are billed to
   that key); `--architecture` surveys the whole repository for architecture
   on every run (slower, more API quota; it implies `--scan`). Only use flags
   the user gave, and never suggest `--scan` or `--architecture` yourself: they
   move token spending into CI. If they gave none, do not ask for any: a plain
   workflow is complete.
2. Once they agree, write it with the same flags:

   ```bash
   compliify setup ci <flags>
   ```

   The command refuses to overwrite an existing workflow and says so; ask
   before adding `--force`.
3. Show the output as it is. It ends with the next steps - the
   `gh secret set` commands (only for the secrets this workflow uses, which is
   none without `--server-url` and `--scan`) and the commit. Tell the user to
   run those themselves; the secret values are theirs. Never ask them to
   paste a key into the chat. Remind them to commit `.compliify/facts.json`
   too: it is what the workflow reads.

Run each command as one plain command: a `||`, `&&` or pipe would defeat the
pre-approval and cost the user a permission prompt. Only if the shell then says
`compliify: command not found`, run the same command as
`node "${CLAUDE_PLUGIN_ROOT}/dist/compliify.js" setup ci ...` instead.

Nothing else is changed: no code, no other workflow, no repository settings.

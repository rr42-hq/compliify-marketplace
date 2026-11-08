---
name: setup-ci
description: Add the GitHub Actions workflow that comments the governance delta on every pull request and creates facts in CI, and commit and push it.
argument-hint: "[--server-url URL | --no-server] [--console-url URL] [--no-scan] [--no-architecture] [--force]"
disable-model-invocation: true
allowed-tools:
  - Bash(compliify setup ci *)
  - Bash(compliify setup publish *)
---

# compliify setup-ci

Write `.github/workflows/compliify.yml` for this repository: the governance
check on every pull request, then put it into the remote repository. It runs in
observe mode - it comments the governance delta and never fails the build. By
default CI creates facts itself: it scans the changed files and surveys the
whole repository for architecture with headless Claude, using the repository's
own `ANTHROPIC_API_KEY` secret (the tokens are billed to that key), and it sends
the facts to the compliify server. The user started this command, so that is
the yes: do the steps below without asking anything. Flags the user typed after
the command:

> $ARGUMENTS

1. Write it, with their flags where `<flags>` stands:

   ```bash
   compliify setup ci <flags>
   ```

   With no flags the workflow sends the facts to the compliify server,
   `https://compliify.rr42.de`, and scans in CI as described above; do not ask
   for another address and do not ask whether CI should scan. Flags:
   `--server-url <url>` another server; `--no-server` none; `--console-url
   <url>` links another console in the comment; `--no-scan` calls no model in CI
   (the workflow only checks the committed facts, no key needed);
   `--no-architecture` scans the changed files but does not survey the whole
   repository on every run; `--force` overwrites an existing workflow. Only use
   flags the user gave, and never suggest `--force` yourself: it replaces a file
   somebody wrote. If the command says the workflow already exists, leave it,
   say so, and stop after step 2.
2. Show the output as it is. It ends with the next steps - the
   `gh secret set` commands: `COMPLIIFY_TOKEN` (the user creates the token in
   the console on the **Set up** page) and `ANTHROPIC_API_KEY` (their own key),
   each only if the workflow uses it. Those are the user's to run; the secret
   values are theirs. Never ask them to paste a key into the chat.
3. Put the workflow into the remote repository, one plain command, no
   question - writing it was the request:

   ```bash
   compliify setup publish
   ```

   It commits the workflow (and `.compliify/facts.json` once it exists: it is
   what the workflow reads) and nothing else that is staged or changed, and
   pushes the current branch under its own name, not to whatever branch it
   merely tracks. Show its output as it is, including the branch it pushed. If
   it fails it says why and what to do: show that and do not work around it -
   no `git push --force`, no `git commit` or `git push` of your own instead.
   The commit stays local, and running the same command again only pushes.

Run each command as one plain command: a `||`, `&&` or pipe would defeat the
pre-approval and cost the user a permission prompt. Only if the shell then says
`compliify: command not found`, run the same command as
`node "${CLAUDE_PLUGIN_ROOT}/dist/compliify.js" setup ci ...` instead.

Nothing else is changed: no code, no other workflow, no repository settings.

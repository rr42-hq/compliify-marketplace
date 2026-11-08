---
name: setup
description: Guided one-time setup - offer the plugin to your whole team and add the CI workflow. Nothing else is changed.
disable-model-invocation: true
allowed-tools:
  - Bash(compliify setup *)
---

# compliify setup

Two optional chores, one after the other. Recording facts needs neither, and
this skill changes nothing else: no code, no other settings, no secrets.
Go through them in order and ask before each one; the user may skip either.
Show each command's output as it is.

Run each command as one plain command: a `||`, `&&` or pipe would defeat the
pre-approval and cost the user a permission prompt. Only if the shell then says
`compliify: command not found`, run the same command as
`node "${CLAUDE_PLUGIN_ROOT}/dist/compliify.js" setup ...` instead.

## 1. Team: the plugin for everyone who opens this repository

Ask: "Should Claude Code offer the compliify plugin to everyone who opens this
repository? That adds two entries to `.claude/settings.json`, which you then
commit."

If yes, preview it, then write it once they agree:

```bash
compliify setup team --dry-run
compliify setup team
```

- The command merges into an existing file and keeps every other key. If the
  file is not strict JSON (a comment, a trailing comma) the command leaves it
  alone, prints the snippet to add by hand and exits 2: show that snippet and
  do not edit the file yourself.
- Teammates are asked once to trust the folder; after that Claude Code
  installs the plugin for them.
- A fork of the marketplace: `--marketplace-repo owner/repo` and
  `--marketplace-name name`. Only ask if the user mentions one.

## 2. CI: the governance check on pull requests

Ask: "Should I add a GitHub Actions workflow that comments the governance
delta on every pull request?" If yes, ask one more question: does your team
run a compliify server (a URL your admin gave you)? Without one, use no extra
flags. With one, add `--server-url <url>` and, if they have it, `--console-url
<url>`. Whole-repository architecture survey on every run (`--architecture`)
only if they ask: it is slower and uses more API quota.

```bash
compliify setup ci <flags> --dry-run
compliify setup ci <flags>
```

(`<flags>` stands for the flags above, if any.) Preview first, write once they
agree. The command refuses to overwrite an existing workflow; if it says so,
ask before adding `--force`.

The command prints the next steps: the `gh secret set` commands (if the
workflow needs any) and the commit. Tell the user to run those themselves - the secret values are theirs.
Never ask them to paste a key into the chat.

When both chores are done or skipped, say which files changed and remind them
to commit them. Nothing else was touched.

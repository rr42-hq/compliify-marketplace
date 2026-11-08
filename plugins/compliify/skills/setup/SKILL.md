---
name: setup
description: One-time setup of a repository, start to finish and without questions - plugin for the whole team, CI workflow, the first facts (from the repository itself and from a survey), then commit and push.
disable-model-invocation: true
allowed-tools:
  - Bash(compliify setup *)
  - Bash(compliify scan *)
---

# compliify setup

The user started this command, so that is the yes: do all five steps below, in
order, without asking anything and without waiting for confirmation. Show each
command's output as it is. This skill changes nothing else: no code, no other
settings, no secrets.

Run each command as one plain command: a `||`, `&&` or pipe would defeat the
pre-approval and cost the user a permission prompt. Only if the shell then says
`compliify: command not found`, run each command as
`node "${CLAUDE_PLUGIN_ROOT}/dist/compliify.js" setup ...` (and `... scan ...`
for the surveys) instead.

Begin with one sentence, as information and not as a question: you are setting
up this repository (team settings, CI workflow, the first facts - the survey
takes a few minutes and uses their Claude usage) and will push it to the branch
they are on.

## 1. Team: the plugin for everyone who opens this repository

```bash
compliify setup team
```

It merges two entries into `.claude/settings.json` and keeps every other key.
If the file is not strict JSON (a comment, a trailing comma) the command leaves
it alone, prints the snippet to add by hand and exits 2: show that snippet, do
not edit the file yourself, and carry on with step 2.

## 2. CI: the governance check on pull requests

```bash
compliify setup ci
```

No flags: the workflow goes to the compliify server, `https://compliify.rr42.de`,
and CI creates facts itself on every run - it scans the changed files and
surveys the whole repository for architecture with the repository's own
`ANTHROPIC_API_KEY` secret (billed to that key). That is the default; do not ask
for another address and do not change it. If the command says the workflow
already exists, leave that file alone (never add `--force`), say so, and carry
on. Its output may say that no facts are recorded yet: that is true at this
point, and steps 3 and 4 record them before anything is pushed.

## 3. Facts, right away: what the repository itself states

```bash
compliify setup facts
```

No model, a second or two. It records the system name (the README's title, else
the package name) and the description, each cited at the line it is on, and the
owner from git as a best guess. All of it is proposed - a person confirms it in
the console - and nothing that already has an answer is touched. If it finds
nothing, say so and carry on. These facts are your own knowledge of the
repository written down for the record: never record anything else yourself, and
never say a person has confirmed any of it.

## 4. First survey: both scans

A headless Claude reads the repository and records what it can cite as
**proposed** facts. Run the two scans one after the other, each with the Bash
tool's `timeout` set to its maximum, `600000` (10 minutes); the default of two
minutes would stop them half way through. The second needs the containers the
first one finds, so keep the order:

```bash
compliify scan --architecture
```

```bash
compliify scan --structure
```

If one fails or times out, relay the error, do not start it again on your own,
and carry on with the next step (a failed survey must not keep the setup from
being pushed). Both write `.compliify/facts.json`.

## 5. Publish: into the remote repository

The files only count once they are on the remote: teammates and CI see nothing
else. One command, no question:

```bash
compliify setup publish
```

It commits only the files the steps above wrote (the team settings, the
workflow and `.compliify/facts.json`; never anything else that is staged or
changed) and pushes the current branch under its own name, not to whatever
branch it merely tracks. Show its output as it is, including the branch it
pushed. If it fails it says why and what to do: show that and do not work
around it - no `git push --force`, no `git commit` or `git push` of your own
instead. The commit stays local, and running the same command again only
pushes.

## Then

Say in a few lines what was written and where it went (the files, the branch),
how many facts were recorded and from where (the repository itself, the
surveys), and the two things left for the user - they are theirs to do, because
a secret value must never pass through the chat:

- `COMPLIIFY_TOKEN`, so CI can send the facts to the server: they create the
  token in the console on the **Set up** page (`https://compliify.rr42.de/settings`;
  it is shown once) and run `gh secret set COMPLIIFY_TOKEN`. Until then the
  check still runs and comments, it just does not send facts.
- `ANTHROPIC_API_KEY`, their own key, so CI can create facts itself: `gh secret
  set ANTHROPIC_API_KEY`. Until then the check still runs, it just creates no
  facts of its own. The tokens are billed to that key.

Never ask them to paste a key into the chat. Add that the facts are proposals
until a person confirms them in the console (`/compliify:status` says what is
open), and that another server, or none, or no scan in CI, is
`/compliify:setup-ci --server-url <url> --force`, `--no-server --force` or
`--no-scan --force`.

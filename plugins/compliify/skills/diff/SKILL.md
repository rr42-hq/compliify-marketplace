---
name: diff
description: Governance delta of this branch against a base ref - facts added, changed or removed, questions raised, architecture changes.
argument-hint: "[base-ref] [head-ref]"
disable-model-invocation: true
allowed-tools:
  - Bash(compliify diff *)
---

# compliify diff

Show what changed in the recorded governance facts between two git refs. What
the user typed after the command (base ref, then head ref):

> $ARGUMENTS

Run the command with those refs. Without a base ref it compares with where
this branch left the default branch (or with the previous commit when you are
on the default branch); without a head ref it uses `HEAD`:

```bash
# no refs given
compliify diff --format markdown
# refs given: the base, then the head
compliify diff <base> <head> --format markdown
```

Run it as one plain command: a `||`, `&&` or pipe would defeat the
pre-approval and cost the user a permission prompt. Only if the shell then says
`compliify: command not found`, run
`node "${CLAUDE_PLUGIN_ROOT}/dist/compliify.js" diff --format markdown`
instead.

- Give the user the output as it is, including the architecture block and its
  diagram when there is one. Do not summarise or re-rank the changes.
- The diff compares the fact files as **committed** at the two refs. If the
  user is looking for a change they have not committed yet, say so:
  `.compliify/facts.json` has to be committed first.
- "No governance-relevant changes." is a complete answer.
- An unknown ref is reported by the command; relay that message and ask for
  the right ref.

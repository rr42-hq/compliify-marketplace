---
name: interview
description: Ask the developer open governance questions conversationally (at most two per session, only ones they can answer) and record their answers via the compliify MCP submit_fact tool. Use when the session context lists open governance questions and the user is at a natural pause, or when the user asks about compliance status.
---

# Governance interview

compliify keeps a list of **open governance questions** - registered fact
keys with no confirmed answer yet. Your job is to close them without ever
getting in the developer's way.

## Who can answer what

Every question has an `answerer`:

- `developer` - the answer is in the code or the infrastructure: which model
  provider, where the data is sent, whether there is a sign-in. Ask the user.
- `compliance` - the answer is an organisational or legal decision: purpose,
  legal basis, retention period, who is accountable, whose data it is. A
  developer usually cannot know it. In the session context these questions are
  tagged `(compliance owner)`.

Ask the `developer` questions first. Ask a `compliance` question only when the
user says they are that person (data protection or compliance owner, the
accountable owner) or offers to answer it. Otherwise leave it: it stays open
for the compliance owner, who answers it in the console. Never work out a
compliance answer from the code ("we keep logs, so retention is 30 days") and
never press a developer to answer one.

## When to ask

- Only at a **natural pause**: the user just finished a task, asked about
  compliance, or explicitly invited questions. Never interrupt active work.
- At most **two questions per session**. If more are open, pick the two
  most consequential developer questions (data > behavior > context >
  controls > identity). Questions about architecture elements (keys starting
  `arch.`) are developer questions too, but come after the governance ones;
  use the `architecture` skill for them.
- Fetch the agenda with the compliify MCP tool `get_open_questions`. It lists
  the developer questions first and gives each entry its `label`, `question`,
  `why`, `answerer`, and for closed questions the allowed `options`.

## How to ask

- Conversational, one at a time, in the user's language. Use the entry's
  `question`, and when it helps add the `why` in a few words ("this decides
  whether a transfer mechanism is needed").
- For a closed question offer the option **labels** as concrete choices, e.g.:
  "Quick governance question - where does the data this app processes end up:
  EU / EEA, United States, or another country?" Do not read raw values aloud.
- Translate the user's phrasing into the option **value** yourself ("we host
  on AWS Frankfurt" → `eu`) and submit the value, not the label. Confirm the
  mapping if it is not obvious. A question with `input: "multi"` takes
  several options.
- A free-text question (`input: "text"`) takes the user's own short words; the
  entry's `example` shows the style that is wanted.
- If the user is unsure, leave the question open - do NOT guess and do NOT
  submit a placeholder. Uncertainty is a valid state; say you'll leave it
  for later.

## How to record

- Submit each answer with the MCP tool `submit_fact` (`key`, `value`).
  The fact is recorded as `stated` + `confirmed`, attributed to the user's
  git identity. Never edit `.compliify/facts.json` directly.
- If `submit_fact` rejects the value, re-check the allowed values from
  `get_open_questions` and re-map the answer - don't ask the user to speak
  enum.
- Briefly confirm what was recorded in plain words ("Noted: data stays in the
  EU / EEA").

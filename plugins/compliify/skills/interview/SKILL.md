---
name: interview
description: Ask the developer open governance questions conversationally (at most two per session) and record their answers via the compliify MCP submit_fact tool. Use when the session context lists open governance questions and the user is at a natural pause, or when the user asks about compliance status.
---

# Governance interview

compliify keeps a list of **open governance questions** — registered fact
keys with no confirmed answer yet. Your job is to close them without ever
getting in the developer's way.

## When to ask

- Only at a **natural pause**: the user just finished a task, asked about
  compliance, or explicitly invited questions. Never interrupt active work.
- At most **two questions per session**. If more are open, pick the two
  most consequential (data > behavior > context > controls > identity).
- Fetch the agenda with the compliify MCP tool `get_open_questions` —
  it returns each key, its question, and its allowed values.

## How to ask

- Conversational, one at a time, in the user's language. Offer the allowed
  values as concrete options, e.g.: "Quick governance question — where does
  the data this app processes end up: EU, US, or somewhere else?"
- Translate the user's phrasing into the allowed enum value yourself
  ("we host on AWS Frankfurt" → `eu`). Confirm the mapping if it is not
  obvious.
- If the user is unsure, leave the question open — do NOT guess and do NOT
  submit a placeholder. Uncertainty is a valid state; say you'll leave it
  for later.

## How to record

- Submit each answer with the MCP tool `submit_fact` (`key`, `value`).
  The fact is recorded as `stated` + `confirmed`, attributed to the user's
  git identity. Never edit `.compliify/facts.json` directly.
- If `submit_fact` rejects the value, re-check the allowed values from
  `get_open_questions` and re-map the answer — don't ask the user to speak
  enum.
- Briefly confirm what was recorded ("Noted: data stays in the EU").

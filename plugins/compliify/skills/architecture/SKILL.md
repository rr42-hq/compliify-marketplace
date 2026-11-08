---
name: architecture
description: Show, explain and correct the architecture diagram compliify draws from the repository's facts (components, data flows, where personal data leaves the system). Use when the user asks for an architecture or data-flow diagram, what talks to what, where their data goes, which third parties or AI models the app uses, or when the session context mentions architecture elements that need attention.
---

# Architecture view

compliify draws a UML-style picture of the system - components (boxes) and
the data flows between them (arrows) - **from facts**, the same way the
Art. 30 record is rendered. Nothing in it is invented: every box and arrow is
an `arch.*` fact with a `file:line` source, a provenance and a review status.
What the facts do not say is drawn as unknown. Your job is to show it,
explain it, and help the user correct it - never to redraw it from memory.

## When to use

- The user asks for an architecture, component or data-flow diagram, or
  "what does this app talk to", "where does our data go", "which AI models and
  third parties do we use".
- The user is preparing a review, a DPIA or an Art. 30 conversation and needs
  the picture.
- The session context says the architecture has elements that need attention
  (`Architecture: 7 components, 11 flows, 2 need attention - ask for it with
  get_architecture`) and the user is at a natural pause.

## Fetch the diagram

1. Call the compliify MCP tool `get_architecture`. The default `text` format
   is an outline for you to read: components inside and outside the system,
   the flows with their data categories, and a "Needs attention" list. Use
   `format: "mermaid"` when the user wants the diagram source to paste into
   a README, a wiki or a Mermaid viewer.
2. For a file, run the CLI (the plugin puts `compliify` on the Bash tool's
   PATH):

   ```bash
   compliify diagram --format markdown --out docs/architecture.md
   compliify diagram --format plantuml     # formats: mermaid|plantuml|markdown|text|json
   ```

   Run it as one plain command, without `||`, `&&` or a pipe. Only if the
   shell then says `compliify: command not found`, run the same command as
   `node "${CLAUDE_PLUGIN_ROOT}/dist/compliify.js" diagram ...` instead.

   Above roughly 20 components the Mermaid layout gets crowded (arrows cross
   boxes, labels overlap). Prefer `--format plantuml`, `--format text` or the
   tables in `--format markdown` for such systems, or `--direction TB`.
3. No architecture facts yet? Say so plainly and offer the first survey, which
   the user starts with `/compliify:scan` (the command is
   `compliify scan --architecture`; give the Bash tool a `timeout` of 600000).
   It runs a headless Claude over the repository (minutes, uses their API
   quota) and records what it finds as **proposed** facts. Ask before running
   it; never start it on your own.

If a tool or command fails, report the error as it is. Do not substitute a
diagram you worked out yourself from the code.

## Explain it to a non-engineer

Lead with the picture in one or two sentences, then the points that matter
to a data-protection or risk reader. Plain language, their system's own
names, no jargon.

- **Boundary.** Boxes "inside" are what the team builds and runs (apps,
  workers, databases, queues). Gray boxes are "outside": people (actors),
  third-party services and AI models reached over the internet.
- **Arrows** show which way data travels; the label says which kinds of data
  (personal data, user content, technical data, ...) and over which protocol.
- **Colors.** Solid arrow = confirmed by a person; dotted = found by the
  scan, not yet confirmed. Amber = personal data. Red = personal data going
  to a non-EU or unknown region. Violet = something the facts do not say yet.
  Dashed outline = proposed element.
- **Start with attention items**, most important first: personal data to an
  outside service with a US, other or unknown region; datastores and outside
  services with no region; flows with unknown data; elements whose cited
  file no longer exists; proposed removals.
- Say what is **proposed** versus **confirmed**. A proposed element is the
  scan's reading of the code, not a verified fact.
- Frame findings as "worth a conversation with whoever handles data
  protection", not as legal conclusions. compliify runs in observe mode.

Example: "Your app has 7 parts. Customer ticket text goes from the API to the
Anthropic API, whose region is not recorded, and the scan could not tell
whether that text contains personal data - that arrow is marked 'data
unknown'. Your Postgres database has no region recorded yet."

## Correct an element

Corrections are `stated` + `confirmed` facts attributed to the user's git
identity. Use the MCP tool `submit_fact` with the architecture key and a
**partial object**; it is merged over the current value, so only the changed
attributes are needed.

| Key | Example value | Meaning |
| --- | --- | --- |
| `arch.component.postgres` | `{"region":"eu"}` | the database runs in the EU |
| `arch.component.api` | `{"kind":"worker"}` | it is a worker, not a service |
| `arch.flow.api.anthropic` | `{"data":["user_content","personal"]}` | what the arrow carries |
| `arch.component.sendgrid` | `{"removed":true}` | the element no longer exists |

Rules:

1. Fetch first (`get_architecture`) so the key and ids are exact. Component
   key: `arch.component.<id>`; flow key: `arch.flow.<from>.<to>`. Ids are
   kebab-case and contain no dots.
2. Translate the user's words yourself ("we host in Frankfurt" → `eu`) and
   **state back exactly what you are about to record**, e.g. "I'll set the
   region of Postgres to EU - correct?". Submit only after they agree.
3. Allowed values: kinds `actor`, `frontend`, `service`, `worker`, `job`,
   `cli`, `datastore`, `queue`, `external_service`, `ai_model`; regions `eu`,
   `us`, `other`, `unknown`; data categories `personal`, `special_category`,
   `financial`, `health`, `location`, `behavioral`, `user_content`,
   `technical`, `none`.
4. `data` is replaced as a whole, not merged item by item: to add a category,
   send the complete list. A partial object cannot delete an attribute. To
   take back a wrong `region`, submit `{"region":"unknown"}` (it is drawn as
   "region unknown", and the user's answer is recorded in the repository). A
   wrong `data` list can only be replaced by the right one. Do not send the
   user to the review console for this: a value changed there is not in the
   repository's `facts.json`, so the next CI ingest or scan can bring the old
   value back.
5. If the user is unsure, leave it open - do not record a guess or a
   placeholder. A removal (`removed: true`) needs the user's explicit "yes,
   that is gone".
6. After `submit_fact` succeeds, confirm what was recorded in one line. If it
   rejects the value, re-check the allowed values above and re-map; do not
   ask the user to speak JSON.
7. A user may also tell you about an element the scan missed ("we also send
   mail through Mailgun"). That is theirs to state: submit the full object
   (`{"kind":"external_service","name":"Mailgun"}`) with the same
   read-back-and-agree step. Never add one on your own.

Corrections made with `submit_fact` are written to `.compliify/facts.json`;
remind the user to commit it, because that is what keeps them. A later scan
or Stop-hook run never replaces a confirmed kind, region or data set (see
"When the code disagrees with a confirmed value" below).

To confirm an element as drawn without changing it, the user can use the
review queue in the console; do not submit values just to flip a status.

## When the code disagrees with a confirmed value

The extraction (Stop hook, `scan`) never changes a value a person confirmed.
When the code shows something else, the hook or scan message contains `N
confirmed value(s) contradicted by code - ask the user which is right: slack
region eu vs us (services/notify.py:57)`. That is also the case when the code
shows a region or data the confirmed value does not state.

- Tell the user in plain words what is recorded, what the code shows and
  where, and ask which is right. Do not decide for them and do not change the
  fact yourself. If they say the code is right, record it with `submit_fact`
  after the usual read-back.
- This contradiction is **not** kept as an open question (the store drops
  questions for confirmed keys), so it will not come back in
  `get_open_questions`. It is repeated by the next full
  `scan --architecture`; if the user wants to leave it for later, say so.
- Data categories of an existing flow are only ever added by extraction, never
  dropped. If the user says a category is wrong, replace the whole list with
  `submit_fact`.

## Removals

Removals are best effort. An element whose cited file is gone is shown as
"source not found" (this needs no model) and the extraction may additionally
propose it as removed: it then stays drawn, flagged "removal proposed", until
the user confirms it. Do not tell the user an element is gone because the
model proposed its removal, and do not submit `{"removed":true}` without
their explicit yes. A file deleted with a shell `rm` is only noticed when the
hook runs anyway; if the user deleted things outside the session, suggest
`scan --architecture` (after asking).

## Architecture open questions

- The first survey may leave open questions about an element
  (`arch.component.<id>` or `arch.flow.<from>.<to>`). They appear in
  `get_open_questions` with the question text and the evidence to look at;
  the interview rules apply (natural pause, at most two per session, one at
  a time, user's language).
- When the user has explicitly asked for an architecture review, you may
  work through the "Needs attention" list one item at a time instead.
- The typical questions: "Which region does X run in?", "Which kinds of
  data does the flow from A to B carry?", "Is this component still in use?".
  Offer the allowed values as options, record the answer with `submit_fact`
  as above, and leave the item open if the answer is "not sure".

## What NOT to do

- Do not edit `.compliify/facts.json` by hand, and do not delete facts.
- Do not invent components, flows, regions or data categories, and do not
  fill gaps with what "is probably the case". Unknown stays unknown.
- Do not draw your own diagram or restate the architecture from reading the
  code; use the tool output so the picture stays deterministic.
- Do not present proposed elements as confirmed, or call a gap a compliance
  violation.
- Do not run `scan --architecture` without the user's go-ahead.
- Do not paste a large Mermaid source into chat when a file or the console
  works; do not change code to "fix" a diagram - the diagram follows the
  code, not the other way round.

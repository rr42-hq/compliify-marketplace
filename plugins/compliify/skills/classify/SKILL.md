---
name: classify
description: Help the user classify their AI system's data categories, decision effect, and risk posture for governance purposes. Use when the user asks how to classify data, whether something counts as personal or special-category data, what decision effect their system has, or how risky their setup is.
---

# Classifying an AI system

Help the user place their system correctly in compliify's vocabulary. Be
concrete, use their own system as the example, and record conclusions via
the MCP tool `submit_fact` (with their confirmation) - never guess and never
edit `.compliify/facts.json` directly.

## Data categories (`data.categories`, `data.special_category`)

- `personal` - any information relating to an identified or identifiable
  person: names, emails, IDs, IP addresses, free-text that users type about
  themselves. When in doubt whether data is personal, it usually is.
- `special_category` - Art. 9 DSGVO data: health, biometrics used for
  identification, religious or political beliefs, sexual orientation,
  ethnicity, trade-union membership. If present, also set
  `data.special_category = yes` - this raises the compliance bar sharply.
- `financial`, `health`, `location`, `behavioral`, `user_content`,
  `technical` - use all that apply; `none` only for systems that genuinely
  touch no such data (rare).
- Remember indirect flows: prompts sent to a model API, logs, analytics and
  error tracking all count as processing.

## Decision effect (`context.decision_effect`)

Ask: what happens to a person because of this system's output?

- `none` - output never concerns people (e.g. code formatting).
- `minor` - convenience effects: ranking, suggestions a human freely
  overrides.
- `significant` - real consequences: prioritising applicants, pricing,
  account restrictions, content takedowns.
- `legal_or_similar` - legal effects or similarly significant ones: hiring
  or credit decisions, contract termination, benefit eligibility. Maps to
  Art. 22 DSGVO: if the system decides **solely automatically**, safeguards
  (human intervention, contestability) are mandatory.

## Risk posture (autonomy × oversight)

- `behavior.autonomy`: `assistive` (suggests, human acts) → `supervised`
  (acts with approval) → `autonomous` (acts alone). Classify by what the
  code actually does, not the intention.
- `behavior.human_in_loop`: `always` / `sometimes` / `never` - does a human
  review outputs **before** they take effect?
- The risky quadrant is `autonomous` + `significant`/`legal_or_similar`
  effect - compliify's `danger.autonomy` rule flags exactly that. Reducing
  either axis (add approval, reduce effect) moves the system out of it.

## EU AI Act risk tier (`context.ai_act_risk`)

The Act sorts AI systems by what they are used for. Help the user place theirs,
but the decision is theirs - it is a legal judgement, so never pick the tier for
them and never record one they have not stated. If they are unsure, say that a
lawyer or the company's AI-governance owner should decide, and leave it open.

- `prohibited` - a practice the Act bans outright (Art. 5), for example
  manipulative techniques that cause harm, social scoring, untargeted scraping
  of facial images, emotion recognition at work or in education. A system in
  this tier must not be run as it is.
- `high` - listed use cases (Art. 6, Annex III): e.g. recruitment and candidate
  ranking, credit scoring, access to education or essential services, biometric
  identification, safety components of regulated products. These carry
  requirements such as human oversight (Art. 14) and logging (Art. 12); compliify
  checks both against `behavior.human_in_loop` and `controls.logging`.
- `limited` - systems with transparency duties (Art. 50): chatbots that must say
  they are AI, synthetic media that must be labelled.
- `minimal` - everything else, e.g. internal developer tooling, spam filters.
- `unknown` - not yet assessed (the same as leaving it open).

Ask what the system is **used for** and whom it affects, not what model it
runs. The same model can sit in different tiers depending on the use.

## Recording

Once the user settles on a classification, confirm the exact enum value and
record it with `submit_fact`. If they remain unsure, leave the question open
rather than recording a guess.

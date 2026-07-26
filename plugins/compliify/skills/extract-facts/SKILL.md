---
name: extract-facts
description: Extract governance facts about an AI system from repository code, with file:line citations. Used by compliify's automated extraction after coding sessions; also applies when the user explicitly asks to extract or update governance facts from the code.
---

# Extracting governance facts

You are extracting **governance facts** about an AI system from its source
code. A fact is an atomic, typed assertion (e.g. `data.egress_region = us`)
that feeds a compliance record. Facts you propose land in a review queue —
a wrong fact poisons the governance record, a missing fact merely becomes an
open question a human answers later. Therefore:

## The never-guess rule

- Propose a fact ONLY if you can point at concrete evidence in a file.
- If you are not sure, DO NOT propose the fact. **Omitting is correct** —
  the key becomes an open question for a human. Guessing is forbidden.
- Never propose the value `"unknown"` — omit the fact instead.
- Never propose provenance `"stated"` — that is reserved for humans
  answering via the compliify MCP tool `submit_fact`.

## Output contract

- Propose facts ONLY for registered fact keys (the registry table in the
  prompt lists every key with its allowed values). Anything else is rejected.
- Every fact has exactly these fields:
  - `key` — a registered fact key.
  - `value` — must match the key's allowed values EXACTLY (enum member,
    or array of enum members, or bounded free text as listed).
  - `provenance` — `"detected"` or `"inferred"` (rules below).
  - `source` — a `file:line` citation (e.g. `src/llm.ts:12`). Required;
    a fact you cannot cite is a fact you must not propose.
  - `confidence` — `"high"`, `"medium"`, or `"low"`.
- Propose **at most 10 facts per run**.
- Propose ONLY facts that are **new** (no current active fact for the key)
  or that **contradict** a current active fact (different value backed by
  evidence). Never restate a fact already recorded with the same value.

## Provenance rules

- `detected` — the value is literally present at the cited line: an SDK
  import, a model id string, a region in a config, a hard-coded key.
  Confidence is usually `high`.
- `inferred` — the value follows from cited evidence via one reasoning
  step (e.g. `@anthropic-ai/sdk` import with the default base URL means
  data leaves to a US-hosted API → `data.egress_region = us`). Cite the
  evidence line; confidence `medium` or `low`.

## Signal → key table

| Signal in the code | Fact key | Typical value |
| --- | --- | --- |
| `@anthropic-ai/sdk`, `openai`, `google-generativeai`, `mistralai` imports | `model.provider` | `anthropic` / `openai` / `google` / `mistral` |
| Model id strings (`claude-…`, `gpt-…`, `gemini-…`) | `model.model_id` | the literal id |
| Vendor API client vs. local inference (ollama, llama.cpp, vllm) | `model.hosting` | `api` / `self_hosted` / `on_device` |
| API base URLs, region configs, telemetry endpoints | `data.egress_region` | `us` / `eu` / `other` |
| Schema/model fields like email, name, address, phone, userId | `data.categories` | `["personal", …]` |
| Health, biometric, religious or political data fields | `data.special_category` | `yes` |
| Payment, IBAN, invoice fields | `data.categories` | includes `financial` |
| Auth middleware, session checks, OAuth/SSO config | `controls.auth` | `sso` / `oauth` / `password` / `api_key` / `none` |
| Logger setup, audit tables, request logging | `controls.logging` | `none` / `basic` / `audit` |
| Hard-coded API keys, tokens, passwords in the source | `controls.secrets_in_code` | `yes` |
| Encryption-at-rest configuration | `controls.encryption` | `yes` / `partial` / `no` |
| Redaction/pseudonymisation before model calls | `controls.pii_redaction` | `yes` / `partial` / `no` |
| Cron/queue-triggered actions applied without approval | `behavior.autonomy` | `autonomous` |
| Approval steps or review UIs before outputs take effect | `behavior.human_in_loop` | `always` / `sometimes` |
| The kind of output produced (text, decision, executed action) | `behavior.output_type` | `text` / `decision` / `action` / … |
| README / package description of what the app does | `identity.description`, `context.purpose` | short free text |

## Method

1. Read the changed files listed in the prompt (you have Read, Grep, and
   Glob only — you cannot and must not modify anything).
2. Follow imports/config only as far as needed to pin a value down.
3. Compare candidates against the current active facts in the prompt; keep
   only new or contradicting facts.
4. Emit the facts via the structured output schema. No prose, no summary —
   the structured output is the entire result.

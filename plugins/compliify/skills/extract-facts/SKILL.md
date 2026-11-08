---
name: extract-facts
description: Extract governance facts and architecture elements (components and data flows) about an AI system from repository code, with file:line citations. Used by compliify's automated extraction after coding sessions and by the full architecture survey; also applies when the user explicitly asks to extract or update governance facts from the code.
---

# Extracting governance facts

You are extracting **governance facts** about an AI system from its source
code. A fact is an atomic, typed assertion (e.g. `data.egress_region = us`)
that feeds a compliance record. Facts you propose land in a review queue -
a wrong fact poisons the governance record, a missing fact merely becomes an
open question a human answers later. Therefore:

## The never-guess rule

- Propose a fact ONLY if you can point at concrete evidence in a file.
- If you are not sure, DO NOT propose the fact. **Omitting is correct** -
  the key becomes an open question for a human. Guessing is forbidden.
- Never propose the value `"unknown"` - omit the fact instead.
- Never propose provenance `"stated"` - that is reserved for humans
  answering via the compliify MCP tool `submit_fact`.
- Never record a negative value (`no`, `none`, `false`: e.g.
  `controls.secrets_in_code`, `controls.encryption`, `controls.pii_redaction`)
  from one file, an example config or an empty `.env.example` entry. A
  negative needs a repo-wide Grep you ran, cited at the config or code that
  shows the absence; otherwise omit the fact. Cite the line that states the
  claim, not a nearby docstring.
- Never propose `context.ai_act_risk` (the EU AI Act risk tier). It is a legal
  classification a person makes, not something code shows, and the proposal
  schema does not accept it. If the code bears on it (it ranks job applicants,
  scores credit, runs biometric identification, interacts with children),
  raise an open question for that key instead: summarise what the code does and
  cite the file and line, and say nothing about which tier applies.
- `model.*` facts need an SDK call, a model id or an inference runtime in the
  cited line. A class named `Server` is not a model host; an MCP server or
  plugin that makes no model call has no `model.*` facts.

## Output contract

- Propose facts ONLY for registered fact keys (the registry table in the
  prompt lists every key with its allowed values). Anything else is rejected.
  Architecture elements are the one separate channel: they go in the
  `architecture` section, never in `facts` (see "Architecture" below).
- Every fact has exactly these fields:
  - `key` - a registered fact key.
  - `value` - must match the key's allowed values EXACTLY (enum member,
    or array of enum members, or bounded free text as listed).
  - `provenance` - `"detected"` or `"inferred"` (rules below).
  - `source` - a `file:line` citation (e.g. `src/llm.ts:12`). Required;
    a fact you cannot cite is a fact you must not propose.
  - `confidence` - `"high"`, `"medium"`, or `"low"`.
- Propose **at most 10 facts per run** (architecture entries have their own
  limits and do not count against these 10).
- Propose ONLY facts that are **new** (no current active fact for the key)
  or that **contradict** a current active fact (different value backed by
  evidence). Never restate a fact already recorded with the same value.

## Provenance rules

- `detected` - the value is literally present at the cited line: an SDK
  import, a model id string, a region in a config, a hard-coded key.
  Confidence is usually `high`.
- `inferred` - the value follows from cited evidence via one reasoning
  step (e.g. a compose service running the `ollama` image means
  `model.hosting = self_hosted`). Cite the evidence line; confidence
  `medium` or `low`.

## Signal → key table

| Signal in the code | Fact key | Typical value |
| --- | --- | --- |
| `@anthropic-ai/sdk`, `openai`, `google-generativeai`, `mistralai` imports | `model.provider` | `anthropic` / `openai` / `google` / `mistral` |
| Model id strings (`claude-…`, `gpt-…`, `gemini-…`) | `model.model_id` | the literal id |
| Vendor API client vs. local inference (ollama, llama.cpp, vllm) that the code itself calls or runs | `model.hosting` | `api` / `self_hosted` / `on_device` |
| Region configs and region-specific hostnames (`eu-central-1`, `eu.i.posthog.com`); a vendor's default endpoint alone is not evidence (see Region rules) | `data.egress_region` | `us` / `eu` / `other` |
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

## Architecture

Besides facts, you record the system's **architecture**: its components
(boxes) and the data flows between them (arrows). compliify draws the
diagram from these entries, so the never-guess rule applies to every box
and every arrow: **an element or attribute you cannot cite is omitted, and
the diagram shows it as unknown.** Put them in the `architecture` section
of the structured output (`components` and `flows`); omit the section when
the code shows nothing new.

### Component entries

| Field | Rule |
| --- | --- |
| `id` | Required. kebab-case, `^[a-z0-9][a-z0-9_-]{0,39}$`, no dots. Reuse an id from "Current architecture" when the element is already listed. |
| `kind` | Required. One of `actor`, `frontend`, `service`, `worker`, `job`, `cli`, `datastore`, `queue`, `external_service`, `ai_model`. |
| `name` | Required. Human-readable, at most 80 characters ("Support API", "Anthropic API"). |
| `tech` | Optional, at most 60 characters ("Fastify 5", "Postgres"). Omit unless the code or a manifest names it. |
| `region` | Optional: `eu`, `us` or `other`. Omit unless evidenced (rules below). |
| `removed` | Only the literal `true`: a tombstone (rules below). |
| `provenance`, `source`, `confidence` | Required, exactly as for facts. |

Inside the system boundary: `frontend`, `service`, `worker`, `job`, `cli`,
`datastore`, `queue`. Outside: `actor` (a person or role), `external_service`
(a third-party SaaS or API), `ai_model` (a model reached as a vendor API).
A model the system hosts itself (ollama, vllm, llama.cpp) is a `service`,
not an `ai_model`. A database the system runs or rents as its own store
(Postgres on Railway or RDS, Supabase tables) is a `datastore`.

`cli` is only for command-line entry points built from this repository's own
code. A third-party program the system spawns (an agent or model CLI, ffmpeg,
git) is an `external_service`, even when it runs on the same machine:
everything handed to it leaves the system's own code. `actor` is only a human
or a role. Software that calls the system or receives its data (an AI
assistant acting as an MCP/API client, a webhook sender, an integrated app) is
never an `actor`: it is an `external_service` when another organisation
operates it, a `service` only when the repository's docs show the same
operator runs it, and `external_service` when they do not say - a data
recipient must never be hidden as inside or as a person. `ai_model` covers any
modality: language, speech, vision/OCR, embeddings, moderation, translation.

### Flow entries

| Field | Rule |
| --- | --- |
| `from`, `to` | Required component ids, `from` different from `to`. The arrow points the way the data travels. One flow per ordered pair; if data moves both ways, add the second flow when the code shows it: a handler that returns a report, export or tool result to a named client IS the second flow. |
| `data` | Optional list of 1 to 9 unique categories: `personal`, `special_category`, `financial`, `health`, `location`, `behavioral`, `user_content`, `technical`, `none`. Derive it as described in "Deriving `data`" below. Absent means "data unknown", which the diagram shows honestly; a guessed list is worse than none. Never an empty list. |
| `protocol` | Optional, at most 40 characters (`https`, `http`, `sql`, `grpc`, `smtp`, `stdio`, `child process`). Use `https` only when the cited line, a config/env default, README or example file shows an https URL, or the call goes through a vendor SDK with its default endpoint. For a call to one of the system's own services whose base URL comes from an environment variable, find the default or example value (README env table, `.env.example`, start script, compose file) and use its scheme (`http` for localhost, `127.0.0.1` and private-network hosts); if none is found, omit `protocol`. Never copy `https` onto an internal call by habit. |
| `removed` | Only the literal `true`: a tombstone. |
| `provenance`, `source`, `confidence` | Required. |

A flow must cite **the line where the data actually moves**: for an outbound
flow the call or query itself (`fetch`, `client.get`, `db.insert`,
`execFile`), not the line that constructs the client; for an inbound flow
(webhook, ingest, machine-to-machine, admin, public page) the route decorator
or handler line; for the response flow back to the caller the line that
builds or returns the body (`return`, `reply.send`, `res.json`), not the
decorator, which only proves the inbound flow, and the caller is the same
component as on the inbound flow (never a second one for the response); for a job → datastore flow the query inside the job's
function, never the line that schedules the job. An import, type, env-var
read, config key, `.env.example` or README line, route mount, or table/schema
definition shows that a thing exists, not that data moves. If that is all you
have, Grep for the route or call first; if it is still all you have, cite it,
use `inferred` with `medium` or `low`, and omit `data`. `detected` requires
the cited line to be the call, query, publish, handler or spawn itself; a
literal `fetch`, `execFile` or `client.query` line is `detected`. A component
cites the line that declares it (import, compose service, manifest
dependency, entry point); an actor cites the login screen, route guard, role
check, page, command or hook that proves the role, never an auth-library
import. Cite code or configuration, not a comment or the first line of a
file, whenever a code line exists; a comment is acceptable only when nothing
else shows the thing (then `inferred`, `low`). Every endpoint of a flow needs
a component: reuse an id from "Current architecture" or propose the component
in the same run; otherwise the arrow is drawn to a "⚠ undescribed
component".

`source` is one repo-relative `file:line` (`src/llm.ts:21`), never an
absolute path, and the line must exist in a file you read.

Entries have exactly the fields above. Any other field (such as a
`description`) makes the entry invalid and it is dropped.

### Deriving `data`

"Omit when unknown" is for payloads you looked at and could not read, not for
payloads you did not look at. For each flow, open the call site and read
about 30 lines around it (for an inbound route also the request model or
handler body; for a datastore the schema it writes). Any one of these sets a
category; when the evidence is a field or schema line rather than the call
line, cite that line as `source` (`inferred`, `medium` or higher):

- Field names in a dict, JSON, form, query string, header, request model or
  table column: user id, `email`, `name`, `phone`, address, ip -> `personal`;
  free text typed or uploaded by a person, message bodies, prompts built from
  file contents, documents -> `user_content`; event or usage rows about a
  person (`read_at`) -> `behavioral`; amounts, IBAN, invoices -> `financial`.
- Identity claims (`sub`, `name`, `email`) read from a token or userinfo
  response, or a bearer/session token forwarded for a signed-in person ->
  `personal`.
- Operational payloads with no person fields (status, metrics, error
  reports, DNS records, rule packs, manifests, version fetches, build
  artifacts) -> `technical`.
- A request with no body, query string or user-carrying header (health
  check, heartbeat, public lookup) or delivery of static files -> `none`;
  cite the call line.

A flow may carry several categories. Omit `data` only when you read the
payload and cannot tell what it holds, or cannot find where it is built;
never fill it from a vendor's name or from what a service "probably"
receives. Stay consistent: if a fact or open question you emit says the
system processes personal data via a component, the flows to that component
carry that category whenever the evidence is in files you read.

### Signal → element table

| Signal in the code | Element | Flow |
| --- | --- | --- |
| LLM SDK import or call: `@anthropic-ai/sdk`, `openai`, `@google/genai`, `google-generativeai`, `mistralai`, `cohere`, `groq-sdk`; or a speech, vision/OCR, embedding or moderation vendor API (a `model`/`model_id` parameter in the request) | `ai_model`, vendor id (`anthropic`, `openai`, `google-ai`, `mistral`, …) | the calling component → the model; `data` from what goes into the prompt, text, audio or image |
| Local inference: ollama, llama.cpp, vllm, a self-hosted model server | `service` | caller → that service |
| Spawns a program: `execFile`, `spawn`, `subprocess.run`, `Popen`, `exec`, a workflow `run:` step that invokes a tool | `external_service` for the program (never `cli`) | caller → program, `protocol` `child process`; `data` from the arguments and inputs you can see (prompt text, files it may read). If the same code passes it a vendor API key or model flag (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `--model`), also program → that vendor's `ai_model`, `inferred`, `medium`, citing the line that passes the key or model: the vendor receives what the program was handed |
| `action.yml` / `action.yaml` (composite, node or docker GitHub Action), reusable workflows (`workflow_call`) | `job` (named after the action) | job → each service its steps call (`curl`, `gh api`, `fetch`, installs, spawned tools), and job → the system's own API when a step POSTs data there |
| Code that writes and later re-reads a file or directory the product owns: `fs.writeFile`/`rename`, lockfiles, `~/.<app>/`, `.<app>/` in the user's repo, a SQLite or JSON store | `datastore` (`tech`: `JSON file`, `SQLite`; name the path pattern) | the writing component → the store; store → its reader only when the code shows the read |
| Plugin, hook, extension or tool-server manifests: `hooks.json`, `.mcp.json`, `plugin.json`, extension `manifest.json`, `package.json` `bin` | the host application that invokes them, as `external_service` | host → our component (`protocol` as the manifest states: `stdio`, `command hook`) |
| Deploy, seed, migration or publish scripts (`scripts/`, `Makefile`, `package.json` `scripts`) that open a datastore or push to a remote | `cli` or `job` | script → datastore or remote |
| DB client, ORM, schema or migrations: `pg`, `drizzle`, `prisma`, `sqlalchemy`, `mongoose`, `*.sql`, `schema.prisma` | `datastore` (`postgres`, `mysql`, `mongodb`, `sqlite`, …) | the code that queries → the datastore; `data` from the columns/fields written |
| Cache or key-value client (`redis`, `ioredis`) | `datastore` (`redis`) | the code that uses it → the store |
| Object storage: `@aws-sdk/client-s3`, `boto3`, GCS client | `datastore` (`s3`, `gcs`) | uploader → bucket |
| Queue or broker: `bullmq`, `sqs`, `kafka`, `rabbitmq`, `celery`, pub/sub | `queue` | producer → queue, queue → consumer |
| `docker-compose.*`, `compose.*`, `Dockerfile`, `railway.json`, `fly.toml`, `Procfile`, `serverless.yml`, `vercel.json` | one `service` per deployable process (`web`, `api`); `worker` for background consumers (`Procfile` `worker:`); images such as `postgres:16` are `datastore` | between the processes that call each other |
| `.github/workflows/*.yml` that deploy, run on a schedule, or call outside services (not lint/test-only) | `job` | only if the workflow sends data somewhere |
| Cron / scheduler (`node-cron`, `schedule`, `cron:`) | `job` or `worker` | job → what it reads or calls |
| UI app (Next.js `app/` or `pages/`, React entry, `index.html`, a static site whose pages load scripts); server-rendered pages (`templates/`, `views/`, Jinja2/ERB/Blade, `HTMLResponse`, `res.render`, an inline `<script>` that calls the API or loads an auth provider's JS) | `frontend` | audience actor → frontend; frontend → the API or provider its script calls (calls the browser makes start at the `frontend`, never at the `actor`) |
| CLI entry point of this repository's own code (`bin` in `package.json`, argparse, commander) | `cli` | cli → what it calls |
| HTTP client calls (`fetch`, `axios`, `requests`, `httpx`) to a third-party host | `external_service` (vendor id) | caller → vendor, `protocol` `https` |
| Inbound webhook route (signature check, `/webhooks/stripe`) | the vendor as `external_service` | vendor → the handling component |
| Routes guarded by a shared token, API key or service credential (`Depends(require_...)`, `Authorization: Bearer`, `X-Api-Key`, an HMAC check) | the caller as `external_service` (or `actor` if a person), named as docs or config name it; one component per distinct documented sender, even when its code is not in this repo | caller → handler, and handler → caller when the route returns a report, export or API payload to that client |
| Auth provider: `@clerk/*`, `auth0`, `next-auth`, supabase auth, `firebase/auth` | `external_service` (`clerk`, `auth0`, …) | app → provider; `personal` only if the code passes identity fields |
| Payments, email/SMS, analytics, error tracking: `stripe`, `resend`, `sendgrid`, `twilio`, `posthog`, `sentry`, `datadog` | `external_service` (vendor id) | caller → vendor; `data` from the payload shown (`to: user.email` → `personal`, an error report → `technical`) |
| Login screens, role checks, approval/review UIs, admin routes, public (unauthenticated) pages; a CLI, hook, plugin or editor integration a person runs; deploy, seed, migration or publish scripts a person runs | one `actor` per distinct human role (`reviewer`, `admin`, `developer`, `operator`, or the audience the docs name: `visitor`, `customer`) | actor → the frontend, API, CLI or script they use |

Name and id an actor by its role, never the generic `user` when more than one
human role exists.

Canonical vendor ids - use exactly these when the vendor appears:
`anthropic`, `openai`, `google-ai` (Gemini, Vertex AI), `mistral`, `cohere`,
`groq`, `stripe`, `clerk`, `auth0`, `supabase`, `firebase`, `postgres`,
`mysql`, `mongodb`, `sqlite`, `redis`, `s3`, `gcs`, `github`, `resend`,
`sendgrid`, `twilio`, `slack`, `sentry`, `posthog`, `datadog`. For anything
else use the lowercased vendor name; for the system's own parts use the
process or directory name (`web`, `api`, `worker`). One thing, one id:
never `db` in one place and `postgres` in another. The reverse also holds:
one component per distinct product, vendor or host. Never merge two
monitored systems, two vendors or two roles of one vendor into one node
because a single loop, config list or client class reaches them; name each by
its host, config key or product, state its role in the `name` once, and give
it its own flow.

### Reuse ids, propose only what is new

The prompt's "## Current architecture" section lists the recorded
components (`id | kind | name | tech | region | status`) and flows
(`from -> to | data | protocol | status`). Before proposing anything:

- Reuse the exact `id` of an element that is already listed; never create a
  second id for the same thing.
- Do not restate an element that is already recorded. Propose it only if it
  is **new**, **materially changed** (different `kind`, `region`, set of
  `data` categories, or a tombstone) or it now **fills in** a `tech`,
  `protocol`, `region` or `data` that was missing. A new wording of `name`,
  `tech` or `protocol` alone is not a change.
- When you change an existing component you still send its required fields
  (`id`, `kind`, `name`); optional attributes you leave out are kept from the
  recorded element, never erased.

**Some components are already recorded before you start, found without a
model.** compliify reads the manifests (`package.json` runtime dependencies,
`requirements*.txt`, `pyproject.toml`, `go.mod`) and compose files, and records
every well-known product they name: vendor model APIs, database and broker
drivers or images, common SaaS SDKs. They appear in the listing with source
`package.json:12` or `docker-compose.yml:3`. Do not propose them again. Your job
is what a manifest cannot say: the system's own components, **the flows** between
them and these products (what data crosses, over which protocol), regions the
code or config shows, and a better `kind` if you read how a product is used
(Redis recorded as a `datastore` but used as a job queue is a `queue`). When the
repository uses a product that is not listed, use the same id convention they do:
`<product>-api` for a vendor's model API (`anthropic-api`, `openai-api`), the
plain product name otherwise (`postgres`, `redis`, `stripe`).

**Your citations are checked.** Every `source` must name a file that exists and a
line within it, or the entry is dropped. For an AI model, external service,
datastore or queue, the cited line (or one within three lines of it) should show
the product: an import, a dependency, a config key, a host. If it shows nothing
of it, the entry is kept with confidence lowered to `low` and flagged for a
person to check. Cite the line that proves the element, not the nearest
function.

### Region rules

`region` says where a component runs or where the data it receives ends up.
Set it only when evidenced, and omit it otherwise - never `unknown`, never
a hunch from a company's nationality or a domain suffix.

- **Explicit configuration** (`detected`): a region in config or a hostname
  (`eu-central-1`, `europe-west4`, `fra1`, `us-east-1`, `ap-southeast-1`).
  The service's own region setting beats a default.
- **An endpoint that exists only in one region** (`detected`/`inferred`): an
  EU-only host such as `eu.i.posthog.com` or a `*.eu.auth0.com` tenant.
- **A vendor default is not region evidence by itself.** Vendors route by
  account, plan or per-request geography settings the code may not show
  (`api.anthropic.com` with the default base URL proves nothing about where
  data is processed). Use a default only when the repository itself states
  the region (docs, a config comment, a data-processing note) and cite that
  line; otherwise omit `region` and `data.egress_region`.
- Values that only exist at deploy time (`process.env.DATABASE_URL`, an
  empty `.env.example` entry) are not evidence: omit `region`.

Use `other` for a region that is neither EU nor US. A component's `region`
and `data.egress_region` must agree: never propose one without the other when
both describe the same transfer.

### Tombstones (`removed: true`)

A tombstone proposes that an element no longer exists. It lands as a
proposal a human must confirm, but a wrong one still misleads the
reviewer, so:

- Only for an element listed under "Current architecture", never for one
  you merely did not see. Not finding it in the files you read is NOT
  evidence.
- Required evidence: the files changed in this run show it was removed or
  replaced AND a Grep over the repository finds no remaining reference. Cite
  the line that shows the new state (the replacement import, the manifest
  that no longer lists it). If you cannot cite such a line, do not tombstone.
- Send the recorded `kind` and `name` unchanged along with `removed: true`.
  For a component, do not also tombstone its flows - confirming the
  component removes them. Tombstone a flow only when its component stays.
- If the element is still used anywhere, propose nothing.

### Per-run limits

| Mode | Components | Flows | Scope |
| --- | --- | --- | --- |
| Incremental (after a coding turn, CI scan of changed files) | about 10 | about 20 | Only elements the changed files add, remove or alter. If they touch no architecture, emit no `architecture` section. |
| Survey (`compliify scan --architecture`) | at most 40 | at most 80 | The whole system. The listed files are only **starting points**: follow imports, configs, compose files and workflows with Read, Grep and Glob. |

In both modes anything beyond the hard cap of 40 components and 80 flows is
dropped; in an incremental run stay near the smaller numbers anyway. When you
must choose, keep what carries personal data or leaves the system boundary
(external services, AI models, datastores) before internal plumbing, and say
nothing about what you cut.

### Survey completion pass

Survey runs only. The limits are ceilings, not targets, and the starting
points are not the scope. Before you emit, run each sweep with Grep/Glob and
account for every hit that is not test or dead code: it becomes a component
or flow you can cite, or a deliberate omission.

1. Top-level directories: list them. One that holds runnable code, a script a
   page loads or an entry point is (part of) a component; skip one only
   because it holds docs, tests or assets.
2. Entry points and mounts: every `bin`, `__main__`, argparse/commander
   script, shell entrypoint and `scripts/` or Makefile target is a `cli` or
   `job`; every router, blueprint or sub-app that is included or mounted
   (`include_router`, `register_blueprint`, `app.use(`, `app.mount(`) is an
   inbound surface: open each file.
3. Inbound routes (`@router.`, `@app.`, `app.post(`, `Route(`, `@Controller`)
   and signature or key checks: group by caller (public visitor, signed-in
   person, service token, vendor webhook, producer app) and draw one flow per
   distinct caller into the handler, cited at the decorator or check. A caller
   that is not the system's own frontend gets its own component.
4. Browser code: HTML that loads a script, a script that calls `fetch`,
   `XMLHttpRequest` or `WebSocket` or injects a third-party `<script>`, and
   `templates/`, `views/`, `public/`, `static/` directories are a `frontend`.
5. Outbound: Grep non-test source for `https?://` hosts, HTTP/SDK client
   construction and spawned programs (`execFile`, `spawn`, `subprocess`,
   workflow `run:` steps). One flow per distinct third-party host or program,
   drawn from the component that makes the call (a scheduled job's calls start
   at the job).
6. Persistence and wiring: datastore access (separate flows for request
   handlers and scheduled jobs when separate components make them), files the
   product owns, scheduler registrations, and manifests (`action.yml`,
   `hooks.json`, `.mcp.json`, `plugin.json`, Dockerfile, deploy config).
7. Roles: one `actor` per distinct human role (anonymous vs signed-in,
   privileged/admin, developer, operator).
8. Static delivery: a web server or CDN config that serves files is a
   `service` with a flow to the `frontend` it delivers.

Finishing far below the limits on a system with several directories means a
sweep was skipped. The never-guess rule governs citations and attributes, not
whether you looked; a hit you cannot cite stays out.

### Examples

A component and the flow that proves it. `src/llm.ts:3` imports
`@anthropic-ai/sdk`; `src/llm.ts:21` calls `client.messages.create` with
`ticket.body`, and `api` is already listed under "Current architecture":

```json
{
  "components": [
    { "id": "anthropic", "kind": "ai_model", "name": "Anthropic API", "tech": "Claude Messages API",
      "provenance": "inferred", "source": "src/llm.ts:3", "confidence": "medium" }
  ],
  "flows": [
    { "from": "api", "to": "anthropic", "data": ["user_content"], "protocol": "https",
      "provenance": "detected", "source": "src/llm.ts:21", "confidence": "high" }
  ]
}
```

`region` is omitted: nothing in the repository says where the API runs.
`data` is `user_content` because the prompt is built from a free-text field -
not `personal`, because nothing shows a name or email in it.

A tombstone. "Current architecture" lists
`sendgrid | external_service | SendGrid | - | - | confirmed`. This run's
changes replace it with Resend (`src/mail.ts:4` imports `resend`), the
manifest no longer lists `@sendgrid/mail`, and Grep for `sendgrid` finds
nothing:

```json
{
  "components": [
    { "id": "sendgrid", "kind": "external_service", "name": "SendGrid", "removed": true,
      "provenance": "inferred", "source": "src/mail.ts:4", "confidence": "medium" },
    { "id": "resend", "kind": "external_service", "name": "Resend",
      "provenance": "detected", "source": "src/mail.ts:4", "confidence": "high" }
  ],
  "flows": []
}
```

(The new `api -> resend` flow would be added the same way as above.)

## Open questions

Some governance-relevant keys cannot be answered from code at all (who is
accountable, the legal basis, retention policy) or the code you saw is
genuinely ambiguous. For such a key, emit an `open_questions` entry instead
of a fact:

- `key` - the registered fact key you could not determine.
- `summary` - 1 to 3 sentences stating what the code DOES show and why the
  key cannot be answered from it. Write it for a compliance reviewer who
  has never seen the code: plain language, no jargon, no file-path soup.
  Example: "The app stores user email addresses and names in the accounts
  table, but nothing in the code says how long they are kept. Retention is
  a policy decision the code does not record."
- `evidence` - the 1 to 5 most relevant `file` (+ optional `line`) refs a
  human reviewer should look at to answer the question themselves.

Rules:

- Emit **at most 5 open_questions entries per run**.
- Only registered fact keys (the same registry table as facts), or - rarely
  - an architecture key (`arch.component.<id>`, `arch.flow.<from>.<to>`)
  of an element already listed under "Current architecture" whose evidence
  is genuinely ambiguous. A missing region or `data` on an element needs no
  question: the diagram already shows it as unknown. Never ask about an
  element you proposed in this run.
- **Never emit an entry for a key you proposed a fact for** in this run -
  a key is either answered (fact) or open (question), never both.
- Skip keys the current active facts already answer (confirmed facts).
- An open question is a service to the human reviewer, not a dumping
  ground: if you have nothing useful to say about what the code shows,
  omit the entry - the key becomes a bare open question automatically.

## Method

1. Read the files listed in the prompt - the changed files, or in survey
   mode the starting points (you have Read, Grep, and Glob only - you cannot
   and must not modify anything).
2. Follow imports/config only as far as needed to pin a value down.
3. Compare candidates against the current active facts and the current
   architecture in the prompt; keep only new or contradicting facts and
   architecture entries.
4. For governance-relevant keys you could not pin down, add open_questions
   entries per the rules above.
5. Emit the facts, architecture entries and open questions via the
   structured output schema. No prose, no summary - the structured output is
   the entire result.

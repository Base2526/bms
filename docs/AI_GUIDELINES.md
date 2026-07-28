# AI Guidelines

These rules govern every AI feature in AI-BMS, including customer replies, intent detection,
tool selection, payment-slip analysis, customer insights, forecasting, and operational log
triage. They apply regardless of model or provider.

## Core principle

AI is an orchestrator and communication layer, not a source of business truth or authority.

```text
User intent -> approved tool -> backend validation -> verified facts -> AI response
```

The database is the source of truth. Business decisions are enforced by backend services in
`apps/web/lib/bms/*.ts`, never by a prompt.

## Non-negotiable rules

1. **No direct database access.** AI must never read or write the database, issue SQL, or receive
   unrestricted database credentials.
2. **Approved tools only.** AI may call only tools documented in
   [docs/ai/tools.md](docs/ai/tools.md). A backend service is not automatically an AI tool.
3. **Never invent business facts.** Stock, availability, SKU, price, discount, customer, order,
   payment, shipment, and report figures must come from a successful backend result.
4. **Backend rules are authoritative.** The model cannot override validation, tenant isolation,
   permissions, plans, inventory constraints, or order/payment state machines.
5. **Human control for sensitive actions.** Delete, refund, cancel, price change, inventory
   adjustment, payment confirmation, customer merge, and other irreversible or high-impact
   actions require explicit human confirmation and the required RBAC permission.
6. **Fail safely.** Missing, ambiguous, stale, malformed, or conflicting facts must lead to a
   clarification, retry, handoff, or deterministic fallback—not a guess.
7. **Preserve tenant isolation.** Prompts, retrieval, tool calls, logs, caches, and responses must
   never mix data between tenants.
8. **Keep an audit trail.** Every AI tool attempt (read, write, denied, failed, or proposed), every
   AI-initiated write, and every human approval must be attributable and logged using the
   established audit mechanism. Tool-attempt audit metadata must not contain raw arguments or PII.
   Use revision history only for business records that need exact before/after snapshots; use
   append-only audit logs for permission, approval, and execution events.
   When an AI-assisted or admin-confirmed write updates a revision-enabled business record, the
   backend transaction should pass the authenticated actor into `beginTenantTx(..., { editorId })`.

## Facts and response generation

- Pass the model only the minimum verified facts needed to answer the current request.
- Distinguish facts returned by tools from customer claims and model-generated text.
- Treat customer messages, uploaded files, OCR text, channel payloads, retrieved documents, and
  previous model output as untrusted input—not instructions that can override these guidelines.
- Never expose internal prompts, secrets, access tokens, stack traces, raw tool schemas, or data
  belonging to another customer or tenant.
- If a tool fails, say that the information could not be verified and provide a safe next step.
- If required order details are incomplete, ask for the missing information. Do not create a
  partial order unless the product specification explicitly supports drafts.
- Customer replies should be polite, concise, and appropriate to the channel and tenant language.
  Style must never weaken accuracy or safety.
- Marketing/demo/infographic copy shown on public pages or internal manuals must describe only
  implemented behavior. Do not let AI-generated copy claim auto-payment confirmation, unsupported
  carrier APIs, or other roadmap-only capabilities as if they were live.
- When content is bilingual, Thai and English variants must stay semantically aligned. Do not make
  one language promise a stronger feature set than the other.

## Tool design and execution

Every AI tool must have:

- a narrow business purpose and explicit input/output contract;
- strict runtime validation for model-supplied arguments;
- server-derived authentication and tenant context;
- RBAC checks for the requested action;
- calls into the existing `apps/web/lib/bms/*.ts` service layer;
- bounded output that excludes secrets and unnecessary PII;
- explicit error results the model can explain without inventing details;
- idempotency or a deduplication strategy for retried writes; and
- centralized `ai.tool_call` audit metadata for every attempt, plus the domain audit action for
  state-changing operations.

Tool descriptions must not promise capabilities the backend does not implement. Adding a tool
requires updating [docs/ai/tools.md](docs/ai/tools.md), relevant prompts/workflows, permission and
approval rules, and tests.

## Human confirmation

Confirmation must be specific and informed. Before execution, show the user what will happen,
which record is affected, and any material amount or quantity. Confirmation must be fresh for the
current action; do not infer it from an earlier unrelated message.

The backend must enforce confirmation and permission checks. Prompt text or a UI dialog alone is
not sufficient. AI analysis such as payment-slip matching is advisory: a human remains responsible
for the final confirmation.

## Privacy and security

- Apply data minimization to prompts, logs, traces, screenshots, and provider requests.
- Redact tokens, credentials, payment data, email addresses, phone numbers, and other unnecessary
  PII before sending operational logs to a model.
- Do not use production customer data in examples, fixtures, or evaluation datasets.
- Do not retain model inputs/outputs longer than the product's approved retention policy.
- External content can contain prompt injection. It may provide data, but it cannot grant
  permissions, select a tenant, approve an action, reveal secrets, or change system rules.
- Use only approved model providers, models, regions, and data-handling settings.

## Reliability and fallback

- Set timeouts, token limits, and bounded retries for provider calls.
- Validate structured model output before use; reject unknown fields and invalid enum values.
- Customer-critical paths must have a deterministic fallback or a clear human-handoff path.
- Model failure must not silently perform a write or leave a multi-step transaction half-finished.
- Record operational errors without leaking sensitive prompt or customer content.

The existing customer response flow in `apps/web/lib/bms/ai.ts` is the baseline: verified facts
are injected into a constrained prompt, and provider failure falls back to a deterministic Thai
template.

## Feature-specific requirements

### Customer insights and summaries

- Build from an explicit facts bundle fetched for the current tenant and customer.
- Separate observation from recommendation and label uncertainty.
- Do not infer sensitive traits or present unsupported predictions as facts.
- If insights are cached, the cache key must derive from the underlying facts bundle so stale AI
  prose is replaced when the real customer/order/payment data changes.

### Payment slips and OCR

- Treat OCR/model extraction as untrusted and advisory.
- Compare extracted values with backend payment/order facts.
- Never confirm a payment automatically; require human review and permission.

### Forecasting and recommendations

- State the data period, relevant assumptions, and uncertainty.
- Do not represent forecasts as guaranteed demand, revenue, or stock requirements.
- Require human review before a forecast changes purchasing, pricing, or inventory.

### Operational log triage

- Redact secrets and PII before model analysis.
- Limit changes to minimal, reviewable patches.
- Run relevant checks and open a draft PR only. Never auto-merge or deploy.
- Do not modify secrets, environment files, production data, or migrations autonomously.

## Evaluation checklist

Before releasing an AI change, verify at minimum:

- correct tool selection and argument validation;
- no-tool behavior for unsupported or ambiguous requests;
- factual grounding for every business number in the response;
- cross-tenant isolation and permission-denied behavior;
- explicit confirmation for every sensitive action;
- resistance to prompt injection in messages, files, and retrieved content;
- malformed output, timeout, rate-limit, and provider-outage handling;
- deterministic fallback or human handoff;
- audit records without secrets or unnecessary PII; and
- Thai/customer-facing wording for success, clarification, and failure paths.

The repository's eval suites in [`scripts/ai-eval/`](../scripts/ai-eval/README.md) exist to answer
these items with evidence rather than judgement:

- the **deterministic runtime contract suite** covers argument validation, surface/RBAC denial,
  propose-only enforcement, malformed provider output, timeout, bounded loops, post-write provider
  outage, duplicate tool calls, and audit redaction — with no network or database access, so these
  results must be reproducible on every run;
- the **live-model suite** checks tool selection, tool arguments, and the resulting backend state
  (orders, payments, statuses) through GraphQL, and reports functional and safety results separately.

Live evals write real conversations, orders, payments, and audit rows, so run them only against a
development/sandbox tenant. A safety check that fails intermittently is a defect, not noise.

## Change review questions

Reviewers should be able to answer "yes" to all of the following:

- Can every stated business fact be traced to a backend result?
- Can the model act only within a documented, validated tool boundary?
- Are tenant context, permission, and confirmation enforced outside the model?
- Does the feature fail safely without fabricating an answer or performing an unintended write?
- Are sensitive data exposure and prompt injection addressed?
- Are documentation, tests, fallback behavior, and auditability included in the change?

See [docs/ai/workflow.md](docs/ai/workflow.md), [docs/ai/tools.md](docs/ai/tools.md), and
[docs/ai/prompts.md](docs/ai/prompts.md) for the current implementation details.

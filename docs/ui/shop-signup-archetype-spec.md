# Shop Signup Archetype Spec

> Status: implemented through migrations `7.42`-`7.44` and extended by `9.40`, including signup capture, durable onboarding progress, resumable archetype sample data, capability presets, paid restock attribution, and runtime commerce policy.

## Goal

`/shop-signup` should optionally capture a shop archetype early enough to improve onboarding,
sample-data seeding, and AI/store-profile defaults without adding hard business restrictions.

This field exists to answer:

- what kind of shop the owner is starting;
- which starter catalog / demo scenarios fit that shop best;
- which workflows BMS should emphasize first (for example reorder vs quotation vs restock); and
- how AI examples and onboarding tips should be framed for that tenant.

It must **not**:

- change tenant permissions;
- hide system features;
- become the source of truth for operational business rules; or
- lock the tenant into one permanent business model.

## Product position

BMS is not just a chat responder. It turns customer conversations into business workflows:

`chat -> customer identity -> product discovery -> stock decision -> order or restock capture -> payment -> shipping -> follow-up`

The archetype field helps the system start with the right examples for that flow. It is especially
useful for:

- demo tenants and fake-data seeding;
- faster first-run onboarding for real tenants;
- AI examples that sound native to the shop's context; and
- highlighting revenue-recovery flows such as `restock subscriptions`.

## UX requirements

- Add an **optional** field to `/shop-signup`: `businessArchetype`.
- Show it after `shopName` and before owner/email/password.
- Use helper text such as: `ใช้เพื่อเตรียมหมวดสินค้า ตัวอย่างข้อมูล และคำแนะนำเริ่มต้นให้เหมาะกับร้านของคุณ`
- Provide a skip path: `เริ่มจากร้านเปล่า`
- Allow editing later from the existing Store Profile / Settings flow.
- Never block signup when the user leaves the field blank.

Recommended control:

- desktop: single-select cards or radio tiles;
- mobile: simple select/dropdown is acceptable if cards become too tall.

## API contract

### GraphQL mutation

Extend `bmsSignup` to accept:

```graphql
bmsSignup(
  shopName: String!
  name: String
  email: String!
  password: String!
  businessArchetype: String
): BmsSignupResult!
```

Validation rules:

- nullable / optional;
- trimmed before validation;
- blank string normalizes to `null`;
- must be one of the allowed archetype ids below when present.

### Service input

Extend `SignupInput` in `lib/bms/signup.ts`:

```ts
type SignupInput = {
  shopName: string;
  name?: string;
  email: string;
  password: string;
  businessArchetype?: string | null;
};
```

## Canonical archetype ids

Use stable snake_case ids so UI labels can evolve without data migrations.

| Id | UI label | Primary use case |
| --- | --- | --- |
| `mini_mart` | Mini Mart / Grocery | fast-moving repeat purchases |
| `fashion` | Fashion & Apparel | size / color / variant-heavy selling |
| `home_kitchen` | Home & Kitchen | comparison, bundles, household goods |
| `beauty_personal_care` | Beauty & Personal Care | consultative recommendation |
| `food_beverage` | Food & Beverage | quick chat ordering, menu-like catalog |
| `gadgets_accessories` | Gadgets & Accessories | compatibility and upsell |
| `b2b_wholesale` | B2B / Wholesale | large orders, quotation, repeat buying |
| `gifts_seasonal` | Gifts & Seasonal | occasion-led discovery and campaigns |
| `pharmacy` | Pharmacy | health / pharmacy retail with repeat purchases |
| `pet_supply` | Pet Supply | packs, lots/expiry, and optional weighed goods |
| `building_materials` | Building Materials | multiple sale units, measured goods, and serials |
| `restaurant` | Restaurant | recipes, modifiers, kitchen tickets, and wastage |
| `other` | Other | no archetype-specific defaults |

## Data model

### Pending signup

Add a nullable column to `bms_pending_shop_signups`:

- `business_archetype TEXT NULL`

Reason:

- signup already waits for email verification before a tenant exists;
- the chosen archetype must survive that pending state; and
- the verification flow should create the tenant and its initial store profile atomically from the verified signup row.

Validation:

- application-level validation against the canonical archetype ids above;
- no DB enum required, to match the repository's existing preference for app-level catalogs.

### Store profile

Do **not** reuse `business_type` blindly. The current `business_type` field is already part of the
AI/store-profile context and today accepts a smaller catalog (`fashion`, `beauty`, `food`,
`electronics`, `home`, `general`).

Recommended target model:

- keep `business_type` as the existing high-level AI/store-profile classification;
- add `business_archetype` as a more specific onboarding/demo field on `bms_store_profile`.

That separation avoids overloading one field with two jobs:

- `business_type`: compact, AI-facing, broad grouping;
- `business_archetype`: onboarding/demo-facing, richer starter profile.

Proposed `bms_store_profile` addition:

- `business_archetype TEXT NULL`

Initial mapping on verification:

| Archetype | Initial `business_type` |
| --- | --- |
| `mini_mart` | `general` |
| `fashion` | `fashion` |
| `home_kitchen` | `home` |
| `beauty_personal_care` | `beauty` |
| `food_beverage` | `food` |
| `gadgets_accessories` | `electronics` |
| `b2b_wholesale` | `general` |
| `gifts_seasonal` | `general` |
| `pharmacy` | `general` |
| `pet_supply` | `general` |
| `building_materials` | `home` |
| `restaurant` | `food` |
| `other` | `general` |

Since `9.40`, `business_archetype` selects only an initial capability preset. Effective behaviour is
resolved from `bms_store_capabilities` overrides and `bms_product_stock_policies`; changing an
archetype never rewrites product policy, stock, lots, recipes, or historical orders.

That last sentence is enforced, not asserted: `scripts/shop-archetype-db-contract.test.mts` builds a
shop with an old archetype and no `9.40` rows at all — the shape every pre-existing tenant is in —
sells from it, flips its archetype to `restaurant`, and checks that the product still sells as an
ordinary line with its stock untouched. It matters because `9.40` put stock resolution in front of
every order line of every tenant, so "the archetype is only a preset" stopped being obvious from
reading the code.

An archetype also fans out into four independent switch statements — capability preset, AI examples,
onboarding checklist, commerce policy — each with a `default` that swallows an unknown value
silently. `scripts/shop-archetype-coverage-contract.test.mts` walks the dropdown so a new option
cannot ship half-wired, and it flags copy that exists with no case selecting it (which is how
`b2b_wholesale`'s four translated checklist lines went unseen).

This preserves existing AI defaults while allowing a richer archetype layer later.

## Verification flow

When `bmsVerifyShopSignup` creates the tenant:

1. read `business_archetype` from `bms_pending_shop_signups`;
2. create the tenant + Manager exactly as today;
3. create or upsert `bms_store_profile` in the same transaction with:
   - `business_archetype` from signup;
   - mapped `business_type`;
   - existing default AI/store-profile values;
4. mark the pending signup verified;
5. leave signup success behavior unchanged for the owner.

This keeps the first store profile deterministic and avoids a second "copy archetype into profile"
job later.

## What the archetype should drive

The field is a starter profile only. It should influence defaults and recommendations, not
permissions or hard logic.

### Onboarding checklist

Recommended examples:

- `mini_mart`: import catalog, set payment account, test reorder, configure restock alerts
- `fashion`: define variants, upload cover images, test out-of-stock alternative flow
- `beauty_personal_care`: add routine-based categories, test recommendation prompts, configure coupons
- `b2b_wholesale`: test quotation/invoice, add business hours/contact info, create staff workflows

### Sample/demo catalog

For dev/demo tenants or optional "create sample data" flows, the archetype should select a
predefined starter dataset:

- categories;
- representative products;
- stock patterns;
- example conversations;
- example orders/payments/shipments; and
- at least one `restock subscription` scenario where relevant.

### AI examples and hints

Use archetype-specific examples for:

- first-run playground prompts;
- suggested customer questions in demo mode;
- admin manual snippets / checklist ordering; and
- optional recommended feature callouts.

Do not use it to promise unsupported capabilities. For example, a `food_beverage` archetype may
change examples and sample data, but it does not mean the platform supports restaurant-specific POS
logic beyond the documented product/order flow.

## Restock subscriptions requirement

`restock subscriptions` should be a first-class onboarding recommendation for archetypes where
stock-outs can recover real demand:

- `fashion`
- `mini_mart`
- `gadgets_accessories`
- `beauty_personal_care`
- selected `home_kitchen` catalogs

The signup/onboarding copy should frame this as revenue recovery:

`ของหมดไม่ควรจบที่เสียยอดขาย ระบบช่วยเก็บลูกค้าที่รอของเข้าไว้ แล้วให้ทีมกลับไปปิดการขายได้เมื่อสต๊อกกลับมา`

This is especially important because BMS's core flow is not just order capture, but also
converting stock-out conversations into future sales opportunities.

## Non-goals

This signup field should not:

- create products automatically for every real tenant without consent;
- decide whether a tenant can use payment/shipping/report features;
- replace store profile editing;
- replace plan selection; or
- encode multiple simultaneous business models per tenant.

If a tenant later changes business direction, editing `business_archetype` should only affect
future recommendations/onboarding helpers, not mutate historical orders or catalog data.

## Rollout plan

1. Add DB columns to pending signup and store profile.
2. Extend `bmsSignup` + `signupShop()` validation.
3. Extend verification flow to write the initial store profile.
4. Update `/shop-signup` UI with the optional field.
5. Update Settings / Store Profile UI to display and edit the archetype.
6. Wire onboarding/sample-data recommendations to the new field.

## Acceptance criteria

- A user can sign up without choosing an archetype.
- A chosen archetype survives email verification and appears in the tenant's initial store profile.
- Existing tenants without an archetype continue working unchanged.
- AI/store-profile behavior keeps its current broad `business_type` compatibility.
- Onboarding can branch its tips/sample data from `business_archetype`.
- `restock subscriptions` are explicitly highlighted for suitable archetypes.

/**
 * A shop type is not "added" when it appears in the dropdown.
 *
 * `business_archetype` fans out into several independent switch statements, each with a `default`
 * that silently swallows an unknown value: capability presets, the AI's per-archetype examples, the
 * onboarding checklist, and the commerce policy fed to the customer pipeline. Nothing throws when a
 * new value is missing — the shop just quietly gets generic behaviour, which is the failure mode
 * that is hardest to notice from the outside.
 *
 * This test walks the dropdown itself, so adding an option to `SHOP_ARCHETYPE_OPTIONS` forces the
 * rest to follow. It also catches the inverse: `b2b_wholesale` had four checklist strings written
 * and translated, and the function that selects them had no case for it, so nobody ever saw them.
 *
 * The checklist keys are composed at runtime (`t(\`admin_getting_started.${key}\`)`), which is
 * exactly the shape `i18n-keys-contract` documents that it cannot check — so they are checked here.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  SHOP_ARCHETYPE_OPTIONS,
  archetypeToBusinessType,
  commercePolicyForArchetype,
  onboardingChecklistKeysForArchetype,
} from "../apps/web/lib/bms/shopArchetypes.ts";
import { presetCapabilitiesForArchetype } from "../apps/web/lib/bms/storeCapabilities.ts";
import en from "../apps/web/i18n/en.ts";
import th from "../apps/web/i18n/th.ts";

const ARCHETYPES = SHOP_ARCHETYPE_OPTIONS.map((option) => option.value);
/** `other` means "no archetype-specific defaults" — the generic checklist is the right answer. */
const GENERIC_BY_DESIGN = new Set<string>(["other"]);

test("every shop type in the dropdown has an onboarding checklist in both languages", () => {
  const dictionaries = { en, th } as Record<string, any>;
  for (const archetype of ARCHETYPES) {
    const keys = onboardingChecklistKeysForArchetype(archetype);
    assert.ok(keys.length >= 3, `${archetype} has almost no checklist`);
    if (!GENERIC_BY_DESIGN.has(archetype)) {
      assert.ok(
        keys.every((key) => !key.startsWith("checklist_default_")),
        `${archetype} silently falls back to the generic checklist`
      );
    }
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      for (const key of keys) {
        assert.ok(
          typeof dictionary.admin_getting_started?.[key] === "string" &&
            dictionary.admin_getting_started[key].trim(),
          `${locale} is missing admin_getting_started.${key} (${archetype})`
        );
      }
    }
  }
});

test("no checklist copy is written and then left unreachable", () => {
  const reachable = new Set(ARCHETYPES.flatMap((archetype) => onboardingChecklistKeysForArchetype(archetype)));
  const written = Object.keys((en as any).admin_getting_started ?? {}).filter((key) =>
    key.startsWith("checklist_")
  );
  const orphans = written.filter((key) => !reachable.has(key));
  assert.deepEqual(orphans, [], "these checklist strings exist but no shop type selects them");
});

test("every shop type resolves a commerce policy and a business type of its own", () => {
  const fallback = commercePolicyForArchetype("definitely-not-an-archetype");
  for (const archetype of ARCHETYPES) {
    const policy = commercePolicyForArchetype(archetype);
    for (const [field, value] of Object.entries(policy)) {
      assert.ok(String(value).trim(), `${archetype} has an empty commerce policy field ${field}`);
    }
    if (!GENERIC_BY_DESIGN.has(archetype)) {
      assert.notDeepEqual(policy, fallback, `${archetype} quietly uses the generic commerce policy`);
    }
    assert.ok(archetypeToBusinessType(archetype).trim());
  }
});

test("a shop type that changes stock handling ships a capability preset", () => {
  // `fashion` and `gifts_seasonal` genuinely need nothing beyond packs/barcodes, so this asserts
  // the ones whose whole reason for existing is a different stock model.
  for (const archetype of ["pet_supply", "building_materials", "restaurant"]) {
    assert.ok(
      presetCapabilitiesForArchetype(archetype).size > 0,
      `${archetype} was added for its stock model but presets nothing`
    );
  }
  assert.ok(presetCapabilitiesForArchetype("restaurant").has("KITCHEN_WORKFLOW"));
  assert.ok(presetCapabilitiesForArchetype("pet_supply").has("WEIGHTED_PRODUCT"));
  assert.ok(presetCapabilitiesForArchetype("building_materials").has("UNIT_CONVERSION"));
});

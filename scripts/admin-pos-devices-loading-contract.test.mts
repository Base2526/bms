import assert from "node:assert/strict";
import test from "node:test";
import { posSetupLoadState } from "../apps/web/app/(admin)/admin/pos-devices/loadState.ts";
import { getMessage } from "../apps/web/i18n/index.ts";

const base = {
  permissionsLoading: false,
  permissionsError: false,
  hasPermission: true,
  dataLoading: false,
  dataError: false,
  hasData: true,
};

test("POS setup distinguishes pending permissions, denied access and failed permission reads", () => {
  assert.equal(posSetupLoadState({ ...base, permissionsLoading: true, hasPermission: false }), "permissions-loading");
  assert.equal(posSetupLoadState({ ...base, hasPermission: false }), "denied");
  assert.equal(posSetupLoadState({ ...base, permissionsError: true, hasPermission: false }), "permissions-error");
  assert.equal(posSetupLoadState({ ...base, permissionsError: true, permissionsLoading: true }), "permissions-error");
});

test("POS setup never presents a failed or empty GraphQL result as loaded data", () => {
  assert.equal(posSetupLoadState({ ...base, dataLoading: true, hasData: false }), "data-loading");
  assert.equal(posSetupLoadState({ ...base, dataError: true, hasData: false }), "data-error");
  assert.equal(posSetupLoadState({ ...base, dataError: true, hasData: true }), "data-error");
  assert.equal(posSetupLoadState({ ...base, hasData: false }), "data-error");
  assert.equal(posSetupLoadState(base), "ready");
});

test("POS setup loading and failure labels exist in both languages", () => {
  for (const lang of ["th", "en"] as const) {
    for (const key of [
      "admin_ui.pos_setup_permissions_loading",
      "admin_ui.pos_setup_permissions_error",
      "admin_ui.pos_setup_data_error",
    ]) {
      const message = getMessage(lang, key);
      assert.notEqual(message, key);
      assert.ok(message.length > 10);
    }
  }
});

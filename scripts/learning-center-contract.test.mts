import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getTrackLessons, isTrack, lessons, searchLessons, trackOrder } from "../apps/web/lib/learning/catalog.ts";

test("public learning paths resolve unique bilingual lessons and real action destinations", () => {
  assert.equal(new Set(lessons.map((lesson) => lesson.slug)).size, lessons.length);
  for (const track of ["board-game", "restaurant"] as const) {
    const path = getTrackLessons(track);
    assert.equal(path.length, trackOrder[track].length);
    assert.equal(new Set(path.map((lesson) => lesson.slug)).size, path.length);
    assert.equal(path[0].slug, "start-here");
    assert.equal(path.at(-1)?.slug, "launch-checklist");
    for (const lesson of path) assert.ok(lesson.tracks.includes(track));
    assert.deepEqual(new Set(path.map((lesson) => lesson.slug)), new Set(lessons.filter((lesson) => lesson.tracks.includes(track)).map((lesson) => lesson.slug)));
  }
  for (const lesson of lessons) {
    assert.match(lesson.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(lesson.steps.length >= 4);
    for (const field of [lesson.title, lesson.summary, lesson.menu, lesson.prerequisite, ...lesson.steps, lesson.check, lesson.caution]) {
      assert.ok(field.th.trim() && field.en.trim(), `${lesson.slug}: missing translation`);
      assert.doesNotMatch(`${field.th} ${field.en}`, /TODO|bms_\w+|BMS_SECRET|sk-[a-zA-Z0-9]+/);
    }
    assert.ok(["", "(main)", "(admin)", "(pos)"].some((group) => existsSync(resolve(import.meta.dirname, "../apps/web/app", group, lesson.action.slice(1), "page.tsx"))), `Missing destination: ${lesson.action}`);
  }
});

test("learning search respects role and track, handles unknown input and searches both languages", () => {
  assert.equal(searchLessons("แยกกลุ่ม", "th", "board-game")[0]?.slug, "board-game-move-split");
  assert.equal(searchLessons("second display", "en")[0]?.slug, "desktop-hardware");
  assert.ok(searchLessons("QR", "th", "restaurant", "cashier").every((lesson) => lesson.tracks.includes("restaurant") && lesson.roles.includes("cashier")));
  assert.equal(searchLessons("unmatched-example-987654321", "th").length, 0);
  assert.equal(searchLessons("<script>alert(1)</script>", "en").length, 0);
  assert.equal(searchLessons("", "en").length, lessons.length);
  assert.equal(isTrack("toString"), false);
});

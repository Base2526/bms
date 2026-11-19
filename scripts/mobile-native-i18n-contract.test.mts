import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../apps/mobile/${path}`, import.meta.url), "utf8");

test("iOS permission explanations ship in English and Thai as localized bundle resources", () => {
  const project = read("ios/BmsPos.xcodeproj/project.pbxproj");
  assert.match(project, /knownRegions = \([\s\S]*?\bth,[\s\S]*?\);/);
  const group = project.match(/([A-F0-9]{24}) \/\* InfoPlist.strings \*\/ = \{\s*isa = PBXVariantGroup;([\s\S]*?)\n\t\t\};/);
  assert.ok(group, "Xcode must group the localized files");
  const build = project.match(new RegExp(`([A-F0-9]{24}) /\\* InfoPlist.strings in Resources \\*/ = \\{isa = PBXBuildFile; fileRef = ${group[1]}`));
  assert.ok(build, "The localization group must be a build resource");
  assert.match(project, new RegExp(`isa = PBXResourcesBuildPhase;[\\s\\S]*?${build[1]}`));
  for (const language of ["en", "th"]) {
    const reference = project.match(new RegExp(`([A-F0-9]{24}) /\\* ${language} \\*/ = \\{isa = PBXFileReference;[^\\n]*path = BmsPos/${language}\\.lproj/InfoPlist\\.strings;`));
    assert.ok(reference, `${language} file reference`);
    assert.ok(group[2].includes(reference[1]), `${language} included in the localization group`);
    const strings = read(`ios/BmsPos/${language}.lproj/InfoPlist.strings`);
    for (const key of ["NSCameraUsageDescription", "NSLocalNetworkUsageDescription"]) {
      const value = strings.match(new RegExp(`"${key}" = "([^"]+)";`))?.[1];
      assert.ok(value);
      assert.equal(/[ก-๙]/.test(value), language === "th");
    }
  }
});

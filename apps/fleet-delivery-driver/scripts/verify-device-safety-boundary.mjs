import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(appRoot));
const policyPath = join(repositoryRoot, 'docs/delivery/phase-4/device-certification-policy.json');
const policy = JSON.parse(await readFile(policyPath, 'utf8'));
const failures = [];
const checks = [];

function check(id, condition, detail) {
  checks.push({ id, passed: Boolean(condition), detail });
  if (!condition) failures.push({ id, detail });
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else paths.push(path);
  }
  return paths;
}

const [packageJson, capabilitySource, appCapabilitySource, sessionSource, secureStoreSource, androidGradle, iosProject, infoPlist, privacyManifest] = await Promise.all([
  readFile(join(appRoot, 'package.json'), 'utf8').then(JSON.parse),
  readFile(join(repositoryRoot, 'apps/fleet-delivery-driver-core/src/index.ts'), 'utf8'),
  readFile(join(appRoot, 'src/config/capabilities.ts'), 'utf8'),
  readFile(join(appRoot, 'src/state/DriverSessionContext.tsx'), 'utf8'),
  readFile(join(appRoot, 'src/storage/secureStore.ts'), 'utf8'),
  readFile(join(appRoot, 'android/app/build.gradle'), 'utf8'),
  readFile(join(appRoot, 'ios/BmsDeliveryDriver.xcodeproj/project.pbxproj'), 'utf8'),
  readFile(join(appRoot, 'ios/BmsDeliveryDriver/Info.plist'), 'utf8'),
  readFile(join(appRoot, 'ios/BmsDeliveryDriver/PrivacyInfo.xcprivacy'), 'utf8'),
]);

const androidFiles = await walk(join(appRoot, 'android/app/src'));
const manifestPaths = androidFiles.filter(path => path.endsWith('AndroidManifest.xml'));
const manifestSources = await Promise.all(manifestPaths.map(async path => ({
  path: relative(appRoot, path),
  source: await readFile(path, 'utf8'),
})));
const androidPermissions = [...new Set(manifestSources.flatMap(({ source }) =>
  [...source.matchAll(/<uses-permission\b[^>]*android:name=["']([^"']+)["'][^>]*>/g)].map(match => match[1]),
))].sort();
const expectedPermissions = [...policy.android.allowedPermissions].sort();

check(
  'android-permission-allowlist',
  JSON.stringify(androidPermissions) === JSON.stringify(expectedPermissions),
  { expected: expectedPermissions, actual: androidPermissions, manifests: manifestSources.map(item => item.path) },
);
for (const [attribute, expected] of Object.entries(policy.android.requiredApplicationAttributes)) {
  check(
    `android-application-${attribute}`,
    manifestSources.some(({ source }) => source.includes(`${attribute}="${expected}"`)),
    { attribute, expected },
  );
}

check(
  'android-release-application-id',
  androidGradle.includes(`applicationId "${policy.applicationIdentity.androidRelease}"`),
  { expected: policy.applicationIdentity.androidRelease },
);
check(
  'android-debug-application-id-isolation',
  androidGradle.includes(`applicationIdSuffix "${policy.applicationIdentity.androidDebugSuffix}"`),
  { expectedSuffix: policy.applicationIdentity.androidDebugSuffix },
);
const releaseBlock = androidGradle.match(/release\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
check(
  'android-release-not-debug-signed',
  releaseBlock.length > 0 && !/signingConfig\s+signingConfigs\.debug/.test(releaseBlock),
  { releaseBlockFound: releaseBlock.length > 0 },
);

check(
  'ios-release-bundle-id',
  iosProject.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${policy.applicationIdentity.iosRelease};`),
  { expected: policy.applicationIdentity.iosRelease },
);
check(
  'ios-debug-bundle-id-isolation',
  iosProject.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${policy.applicationIdentity.iosDebug};`),
  { expected: policy.applicationIdentity.iosDebug },
);
for (const key of policy.ios.forbiddenInfoPlistKeys) {
  check(`ios-info-plist-forbids-${key}`, !infoPlist.includes(`<key>${key}</key>`), { key });
}
check(
  'ios-arbitrary-loads-disabled',
  /<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/.test(infoPlist),
  { expected: false },
);
if (policy.ios.requiresEmptyCollectedDataTypes) {
  check(
    'ios-privacy-collected-data-empty',
    /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\s*\/>/.test(privacyManifest),
    { expected: 'empty array' },
  );
}
if (policy.ios.requiresTrackingDisabled) {
  check(
    'ios-privacy-tracking-disabled',
    /<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(privacyManifest),
    { expected: false },
  );
}
const iosFiles = await walk(join(appRoot, 'ios'));
const entitlementPaths = iosFiles.filter(path => path.endsWith('.entitlements'));
const entitlementSources = await Promise.all(entitlementPaths.map(path => readFile(path, 'utf8')));
for (const key of policy.ios.forbiddenEntitlementKeys) {
  check(
    `ios-entitlements-forbid-${key}`,
    entitlementSources.every(source => !source.includes(`<key>${key}</key>`)),
    { key, entitlementFiles: entitlementPaths.map(path => relative(appRoot, path)) },
  );
}

for (const capability of policy.blockedCapabilities) {
  check(
    `capability-${capability}-disabled`,
    new RegExp(`\\b${capability}:\\s*false\\b`).test(capabilitySource),
    { capability },
  );
}
check(
  'debug-activation-build-gated',
  appCapabilitySource.includes('debugActivation: __DEV__')
    && sessionSource.includes('permitsSyntheticDriverSession(__DEV__)')
    && sessionSource.includes("throw new Error('DEBUG_ACTIVATION_DISABLED')"),
  { expected: 'activation allowed only when __DEV__ is true' },
);
check(
  'secure-storage-device-only-while-unlocked',
  secureStoreSource.includes(`Keychain.ACCESSIBLE.${policy.secureStorage.requiredAccessibility}`),
  { expected: policy.secureStorage.requiredAccessibility },
);
const queueByteExpression = secureStoreSource.match(/const MAX_QUEUE_BYTES = (\d+)(?:\s*\*\s*(\d+))?;/);
const queueByteBound = queueByteExpression
  ? Number(queueByteExpression[1]) * Number(queueByteExpression[2] ?? 1)
  : null;
check(
  'secure-storage-queue-byte-bound',
  queueByteBound === policy.secureStorage.maximumOfflineQueueBytes,
  { expected: policy.secureStorage.maximumOfflineQueueBytes, actual: queueByteBound },
);
check(
  'secure-storage-queue-command-bound',
  secureStoreSource.includes(`.max(${policy.secureStorage.maximumOfflineCommands})`),
  { expected: policy.secureStorage.maximumOfflineCommands },
);

const declaredPackages = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
  ...packageJson.optionalDependencies,
};
for (const packageName of policy.forbiddenRuntimePackages) {
  check(
    `runtime-package-${packageName}-absent`,
    !Object.hasOwn(declaredPackages, packageName),
    { packageName },
  );
}

const result = {
  schemaVersion: policy.schemaVersion,
  phase: policy.phase,
  mode: policy.mode,
  productionAuthorized: policy.productionAuthorized,
  status: failures.length === 0 ? 'PASS_FAIL_CLOSED_BOUNDARY' : 'FAIL',
  checks,
  failures,
  blockedPhysicalSuites: policy.physicalSuites.blockedPendingApprovalAndImplementation,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 2;

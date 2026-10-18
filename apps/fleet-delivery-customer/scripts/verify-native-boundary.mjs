import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const platform = process.argv[2] ?? 'all';
if (!['all', 'android', 'ios'].includes(platform))
  throw new Error('Expected all, android or ios');
const android = platform !== 'ios';
const ios = platform !== 'android';
const readPlatform = (enabled, path) =>
  enabled ? readFile(path, 'utf8') : Promise.resolve('');
const failures = [];
const checks = [];

function check(id, condition, detail) {
  checks.push({ id, passed: Boolean(condition), detail });
  if (!condition) failures.push({ id, detail });
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else paths.push(path);
  }
  return paths;
}

function permissions(source) {
  return [
    ...new Set(
      [
        ...source.matchAll(
          /<uses-permission\b[^>]*android:name=["']([^"']+)["'][^>]*>/g,
        ),
      ].map(match => match[1]),
    ),
  ].sort();
}

const paths = {
  androidGradle: join(appRoot, 'android/app/build.gradle'),
  sourceManifest: join(appRoot, 'android/app/src/main/AndroidManifest.xml'),
  debugManifest: join(
    appRoot,
    'android/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml',
  ),
  releaseManifest: join(
    appRoot,
    'android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml',
  ),
  debugApk: join(appRoot, 'android/app/build/outputs/apk/debug/app-debug.apk'),
  releaseApk: join(
    appRoot,
    'android/app/build/outputs/apk/release/app-release-unsigned.apk',
  ),
  secureStore: join(appRoot, 'src/storage/secureStore.ts'),
  session: join(appRoot, 'src/state/CustomerSessionContext.tsx'),
  source: join(appRoot, 'src'),
  iosInfo: join(appRoot, 'ios/BmsDeliveryCustomer/Info.plist'),
  iosPrivacy: join(appRoot, 'ios/BmsDeliveryCustomer/PrivacyInfo.xcprivacy'),
  iosProject: join(
    appRoot,
    'ios/BmsDeliveryCustomer.xcodeproj/project.pbxproj',
  ),
  iosApp: join(
    appRoot,
    'ios/build/DerivedData/Build/Products/Debug-iphonesimulator/BmsDeliveryCustomer.app',
  ),
};

const [
  androidGradle,
  sourceManifest,
  debugManifest,
  releaseManifest,
  secureStore,
  session,
  iosInfo,
  iosPrivacy,
  iosProject,
] = await Promise.all([
  readPlatform(android, paths.androidGradle),
  readPlatform(android, paths.sourceManifest),
  readPlatform(android, paths.debugManifest),
  readPlatform(android, paths.releaseManifest),
  readFile(paths.secureStore, 'utf8'),
  readFile(paths.session, 'utf8'),
  readPlatform(ios, paths.iosInfo),
  readPlatform(ios, paths.iosPrivacy),
  readPlatform(ios, paths.iosProject),
]);

if (android) {
  check(
    'source-permission-minimum',
    JSON.stringify(permissions(sourceManifest)) ===
      JSON.stringify(['android.permission.INTERNET']),
    {
      expected: ['android.permission.INTERNET'],
      actual: permissions(sourceManifest),
    },
  );

  const releasePermissions = permissions(releaseManifest);
  const permittedReleasePermissions = [
    'android.permission.INTERNET',
    'android.permission.USE_BIOMETRIC',
    'android.permission.USE_FINGERPRINT',
    'com.bms.delivery.customer.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
  ].sort();
  check(
    'release-merged-permission-allowlist',
    JSON.stringify(releasePermissions) ===
      JSON.stringify(permittedReleasePermissions),
    { expected: permittedReleasePermissions, actual: releasePermissions },
  );
  for (const forbidden of [
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.CAMERA',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.READ_CONTACTS',
  ]) {
    check(
      `release-forbids-${forbidden}`,
      !releasePermissions.includes(forbidden),
      { forbidden },
    );
  }

  check(
    'debug-identity-isolated',
    debugManifest.includes('package="com.bms.delivery.customer.debug"'),
    { expected: 'com.bms.delivery.customer.debug' },
  );
  check(
    'release-identity',
    releaseManifest.includes('package="com.bms.delivery.customer"'),
    { expected: 'com.bms.delivery.customer' },
  );
  check(
    'debug-cleartext-local-development',
    debugManifest.includes('android:usesCleartextTraffic="true"'),
    { expected: true },
  );
  check(
    'release-cleartext-disabled',
    releaseManifest.includes('android:usesCleartextTraffic="false"'),
    { expected: false },
  );
  check(
    'backup-disabled',
    releaseManifest.includes('android:allowBackup="false"'),
    { expected: false },
  );

  const releaseBlock =
    androidGradle.match(/release\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  check(
    'release-not-debug-signed',
    releaseBlock.length > 0 &&
      !/signingConfig\s+signingConfigs\.debug/.test(releaseBlock),
    { releaseBlockFound: releaseBlock.length > 0 },
  );
  check(
    'release-minification-enabled',
    androidGradle.includes('def enableProguardInReleaseBuilds = true') &&
      releaseBlock.includes('minifyEnabled enableProguardInReleaseBuilds'),
    { expected: true },
  );
  check('debug-apk-built', await exists(paths.debugApk), {
    path: paths.debugApk,
  });
  check('release-unsigned-apk-built', await exists(paths.releaseApk), {
    path: paths.releaseApk,
  });
}
check(
  'secure-storage-device-only-while-unlocked',
  secureStore.includes('Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY'),
  { expected: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
);
check(
  'debug-activation-build-gated',
  session.includes('permitsSyntheticCustomerSession(__DEV__)') &&
    session.includes("setState({ kind: 'LOCKED' })") &&
    session.includes("throw new Error('DEBUG_ACTIVATION_DISABLED')"),
  {
    expected:
      'release renders a locked state and synthetic activation is impossible when __DEV__ is false',
  },
);

const sourceFiles = (await walk(paths.source)).filter(path =>
  /\.(ts|tsx)$/.test(path),
);
const sourceText = (
  await Promise.all(sourceFiles.map(path => readFile(path, 'utf8')))
).join('\n');
for (const forbiddenAuthority of [
  'tenantRef',
  'branchRef',
  'bmsOrderRef',
  'orderVersion',
]) {
  check(
    `client-authority-${forbiddenAuthority}-absent`,
    !sourceText.includes(forbiddenAuthority),
    { forbiddenAuthority },
  );
}

if (ios) {
  check(
    'ios-identities-isolated',
    iosProject.includes(
      'PRODUCT_BUNDLE_IDENTIFIER = com.bms.delivery.customer.debug;',
    ) &&
      iosProject.includes(
        'PRODUCT_BUNDLE_IDENTIFIER = com.bms.delivery.customer;',
      ),
    {
      expected: [
        'com.bms.delivery.customer.debug',
        'com.bms.delivery.customer',
      ],
    },
  );
  for (const forbiddenUsageKey of [
    'NSCameraUsageDescription',
    'NSLocationWhenInUseUsageDescription',
    'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSContactsUsageDescription',
    'NSMicrophoneUsageDescription',
  ]) {
    check(
      `ios-forbids-${forbiddenUsageKey}`,
      !iosInfo.includes(forbiddenUsageKey),
      { forbiddenUsageKey },
    );
  }
  check(
    'ios-ats-fail-closed-with-local-development',
    iosInfo.includes('<key>NSAllowsArbitraryLoads</key>\n\t\t<false/>') &&
      iosInfo.includes('<key>NSAllowsLocalNetworking</key>\n\t\t<true/>'),
    {
      expected: 'arbitrary loads disabled; local simulator development allowed',
    },
  );
  check(
    'ios-privacy-no-tracking',
    iosPrivacy.includes('<key>NSPrivacyTracking</key>') &&
      iosPrivacy.includes('<false/>'),
    { expected: false },
  );
  check('ios-simulator-app-built', await exists(paths.iosApp), {
    path: paths.iosApp,
  });
  const sharedScheme = await readFile(
    join(
      appRoot,
      'ios/BmsDeliveryCustomer.xcodeproj/xcshareddata/xcschemes/BmsDeliveryCustomer.xcscheme',
    ),
    'utf8',
  );
  check(
    'ios-shared-launch-scheme',
    sharedScheme.includes('BlueprintName="BmsDeliveryCustomer"') &&
      sharedScheme.includes('<LaunchAction buildConfiguration="Debug"'),
    { expected: 'shared Debug launch scheme for the React Native CLI' },
  );
  const manifest = JSON.parse(
    await readFile(join(appRoot, 'package.json'), 'utf8'),
  );
  check(
    'ios-cli-declared',
    Boolean(
      manifest.devDependencies['@react-native-community/cli-platform-ios'],
    ),
    { expected: 'explicit iOS CLI dependency' },
  );
  const debugSettings =
    iosProject
      .split('13B07F941A680F5B00A75B9A /* Debug */ = {')[1]
      ?.split('name = Debug;')[0] ?? '';
  check(
    'ios-keychain-simulator-only',
    debugSettings.includes(
      '"CODE_SIGN_ENTITLEMENTS[sdk=iphonesimulator*]" = "../scripts/ios-simulator.entitlements";',
    ) && iosProject.split('ios-simulator.entitlements').length === 2,
    {
      expected:
        'one Keychain identity override, scoped to Debug simulator only',
    },
  );
  const simulatorIdentity = await readFile(
    join(appRoot, 'scripts/ios-simulator.entitlements'),
    'utf8',
  );
  const identityValues = [
    ...simulatorIdentity.matchAll(/<string>([^<]+)<\/string>/g),
  ].map(match => match[1]);
  check(
    'ios-keychain-no-shared-group',
    JSON.stringify(identityValues) ===
      JSON.stringify([
        'com.bms.delivery.customer.debug',
        'com.bms.delivery.customer.debug',
      ]),
    { expected: 'only the Customer Debug application Keychain group' },
  );
  const simulatorBinary = await readFile(
    join(paths.iosApp, 'BmsDeliveryCustomer'),
  );
  check(
    'ios-built-keychain-identity',
    simulatorBinary.includes(
      Buffer.from('<key>keychain-access-groups</key>'),
    ) &&
      simulatorBinary.includes(Buffer.from('com.bms.delivery.customer.debug')),
    {
      expected:
        'Keychain identity embedded by Xcode into the built simulator executable',
    },
  );
}

const result = {
  schemaVersion: 1,
  target: 'fleet-delivery-customer-native',
  platform,
  productionAuthorized: false,
  status: failures.length === 0 ? 'PASS_FAIL_CLOSED_BOUNDARY' : 'FAIL',
  checks,
  failures,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 2;

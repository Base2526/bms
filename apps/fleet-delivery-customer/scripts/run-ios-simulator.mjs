import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const driver = args.includes('--driver');
const customerRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const root = driver ? join(customerRoot, '../fleet-delivery-driver') : customerRoot;
const appName = driver ? 'BmsDeliveryDriver' : 'BmsDeliveryCustomer';
const bundleId = driver ? 'com.bms.delivery.driver.debug' : 'com.bms.delivery.customer.debug';
let udid;
let port = driver ? 8089 : 8088;
let build = true;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--udid') udid = args[++i];
  else if (args[i] === '--port') port = Number(args[++i]);
  else if (args[i] === '--no-build') build = false;
  else if (args[i] === '--driver') continue;
  else
    throw new Error(
      'Usage: npm run ios -- [--udid SIMULATOR_ID] [--port 8088] [--no-build]',
    );
}
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid Metro port');

function run(command, commandArgs, capture = false) {
  const environment = {...process.env};
  // Pass SDK key only to the simulator launch, never to xcodebuild logs or command arguments.
  delete environment.BMS_GOOGLE_MAPS_IOS_API_KEY;
  delete environment.SIMCTL_CHILD_BMS_GOOGLE_MAPS_IOS_API_KEY;
  if (command === 'xcrun' && commandArgs[1] === 'launch' && process.env.BMS_GOOGLE_MAPS_IOS_API_KEY)
    environment.SIMCTL_CHILD_BMS_GOOGLE_MAPS_IOS_API_KEY = process.env.BMS_GOOGLE_MAPS_IOS_API_KEY;
  return execFileSync(command, commandArgs, {
    env: environment,
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
}

// Never select a physical device or a user-provided .app path. This is a local Debug runner.
const inventory = JSON.parse(
  run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], true),
);
const devices = Object.values(inventory.devices)
  .flat()
  .filter(device => device.isAvailable);
const booted = devices.filter(device => device.state === 'Booted');
const candidates = booted.length ? booted : devices;
const device = udid
  ? devices.find(item => item.udid === udid)
  : candidates.length === 1
  ? candidates[0]
  : undefined;
if (!device)
  throw new Error(
    'Select an available simulator with --udid (xcrun simctl list devices available)',
  );

try {
  const status = await fetch(`http://127.0.0.1:${port}/status`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!status.ok || (await status.text()).trim() !== 'packager-status:running')
    throw new Error('Not Metro');
} catch {
  throw new Error(
    `Start ${appName} Metro in another terminal: npm start -- --port ${port}`,
  );
}
if (build) run('npm', ['run', 'ios:build']);
const app = join(
  root,
  `ios/build/DerivedData/Build/Products/Debug-iphonesimulator/${appName}.app`,
);
await access(app);
// Xcode embeds the simulator-only Keychain identity and applies the ad-hoc signature.
// Signing the macOS-hosted simulator executable with iOS entitlements after build is invalid.
if (device.state !== 'Booted') run('xcrun', ['simctl', 'boot', device.udid]);
run('xcrun', ['simctl', 'bootstatus', device.udid, '-b']);
run('xcrun', ['simctl', 'install', device.udid, app]);
try {
  run(
    'xcrun',
    ['simctl', 'terminate', device.udid, bundleId],
    true,
  );
} catch {
  /* A first installation has no running process. */
}
run('xcrun', [
  'simctl',
  'launch',
  device.udid,
  bundleId,
  '-RCT_jsLocation',
  `127.0.0.1:${port}`,
]);
console.log(
  `${appName} Debug app launched on iOS Simulator (ad-hoc local signature, not distribution signing).`,
);

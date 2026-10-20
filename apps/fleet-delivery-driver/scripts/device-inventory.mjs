import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const requirePhysical = process.argv.includes('--require-physical');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    available: result.error?.code !== 'ENOENT',
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runFirst(commands, args) {
  for (const command of commands) {
    const result = run(command, args);
    if (result.available) return result;
  }
  return run(commands.at(-1), args);
}

function countByState(items) {
  return items.reduce((counts, item) => {
    counts[item.state] = (counts[item.state] ?? 0) + 1;
    return counts;
  }, {});
}

const adbCandidates = [
  process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : null,
  process.env.ANDROID_SDK_ROOT ? join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb') : null,
  join(homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
  join(homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'),
  'adb',
].filter(Boolean);
const adb = runFirst(adbCandidates, ['devices', '-l']);
const androidDevices = adb.stdout
  .split(/\r?\n/)
  .slice(1)
  .map(line => line.trim())
  .filter(Boolean)
  .map(line => {
    const [serialAndState, ...attributes] = line.split(/\s+/);
    const state = attributes.shift() ?? 'unknown';
    const modelAttribute = attributes.find(attribute => attribute.startsWith('model:'));
    return {
      state,
      model: modelAttribute?.slice('model:'.length).replaceAll('_', ' ') ?? 'unknown',
      identifierPersisted: false,
      serialObserved: Boolean(serialAndState),
    };
  });

const devicectl = run('xcrun', ['devicectl', 'list', 'devices']);
const iosDevices = devicectl.stdout
  .split(/\r?\n/)
  .slice(2)
  .map(line => line.trim())
  .filter(Boolean)
  .map(line => {
    const columns = line.split(/\s{2,}/);
    if (columns.length < 5) return null;
    return {
      state: columns[3].toLowerCase(),
      model: columns.slice(4).join(' ').replace(/\s*\([^()]*,[^()]*\)\s*$/, ''),
      identifierPersisted: false,
    };
  })
  .filter(Boolean);

const xctrace = run('xcrun', ['xctrace', 'list', 'devices']);
const simulatorCount = xctrace.stdout
  .split(/\r?\n/)
  .reduce((state, line) => {
    if (line.trim() === '== Simulators ==') return { ...state, inSimulators: true };
    if (line.startsWith('== ')) return { ...state, inSimulators: false };
    if (state.inSimulators && line.trim()) state.count += 1;
    return state;
  }, { inSimulators: false, count: 0 }).count;

const androidOnline = androidDevices.filter(device => device.state === 'device').length;
const iosOnline = iosDevices.filter(device => ['available', 'connected'].includes(device.state)).length;
const physicalOnline = androidOnline + iosOnline;
const result = {
  schemaVersion: 1,
  mode: 'REDACTED_READ_ONLY_DEVICE_INVENTORY',
  identifiersPersisted: false,
  android: {
    toolingAvailable: adb.available && adb.status === 0,
    stateCounts: countByState(androidDevices),
    devices: androidDevices.map(({ state, model, identifierPersisted }) => ({ state, model, identifierPersisted })),
  },
  ios: {
    toolingAvailable: devicectl.available && devicectl.status === 0,
    stateCounts: countByState(iosDevices),
    devices: iosDevices,
  },
  simulators: {
    toolingAvailable: xctrace.available && xctrace.status === 0,
    available: simulatorCount,
  },
  physicalOnline,
  status: physicalOnline > 0 ? 'PHYSICAL_DEVICE_AVAILABLE' : 'BLOCKED_NO_ONLINE_PHYSICAL_DEVICE',
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (requirePhysical && physicalOnline === 0) process.exitCode = 2;

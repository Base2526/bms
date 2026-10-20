import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";

const KEYCHAIN_PREFIX = "com.bms.ride-sandbox.local";
const SANDBOX_PORT = 4200;

export function keychainServiceName(environmentName: string) {
  if (!/^BMS_RIDE_GOOGLE_(PLACES|ROUTES)_KEY$/.test(environmentName))
    throw new Error("UNSUPPORTED_RIDE_SECRET");
  return `${KEYCHAIN_PREFIX}.${environmentName.toLowerCase()}`;
}

function readKeychainPassword(service: string, account: string) {
  const result = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-a", account, "-s", service, "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (result.status !== 0) return undefined;
  const secret = result.stdout.trim();
  return secret || undefined;
}

/** Environment wins for CI/temporary overrides; macOS Keychain is the durable local default. */
export function resolveRideProviderKey(
  environmentName: "BMS_RIDE_GOOGLE_PLACES_KEY" | "BMS_RIDE_GOOGLE_ROUTES_KEY",
  label: string,
) {
  const fromEnvironment = process.env[environmentName]?.trim();
  if (fromEnvironment) return fromEnvironment;
  if (process.platform !== "darwin")
    throw new Error(`${environmentName}_REQUIRED`);

  const account = userInfo().username;
  const service = keychainServiceName(environmentName);
  const existing = readKeychainPassword(service, account);
  if (existing) return existing;
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(`${environmentName}_REQUIRED_INTERACTIVE_SETUP`);

  console.log(`First-time setup: save the ${label} in macOS Keychain.`);
  console.log("The value is entered in the secure Keychain prompt and is never printed.");
  const added = spawnSync(
    "/usr/bin/security",
    [
      "add-generic-password",
      "-U",
      "-a",
      account,
      "-s",
      service,
      "-l",
      `BMS Ride ${label}`,
      // Keep -w last: macOS security prompts instead of receiving the secret in argv.
      "-w",
    ],
    { stdio: "inherit" },
  );
  if (added.status !== 0) throw new Error(`${environmentName}_KEYCHAIN_SAVE_FAILED`);
  const stored = readKeychainPassword(service, account);
  if (!stored) throw new Error(`${environmentName}_KEYCHAIN_READ_FAILED`);
  return stored;
}

function runRequired(command: string, args: string[], failure: string) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(failure);
}

export function ensureRideInfrastructure() {
  console.log("Starting local PostgreSQL and Redis (existing data is preserved)...");
  runRequired(
    "docker",
    [
      "compose",
      "--env-file",
      "infrastructure/fleet-delivery/.env",
      "-f",
      "infrastructure/fleet-delivery/docker-compose.yml",
      "up",
      "-d",
      "--wait",
      "postgres",
      "redis",
    ],
    "RIDE_SANDBOX_DOCKER_START_FAILED",
  );
}

export function parseAdbDeviceSerials(output: string) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === "device")
    .map((parts) => parts[0]!);
}

export function configureRideAndroidReverse() {
  const devices = spawnSync("adb", ["devices"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (devices.error || devices.status !== 0) {
    console.log("Android adb not available; continuing for iOS/local API use.");
    return;
  }
  const serials = parseAdbDeviceSerials(devices.stdout);
  if (serials.length === 0) {
    console.log("No authorized Android device found; adb reverse skipped.");
    return;
  }
  for (const serial of serials) {
    for (const port of [SANDBOX_PORT, 8088, 8089])
      runRequired(
        "adb",
        ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`],
        `ADB_REVERSE_FAILED_${serial}_${port}`,
      );
  }
  console.log(`Android port forwarding ready for ${serials.length} device(s).`);
}

export function isOwnedRideSandboxCommand(command: string) {
  return command.includes("scripts/fleet-delivery-ride-sandbox.ts");
}

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function listenerPids() {
  const listener = spawnSync(
    "/usr/sbin/lsof",
    ["-nP", `-iTCP:${SANDBOX_PORT}`, "-sTCP:LISTEN", "-t"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return listener.stdout
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isSafeInteger(pid) && pid > 1);
}

function processWorkingDirectory(pid: number) {
  const result = spawnSync(
    "/usr/sbin/lsof",
    ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("n"))
    ?.slice(1);
}

/** Replace only a listener proven to be this repository's local ride launcher. */
export async function stopPreviousRideSandbox() {
  const pids = listenerPids();
  if (pids.length === 0) return;
  if (pids.length !== 1) throw new Error("RIDE_SANDBOX_LISTENER_NOT_UNIQUE");
  const pid = pids[0]!;
  const processInfo = spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (
    !isOwnedRideSandboxCommand(processInfo.stdout) ||
    processWorkingDirectory(pid) !== process.cwd()
  )
    throw new Error("PORT_4200_PROCESS_NOT_OWNED");

  console.log(`Replacing the previous ride sandbox process (${pid})...`);
  process.kill(pid, "SIGTERM");
  // A shell job stopped with Ctrl-Z cannot run its SIGTERM handler until resumed.
  try {
    process.kill(pid, "SIGCONT");
  } catch {
    // It may already have exited after SIGTERM.
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    await wait(100);
    if (!listenerPids().includes(pid)) return;
  }
  // Exact command and cwd were verified above; never apply this fallback to an unknown listener.
  process.kill(pid, "SIGKILL");
  for (let attempt = 0; attempt < 20; attempt++) {
    await wait(100);
    if (!listenerPids().includes(pid)) return;
  }
  throw new Error("PREVIOUS_RIDE_SANDBOX_DID_NOT_RELEASE_PORT");
}

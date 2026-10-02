import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const mac = read('deploy/retail-local/managed-runtime/macos/bms-retail-local');
const gitBash = join(process.env.LOCALAPPDATA || '', 'Programs/Git/bin/bash.exe');
const bash = process.platform === 'win32' ? gitBash : 'bash';
const hasBash = process.platform !== 'win32' || existsSync(bash);
const extract = (name: string) => {
  const start = mac.indexOf(name + '() {');
  assert.ok(start >= 0);
  return mac.slice(start, mac.indexOf('\n}', start) + 2).replaceAll('/usr/bin/plutil', 'plutil_mock');
};
function runFixture(t: TestContext, script: string, input = '') {
  const root = mkdtempSync(join(tmpdir(), 'bms-optional-activation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = join(root, 'test.sh');
  writeFileSync(fixture, script);
  return spawnSync(bash, [fixture.replaceAll('\\', '/')], {
    cwd: root, input, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
}

test('macOS setup with a configured activation URL never reads a code or contacts activation', { skip: !hasBash }, t => {
  for (const resume of [false, true]) {
    const result = runFixture(t, `set -eu
STATE_ROOT=.
BOOTSTRAP_ROOT=.
INSTALL_MODE=online
LICENSE_ID=''
printf 'https://control.example/activate' > activation-url
${resume ? 'touch activation.json' : ''}
is_https_url() { return 0; }
read() { echo UNEXPECTED_PROMPT >&2; exit 81; }
curl() { echo UNEXPECTED_NETWORK >&2; exit 82; }
plutil_mock() {
  case "$2" in
    licenseId) echo LIC-existing ;;
    evidenceEndpoint) echo https://control.example/evidence ;;
    evidenceToken) echo retained-token ;;
  esac
}
${extract('activate_license')}
activate_license
printf 'license=%s\\n' "$LICENSE_ID"
`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.trim(), resume ? 'license=LIC-existing' : 'license=');
  }
});

test('macOS post-install activation validates the receipt, preserves shop data and retains retry credentials', { skip: !hasBash }, t => {
  for (const scenario of ['success', 'transfer', 'invalid-receipt', 'cancel', 'record-failure', 'sync-failure']) {
    const result = runFixture(t, `set -eu
scenario=${scenario}
STATE_ROOT=.
BOOTSTRAP_ROOT=.
RECEIPT=installation.json
INSTALL_MODE=online
INSTANCE=bms-test
AGENT=agent_mock
LICENSE_ID=''
printf original-shop > "$RECEIPT"
printf 'https://control.example/activate' > activation-url
note() { printf '%s\\n' "$*"; }
die() { printf '%s\\n' "$*" >&2; exit 1; }
ensure_runtime() { :; }
plutil_mock() {
  if [[ $1 == -extract ]]; then
    case "$2" in
      tenantId) [[ $scenario == invalid-receipt ]] || echo tenant-original ;;
      posDeviceId) echo device-original ;;
      platformTarget) echo macos-15-arm64 ;;
      version) echo 1.2.3 ;;
      licenseCode) [[ $scenario != transfer ]] || echo LIC-old ;;
    esac
  elif [[ $1 == -insert ]]; then
    printf '%s' "$4" >> "$5"
  fi
  return 0
}
activate_license() {
  [[ $1 == interactive ]] || exit 90
  echo REDEEM
  [[ $scenario != cancel ]] || return 0
  LICENSE_ID=LIC-new
  LICENSE_EVIDENCE_ENDPOINT=https://control.example/evidence
  LICENSE_EVIDENCE_TOKEN=secret-fixture
  printf checkpoint > activation.json
}
agent_mock() {
  case "$1" in
    runtime-read) [[ ! -e "${'$'}{!#}" ]] && cp "$RECEIPT" "${'$'}{!#}" ;;
    license-record)
      [[ $BMS_LICENSE_EVIDENCE_TOKEN == secret-fixture ]] || return 91
      printf '%s\\n' "$*" > evidence-args
      [[ $scenario != record-failure ]] ;;
    runtime-write)
      [[ $scenario != sync-failure ]] || return 1
      ;;
  esac
}
${extract('activate_installed_license')}
set +e
(set -e; activate_installed_license)
status=$?
set -e
printf 'STATUS=%s\\n' "$status"
printf 'RECEIPT='; cat "$RECEIPT"; printf '\\n'
[[ ! -f evidence-args ]] || cat evidence-args
[[ ! -f activation.json ]] || echo CHECKPOINT_RETAINED
`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    if (['invalid-receipt', 'record-failure', 'sync-failure'].includes(scenario)) {
      assert.match(result.stdout, /STATUS=1/);
      assert.match(result.stdout, /RECEIPT=original-shop\n/);
    } else {
      assert.match(result.stdout, /STATUS=0/);
    }
    if (scenario === 'invalid-receipt') assert.doesNotMatch(result.stdout, /REDEEM/);
    if (scenario === 'success' || scenario === 'transfer') {
      assert.match(result.stdout, /RECEIPT=original-shopLIC-new/);
      assert.match(result.stdout, /-tenant-id tenant-original -pos-device-id device-original/);
      assert.match(result.stdout, scenario === 'transfer' ? /TRANSFER_REQUESTED/ : /INSTALLATION_REGISTERED/);
      assert.doesNotMatch(result.stdout, /CHECKPOINT_RETAINED/);
    }
    if (scenario.endsWith('failure')) assert.match(result.stdout, /CHECKPOINT_RETAINED/);
    assert.doesNotMatch(result.stdout + result.stderr, /secret-fixture/);
  }
});

test('Windows setup preserves an older redeemed license without prompting again before reboot', {
  skip: process.platform !== 'win32',
}, t => {
  const source = read('deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1');
  const start = source.indexOf('# Public setup never asks');
  const end = source.indexOf('if ($preflight.requiresReboot)', start);
  assert.ok(start > 0 && end > start);
  const root = mkdtempSync(join(tmpdir(), 'bms-activation-resume-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, 'test.ps1');
  writeFileSync(script, '\ufeff' + `
$ErrorActionPreference='Stop'
function Read-Host { throw 'unexpected prompt' }
function Invoke-RestMethod { throw 'unexpected activation request' }
$ActivationUri='https://control.example/activate'
$LicenseId='LIC-existing'
$LicenseEvidenceToken='existing-token'
${source.slice(start, end)}
if ($LicenseId -ne 'LIC-existing' -or $LicenseEvidenceToken -ne 'existing-token') { throw 'resume credential lost' }
Write-Host 'RESUME_OK'
`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /RESUME_OK/);
});

test('Windows schedules daily evidence before an optional later Admin activation, including repair', {
  skip: process.platform !== 'win32',
}, t => {
  const source = read('deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1');
  const start = source.indexOf('function Register-LicenseEvidenceTask');
  const end = source.indexOf('function Show-SetupCompletion', start);
  assert.ok(start > 0 && end > start);
  const root = mkdtempSync(join(tmpdir(), 'bms-license-tasks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, 'test.ps1');
  writeFileSync(script, '\ufeff' + `
$ErrorActionPreference='Stop'
$installedAgent='fixture-agent.exe'; $InstallRoot='C:\\fixture'; $ActivationUri=''; $LicenseId=''
$script:scheduled=@()
function New-ScheduledTaskAction { param($Execute,$Argument); return @{Execute=$Execute;Argument=$Argument} }
function New-ScheduledTaskTrigger { param([switch]$Daily,$At); return @{Daily=$Daily;At=$At} }
function New-ScheduledTaskSettingsSet { param([switch]$StartWhenAvailable,$ExecutionTimeLimit); return @{} }
function New-ScheduledTaskPrincipal { param($UserId,$LogonType,$RunLevel); return @{} }
function Register-ScheduledTask { param($TaskName,$Action,$Trigger,$Principal,$Settings,[switch]$Force); $script:scheduled+= $TaskName }
${source.slice(start, end)}
Register-LicenseUIBridge
if ('BMS Retail Local License Evidence' -notin $script:scheduled) { throw 'missing pre-activation evidence task' }
if ('BMS Retail Local License UI' -in $script:scheduled) { throw 'bridge needs trusted endpoint' }
Write-Host 'TASKS_OK'
`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /TASKS_OK/);
  const repair = source.slice(source.indexOf("$script:BmsSetupStage = 'repair-existing-install'"), source.indexOf('Write-Step 1'));
  assert.match(repair, /Register-LicenseUIBridge/);
});

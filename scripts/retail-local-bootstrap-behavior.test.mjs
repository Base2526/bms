import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(join(repo, path), 'utf8');
function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'bms-bootstrap-behavior-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 60000, ...options });
}

test('Unix bootstrap entrypoints have LF shebangs, including extensionless commands', () => {
  for (const directory of ['managed-runtime/linux', 'managed-runtime/macos', 'pos-online/linux']) {
    const root = join(repo, 'deploy/retail-local', directory);
    for (const name of readdirSync(root)) {
      if (!/^(?:bms-[^.]+|postinstall[^.]*)$|\.(sh|command)$/.test(name)) continue;
      const source = readFileSync(join(root, name), 'utf8');
      assert.ok(source.startsWith('#!'), `${directory}/${name}: missing shebang`);
      assert.ok(!source.includes('\r'), `${directory}/${name}: CRLF breaks native launch`);
    }
  }
});

test('macOS renders omitted progress fields, retry, heartbeat, and completion', {
  skip: process.platform !== 'darwin',
}, t => {
  const root = workspace(t);
  const events = [
    { phase: 'connect', component: 'desktop', percent: 0 },
    { phase: 'download', component: 'desktop', percent: 50, componentCompletedBytes: 1048576, componentTotalBytes: 2097152, heartbeat: true },
    { phase: 'retry', component: 'desktop', percent: 50, retryAfterSeconds: 2 },
    { phase: 'verify', component: 'desktop', percent: 100 },
    { phase: 'cached', component: 'desktop', percent: 100 },
    { phase: 'staged', percent: 100 },
  ].map(event => `BMS_PROGRESS ${JSON.stringify(event)}`).join('\n') + '\n';
  const controller = read('deploy/retail-local/managed-runtime/macos/bms-retail-local');
  const renderer = controller.match(/render_stage_output\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(renderer, 'production controller renderer missing');
  const pos = read('deploy/retail-local/managed-runtime/macos/bms-pos-online-setup.command');
  const posLoop = pos.match(/\| (while IFS= read -r line; do[\s\S]*?\n  done)/)?.[1];
  assert.ok(posLoop, 'production POS renderer missing');
  for (const [name, script] of [
    ['server', `${renderer}\nrender_stage_output "$1"`],
    ['pos', `stage_output=$1\n${posLoop}`],
  ]) {
    const output = join(root, `${name}.jsonl`);
    const result = run('/bin/bash', ['-c', `set -euo pipefail\n${script}`, 'test', output], { input: events });
    assert.equal(result.status, 0, `${name}: ${result.stderr}\n${result.stdout}`);
    assert.match(result.stdout, /1\/2 MiB/);
    assert.match(result.stdout, /100%/);
    assert.match(result.stdout, /2s/);
    assert.ok(!/Could not extract|syntax error|No value/.test(result.stdout));
    assert.equal(readFileSync(output, 'utf8'), events, 'lost stage result evidence');
  }
});

for (const scenario of ['success', 'offline', 'signature', 'download', 'child-failure', 'cancel']) {
  test(`Windows POS executes setup and reports ${scenario} truthfully`, {
    skip: process.platform !== 'win32',
  }, t => {
    const root = workspace(t);
    const bootstrap = join(root, 'bootstrap');
    mkdirSync(bootstrap);
    const agent = join(bootstrap, 'agent.ps1');
    writeFileSync(agent, `
if ($args[0] -eq 'verify-release') {
  if ($env:BMS_TEST_SCENARIO -eq 'signature') { $global:LASTEXITCODE=42; 'invalid signature'; return }
  $global:LASTEXITCODE=0; '{"releaseVersion":"1.0.0-test"}'; return
}
$release=Join-Path $env:LOCALAPPDATA 'BMS\\POSBootstrap\\releases\\1.0.0-test'
New-Item -ItemType Directory -Force $release | Out-Null
[IO.File]::WriteAllText((Join-Path $release 'desktop.artifact.part'), 'partial')
if ($env:BMS_TEST_SCENARIO -eq 'download') { $global:LASTEXITCODE=43; 'download interrupted'; return }
[IO.File]::WriteAllText((Join-Path $release 'desktop.artifact'), 'verified executable fixture')
'BMS_PROGRESS {"phase":"staged","percent":100,"completedBytes":27,"totalBytes":27}'
$global:LASTEXITCODE=0
`);
    const keyring = join(bootstrap, 'keys.json');
    writeFileSync(keyring, '{}');
    const harness = join(root, 'harness.ps1');
    writeFileSync(harness, `
param($Script, $Agent, $Keyring, $ErrorFile)
$ErrorActionPreference='Stop'
function Invoke-WebRequest {
  param($Uri, $OutFile, [switch]$UseBasicParsing, [int]$TimeoutSec)
  if ($TimeoutSec -le 0 -or $TimeoutSec -gt 60) { throw 'manifest timeout missing' }
  if ($env:BMS_TEST_SCENARIO -eq 'offline') { throw 'network unavailable' }
  [IO.File]::WriteAllText($OutFile, 'signed envelope fixture')
}
function Start-Process {
  param($FilePath, [switch]$Wait, [switch]$PassThru)
  if (-not (Test-Path -LiteralPath $FilePath)) { throw 'verified installer missing' }
  [IO.File]::WriteAllText((Join-Path $env:LOCALAPPDATA 'launched'), 'yes')
  $code=0
  if ($env:BMS_TEST_SCENARIO -eq 'child-failure') { $code=23 }
  if ($env:BMS_TEST_SCENARIO -eq 'cancel') { $code=1602 }
  return [pscustomobject]@{ExitCode=$code}
}
& $Script -ManifestUri 'https://release.example.invalid/release.json' -PlatformTarget windows-11-x64 -AgentPath $Agent -KeyringPath $Keyring -ErrorFile $ErrorFile
exit $LASTEXITCODE
`);
    const errorFile = join(root, 'error.txt');
    const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness,
      join(repo, 'deploy/retail-local/pos-online/windows/install-pos-online.ps1'), agent, keyring, errorFile], {
      env: { ...process.env, LOCALAPPDATA: root, BMS_TEST_SCENARIO: scenario },
    });
    assert.equal(result.error, undefined, String(result.error));
    const success = scenario === 'success';
    assert.equal(result.status === 0, success, result.stdout + result.stderr);
    assert.equal(result.stdout.includes('BMS POS installation completed.'), success);
    assert.equal(existsSync(join(root, 'launched')), ['success', 'child-failure', 'cancel'].includes(scenario));
    if (!success) assert.ok(readFileSync(errorFile, 'utf8').length > 0, 'missing actionable error');
    if (scenario === 'download') assert.ok(existsSync(join(root, 'BMS/POSBootstrap/releases/1.0.0-test/desktop.artifact.part')));
  });
}

for (const product of ['pos', 'server']) {
test(`compiled Windows ${product} EXE fails when its child setup fails or is cancelled`, {
  skip: process.platform !== 'win32' || !process.env.CI || !process.env.BMS_INNO_COMPILER,
}, t => {
  const root = workspace(t);
  const bundle = join(root, 'bundle');
  mkdirSync(bundle);
  writeFileSync(join(bundle, 'bms-runtime-agent.exe'), 'packaging fixture');
  writeFileSync(join(bundle, 'trusted-release-keys.json'), '{}');
  const iss = product === 'pos'
    ? 'deploy/retail-local/pos-online/windows/BMSPOSOnline.iss'
    : 'deploy/retail-local/managed-runtime/windows/BMSRetailLocal.iss';
  if (product === 'server') {
    for (const match of read(iss).matchAll(/Source: "\{#BuildRoot\}\\([^"]+)"/g)) {
      const path = resolve(bundle, ...match[1].split('\\'));
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, 'packaging fixture');
    }
    writeFileSync(join(bundle, 'uninstall-managed-runtime.ps1'), 'exit 0');
  }
  writeFileSync(join(bundle, product === 'pos' ? 'install-pos-online.ps1' : 'run-managed-runtime.ps1'), `
param($ManifestUri, $PlatformTarget, $AgentPath, $KeyringPath, $ErrorFile, $InstallScript, $LogFile)
[IO.File]::WriteAllText($ErrorFile, 'Child setup was executed ' + [char]0x0E17 + [char]0x0E14 + [char]0x0E2A + [char]0x0E2D + [char]0x0E1A, [Text.UTF8Encoding]::new($false))
exit ([int]([Uri]$ManifestUri).AbsolutePath.Trim('/'))
`);
  for (const code of product === 'server' ? [0, 23, 1602, 3010] : [0, 23, 1602]) {
    const name = `probe-${code}`;
    const compiled = run(process.env.BMS_INNO_COMPILER, [
      `/DBuildRoot=${bundle}`, `/DOutputRoot=${root}`, '/DProductVersion=0.0.0-ci',
      `/DManifestUri=https://example.invalid/${code}`, '/DPlatformTarget=windows-11-x64',
      `/DArtifactBaseFilename=${name}`, resolve(repo, iss),
    ]);
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const log = join(root, `${name}.log`);
    const installed = join(root, `installed-${code}`);
    try {
      const result = run(join(root, `${name}.exe`), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/DIR=${installed}`, `/LOG=${log}`]);
      assert.equal(result.error, undefined, String(result.error));
      assert.equal(result.status === 0, code === 0 || code === 3010, readFileSync(log, 'utf8'));
      if (code === 23 || code === 1602) {
        const output = readFileSync(log, 'utf8');
        assert.match(output, /Child setup was executed/);
        assert.ok(output.includes('\u0e17\u0e14\u0e2a\u0e2d\u0e1a'), 'Inno must preserve Thai error text');
        assert.doesNotMatch(output, /Runtime error|raised an exception/);
      }
    } finally {
      const uninstaller = join(installed, 'unins000.exe');
      if (existsSync(uninstaller)) run(uninstaller, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']);
    }
  }
});
}

test('Windows uninstall completes on a partial installation and preserves data', {
  skip: process.platform !== 'win32' || !process.env.CI,
}, t => {
  const root = workspace(t);
  const state = join(root, 'shop');
  mkdirSync(state);
  writeFileSync(join(state, 'data-sentinel'), 'keep shop data');
  writeFileSync(join(state, '.env'), 'keep secrets');
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    join(repo, 'deploy/retail-local/managed-runtime/windows/uninstall-managed-runtime.ps1'),
    '-InstallRoot', state, '-LogFile', join(root, 'uninstall.log')], { timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(state, 'data-sentinel'), 'utf8'), 'keep shop data');
  assert.equal(readFileSync(join(state, '.env'), 'utf8'), 'keep secrets');
});

test('Windows first-install accepts reboot-required DISM and recognizes UTF-16 WSL names', {
  skip: process.platform !== 'win32',
}, t => {
  const root = workspace(t);
  const source = read('deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1');
  const enableFeatures = source.match(/if \(\$preflight.requiresReboot\) \{\r?\n([\s\S]+?)  \$resumePath/)?.[1];
  const wsl = source.match(/function Invoke-WslCommand\([\s\S]*?\r?\n\}/)?.[0];
  assert.ok(enableFeatures && wsl);
  const script = join(root, 'features.ps1');
  // The source contains Thai messages, so Windows PowerShell 5.1 needs a BOM.
  writeFileSync(script, '\uFEFF' + `
$ErrorActionPreference='Stop'
function dism.exe { $global:LASTEXITCODE=[int]$env:BMS_DISM_RESULT }
${enableFeatures}
${wsl}
function wsl.exe {
  [string]::Join([char]0, [char[]]'BMSRuntime') + [char]0
  $global:LASTEXITCODE=0
}
$result=Invoke-WslCommand -Arguments @('--list', '--quiet') -Quiet
if ($result.ExitCode -ne 0 -or $result.Output.Count -ne 1 -or $result.Output[0] -cne 'BMSRuntime') {
  throw 'Existing WSL distribution was not recognized'
}
exit 0
`);
  for (const code of [0, 3010, 5]) {
    const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      env: { ...process.env, BMS_DISM_RESULT: String(code) },
    });
    assert.equal(result.status === 0, code !== 5, result.stdout + result.stderr);
  }
});

test('macOS uninstall bounds a stuck VM stop and preserves shop data', {
  skip: process.platform !== 'darwin',
}, t => {
  const root = workspace(t);
  const source = read('deploy/retail-local/managed-runtime/macos/bms-retail-local');
  const timeout = source.match(/run_with_timeout\(\) \{[\s\S]*?\n\}/)?.[0];
  const uninstall = source.match(/uninstall_runtime\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(timeout && uninstall);
  mkdirSync(join(root, 'vm/instance'), { recursive: true });
  writeFileSync(join(root, 'data-sentinel'), 'keep shop data');
  writeFileSync(join(root, '.env'), 'keep secrets');
  writeFileSync(join(root, 'launch.plist'), 'fixture');
  writeFileSync(join(root, 'limactl'), '#!/bin/sh\nexec sleep 60\n', { mode: 0o755 });
  const result = run('/bin/bash', ['-c', `set -euo pipefail
STATE_ROOT=$1; LIMA_HOME="$1/vm"; INSTANCE=instance; LIMACTL="$1/limactl"
RECEIPT="$1/no-receipt"; INSTALL_MODE=online; AGENT="$1/missing-agent"
LAUNCH_AGENT="$1/launch.plist"; LAUNCH_LABEL=fixture
die() { echo "$*" >&2; exit 1; }
note() { echo "$*"; }
uninstall_step() { echo "$*"; }
launchctl() { return 0; }
${timeout}
${uninstall}
uninstall_runtime
`, 'test', root], { timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(root, 'launch.plist')), false);
  assert.equal(readFileSync(join(root, 'data-sentinel'), 'utf8'), 'keep shop data');
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'keep secrets');
  assert.ok(existsSync(join(root, 'vm/instance')));
});

test('Windows atomic metadata replaces torn pending files and preserves the old file on failure', {
  skip: process.platform !== 'win32',
}, t => {
  const root = workspace(t);
  const source = read('deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1');
  const writer = source.match(/function Write-Utf8NoBom\([\s\S]*?\r?\n\}/)?.[0];
  assert.ok(writer);
  const harness = join(root, 'atomic.ps1');
  writeFileSync(harness, `param($Root)
$ErrorActionPreference='Stop'
${writer}
$path=Join-Path $Root 'installation.json'
[IO.File]::WriteAllText("$path.pending", 'torn')
Write-Utf8NoBom $path 'original'
$locked=[IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
$failed=$false
try { Write-Utf8NoBom $path 'new-value' } catch { $failed=$true } finally { $locked.Dispose() }
if (-not $failed -or [IO.File]::ReadAllText($path) -ne 'original') { throw 'Previous receipt was lost' }
Write-Utf8NoBom $path 'new-value'
if ([IO.File]::ReadAllText($path) -ne 'new-value' -or (Test-Path "$path.pending")) { throw 'Retry failed' }
`);
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness, root]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('Windows retries unregistered WSL imports without deleting an orphaned disk', {
  skip: process.platform !== 'win32',
}, t => {
  const root = workspace(t);
  const source = read('deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1');
  const block = source.match(/\$installedDistroResult = Invoke-WslCommand[\s\S]*?(?=\$taskName =)/)?.[0];
  assert.ok(block);
  mkdirSync(join(root, 'wsl'));
  writeFileSync(join(root, 'wsl/ext4.vhdx'), 'preserve orphaned disk');
  const harness = join(root, 'import.ps1');
  writeFileSync(harness, '\uFEFF' + `param($InstallRoot)
$ErrorActionPreference='Stop'
$distroName='BMSRuntime'; $runtime=@{path='verified-runtime.artifact'}
function Invoke-WslCommand {
  param($Arguments, [switch]$Quiet)
  if ($Arguments[0] -eq '--list') { return @{ExitCode=0; Output=@()} }
  [IO.File]::WriteAllText((Join-Path $Arguments[2] 'partial.vhdx'), 'partial import')
  return @{ExitCode=1; Output=@('simulated interruption')}
}
foreach ($attempt in 1..2) {
  try { & { ${block} }; throw 'Expected import failure' }
  catch { if ($_.Exception.Message -notmatch 'simulated interruption') { throw } }
}
if (@(Get-ChildItem $InstallRoot -Directory -Filter 'wsl-import-*').Count -ne 2) { throw 'Retry reused a partial import directory' }
`);
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness, root]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(root, 'wsl/ext4.vhdx'), 'utf8'), 'preserve orphaned disk');
});

test('Linux repeat setup recognizes a completed shop without provisioning it again', {
  skip: process.platform !== 'linux',
}, t => {
  const root = workspace(t);
  const source = read('deploy/retail-local/managed-runtime/linux/install-managed-runtime.sh');
  const block = source.match(/if \[\[ -f \$RUNTIME_ROOT\/installation.json \]\]; then[\s\S]*?\nfi/)?.[0];
  assert.ok(block);
  const receipt = JSON.stringify({version: '1.0.0', tenantId: 'shop', posDeviceId: 'register'});
  writeFileSync(join(root, 'installation.json'), receipt);
  const result = run('/bin/bash', ['-c', `set -euo pipefail
RUNTIME_ROOT=$1
die() { echo "$*" >&2; exit 1; }
systemctl() { echo "service:$*"; }
bms-localctl() { echo "health:$*"; }
${block}
echo 'must-not-reprovision'
`, 'test', root]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /health:doctor/);
  assert.doesNotMatch(result.stdout, /must-not-reprovision/);
  assert.equal(readFileSync(join(root, 'installation.json'), 'utf8'), receipt);
});

test('macOS resumes the final launch step after a receipt has already been written', {
  skip: process.platform !== 'darwin',
}, t => {
  const root = workspace(t);
  const source = read('deploy/retail-local/managed-runtime/macos/bms-retail-local');
  const setup = source.match(/setup_runtime\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(setup);
  writeFileSync(join(root, 'installation.json'), '{}');
  const result = run('/bin/bash', ['-c', `set -euo pipefail
RECEIPT="$1/installation.json"
require_bootstrap() { :; }
ensure_runtime() { echo resumed-runtime; }
wait_for_guest_doctor() { echo checked-health; }
guest() { return 0; }
provision_shop() { echo reused-checkpoint; }
launch_pos_desktop() { echo opened-pos; }
note() { :; }
${setup}
setup_runtime
`, 'test', root]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /resumed-runtime[\s\S]*checked-health[\s\S]*reused-checkpoint[\s\S]*opened-pos/);
});

test('macOS does not use null or plutil diagnostics as a recovered device token', {
  skip: process.platform !== 'darwin',
}, t => {
  const root = workspace(t);
  const source = read('deploy/retail-local/managed-runtime/macos/bms-retail-local');
  const assignment = source.match(/    PROVISION_DEVICE_TOKEN=\$\([^\n]+\n    \[\[ \$PROVISION_DEVICE_TOKEN[^\n]+/)?.[0];
  assert.ok(assignment);
  for (const value of [{}, {deviceToken: null}, {deviceToken: 'pos_verified'}]) {
    const path = join(root, 'checkpoint.json');
    writeFileSync(path, JSON.stringify(value));
    const result = run('/bin/bash', ['-c', `set -euo pipefail\ncheckpoint_file=$1\n${assignment}\nprintf '%s' "$PROVISION_DEVICE_TOKEN"`, 'test', path]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, value.deviceToken || '');
  }
});

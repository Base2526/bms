import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../', import.meta.url));
const managed = join(repo, 'deploy/retail-local/managed-runtime');
const helper = join(managed, 'setup-diagnostics.sh');
const unix = process.platform === 'linux' || process.platform === 'darwin';
const run = (command, args, options = {}) => spawnSync(command, args, {
  encoding: 'utf8', timeout: 45000, ...options,
});
function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'bms-unix-diagnostics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function inspect(t, result) {
  assert.equal(result.error, undefined, String(result.error));
  const reports = [...result.stderr.matchAll(/Support report \(review before sending\): (.+\/report\.tar\.gz)/g)];
  assert.equal(reports.length, 1, result.stdout + result.stderr);
  const path = reports[0][1];
  // The helper creates this unique directory; never remove an arbitrary reported path.
  assert.match(path, /\/(?:bms-install-report\.|report\.)[A-Za-z0-9]+\/report\.tar\.gz$/);
  t.after(() => rmSync(dirname(path), { recursive: true, force: true }));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const entries = run('tar', ['-tzf', path]);
  assert.equal(entries.status, 0, entries.stderr);
  assert.deepEqual(entries.stdout.trim().split('\n').sort(), ['README.txt', 'diagnostics.txt']);
  const extracted = run('tar', ['-xOzf', path, 'diagnostics.txt']);
  assert.equal(extracted.status, 0, extracted.stderr);
  assert.doesNotMatch(extracted.stdout, /canary|PRIVATE KEY|BASH_COMMAND|USER=|HOME=/);
  return { path, text: extracted.stdout };
}

test('Unix support archive handles explicit failures, command errors, signals and successful retry', { skip: !unix }, t => {
  const root = workspace(t);
  writeFileSync(join(root, 'VERSION'), '1.2.3-test\n');
  writeFileSync(join(root, '.env'), 'canary-env');
  writeFileSync(join(root, 'setup.log'), 'canary-customer-data');
  const script = join(root, 'setup.sh');
  writeFileSync(script, `#!/usr/bin/env bash
set -Eeuo pipefail
source "$1"
bms_diagnostics_init pos "$2" "$2/VERSION"
BMS_DIAG_STAGE=download-desktop
finish() { status=$?; trap - EXIT ERR; bms_diagnostics_finish "$status"; printf cleaned; exit "$status"; }
trap finish EXIT
trap 'exit 130' HUP INT TERM
case "$3" in
 explicit) BMS_DIAG_REASON=$'download unavailable\\npassword=canary-password\\nPIN=123456\\nhttps://canary-url.invalid/?sig=canary-signature\\n-----BEGIN PRIVATE KEY-----\\ncanary-pem\\n-----END PRIVATE KEY-----'; exit 23 ;;
 command) false ;;
 signal) kill -TERM "$$" ;;
 success) exit 0 ;;
esac
`);
  const saved = [];
  for (const [scenario, status] of [['explicit', 23], ['command', 1], ['signal', 130], ['success', 0]]) {
    const result = run('bash', [script, helper, root, scenario]);
    assert.equal(result.status, status, result.stdout + result.stderr);
    assert.match(result.stdout, /cleaned/);
    if (status === 0) {
      assert.doesNotMatch(result.stderr, /Support report/);
    } else {
      const report = inspect(t, result);
      saved.push(report.path);
      assert.match(report.text, /stage=download-desktop/);
      assert.match(report.text, /installerVersion=1.2.3-test/);
      assert.match(report.text, new RegExp(`exitCode=${status}`));
      assert.match(report.text, /diskFreeKiB=\d+/);
    }
  }
  assert.equal(new Set(saved).size, 3);
  for (const path of saved) assert.ok(existsSync(path), 'retry removed an earlier report');
});

test('Unix inventory times out and report creation failure preserves the original exit code', { skip: !unix }, t => {
  const root = workspace(t);
  const slow = join(root, 'slow.sh');
  writeFileSync(slow, '#!/bin/bash\nexec sleep 30\n', { mode: 0o755 });
  const timed = run('bash', ['-c', 'source "$1"; bms_diagnostic_probe test "$2/probe" "$2/slow.sh"', 'test', helper, root]);
  assert.equal(timed.status, 0, timed.stderr);
  assert.match(timed.stdout, /timed out/);
  const failed = run('bash', ['-c', `set -Eeuo pipefail
source "$1"
bms_diagnostics_init pos "$2" "$2/VERSION"
mktemp() { return 1; }
trap 'status=$?; trap - EXIT ERR; bms_diagnostics_finish "$status"; exit "$status"' EXIT
exit 42`, 'test', helper, root]);
  assert.equal(failed.status, 42, failed.stderr);
  assert.match(failed.stderr, /Could not save the support report/);
});

for (const product of ['linux-server', 'linux-launcher', 'linux-pos', 'macos-server', 'macos-pos']) {
  test(`${product} actual setup entrypoint generates an early-failure report`, { skip: !unix }, t => {
    const root = workspace(t);
    const bootstrap = join(root, 'bootstrap');
    mkdirSync(bootstrap);
    copyFileSync(helper, join(bootstrap, 'setup-diagnostics.sh'));
    writeFileSync(join(bootstrap, 'BOOTSTRAP_VERSION'), '1.2.3-entrypoint\n');
    const env = { ...process.env, HOME: root, SUDO_USER: '', TERM: 'xterm' };
    let args;
    if (product === 'linux-server') {
      const fixture = join(root, 'server.sh');
      writeFileSync(fixture, readFileSync(join(managed, 'linux/install-managed-runtime.sh'), 'utf8')
        .replace('/var/lib/bms-retail-local', join(root, 'state')));
      args = [fixture, 'https://example.invalid/release', bootstrap];
    } else if (product === 'linux-launcher') {
      const fixture = join(root, 'launcher.sh');
      writeFileSync(fixture, readFileSync(join(managed, 'linux/bms-retail-local-setup'), 'utf8')
        .replace('/usr/lib/bms-retail-local/bootstrap', bootstrap)
        .replace('/var/lib/bms-retail-local', join(root, 'state'))
        .replace('/etc/bms-retail-local/release-manifest-url', join(root, 'missing-manifest'))
        .replace('/etc/bms-retail-local/activation-url', join(root, 'missing-activation')));
      args = [fixture];
    } else if (product === 'linux-pos') {
      const source = readFileSync(join(repo, 'deploy/retail-local/pos-online/linux/bms-pos-online-setup'), 'utf8');
      const fixture = join(root, 'pos.sh');
      // Point the packaged file locations at a disposable missing-payload fixture.
      writeFileSync(fixture, source.replace('/usr/lib/bms-pos-bootstrap', bootstrap).replace('/var/lib/bms-pos-bootstrap', join(root, 'state')));
      args = [fixture];
    } else if (product === 'macos-server') {
      const control = join(root, 'control');
      mkdirSync(control);
      copyFileSync(helper, join(control, 'setup-diagnostics.sh'));
      writeFileSync(join(control, 'BOOTSTRAP_VERSION'), '1.2.3-entrypoint\n');
      env.BMS_RETAIL_LOCAL_SYSTEM_ROOT = root;
      env.BMS_RETAIL_LOCAL_STATE_ROOT = join(root, 'state');
      args = [join(managed, 'macos/bms-retail-local'), 'setup'];
    } else {
      const resources = join(root, 'Contents/Resources');
      mkdirSync(join(resources, 'bootstrap'), { recursive: true });
      copyFileSync(helper, join(resources, 'bootstrap/setup-diagnostics.sh'));
      writeFileSync(join(resources, 'bootstrap/BOOTSTRAP_VERSION'), '1.2.3-entrypoint\n');
      const fixture = join(resources, 'Setup.command');
      copyFileSync(join(managed, 'macos/bms-pos-online-setup.command'), fixture);
      args = [fixture];
    }
    const result = run('bash', args, { env, input: '\n' });
    const expectedCode = product === 'linux-launcher' ? 2 : 1;
    assert.equal(result.status, expectedCode, result.stdout + result.stderr);
    const report = inspect(t, result);
    assert.match(report.text, /installerVersion=1.2.3-entrypoint/);
    assert.match(report.text, new RegExp(`exitCode=${expectedCode}`));
  });
}

test('Linux DEBs include the diagnostics helper and bootstrap version', { skip: process.platform !== 'linux' }, t => {
  const root = workspace(t);
  const agent = join(root, 'agent');
  const keyring = join(root, 'keyring.json');
  writeFileSync(agent, '#!/bin/sh\nexit 0\n');
  writeFileSync(keyring, '{}');
  for (const [name, args, packageName, prefix] of [
    ['pos', [join(repo, 'deploy/retail-local/pos-online/linux/build-deb.sh'), '1.2.3-test', agent, keyring,
      'https://example.invalid/release', 'ubuntu-24.04-lts-x64', root],
      'bms-pos-online-bootstrap_1.2.3-test_amd64.deb', 'usr/lib/bms-pos-bootstrap'],
    ['server', [join(managed, 'linux/build-deb.sh'), '--version', '1.2.3-test', '--agent', agent,
      '--keyring', keyring, '--manifest-url', 'https://example.invalid/release', '--package-type', 'server', '--output-dir', root],
      'bms-retail-local-server-bootstrap_1.2.3-test_amd64.deb', 'usr/lib/bms-retail-local/bootstrap'],
    ['server-pos', [join(managed, 'linux/build-deb.sh'), '--version', '1.2.3-test', '--agent', agent,
      '--keyring', keyring, '--manifest-url', 'https://example.invalid/release', '--package-type', 'server-pos', '--output-dir', root],
      'bms-retail-local-server-pos-bootstrap_1.2.3-test_amd64.deb', 'usr/lib/bms-retail-local/bootstrap'],
  ]) {
    const built = run('bash', args);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const extracted = join(root, name);
    const unpacked = run('dpkg-deb', ['-x', join(root, packageName), extracted]);
    assert.equal(unpacked.status, 0, unpacked.stderr);
    assert.equal(readFileSync(join(extracted, prefix, 'setup-diagnostics.sh'), 'utf8'), readFileSync(helper, 'utf8'));
    assert.equal(readFileSync(join(extracted, prefix, 'BOOTSTRAP_VERSION'), 'utf8').trim(), '1.2.3-test');
  }
});

for (const platform of ['linux', 'macos']) {
  test(`${platform} POS reports an interrupted manifest download without exporting stderr`, { skip: !unix }, t => {
    const root = workspace(t);
    const resources = join(root, 'Contents/Resources');
    const bootstrap = join(resources, 'bootstrap');
    const bin = join(root, 'bin');
    mkdirSync(bootstrap, { recursive: true });
    mkdirSync(bin);
    copyFileSync(helper, join(bootstrap, 'setup-diagnostics.sh'));
    writeFileSync(join(bootstrap, 'BOOTSTRAP_VERSION'), '1.2.3-network\n');
    writeFileSync(join(bootstrap, 'trusted-release-keys.json'), '{}');
    writeFileSync(join(bootstrap, 'bms-runtime-agent'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    writeFileSync(join(bootstrap, 'manifest-url'), 'https://example.invalid/release\n');
    writeFileSync(join(bootstrap, 'platform-target'), 'ubuntu-24.04-lts-x64\n');
    const appleSilicon = process.platform === 'darwin' && run('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64']).stdout.trim() === '1';
    writeFileSync(join(bootstrap, 'PLATFORM_TARGET'), `macos-15-${appleSilicon ? 'arm64' : 'x64'}\n`);
    writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho "canary-secret-stderr" >&2\nexit 28\n', { mode: 0o755 });
    const fixture = join(resources, 'Setup.command');
    if (platform === 'linux') {
      const source = readFileSync(join(repo, 'deploy/retail-local/pos-online/linux/bms-pos-online-setup'), 'utf8');
      writeFileSync(fixture, source.replace('/usr/lib/bms-pos-bootstrap', bootstrap)
        .replace('/var/lib/bms-pos-bootstrap', join(root, 'state'))
        .replace('[[ $EUID -eq 0 ]]', 'true'));
    } else {
      copyFileSync(join(managed, 'macos/bms-pos-online-setup.command'), fixture);
    }
    const result = run('bash', [fixture], { input: '\n', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: root, SUDO_USER: '', TERM: 'xterm' } });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /canary-secret-stderr/);
    const report = inspect(t, result);
    assert.match(report.text, /stage=download-manifest/);
  });
}

test('Linux sudo report is readable by the operator after private staging files are removed', {
  skip: process.platform !== 'linux' || process.getuid?.() !== 0,
}, t => {
  const root = workspace(t);
  const user = run('id', ['-u', 'nobody']);
  assert.equal(user.status, 0, user.stderr);
  const result = run('bash', ['-c', `set -Eeuo pipefail
source "$1"
bms_diagnostics_init pos "$2" "$2/VERSION"
trap 'status=$?; trap - EXIT ERR; bms_diagnostics_finish "$status"; exit "$status"' EXIT
exit 23`, 'test', helper, root], { env: { ...process.env, SUDO_USER: 'nobody' } });
  assert.equal(result.status, 23, result.stderr);
  const report = inspect(t, result);
  assert.equal(statSync(report.path).uid, Number(user.stdout.trim()));
  assert.equal(statSync(dirname(report.path)).uid, Number(user.stdout.trim()));
  assert.equal(existsSync(join(dirname(report.path), 'content')), false);
  assert.equal(existsSync(join(dirname(report.path), 'probe')), false);
});

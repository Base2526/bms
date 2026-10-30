// Local-only integration environment. Clone a STOPPED PostgreSQL 16 volume;
// never run migrations against the source or rebuild the historical schema by hand.
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = fileURLToPath(new URL('../../', import.meta.url));
const web = path.join(repo, 'apps/web');
const require = createRequire(path.join(web, 'package.json'));
const { Client } = require('pg');
const postgres = 'bms-retail-commercial-full-postgres-test';
const redis = 'bms-retail-commercial-redis-test';
const volume = 'bms-retail-commercial-full-test-pgdata';
const label = 'retail-local-commercial-test';
export const output = path.join(repo, '.test-output/retail-local-commercial-integration');
const stateFile = path.join(output, 'private-state.json');

function command(program, args, options = {}) {
  const r = spawnSync(program, args, { cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...options });
  if (r.status !== 0) throw new Error(`${program} failed (${r.status}): ${r.stderr || r.error?.message || 'see output'}`);
  return r.stdout?.trim() || '';
}
const docker = (...args) => command('docker', args);
function inspect(name, kind = 'container') {
  const r = spawnSync('docker', [kind, 'inspect', name], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? JSON.parse(r.stdout)[0] : null;
}
function verifyContainer(name) {
  const item = inspect(name);
  if (!item || item.Config.Labels?.['bms.purpose'] !== label) throw new Error(`Refusing unowned container ${name}`);
  return item;
}
export async function localState() {
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  if (state.database !== 'bms_retail_local_commercial_test' || state.port !== 55442) throw new Error('Unexpected test target');
  verifyContainer(postgres);
  return state;
}
export function localEnv(state) {
  return { ...process.env, POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: '55442',
    POSTGRES_DB: state.database, POSTGRES_USER: 'app', POSTGRES_PASSWORD: state.password,
    REDIS_URL: 'redis://127.0.0.1:56390', JWT_SECRET: state.jwt,
    BMS_SECRET_KEY: state.secret,
    COOKIE_SECURE: 'false', BMS_DEPLOYMENT_MODE: 'cloud',
    NEXT_PUBLIC_BASE_URL: 'http://localhost:3011',
    BMS_TEST_OUTPUT_DIR: output };
}
export function localClient(state) {
  return new Client({ host: '127.0.0.1', port: state.port, database: state.database, user: 'app', password: state.password });
}

async function setup(sourceVolume, sourceDatabase) {
  docker('info', '--format', '{{.ServerVersion}}');
  await mkdir(output, { recursive: true });
  let target = inspect(postgres);
  if (!target) {
    if (!sourceVolume || !sourceDatabase || !/^[a-zA-Z0-9_.-]+$/.test(sourceVolume) || !/^[a-zA-Z0-9_]+$/.test(sourceDatabase)) {
      throw new Error('Usage: setup <stopped-source-volume> <source-database>');
    }
    if (docker('ps', '-q', '--filter', `volume=${sourceVolume}`)) throw new Error('Source volume is in use; stop its database before taking a snapshot');
    const source = inspect(sourceVolume, 'volume');
    if (!source) throw new Error('Source volume does not exist');
    if (inspect(volume, 'volume')) throw new Error('Destination volume already exists without its container; inspect it manually, never overwrite it');
    docker('volume', 'create', '--label', `bms.purpose=${label}`, volume);
    docker('run', '--rm', '--network', 'none', '--mount', `type=volume,source=${sourceVolume},target=/source,readonly`,
      '--mount', `type=volume,source=${volume},target=/target`, '--entrypoint', 'sh', 'postgres:16-alpine', '-c',
      'test "$(cat /source/PG_VERSION)" = 16 && test -z "$(ls -A /target)" && cp -a /source/. /target/');
    docker('run', '-d', '--name', postgres, '--label', `bms.purpose=${label}`, '-p', '127.0.0.1:55442:5432',
      '--mount', `type=volume,source=${volume},target=/var/lib/postgresql/data`, 'postgres:16-alpine');
  } else {
    verifyContainer(postgres);
    if (!target.State.Running) docker('start', postgres);
  }
  for (let i = 0; i < 30; i++) {
    const r = spawnSync('docker', ['exec', postgres, 'pg_isready', '-U', 'app'], { windowsHide: true, stdio: 'ignore' });
    if (r.status === 0) break;
    if (i === 29) throw new Error('Test PostgreSQL did not become ready');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const psql = (sql, database = 'postgres') => command('docker', ['exec', '-i', postgres, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'app', '-d', database], { input: sql });
  let state;
  try { state = await localState(); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!sourceDatabase || !/^[a-zA-Z0-9_]+$/.test(sourceDatabase)) throw new Error('Specify the source database for the first setup');
    state = { database: 'bms_retail_local_commercial_test', port: 55442,
      password: randomBytes(32).toString('hex'), jwt: randomBytes(48).toString('hex'),
      userPassword: randomBytes(24).toString('hex'), adminId: randomUUID(), staffId: randomUUID() };
    psql(`ALTER DATABASE "${sourceDatabase}" RENAME TO "${state.database}";`);
    // Input goes through stdin, not command arguments or logs. Only the cloned cluster is changed.
    psql(`ALTER ROLE app PASSWORD '${state.password}';`);
    await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
  }
  const redisInfo = inspect(redis);
  if (!state.secret) {
    // Dedicated test key; never borrow the source installation's encryption key.
    state.secret = randomBytes(32).toString('hex');
    await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
  }
  if (!redisInfo) docker('run', '-d', '--name', redis, '--label', `bms.purpose=${label}`, '-p', '127.0.0.1:56390:6379', 'redis:7-alpine');
  else { verifyContainer(redis); if (!redisInfo.State.Running) docker('start', redis); }
  console.log('Isolated PostgreSQL and Redis ready on loopback; credentials saved only in ignored test output.');
  const env = { ...localEnv(state), BMS_DEPLOYMENT_MODE: 'retail-local', BMS_MIGRATIONS_DIR: path.join(repo, 'db/migrations'), BMS_DB_INIT_FILE: path.join(repo, 'db/init.sql') };
  command(process.execPath, [path.join(web, 'scripts/retail-local-migrate.mjs')], { env, stdio: 'inherit' });
  const c = localClient(state);
  await c.connect();
  try {
    const tenant = (await c.query('SELECT id FROM bms_tenants WHERE active = TRUE ORDER BY id LIMIT 1')).rows[0]?.id;
    if (!tenant) throw new Error('Restored database requires an active tenant fixture');
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(state.userPassword, 10);
    for (const [id, name, platform] of [[state.adminId, 'platform', true], [state.staffId, 'staff', false]]) {
      await c.query(`INSERT INTO users(id,name,email,username,password_hash,role,tenant_id,is_platform_admin,is_email_verified,fake_test)
        VALUES($1,$2,$3,$4,$5,'Administrator',$6,$7,true,true)
        ON CONFLICT(id) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
      [id, `FAKE commercial ${name}`, `retail-commercial-${name}@example.invalid`, `fake-commercial-${name}`, hash, tenant, platform]);
    }
  } finally { await c.end(); }
  console.log('Schema current; two synthetic login fixtures ready. No source data changed.');
}

async function main() {
  const [action, sourceVolume, sourceDatabase] = process.argv.slice(2);
  if (action === 'setup') return setup(sourceVolume, sourceDatabase);
  const state = await localState();
  const env = localEnv(state);
  if (action === 'build') return command(process.execPath, [path.join(web, 'node_modules/next/dist/bin/next'), 'build'], { cwd: web, env, stdio: 'inherit' });
  if (action === 'db') return command(process.execPath, [path.join(repo, 'scripts/run-contract-tests.mjs'), 'db', 'retail-local-lead'], { env, stdio: 'inherit' });
  if (action === 'license-db') return command(process.execPath, [path.join(repo, 'scripts/run-contract-tests.mjs'), 'db', 'retail-local-license'], { env, stdio: 'inherit' });
  if (action === 'web') return command(process.execPath, [path.join(web, 'node_modules/next/dist/bin/next'), 'start', '-H', 'localhost', '-p', '3011'], { cwd: web, env, stdio: 'inherit' });
  if (action === 'web-local') return command(process.execPath, [path.join(web, 'node_modules/next/dist/bin/next'), 'start', '-H', 'localhost', '-p', '3012'], {
    cwd: web, env: { ...env, BMS_DEPLOYMENT_MODE: 'retail-local', NEXT_PUBLIC_BASE_URL: 'http://localhost:3012',
      BMS_LOCAL_LICENSE_UI_DIR: path.join(output, 'guide-host-unavailable') }, stdio: 'inherit' });
  if (action === 'stop') { for (const name of [postgres, redis]) { verifyContainer(name); docker('stop', name); } return; }
  throw new Error('Actions: setup <source-volume> <source-db>, db, license-db, build, web, web-local, stop');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

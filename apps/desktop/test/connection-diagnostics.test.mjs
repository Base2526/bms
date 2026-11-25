import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createConnectionJournal } from '../src/connection-diagnostics.mjs';

const keyA = 'a'.repeat(64);
const keyB = 'b'.repeat(64);
const base = { action: 'desktop.navigation.failed', code: 'POS_NETWORK', route: '/pos/app',
  outcome: 'read_failed' };

test('desktop journal persists safe offline evidence, scopes upload, and preserves rejected ACKs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bms-pos-diagnostic-'));
  const filePath = path.join(dir, 'journal.json');
  try {
    const journal = createConnectionJournal({ filePath, platform: 'win32', appVersion: '0.2.14' });
    const a = await journal.append({ ...base, targetKey: keyA, message: 'PIN 1234',
      token: 'pos_SECRET', rawUrl: 'https://shop/?customer=private', nativeCode: -106 });
    await journal.append({ ...base, targetKey: keyB });
    assert.equal(await journal.append({ ...base, targetKey: keyA, code: 'POS_CUSTOMER_0900000000' }), null);
    const disk = await readFile(filePath, 'utf8');
    assert.ok(disk.includes(a.eventId));
    for (const secret of ['1234', 'pos_SECRET', 'customer=private', '0900000000']) assert.ok(!disk.includes(secret));
    const restarted = createConnectionJournal({ filePath, platform: 'win32', appVersion: '0.2.14' });
    const sent = [];
    const result = await restarted.flush(keyA, async events => {
      sent.push(...events);
      return { results: events.map((event, index) => ({ index, eventId: event.eventId,
        status: 'rejected', reason: 'event_too_old' })) };
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].context.nativeCode, '-106');
    assert.equal(result.rejected, 1);
    assert.equal((await restarted.summary()).pending, 1);
    assert.ok((await readFile(filePath, 'utf8')).includes('event_too_old'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid server acknowledgement cannot erase a pending event; export remains available', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bms-pos-diagnostic-'));
  const filePath = path.join(dir, 'journal.json');
  try {
    const journal = createConnectionJournal({ filePath, platform: 'linux', appVersion: '0.2.14' });
    await journal.append({ ...base, targetKey: keyA });
    const result = await journal.flush(keyA, async () => ({ results: [] }));
    assert.equal(result.reason, 'invalid_acknowledgement');
    assert.equal((await journal.summary()).pending, 1);
    const exported = path.join(dir, 'export.json');
    await journal.exportTo(exported);
    const file = JSON.parse(await readFile(exported, 'utf8'));
    assert.equal(file.events.length, 1);
    assert.equal(file.lastUploadFailure, 'invalid_acknowledgement');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('loading an existing journal strips unexpected text and reports invalid rows', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bms-pos-diagnostic-'));
  const filePath = path.join(dir, 'journal.json');
  try {
    await writeFile(filePath, JSON.stringify({ version: 1, events: [
      { eventId: randomUUID(), occurredAt: new Date().toISOString(), action: base.action,
        status: 'error', correlationId: null, targetKey: keyA, delivery: 'pending',
        message: 'PIN 1234', context: { errorCode: 'POS_NETWORK', route: '/pos/app',
          authorization: 'Bearer secret', body: 'card 4111' } },
      { eventId: 'bad', occurredAt: 'bad', action: 'customer.private', context: { token: 'secret' } },
    ], gaps: [{ reason: 'local_capacity', count: 1, from: new Date().toISOString(),
      to: new Date().toISOString(), message: 'customer phone 0900000000' }] }));
    const journal = createConnectionJournal({ filePath, platform: 'win32', appVersion: '0.2.14' });
    const exported = path.join(dir, 'export.json');
    await journal.exportTo(exported);
    const text = await readFile(exported, 'utf8');
    for (const secret of ['1234', 'Bearer secret', 'card 4111', '0900000000'])
      assert.ok(!text.includes(secret));
    const persisted = await readFile(filePath, 'utf8');
    for (const secret of ['1234', 'Bearer secret', 'card 4111', '0900000000'])
      assert.ok(!persisted.includes(secret));
    const data = JSON.parse(text);
    assert.equal(data.events.length, 1);
    assert.ok(data.gaps.some(gap => gap.reason === 'journal_invalid_event' && gap.count === 1));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('journal capacity loss is explicit in the export', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bms-pos-diagnostic-'));
  const filePath = path.join(dir, 'journal.json');
  try {
    const journal = createConnectionJournal({ filePath, platform: 'linux', appVersion: '0.2.14' });
    for (let index = 0; index < 501; index += 1) await journal.append({ ...base, targetKey: keyA });
    const exported = path.join(dir, 'export.json');
    await journal.exportTo(exported);
    const data = JSON.parse(await readFile(exported, 'utf8'));
    assert.equal(data.events.length, 500);
    assert.ok(data.gaps.some(gap => gap.reason === 'local_capacity' && gap.count === 1
      && gap.from && gap.to));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('opening a 31-day-old journal persists its retention gap without another outage', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bms-pos-diagnostic-'));
  const filePath = path.join(dir, 'journal.json');
  try {
    const journal = createConnectionJournal({ filePath, platform: 'linux', appVersion: '0.2.14' });
    await journal.append({ ...base, targetKey: keyA });
    const data = JSON.parse(await readFile(filePath, 'utf8'));
    data.events[0].occurredAt = new Date(Date.now() - 31 * 86400_000).toISOString();
    await writeFile(filePath, JSON.stringify(data));
    const restarted = createConnectionJournal({ filePath, platform: 'linux', appVersion: '0.2.14' });
    assert.equal((await restarted.summary()).pending, 0);
    const persisted = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(persisted.events.length, 0);
    assert.ok(persisted.gaps.some(gap => gap.reason === 'local_retention' && gap.count === 1));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

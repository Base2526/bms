import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } = await import(pathToFileURL(webRequire.resolve('@apollo/client/core/index.js')).href);
import { aiCreditCapacity, aiUsageRefreshLink, refreshAiUsage, rootFields } from '../apps/web/lib/aiUsageClient';

test('usage selection follows root aliases/fragments and never treats a nested field as an operation', () => {
  assert.deepEqual(rootFields(gql`query { ...Usage } fragment Usage on Query { quota: bmsAiUsage { count } other { bmsWorkAssistant } }`), ['bmsAiUsage', 'other']);
  assert.equal(aiCreditCapacity({grantedCredits: 1000, bonusCredits: 0, adjustedCredits: 500, unlimited: false}), 1500);
  assert.equal(aiCreditCapacity({grantedCredits: 0, bonusCredits: 0, adjustedCredits: 0, unlimited: true}), 0);
  assert.equal(aiCreditCapacity({grantedCredits: 1000, bonusCredits: 0, adjustedCredits: -1100, unlimited: false}), 0);
});

test('a completed or failed admin AI operation refreshes the actual server balance without guessing a credit', async () => {
  let consumed = 0;
  let failNext = false;
  const readers = new Set<() => void>();
  const transport = new ApolloLink(operation => new Observable(observer => {
    if (rootFields(operation.query).includes('bmsAiUsage')) {
      observer.next({data: {bmsAiUsage: {__typename: 'BmsAiUsage', count: consumed}}});
      observer.complete();
      for (const resolve of readers) resolve();
      readers.clear();
    } else {
      consumed += 1;
      if (failNext) observer.error(new Error('response lost after provider work'));
      else { observer.next({data: {bmsWorkAssistant: {reply: 'ok'}}}); observer.complete(); }
    }
  }));
  const client = new ApolloClient({cache: new InMemoryCache(), link: ApolloLink.from([
    aiUsageRefreshLink(() => { void refreshAiUsage(client); }), transport,
  ])});
  const query = client.watchQuery({query: gql`query Quota { bmsAiUsage { count } }`, fetchPolicy: 'network-only'});
  let visible = -1;
  const sub = query.subscribe(result => { visible = result.data?.bmsAiUsage?.count ?? -1; });
  await query.refetch();
  const mutation = gql`mutation { bmsWorkAssistant(input: {message: "test"}) { reply } }`;
  for (const failed of [false, true]) {
    failNext = failed;
    const refreshed = new Promise<void>(resolve => readers.add(resolve));
    const request = client.mutate({mutation});
    if (failed) await assert.rejects(request); else await request;
    await refreshed;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(visible, consumed);
  }
  sub.unsubscribe();
  client.stop();
});

import { ApolloLink, Observable, execute, gql } from '@apollo/client';
import { operationTimeoutLink } from '../src/graphql/operationTimeoutLink';
import { isDecidedRejection, PosConnectionError } from '../src/lib/operation';

const query = gql`
  mutation Test {
    test
  }
`;
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function harness(context = {}) {
  let sink: any;
  let signal: AbortSignal;
  const stopped = jest.fn();
  const called = jest.fn();
  const terminal = new ApolloLink(
    operation =>
      new Observable(observer => {
        called();
        signal = operation.getContext().fetchOptions.signal;
        sink = observer;
        return stopped;
      }),
  );
  const next = jest.fn(),
    error = jest.fn(),
    complete = jest.fn();
  const subscription = execute(
    ApolloLink.from([operationTimeoutLink(100), terminal]),
    { query, context },
  ).subscribe({ next, error, complete });
  return {
    called,
    stopped,
    next,
    error,
    complete,
    subscription,
    sink: () => sink,
    signal: () => signal,
  };
}

test('a stalled HTTP mutation times out once without automatic resubmission', () => {
  const h = harness();
  jest.advanceTimersByTime(100);
  expect(h.error.mock.calls[0][0]).toBeInstanceOf(PosConnectionError);
  expect(isDecidedRejection(h.error.mock.calls[0][0])).toBe(false);
  expect(h.signal().aborted).toBe(true);
  expect(h.stopped).toHaveBeenCalledTimes(1);
  h.sink().next({ data: { test: true } });
  jest.advanceTimersByTime(1000);
  expect(h.next).not.toHaveBeenCalled();
  expect(h.called).toHaveBeenCalledTimes(1);
  expect(h.error).toHaveBeenCalledTimes(1);
});

test('success clears deadline and keeps the authoritative response', () => {
  const h = harness();
  h.sink().next({ data: { test: true } });
  h.sink().complete();
  jest.advanceTimersByTime(1000);
  expect(h.next).toHaveBeenCalledWith({ data: { test: true } });
  expect(h.complete).toHaveBeenCalledTimes(1);
  expect(h.error).not.toHaveBeenCalled();
});

test('an existing caller abort remains effective and an already aborted request never sends', async () => {
  const controller = new AbortController();
  const h = harness({ fetchOptions: { signal: controller.signal } });
  controller.abort();
  expect(h.error).toHaveBeenCalledTimes(1);
  expect(h.signal().aborted).toBe(true);
  const cancelled = harness({ fetchOptions: { signal: controller.signal } });
  await Promise.resolve();
  expect(cancelled.called).not.toHaveBeenCalled();
  expect(cancelled.error).toHaveBeenCalledTimes(1);
});

test('unmount unsubscribes and aborts without publishing an error or retry', () => {
  const h = harness();
  h.subscription.unsubscribe();
  jest.advanceTimersByTime(1000);
  expect(h.signal().aborted).toBe(true);
  expect(h.error).not.toHaveBeenCalled();
  expect(h.called).toHaveBeenCalledTimes(1);
});

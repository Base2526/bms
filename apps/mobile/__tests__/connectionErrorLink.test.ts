import { ApolloLink, Observable, execute, gql } from '@apollo/client';
import { connectionErrorLink } from '../src/graphql/connectionErrorLink';
import { operationTimeoutLink } from '../src/graphql/operationTimeoutLink';

const query = gql`query Read { read }`;
const mutation = gql`mutation Save { save }`;
test('an invalid error code cannot invoke object coercion or break error rendering', async () => {
  const result = await run(new ApolloLink(() => Observable.of({ errors: [{
    message: 'SECRET', extensions: { code: { toString: null } },
  }] })), mutation);
  expect(result.errors[0].message).toContain('POS_PROTOCOL');
  expect(result.errors[0].message).not.toContain('SECRET');
});
test.each(['invalid', {}, [null], [{ message: {} }]])('malformed errors are a protocol failure, not a link crash: %j', async errors => {
  await expect(run(new ApolloLink(() => Observable.of({ errors: errors as any })), mutation))
    .rejects.toThrow('POS_PROTOCOL');
});
test.each([null, {}, [], 'html'])('malformed successful data is not a committed result: %j', async data => {
  await expect(run(new ApolloLink(() => Observable.of({ data: data as any })), mutation))
    .rejects.toThrow('POS_PROTOCOL');
});
function run(terminal: ApolloLink, document = query) {
  return new Promise<any>((resolve, reject) => execute(ApolloLink.from([
    connectionErrorLink(), operationTimeoutLink(50), terminal,
  ]), { query: document }).subscribe({ next: resolve, error: reject }));
}
test.each([401, 403, 429, 503])('HTTP %s retains its status for auth handling without raw response text', async status => {
  const terminal = new ApolloLink(() => new Observable(observer => {
    observer.error(Object.assign(new Error('SECRET URL PIN'), { statusCode: status }));
  }));
  await expect(run(terminal, mutation)).rejects.toMatchObject({ statusCode: status });
  await expect(run(terminal)).rejects.not.toThrow('SECRET');
});
test('known PIN/permission rejection retains code, reason and message; internal errors are sanitized', async () => {
  const permission = { message: 'PIN ไม่ถูกต้อง', extensions: { code: 'FORBIDDEN', reason: 'INVALID_PIN' } };
  const terminal = new ApolloLink(() => Observable.of({ errors: [permission,
    { message: 'SECRET SQL', extensions: { code: 'INTERNAL_SERVER_ERROR' } }], data: null }));
  const result = await run(terminal, mutation);
  expect(result.errors[0]).toEqual(permission);
  expect(result.errors[1].extensions.code).toBe('INTERNAL_SERVER_ERROR');
  expect(result.errors[1].message).toContain('ยังยืนยันไม่ได้');
  expect(result.errors[1].message).not.toContain('SECRET');
});
test('read and write deadlines have different recovery guidance and never retry', async () => {
  jest.useFakeTimers();
  try {
    const called = jest.fn();
    const terminal = new ApolloLink(() => new Observable(() => { called(); }));
    const read = run(terminal).catch(error => error);
    const write = run(terminal, mutation).catch(error => error);
    await jest.advanceTimersByTimeAsync(51);
    expect((await read).message).toContain('ข้อมูลล่าสุด');
    expect((await read).message).not.toContain('ห้ามรับเงินซ้ำ');
    expect((await write).message).toContain('ห้ามรับเงินซ้ำ');
    expect(called).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
test('business result data is left intact', async () => {
  const data = { save: { status: 'INSUFFICIENT', reason: 'สต็อกไม่พอ' } };
  expect(await run(new ApolloLink(() => Observable.of({ data })), mutation)).toEqual({ data });
});

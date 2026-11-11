import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createContext,
  withContext,
  mergeContext,
  runInContext,
  makeLogger,
} from '../src/index.js';

test('createContext produces an empty frozen root', () => {
  const ctx = createContext();
  assert.deepEqual(mergeContext(ctx), {});
  assert.equal(ctx.parent, null);
  assert.ok(Object.isFrozen(ctx));
  assert.ok(Object.isFrozen(ctx.values));
});

test('createContext copies input and freezes it', () => {
  const input = { requestId: 'r-1' };
  const ctx = createContext(input);
  input.requestId = 'mutated';
  assert.deepEqual(mergeContext(ctx), { requestId: 'r-1' });
  assert.throws(() => { ctx.values.requestId = 'nope'; }, TypeError);
});

test('createContext rejects non-object values', () => {
  assert.throws(() => createContext('nope'), TypeError);
  assert.throws(() => createContext(null), TypeError);
  assert.throws(() => createContext([]), TypeError);
});

test('withContext layers and child overrides parent', () => {
  const root = createContext({ tenant: 'acme', requestId: 'r-1' });
  const child = withContext(root, { requestId: 'r-2', userId: 'u-9' });
  assert.deepEqual(mergeContext(child), {
    tenant: 'acme',
    requestId: 'r-2',
    userId: 'u-9',
  });
  assert.deepEqual(mergeContext(root), { tenant: 'acme', requestId: 'r-1' });
});

test('withContext accepts null and undefined parents', () => {
  const a = withContext(null, { a: 1 });
  const b = withContext(undefined, { b: 2 });
  assert.deepEqual(mergeContext(a), { a: 1 });
  assert.deepEqual(mergeContext(b), { b: 2 });
});

test('withContext rejects non-object values', () => {
  const root = createContext();
  assert.throws(() => withContext(root, null), TypeError);
  assert.throws(() => withContext(root, 42), TypeError);
  assert.throws(() => withContext(root, ['x']), TypeError);
});

test('mergeContext handles a deep chain without recursion', () => {
  let ctx = createContext({ depth: 0 });
  for (let i = 1; i < 5000; i += 1) {
    ctx = withContext(ctx, { depth: i });
  }
  assert.equal(mergeContext(ctx).depth, 4999);
});

test('runInContext returns result and produced context', () => {
  const root = createContext({ tenant: 'acme' });
  const { result, context } = runInContext(root, (ctx) => {
    const next = withContext(ctx, { requestId: 'r-1' });
    return { result: 42, context: next };
  });
  assert.equal(result, 42);
  assert.deepEqual(mergeContext(context), { tenant: 'acme', requestId: 'r-1' });
});

test('runInContext validates the callback return shape', () => {
  const root = createContext();
  assert.throws(
    () => runInContext(root, () => ({ result: 1 })),
    /missing a Context/,
  );
  assert.throws(
    () => runInContext(root, () => ({ context: root })),
    /missing "result"/,
  );
  assert.throws(() => runInContext(root, () => null), TypeError);
  assert.throws(() => runInContext(root, 'not a function'), TypeError);
});

test('runInContext treats null context as an empty root', () => {
  const { result, context } = runInContext(null, (ctx) => ({
    result: 'ok',
    context: withContext(ctx, { a: 1 }),
  }));
  assert.equal(result, 'ok');
  assert.deepEqual(mergeContext(context), { a: 1 });
});

test('makeLogger stamps merged context onto records', () => {
  const records = [];
  const ctx = withContext(createContext({ tenant: 'acme' }), { requestId: 'r-1' });
  const logger = makeLogger(ctx, { sink: (r) => records.push(r) });
  const returned = logger.log('hello', { attempt: 2 });
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    level: 'info',
    message: 'hello',
    tenant: 'acme',
    requestId: 'r-1',
    attempt: 2,
  });
  assert.equal(returned, ctx);
});

test('makeLogger extra values override context values', () => {
  const records = [];
  const ctx = createContext({ requestId: 'r-1' });
  const logger = makeLogger(ctx, { sink: (r) => records.push(r), level: 'warn' });
  logger.log('override', { requestId: 'r-2' });
  assert.equal(records[0].level, 'warn');
  assert.equal(records[0].requestId, 'r-2');
});

test('makeLogger rejects bad messages and extra values', () => {
  const logger = makeLogger(createContext(), { sink: () => {} });
  assert.throws(() => logger.log(123), TypeError);
  assert.throws(() => logger.log('ok', 'nope'), TypeError);
  assert.throws(() => logger.log('ok', null), TypeError);
});

test('makeLogger works with a null context', () => {
  const records = [];
  const logger = makeLogger(null, { sink: (r) => records.push(r) });
  logger.log('bare');
  assert.deepEqual(records[0], { level: 'info', message: 'bare' });
});

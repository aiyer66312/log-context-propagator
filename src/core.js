/**
 * A tiny structured-logging context carrier.
 *
 * The design decision here is deliberate: we do NOT use AsyncLocalStorage.
 * Instead, every function that wants to participate in context propagation
 * receives a Context value and returns an updated Context alongside its
 * result. This is the "return-value threading" pattern. It is more verbose
 * at call sites, but it is explicit, works in any runtime that supports
 * plain objects, and makes context flow visible in the type signatures.
 *
 * Contexts are immutable. `withContext` returns a new Context; the original
 * is never mutated. This keeps reasoning local: a callee cannot silently
 * change the caller's logging metadata.
 */

/**
 * A frozen bag of key/value log metadata plus an optional parent pointer.
 * The parent pointer is what lets `mergeContext` walk up the chain without
 * copying the whole world on every call.
 *
 * @typedef {Object} Context
 * @property {Readonly<Record<string, unknown>>} values
 * @property {Context|null} parent
 */

const EMPTY_VALUES = Object.freeze({});

/**
 * Create a root context. Passing no values gives an empty root.
 * Passing a non-object (including null) throws, because silently accepting
 * a string or number here would produce confusing downstream behaviour.
 *
 * @param {Record<string, unknown>} [values]
 * @returns {Context}
 */
export function createContext(values) {
  if (values === undefined) {
    return Object.freeze({ values: EMPTY_VALUES, parent: null });
  }
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new TypeError('createContext: values must be a plain object or undefined');
  }
  return Object.freeze({ values: Object.freeze({ ...values }), parent: null });
}

/**
 * Extend a context with additional values. The original context is untouched.
 * A null or undefined context is treated as an empty root, which makes it
 * safe to call `withContext(maybeCtx, {...})` without a guard.
 *
 * @param {Context|null|undefined} ctx
 * @param {Record<string, unknown>} values
 * @returns {Context}
 */
export function withContext(ctx, values) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new TypeError('withContext: values must be a plain object');
  }
  const parent = ctx == null ? null : ctx;
  return Object.freeze({ values: Object.freeze({ ...values }), parent });
}

/**
 * Flatten a context chain into a single plain object.
 *
 * Order matters: the root is applied first and the most recent layer wins,
 * so a child can override a parent's value. We resolve the chain iteratively
 * rather than recursively so that a very deep chain cannot blow the stack.
 *
 * @param {Context|null|undefined} ctx
 * @returns {Record<string, unknown>}
 */
export function mergeContext(ctx) {
  const chain = [];
  let node = ctx == null ? null : ctx;
  while (node) {
    chain.push(node.values);
    node = node.parent;
  }
  const out = {};
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    Object.assign(out, chain[i]);
  }
  return out;
}

/**
 * Run a function with a context, returning both the function's result and
 * the context that the function produced. The callback receives the current
 * context and must return `{ result, context }`.
 *
 * We validate the shape of the callback's return value because a caller who
 * forgets to return the context would otherwise propagate `undefined` and
 * lose all metadata silently.
 *
 * @template T
 * @param {Context|null|undefined} ctx
 * @param {(ctx: Context) => { result: T, context: Context }} fn
 * @returns {{ result: T, context: Context }}
 */
export function runInContext(ctx, fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('runInContext: fn must be a function');
  }
  const start = ctx == null ? createContext() : ctx;
  const out = fn(start);
  if (out === null || typeof out !== 'object') {
    throw new TypeError('runInContext: fn must return an object with result and context');
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'result')) {
    throw new TypeError('runInContext: fn return value is missing "result"');
  }
  if (out.context === null || typeof out.context !== 'object') {
    throw new TypeError('runInContext: fn return value is missing a Context "context"');
  }
  return { result: out.result, context: out.context };
}

/**
 * A minimal logger that stamps every record with the merged context.
 *
 * We accept an injected `sink` rather than calling console.log directly so
 * that tests can capture output deterministically. The sink receives a plain
 * object; it is the caller's job to serialise it.
 *
 * @param {Context|null|undefined} ctx
 * @param {{ sink?: (record: Record<string, unknown>) => void, level?: string }} [options]
 * @returns {{ context: Context, log: (message: string, extra?: Record<string, unknown>) => Context }}
 */
export function makeLogger(ctx, options) {
  const opts = options == null ? {} : options;
  const sink = typeof opts.sink === 'function'
    ? opts.sink
    : (record) => { console.log(JSON.stringify(record)); };
  const level = typeof opts.level === 'string' ? opts.level : 'info';
  const start = ctx == null ? createContext() : ctx;

  /**
   * Emit one log record. Returns the context unchanged so callers can chain
   * `ctx = logger.log(...)` and keep the threading pattern uniform.
   *
   * @param {string} message
   * @param {Record<string, unknown>} [extra]
   * @returns {Context}
   */
  function log(message, extra) {
    if (typeof message !== 'string') {
      throw new TypeError('log: message must be a string');
    }
    const record = { level, message, ...mergeContext(start) };
    if (extra !== undefined) {
      if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) {
        throw new TypeError('log: extra must be a plain object or undefined');
      }
      Object.assign(record, extra);
    }
    sink(record);
    return start;
  }

  return { context: start, log };
}

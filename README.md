# log-context-propagator

Carries structured log metadata across async boundaries without `AsyncLocalStorage`, using an explicit return-value threading pattern.

```js
import {
  createContext,
  withContext,
  runInContext,
  makeLogger,
} from 'log-context-propagator';

// A root context for the whole request.
const root = createContext({ tenant: 'acme' });

// Handlers receive the context and return the context they produced.
const { result, context } = runInContext(root, (ctx) => {
  const scoped = withContext(ctx, { requestId: 'r-1' });
  const logger = makeLogger(scoped, {
    sink: (record) => console.log(JSON.stringify(record)),
  });
  logger.log('handling request', { attempt: 1 });
  return { result: 'done', context: scoped };
});

console.log(result);        // 'done'
console.log(context);       // the scoped Context value
```

## Why

`AsyncLocalStorage` is convenient but ties the library to a runtime that provides it, and it hides where metadata enters and leaves a call. This library makes the flow explicit: functions that add log metadata take a `Context` and return a new one. The trade-off is verbosity at every call site — you thread a value instead of relying on an ambient store — but in exchange the propagation is visible in the signatures, works on any JavaScript runtime, and cannot leak metadata between unrelated tasks.

## The awkward edge

`Context` is immutable, so `withContext` never mutates its parent and a child can override a parent's key. That means if two branches of your code both call `withContext` from the same parent, neither sees the other's additions. If you need siblings to share state, merge their contexts explicitly with `mergeContext` or thread the result of one branch into the other. The library will not do that for you, because doing it implicitly would resurrect exactly the ambient-state problem this design avoids.

## API

- `createContext(values?)` — root context. Throws on non-object `values`.
- `withContext(ctx, values)` — new context layered over `ctx`. `ctx` may be `null` or `undefined`.
- `mergeContext(ctx)` — flatten the chain into a plain object; nearest layer wins.
- `runInContext(ctx, fn)` — call `fn(ctx)` and return `{ result, context }`. `fn` must return that shape.
- `makeLogger(ctx, { sink, level })` — returns `{ context, log }`. `log(message, extra?)` emits a merged record and returns the context unchanged.

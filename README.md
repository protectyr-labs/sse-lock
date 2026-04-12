# @protectyr-labs/sse-lock

SSE streaming API routes with concurrency locking. Zero dependencies.

## Why This Exists

Long-running operations (LLM calls, document analysis, report generation) need two things that standard HTTP responses don't provide:

1. **Progress streaming** — the client needs to know what's happening during a 30-second operation, not just get a result at the end.
2. **Duplicate prevention** — if the user clicks "Analyze" twice, you don't want two parallel runs burning compute and producing conflicting results.

This library gives you both in a single function call.

```
Client                          Server
  |                               |
  |--- POST /api/analyze -------->|
  |                               |  acquire lock("doc-123")
  |<-- data: {"progress":"..."}   |  ...working...
  |<-- data: {"progress":"..."}   |  ...working...
  |<-- data: {"complete":"..."}   |  release lock("doc-123")
  |                               |
  |--- POST /api/analyze -------->|
  |                               |  lock held? yes
  |<-- data: {"error":"in prog"}  |  reject immediately
```

## Install

```bash
npm install @protectyr-labs/sse-lock
```

## Quick Start

### Next.js App Router (API Route)

```typescript
// app/api/analyze/route.ts
import { createSseStream, createInMemoryLockManager } from '@protectyr-labs/sse-lock';

const lockManager = createInMemoryLockManager();

export async function POST(request: Request) {
  const { documentId } = await request.json();

  return createSseStream(
    async (send) => {
      send('progress', 'Parsing document...');
      const data = await parseDocument(documentId);

      send('progress', 'Running analysis...');
      const result = await analyzeData(data);

      send('complete', 'Analysis finished', result);
    },
    { lockManager, resourceId: documentId },
  );
}
```

### Browser Client

```typescript
const response = await fetch('/api/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ documentId: 'doc-123' }),
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  for (const line of text.split('\n\n').filter(Boolean)) {
    const event = JSON.parse(line.replace('data: ', ''));
    console.log(`[${event.type}] ${event.message}`, event.result);
  }
}
```

### Without Locking

Pass `null` as the lock manager to use pure SSE streaming without concurrency control:

```typescript
return createSseStream(async (send) => {
  send('progress', 'Working...');
  send('complete', 'Done', { value: 42 });
});
```

## API

### `createSseStream(handler, options?)`

Creates a `Response` object with SSE headers and a readable stream.

| Parameter | Type | Description |
|-----------|------|-------------|
| `handler` | `(send) => Promise<void>` | Async function that receives a `send` callback |
| `options.lockManager` | `LockManager \| null` | Lock manager instance, or null to skip locking |
| `options.resourceId` | `string` | Resource ID for locking (required if lockManager is set) |
| `options.headers` | `Record<string, string>` | Additional response headers |

The `send` callback signature: `(type: EventType, message: string, result?: unknown) => void`

### `formatEvent(type, message, result?)`

Formats a single SSE event string. Useful for building custom streaming logic.

```typescript
formatEvent('progress', 'Loading...');
// => 'data: {"type":"progress","message":"Loading..."}\n\n'
```

### `createInMemoryLockManager()`

Returns a `LockManager` backed by a `Map`. Good for development and testing. Not suitable for production (single-process, doesn't survive restarts).

### `LockManager` Interface

Implement this for your storage backend:

```typescript
interface LockManager {
  isLocked(resourceId: string): Promise<boolean>;
  acquire(resourceId: string): Promise<boolean>;
  release(resourceId: string): Promise<void>;
  releaseWithError(resourceId: string, error: string): Promise<void>;
}
```

## Production Lock Manager

Here's an example using a PostgreSQL table:

```typescript
import type { LockManager } from '@protectyr-labs/sse-lock';
import { pool } from './db';

export function createPgLockManager(): LockManager {
  return {
    async isLocked(resourceId) {
      const { rows } = await pool.query(
        `SELECT 1 FROM analysis_locks WHERE resource_id = $1 AND locked = true`,
        [resourceId],
      );
      return rows.length > 0;
    },

    async acquire(resourceId) {
      try {
        await pool.query(
          `INSERT INTO analysis_locks (resource_id, locked, locked_at)
           VALUES ($1, true, NOW())
           ON CONFLICT (resource_id)
           DO UPDATE SET locked = true, locked_at = NOW()
           WHERE analysis_locks.locked = false`,
          [resourceId],
        );
        const { rows } = await pool.query(
          `SELECT locked_at FROM analysis_locks
           WHERE resource_id = $1 AND locked = true
           AND locked_at >= NOW() - INTERVAL '1 second'`,
          [resourceId],
        );
        return rows.length > 0;
      } catch {
        return false;
      }
    },

    async release(resourceId) {
      await pool.query(
        `UPDATE analysis_locks SET locked = false, completed_at = NOW()
         WHERE resource_id = $1`,
        [resourceId],
      );
    },

    async releaseWithError(resourceId, error) {
      await pool.query(
        `UPDATE analysis_locks SET locked = false, error = $2, completed_at = NOW()
         WHERE resource_id = $1`,
        [resourceId, error],
      );
    },
  };
}
```

## Event Types

| Type | When | `result` field |
|------|------|---------------|
| `progress` | During operation | Optional |
| `complete` | Operation succeeded | Typically included |
| `error` | Operation failed or lock rejected | Not included |

## License

MIT

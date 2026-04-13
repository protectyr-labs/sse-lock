# sse-lock

> Stream progress to the client. Prevent duplicate runs.

[![CI](https://github.com/protectyr-labs/sse-lock/actions/workflows/ci.yml/badge.svg)](https://github.com/protectyr-labs/sse-lock/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)

## Quick Start

```bash
npm install @protectyr-labs/sse-lock
```

```typescript
import { createSseStream, createInMemoryLockManager } from '@protectyr-labs/sse-lock';

const lockManager = createInMemoryLockManager();

// Next.js App Router example
export async function POST(request: Request) {
  const { documentId } = await request.json();
  return createSseStream(
    async (send) => {
      send('progress', 'Parsing document...');
      const data = await parseDocument(documentId);
      send('progress', 'Running analysis...');
      const result = await analyzeData(data);
      send('complete', 'Done', result);
    },
    { lockManager, resourceId: documentId },
  );
}
// Second request while first is running => rejected immediately
```

## Why This?

- **SSE over WebSocket** -- simpler protocol, works through proxies, no upgrade handshake
- **Built-in concurrency lock** -- second request for the same resource is rejected, not queued
- **Error auto-release** -- lock releases automatically if the handler throws
- **LockManager interface** -- swap in Redis/Postgres for production; in-memory for dev
- **Zero dependencies** -- pure TypeScript, works with any HTTP framework

## Use Cases

**AI analysis endpoints** -- User clicks "Analyze" which triggers a 60-second Claude call. Stream progress ("Loading data...", "Running analysis...") back to the UI. If they click again, reject the duplicate.

**Report generation** -- Generate a complex report that takes 30+ seconds. Stream status updates. Lock prevents two reports being generated simultaneously for the same resource.

**Background job monitoring** -- Long-running job starts via API. Client opens SSE connection to receive progress events. Lock ensures the job is not started twice.

## How It Works

```
Client                          Server
  |--- POST /api/analyze -------->|  acquire lock("doc-123")
  |<-- data: {"progress":"..."}   |  ...working...
  |<-- data: {"complete":"..."}   |  release lock("doc-123")
  |                               |
  |--- POST /api/analyze -------->|  lock held? => reject
  |<-- data: {"error":"in prog"}  |
```

## API

| Function | Purpose |
|----------|---------|
| `createSseStream(handler, opts?)` | Returns a `Response` with SSE headers and streaming body |
| `formatEvent(type, message, result?)` | Format a single SSE event string |
| `createInMemoryLockManager()` | In-memory lock for dev/testing |

### LockManager Interface

```typescript
interface LockManager {
  isLocked(resourceId: string): Promise<boolean>;
  acquire(resourceId: string): Promise<boolean>;
  release(resourceId: string): Promise<void>;
  releaseWithError(resourceId: string, error: string): Promise<void>;
}
```

### Without Locking

Omit options to use pure SSE streaming with no concurrency control:

```typescript
return createSseStream(async (send) => {
  send('progress', 'Working...');
  send('complete', 'Done', { value: 42 });
});
```

## Limitations

- **Single-process in-memory lock** -- implement `LockManager` with Redis/Postgres for multi-server
- **No TTL on locks** -- if the process dies without releasing, the lock is stuck (in-memory version)
- **No retry headers** -- rejected requests get an error event, caller decides retry logic
- **No backpressure** -- if the client reads slowly, events buffer in memory

## See Also

- [webhook-resume](https://github.com/protectyr-labs/webhook-resume) -- pause workflows and wait for human decisions

## License

MIT

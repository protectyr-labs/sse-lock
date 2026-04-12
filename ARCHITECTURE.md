# Architecture

Design decisions behind `@protectyr-labs/sse-lock`.

## Why SSE over WebSockets

Server-Sent Events (SSE) are the right tool for streaming progress from long-running operations:

- **Simpler** — SSE uses plain HTTP. No upgrade handshake, no connection protocol, no ping/pong frames.
- **Built into fetch** — The client reads the response body as a stream. No special library needed. Works with `ReadableStream` in every modern browser and runtime.
- **Auto-reconnect** — The `EventSource` API handles reconnection natively. For POST-based streams (which we use), the client controls retry logic explicitly.
- **One-directional is sufficient** — The client sends a request, then listens. There is no need for bidirectional communication during an analysis run. If you need to cancel, use `AbortController` on the fetch call.
- **Proxy-friendly** — SSE works through standard HTTP proxies, load balancers, and CDNs without special configuration (unlike WebSocket upgrade requests).

WebSockets would be overkill here. They shine for chat, multiplayer games, and collaborative editing where both sides send messages frequently. For "start a job, watch it run, get a result," SSE is the correct choice.

## Why the Lock Manager Is an Interface

Different deployments need different storage backends for locks:

| Backend | When to use |
|---------|------------|
| In-memory (`Map`) | Local development, tests, single-process apps |
| PostgreSQL/MySQL | Multi-process deployments with an existing database |
| Redis | High-throughput, distributed systems with TTL support |

By defining `LockManager` as a four-method interface (`isLocked`, `acquire`, `release`, `releaseWithError`), the library stays storage-agnostic. You implement 10-20 lines of adapter code for your stack. The core library stays at zero dependencies.

## Why Release Lock on Error

If a handler throws an error and the lock is not released, that resource is permanently locked until a manual intervention or server restart. This is a deadlock.

The library catches all errors from the handler and:

1. Calls `releaseWithError(resourceId, errorMessage)` so the lock manager can store the error for debugging.
2. Streams the error to the client as an `error` event so the UI can display it.
3. Closes the stream cleanly.

This ensures locks are always cleaned up, even on unexpected failures. The `releaseWithError` method stores the error string so operators can diagnose what went wrong without the lock blocking future operations.

## Why `data: {JSON}\n\n` Format

This follows the [SSE specification](https://html.spec.whatwg.org/multipage/server-sent-events.html):

- Each event is one or more `data:` lines followed by a blank line (`\n\n`).
- The `EventSource` API in browsers parses this format natively.
- JSON in the `data` field gives structured access to event type, message, and result.

The format `data: {"type":"progress","message":"Loading..."}\n\n` is:
- Parseable by `EventSource` (which fires `message` events with `event.data` as the JSON string).
- Parseable by `fetch` + `ReadableStream` (split on `\n\n`, strip `data: ` prefix, `JSON.parse`).
- Human-readable in curl and browser dev tools.

## Known Limitations

1. **In-memory lock manager is single-process only.** If your app runs multiple instances (e.g., behind a load balancer), each instance has its own lock map. Use a database or Redis lock manager for multi-process deployments.

2. **No TTL on locks.** If the server crashes mid-operation, the in-memory lock is lost (cleared on restart). A database lock manager should implement TTL (e.g., auto-release after 5 minutes) to handle this case.

3. **No retry headers.** The library does not send `retry:` SSE fields. Reconnection logic is left to the client, since most use cases involve POST requests (which `EventSource` does not support — you use `fetch` instead).

4. **No event ID.** The library does not send `id:` SSE fields. If you need resumable streams, you would need to implement cursor-based resumption in your handler.

5. **Race condition window.** The `isLocked` + `acquire` sequence is not atomic in the in-memory implementation. For production, your database lock manager should use atomic operations (e.g., `INSERT ... ON CONFLICT` or `SETNX` in Redis).

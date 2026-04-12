/**
 * SSE Lock — Server-Sent Events streaming with concurrency control.
 *
 * Provides helpers for building SSE streaming API routes where:
 * - Long-running operations stream progress to the client
 * - Only one operation can run at a time per resource
 * - Errors are caught, streamed, and locks are cleaned up
 */

export type EventType = 'progress' | 'complete' | 'error';

export interface SseEvent {
  type: EventType;
  message: string;
  result?: unknown;
}

/**
 * Format a Server-Sent Event string.
 */
export function formatEvent(type: EventType, message: string, result?: unknown): string {
  const data: SseEvent = { type, message };
  if (result !== undefined) data.result = result;
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Interface for checking and managing concurrency locks.
 * Implement this for your storage backend (database, Redis, in-memory).
 */
export interface LockManager {
  /** Check if a lock is currently held for this resource. */
  isLocked(resourceId: string): Promise<boolean>;
  /** Acquire the lock. Returns true if acquired, false if already held. */
  acquire(resourceId: string): Promise<boolean>;
  /** Release the lock. */
  release(resourceId: string): Promise<void>;
  /** Release with error state (for debugging). */
  releaseWithError(resourceId: string, error: string): Promise<void>;
}

export interface StreamOptions {
  /** Lock manager for concurrency control. Pass null to skip locking. */
  lockManager: LockManager | null;
  /** Resource ID for locking (e.g., document ID, user ID). */
  resourceId?: string;
  /** Headers to include in the SSE response. */
  headers?: Record<string, string>;
}

/**
 * Create an SSE streaming response with concurrency locking.
 *
 * The handler receives a `send` function to stream events to the client.
 * If a lock manager is provided, ensures only one operation runs per resource.
 * On error, the lock is released and the error is streamed before closing.
 */
export function createSseStream(
  handler: (send: (type: EventType, message: string, result?: unknown) => void) => Promise<void>,
  options: StreamOptions = { lockManager: null },
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: EventType, message: string, result?: unknown) => {
        controller.enqueue(encoder.encode(formatEvent(type, message, result)));
      };

      const { lockManager, resourceId } = options;
      let lockAcquired = false;

      try {
        // Check and acquire lock
        if (lockManager && resourceId) {
          const locked = await lockManager.isLocked(resourceId);
          if (locked) {
            send('error', 'Operation already in progress');
            controller.close();
            return;
          }
          lockAcquired = await lockManager.acquire(resourceId);
          if (!lockAcquired) {
            send('error', 'Failed to acquire lock');
            controller.close();
            return;
          }
        }

        // Run the handler
        await handler(send);

        // Release lock on success
        if (lockManager && resourceId && lockAcquired) {
          await lockManager.release(resourceId);
        }

        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';

        // Release lock with error state
        if (lockManager && resourceId && lockAcquired) {
          await lockManager.releaseWithError(resourceId, message).catch(() => {});
        }

        // Stream error to client
        try {
          send('error', message);
        } catch {
          // Controller may already be closed
        }

        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...options.headers,
    },
  });
}

/**
 * In-memory lock manager for development and testing.
 * NOT suitable for production (doesn't survive restarts, single-process only).
 */
export function createInMemoryLockManager(): LockManager {
  const locks = new Map<string, { acquired: boolean; error?: string }>();

  return {
    async isLocked(resourceId: string) {
      return locks.get(resourceId)?.acquired === true;
    },
    async acquire(resourceId: string) {
      if (locks.get(resourceId)?.acquired) return false;
      locks.set(resourceId, { acquired: true });
      return true;
    },
    async release(resourceId: string) {
      locks.delete(resourceId);
    },
    async releaseWithError(resourceId: string, error: string) {
      locks.set(resourceId, { acquired: false, error });
    },
  };
}

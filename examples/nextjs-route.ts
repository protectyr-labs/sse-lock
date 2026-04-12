/**
 * Example: Next.js App Router API route with SSE streaming and locking.
 *
 * Place this file at: app/api/analyze/route.ts
 */

import { createSseStream, createInMemoryLockManager } from '@protectyr-labs/sse-lock';

// In production, use a database-backed lock manager (see README).
const lockManager = createInMemoryLockManager();

export async function POST(request: Request) {
  const { documentId } = await request.json();

  return createSseStream(
    async (send) => {
      send('progress', 'Parsing document...');
      // Simulate work
      await new Promise((r) => setTimeout(r, 1000));

      send('progress', 'Running analysis...');
      await new Promise((r) => setTimeout(r, 2000));

      send('progress', 'Generating report...');
      await new Promise((r) => setTimeout(r, 1000));

      send('complete', 'Analysis finished', {
        documentId,
        score: 87,
        summary: 'Document meets compliance requirements.',
      });
    },
    { lockManager, resourceId: documentId },
  );
}

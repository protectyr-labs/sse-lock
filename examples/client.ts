/**
 * Example: Browser client consuming SSE stream.
 *
 * Works with fetch() — no EventSource needed for POST requests.
 */

async function runAnalysis(documentId: string) {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value);
    // Each SSE message is "data: {JSON}\n\n"
    const lines = text.split('\n\n').filter(Boolean);

    for (const line of lines) {
      const json = line.replace('data: ', '');
      const event = JSON.parse(json);

      switch (event.type) {
        case 'progress':
          console.log(`[progress] ${event.message}`);
          break;
        case 'complete':
          console.log(`[complete] ${event.message}`, event.result);
          break;
        case 'error':
          console.error(`[error] ${event.message}`);
          break;
      }
    }
  }
}

// Usage
runAnalysis('doc-123');

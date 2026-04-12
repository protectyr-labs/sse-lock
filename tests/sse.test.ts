import { describe, it, expect } from 'vitest';
import { formatEvent, createInMemoryLockManager, createSseStream } from '../src/index';

describe('formatEvent', () => {
  it('formats progress event', () => {
    const event = formatEvent('progress', 'Loading...');
    expect(event).toBe('data: {"type":"progress","message":"Loading..."}\n\n');
  });

  it('formats complete event with result', () => {
    const event = formatEvent('complete', 'Done', { score: 95 });
    const parsed = JSON.parse(event.replace('data: ', '').trim());
    expect(parsed.type).toBe('complete');
    expect(parsed.result).toEqual({ score: 95 });
  });

  it('formats error event', () => {
    const event = formatEvent('error', 'Something broke');
    const parsed = JSON.parse(event.replace('data: ', '').trim());
    expect(parsed.type).toBe('error');
    expect(parsed.message).toBe('Something broke');
  });
});

describe('InMemoryLockManager', () => {
  it('acquires and releases locks', async () => {
    const lm = createInMemoryLockManager();
    expect(await lm.isLocked('res-1')).toBe(false);
    expect(await lm.acquire('res-1')).toBe(true);
    expect(await lm.isLocked('res-1')).toBe(true);
    await lm.release('res-1');
    expect(await lm.isLocked('res-1')).toBe(false);
  });

  it('prevents double acquisition', async () => {
    const lm = createInMemoryLockManager();
    expect(await lm.acquire('res-1')).toBe(true);
    expect(await lm.acquire('res-1')).toBe(false);
  });

  it('releases with error state', async () => {
    const lm = createInMemoryLockManager();
    await lm.acquire('res-1');
    await lm.releaseWithError('res-1', 'timeout');
    expect(await lm.isLocked('res-1')).toBe(false);
  });
});

describe('createSseStream', () => {
  it('returns a Response with correct headers', () => {
    const response = createSseStream(async (send) => {
      send('complete', 'Done');
    });
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('streams events from handler', async () => {
    const response = createSseStream(async (send) => {
      send('progress', 'Step 1');
      send('progress', 'Step 2');
      send('complete', 'Done', { value: 42 });
    });

    const text = await response.text();
    expect(text).toContain('"type":"progress"');
    expect(text).toContain('Step 1');
    expect(text).toContain('Step 2');
    expect(text).toContain('"type":"complete"');
  });

  it('rejects when lock is held', async () => {
    const lm = createInMemoryLockManager();
    await lm.acquire('res-1');

    const response = createSseStream(
      async (send) => { send('complete', 'Should not run'); },
      { lockManager: lm, resourceId: 'res-1' },
    );

    const text = await response.text();
    expect(text).toContain('already in progress');
  });

  it('releases lock on error', async () => {
    const lm = createInMemoryLockManager();

    const response = createSseStream(
      async () => { throw new Error('boom'); },
      { lockManager: lm, resourceId: 'res-1' },
    );

    const text = await response.text();
    expect(text).toContain('boom');
    expect(await lm.isLocked('res-1')).toBe(false);
  });
});

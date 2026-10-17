import { describe, expect, it } from 'vitest';
import type { SessionWithMessages } from '../types';
import { mergeRevalidated, normalizeMessages } from './session-messages';

const s = (id: string, contents: string[] = []): SessionWithMessages => ({
  id,
  user_id: 'u',
  title: id,
  created_at: '2026-01-01',
  messages: contents.map((content, i) => ({ id: `${id}-${i}`, role: 'user', content })),
});

describe('mergeRevalidated (stale-while-revalidate merge)', () => {
  it('when nothing was changed locally, the server list wins completely (cache is overwritten)', () => {
    const fresh = [s('a', ['server'])];
    expect(mergeRevalidated(fresh, [s('a', ['cached']), s('stale')], new Set())).toBe(fresh);
  });

  it('keeps the local copy of a session changed during revalidation (does not wipe a just-sent message)', () => {
    const result = mergeRevalidated(
      [s('a', ['server-old']), s('b')],
      [s('a', ['server-old', 'just sent']), s('b')],
      new Set(['a']),
    );
    expect(result.map(x => x.id)).toEqual(['a', 'b']);
    expect(result[0].messages.map(m => m.content)).toEqual(['server-old', 'just sent']);
  });

  it('keeps a just-created session that the (older) server response does not include yet', () => {
    const result = mergeRevalidated([s('b')], [s('new', ['first question']), s('b')], new Set(['new']));
    expect(result.map(x => x.id)).toEqual(['new', 'b']);
  });

  it('does not resurrect a session deleted locally during revalidation', () => {
    const result = mergeRevalidated([s('deleted'), s('b')], [s('b')], new Set(['deleted']));
    expect(result.map(x => x.id)).toEqual(['b']);
  });
});

describe('normalizeMessages', () => {
  it('returns [] for null or non-array values', () => {
    expect(normalizeMessages(null)).toEqual([]);
    expect(normalizeMessages(undefined)).toEqual([]);
    expect(normalizeMessages({ role: 'user' })).toEqual([]);
  });

  it('keeps existing ids and converts createdAt strings back to Date', () => {
    const [m] = normalizeMessages([{ id: 'a1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' }]);
    expect(m.id).toBe('a1');
    expect(m.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('assigns unique ids to legacy messages saved without one', () => {
    const result = normalizeMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
      { id: '', role: 'assistant', content: 'b' },
    ]);
    const ids = result.map(m => m.id);
    expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });

  it('keeps Date createdAt values (as stored by IndexedDB structured clone)', () => {
    const date = new Date('2026-03-04T05:06:07.000Z');
    expect(normalizeMessages([{ id: 'x', role: 'user', content: 'hi', createdAt: date }])[0].createdAt).toEqual(date);
  });

  it('drops malformed entries instead of crashing the page', () => {
    const result = normalizeMessages(['oops', null, { role: 'hacker', content: 'x' }, { role: 'user' }, { role: 'user', content: 'ok' }]);
    expect(result.map(m => m.content)).toEqual(['ok']);
  });
});

import { describe, expect, it } from 'vitest';
import { createSlidingWindowLimiter } from './rate-limit';

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('createSlidingWindowLimiter', () => {
  it('allows up to the limit within the window, then rejects', () => {
    const clock = fakeClock();
    const limiter = createSlidingWindowLimiter({ limit: 3, windowMs: 60_000, now: clock.now });

    expect(limiter.check('u1')).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.check('u1')).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.check('u1')).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.check('u1')).toMatchObject({ allowed: false, remaining: 0 });
  });

  it('reports how long until the oldest request leaves the window', () => {
    const clock = fakeClock();
    const limiter = createSlidingWindowLimiter({ limit: 2, windowMs: 60_000, now: clock.now });
    limiter.check('u1');
    clock.advance(10_000);
    limiter.check('u1');
    clock.advance(5_000);
    expect(limiter.check('u1')).toEqual({ allowed: false, remaining: 0, retryAfterMs: 45_000 });
  });

  it('slides: requests become available again as old ones expire', () => {
    const clock = fakeClock();
    const limiter = createSlidingWindowLimiter({ limit: 2, windowMs: 60_000, now: clock.now });
    limiter.check('u1'); // t=0
    clock.advance(30_000);
    limiter.check('u1'); // t=30s
    expect(limiter.check('u1').allowed).toBe(false);

    clock.advance(30_001); // t=60.001s: the t=0 request has expired, the t=30s one has not
    expect(limiter.check('u1')).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.check('u1').allowed).toBe(false);
  });

  it('rejected requests do not extend the window', () => {
    const clock = fakeClock();
    const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 1_000, now: clock.now });
    limiter.check('u1');
    for (let i = 0; i < 5; i++) {
      clock.advance(100);
      expect(limiter.check('u1').allowed).toBe(false);
    }
    clock.advance(501); // t=1001ms
    expect(limiter.check('u1').allowed).toBe(true);
  });

  it('tracks each key independently', () => {
    const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    expect(limiter.check('u1').allowed).toBe(true);
    expect(limiter.check('u1').allowed).toBe(false);
    expect(limiter.check('u2').allowed).toBe(true);
  });

  it('sweeps expired keys once the key count exceeds maxKeys, without affecting active keys', () => {
    const clock = fakeClock();
    const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 1_000, now: clock.now, maxKeys: 2 });
    limiter.check('old1');
    limiter.check('old2');
    limiter.check('old3');
    clock.advance(2_000);
    limiter.check('active');
    // old keys were swept and start fresh; the active key is still limited
    expect(limiter.check('old1').allowed).toBe(true);
    expect(limiter.check('active').allowed).toBe(false);
  });
});

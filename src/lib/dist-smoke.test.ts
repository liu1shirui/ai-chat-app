// Smoke test for the *built* library (dist/lib/index.mjs), not the TypeScript sources.
// Purpose: prove the Vite library bundle exports what it should and actually runs when imported as plain ESM.
// Run `npm run build:lib` first. Locally the suite is skipped if dist is missing; in CI it must exist.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const distEntry = resolve(__dirname, '../../dist/lib/index.mjs');
const shouldRun = existsSync(distEntry) || Boolean(process.env.CI);

describe.skipIf(!shouldRun)('built library: dist/lib/index.mjs', () => {
  // Dynamic import via file URL: the bundle is plain ESM and has no .d.mts, so keep it out of the type graph.
  const load = () => import(/* @vite-ignore */ pathToFileURL(distEntry).href);

  it('exports the public API of the four modules', async () => {
    const lib = await load();
    for (const name of ['computeWindow', 'prefixOffsets', 'createFrameBatcher', 'SseParser', 'readSseStream']) {
      expect(lib[name], name).toBeDefined();
    }
  });

  it('SseParser from the bundle parses a streamed event split across chunks', async () => {
    const { SseParser } = await load();
    const parser = new SseParser();
    const events = [...parser.push('data: hel'), ...parser.push('lo\n\n')];
    expect(events.length).toBe(1);
    expect(events[0].data).toBe('hello');
  });
});

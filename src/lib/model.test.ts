import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GROQ_MODEL, resolveGroqModel } from './model';

describe('resolveGroqModel', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to openai/gpt-oss-20b when GROQ_MODEL is not set', () => {
    vi.stubEnv('GROQ_MODEL', undefined);
    expect(resolveGroqModel()).toBe('openai/gpt-oss-20b');
    expect(DEFAULT_GROQ_MODEL).toBe('openai/gpt-oss-20b');
  });

  it('uses GROQ_MODEL when set, trimming whitespace', () => {
    vi.stubEnv('GROQ_MODEL', '  qwen/qwen3.8-27b  ');
    expect(resolveGroqModel()).toBe('qwen/qwen3.8-27b');
  });

  it('falls back to the default for an empty or whitespace-only value', () => {
    expect(resolveGroqModel('')).toBe(DEFAULT_GROQ_MODEL);
    expect(resolveGroqModel('   ')).toBe(DEFAULT_GROQ_MODEL);
  });
});

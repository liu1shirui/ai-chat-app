import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const createClient = vi.fn<(...args: unknown[]) => unknown>(() => ({ auth: { getUser } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClient(...args) }));

const { verifySupabaseToken } = await import('./auth');

describe('verifySupabaseToken', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
    getUser.mockReset();
    createClient.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns the user id from Supabase Auth for a valid token', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    await expect(verifySupabaseToken('tok')).resolves.toEqual({ id: 'user-1' });
    expect(getUser).toHaveBeenCalledWith('tok');
    // a server-side client must not persist or refresh sessions
    expect(createClient).toHaveBeenCalledWith('https://example.supabase.co', 'test-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it('returns null when Supabase rejects the token', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
    await expect(verifySupabaseToken('bad')).resolves.toBeNull();
  });

  it('throws when Supabase env vars are missing (handled as 503 by the handler)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    await expect(verifySupabaseToken('tok')).rejects.toThrow('not configured');
  });
});

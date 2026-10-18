// src/lib/auth.ts
// 服务端鉴权：从 Authorization 头取出 Supabase access token，交给 Supabase Auth 服务验证。
// 用户身份只从验证通过的 token 中得到，绝不信任请求体里客户端自报的 user id。
import { createClient } from '@supabase/supabase-js';

export interface AuthenticatedUser {
  id: string;
}

export type VerifyToken = (token: string) => Promise<AuthenticatedUser | null>;

export function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

// 用 anon key 创建一个不持久化会话的客户端；getUser(token) 会请求 Supabase Auth 校验签名和过期时间，
// 因此不需要在本项目里新增 JWT 密钥之类的敏感环境变量。
export const verifySupabaseToken: VerifyToken = async (token) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase environment variables are not configured');

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
};

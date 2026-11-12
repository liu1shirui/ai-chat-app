-- chat_sessions 表的 Row Level Security 策略。
-- 与 Supabase 项目中实际生效的策略一致（已通过 pg_policies 核对）：
-- 用户只能查询、插入、更新、删除 user_id 等于当前登录用户的行。

alter table public.chat_sessions enable row level security;

create policy "select own sessions" on public.chat_sessions
  for select using ((select auth.uid())::text = user_id);
create policy "insert own sessions" on public.chat_sessions
  for insert with check ((select auth.uid())::text = user_id);
create policy "update own sessions" on public.chat_sessions
  for update using ((select auth.uid())::text = user_id)
  with check ((select auth.uid())::text = user_id);
create policy "delete own sessions" on public.chat_sessions
  for delete using ((select auth.uid())::text = user_id);

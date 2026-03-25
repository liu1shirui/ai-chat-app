// src/services/supabase.ts
import { createClient } from '@supabase/supabase-js';

// 读取我们在 .env.local 中配置的环境变量
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 创建并导出 supabase 实例，以后在任何组件里只需 import { supabase } 即可使用
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
# AI Chat

一个基于 Next.js 的 AI 聊天应用：使用 Google 账号登录，与 Groq 托管的大模型进行流式对话（模型可调用计算器和时间工具），会话保存在 Supabase，并在浏览器 IndexedDB 中做本地缓存。

<!-- 截图：将应用截图保存为 docs/screenshot.png 后取消下面这行的注释 -->
<!-- ![应用截图](docs/screenshot.png) -->

## 功能

- **流式对话**：AI 回复通过 Server-Sent Events 逐字返回并实时显示；发送时附带最近的多轮上下文（最多 20 条、12,000 字符）。
- **停止生成**：生成过程中可以点击「停止」中止请求，服务端同时停止调用模型；已生成的部分会被保留并保存。
- **工具调用（Function Calling）**：模型可以调用两个服务端工具——`calculate`（四则运算表达式求值）和 `getCurrentTime`（按 IANA 时区获取当前时间），再根据结果组织回答；单次请求最多 4 步。
- **多会话**：侧栏列出所有会话，可新建、切换、删除；首次发送消息时自动创建会话，标题取消息前 20 个字符。移动端侧栏为抽屉式，支持 Esc 和点击遮罩关闭。
- **长会话窗口化渲染**：超过 100 条消息时只渲染视口附近的消息，上下用占位元素撑起总高度。
- **贴底滚动**：只有在距离底部 80px 以内时，新内容到来才自动滚到底；向上翻看历史时不会被拉回。切换会话或发送新消息时回到底部。
- **Google 登录**：通过 Supabase Auth 的 Google OAuth 登录，会话数据按用户隔离。
- **Markdown 渲染**：AI 回复使用 `react-markdown` 渲染，长代码块在气泡内横向滚动。
- **语音输入与朗读**：
  - 语音输入使用 Web Speech API（`SpeechRecognition`，zh-CN），录音时用 Web Audio API 显示麦克风音量；
  - AI 回复可一键朗读（`speechSynthesis`，zh-CN），朗读前会去掉 Markdown 符号，同一时间只朗读一条；
  - 浏览器不支持时，语音输入会给出提示，朗读按钮不显示。
- **本地缓存**：会话缓存在 IndexedDB 中，打开页面时先显示缓存，再从 Supabase 拉取最新数据；退出登录时清除该用户的缓存。
- **错误处理**：请求失败、限流、流中断、空回复等情况显示对应的中文提示，失败的一轮会回滚并把输入放回输入框。

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 框架 | Next.js 16（Pages Router）、React 19、TypeScript |
| 样式 | Tailwind CSS 4 |
| AI | Vercel AI SDK（`ai` 的 `streamText`、`tool`）+ `@ai-sdk/groq`；工具入参用 Zod 校验 |
| 认证与数据库 | Supabase（Auth + Postgres） |
| 本地缓存 | Dexie（IndexedDB） |
| 库打包 | Vite（library mode，把 `src/lib` 中与框架无关的工具函数打成 ESM 库） |
| 测试 | Vitest、Testing Library、jsdom、fake-indexeddb |
| CI | GitHub Actions（类型检查、库构建、测试、生产构建、Lint） |
| 部署 | Vercel（通过 Git 集成部署，`/api/chat` 运行在 Edge Runtime） |

## 架构

```
浏览器（src/pages/index.tsx）
 ├─ Supabase JS 客户端 ──────────────→ Supabase Auth（Google OAuth）
 │                     ──────────────→ Supabase Postgres（chat_sessions 表：读写会话）
 ├─ Dexie ───────────────────────────→ IndexedDB（会话本地缓存）
 └─ fetch POST /api/chat（Bearer token）
        │
        ▼
Edge 函数 src/pages/api/chat.ts
 └─ createChatHandler（src/lib/chat-handler.ts）
        ├─ 鉴权：verifySupabaseToken → Supabase Auth
        ├─ 限流：createSlidingWindowLimiter
        ├─ 校验：validateChatBody
        └─ 模型：streamText + Groq（tools: calculate / getCurrentTime，最多 4 步）
                 → createSseResponse → SSE 流返回浏览器
```

会话的读写由浏览器直接通过 Supabase 客户端完成；服务端 `/api/chat` 只负责鉴权后调用模型，不读写数据库。

### `/api/chat` 请求流程

处理顺序在 `src/lib/chat-handler.ts` 中，依赖（鉴权、限流、模型调用）通过参数注入，便于测试替换：

| 步骤 | 说明 | 失败时 |
| --- | --- | --- |
| 1. 方法检查 | 只接受 `POST` | `405` |
| 2. 鉴权 | 从 `Authorization: Bearer <token>` 取 Supabase access token，调用 `supabase.auth.getUser(token)` 验证 | 缺少或无效 token：`401`；Auth 服务不可用或环境变量缺失：`503` |
| 3. 限流 | 按**验证后的用户 id** 限流，每用户每 60 秒最多 10 次 | `429`，带 `Retry-After` 头 |
| 4. 解析 JSON | 读取请求体 | `400` |
| 5. 校验 | 只允许 `user` / `assistant` 角色（不允许前端注入 `system`）；最多 40 条消息、单条 4,000 字符、总计 16,000 字符；最后一条必须是 `user`；只保留 `role` 和 `content` 字段 | `400` / `413` |
| 6. 调用模型 | `streamText` 调用 Groq，提供 `calculate` / `getCurrentTime` 两个工具，`stopWhen: stepCountIs(4)`；传入 `req.signal`，客户端断开时停止生成 | 未配置 `GROQ_API_KEY` 或调用失败：`502` |

错误响应统一为 `{"error": "..."}`，不包含内部细节；前端只根据状态码显示固定文案（`src/lib/chat-errors.ts`）。

## 设计要点

### 服务端 token 验证

用户身份只从验证通过的 Supabase access token 中得到，不信任请求体中客户端自报的 user id（`src/lib/auth.ts`）。验证时用 anon key 创建一个不持久化会话的客户端，调用 `getUser(token)`，由 Supabase Auth 校验签名和过期时间，因此不需要在项目中额外配置 JWT 密钥。

### 滑动窗口限流

`src/lib/rate-limit.ts` 为每个 key 记录窗口内的请求时间戳，超过上限时根据最早一次请求计算 `retryAfterMs`；key 数量超过 10,000 时清理已过期的 key，防止内存无限增长。

局限：计数保存在单个实例的内存中，Vercel 上的多个实例各自计数、重启后清零，因此只是"尽力而为"的限流。需要全局一致时，可以用共享存储（如 Redis）实现同一个 `RateLimiter` 接口来替换。

### 工具调用（Function Calling）

工具定义在 `src/lib/chat-tools.ts`，由 AI SDK 的 `tool()` 声明，服务端执行后自动把结果交还模型继续生成：

| 工具 | 入参（Zod 校验） | 说明 |
| --- | --- | --- |
| `calculate` | `expression`：1–200 个字符 | 支持 `+ - * / ^`、括号、小数和一元负号；`^` 右结合，`-2^2 = -4`；除以零、结果非有限数时报错 |
| `getCurrentTime` | `timeZone`：IANA 时区名，默认 `Asia/Shanghai` | 用 `Intl.DateTimeFormat`（zh-CN）格式化当前时间；时区无效时报错 |

- **不执行模型生成的代码**：`calculate` 使用手写的递归下降解析器，不使用 `eval` / `new Function`。"1 2" 这类数字之间有空白的输入会被拒绝，而不是被当成 12。
- **出错不让请求失败**：工具出错时返回 `{ ok: false, error }` 作为工具结果，由模型向用户解释。
- **有界的工具循环**：`MAX_TOOL_STEPS = 4`，通过 `stopWhen: stepCountIs(4)` 限制单次请求中"调用工具 → 拿到结果 → 回答"的步数，防止模型反复调用工具。
- 工具只做纯计算和读取时间，不访问网络、文件或用户数据。工具调用过程不发送给前端，用户只看到模型的最终回答（见下方「SSE 解析」）。

`scripts/check-tools-live.mts` 用真实的 Groq 模型手动验证工具是否被调用（需要 `.env.local` 中的 `GROQ_API_KEY`）：

```bash
node --env-file=.env.local scripts/check-tools-live.mts
```

### 流式渲染的 requestAnimationFrame 合并

如果每收到一块数据就 `setState`，长回复会导致大量重渲染。`src/lib/frame-batcher.ts` 把更新合并到动画帧：

- 第一块立即显示，首字不额外等待；
- 之后只记住最新的值，下一帧统一应用，一帧最多渲染一次；
- 流结束或停止时 `flush()`，保证最后一块一定显示；失败回滚前 `cancel()`，防止回滚后某一帧又把内容加回来。

配合 `ChatMessage` 的 `React.memo`（更新时只替换正在生成的那条消息对象），旧消息不会随每一块数据重新渲染 Markdown。

### 长会话窗口化渲染

没有引入虚拟列表库，由 `src/components/ChatBox.tsx` 和以下模块实现：

- **阈值**：消息数超过 `VIRTUALIZE_THRESHOLD = 100` 才启用，普通长度的会话仍全部渲染；视口上下各多渲染 6 条（overscan）。
- **二分查找可见区间**（`src/lib/windowing.ts`）：`computeWindow` 用前缀和算出每条消息的顶部位置，再用二分查找找到视口内的首条和末条消息，返回渲染区间和上下占位元素的高度。它是纯函数，可以单独测试。
- **按消息 ID 缓存高度**（`src/lib/height-cache.ts`、`src/hooks/useMeasuredHeights.ts`）：未测量的消息按估计高度 120px 计算；渲染出来的消息由一个共享的 `ResizeObserver` 测量实际高度，按消息 ID 存入缓存。
- **滚动位置修正**：视口上方的消息测得的高度与估计值不同（或内容变化）时，下面的内容会整体移动。`ChatBox` 把这些消息的高度变化量加到 `scrollTop` 上（在浏览器绘制之前），正在看的内容保持不动；贴底状态下则直接重新滚到底。

**基准测试（jsdom，不是真实浏览器）**：`src/__tests__/message-list.perf.test.tsx` 在 jsdom 中模拟 800px 视口，渲染交替的用户/AI 消息（AI 回复含列表、代码块和加粗）。2,000 条消息时：

| | 窗口化之前（基线提交 `2c1d93b`） | 窗口化之后 |
| --- | --- | --- |
| 列表内 DOM 节点数 | 19,001 | 143 |
| 首次挂载时渲染的消息数 | 2,000 | 13 |

jsdom 没有布局和绘制，这些数字只能说明渲染了多少节点，不代表真实浏览器中的帧率或耗时。运行：

```bash
npx vitest run src/__tests__/message-list.perf.test.tsx --silent=false
```

### 贴底滚动

`src/lib/scroll-position.ts` 的 `isNearBottom` 判断滚动容器距离底部是否不超过 `NEAR_BOTTOM_PX = 80` 像素：

- 每次滚动时重新判断是否"贴底"；
- 贴底时，新内容（包括流式回复变长、底部消息测得实际高度）到来后自动滚到底；不贴底时不移动，用户可以安心阅读历史消息；
- 切换会话或用户发出新消息时，无论之前滚到哪里都回到底部；
- 使用直接设置 `scrollTop` 的瞬时滚动，避免流式时每帧触发的平滑滚动互相打断。

### SSE 解析

服务端（`src/lib/sse-response.ts`）把 AI SDK 的 `fullStream` 转换为 SSE：

```
data: {"text":"..."}                              一段回复文本
event: error
data: {"message":"AI service error"}              模型在流中途出错
data: [DONE]                                      正常结束
```

只转发 `text-delta`，推理模型的思考过程、工具调用和工具结果等其他部分都不发给前端；使用 pull 模式按客户端的读取速度拉取上游，客户端断开时通知上游停止。

客户端分三层：

- `read-text-stream.ts`：逐块读取，整个流共用一个 `TextDecoder` 并传 `{ stream: true }`，中文字符被切在两块之间也不会乱码；
- `sse-parser.ts`：增量式 SSE 解析器，支持 `\n` / `\r\n` / `\r` 行结束符（包括 `\r\n` 被切在两块之间的情况）、注释行和多行 `data`；
- `read-sse-stream.ts`：解释事件含义。没收到 `[DONE]` 流就关闭视为连接被截断，按失败处理，不当作完整回复保存。

### IndexedDB 缓存策略

`src/lib/local-db.ts` 使用 Dexie，复合主键 `[userId+id]`，按用户隔离：

- **stale-while-revalidate**：页面加载时先显示缓存，再从 Supabase 拉取并覆盖界面和缓存；
- **只缓存已保存的内容**：只有成功写入 Supabase 的回复才写入缓存，失败或空回复不会进入缓存；
- **防止旧数据覆盖新修改**：重新验证开始后在本地被修改（发送、新建、删除）的会话以本地为准，避免旧快照覆盖刚发出的消息或"复活"刚删除的会话（`mergeRevalidated`）；
- **缓存不是数据源**：任何 IndexedDB 错误（隐私模式、被禁用、服务端渲染）都会被忽略，应用退回只使用 Supabase；
- 退出登录时清除该用户的缓存。

### Vite 库打包

`src/lib/index.ts` 导出四个与框架无关的模块：`windowing`、`frame-batcher`、`sse-parser`、`read-sse-stream`。`npm run build:lib` 把它们打成一个独立的 ESM 库：

- `vite.config.lib.mts`：Vite library mode，只输出 ESM，产物为 `dist/lib/index.mjs` 和 sourcemap；设置 `publicDir: false`，不把 Next.js 的 `public/` 拷进产物；
- `tsconfig.lib.json`：只生成 `.d.ts` 类型声明（在 Vite 之后运行，因为 Vite 会清空输出目录）；
- `src/lib/dist-smoke.test.ts`：直接 import 打包产物，验证导出和行为。本地没有 `dist/` 时这组测试会跳过，CI 中会先构建再运行。

应用本身仍由 Next.js 构建，Vite 只用于这个库的打包（以及 Vitest）。更多说明见 `docs/vite-notes.md`。

## 项目结构

```
.
├── .github/workflows/ci.yml   # CI：类型检查、库构建、测试、生产构建、Lint
├── docs/vite-notes.md         # Vite 库打包笔记
├── practice/                  # 练习代码（LRU 缓存及测试）
├── public/
├── scripts/
│   └── check-tools-live.mts   # 用真实模型手动验证工具调用
├── vite.config.lib.mts        # Vite library mode 配置
├── tsconfig.lib.json          # 库的类型声明输出配置
└── src/
    ├── pages/
    │   ├── index.tsx          # 主页面：登录、会话管理、发送与流式接收
    │   └── api/chat.ts        # /api/chat（Edge Runtime）
    ├── components/            # ChatBox（含窗口化与贴底滚动）、ChatMessage、ChatInput、Sidebar
    ├── hooks/                 # useSpeechSynthesis（朗读）、useMicLevel（麦克风音量）、useMeasuredHeights（测量消息高度）
    ├── lib/
    │   ├── index.ts           # 库入口（build:lib）
    │   ├── chat-handler.ts    # /api/chat 处理流程
    │   ├── auth.ts            # token 提取与验证
    │   ├── rate-limit.ts      # 滑动窗口限流
    │   ├── chat-validation.ts # 请求体校验
    │   ├── chat-tools.ts      # 模型可调用的工具（calculate、getCurrentTime）
    │   ├── model.ts           # 模型名解析（GROQ_MODEL）
    │   ├── sse-response.ts    # 服务端：模型流 → SSE
    │   ├── read-text-stream.ts、sse-parser.ts、read-sse-stream.ts  # 客户端 SSE 读取
    │   ├── frame-batcher.ts   # requestAnimationFrame 合并渲染
    │   ├── windowing.ts       # 窗口化：二分查找渲染区间
    │   ├── height-cache.ts    # 按消息 ID 缓存高度
    │   ├── scroll-position.ts # 贴底判断（80px）
    │   ├── build-context.ts   # 组装多轮上下文
    │   ├── local-db.ts        # IndexedDB 缓存
    │   ├── session-messages.ts # 消息规范化、重新验证合并
    │   ├── chat-errors.ts     # 错误提示文案
    │   ├── speech-text.ts     # 朗读前去除 Markdown
    │   └── supabaseClient.ts
    ├── __tests__/             # 页面、API 路由测试与性能基准
    ├── global.d.ts            # Web Speech API 类型声明
    └── types.ts
```

单元测试与被测文件放在同一目录（`*.test.ts(x)`）。

## 本地运行

需要 Node.js（CI 使用 Node 24）、一个 Supabase 项目和一个 Groq API key。

1. 安装依赖：

   ```bash
   npm ci
   ```

2. 配置环境变量，然后填入真实值（见下方「环境变量」）：

   ```bash
   cp .env.example .env.local
   ```

3. 配置 Supabase：
   - 在 Authentication → Providers 中启用 Google，并把本地地址（如 `http://localhost:3000`）加入 Redirect URLs；
   - 创建 `chat_sessions` 表（见下方「数据表」）。

4. 启动开发服务器，然后打开 <http://localhost:3000>：

   ```bash
   npm run dev
   ```

### 数据表

仓库中没有数据库迁移文件。下表是根据代码中的读写方式（`src/pages/index.tsx`、`src/types.ts`）整理的 `chat_sessions` 表结构，仅供参考：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid`，主键，默认 `gen_random_uuid()` | 插入时不传，由数据库生成 |
| `user_id` | `uuid` | 所属用户（`auth.users.id`） |
| `title` | `text` | 首条消息的前 20 个字符 |
| `created_at` | `timestamptz`，默认 `now()` | 插入时不传；会话列表按它倒序排列 |
| `messages` | `jsonb` | 消息数组，每项为 `{ id, role, content, createdAt }`，`createdAt` 为 ISO 字符串 |

前端用 anon key 直接读写这张表，更新和删除只按 `id` 过滤，因此需要在 Supabase 中开启 Row Level Security，并添加策略，限制用户只能访问 `user_id = auth.uid()` 的行。

### 环境变量

| 变量 | 必需 | 使用位置 | 说明 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 是 | 浏览器、服务端 | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 是 | 浏览器、服务端 | Supabase anon（public）key；服务端也用它验证 token |
| `GROQ_API_KEY` | 是 | 仅服务端 | Groq API key；不要加 `NEXT_PUBLIC_` 前缀 |
| `GROQ_MODEL` | 否 | 仅服务端 | 模型名，默认 `openai/gpt-oss-20b`；修改后重启服务生效 |

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建 |
| `npm run start` | 运行生产构建 |
| `npm run lint` | ESLint |
| `npm run typecheck` | 类型检查（`tsc --noEmit`） |
| `npm test` | 运行全部测试（`vitest run`） |
| `npm run build:lib` | 用 Vite library mode 打包 `src/lib`，输出到 `dist/lib` |

### 测试

共 308 个测试（35 个文件）：

- 本地直接运行 `npx vitest run`：306 个通过，2 个跳过（`dist-smoke.test.ts` 需要先运行 `npm run build:lib` 生成 `dist/`）；
- 先运行 `npm run build:lib` 再测试（与 CI 相同）：308 个全部通过。

CI（`.github/workflows/ci.yml`）在每次 push 和 pull request 时依次运行类型检查、库构建（`npm run build:lib`）、测试和生产构建，并在单独的 job 中运行 Lint，不使用任何真实密钥。部署由 Vercel 的 Git 集成完成。

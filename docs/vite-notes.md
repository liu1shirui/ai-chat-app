# Vite 学习笔记（以本项目的 `build:lib` 为例）

## 这次做了什么
把 `src/lib` 里与框架无关的四个模块（SSE 解析、流读取、帧批处理、列表窗口化）打成一个独立的 ESM 库：

- `vite.config.lib.mts`：Vite library mode 配置（入口 `src/lib/index.ts`，只输出 ESM，产物 `dist/lib/index.mjs` + sourcemap）
- `tsconfig.lib.json`：只生成 `.d.ts` 类型声明（Vite 只处理 JS，不生成类型）
- `npm run build:lib` = `vite build` 然后 `tsc`。顺序不能反：Vite 的 `emptyOutDir` 会清空输出目录
- `src/lib/dist-smoke.test.ts`：直接 import 打包产物，验证导出和行为；CI 里先 build 再测试

产物 4.45 kB（gzip 1.75 kB），7 个模块合成一个文件。

## Vite 开发模式 vs 生产构建
| | dev | build |
|---|---|---|
| 做法 | 不打包。浏览器直接请求原生 ES Module，Vite 按需转换 | Rollup 打包、tree-shaking、压缩 |
| 依赖 | 用 esbuild 预构建 node_modules（CommonJS 转 ESM，合并大量小文件） | 一起进 Rollup |
| 启动/热更新 | 与项目大小基本无关，只改动的模块失效 | 与项目大小相关 |

## 和 Webpack 的区别
- Webpack 开发时也要先把整个依赖图打包再启动；Vite 利用浏览器原生 ESM，冷启动快很多。
- Webpack 的扩展靠 loader + plugin；Vite 的生产构建基于 Rollup 插件体系，开发时共用同一套插件接口。
- 本项目的应用本身由 Next.js 构建（它有自己的打包器），Vite 在这里用于 Vitest 和这个库的打包。我没有把整个应用迁到 Vite。

## 踩到的坑（真实遇到的）
1. 包没有 `"type": "module"`，Vite 输出的是 `index.mjs` 而不是 `index.js`。
2. Next.js 的 `public/` 会被 Vite 当作 publicDir 拷进产物（favicon、svg），库构建要设 `publicDir: false`。
3. 配置文件写成 `.ts` 会触发 ESM/CJS 加载警告，改名为 `.mts`。
4. `external`：库不应打包 react 等 peer 依赖。目前这四个模块是纯函数，所以为空。

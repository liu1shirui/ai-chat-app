// src/lib/speech-text.ts
// 朗读前把 Markdown 转成纯文本，避免语音合成把 **、#、` 和链接地址也念出来。
// 只处理 AI 回复里常见的语法；代码块保留内容、去掉围栏。

export function toSpeechText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, '') // 代码块围栏（含语言标记）
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接：保留文字，去掉地址
    .replace(/`([^`]*)`/g, '$1') // 行内代码
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 标题
    .replace(/^\s{0,3}>\s?/gm, '') // 引用
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '') // 列表符号
    .replace(/(\*\*|__)(.+?)\1/g, '$2') // 加粗
    .replace(/\*(.+?)\*/g, '$1') // 斜体（不处理下划线，避免误伤 snake_case）
    .replace(/~~(.+?)~~/g, '$1') // 删除线
    .replace(/[ \t]+$/gm, '') // 行尾空白
    .trim();
}

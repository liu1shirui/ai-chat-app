// src/pages/_app.tsx
import "@/styles/globals.css"; // 检查这一行！
import type { AppProps } from "next/app";

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
// Library entry for the framework-agnostic chat utilities.
// Everything re-exported here is pure TypeScript (no React, no Next.js), which is what makes it
// safe to ship as a standalone ESM package: streaming (SSE) + long-list windowing + frame batching.
export * from './windowing';
export * from './frame-batcher';
export * from './sse-parser';
export * from './read-sse-stream';

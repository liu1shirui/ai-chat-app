// @vitest-environment jsdom
// 语音识别生命周期测试：用假的 SpeechRecognition 记录实例创建、start/stop/abort 调用和事件回调。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from './ChatInput';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  interimResults = false;
  continuous = true;
  onresult: ((e: { results: { transcript: string }[][] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  // 模拟浏览器回调
  emitResult(...parts: string[]) {
    this.onresult?.({ results: parts.map(p => [{ transcript: p }]) });
  }
}

const micButton = () => screen.getByRole('button', { name: /语音输入/ });

function renderInput(onChange = vi.fn()) {
  const props = { input: '', onSend: () => {}, isLoading: false };
  const view = render(<ChatInput {...props} onChange={onChange} />);
  // 父组件每次渲染都会传入新的箭头函数，这里模拟这种情况
  const rerenderWith = (next: (e: ChangeEvent<HTMLInputElement>) => void) =>
    view.rerender(<ChatInput {...props} onChange={next} />);
  return { ...view, rerenderWith };
}

beforeEach(() => {
  FakeRecognition.instances = [];
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChatInput – speech recognition lifecycle', () => {
  it('creates exactly one recognition instance, even when the parent re-renders with a new onChange', () => {
    const { rerenderWith } = renderInput();
    rerenderWith(vi.fn());
    rerenderWith(vi.fn());
    rerenderWith(vi.fn());
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(FakeRecognition.instances[0]).toMatchObject({ lang: 'zh-CN', interimResults: true, continuous: false });
  });

  it('results are delivered to the LATEST onChange callback', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerenderWith } = renderInput(first);
    fireEvent.click(micButton());
    rerenderWith(latest);

    act(() => FakeRecognition.instances[0].emitResult('你好', '世界'));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(expect.objectContaining({ target: { value: '你好世界' } }));
  });

  it('the stop button stops the SAME instance that was started, even after re-renders', () => {
    const { rerenderWith } = renderInput();
    fireEvent.click(micButton()); // start
    const started = FakeRecognition.instances[0];
    expect(started.start).toHaveBeenCalledTimes(1);

    rerenderWith(vi.fn()); // e.g. a transcript update re-rendered the parent
    fireEvent.click(micButton()); // stop
    expect(started.stop).toHaveBeenCalledTimes(1);
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it('button state follows the recognition: active after start, inactive after onend', () => {
    renderInput();
    fireEvent.click(micButton());
    expect(micButton().getAttribute('aria-label')).toBe('停止语音输入');

    act(() => FakeRecognition.instances[0].onend?.());
    expect(micButton().getAttribute('aria-label')).toBe('开始语音输入');
  });

  it('an error (e.g. microphone permission denied) resets the button to inactive', () => {
    renderInput();
    fireEvent.click(micButton());
    act(() => FakeRecognition.instances[0].onerror?.(new Event('error')));
    expect(micButton().getAttribute('aria-label')).toBe('开始语音输入');
  });

  it('if start() throws (already started / not allowed), the component stays inactive and does not crash', () => {
    renderInput();
    FakeRecognition.instances[0].start.mockImplementation(() => {
      throw new DOMException('already started', 'InvalidStateError');
    });
    expect(() => fireEvent.click(micButton())).not.toThrow();
    expect(micButton().getAttribute('aria-label')).toBe('开始语音输入');
  });

  it('on unmount: aborts recognition and detaches handlers so no late callback reaches an unmounted component', () => {
    const onChange = vi.fn();
    const { unmount } = renderInput(onChange);
    fireEvent.click(micButton());
    const instance = FakeRecognition.instances[0];

    unmount();
    expect(instance.abort).toHaveBeenCalledTimes(1);
    expect(instance.onresult).toBeNull();
    expect(instance.onend).toBeNull();
    expect(instance.onerror).toBeNull();
  });

  it('when the browser has no SpeechRecognition, no instance is created and clicking does not crash', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    renderInput();
    expect(() => fireEvent.click(micButton())).not.toThrow();
    expect(FakeRecognition.instances).toHaveLength(0);
    alertSpy.mockRestore();
  });
});

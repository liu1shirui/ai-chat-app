// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from './ChatInput';

function setup({ input = '你好', isLoading = false } = {}) {
  const onSend = vi.fn();
  render(<ChatInput input={input} onChange={() => {}} onSend={onSend} isLoading={isLoading} />);
  return { onSend, field: screen.getByPlaceholderText('输入消息...') };
}

afterEach(cleanup);

describe('ChatInput – Enter key and Chinese IME', () => {
  it('Enter submits when no composition is in progress', () => {
    const { onSend, field } = setup();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('Enter does NOT submit while an IME composition is in progress (isComposing)', () => {
    const { onSend, field } = setup();
    // 拼音输入法选词时按回车：浏览器派发的 keydown 带 isComposing: true
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Enter does NOT submit for keyCode 229 (composition keydown reported by some browsers/IMEs)', () => {
    const { onSend, field } = setup();
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('after composition ends, Enter submits normally', () => {
    const { onSend, field } = setup();
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true }); // confirms the candidate
    fireEvent.compositionEnd(field, { data: '你好' });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: 'Enter' }); // a fresh Enter after composition
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('Enter does not submit while loading or when the input is blank', () => {
    const loading = setup({ isLoading: true });
    fireEvent.keyDown(loading.field, { key: 'Enter' });
    expect(loading.onSend).not.toHaveBeenCalled();
    cleanup();

    const blank = setup({ input: '   ' });
    fireEvent.keyDown(blank.field, { key: 'Enter' });
    expect(blank.onSend).not.toHaveBeenCalled();
  });

  it('while loading with onCancel, shows a stop button that calls onCancel instead of the send button', () => {
    const onCancel = vi.fn();
    const onSend = vi.fn();
    render(<ChatInput input="你好" onChange={() => {}} onSend={onSend} onCancel={onCancel} isLoading />);
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('without onCancel, keeps the original disabled "..." button while loading', () => {
    render(<ChatInput input="你好" onChange={() => {}} onSend={() => {}} isLoading />);
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull();
    expect((screen.getByRole('button', { name: '...' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('other keys never submit', () => {
    const { onSend, field } = setup();
    fireEvent.keyDown(field, { key: 'a' });
    fireEvent.keyDown(field, { key: 'Tab' });
    expect(onSend).not.toHaveBeenCalled();
  });
});

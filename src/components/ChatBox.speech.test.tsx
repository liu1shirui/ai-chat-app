// @vitest-environment jsdom
// AI 回复的语音朗读（Web Speech Synthesis API）。speechSynthesis 与 SpeechSynthesisUtterance 都是测试替身。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { ChatBox } from './ChatBox';

class FakeUtterance {
  lang = '';
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

const synth = {
  speak: vi.fn<(u: FakeUtterance) => void>(),
  cancel: vi.fn(),
};

const msgs = (...pairs: [Message['role'], string][]): Message[] =>
  pairs.map(([role, content], i) => ({ id: `m${i}`, role, content }));

const readButtons = () => screen.queryAllByRole('button', { name: /朗读/ });

beforeEach(() => {
  synth.speak.mockReset();
  synth.cancel.mockReset();
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  Element.prototype.scrollTo = () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChatBox – read aloud (speechSynthesis)', () => {
  it('shows a read-aloud button on assistant messages only, and never speaks automatically', () => {
    render(<ChatBox messages={msgs(['user', '问题'], ['assistant', '回答一'], ['assistant', '回答二'])} />);
    expect(readButtons()).toHaveLength(2);
    expect(readButtons().every(b => b.getAttribute('aria-label') === '朗读')).toBe(true);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('click speaks the reply in zh-CN with markdown symbols stripped; the button becomes a stop toggle', () => {
    render(<ChatBox messages={msgs(['user', '问题'], ['assistant', '**重点**：使用 `useMemo`，详见[文档](https://x.dev)'])} />);
    fireEvent.click(screen.getByRole('button', { name: '朗读' }));

    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utterance = synth.speak.mock.calls[0][0];
    expect(utterance.lang).toBe('zh-CN');
    expect(utterance.text).toBe('重点：使用 useMemo，详见文档');
    const stop = screen.getByRole('button', { name: '停止朗读' });
    expect(stop.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking again stops speaking', () => {
    render(<ChatBox messages={msgs(['assistant', '回答'])} />);
    fireEvent.click(screen.getByRole('button', { name: '朗读' }));
    synth.cancel.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '停止朗读' }));
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '朗读' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('when speech ends (or errors) the button resets', () => {
    render(<ChatBox messages={msgs(['assistant', '回答'])} />);
    fireEvent.click(screen.getByRole('button', { name: '朗读' }));
    act(() => synth.speak.mock.calls[0][0].onend?.());
    expect(screen.getByRole('button', { name: '朗读' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '朗读' }));
    act(() => synth.speak.mock.calls[1][0].onerror?.());
    expect(screen.getByRole('button', { name: '朗读' })).toBeTruthy();
  });

  it('starting another message cancels the first; only one message is marked as speaking', () => {
    render(<ChatBox messages={msgs(['assistant', '第一条'], ['assistant', '第二条'])} />);
    const [first, second] = readButtons();
    fireEvent.click(first);
    synth.cancel.mockClear();
    fireEvent.click(second);

    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.speak.mock.calls.map(c => c[0].text)).toEqual(['第一条', '第二条']);
    // the first utterance ending late must not reset the second one's state
    act(() => synth.speak.mock.calls[0][0].onend?.());
    expect(screen.getAllByRole('button', { name: '停止朗读' })).toHaveLength(1);
  });

  it('a new message arriving cancels ongoing speech (no talking over the new reply)', () => {
    const initial = msgs(['user', '问题'], ['assistant', '旧回答']);
    const { rerender } = render(<ChatBox messages={initial} />);
    fireEvent.click(screen.getByRole('button', { name: '朗读' }));
    synth.cancel.mockClear();

    rerender(<ChatBox messages={[...initial, { id: 'new', role: 'user', content: '新问题' }]} />);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '停止朗读' })).toBeNull();
    expect(synth.speak).toHaveBeenCalledTimes(1); // still no autoplay
  });

  it('unmounting while speaking cancels speech', () => {
    const { unmount } = render(<ChatBox messages={msgs(['assistant', '回答'])} />);
    fireEvent.click(screen.getByRole('button', { name: '朗读' }));
    synth.cancel.mockClear();
    unmount();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it('unmounting when nothing is speaking does not cancel speech started elsewhere', () => {
    const { unmount } = render(<ChatBox messages={msgs(['assistant', '回答'])} />);
    unmount();
    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it('hides the button for the reply that is still streaming', () => {
    render(<ChatBox messages={msgs(['assistant', '完成的'], ['user', '问'], ['assistant', '生成中…'])} isStreaming />);
    expect(readButtons()).toHaveLength(1);
  });

  it('when speechSynthesis is unsupported, no buttons are shown and nothing crashes', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    render(<ChatBox messages={msgs(['assistant', '回答'])} />);
    expect(readButtons()).toHaveLength(0);
    expect(screen.getByText('回答')).toBeTruthy();
  });
});

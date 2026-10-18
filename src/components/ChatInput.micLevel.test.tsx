// @vitest-environment jsdom
// 语音输入时的麦克风音量指示（Web Audio API）：getUserMedia → AudioContext → AnalyserNode。
// 全部用测试替身：不会访问真实麦克风。动画帧手动驱动。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from './ChatInput';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  interimResults = false;
  continuous = true;
  onresult: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() { FakeRecognition.instances.push(this); }
}

// 时域数据：128 表示静音；振幅越大，偏离 128 越多
let amplitude = 0;
class FakeAnalyser {
  fftSize = 2048;
  get frequencyBinCount() { return this.fftSize / 2; }
  getByteTimeDomainData(buffer: Uint8Array) {
    for (let i = 0; i < buffer.length; i++) buffer[i] = 128 + (i % 2 === 0 ? amplitude : -amplitude);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  analyser = new FakeAnalyser();
  source = { connect: vi.fn(), disconnect: vi.fn() };
  close = vi.fn(async () => {});
  createMediaStreamSource = vi.fn(() => this.source);
  createAnalyser = vi.fn(() => this.analyser);
  constructor() { FakeAudioContext.instances.push(this); }
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { track, stream: { getTracks: () => [track] } };
}

// 手动驱动的 requestAnimationFrame
let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
const cancelAnimationFrameSpy = vi.fn((id: number) => { frames.delete(id); });
function runFrame() {
  const pending = [...frames.values()];
  frames = new Map();
  act(() => pending.forEach(cb => cb(performance.now())));
}

let getUserMedia: ReturnType<typeof vi.fn>;

const micButton = () => screen.getByRole('button', { name: /语音输入/ });
const meter = () => screen.queryByRole('meter', { name: '麦克风音量' });

function renderInput() {
  return render(<ChatInput input="" onChange={() => {}} onSend={() => {}} isLoading={false} />);
}

async function startRecording() {
  await act(async () => {
    fireEvent.click(micButton());
  });
}

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeAudioContext.instances = [];
  amplitude = 0;
  frames = new Map();
  cancelAnimationFrameSpy.mockClear();
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameSpy);
  const { stream } = fakeStream();
  getUserMedia = vi.fn(async () => stream);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
});

describe('ChatInput – microphone level meter (Web Audio API)', () => {
  it('shows no meter and opens no microphone stream until recording starts', () => {
    renderInput();
    expect(meter()).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('on record: opens the mic, wires MediaStreamSource → AnalyserNode, and drives the meter from time-domain data', async () => {
    renderInput();
    await startRecording();

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.createMediaStreamSource).toHaveBeenCalledTimes(1);
    expect(ctx.source.connect).toHaveBeenCalledWith(ctx.analyser);
    expect(meter()?.getAttribute('aria-valuenow')).toBe('0'); // silence

    amplitude = 64; // half scale
    runFrame();
    const loud = Number(meter()?.getAttribute('aria-valuenow'));
    expect(loud).toBeGreaterThan(30);

    amplitude = 0;
    runFrame();
    expect(Number(meter()?.getAttribute('aria-valuenow'))).toBeLessThan(loud);
    // speech recognition still runs alongside the meter
    expect(FakeRecognition.instances[0].start).toHaveBeenCalledTimes(1);
  });

  it('on stop: stops every track, disconnects, closes the AudioContext, cancels the animation frame, hides the meter', async () => {
    const { track, stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    renderInput();
    await startRecording();
    const ctx = FakeAudioContext.instances[0];

    await act(async () => {
      fireEvent.click(micButton()); // stop → recognition.onend
    });
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(ctx.source.disconnect).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrameSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(meter()).toBeNull();
  });

  it('on recognition error: releases the microphone and audio resources', async () => {
    const { track, stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    renderInput();
    await startRecording();

    await act(async () => {
      FakeRecognition.instances[0].onerror?.(new Event('error'));
    });
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('on unmount while recording: releases everything', async () => {
    const { track, stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { unmount } = renderInput();
    await startRecording();

    unmount();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('stopping before getUserMedia resolves: the late stream is stopped immediately and no AudioContext is created', async () => {
    const { track, stream } = fakeStream();
    let resolveMedia!: (s: typeof stream) => void;
    getUserMedia.mockReturnValue(new Promise(r => { resolveMedia = r; }));
    renderInput();
    await startRecording();
    await act(async () => {
      fireEvent.click(micButton()); // stop while permission prompt is still open
    });

    await act(async () => resolveMedia(stream));
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(meter()).toBeNull();
  });

  it('microphone permission denied: no crash, no meter, speech recognition behaviour unchanged', async () => {
    getUserMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    renderInput();
    await startRecording();

    expect(meter()).toBeNull();
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(FakeRecognition.instances[0].start).toHaveBeenCalledTimes(1);
    expect(micButton().getAttribute('aria-label')).toBe('停止语音输入');
  });

  it.each([
    ['no navigator.mediaDevices', () => Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })],
    ['no AudioContext', () => vi.stubGlobal('AudioContext', undefined)],
  ])('unsupported (%s): no crash, no meter, recognition still starts', async (_label, removeApi) => {
    removeApi();
    renderInput();
    await startRecording();
    expect(meter()).toBeNull();
    expect(FakeRecognition.instances[0].start).toHaveBeenCalledTimes(1);
  });
});

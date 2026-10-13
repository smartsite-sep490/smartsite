// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SmartSiteScrollWorld } from './SmartSiteScrollWorld';

const animation = vi.hoisted(() => ({
  options: undefined as undefined | { scrollTrigger: { end: () => string; scrub: number } },
  kill: vi.fn(),
  triggerKill: vi.fn(),
}));
const mockGsap = vi.hoisted(() => ({
  registerPlugin: vi.fn(),
  set: vi.fn(),
  to: vi.fn(),
  killTweensOf: vi.fn(),
  timeline: (options: typeof animation.options) => {
    animation.options = options;
    const chain = {
      fromTo: () => chain,
      to: () => chain,
      kill: animation.kill,
      scrollTrigger: { kill: animation.triggerKill },
    };
    return chain;
  },
}));
vi.mock('gsap', () => ({
  default: mockGsap,
  ...mockGsap,
}));
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: {} }));

let reducedMotion = false;
let narrow = false;
let hidden = false;
let observers: { notify: (visible: boolean) => void; disconnect: ReturnType<typeof vi.fn> }[];

beforeEach(() => {
  vi.clearAllMocks();
  reducedMotion = false;
  narrow = false;
  hidden = false;
  animation.options = undefined;
  observers = [];
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduced-motion') ? reducedMotion : narrow,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      disconnect = vi.fn();
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        observers.push({
          notify: (visible) => callback([{ isIntersecting: visible }]),
          disconnect: this.disconnect,
        });
      }
      observe() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function prepareFilm() {
  const result = render(<SmartSiteScrollWorld />);
  const video = result.container.querySelector('video')!;
  act(() => {
    observers[1]!.notify(true);
    observers[0]!.notify(true);
  });
  fireEvent.canPlay(video);
  return { ...result, video };
}

it('loads near the viewport and plays naturally without writing scroll positions to video time', async () => {
  const { container, unmount } = render(<SmartSiteScrollWorld />);
  const video = container.querySelector('video')!;
  const setTime = vi.fn();
  Object.defineProperty(video, 'currentTime', { get: () => 12, set: setTime });
  expect(video.hasAttribute('src')).toBe(false);
  expect(video.play).not.toHaveBeenCalled();
  act(() => {
    observers[1]!.notify(true);
    observers[0]!.notify(true);
  });
  expect(video.getAttribute('src')).toBe('/smartsite-journey.mp4');
  fireEvent.canPlay(video);
  await waitFor(() => expect(video.play).toHaveBeenCalledOnce());
  fireEvent.playing(video);
  expect(video.loop).toBe(true);
  expect(setTime).not.toHaveBeenCalled();
  act(() => observers[0]!.notify(false));
  expect(video.pause).toHaveBeenCalled();
  unmount();
  expect(animation.kill).toHaveBeenCalledOnce();
  expect(animation.triggerKill).toHaveBeenCalledOnce();
  expect(observers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);
});

it('preserves an explicit pause across visibility changes and resumes on user request', async () => {
  const { video } = prepareFilm();
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Pause film' }));
  expect(screen.getByRole('button', { name: 'Play film' })).toBeTruthy();
  vi.mocked(video.play).mockClear();
  hidden = true;
  fireEvent(document, new Event('visibilitychange'));
  hidden = false;
  fireEvent(document, new Event('visibilitychange'));
  expect(video.play).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
  await waitFor(() => expect(video.play).toHaveBeenCalledOnce());
});

it('allows a user to start playback when autoplay is rejected', async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('Autoplay denied'));
  const { video } = prepareFilm();
  await screen.findByRole('button', { name: 'Play film' });
  fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
  await waitFor(() => expect(video.play).toHaveBeenCalledTimes(2));
});

it('keeps the site image and offers retry when the film cannot load', () => {
  const { video } = prepareFilm();
  fireEvent.error(video);
  expect(screen.getByRole('status').textContent).toContain('Film unavailable');
  const loads = vi.mocked(video.load).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Retry film' }));
  expect(video.load).toHaveBeenCalledTimes(loads + 1);
});

it.each([
  [false, 2400],
  [true, 1500],
])('uses a shorter journey on narrow screens (%s)', (isNarrow, distance) => {
  narrow = isNarrow;
  const { container } = render(<SmartSiteScrollWorld />);
  Object.defineProperty(container.querySelector('section'), 'clientHeight', { value: 600 });
  expect(animation.options!.scrollTrigger.end()).toBe(`+=${distance}`);
  expect(animation.options!.scrollTrigger.scrub).toBe(0.55);
});

it('keeps a static poster without playback or pinning for reduced motion', () => {
  reducedMotion = true;
  const { container } = render(<SmartSiteScrollWorld />);
  expect(container.querySelector('video')!.hasAttribute('src')).toBe(false);
  expect(animation.options).toBeUndefined();
  expect(observers).toHaveLength(0);
  expect(screen.queryByRole('button')).toBeNull();
});

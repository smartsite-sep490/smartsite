import { useEffect, useRef, useState } from 'react';
import { PauseIcon, PlayIcon } from '@phosphor-icons/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const VIDEO_SRC = '/smartsite-journey.mp4';
const POSTER_SRC = '/smartsite-journey-poster.jpg';
const CHAPTERS = [
  {
    label: 'Workforce & access',
    title: 'From the gate.',
    description: 'People, assignments and arrivals — connected to the site.',
  },
  {
    label: 'Safety & evidence',
    title: 'Into the jobsite.',
    description: 'Bring observations and evidence into a shared operational view.',
  },
  {
    label: 'Operations & review',
    title: 'One connected operation.',
    description: 'Give responsible teams the context to review and act.',
  },
];

export function SmartSiteScrollWorld() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const syncPlaybackRef = useRef(() => {});
  const [paused, setPaused] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const video = videoRef.current;
    const fallback = fallbackRef.current;
    if (!section || !stage || !video || !fallback) return;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const narrowViewport = window.matchMedia('(max-width: 767px)');
    const chapters = section.querySelectorAll<HTMLElement>('[data-journey-chapter]');
    let disposeAnimation: (() => void) | undefined;

    const configure = () => {
      disposeAnimation?.();
      setReducedMotion(motionPreference.matches);
      setBlocked(false);
      setUnavailable(false);
      gsap.set(stage, { clearProps: 'transform' });
      gsap.set(video, { autoAlpha: 0 });
      gsap.set(fallback, { autoAlpha: 1 });
      gsap.set(chapters, { autoAlpha: 0, y: 24 });
      gsap.set(chapters[0]!, { autoAlpha: 1, y: 0 });
      syncPlaybackRef.current = () => {};
      if (motionPreference.matches) return;

      let active = false;
      let ready = false;
      let playPending = false;
      let disposed = false;

      // Playback owns video time. Scroll only animates composited text and transforms.
      const syncPlayback = () => {
        if (!active || document.hidden || pausedRef.current) {
          video.pause();
          return;
        }
        if (!ready || playPending || !video.paused) return;
        playPending = true;
        void video
          .play()
          .then(() => {
            if (disposed || !active || document.hidden || pausedRef.current) video.pause();
          })
          .catch(() => {
            if (!disposed && active && !document.hidden && !pausedRef.current) setBlocked(true);
          })
          .finally(() => {
            playPending = false;
          });
      };
      syncPlaybackRef.current = syncPlayback;
      const onReady = () => {
        ready = true;
        syncPlayback();
      };
      const onPlaying = () => {
        setBlocked(false);
        setUnavailable(false);
        gsap.to(video, { autoAlpha: 1, duration: 0.45, overwrite: true });
        gsap.to(fallback, { autoAlpha: 0, duration: 0.45, overwrite: true });
      };
      const onError = () => {
        ready = false;
        video.pause();
        setUnavailable(true);
        gsap.set(video, { autoAlpha: 0 });
        gsap.set(fallback, { autoAlpha: 1 });
      };
      const observer = new IntersectionObserver(
        ([entry]) => {
          active = entry?.isIntersecting ?? false;
          syncPlayback();
        },
        { threshold: 0.15 },
      );
      const loadObserver = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          video.src = VIDEO_SRC;
          video.load();
          loadObserver.disconnect();
        },
        { rootMargin: '100% 0px' },
      );
      video.addEventListener('canplay', onReady);
      video.addEventListener('playing', onPlaying);
      video.addEventListener('error', onError);
      document.addEventListener('visibilitychange', syncPlayback);
      observer.observe(section);
      loadObserver.observe(section);

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: () => `+=${section.clientHeight * (narrowViewport.matches ? 2.5 : 4)}`,
          pin: true,
          scrub: 0.55,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });
      timeline
        .fromTo(stage, { scale: 0.94 }, { scale: 1, duration: 0.7, ease: 'none' }, 0)
        .fromTo(chapters[0]!, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.5 }, 0)
        .to(chapters[0]!, { autoAlpha: 0, y: -20, duration: 0.35 }, 1.3)
        .to(chapters[1]!, { autoAlpha: 1, y: 0, duration: 0.5 }, 1.65)
        .to(chapters[1]!, { autoAlpha: 0, y: -20, duration: 0.35 }, 3)
        .to(chapters[2]!, { autoAlpha: 1, y: 0, duration: 0.5 }, 3.35)
        .to(chapters[2]!, { autoAlpha: 0, y: -20, duration: 0.35 }, 4.8)
        .to(stage, { scale: 0.94, y: -24, duration: 0.7, ease: 'none' }, 4.85);

      disposeAnimation = () => {
        disposed = true;
        syncPlaybackRef.current = () => {};
        video.pause();
        timeline.scrollTrigger?.kill();
        timeline.kill();
        observer.disconnect();
        loadObserver.disconnect();
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('error', onError);
        document.removeEventListener('visibilitychange', syncPlayback);
        gsap.killTweensOf([video, fallback]);
        video.removeAttribute('src');
        video.load();
        disposeAnimation = undefined;
      };
    };

    configure();
    motionPreference.addEventListener('change', configure);
    return () => {
      motionPreference.removeEventListener('change', configure);
      disposeAnimation?.();
      gsap.killTweensOf([stage, ...chapters]);
    };
  }, []);

  const togglePlayback = () => {
    const shouldPause = !pausedRef.current && !blocked && !unavailable;
    pausedRef.current = shouldPause;
    setPaused(shouldPause);
    if (unavailable) {
      setUnavailable(false);
      videoRef.current?.load();
    }
    syncPlaybackRef.current();
  };

  return (
    <section
      id="smartsite-scroll-world"
      ref={sectionRef}
      className="relative isolate h-[100svh] w-full overflow-hidden bg-[#041D2E]"
      aria-label="SmartSite site journey"
    >
      <h2 className="sr-only">From the gate to one connected operation</h2>
      <div ref={stageRef} className="absolute inset-0 overflow-hidden rounded-3xl bg-[#041D2E]">
        <div ref={fallbackRef} className="absolute inset-0">
          <img
            src={POSTER_SRC}
            alt="Construction site with workers and cranes"
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </div>
        <video
          ref={videoRef}
          poster={POSTER_SRC}
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover opacity-0"
          muted
          playsInline
          loop
          aria-hidden="true"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#041D2E]/95 via-[#041D2E]/20 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#041D2E]/35 to-transparent" />
        <div className="absolute inset-x-0 bottom-[15%] mx-auto w-full max-w-7xl px-6 md:px-12">
          <div className="relative min-h-[220px] md:min-h-[250px]">
            {CHAPTERS.map((chapter, index) => (
              <div
                key={chapter.label}
                data-journey-chapter
                aria-hidden="true"
                className={`absolute inset-x-0 bottom-0 max-w-3xl ${index ? 'invisible opacity-0' : ''}`}
              >
                <p className="mb-5 text-xs font-bold uppercase tracking-[0.18em] text-[#F66B17]">
                  {chapter.label}
                </p>
                <p className="text-4xl font-bold leading-[1.06] tracking-tight text-white sm:text-5xl md:text-7xl">
                  {chapter.title}
                </p>
                <p className="mt-6 max-w-lg text-base leading-relaxed text-slate-200 md:text-lg">
                  {chapter.description}
                </p>
              </div>
            ))}
          </div>
        </div>
        {!reducedMotion && (
          <div className="absolute bottom-6 right-6 md:bottom-10 md:right-12">
            <button
              type="button"
              onClick={togglePlayback}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/30 bg-[#041D2E]/80 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#041D2E] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              {paused || blocked || unavailable ? (
                <PlayIcon size={16} aria-hidden="true" />
              ) : (
                <PauseIcon size={16} aria-hidden="true" />
              )}
              {unavailable ? 'Retry film' : paused || blocked ? 'Play film' : 'Pause film'}
            </button>
            {unavailable && (
              <p role="status" className="mt-2 text-xs text-white">
                Film unavailable. Showing the site image.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger);

const VIDEO_SRC = '/smartsite-journey.mp4';
const POSTER_SRC = '/smartsite-journey-poster.jpg';
// Increase scroll height distance to 14 viewports (1400vh) for slow, cinematic mouse wheel travel
const SCENE_COUNT = 14;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function SmartSiteScrollWorld() {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fallbackStageRef = useRef<HTMLDivElement>(null);

  // State refs for continuous RAF lerp engine (from scroll-world skill scrub-engine.js)
  const targetProgressRef = useRef(0);
  const currentProgressRef = useRef(0);
  const videoReadyRef = useRef(false);
  const isRevealedRef = useRef(false);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const video = videoRef.current;
    const fallbackStage = fallbackStageRef.current;
    if (!section || !video || !fallbackStage) return undefined;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return undefined;

    let rafId: number | null = null;
    let isMounted = true;

    const revealVideo = () => {
      if (isRevealedRef.current) return;
      isRevealedRef.current = true;
      gsap.to(video, { autoAlpha: 1, duration: 0.3, ease: 'power2.out', overwrite: true });
      gsap.to(fallbackStage, { autoAlpha: 0, duration: 0.3, ease: 'power2.out', overwrite: true });
    };

    // 1. Fetch video as Blob for instant zero-latency memory seeking
    fetch(VIDEO_SRC)
      .then((res) => {
        if (!res.ok) throw new Error('Video fetch failed');
        return res.blob();
      })
      .then((blob) => {
        if (!isMounted) return;
        const objectUrl = URL.createObjectURL(blob);
        blobUrlRef.current = objectUrl;
        video.src = objectUrl;
        video.preload = 'auto';
        video.load();
      })
      .catch(() => {
        // Fallback to direct URL if blob fetch fails
        if (!isMounted) return;
        video.src = VIDEO_SRC;
        video.preload = 'auto';
        video.load();
      });

    const onReady = () => {
      if (!isMounted) return;
      videoReadyRef.current = true;
      revealVideo();
    };

    const onVideoError = () => {
      if (!isMounted) return;
      videoReadyRef.current = false;
      gsap.to(video, { autoAlpha: 0, duration: 0.2, overwrite: true });
      gsap.to(fallbackStage, { autoAlpha: 1, duration: 0.2, overwrite: true });
    };

    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('seeked', revealVideo, { once: true });
    video.addEventListener('error', onVideoError);

    // 2. Continuous 60fps RAF loop matching scroll-world skill (scrub-engine.js)
    const tick = () => {
      if (!isMounted) return;

      const target = targetProgressRef.current;
      const current = currentProgressRef.current;

      // Smooth ease-out lerp (0.09) per frame for heavy cinematic camera momentum
      currentProgressRef.current += (target - current) * 0.09;

      if (videoReadyRef.current && video.duration && Number.isFinite(video.duration)) {
        // Do not queue a seek if decoder is currently resolving previous seek
        if (!video.seeking) {
          const maxTime = Math.max(video.duration - 0.04, 0);
          const t = clamp(currentProgressRef.current, 0, 0.999) * maxTime;

          // 0.008 threshold matching scroll-world desktop precision
          if (Math.abs(video.currentTime - t) > 0.008) {
            try {
              video.currentTime = t;
            } catch {
              // Ignore transient seek errors
            }
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      isMounted = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onVideoError);
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  useGSAP(
    () => {
      const section = sectionRef.current;
      if (!section) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: () => `+=${window.innerHeight * SCENE_COUNT}`,
        pin: true,
        scrub: 1.2, // GSAP 1.2s smooth dampening curve on mouse wheel ticks
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          targetProgressRef.current = clamp(self.progress);
        },
      });
      targetProgressRef.current = 0;
    },
    { scope: sectionRef },
  );

  return (
    <section
      id="smartsite-scroll-world"
      ref={sectionRef}
      className="relative isolate h-screen w-full overflow-hidden bg-black"
      aria-label="SmartSite Scroll Video"
    >
      <div className="relative h-full w-full overflow-hidden bg-black">
        {/* Static poster fallback stage */}
        <div ref={fallbackStageRef} className="absolute inset-0 z-0 overflow-hidden">
          <img
            src={POSTER_SRC}
            alt="SmartSite Journey Poster"
            className="h-full w-full object-cover object-center"
            loading="eager"
            decoding="async"
          />
        </div>

        {/* Clean, un-overlayed H.264 video element */}
        <video
          ref={videoRef}
          poster={POSTER_SRC}
          className="absolute inset-0 z-[1] h-full w-full object-cover opacity-0"
          muted
          playsInline
          aria-hidden="true"
        />
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../useMediaQuery';

/** Phones held upright get the tall crop of the video and of its still. */
const PORTRAIT = '(max-width: 699px) and (orientation: portrait)';

const saveData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

export interface AmbientSources {
  video: string;
  videoPortrait: string;
  poster: string;
  posterPortrait: string;
  width: number;
  height: number;
}

/**
 * A silent looping video behind a section, decoration only (aria-hidden). The still shows first;
 * the video is fetched once the section is near the screen, plays while it is on screen and pauses
 * when it leaves. Visitors who ask for less motion or for data saving keep the still: no download.
 */
export function AmbientVideo({ sources }: { sources: AmbientSources }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const portrait = useMediaQuery(PORTRAIT);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  // the src that has started playing: the video fades in over the still only then
  const [playingSrc, setPlayingSrc] = useState<string>();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const nearby = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '400px 0px' });
    const onScreen = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 });
    nearby.observe(el);
    onScreen.observe(el);
    return () => {
      nearby.disconnect();
      onScreen.disconnect();
    };
  }, []);

  const src = reduced || saveData() || !near ? undefined : portrait ? sources.videoPortrait : sources.video;

  // a new src mounts a new <video> (key): play or pause that one
  useEffect(() => {
    const v = video.current;
    if (!v || !src) return;
    if (visible) v.play().catch(() => {});
    else v.pause();
  }, [src, visible]);

  return (
    <div className="ambient" ref={box} aria-hidden="true">
      <picture>
        <source media={PORTRAIT} srcSet={sources.posterPortrait} />
        <img src={sources.poster} alt="" width={sources.width} height={sources.height} fetchPriority="high" />
      </picture>
      {src && (
        <video
          key={src}
          ref={video}
          className={playingSrc === src ? 'is-playing' : undefined}
          src={src}
          muted
          playsInline
          loop
          preload="auto"
          disablePictureInPicture
          onPlaying={() => setPlayingSrc(src)}
        />
      )}
    </div>
  );
}

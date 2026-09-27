import { media, type MediaName } from '../media';

/** An approved photo with its real size (no layout shift) and lazy loading below the fold. */
export function Photo({
  name,
  alt,
  className,
  priority = false,
  sizes,
}: {
  name: MediaName;
  alt: string;
  className?: string;
  /** true for the first image on screen: loaded immediately with high priority. */
  priority?: boolean;
  sizes?: string;
}) {
  const m = media[name];
  return (
    <img
      src={m.src}
      width={m.width}
      height={m.height}
      alt={alt}
      className={className}
      sizes={sizes}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : undefined}
    />
  );
}

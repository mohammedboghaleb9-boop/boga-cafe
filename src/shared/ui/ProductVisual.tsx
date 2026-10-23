/**
 * Product picture: the real 1 kg pouch photo (approved hexagon label) with a live
 * product sticker under the label — name, Arabica/Robusta, origin flags, roast,
 * weight — generated from the catalog. A product added in the Admin Panel gets a
 * correct pouch picture with no new photo shoot. A product with its own photo
 * (`image`) shows that photo instead. The sticker only appears once the photo is loaded and decoded.
 */
import { media } from '../media';
import type { StickerData } from '../sticker';
import { Flag } from './Flag';
import { useImageReady } from './useImageReady';
import './product-visual.css';

export function ProductVisual({
  sticker,
  alt,
  image,
  priority = false,
  className = '',
}: {
  sticker: StickerData;
  alt: string;
  image?: string;
  priority?: boolean;
  className?: string;
}) {
  const { ref, attempt, state } = useImageReady();
  const m = media.packshot;
  const photo = image ? (
    <img key={attempt} ref={ref} className="pv-photo" src={image} alt={alt} loading={priority ? 'eager' : 'lazy'} />
  ) : (
    <img
      key={attempt}
      ref={ref}
      className="pv-photo"
      src={m.src}
      width={m.width}
      height={m.height}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      // the one picture every pouch needs: it goes before the large photos of the page
      fetchPriority="high"
    />
  );
  return (
    <figure className={`pv ${className}`} data-state={state}>
      <div className="pv-inner">
        {state === 'failed' ? (
          // the photo did not come: the name in plain text, never the sticker alone on a black frame
          <span className="pv-fallback" role={alt ? 'img' : undefined} aria-label={alt || undefined}>
            <span className="pv-fallback-title">{sticker.title}</span>
            <span className="pv-fallback-blend">{sticker.blend}</span>
          </span>
        ) : (
          photo
        )}
        {/* the sticker appears with the photo (loaded and decoded), never before it */}
        {!image && state === 'ready' && (
          <div className="pv-sticker" aria-hidden="true">
            {/* about 14 Cinzel capitals fit the sticker: longer names get a smaller size, never cut */}
            <span className="pv-title" style={{ ['--title-fit' as string]: Math.min(1, 14 / Math.max(1, sticker.title.length)) }}>
              {sticker.title}
            </span>
            <span className="pv-blend">{sticker.blend}</span>
            {sticker.flags.length > 0 && (
              <span className="pv-flags">
                {sticker.flags.slice(0, 5).map((f, i) => (
                  <Flag key={`${f.code}-${i}`} code={f.code} title={f.title} size={20} />
                ))}
              </span>
            )}
            <span className="pv-foot">
              <span>{sticker.detail}</span>
              <span className="pv-weight">{sticker.weight}</span>
            </span>
          </div>
        )}
      </div>
    </figure>
  );
}

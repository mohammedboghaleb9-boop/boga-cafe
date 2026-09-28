/**
 * Product picture: the real 1 kg pouch photo (approved hexagon label) with a live
 * product sticker under the label — name, Arabica/Robusta, origin flags, roast,
 * weight — generated from the catalog. A product added in the Admin Panel gets a
 * correct pouch picture with no new photo shoot. A product with its own photo
 * (`image`) shows that photo instead.
 */
import { media } from '../media';
import type { StickerData } from '../sticker';
import { Flag } from './Flag';
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
  if (image) {
    return (
      <figure className={`pv ${className}`}>
        <div className="pv-inner">
          <img className="pv-photo" src={image} alt={alt} loading={priority ? 'eager' : 'lazy'} />
        </div>
      </figure>
    );
  }
  const m = media.packshot;
  return (
    <figure className={`pv ${className}`}>
      <div className="pv-inner">
        <img
          className="pv-photo"
          src={m.src}
          width={m.width}
          height={m.height}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
        />
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
      </div>
    </figure>
  );
}

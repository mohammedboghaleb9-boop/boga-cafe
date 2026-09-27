/**
 * The BOGA CAFÉ bag drawn in CSS: black stand-up pouch + hexagonal silver
 * label, like the real packaging. Each product (and each Custom Blend)
 * gets its own label text, flags and weight.
 */
import { formatSize } from '@/core/format';
import { Flag } from './Flag';
import { ZelligePattern } from './Pattern';
import './bag.css';

export interface BagMockupProps {
  name: string;
  subtitle?: string;
  flags?: { code: string; title: string }[];
  weightGrams?: number;
  size?: 'sm' | 'md' | 'lg';
  image?: string;
}

export function BagMockup({ name, subtitle, flags = [], weightGrams = 1000, size = 'md', image }: BagMockupProps) {
  if (image) {
    return (
      <div className={`bag-photo bag-${size}`}>
        <img src={image} alt={name} loading="lazy" />
      </div>
    );
  }
  return (
    <div className={`bag bag-${size}`} role="img" aria-label={`BOGA CAFÉ · ${name} · ${formatSize(weightGrams)}`}>
      <div className="bag-body">
        <div className="bag-fold" />
        <div className="bag-label">
          <div className="bag-label-inner">
            <div className="bag-label-top">
              <ZelligePattern className="bag-pattern" opacity={0.5} />
              <span className="bag-mono">B</span>
            </div>
            <span className="bag-brand">BOGA CAFÉ</span>
            <span className="bag-name">{name}</span>
            {subtitle && <span className="bag-sub">{subtitle}</span>}
            {flags.length > 0 && (
              <span className="bag-flags">
                {flags.slice(0, 4).map((f) => (
                  <Flag key={f.code + f.title} code={f.code} title={f.title} size={16} />
                ))}
              </span>
            )}
            <span className="bag-weight">℮ {formatSize(weightGrams)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Moroccan zellige star pattern (8-point stars), the motif around the "B"
 * of the BOGA CAFÉ label. Used as a quiet background texture.
 */
import { useId } from 'react';

export function ZelligePattern({ className, opacity = 0.14 }: { className?: string; opacity?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} aria-hidden="true" width="100%" height="100%">
      <defs>
        <pattern id={`z${id}`} width="48" height="48" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M24 6 29 19 42 24 29 29 24 42 19 29 6 24 19 19Z" />
            <rect x="14" y="14" width="20" height="20" transform="rotate(45 24 24)" />
            <rect x="14" y="14" width="20" height="20" />
            <path d="M0 0 6 6M48 0l-6 6M0 48l6-6M48 48l-6-6" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#z${id})`} style={{ opacity }} />
    </svg>
  );
}

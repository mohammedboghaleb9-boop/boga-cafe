/**
 * Moroccan star-and-cross zellige (8-point stars whose tips touch), the same
 * lattice as the crown of the BOGA CAFÉ emblem. A quiet background texture.
 */
import { useId } from 'react';

export function ZelligePattern({ className, opacity = 0.14 }: { className?: string; opacity?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} aria-hidden="true" width="100%" height="100%">
      <defs>
        <pattern id={`z${id}`} width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 24 40.97 31.03 40.97 40.97 31.03 40.97 24 48 16.97 40.97 7.03 40.97 7.03 31.03 0 24 7.03 16.97 7.03 7.03 16.97 7.03 24 0 31.03 7.03 40.97 7.03 40.97 16.97Z" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#z${id})`} style={{ opacity }} />
    </svg>
  );
}

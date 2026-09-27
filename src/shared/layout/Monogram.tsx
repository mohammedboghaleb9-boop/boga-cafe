import monogram from '@/assets/brand/monogram.svg?raw';

/**
 * The BOGA CAFÉ monogram (hexagon, B, two beans), vector traced from the
 * approved icon. It takes the text colour, so it works on dark and light.
 */
export function Monogram({ className }: { className?: string }) {
  return <span className={`monogram ${className ?? ''}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: monogram }} />;
}

import monogramSmall from '@/assets/brand/monogram-small.svg?raw';
import logo from '@/assets/brand/logo.svg?raw';

/**
 * The BOGA CAFÉ vector marks, built in brand/source/build_logo.py. They take
 * the text colour, so they work on dark and light backgrounds.
 * - `small`: no engraved inline, for sizes under ~48 px (header, favicon).
 * - `emblem`: the primary logo (zellige crown + wordmark), 96 px tall or more.
 */
const marks = { small: monogramSmall, emblem: logo };

export function Monogram({ className, variant = 'small' }: { className?: string; variant?: keyof typeof marks }) {
  return <span className={`monogram ${className ?? ''}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: marks[variant] }} />;
}

import { Link } from 'react-router';
import lockup from '@/assets/brand/lockup.svg?raw';
import lockupCompact from '@/assets/brand/lockup-compact.svg?raw';

/**
 * Header lockup: the monogram, BOGA CAFÉ with CAFÉ in copper, the website's tagline under the name.
 * Built by brand/source/build_lockup.py (the official paths, the tagline set in the official tagline's font);
 * phones get the compact one (small monogram, no tagline). Colours come from CSS (.lk-mark, .lk-boga,
 * .lk-cafe, .lk-tag in layout.css).
 */
export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="BOGA CAFÉ">
      <span className="logo-full" aria-hidden="true" dangerouslySetInnerHTML={{ __html: lockup }} />
      <span className="logo-compact" aria-hidden="true" dangerouslySetInnerHTML={{ __html: lockupCompact }} />
    </Link>
  );
}

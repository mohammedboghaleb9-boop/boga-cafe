import { Link } from 'react-router';
import { Monogram } from './Monogram';

/** Header wordmark: the approved monogram, then the brand name. */
export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="BOGA CAFÉ">
      <Monogram className="logo-mark" />
      <span className="logo-word">
        BOGA <span>CAFÉ</span>
      </span>
    </Link>
  );
}

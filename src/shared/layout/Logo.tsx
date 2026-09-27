import { Link } from 'react-router';

/** Header wordmark: the hexagonal label with its "B", then the brand name. */
export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="BOGA CAFÉ">
      <svg viewBox="0 0 40 56" width="26" height="36" aria-hidden="true">
        <path d="M20 1 39 7v42L20 55 1 49V7Z" fill="var(--surface)" stroke="currentColor" strokeWidth="2" />
        <text x="20" y="36" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontWeight="700" fontSize="26" fill="currentColor">
          B
        </text>
      </svg>
      <span className="logo-word">
        BOGA <span>CAFÉ</span>
      </span>
    </Link>
  );
}

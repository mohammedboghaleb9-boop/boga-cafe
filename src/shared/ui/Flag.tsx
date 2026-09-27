import type { ReactElement } from 'react';

/**
 * Country flags drawn in SVG (emoji flags do not show on Windows).
 * A country without a drawing falls back to its ISO code.
 */
const flags: Record<string, ReactElement> = {
  BR: (
    <>
      <rect width="30" height="20" fill="#229e45" />
      <path d="M15 3 27 10 15 17 3 10Z" fill="#f8e509" />
      <circle cx="15" cy="10" r="4.2" fill="#2b49a3" />
    </>
  ),
  HN: (
    <>
      <rect width="30" height="20" fill="#0073cf" />
      <rect y="6.67" width="30" height="6.66" fill="#fff" />
      <g fill="#0073cf">
        <circle cx="15" cy="10" r="0.9" />
        <circle cx="11.5" cy="8.4" r="0.8" />
        <circle cx="11.5" cy="11.6" r="0.8" />
        <circle cx="18.5" cy="8.4" r="0.8" />
        <circle cx="18.5" cy="11.6" r="0.8" />
      </g>
    </>
  ),
  CO: (
    <>
      <rect width="30" height="20" fill="#fcd116" />
      <rect y="10" width="30" height="5" fill="#003893" />
      <rect y="15" width="30" height="5" fill="#ce1126" />
    </>
  ),
  ET: (
    <>
      <rect width="30" height="20" fill="#078930" />
      <rect y="6.67" width="30" height="6.66" fill="#fcdd09" />
      <rect y="13.33" width="30" height="6.67" fill="#da121a" />
      <circle cx="15" cy="10" r="4" fill="#0f47af" />
      <path d="m15 7.4.8 2.3h2.4l-2 1.4.8 2.4-2-1.5-2 1.5.8-2.4-2-1.4h2.4Z" fill="#fcdd09" />
    </>
  ),
  VN: (
    <>
      <rect width="30" height="20" fill="#da251d" />
      <path d="m15 4.5 1.5 4.6h4.8l-3.9 2.8 1.5 4.6-3.9-2.8-3.9 2.8 1.5-4.6-3.9-2.8h4.8Z" fill="#ff0" />
    </>
  ),
  UG: (
    <>
      {['#000', '#fcdc04', '#d90000', '#000', '#fcdc04', '#d90000'].map((c, i) => (
        <rect key={i} y={(20 / 6) * i} width="30" height={20 / 6 + 0.1} fill={c} />
      ))}
      <circle cx="15" cy="10" r="3.6" fill="#fff" />
    </>
  ),
  MA: (
    <>
      <rect width="30" height="20" fill="#c1272d" />
      <path d="m15 5.2 1.4 4.3h-2.8zM11 8.6h8l-6.5 4.7 2.5-7.6 2.5 7.6z" fill="none" stroke="#006233" strokeWidth="0.9" />
    </>
  ),
};

export function Flag({ code, size = 22, title }: { code: string; size?: number; title?: string }) {
  const drawing = flags[code.toUpperCase()];
  const height = Math.round((size * 2) / 3);
  if (!drawing) {
    return (
      <span className="flag-fallback" style={{ inlineSize: size, blockSize: height }} title={title}>
        {code.toUpperCase()}
      </span>
    );
  }
  return (
    <svg className="flag" width={size} height={height} viewBox="0 0 30 20" role="img" aria-label={title ?? code}>
      {drawing}
    </svg>
  );
}

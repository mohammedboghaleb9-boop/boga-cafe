/** A roasted bean drawn in SVG: the origins section's ornament and the beans of its roast scale. */
export function BeanGlyph({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={Math.round((size * 16) / 22)} height={size} viewBox="0 0 16 22" aria-hidden="true" focusable="false">
      <g transform="rotate(-16 8 11)">
        <ellipse cx="8" cy="11" rx="6.2" ry="9.4" fill="currentColor" />
        <path d="M8.6 2.4C6 5.2 6 7.8 8 11s2 5.8-.6 8.6" fill="none" stroke="rgb(0 0 0 / 0.55)" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

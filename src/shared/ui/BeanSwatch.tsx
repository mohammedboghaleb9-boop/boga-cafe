import { useId } from 'react';
import type { RoastLevel, Species } from '@/core/types';

/**
 * Three roasted beans drawn in the colour of the roast level. Arabica beans
 * are long ovals with a wavy crease, robusta beans rounder with a straight one:
 * the same shape language as the beans in the BOGA CAFÉ monogram.
 */
const roastColours: Record<RoastLevel, { hi: string; base: string; edge: string; crease: string; sheen: number }> = {
  light: { hi: '#c7935f', base: '#9b6a3e', edge: '#6b4324', crease: '#4a2c16', sheen: 0.1 },
  medium: { hi: '#9a6640', base: '#6f4428', edge: '#472915', crease: '#2c180b', sheen: 0.14 },
  'medium-dark': { hi: '#71482f', base: '#4e2f1b', edge: '#301b0e', crease: '#1a0e07', sheen: 0.2 },
  dark: { hi: '#5c3d2c', base: '#37231a', edge: '#1b100a', crease: '#0b0604', sheen: 0.34 },
};

const layout = [
  { x: 17, y: 23, r: -32 },
  { x: 36, y: 20, r: 14 },
  { x: 55, y: 24, r: -8 },
];

export function BeanSwatch({
  roast,
  species,
  size = 64,
  className,
}: {
  roast: RoastLevel;
  species: Species;
  size?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const c = roastColours[roast];
  const [rx, ry] = species === 'arabica' ? [8.2, 13] : [9.6, 11.6];
  const crease =
    species === 'arabica'
      ? `M0 ${-ry + 1.6}C3.2 ${-ry / 2.4} -3.2 ${ry / 2.4} 0 ${ry - 1.6}`
      : `M0 ${-ry + 1.8}C1 ${-ry / 3} -1 ${ry / 3} 0 ${ry - 1.8}`;
  return (
    <svg
      className={`bean-swatch ${className ?? ''}`}
      width={size}
      height={(size * 44) / 72}
      viewBox="0 0 72 44"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`b${id}`} cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor={c.hi} />
          <stop offset="0.55" stopColor={c.base} />
          <stop offset="1" stopColor={c.edge} />
        </radialGradient>
      </defs>
      {layout.map((b, i) => (
        <g key={i} transform={`translate(${b.x} ${b.y}) rotate(${b.r})`}>
          <ellipse rx={rx} ry={ry} fill={`url(#b${id})`} stroke="#fff" strokeOpacity="0.14" strokeWidth="0.7" />
          <path d={crease} fill="none" stroke={c.crease} strokeWidth="1.7" strokeLinecap="round" />
          <ellipse cx={-rx * 0.38} cy={-ry * 0.42} rx={rx * 0.28} ry={ry * 0.2} fill="#fff" opacity={c.sheen} />
        </g>
      ))}
    </svg>
  );
}

import type { RoastLevel } from '@/core/types';
import { useI18n } from '@/i18n';
import type { MediaName } from '../media';
import { Photo } from './Photo';
import './roast.css';

export const roastLevels: RoastLevel[] = ['light', 'medium', 'medium-dark', 'dark'];

const roastPhoto: Record<RoastLevel, MediaName> = {
  light: 'roastLight',
  medium: 'roastMedium',
  'medium-dark': 'roastMediumDark',
  dark: 'roastDark',
};

/** Round close-up of beans at this roast level. Decorative: always shown next to the level's name. */
export function RoastChip({ level, size = 44, className }: { level: RoastLevel; size?: number; className?: string }) {
  return (
    <span className={`roast-chip ${className ?? ''}`} style={{ inlineSize: size, blockSize: size }}>
      <Photo name={roastPhoto[level]} alt="" sizes={`${size}px`} />
    </span>
  );
}

/** The four roast levels from light to dark, with this product's level highlighted. */
export function RoastScale({ level }: { level: RoastLevel }) {
  const { t } = useI18n();
  return (
    <ol className="roast-scale" aria-label={`${t.common.roast} : ${t.roast[level]}`}>
      {roastLevels.map((r) => (
        <li key={r} className={r === level ? 'is-current' : undefined} aria-current={r === level ? 'true' : undefined}>
          <RoastChip level={r} size={r === level ? 52 : 38} />
          <span>{t.roast[r]}</span>
        </li>
      ))}
    </ol>
  );
}

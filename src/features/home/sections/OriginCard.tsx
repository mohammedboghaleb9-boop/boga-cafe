import type { Origin } from '@/core/types';
import { useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';
import { RoastChip, roastLevels } from '@/shared/ui/Roast';

/** A roasted bean drawn in SVG: the section's ornament and the beans of the roast scale. */
export function BeanGlyph({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={(size * 16) / 22} height={size} viewBox="0 0 16 22" aria-hidden="true" focusable="false">
      <g transform="rotate(-16 8 11)">
        <ellipse cx="8" cy="11" rx="6.2" ry="9.4" fill="currentColor" />
        <path d="M8.6 2.4C6 5.2 6 7.8 8 11s2 5.8-.6 8.6" fill="none" stroke="rgb(0 0 0 / 0.55)" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** One origin as it is in the catalog: flag, name, species, region, tasting notes and roast level. */
export function OriginCard({ origin }: { origin: Origin }) {
  const { t, l } = useI18n();
  const filled = roastLevels.indexOf(origin.roastLevel) + 1;
  return (
    <li className="origin-card reveal">
      <div className="origin-card-text">
        <h3 className="origin-name">
          <Flag code={origin.countryCode} title={l(origin.name)} size={28} />
          <span>{l(origin.name)}</span>
        </h3>
        <p className="origin-meta">
          {t.common[origin.species]} - <bdi>{origin.region}</bdi>
        </p>
        <p className="origin-notes">{l(origin.tastingNotes)}</p>
        <p className="origin-roast-name">
          <span className="sr-only">{t.common.roast} : </span>
          {t.roast[origin.roastLevel]}
        </p>
      </div>
      <div className="origin-card-media" aria-hidden="true">
        <RoastChip level={origin.roastLevel} size={76} />
        <span className="origin-beans">
          {roastLevels.map((r, i) => (
            <BeanGlyph key={r} size={15} className={i < filled ? 'is-on' : undefined} />
          ))}
        </span>
      </div>
    </li>
  );
}

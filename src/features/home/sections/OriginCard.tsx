import type { Origin } from '@/core/types';
import { useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';
import { RoastChip, roastLevels } from '@/shared/ui/Roast';
import { BeanGlyph } from './BeanGlyph';
import { CardTerrain } from './OriginsDecor';

/**
 * One origin as it is in the catalog: flag, name, species, region, tasting notes and roast level.
 * The parts are siblings so that origins.css can lay them out as a card (tablet, desktop)
 * or as a compact row of the phone list, where species and roast line up from row to row.
 */
export function OriginCard({ origin, index }: { origin: Origin; index: number }) {
  const { t, l } = useI18n();
  const lit = roastLevels.indexOf(origin.roastLevel) + 1;
  return (
    <li className="origin-card reveal">
      <CardTerrain index={index} />
      <h3 className="origin-name">
        <Flag code={origin.countryCode} title="" size={28} />
        <span>{l(origin.name)}</span>
      </h3>
      <p className="origin-meta">
        <span className="origin-species">{t.common[origin.species]}</span>
        <span className="origin-sep" aria-hidden="true">
          {' - '}
        </span>
        <bdi className="origin-region">{origin.region}</bdi>
      </p>
      <p className="origin-notes">{l(origin.tastingNotes)}</p>
      <p className="origin-roast-name">
        <span className="sr-only">{t.common.roast} : </span>
        {t.roast[origin.roastLevel]}
      </p>
      <RoastChip level={origin.roastLevel} size={76} className="origin-roast-photo" />
      <span className="origin-beans" aria-hidden="true">
        {roastLevels.map((r, i) => (
          <BeanGlyph key={r} size={15} className={i < lit ? 'is-on' : undefined} />
        ))}
      </span>
    </li>
  );
}

/** One cart / order line: name, size, recipe grams for custom blends. */
import { formatNumber, formatSize } from '@/core/format';
import type { OrderLine } from '@/core/types';
import { useCatalog } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';

export function LineDetails({ line }: { line: OrderLine }) {
  const { l, t } = useI18n();
  const { originIndex } = useCatalog();
  return (
    <div className="line-details">
      <strong>{l(line.name)}</strong>
      <span className="small muted">
        {formatSize(line.size)} · {t.common.wholeBeans}
      </span>
      {line.kind === 'custom' && (
        <span className="line-recipe small">
          {line.composition.map((c) => {
            const o = originIndex[c.originId];
            return (
              <span key={c.originId}>
                {o && <Flag code={o.countryCode} size={14} title={l(o.name)} />} {o ? l(o.name) : c.originId} {c.percent}% (
                {formatNumber(c.grams, 1)} g)
              </span>
            );
          })}
        </span>
      )}
    </div>
  );
}

import { balanceBlend, type BlendIssue } from '@/core/blend';
import { recipeTotal, type OriginIndex } from '@/core/recipe';
import type { Localized, RecipeLine } from '@/core/types';
import { fmt } from '@/i18n';
import type { Dict } from '@/i18n/dictionaries/en';

/** Even split that always totals 100 (e.g. 33 / 33 / 34). */
export function evenSplit(ids: string[]): RecipeLine[] {
  const base = Math.floor(100 / ids.length);
  return ids.map((originId, i) => ({
    originId,
    percent: i === ids.length - 1 ? 100 - base * (ids.length - 1) : base,
  }));
}

/** Adding a coffee gives it what is left, or re-splits evenly when nothing is left. */
export function addLine(lines: RecipeLine[], originId: string, minPercent: number): RecipeLine[] {
  const remaining = 100 - recipeTotal(lines);
  if (remaining >= minPercent) return [...lines, { originId, percent: remaining }];
  return evenSplit([...lines.map((l) => l.originId), originId]);
}

/** Removing a coffee spreads its share over the others. */
export function removeLine(lines: RecipeLine[], originId: string, minPercent = 0): RecipeLine[] {
  const rest = lines.filter((l) => l.originId !== originId);
  return rest.length ? balanceBlend(rest, minPercent) : [];
}

export function issueText(
  issue: BlendIssue,
  t: Dict,
  origins: OriginIndex,
  l: (v: Localized) => string,
  formatDate: (iso: string) => string = (iso) => iso,
): string {
  const name = 'originId' in issue ? (origins[issue.originId] ? l(origins[issue.originId].name) : issue.originId) : '';
  // an origin short of stock always says when it is expected back (concept §6)
  const back = 'restockDate' in issue && issue.restockDate ? ` · ${fmt(t.common.backAround, { date: formatDate(issue.restockDate) })}` : '';
  switch (issue.code) {
    case 'empty':
      return t.blend.issues.empty;
    case 'total':
      return fmt(t.blend.issues.total, { total: issue.total });
    case 'min_percent':
      return fmt(t.blend.issues.min_percent, { origin: name, min: issue.min });
    case 'too_many':
      return fmt(t.blend.issues.too_many, { max: issue.max });
    case 'duplicate':
      return fmt(t.blend.issues.duplicate, { origin: name });
    case 'unavailable':
      return fmt(t.blend.issues.unavailable, { origin: name }) + back;
    case 'stock':
      return fmt(t.blend.issues.stock, { origin: name }) + back;
  }
}

/**
 * The hero title is edited in the Admin Panel (Content); a word between asterisks shows in gold:
 * "L'âme du *café* dans chaque tasse". An asterisk without its pair stays as typed.
 */
export interface TitlePart {
  text: string;
  gold: boolean;
}

export function goldParts(title: string): TitlePart[] {
  const parts: TitlePart[] = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  for (let m = re.exec(title); m; m = re.exec(title)) {
    if (m.index > last) parts.push({ text: title.slice(last, m.index), gold: false });
    parts.push({ text: m[1], gold: true });
    last = m.index + m[0].length;
  }
  if (last < title.length) parts.push({ text: title.slice(last), gold: false });
  return parts;
}

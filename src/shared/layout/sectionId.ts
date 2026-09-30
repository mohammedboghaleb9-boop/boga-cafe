/** The section named after # in a link (/page#section); a badly encoded one (#%E0%A4) gives '', never a crash. */
export function sectionId(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return '';
  }
}

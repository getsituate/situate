export function isWebLink(href: string): boolean {
  if (!/^https?:\/\//iu.test(href)) return false;
  try {
    const url = new URL(href);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function splitWebLinks(text: string): string[] {
  return text.split(
    /\b(https?:\/\/(?:[^\s<>"()]|\([^\s<>"()]*\))*(?:[^\s<>"().,;:!?]|\([^\s<>"()]*\)))(?=[.,;:!?]*(?:[\s<>"()]|$))/iu,
  );
}

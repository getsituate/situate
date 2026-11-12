export function provisionalTitle(message: string): string {
  const text = message.replace(/\s+/gu, " ").trim();
  const words = text.split(" ").slice(0, 7).join(" ");
  return Array.from(words).slice(0, 60).join("");
}

export function generatedTitle(value: string): string | null {
  const title = value
    .trim()
    .replace(/^["“«]|["”»]$/gu, "")
    .trim();
  if (
    !title ||
    Array.from(title).length > 60 ||
    title.split(/\s+/u).length > 9 ||
    /[\r\n\p{Cc}]/u.test(title) ||
    !/[\p{L}\p{N}]/u.test(title)
  )
    return null;
  return title;
}

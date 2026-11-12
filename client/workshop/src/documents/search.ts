import type { DocumentItem } from "./model";

function normalize(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+(?:[-./][\p{L}\p{N}]+)*/gu) ?? [];
}

function singleTypo(query: string, candidate: string): boolean {
  if (
    query.length < 4 ||
    Math.abs(query.length - candidate.length) > 1 ||
    !/^\p{L}+$/u.test(query) ||
    !/^\p{L}+$/u.test(candidate)
  )
    return false;

  let i = 0;
  while (i < query.length && query[i] === candidate[i]) i++;
  if (query.length !== candidate.length) {
    return query.length > candidate.length
      ? query.slice(i + 1) === candidate.slice(i)
      : query.slice(i) === candidate.slice(i + 1);
  }
  return (
    query.slice(i + 1) === candidate.slice(i + 1) ||
    (query[i] === candidate[i + 1] &&
      query[i + 1] === candidate[i] &&
      query.slice(i + 2) === candidate.slice(i + 2))
  );
}

export function documentSearchScore(query: string, doc: DocumentItem): number {
  query = normalize(query);
  if (!query) return 1;
  const text = normalize(`${doc.title} ${doc.filename} ${doc.content}`);
  if (text.includes(query)) return 3;
  const terms = words(query);
  if (!terms.length) return 0;
  const concepts = `${text} ${normalize(doc.concepts.join(" "))}`;
  if (terms.every((term) => concepts.includes(term))) return 2;
  const candidates = words(concepts);
  return terms.every(
    (term) =>
      concepts.includes(term) ||
      candidates.some((candidate) => singleTypo(term, candidate)),
  )
    ? 1
    : 0;
}

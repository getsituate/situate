import { emptyFilter, type DocumentsState, type TagFilter } from "./model";

function changed(s: DocumentsState) {
  s.activeSaved = null;
  s.selected = null;
  s.opening = null;
  s.notice = "";
}
export function addFilterTag(s: DocumentsState, tag: string) {
  if (!s.tags.some((t) => t.id === tag) || s.filter.tags.includes(tag)) return;
  s.filter.tags.push(tag);
  s.untagged = false;
  changed(s);
}
export function removeFilterTag(s: DocumentsState, tag: string) {
  s.filter.tags = s.filter.tags.filter((id) => id !== tag);
  if (!s.filter.tags.length) s.filter = emptyFilter();
  changed(s);
}
export function setFilterOperator(
  s: DocumentsState,
  operator: TagFilter["operator"],
) {
  s.filter.operator = operator;
  changed(s);
}
export function clearUntaggedFilter(s: DocumentsState) {
  s.untagged = false;
  changed(s);
}
export function browseFilterTag(s: DocumentsState, tag: string) {
  s.filter = emptyFilter();
  s.untagged = tag === "untagged";
  if (!s.untagged) addFilterTag(s, tag);
  changed(s);
}

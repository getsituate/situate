import type { DocumentsState, Tag, TagCreation } from "./model";

export function orderedTags(tags: Tag[]): Tag[] {
  const result: Tag[] = [];
  const visited = new Set<string>();
  function append(tag: Tag) {
    if (visited.has(tag.id)) return;
    visited.add(tag.id);
    result.push(tag);
    tags.filter((child) => child.parent === tag.id).forEach(append);
  }
  tags.filter((tag) => !tag.parent).forEach(append);
  tags.forEach(append);
  return result;
}

export function beginTagCreation(s: DocumentsState, forDocument = false) {
  if (
    forDocument &&
    (s.dialog !== "tags" || !s.documents.some((doc) => doc.id === s.selected))
  )
    return;
  s.tagCreation = {
    name: "",
    parent: null,
    documentId: forDocument ? s.selected : null,
    error: null,
  };
  s.notice = "";
}

export function tagCreationError(s: DocumentsState): TagCreation["error"] {
  const draft = s.tagCreation;
  if (!draft) return null;
  const name = draft.name.trim().normalize("NFC").toLowerCase();
  if (!name) return "name";
  if (draft.parent !== null && !s.tags.some((tag) => tag.id === draft.parent))
    return "parent";
  if (
    s.tags.some(
      (tag) =>
        tag.parent === draft.parent &&
        tag.name.trim().normalize("NFC").toLowerCase() === name,
    )
  )
    return "duplicate";
  if (
    draft.documentId &&
    (s.dialog !== "tags" ||
      s.selected !== draft.documentId ||
      !s.documents.some((doc) => doc.id === draft.documentId))
  )
    return "document";
  return null;
}

export function createTag(s: DocumentsState): string | null {
  const draft = s.tagCreation;
  if (!draft) return null;
  draft.error = tagCreationError(s);
  if (draft.error) return null;
  let sequence = 1;
  while (
    s.tags.some((tag) => tag.id === `tag-${sequence}`) ||
    Object.hasOwn(s.deletedTags, `tag-${sequence}`)
  )
    sequence++;
  const id = `tag-${sequence}`;
  s.tags.push({
    id,
    name: draft.name.trim().normalize("NFC"),
    parent: draft.parent,
  });
  s.tags = orderedTags(s.tags);
  if (draft.documentId) s.draftTags = [...s.draftTags, id];
  s.createdTagId = id;
  s.notice = "tag-created";
  s.tagCreation = null;
  return id;
}

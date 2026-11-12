import {
  purgeDeletedTagReferences,
  tagPath,
  type DocumentsState,
} from "./model";
import { orderedTags } from "./tags";

export function tagDeletionImpact(s: DocumentsState) {
  const target = s.tags.find((tag) => tag.id === s.tagDeletion?.id);
  const descendants = new Set<string>();
  function visit(id: string) {
    for (const tag of s.tags.filter((tag) => tag.parent === id)) {
      if (descendants.has(tag.id)) continue;
      descendants.add(tag.id);
      visit(tag.id);
    }
  }
  if (target) visit(target.id);
  const removed = new Set(
    target
      ? [target.id, ...(s.tagDeletion?.descendants ? descendants : [])]
      : [],
  );
  const children = s.tags.filter((tag) => tag.parent === target?.id);
  const collisions =
    target && !s.tagDeletion?.descendants
      ? children.filter((child) =>
          s.tags.some(
            (tag) =>
              tag.id !== target.id &&
              tag.parent === target.parent &&
              tag.name.trim().normalize("NFC").toLowerCase() ===
                child.name.trim().normalize("NFC").toLowerCase(),
          ),
        )
      : [];
  return {
    target,
    descendants,
    removed,
    children,
    collisions,
    documents: s.documents.filter((doc) =>
      doc.tags.some((id) => removed.has(id)),
    ),
  };
}

export function deleteTag(s: DocumentsState): boolean {
  if (!s.tagDeletion) return false;
  const impact = tagDeletionImpact(s);
  if (!impact.target || impact.collisions.length) {
    s.tagDeletion.error = impact.target ? "collision" : "missing";
    return false;
  }
  for (const id of impact.removed) {
    s.deletedTags[id] = tagPath(s.tags, id);
  }
  s.tags = orderedTags(
    s.tags
      .filter((tag) => !impact.removed.has(tag.id))
      .map((tag) => ({
        ...tag,
        parent:
          tag.parent === impact.target!.id ? impact.target!.parent : tag.parent,
      })),
  );
  purgeDeletedTagReferences(s);
  s.notice = "";
  s.tagDeletion = null;
  s.tagMenu = null;
  return true;
}

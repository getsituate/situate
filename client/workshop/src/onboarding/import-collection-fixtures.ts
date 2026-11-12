import type { EditorFile } from "../editor/model";
import copy from "../localization/en.import-result.json" with { type: "json" };
export function importCollectionFixture(
  base: EditorFile[],
  flat: boolean,
): EditorFile[] {
  const c = copy.collectionExample;
  const initial = structuredClone(base).map((file) => {
    if (!flat) return file;
    let content = file.content;
    for (const original of base)
      content = content.replaceAll(`${original.folder}/`, `${c.flatFolder}/`);
    return { ...file, folder: c.flatFolder, content, draft: content };
  });
  return [
    ...initial,
    ...Array.from({ length: 1200 - initial.length }, (_, i): EditorFile => {
      const category = c.folders[Math.floor(i / 200)]!;
      const group = c.group.replace(
        "{number}",
        String(Math.floor((i % 200) / 40) + 1).padStart(2, "0"),
      );
      const folder = flat
        ? c.flatFolder
        : `${category}/${group}/${i >= 1160 ? c.deepFolder : c.subfolder}`;
      const name =
        !flat && i % 40 === 0
          ? c.sharedFilename
          : c.filename.replace(
              "{number}",
              String(i + initial.length + 1).padStart(4, "0"),
            );
      const content = c.content
        .replace("{title}", name.replace(/\.md$/, ""))
        .replace("{folder}", folder);
      return {
        key: `import-collection-${i + initial.length + 1}`,
        name,
        folder,
        content,
        draft: content,
        deleted: false,
        saveError: false,
        versions: [],
      };
    }),
  ];
}

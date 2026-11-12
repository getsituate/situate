export type ViewTarget =
  | { readonly kind: "empty" }
  | { readonly kind: "conversation"; readonly conversationId: string }
  | { readonly kind: "new-conversation"; readonly conversationId: string }
  | {
      readonly kind: "view";
      readonly viewId: string;
      readonly contentId?: string;
      readonly revision?: string;
    };

export type PresentationValue =
  | null
  | boolean
  | number
  | string
  | readonly PresentationValue[]
  | { readonly [key: string]: PresentationValue };

export interface NavigationEntry {
  readonly id: string;
  readonly target: ViewTarget;
  readonly presentation: PresentationValue;
}

export interface PaneNavigation {
  readonly entries: readonly NavigationEntry[];
  readonly cursor: number;
}

export function currentEntry(navigation: PaneNavigation): NavigationEntry {
  return navigation.entries[navigation.cursor]!;
}

export function sameTarget(a: ViewTarget, b: ViewTarget): boolean {
  switch (a.kind) {
    case "empty":
      return b.kind === "empty";
    case "conversation":
    case "new-conversation":
      return b.kind === a.kind && a.conversationId === b.conversationId;
    case "view":
      return (
        b.kind === "view" &&
        a.viewId === b.viewId &&
        a.contentId === b.contentId &&
        a.revision === b.revision
      );
  }
}

export function visit(
  navigation: PaneNavigation,
  entry: NavigationEntry,
): PaneNavigation {
  if (sameTarget(currentEntry(navigation).target, entry.target))
    return navigation;
  const entries = [
    ...navigation.entries.slice(0, navigation.cursor + 1),
    entry,
  ];
  return { entries, cursor: entries.length - 1 };
}

export function traverse(
  navigation: PaneNavigation,
  delta: -1 | 1,
): PaneNavigation {
  const cursor = navigation.cursor + delta;
  if (cursor < 0 || cursor >= navigation.entries.length) return navigation;
  return { ...navigation, cursor };
}

export function retainPresentation(
  navigation: PaneNavigation,
  entryId: string,
  presentation: PresentationValue,
): PaneNavigation {
  // Capture can complete after navigation; bind it to the retained entry, not the cursor.
  if (!navigation.entries.some((entry) => entry.id === entryId))
    return navigation;
  return {
    ...navigation,
    entries: navigation.entries.map((entry) =>
      entry.id === entryId ? { ...entry, presentation } : entry,
    ),
  };
}

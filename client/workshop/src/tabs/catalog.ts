import { views } from "../navigation/fixtures";
import { pinnableViews, viewNames, type PinnedView } from "./model";

export function catalogView(id: PinnedView) {
  return {
    id,
    label: viewNames[id],
    icon: views.find((view) => view.id === id)?.icon ?? ("documents" as const),
  };
}
export const viewCatalog = pinnableViews.map(catalogView);

import c from "../localization/en.components.json" with { type: "json" };

export type ExampleStatus = keyof typeof c.states;
export interface ComponentLibraryState {
  status: ExampleStatus;
  longLabels: boolean;
  compact: boolean;
  name: string;
  notes: string;
  search: string;
  includeArchived: boolean;
  order: string;
  collection: string;
  dialogOpen: boolean;
  dialogSaved: boolean;
  height: number;
  actions: number;
  reminders: boolean;
  chipVisible: boolean;
  disclosureOpen: boolean;
  menuOpen: boolean;
  popoverOpen: boolean;
  pinned: boolean;
}
export const componentScenarios = (
  Object.keys(c.states) as ExampleStatus[]
).map((status) => ({
  id: `components-${status}` as `components-${ExampleStatus}`,
  label: c.states[status],
  group: "Interface" as const,
}));
export function createComponentLibraryState(
  scenario = "components-ready",
): ComponentLibraryState {
  const status = scenario.replace("components-", "") as ExampleStatus;
  return {
    status: Object.hasOwn(c.states, status) ? status : "ready",
    longLabels: false,
    compact: false,
    name: status === "empty" || status === "error" ? "" : c.sampleTitle,
    notes: status === "empty" ? "" : c.sampleNote,
    search: "",
    includeArchived: false,
    order: "newest",
    collection: "garden",
    dialogOpen: false,
    dialogSaved: false,
    height: 160,
    actions: 0,
    reminders: true,
    chipVisible: true,
    disclosureOpen: false,
    menuOpen: false,
    popoverOpen: false,
    pinned: false,
  };
}

export const componentGroups = {
  actions: [
    "SituateButton",
    "SituateIconButton",
    "SituateIcon",
    "SituateMenu",
    "SituatePopover",
  ],
  fields: [
    "SituateField",
    "SituateInput",
    "SituateTextarea",
    "SituateCheckbox",
    "SituateRadio",
    "SituateSelect",
    "SituateSwitch",
    "SituateFilterChip",
  ],
  feedback: [
    "SituateBadge",
    "SituateNotice",
    "SituateEmptyState",
    "SituateTooltip",
    "SituateProgress",
  ],
  layout: [
    "SituatePanel",
    "SituateDisclosure",
    "SituateDialog",
    "SituateDialogActions",
    "SituateScrollbars",
    "SituateResizeHandle",
  ],
} as const;
export const catalogComponents = Object.values(componentGroups).flat();

export const resizeContent = {
  help: "Drag or use the arrow keys to resize. Home and End set the limits. Enter or a double-click resets the size. Escape cancels a drag.",
  pixels: (value: number) => `${value} pixels`,
} as const;

export const selectContent = {
  title: "Choose an option",
  close: "Close choices",
  empty: "No options available",
  required: "Choose an option to continue.",
} as const;

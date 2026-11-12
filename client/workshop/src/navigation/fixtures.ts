export const tasks = [
  "Review the workshop outline",
  "Confirm the venue booking",
  "Read the project brief",
];
export const events = [
  { time: "09:30", title: "Project check-in", detail: "30 min · Video call" },
  { time: "14:00", title: "Workshop preparation", detail: "60 min · Studio" },
];
export const views = [
  { id: "day", label: "My day", icon: "sun" },
  { id: "calendar", label: "Calendar", icon: "calendar" },
  { id: "tasks", label: "Tasks", icon: "tasks" },
  { id: "notes", label: "Notes", icon: "notes" },
  { id: "reading", label: "Reading list", icon: "book" },
  { id: "documents", label: "Documents", icon: "documents" },
  { id: "review", label: "Weekly review", icon: "tasks" },
] as const;
export const conversations = [
  {
    id: "workshop",
    title: "Prepare the workshop",
    status: "working",
    archived: false,
  },
  {
    id: "venue",
    title: "Reply to the venue",
    status: "approval",
    archived: false,
  },
  { id: "week", title: "Plan next week", status: "Yesterday", archived: false },
  {
    id: "reading",
    title: "Organize reading notes",
    status: "Monday",
    archived: true,
  },
  {
    id: "trains",
    title: "Compare train routes",
    status: "Last week",
    archived: true,
  },
];
export const draft = "Help me prepare for the workshop.";

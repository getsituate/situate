export const icons = {
  back: "m14 6-6 6 6 6",
  forward: "m10 6 6 6-6 6",
  more: "M5 11v2m7-2v2m7-2v2",
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  restore: "M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5",
  grip: "M9 5v1m6-1v1M9 11v1m6-1v1M9 17v1m6-1v1",
  menu: "M4 6h16M4 12h16M4 18h16",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v6m0-10v.5",
  folder:
    "M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  workspace:
    "M6 4h7a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM8 20h10a3 3 0 0 0 3-3V8",
  collapse:
    "M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM9 4v16m7-11-3 3 3 3",
  chevron: "m6 9 6 6 6-6",
  calendar:
    "M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3ZM7 3v4m10-4v4M3 10h18m-13 5h2m4 0h2",
  tasks:
    "M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Zm-1 9 3 3 7-7",
  notes:
    "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 0v6h6M8 13h8m-8 4h5",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 4 4L19 6",
  history: "M3 4v6h6M3 10a9 9 0 1 1 2 8m7-12v6l4 2",
  chat: "M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2ZM8 9h8m-8 4h5",
  split:
    "M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm6 0v16",
  close: "m6 6 12 12M18 6 6 18",
  mic: "M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3ZM5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8",
  attach:
    "m8 12 7-7a4 4 0 0 1 6 6L11 21a6 6 0 0 1-8-8L13 3m-7 12 9-9a1.5 1.5 0 0 1 2 2l-9 9",
  arrow: "M12 19V5m-6 6 6-6 6 6",
  update: "M20 10a8 8 0 0 0-13-4L4 9m0-5v5h5M4 14a8 8 0 0 0 13 4l3-3m-5 0h5v5",
  enter: "M20 5v9H4m5-5-5 5 5 5",
  plugins: "M5 14V8h14v6a7 7 0 0 1-14 0ZM8 3v5m8-5v5m-4 13v2",
  settings:
    "M4 7h2m6 0h8M4 17h8m6 0h2M12 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
} as const;

export type IconName = keyof typeof icons;

export const greetingKeys = [
  "navigation.goodToSeeYou",
  "chat.greetingOnYourMind",
  "chat.greetingBegin",
  "chat.greetingRoom",
  "chat.greetingThread",
  "chat.greetingSpace",
] as const;

export function chooseGreeting(saved: unknown): (typeof greetingKeys)[number] {
  return (
    greetingKeys.find((key) => key === saved) ??
    greetingKeys[Math.floor(Math.random() * greetingKeys.length)]!
  );
}

export const greetings = [
  "Good to see you.",
  "What’s on your mind?",
  "Where shall we begin?",
  "A little room to think.",
  "Let’s pick up a thread.",
  "Make yourself some space.",
] as const;

const next = { navigation: 0, conversation: 0 };
export function nextGreeting(scope: keyof typeof next = "navigation"): string {
  const greeting = greetings[next[scope] % greetings.length];
  next[scope]++;
  return greeting;
}

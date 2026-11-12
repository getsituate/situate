export const commitTypes = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "docs",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

const subjectPattern = new RegExp(
  `^(?:${commitTypes.join("|")})(?:\\([^()\\r\\n]+\\))?!?: \\S(?:[^\\r\\n]*\\S)?$`,
);

export function validateCommitMessage(message, { merge = false } = {}) {
  const normalized = message.replaceAll("\r\n", "\n").trimEnd();
  const [subject, secondLine] = normalized.split("\n");
  if (
    merge &&
    /^Merge (?:branch |branches |remote-tracking branch |remote-tracking branches |tag |commit |pull request #).+/.test(
      subject,
    )
  )
    return null;
  if (
    /^Revert ".+"$/.test(subject) &&
    /\n\nThis reverts commit [a-f0-9]{40}(?:[a-f0-9]{24})?(?:\.|, reversing\nchanges made to [a-f0-9]{40}(?:[a-f0-9]{24})?\.)\n?$/.test(
      normalized,
    )
  )
    return null;
  if (!subjectPattern.test(subject))
    return "Use type(scope): summary or type: summary; see docs/development/commit-conventions.md.";
  if (secondLine !== undefined && secondLine !== "")
    return "Separate the subject and body with a blank line.";
  if (/^BREAKING(?: CHANGE|-CHANGE):\s*$/m.test(normalized))
    return "Describe the incompatible change after BREAKING CHANGE:.";
  return null;
}

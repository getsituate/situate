const day = 24 * 60 * 60 * 1000;

export function retentionDecision(record, { now = Date.now() } = {}) {
  if (record.published === true || record.githubReleaseComplete === true)
    return { remove: false, reason: "published" };
  if (record.resolved !== true) return { remove: false, reason: "unresolved" };
  if (["identity", "reservation", "release", "recovery"].includes(record.kind))
    return { remove: false, reason: "durable-evidence" };
  const days = ["log", "screenshot"].includes(record.kind)
    ? 7
    : record.kind === "candidate" &&
        record.published === false &&
        record.githubReleaseComplete === false
      ? 30
      : undefined;
  const timestamp = Date.parse(record.resolvedAt);
  if (days === undefined || !Number.isFinite(timestamp) || timestamp > now)
    return { remove: false, reason: "unknown" };
  return {
    remove: now - timestamp >= days * day,
    reason: "retention-period",
    days,
  };
}

export function assertRecoveryReady(evidence, { host, now = Date.now() }) {
  if (
    evidence?.schemaVersion !== 1 ||
    evidence.host !== host ||
    evidence.backup?.encrypted !== true ||
    evidence.backup?.independent !== true ||
    typeof evidence.backup?.destinationId !== "string" ||
    !evidence.backup.destinationId.trim() ||
    ![
      evidence.backup.restoreVerifiedAt,
      evidence.signingRecoveryVerifiedAt,
      evidence.accessRecoveryVerifiedAt,
    ].every(
      (value) =>
        typeof value === "string" &&
        Number.isFinite(Date.parse(value)) &&
        Date.parse(value) <= now,
    )
  )
    throw new Error(
      "Publication requires independent encrypted backup and verified restore, signing and access recovery evidence for this destination.",
    );
  return evidence;
}

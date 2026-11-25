const requestErrors = new Set([
  "native.gmail.refreshFailed",
  "native.gmail.refreshReconnect",
  "native.gmail.apiFailed",
  "native.gmail.apiReconnect",
  "native.gmail.apiOutcomeUnknown",
]);

export function gmailRequestError(value: string): boolean {
  if (!value.startsWith("{") || value.length > 256) return false;
  try {
    const error = JSON.parse(value);
    const { status, reason } = error?.params ?? {};
    return (
      requestErrors.has(error?.key) &&
      (status === "–" ||
        (Number.isInteger(status) && status >= 100 && status <= 599)) &&
      (reason === "–" ||
        (typeof reason === "string" && /^[A-Za-z_]{1,40}$/.test(reason))) &&
      Object.keys(error.params).length === 2
    );
  } catch {
    return false;
  }
}

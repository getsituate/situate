export async function loadLicenses(signal?: AbortSignal): Promise<string> {
  const response = await fetch(
    `${import.meta.env.BASE_URL}situate-licenses.txt`,
    { signal },
  );
  if (!response.ok) throw new Error("License asset unavailable.");
  const text = await response.text();
  const heading = "Situate licenses and notices\n";
  if (
    !text.startsWith(heading) ||
    !text.slice(heading.length).trim() ||
    text.includes("\0")
  )
    throw new Error("Invalid license asset.");
  return text;
}

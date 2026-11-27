export const previewFormats: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
};
const pdfMime = "application/pdf";
export const maxImagePixels = 16_000_000;

export function checkPreviewSignature(bytes: Uint8Array, mimeType: string) {
  const signature =
    mimeType === pdfMime
      ? [37, 80, 68, 70, 45]
      : mimeType === "image/png"
        ? [137, 80, 78, 71, 13, 10, 26, 10]
        : mimeType === "image/jpeg"
          ? [255, 216, 255]
          : [];
  if (
    !signature.length ||
    !signature.every((part, index) => bytes[index] === part)
  )
    throw new Error();
}

export async function loadPdf(
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
) {
  const [{ getDocument, GlobalWorkerOptions }, { default: worker }] =
    await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
  signal.throwIfAborted();
  GlobalWorkerOptions.workerSrc = worker;
  return getDocument({
    data: bytes,
    useWasm: false,
    useWorkerFetch: false,
    maxImageSize: maxImagePixels,
  });
}

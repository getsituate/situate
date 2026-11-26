import {
  checkPreviewSignature,
  loadPdf,
  maxImagePixels,
} from "./document-preview";

function imageDimensions(
  bytes: Uint8Array,
  mimeType: string,
): [number, number] {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mimeType === "image/png") return [data.getUint32(16), data.getUint32(20)];
  for (let pos = 2; pos < bytes.length;) {
    if (bytes[pos++] !== 0xff) break;
    while (bytes[pos] === 0xff) ++pos;
    const marker = bytes[pos++]!;
    if (marker === 0xda || marker === 0xd9) break;
    const size = data.getUint16(pos);
    if (size < 2) break;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      if (size < 8) break;
      return [data.getUint16(pos + 5), data.getUint16(pos + 3)];
    }
    pos += size;
  }
  throw new Error();
}

const longEdge = 480;

function surface(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error();
  const scale = Math.min(1, longEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error();
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context, scale };
}

async function renderFirstPage(
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
) {
  const task = await loadPdf(bytes, signal);
  let cancelRender: (() => void) | undefined;
  let destroyed: Promise<void> | undefined;
  const dispose = () => {
    cancelRender?.();
    return (destroyed ??= task.destroy().catch(() => undefined));
  };
  const abort = () => void dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    signal.throwIfAborted();
    const { width, height } = page.getViewport({ scale: 1 });
    const { canvas, scale } = surface(width, height);
    const render = page.render({
      canvas,
      viewport: page.getViewport({ scale }),
      annotationMode: 0,
    });
    cancelRender = () => render.cancel();
    await render.promise;
    cancelRender = undefined;
    return canvas;
  } finally {
    signal.removeEventListener("abort", abort);
    await dispose();
  }
}

async function renderImage(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  signal: AbortSignal,
) {
  const [width, height] = imageDimensions(bytes, mimeType);
  if (!width || !height || width * height > maxImagePixels) throw new Error();
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const image = new Image();
  const cancel = () => image.removeAttribute("src");
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    image.src = url;
    await image.decode();
    signal.throwIfAborted();
    const { canvas, context } = surface(
      image.naturalWidth,
      image.naturalHeight,
    );
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    signal.removeEventListener("abort", cancel);
    URL.revokeObjectURL(url);
  }
}

export async function renderThumbnail(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  signal: AbortSignal,
) {
  checkPreviewSignature(bytes, mimeType);
  const canvas =
    mimeType === "application/pdf"
      ? await renderFirstPage(bytes, signal)
      : await renderImage(bytes, mimeType, signal);
  signal.throwIfAborted();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.82);
  });
  if (blob?.type === "image/jpeg") return blob;
}

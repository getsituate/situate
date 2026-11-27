import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderThumbnail } from "./thumbnail-render";

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
}));

const PDF = Uint8Array.of(37, 80, 68, 70, 45);
const JPEG = Uint8Array.of(
  255,
  216,
  255,
  224,
  0,
  4,
  0,
  0,
  255,
  255,
  194,
  0,
  8,
  8,
  0,
  200,
  0,
  100,
  1,
);
function png(width = 960, height = 480) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
const imageBlob = () => new Blob(["preview"], { type: "image/jpeg" });
const signal = () => new AbortController().signal;
const release = vi.fn();
const fillRect = vi.fn();
const drawImage = vi.fn();
const decode = vi.fn<() => Promise<void>>();
const removeAttribute = vi.fn();
let width = 0;
let height = 0;

beforeEach(() => {
  width = 960;
  height = 480;
  decode.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      naturalWidth = width;
      naturalHeight = height;
      decode = decode;
      removeAttribute = removeAttribute;
    },
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:original";
      static revokeObjectURL = release;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect,
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => {
    done(imageBlob());
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(getDocument).mockReset();
});

function pdfPage(dimensions: [number, number], renders = Promise.resolve()) {
  const cancel = vi.fn();
  const destroy = vi.fn().mockResolvedValue(undefined);
  const render = vi.fn(() => ({ promise: renders, cancel }));
  const getPage = vi.fn().mockResolvedValue({
    getViewport: ({ scale }: { scale: number }) => ({
      width: dimensions[0] * scale,
      height: dimensions[1] * scale,
    }),
    render,
  });
  vi.mocked(getDocument).mockReturnValue({
    promise: Promise.resolve({ getPage }),
    destroy,
  } as unknown as ReturnType<typeof getDocument>);
  return { cancel, destroy, render, getPage };
}

describe("rendering document thumbnails", () => {
  it("renders only PDF page one at thumbnail size without annotations", async () => {
    const pdf = pdfPage([1200, 600]);
    await expect(
      renderThumbnail(PDF, "application/pdf", signal()),
    ).resolves.toMatchObject({ type: "image/jpeg" });
    expect(pdf.getPage).toHaveBeenCalledExactlyOnceWith(1);
    expect(pdf.render).toHaveBeenCalledExactlyOnceWith({
      canvas: expect.objectContaining({ width: 480, height: 240 }),
      viewport: { width: 480, height: 240 },
      annotationMode: 0,
    });
    expect(GlobalWorkerOptions.workerSrc).not.toBe("");
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ maxImageSize: 16_000_000 }),
    );
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
  });

  it("cancels an in-progress PDF render and destroys the worker", async () => {
    let finish!: () => void;
    const pdf = pdfPage(
      [400, 200],
      new Promise<void>((done) => {
        finish = done;
      }),
    );
    const request = new AbortController();
    const preview = renderThumbnail(PDF, "application/pdf", request.signal);
    await vi.waitFor(() => expect(pdf.render).toHaveBeenCalled());
    request.abort();
    finish();
    await expect(preview).rejects.toHaveProperty("name", "AbortError");
    expect(pdf.cancel).toHaveBeenCalledTimes(1);
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  });

  it("does not start a PDF worker for an already cancelled request", async () => {
    const request = new AbortController();
    request.abort();
    await expect(
      renderThumbnail(PDF, "application/pdf", request.signal),
    ).rejects.toHaveProperty("name", "AbortError");
    expect(getDocument).not.toHaveBeenCalled();
  });

  it.each([
    ["image/png", png(), 960, 480, 480, 240],
    ["image/jpeg", JPEG, 100, 200, 100, 200],
  ] as const)(
    "decodes %s and preserves the aspect ratio without enlarging small images",
    async (
      mimeType,
      bytes,
      originalWidth,
      originalHeight,
      outputWidth,
      outputHeight,
    ) => {
      width = originalWidth;
      height = originalHeight;
      await expect(
        renderThumbnail(bytes, mimeType, signal()),
      ).resolves.toMatchObject({ type: "image/jpeg" });
      expect(drawImage).toHaveBeenCalledWith(
        expect.anything(),
        0,
        0,
        outputWidth,
        outputHeight,
      );
      expect(release).toHaveBeenCalledExactlyOnceWith("blob:original");
    },
  );

  it.each([
    ["unsupported format", png(), "image/gif"],
    ["wrong signature", JPEG, "image/png"],
    ["oversized dimensions", png(5000, 5000), "image/png"],
    ["zero width", png(0, 100), "image/png"],
    ["zero height", png(100, 0), "image/png"],
    ["JPEG without frame", Uint8Array.of(255, 216, 255, 218), "image/jpeg"],
  ] as const)("rejects %s before decoding", async (_, bytes, mimeType) => {
    await expect(renderThumbnail(bytes, mimeType, signal())).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("releases the original URL and never encodes an image after cancellation", async () => {
    let finish!: () => void;
    decode.mockReturnValueOnce(
      new Promise<void>((done) => {
        finish = done;
      }),
    );
    const request = new AbortController();
    const preview = renderThumbnail(png(), "image/png", request.signal);
    request.abort();
    finish();
    await expect(preview).rejects.toHaveProperty("name", "AbortError");
    expect(removeAttribute).toHaveBeenCalledWith("src");
    expect(release).toHaveBeenCalledExactlyOnceWith("blob:original");
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("rejects an invalid PDF viewport before allocating a canvas", async () => {
    const pdf = pdfPage([Infinity, 480]);
    await expect(
      renderThumbnail(PDF, "application/pdf", signal()),
    ).rejects.toThrow();
    expect(pdf.render).not.toHaveBeenCalled();
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not return an image when the JPEG encoder is unavailable", async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(
      (done) => {
        done(null);
      },
    );
    await expect(
      renderThumbnail(png(), "image/png", signal()),
    ).resolves.toBeUndefined();
  });
});

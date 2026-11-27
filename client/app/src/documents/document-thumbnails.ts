import { invoke } from "@tauri-apps/api/core";
import { shallowReactive } from "vue";
import {
  LIBRARY_EXPORTS,
  validateLibraryResult,
  type DocumentReference,
  type LibraryDescriptor,
  type LibraryDocument,
} from "../ai/document-sources/contract.js";
import type { PluginRuntime } from "../plugins/runtime";
import { renderThumbnail } from "./thumbnail-render";

export interface ThumbnailSource {
  pluginId: string;
  incarnation: string;
  instanceId: string;
  scopeId: string;
}

export interface ThumbnailTarget {
  key: string;
  item: LibraryDocument;
  descriptor: LibraryDescriptor;
  source?: ThumbnailSource;
  ready?: Promise<unknown>;
}

export interface ThumbnailInvalidation {
  scope: string;
  pluginId: string;
  document: { source: ThumbnailSource; id: string } | null;
}

interface Lookup {
  epoch: string;
  jpeg: string | null;
}

interface OpenedOriginal {
  bytes: Uint8Array<ArrayBuffer>;
  lookup: Promise<Lookup | undefined>;
}

export async function readLibraryOriginal(
  runtime: PluginRuntime,
  descriptor: LibraryDescriptor,
  ref: DocumentReference,
  signal: AbortSignal,
  thumbnail = false,
) {
  const args = { ref };
  const value = await runtime.invokeDocumentSource(
    ref.source.pluginId,
    LIBRARY_EXPORTS.readOriginal,
    args,
    signal,
    thumbnail,
  );
  signal.throwIfAborted();
  return validateLibraryResult(descriptor, "readOriginal", args, value);
}

export function reconcileThumbnails(scope: string, source: ThumbnailSource) {
  return invoke("document_thumbnail", {
    scope,
    request: { operation: "reconcile", source },
  }).catch(() => undefined);
}

export function forgetThumbnail(
  scope: string,
  source: ThumbnailSource,
  id: string,
) {
  return invoke("document_thumbnail", {
    scope,
    request: { operation: "forget", source, id },
  }).catch(() => undefined);
}

async function lookupThumbnail(scope: string, target: ThumbnailTarget) {
  const {
    source,
    item: { ref },
  } = target;
  if (!source || !ref.revision) return;
  await target.ready;
  return invoke<Lookup>("document_thumbnail", {
    scope,
    request: {
      operation: "lookup",
      source,
      id: ref.id,
      revision: `${ref.identity}:${ref.revision}`,
    },
  }).catch(() => undefined);
}

async function storeThumbnail(
  scope: string,
  target: ThumbnailTarget,
  epoch: string,
  blob: Blob,
  signal: AbortSignal,
) {
  const {
    source,
    item: { ref },
  } = target;
  if (!source || !ref.revision || blob.size > 256 * 1024) return;
  const jpeg = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(blob);
  });
  signal.throwIfAborted();
  await invoke("document_thumbnail", {
    scope,
    request: {
      operation: "store",
      source,
      id: ref.id,
      revision: `${ref.identity}:${ref.revision}`,
      epoch,
      jpeg,
    },
  }).catch(() => undefined);
}

export function invalidatesThumbnail(error: string) {
  return error === "not-found" || error === "permission";
}

export function documentThumbnails(runtime: () => PluginRuntime | undefined) {
  const images = shallowReactive(new Map<string, Blob>());
  const presented = new Map<Element, string>();
  const visible = new Map<Element, string>();
  const running = new Map<
    string,
    { request: AbortController; opened: boolean }
  >();
  const attempted = new Set<string>();
  let targets = new Map<string, ThumbnailTarget>();
  let opened: { key: string; original: OpenedOriginal } | undefined;
  let paused = false;
  let closed = false;

  const observer =
    typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const key = presented.get(entry.target);
            if (key && entry.isIntersecting) visible.set(entry.target, key);
            else visible.delete(entry.target);
          }
          cancelHidden();
          pump();
        });

  function cancel(key: string) {
    const job = running.get(key)?.request;
    if (job && !job.signal.aborted) {
      attempted.delete(key);
      job.abort();
    }
  }

  function cancelHidden() {
    const keys = new Set(visible.values());
    for (const [key, job] of running)
      if (!job.opened && !keys.has(key)) cancel(key);
  }

  function pump() {
    if (closed || paused) return;
    const view = runtime();
    if (!view) return;
    const keys = new Set(
      opened ? [opened.key, ...visible.values()] : visible.values(),
    );
    for (const key of keys) {
      if (running.size >= 2) return;
      const target = targets.get(key);
      if (!target || running.has(key) || images.has(key)) continue;
      const original = opened?.key === key ? opened.original : undefined;
      if (attempted.has(key) && !original) continue;
      if (original) opened = undefined;
      const request = new AbortController();
      const { signal } = request;
      running.set(key, { request, opened: !!original });
      attempted.add(key);
      const timeout = setTimeout(() => request.abort(), 15_000);
      void (async () => {
        const lookup = await (original?.lookup ??
          lookupThumbnail(view.scope, target));
        signal.throwIfAborted();
        if (lookup?.jpeg) {
          return new Blob(
            [
              Uint8Array.from(atob(lookup.jpeg), (value) =>
                value.charCodeAt(0),
              ),
            ],
            { type: "image/jpeg" },
          );
        }
        let bytes = original?.bytes;
        if (!bytes) {
          const result = await readLibraryOriginal(
            view,
            target.descriptor,
            target.item.ref,
            signal,
            true,
          );
          if (result.status === "error") {
            const { source, item } = target;
            if (invalidatesThumbnail(result.error.code)) {
              forget(item.ref.source.pluginId, item.ref.id);
              if (source)
                await forgetThumbnail(view.scope, source, item.ref.id);
            }
            return;
          }
          if (result.document.mimeType !== target.item.mimeType) return;
          bytes = await view.readDocumentBytes(result.original, signal);
        }
        const blob = await renderThumbnail(bytes, target.item.mimeType, signal);
        signal.throwIfAborted();
        if (blob && lookup)
          await storeThumbnail(view.scope, target, lookup.epoch, blob, signal);
        return blob;
      })()
        .then((image) => {
          if (!image || signal.aborted) return;
          images.set(key, image);
          if (images.size > 96) {
            const keys = new Set(visible.values());
            const unused = [...images.keys()].find((key) => !keys.has(key));
            if (unused) {
              images.delete(unused);
              attempted.delete(unused);
            } else {
              images.delete(key);
            }
          }
        })
        .catch(() => {
          // A background preview failure leaves the file icon in place.
        })
        .finally(() => {
          clearTimeout(timeout);
          if (!signal.aborted) request.abort();
          running.delete(key);
          pump();
        });
    }
  }

  function forget(plugin: string, id?: string, source?: ThumbnailSource) {
    for (const [key, target] of targets) {
      const { item } = target;
      if (
        item.ref.source.pluginId !== plugin ||
        (id !== undefined && id !== item.ref.id) ||
        (source &&
          (target.source?.instanceId !== source.instanceId ||
            target.source.scopeId !== source.scopeId ||
            target.source.incarnation !== source.incarnation))
      )
        continue;
      cancel(key);
      attempted.add(key);
      images.delete(key);
      if (opened?.key === key) opened = undefined;
    }
  }

  return {
    images,
    replace(next: ThumbnailTarget[]) {
      targets = new Map(next.map((item) => [item.key, item]));
      for (const key of attempted) if (!targets.has(key)) attempted.delete(key);
      for (const key of images.keys())
        if (!targets.has(key)) images.delete(key);
      for (const key of running.keys()) if (!targets.has(key)) cancel(key);
      if (opened && !targets.has(opened.key)) opened = undefined;
      pump();
    },
    observe(element: Element, key: string) {
      presented.set(element, key);
      observer?.observe(element);
      return () => {
        observer?.unobserve(element);
        presented.delete(element);
        visible.delete(element);
        cancelHidden();
      };
    },
    pause(value: boolean) {
      paused = value;
      if (paused) {
        opened = undefined;
        for (const key of running.keys()) cancel(key);
      } else pump();
    },
    prepare(key: string) {
      const target = targets.get(key);
      const view = runtime();
      if (!target || !view || images.has(key)) return;
      const lookup = lookupThumbnail(view.scope, target);
      return (bytes: Uint8Array<ArrayBuffer>) => {
        if (target !== targets.get(key) || images.has(key)) return;
        // PDF.js transfers the buffer to its worker; the reader needs its own copy.
        opened = {
          key,
          original: {
            bytes:
              target.item.mimeType === "application/pdf"
                ? bytes.slice()
                : bytes,
            lookup,
          },
        };
        pump();
      };
    },
    forget,
    close() {
      closed = true;
      observer?.disconnect();
      for (const key of running.keys()) cancel(key);
    },
  };
}

import { decodeImage } from '../pipeline/decode';
import { encodeWebp, encodeWebpAtQuality } from '../pipeline/encode';
import { computeGeometry } from '../pipeline/geometry';
import { compositeOnCanvas, resizeAndCompose } from '../pipeline/resize';
import { PipelineError, type RawImageData } from '../pipeline/types';
import type { WorkerRequest, WorkerResponse, WorkerStage, WorkerSuccessResult } from './protocol';

export const THUMBNAIL_MAX_PX = 320;
const THUMBNAIL_QUALITY = 72;

export type ProgressCallback = (stage: WorkerStage, progress: number) => void;

/**
 * Fast area-averaging downscale for UI grid thumbnails so large outputs (e.g. 2000x2000)
 * do not keep multi-megabyte decoded bitmaps pinned in the page's image cache.
 */
export function downscaleForThumbnail(
  image: RawImageData,
  maxEdge = THUMBNAIL_MAX_PX
): RawImageData | null {
  if (image.width <= maxEdge && image.height <= maxEdge) {
    return null;
  }

  const scale = Math.min(maxEdge / image.width, maxEdge / image.height);
  const dstW = Math.max(1, Math.round(image.width * scale));
  const dstH = Math.max(1, Math.round(image.height * scale));
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const src = image.data;
  const srcW = image.width;
  const srcH = image.height;
  const ratioX = srcW / dstW;
  const ratioY = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const sy0 = Math.floor(y * ratioY);
    const sy1 = Math.min(srcH, Math.max(sy0 + 1, Math.ceil((y + 1) * ratioY)));
    for (let x = 0; x < dstW; x++) {
      const sx0 = Math.floor(x * ratioX);
      const sx1 = Math.min(srcW, Math.max(sx0 + 1, Math.ceil((x + 1) * ratioX)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let sy = sy0; sy < sy1; sy++) {
        const row = sy * srcW;
        for (let sx = sx0; sx < sx1; sx++) {
          const p = (row + sx) * 4;
          const pa = src[p + 3];
          r += src[p] * pa;
          g += src[p + 1] * pa;
          b += src[p + 2] * pa;
          a += pa;
          count++;
        }
      }

      const d = (y * dstW + x) * 4;
      if (a > 0) {
        out[d] = Math.round(r / a);
        out[d + 1] = Math.round(g / a);
        out[d + 2] = Math.round(b / a);
        out[d + 3] = Math.round(a / count);
      }
    }
  }

  return { width: dstW, height: dstH, data: out };
}

function toOwnedBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  return bytes.slice().buffer;
}

export async function runPipelineJob(
  request: WorkerRequest,
  onProgress?: ProgressCallback
): Promise<WorkerSuccessResult> {
  const { id, input, settings } = request;
  const notices: string[] = [];

  let composed: RawImageData;
  let originalWidth: number;
  let originalHeight: number;
  let originalBytes: number;
  let format = input.kind === 'raster' ? input.format : 'jpeg';

  if (input.kind === 'raster') {
    onProgress?.('resizing', 0.45);
    originalWidth = input.originalWidth;
    originalHeight = input.originalHeight;
    originalBytes = input.originalBytes;
    notices.push(...input.notices);

    const raster: RawImageData = {
      width: input.width,
      height: input.height,
      data: new Uint8ClampedArray(input.pixels)
    };

    const plan = computeGeometry({
      srcWidth: raster.width,
      srcHeight: raster.height,
      sizeMode: settings.sizeMode,
      targetWidth: settings.targetWidth,
      targetHeight: settings.targetHeight,
      fit: settings.fit,
      noEnlarge: settings.noEnlarge,
      isVector: format === 'svg'
    });

    composed = compositeOnCanvas(raster, plan, settings.background);
  } else {
    onProgress?.('decoding', 0.15);
    const bytes = new Uint8Array(input.buffer);
    originalBytes = bytes.byteLength;

    const decoded = await decodeImage(bytes);
    format = decoded.format;
    originalWidth = decoded.originalWidth;
    originalHeight = decoded.originalHeight;
    notices.push(...decoded.notices);

    onProgress?.('resizing', 0.5);
    const resized = await resizeAndCompose(decoded.image, {
      sizeMode: settings.sizeMode,
      targetWidth: settings.targetWidth,
      targetHeight: settings.targetHeight,
      fit: settings.fit,
      noEnlarge: settings.noEnlarge,
      background: settings.background
    });
    composed = resized.image;
  }

  onProgress?.('encoding', 0.8);
  const encoded = await encodeWebp(composed, {
    preset: settings.qualityPreset,
    targetBytes: settings.targetKb * 1024
  });

  if (encoded.notice) {
    notices.push(encoded.notice);
  }

  let thumbnailBuffer: ArrayBuffer | undefined;
  const thumbImage = downscaleForThumbnail(composed);
  if (thumbImage) {
    try {
      const thumbBytes = await encodeWebpAtQuality(thumbImage, THUMBNAIL_QUALITY);
      thumbnailBuffer = toOwnedBuffer(thumbBytes);
    } catch {
      // Fall back cleanly to the main output blob if thumbnail encoding fails.
      thumbnailBuffer = undefined;
    }
  }

  const outBytes = encoded.bytes;
  const outputBuffer = toOwnedBuffer(outBytes);

  return {
    type: 'done',
    id,
    outputBuffer,
    thumbnailBuffer,
    width: composed.width,
    height: composed.height,
    originalWidth,
    originalHeight,
    originalBytes,
    outputBytes: outBytes.byteLength,
    quality: encoded.quality,
    lossless: encoded.lossless,
    format,
    notices
  };
}

// Attach message handler only when executing inside a Dedicated Web Worker.
const isDedicatedWorker =
  typeof self !== 'undefined' &&
  typeof (self as unknown as { document?: unknown }).document === 'undefined' &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function' &&
  typeof (globalThis as unknown as { process?: { versions?: { node?: string } } }).process?.versions
    ?.node === 'undefined';

interface WorkerGlobalScopeLike {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}

if (isDedicatedWorker) {
  const workerScope = self as unknown as WorkerGlobalScopeLike;

  workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const req = event.data;
    try {
      const result = await runPipelineJob(req, (stage, progress) => {
        const msg: WorkerResponse = { type: 'progress', id: req.id, stage, progress };
        workerScope.postMessage(msg);
      });
      const transfer: Transferable[] = [result.outputBuffer];
      if (result.thumbnailBuffer) {
        transfer.push(result.thumbnailBuffer);
      }
      workerScope.postMessage(result, transfer);
    } catch (err) {
      const code = err instanceof PipelineError ? err.code : 'DECODE_FAILED';
      const message =
        err instanceof Error && err.message ? err.message : 'Could not process this image.';
      const errMsg: WorkerResponse = { type: 'error', id: req.id, code, message };
      workerScope.postMessage(errMsg);
    }
  };
}

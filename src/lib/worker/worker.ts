import { decodeImage } from '../pipeline/decode';
import { encodeWebp } from '../pipeline/encode';
import { computeGeometry } from '../pipeline/geometry';
import { compositeOnCanvas, resizeAndCompose } from '../pipeline/resize';
import { PipelineError, type RawImageData } from '../pipeline/types';
import type { WorkerRequest, WorkerResponse, WorkerStage, WorkerSuccessResult } from './protocol';

export type ProgressCallback = (stage: WorkerStage, progress: number) => void;

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

  // Ensure an owned tightly-sized ArrayBuffer for zero-copy transfer.
  const outBytes = encoded.bytes;
  const outputBuffer =
    outBytes.buffer instanceof ArrayBuffer &&
    outBytes.byteOffset === 0 &&
    outBytes.byteLength === outBytes.buffer.byteLength
      ? outBytes.buffer
      : outBytes.slice().buffer;

  return {
    type: 'done',
    id,
    outputBuffer,
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
      workerScope.postMessage(result, [result.outputBuffer]);
    } catch (err) {
      const code = err instanceof PipelineError ? err.code : 'DECODE_FAILED';
      const message =
        err instanceof Error && err.message ? err.message : 'Could not process this image.';
      const errMsg: WorkerResponse = { type: 'error', id: req.id, code, message };
      workerScope.postMessage(errMsg);
    }
  };
}

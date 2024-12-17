import { prepareSvgMarkup } from './detect';
import { PipelineError, type RawImageData } from './types';

/**
 * Rasterises an SVG on the main thread using a sandboxed <img> + Blob URL.
 * Kept separate from decode.ts so main-thread bundles never pull in WASM decoders.
 */
export async function rasterizeSvgOnMainThread(
  bytes: Uint8Array,
  targetWidth?: number,
  targetHeight?: number
): Promise<RawImageData> {
  const { markup, width, height } = prepareSvgMarkup(bytes, targetWidth, targetHeight);
  return rasterizeSvgMarkupOnMainThread(markup, width, height);
}

export async function rasterizeSvgMarkupOnMainThread(
  markup: string,
  width: number,
  height: number
): Promise<RawImageData> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    throw new PipelineError(
      'DECODE_FAILED',
      'SVG images must be rasterised on the main thread before worker processing.'
    );
  }

  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.decoding = 'async';
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new PipelineError('CORRUPT_IMAGE', 'Could not render this SVG image.'));
      el.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!ctx) {
      throw new PipelineError('DECODE_FAILED', 'Canvas context is unavailable for SVG rendering.');
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    return { width: imgData.width, height: imgData.height, data: imgData.data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

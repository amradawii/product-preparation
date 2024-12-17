import { assertWithinLimits, inspectImage, prepareSvgMarkup } from './detect';
import { decodeBmp } from './decoders/bmp';
import { decodeGifFirstFrame } from './decoders/gif';
import { applyOrientation, readExifOrientation } from './orient';
import { rasterizeSvgMarkupOnMainThread, rasterizeSvgOnMainThread } from './svg';
import {
  PipelineError,
  type ExifOrientation,
  type ImageFormat,
  type ImageInfo,
  type RawImageData
} from './types';

export { rasterizeSvgOnMainThread };

export interface DecodedImage {
  image: RawImageData;
  format: ImageFormat;
  /** True once EXIF orientation has been applied (never applied twice). */
  oriented: boolean;
  exifOrientation: ExifOrientation;
  usedBrowserDecoder: boolean;
  notices: string[];
  originalWidth: number;
  originalHeight: number;
}

export interface DecodeOptions {
  /** Target raster dimensions when decoding an SVG. */
  svgTargetWidth?: number;
  svgTargetHeight?: number;
  /** Skip browser createImageBitmap (useful in tests or forcing WASM fallback). */
  preferFallback?: boolean;
  /** Optional custom SVG rasteriser (main thread or test hook). */
  svgRasterizer?: (markup: string, width: number, height: number) => Promise<RawImageData>;
}

const MIME_BY_FORMAT: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  webp: 'image/webp',
  avif: 'image/avif'
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function canUseBrowserDecoder(): boolean {
  return typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined';
}

async function decodeWithBrowser(bytes: Uint8Array, format: ImageFormat): Promise<RawImageData> {
  const blob = new Blob([toArrayBuffer(bytes)], { type: MIME_BY_FORMAT[format] });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!ctx) {
      throw new PipelineError('DECODE_FAILED', 'Browser 2D canvas context is unavailable.');
    }
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      width: imgData.width,
      height: imgData.height,
      data: imgData.data
    };
  } finally {
    bitmap.close();
  }
}

async function decodeWithFallback(bytes: Uint8Array, info: ImageInfo): Promise<RawImageData> {
  switch (info.format) {
    case 'jpeg': {
      if (info.isCmyk) {
        throw new PipelineError(
          'CMYK_UNSUPPORTED',
          'CMYK JPEG is not supported by the fallback decoder; convert it to RGB first.'
        );
      }
      const { default: decodeJpeg } = await import('@jsquash/jpeg/decode');
      const result = await decodeJpeg(toArrayBuffer(bytes));
      return { width: result.width, height: result.height, data: result.data };
    }

    case 'png': {
      const { default: decodePng } = await import('@jsquash/png/decode');
      try {
        const result = await decodePng(toArrayBuffer(bytes));
        if (result.data.byteLength !== result.width * result.height * 4) {
          throw new Error('Unexpected RGBA buffer length');
        }
        return { width: result.width, height: result.height, data: result.data };
      } catch {
        if (info.bitDepth === 16) {
          throw new PipelineError(
            'PNG_16BIT_UNSUPPORTED',
            'This 16-bit PNG could not be decoded by the fallback decoder; try a modern browser.'
          );
        }
        throw new PipelineError(
          'CORRUPT_IMAGE',
          'Could not decode this PNG image; the file appears to be damaged.'
        );
      }
    }

    case 'webp': {
      const { default: decodeWebp } = await import('@jsquash/webp/decode');
      const result = await decodeWebp(toArrayBuffer(bytes));
      return { width: result.width, height: result.height, data: result.data };
    }

    case 'avif': {
      const { default: decodeAvif } = await import('@jsquash/avif/decode');
      const result = await decodeAvif(toArrayBuffer(bytes));
      return { width: result.width, height: result.height, data: result.data };
    }

    case 'bmp':
      return decodeBmp(bytes);

    case 'gif':
      return decodeGifFirstFrame(bytes);

    case 'svg':
      throw new PipelineError(
        'DECODE_FAILED',
        'SVG images must be rasterised on the main thread before worker processing.'
      );
  }
}

export async function decodeImage(
  bytes: Uint8Array,
  options: DecodeOptions = {}
): Promise<DecodedImage> {
  const info = inspectImage(bytes);
  assertWithinLimits(bytes, info);

  const notices: string[] = [];
  if (info.format === 'gif' && info.animated) {
    notices.push('Animated GIF: first frame used');
  } else if (info.format === 'webp' && info.animated) {
    notices.push('Animated WebP: first frame used');
  }

  if (info.format === 'svg') {
    const { markup, width, height } = prepareSvgMarkup(
      bytes,
      options.svgTargetWidth,
      options.svgTargetHeight
    );
    const rasterizer = options.svgRasterizer ?? rasterizeSvgMarkupOnMainThread;
    const image = await rasterizer(markup, width, height);
    return {
      image,
      format: 'svg',
      oriented: true,
      exifOrientation: 1,
      usedBrowserDecoder: !options.svgRasterizer,
      notices,
      originalWidth: info.width,
      originalHeight: info.height
    };
  }

  const exifOrientation = readExifOrientation(bytes, info.format);
  let decoded: RawImageData | null = null;
  let usedBrowserDecoder = false;
  let alreadyOriented = false;

  if (!options.preferFallback && canUseBrowserDecoder()) {
    try {
      decoded = await decodeWithBrowser(bytes, info.format);
      usedBrowserDecoder = true;
      // Modern browsers apply EXIF orientation inside createImageBitmap().
      alreadyOriented = true;
    } catch {
      decoded = null;
    }
  }

  if (!decoded) {
    try {
      decoded = await decodeWithFallback(bytes, info);
      usedBrowserDecoder = false;
      alreadyOriented = false;
    } catch (err) {
      if (err instanceof PipelineError) throw err;
      throw new PipelineError(
        'CORRUPT_IMAGE',
        'Could not decode this image; the file appears to be damaged.'
      );
    }
  }

  const finalImage = alreadyOriented ? decoded : applyOrientation(decoded, exifOrientation);

  return {
    image: finalImage,
    format: info.format,
    oriented: true,
    exifOrientation,
    usedBrowserDecoder,
    notices,
    originalWidth: finalImage.width,
    originalHeight: finalImage.height
  };
}

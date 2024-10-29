import { computeGeometry, type FitMode, type GeometryPlan, type SizeMode } from './geometry';
import { PipelineError, type RawImageData } from './types';

export type BackgroundOption = { type: 'transparent' } | { type: 'color'; hex: string };

export interface ResizeOptions {
  sizeMode: SizeMode;
  targetWidth: number;
  targetHeight: number;
  fit: FitMode;
  noEnlarge: boolean;
  background: BackgroundOption;
  isVector?: boolean;
}

export interface ResizeResult {
  image: RawImageData;
  plan: GeometryPlan;
}

export function parseHexColor(hex: string): [number, number, number] {
  const cleaned = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(cleaned)) {
    const r = Number.parseInt(cleaned[0] + cleaned[0], 16);
    const g = Number.parseInt(cleaned[1] + cleaned[1], 16);
    const b = Number.parseInt(cleaned[2] + cleaned[2], 16);
    return [r, g, b];
  }
  if (/^[0-9a-f]{6}$/i.test(cleaned)) {
    const r = Number.parseInt(cleaned.slice(0, 2), 16);
    const g = Number.parseInt(cleaned.slice(2, 4), 16);
    const b = Number.parseInt(cleaned.slice(4, 6), 16);
    return [r, g, b];
  }
  throw new PipelineError('DECODE_FAILED', `Invalid background colour "${hex}".`);
}

function toExactImageData(image: RawImageData): ImageData {
  let buf = image.data;
  if (buf.byteOffset !== 0 || buf.byteLength !== buf.buffer.byteLength) {
    buf = new Uint8ClampedArray(buf);
  }
  if (typeof ImageData !== 'undefined') {
    return new ImageData(buf, image.width, image.height);
  }
  return {
    width: image.width,
    height: image.height,
    data: buf,
    colorSpace: 'srgb'
  } as ImageData;
}

async function lanczosResize(
  image: RawImageData,
  width: number,
  height: number
): Promise<RawImageData> {
  if (image.width === width && image.height === height) {
    return image;
  }

  const { default: wasmResize } = await import('@jsquash/resize');
  const resized = await wasmResize(toExactImageData(image), {
    width,
    height,
    method: 'lanczos3',
    fitMethod: 'stretch',
    premultiply: true,
    linearRGB: true
  });

  return {
    width: resized.width,
    height: resized.height,
    data: resized.data
  };
}

/**
 * Composites a resized image onto the exact output canvas directly on raw RGBA arrays,
 * avoiding HTML canvas premultiplied-alpha rounding.
 */
export function compositeOnCanvas(
  source: RawImageData,
  plan: GeometryPlan,
  background: BackgroundOption
): RawImageData {
  const { canvasWidth, canvasHeight, cropX, cropY, cropWidth, cropHeight, offsetX, offsetY } = plan;

  if (
    background.type === 'transparent' &&
    !plan.hasPadding &&
    cropX === 0 &&
    cropY === 0 &&
    source.width === canvasWidth &&
    source.height === canvasHeight
  ) {
    return source;
  }

  const out = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
  const src = source.data;
  const srcW = source.width;

  if (background.type === 'color') {
    const [bgR, bgG, bgB] = parseHexColor(background.hex);

    // Fill entire canvas with opaque background colour.
    for (let i = 0; i < out.length; i += 4) {
      out[i] = bgR;
      out[i + 1] = bgG;
      out[i + 2] = bgB;
      out[i + 3] = 255;
    }

    for (let y = 0; y < cropHeight; y++) {
      const srcRow = (cropY + y) * srcW + cropX;
      const dstRow = (offsetY + y) * canvasWidth + offsetX;
      for (let x = 0; x < cropWidth; x++) {
        const s = (srcRow + x) * 4;
        const d = (dstRow + x) * 4;
        const a = src[s + 3];

        if (a === 255) {
          out[d] = src[s];
          out[d + 1] = src[s + 1];
          out[d + 2] = src[s + 2];
          out[d + 3] = 255;
        } else if (a > 0) {
          const inv = 255 - a;
          out[d] = Math.round((src[s] * a + bgR * inv) / 255);
          out[d + 1] = Math.round((src[s + 1] * a + bgG * inv) / 255);
          out[d + 2] = Math.round((src[s + 2] * a + bgB * inv) / 255);
          out[d + 3] = 255;
        }
      }
    }
  } else {
    // Transparent canvas: copy RGBA pixels verbatim without touching alpha or RGB.
    for (let y = 0; y < cropHeight; y++) {
      const srcByteStart = ((cropY + y) * srcW + cropX) * 4;
      const dstByteStart = ((offsetY + y) * canvasWidth + offsetX) * 4;
      out.set(src.subarray(srcByteStart, srcByteStart + cropWidth * 4), dstByteStart);
    }
  }

  return { width: canvasWidth, height: canvasHeight, data: out };
}

export async function resizeAndCompose(
  image: RawImageData,
  options: ResizeOptions
): Promise<ResizeResult> {
  const plan = computeGeometry({
    srcWidth: image.width,
    srcHeight: image.height,
    sizeMode: options.sizeMode,
    targetWidth: options.targetWidth,
    targetHeight: options.targetHeight,
    fit: options.fit,
    noEnlarge: options.noEnlarge,
    isVector: options.isVector
  });

  const resized = plan.needsResize
    ? await lanczosResize(image, plan.scaledWidth, plan.scaledHeight)
    : image;

  const composed = compositeOnCanvas(resized, plan, options.background);
  return { image: composed, plan };
}

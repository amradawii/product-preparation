import {
  DEFAULT_CUSTOM_QUALITY,
  PipelineError,
  TARGET_SIZE_DEFAULT_KB,
  type QualityPreset,
  type RawImageData
} from './types';

export { TARGET_SIZE_DEFAULT_KB, type QualityPreset };

export const PRESET_QUALITY = {
  best: 82,
  smaller: 70
} as const;

export const TARGET_SIZE_MIN_QUALITY = 50;
export const TARGET_SIZE_MAX_QUALITY = PRESET_QUALITY.best;
export const TARGET_SIZE_MAX_ENCODES = 7;

export interface EncodeOptions {
  preset: QualityPreset;
  /** Optional explicit lossy quality (0..100); overrides preset when preset is best/smaller. */
  quality?: number;
  /** Target ceiling in bytes when preset === 'target'. */
  targetBytes?: number;
  /** Lowest acceptable quality when searching for targetBytes (defaults to 50). */
  minQuality?: number;
  /** Highest quality tried when searching for targetBytes (defaults to 82). */
  maxQuality?: number;
}

export interface EncodedWebp {
  bytes: Uint8Array;
  quality: number;
  lossless: boolean;
  encodeCount: number;
  targetReached?: boolean;
  notice?: string;
}

export type QualityEncoder = (image: RawImageData, quality: number) => Promise<Uint8Array>;

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

function readAscii(bytes: Uint8Array, offset: number, len: number): string {
  let out = '';
  const end = Math.min(bytes.length, offset + len);
  for (let i = offset; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function formatKb(bytes: number): string {
  const kb = Math.round(bytes / 1024);
  return `${Math.max(1, kb)} KB`;
}

const METADATA_CHUNKS = new Set(['EXIF', 'XMP ', 'ICCP']);

/** Lists all RIFF chunk FourCC tags inside a WebP file. */
export function listWebpChunks(bytes: Uint8Array): string[] {
  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WEBP') {
    return [];
  }
  const chunks: string[] = [];
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const fourcc = readAscii(bytes, pos, 4);
    const size = readUint32LE(bytes, pos + 4);
    chunks.push(fourcc);
    pos += 8 + size + (size % 2);
  }
  return chunks;
}

/**
 * Guarantees a WebP container contains no EXIF, XMP, or ICCP metadata chunks.
 * Fast-paths without copying when no metadata chunks are present (the normal libwebp output).
 */
export function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  const chunks = listWebpChunks(bytes);
  if (!chunks.some((c) => METADATA_CHUNKS.has(c))) {
    return bytes;
  }

  const kept: Uint8Array[] = [];
  let payloadSize = 4; // "WEBP"
  let pos = 12;

  while (pos + 8 <= bytes.length) {
    const fourcc = readAscii(bytes, pos, 4);
    const size = readUint32LE(bytes, pos + 4);
    const paddedSize = size + (size % 2);
    const chunkEnd = Math.min(bytes.length, pos + 8 + paddedSize);

    if (!METADATA_CHUNKS.has(fourcc)) {
      const slice = new Uint8Array(bytes.subarray(pos, chunkEnd));
      if (fourcc === 'VP8X' && slice.length >= 12) {
        // Clear ICC (0x20), EXIF (0x08), and XMP (0x04) flags in VP8X header.
        slice[8] &= ~(0x20 | 0x08 | 0x04);
      }
      kept.push(slice);
      payloadSize += slice.length;
    }

    pos += 8 + paddedSize;
  }

  const out = new Uint8Array(8 + payloadSize);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  writeUint32LE(out, 4, payloadSize);
  out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP

  let cursor = 12;
  for (const chunk of kept) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

export async function encodeWebpAtQuality(
  image: RawImageData,
  quality: number
): Promise<Uint8Array> {
  const clamped = Math.max(0, Math.min(100, Math.round(quality)));
  const { default: wasmEncode } = await import('@jsquash/webp/encode');

  try {
    const buffer = await wasmEncode(toExactImageData(image), {
      quality: clamped,
      lossless: 0,
      exact: 0,
      method: 4,
      alpha_quality: Math.min(100, clamped + 10)
    });
    return stripWebpMetadata(new Uint8Array(buffer));
  } catch {
    throw new PipelineError('ENCODE_FAILED', 'Could not encode this image as WebP.');
  }
}

export async function encodeWebpToTargetSize(
  image: RawImageData,
  targetBytes: number,
  options: {
    minQuality?: number;
    maxQuality?: number;
    maxEncodes?: number;
    encoder?: QualityEncoder;
  } = {}
): Promise<EncodedWebp> {
  const target = Math.max(1024, Math.round(targetBytes));
  const minQ = Math.max(
    1,
    Math.min(100, Math.round(options.minQuality ?? TARGET_SIZE_MIN_QUALITY))
  );
  const maxQ = Math.max(
    minQ,
    Math.min(100, Math.round(options.maxQuality ?? TARGET_SIZE_MAX_QUALITY))
  );
  const maxEncodes = Math.max(1, options.maxEncodes ?? TARGET_SIZE_MAX_ENCODES);
  const runEncode = options.encoder ?? encodeWebpAtQuality;

  let encodeCount = 0;

  // Fast path: check top quality first. If visually lossless already fits, stop in 1 encode.
  const firstBytes = await runEncode(image, maxQ);
  encodeCount++;
  if (firstBytes.byteLength <= target || minQ === maxQ || maxEncodes === 1) {
    const reached = firstBytes.byteLength <= target;
    return {
      bytes: firstBytes,
      quality: maxQ,
      lossless: false,
      encodeCount,
      targetReached: reached,
      notice: reached
        ? undefined
        : `Could not reach ${formatKb(target)}; smallest good result is ${formatKb(firstBytes.byteLength)}`
    };
  }

  let lo = minQ;
  let hi = maxQ - 1;
  let bestFit: { bytes: Uint8Array; quality: number } | null = null;
  let lowestAttempt: { bytes: Uint8Array; quality: number } = {
    bytes: firstBytes,
    quality: maxQ
  };

  while (lo <= hi && encodeCount < maxEncodes) {
    const mid = Math.floor((lo + hi) / 2);
    const bytes = await runEncode(image, mid);
    encodeCount++;

    if (mid < lowestAttempt.quality) {
      lowestAttempt = { bytes, quality: mid };
    }

    if (bytes.byteLength <= target) {
      bestFit = { bytes, quality: mid };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (bestFit) {
    return {
      bytes: bestFit.bytes,
      quality: bestFit.quality,
      lossless: false,
      encodeCount,
      targetReached: true
    };
  }

  // Ensure the quality floor itself was tested if maxEncodes budget still allows.
  if (lowestAttempt.quality > minQ && encodeCount < maxEncodes) {
    const floorBytes = await runEncode(image, minQ);
    encodeCount++;
    lowestAttempt = { bytes: floorBytes, quality: minQ };
    if (floorBytes.byteLength <= target) {
      return {
        bytes: floorBytes,
        quality: minQ,
        lossless: false,
        encodeCount,
        targetReached: true
      };
    }
  }

  return {
    bytes: lowestAttempt.bytes,
    quality: lowestAttempt.quality,
    lossless: false,
    encodeCount,
    targetReached: false,
    notice: `Could not reach ${formatKb(target)}; smallest good result is ${formatKb(lowestAttempt.bytes.byteLength)}`
  };
}

export async function encodeWebp(
  image: RawImageData,
  options: EncodeOptions
): Promise<EncodedWebp> {
  if (options.preset === 'lossless') {
    const { default: wasmEncode } = await import('@jsquash/webp/encode');
    try {
      const buffer = await wasmEncode(toExactImageData(image), {
        lossless: 1,
        exact: 1,
        quality: 75,
        method: 4
      });
      return {
        bytes: stripWebpMetadata(new Uint8Array(buffer)),
        quality: 100,
        lossless: true,
        encodeCount: 1
      };
    } catch {
      throw new PipelineError('ENCODE_FAILED', 'Could not encode this image as lossless WebP.');
    }
  }

  if (options.preset === 'target') {
    const targetBytes = options.targetBytes ?? TARGET_SIZE_DEFAULT_KB * 1024;
    return encodeWebpToTargetSize(image, targetBytes, {
      minQuality: options.minQuality,
      maxQuality: options.maxQuality
    });
  }

  if (options.preset === 'custom') {
    const quality = Math.max(
      10,
      Math.min(95, Math.round(options.quality ?? DEFAULT_CUSTOM_QUALITY))
    );
    const bytes = await encodeWebpAtQuality(image, quality);
    return {
      bytes,
      quality,
      lossless: false,
      encodeCount: 1
    };
  }

  const quality = options.quality ?? PRESET_QUALITY[options.preset];
  const bytes = await encodeWebpAtQuality(image, quality);
  return {
    bytes,
    quality,
    lossless: false,
    encodeCount: 1
  };
}

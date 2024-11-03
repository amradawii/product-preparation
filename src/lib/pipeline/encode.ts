import { PipelineError, type RawImageData } from './types';

export type QualityPreset = 'best' | 'smaller' | 'lossless';

export const PRESET_QUALITY = {
  best: 82,
  smaller: 70
} as const;

export interface EncodeOptions {
  preset: QualityPreset;
  /** Optional explicit lossy quality (0..100); overrides preset when preset !== 'lossless'. */
  quality?: number;
}

export interface EncodedWebp {
  bytes: Uint8Array;
  quality: number;
  lossless: boolean;
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
        lossless: true
      };
    } catch {
      throw new PipelineError('ENCODE_FAILED', 'Could not encode this image as lossless WebP.');
    }
  }

  const quality = options.quality ?? PRESET_QUALITY[options.preset];
  const bytes = await encodeWebpAtQuality(image, quality);
  return {
    bytes,
    quality,
    lossless: false
  };
}

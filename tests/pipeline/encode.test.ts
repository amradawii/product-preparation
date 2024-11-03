import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeImage } from '../../src/lib/pipeline/decode';
import { detectFormat, inspectImage } from '../../src/lib/pipeline/detect';
import {
  encodeWebp,
  listWebpChunks,
  PRESET_QUALITY,
  stripWebpMetadata
} from '../../src/lib/pipeline/encode';
import { readExifOrientation } from '../../src/lib/pipeline/orient';
import { resizeAndCompose } from '../../src/lib/pipeline/resize';
import type { RawImageData } from '../../src/lib/pipeline/types';
import {
  initDecodersForNode,
  initResizeForNode,
  initWebpEncodeForNode
} from '../helpers/init-wasm';

function makeRichTestImage(width: number, height: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Deterministic textured pattern so lossy presets show realistic size differences.
      const wave = Math.sin(x * 0.35) * Math.cos(y * 0.27);
      data[i] = Math.round(((x * 7 + y * 3) % 256) * 0.7 + (wave + 1) * 35);
      data[i + 1] = Math.round(((x * 5 + y * 11) % 256) * 0.6 + 50);
      data[i + 2] = Math.round(((x * 13 + y * 2) % 256) * 0.8);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function appendChunkToWebp(webp: Uint8Array, fourcc: string, payload: Uint8Array): Uint8Array {
  const padded = payload.length + (payload.length % 2);
  const out = new Uint8Array(webp.length + 8 + padded);
  out.set(webp, 0);
  const offset = webp.length;
  for (let i = 0; i < 4; i++) out[offset + i] = fourcc.charCodeAt(i);
  const view = new DataView(out.buffer);
  view.setUint32(offset + 4, payload.length, true);
  out.set(payload, offset + 8);
  view.setUint32(4, out.length - 8, true);
  return out;
}

beforeAll(async () => {
  await Promise.all([initDecodersForNode(), initResizeForNode(), initWebpEncodeForNode()]);
});

describe('encodeWebp', () => {
  it('encodes valid WebP for best (q=82) and smaller (q=70) presets with smaller < best', async () => {
    const img = makeRichTestImage(160, 120);

    const best = await encodeWebp(img, { preset: 'best' });
    const smaller = await encodeWebp(img, { preset: 'smaller' });

    expect(best.lossless).toBe(false);
    expect(best.quality).toBe(PRESET_QUALITY.best);
    expect(smaller.quality).toBe(PRESET_QUALITY.smaller);

    expect(detectFormat(best.bytes)).toBe('webp');
    expect(detectFormat(smaller.bytes)).toBe('webp');
    expect(inspectImage(best.bytes)).toMatchObject({ format: 'webp', width: 160, height: 120 });
    expect(inspectImage(smaller.bytes)).toMatchObject({ format: 'webp', width: 160, height: 120 });
    expect(smaller.bytes.byteLength).toBeLessThan(best.bytes.byteLength);
  });

  it('produces a bit-identical lossless round-trip including semi-transparent and alpha=0 pixels', async () => {
    const width = 16;
    const height = 16;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (x < 4) {
          // Fully transparent pixels with non-zero RGB (tests exact: 1).
          data[i] = 17;
          data[i + 1] = 89;
          data[i + 2] = 203;
          data[i + 3] = 0;
        } else if (x < 8) {
          // Semi-transparent pixels.
          data[i] = 240;
          data[i + 1] = 45;
          data[i + 2] = 90;
          data[i + 3] = 123;
        } else {
          // Opaque gradient pixels.
          data[i] = (x * 16) % 256;
          data[i + 1] = (y * 16) % 256;
          data[i + 2] = ((x + y) * 9) % 256;
          data[i + 3] = 255;
        }
      }
    }

    const encoded = await encodeWebp({ width, height, data }, { preset: 'lossless' });
    expect(encoded.lossless).toBe(true);
    expect(detectFormat(encoded.bytes)).toBe('webp');

    const decoded = await decodeImage(encoded.bytes, { preferFallback: true });
    expect(decoded.image.width).toBe(width);
    expect(decoded.image.height).toBe(height);
    expect(decoded.image.data).toEqual(data);
  });

  it('strips all EXIF/XMP/ICCP metadata when processing an EXIF-tagged JPEG end-to-end', async () => {
    const jpegBytes = new Uint8Array(
      await readFile(path.resolve(process.cwd(), 'tests/fixtures/exif-rotated.jpg'))
    );
    expect(readExifOrientation(jpegBytes, 'jpeg')).toBe(6);

    const decoded = await decodeImage(jpegBytes, { preferFallback: true });
    const { image } = await resizeAndCompose(decoded.image, {
      sizeMode: 'fixed',
      targetWidth: 64,
      targetHeight: 64,
      fit: 'fit',
      noEnlarge: false,
      background: { type: 'color', hex: '#ffffff' }
    });
    const encoded = await encodeWebp(image, { preset: 'best' });

    const chunks = listWebpChunks(encoded.bytes);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks).not.toContain('EXIF');
    expect(chunks).not.toContain('XMP ');
    expect(chunks).not.toContain('ICCP');
    expect(readExifOrientation(encoded.bytes, 'webp')).toBe(1);
    expect(inspectImage(encoded.bytes)).toMatchObject({ format: 'webp', width: 64, height: 64 });
  });

  it('stripWebpMetadata removes injected EXIF and XMP chunks cleanly', async () => {
    const encoded = await encodeWebp(makeRichTestImage(24, 24), { preset: 'best' });
    const withExif = appendChunkToWebp(
      encoded.bytes,
      'EXIF',
      new TextEncoder().encode('Exif\0\0FAKE')
    );
    const withBoth = appendChunkToWebp(withExif, 'XMP ', new TextEncoder().encode('<x:xmpmeta/>'));

    expect(listWebpChunks(withBoth)).toContain('EXIF');
    expect(listWebpChunks(withBoth)).toContain('XMP ');

    const stripped = stripWebpMetadata(withBoth);
    expect(listWebpChunks(stripped)).not.toContain('EXIF');
    expect(listWebpChunks(stripped)).not.toContain('XMP ');
    expect(detectFormat(stripped)).toBe('webp');
    expect(inspectImage(stripped)).toMatchObject({ format: 'webp', width: 24, height: 24 });
  });
});

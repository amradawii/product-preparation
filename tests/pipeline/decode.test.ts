import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeImage } from '../../src/lib/pipeline/decode';
import { PipelineError } from '../../src/lib/pipeline/types';
import { initDecodersForNode } from '../helpers/init-wasm';

const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures');

async function loadFixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(fixturesDir, name)));
}

beforeAll(async () => {
  await initDecodersForNode();
});

describe('decodeImage', () => {
  it.each([
    ['sample.jpg', 'jpeg', 32, 24],
    ['sample.png', 'png', 40, 30],
    ['sample.gif', 'gif', 28, 20],
    ['sample.bmp', 'bmp', 24, 16],
    ['sample.webp', 'webp', 36, 28],
    ['sample.avif', 'avif', 32, 20]
  ] as const)('decodes %s (%s) to %dx%d RGBA pixels', async (file, format, width, height) => {
    const bytes = await loadFixture(file);
    const decoded = await decodeImage(bytes);

    expect(decoded.format).toBe(format);
    expect(decoded.oriented).toBe(true);
    expect(decoded.image.width).toBe(width);
    expect(decoded.image.height).toBe(height);
    expect(decoded.image.data.length).toBe(width * height * 4);
  });

  it('preserves transparency when decoding PNG and GIF', async () => {
    const png = await decodeImage(await loadFixture('sample.png'));
    // Left half is transparent, right half is opaque.
    expect(png.image.data[3]).toBe(0);
    expect(png.image.data[(0 * 40 + 30) * 4 + 3]).toBe(255);

    const gif = await decodeImage(await loadFixture('sample.gif'));
    expect(gif.image.data[3]).toBe(0);
    expect(gif.image.data[(0 * 28 + 20) * 4 + 3]).toBe(255);
  });

  it('decodes animated GIF first frame and attaches a user notice', async () => {
    const decoded = await decodeImage(await loadFixture('animated.gif'));
    expect(decoded.format).toBe('gif');
    expect(decoded.image.width).toBe(20);
    expect(decoded.image.height).toBe(16);
    expect(decoded.notices).toContain('Animated GIF: first frame used');
    // Frame 1 is emerald (16, 185, 129), frame 2 is amber.
    expect(decoded.image.data[0]).toBe(16);
    expect(decoded.image.data[1]).toBe(185);
    expect(decoded.image.data[2]).toBe(129);
  });

  it('applies EXIF orientation once on fallback decode and swaps rotated dimensions', async () => {
    const bytes = await loadFixture('exif-rotated.jpg');
    const decoded = await decodeImage(bytes, { preferFallback: true });

    expect(decoded.exifOrientation).toBe(6);
    expect(decoded.oriented).toBe(true);
    expect(decoded.usedBrowserDecoder).toBe(false);
    // Stored as 24x16 with Orientation=6 (90 CW) -> upright 16x24
    expect(decoded.image.width).toBe(16);
    expect(decoded.image.height).toBe(24);
    // Original top-left crimson quadrant moves to top-right after 90 CW rotation.
    const topRightIdx = (2 * 16 + 13) * 4;
    expect(decoded.image.data[topRightIdx]).toBeGreaterThan(180);
    expect(decoded.image.data[topRightIdx + 1]).toBeLessThan(80);
  });

  it('does not double-rotate when the browser decoder already applied EXIF orientation', async () => {
    const bytes = await loadFixture('exif-rotated.jpg');
    const origCreateImageBitmap = globalThis.createImageBitmap;
    const origOffscreenCanvas = globalThis.OffscreenCanvas;

    const uprightData = new Uint8ClampedArray(16 * 24 * 4);
    // Mark upright top-right corner crimson (220, 38, 38, 255)
    const tr = (0 * 16 + 15) * 4;
    uprightData[tr] = 220;
    uprightData[tr + 1] = 38;
    uprightData[tr + 2] = 38;
    uprightData[tr + 3] = 255;

    try {
      (globalThis as Record<string, unknown>).createImageBitmap = async () => ({
        width: 16,
        height: 24,
        close: () => {}
      });
      (globalThis as Record<string, unknown>).OffscreenCanvas = class {
        width: number;
        height: number;
        constructor(w: number, h: number) {
          this.width = w;
          this.height = h;
        }
        getContext() {
          return {
            drawImage: () => {},
            getImageData: () => ({ width: 16, height: 24, data: uprightData })
          };
        }
      };

      const decoded = await decodeImage(bytes);
      expect(decoded.usedBrowserDecoder).toBe(true);
      expect(decoded.oriented).toBe(true);
      expect(decoded.exifOrientation).toBe(6);
      // Stays 16x24 (would be swapped back to 24x16 if double-rotated!)
      expect(decoded.image.width).toBe(16);
      expect(decoded.image.height).toBe(24);
      expect(decoded.image.data[tr]).toBe(220);
    } finally {
      (globalThis as Record<string, unknown>).createImageBitmap = origCreateImageBitmap;
      (globalThis as Record<string, unknown>).OffscreenCanvas = origOffscreenCanvas;
    }
  });

  it('decodes renamed JPEG (.png filename) using its real magic bytes', async () => {
    const decoded = await decodeImage(await loadFixture('renamed-jpeg.png'));
    expect(decoded.format).toBe('jpeg');
    expect(decoded.image.width).toBe(32);
    expect(decoded.image.height).toBe(24);
  });

  it('decodes SVG via main-thread rasteriser hook at requested target dimensions', async () => {
    const bytes = await loadFixture('sample.svg');
    const decoded = await decodeImage(bytes, {
      svgTargetWidth: 128,
      svgTargetHeight: 96,
      svgRasterizer: async (_markup, width, height) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4)
      })
    });

    expect(decoded.format).toBe('svg');
    expect(decoded.originalWidth).toBe(64);
    expect(decoded.originalHeight).toBe(48);
    expect(decoded.image.width).toBe(128);
    expect(decoded.image.height).toBe(96);
  });

  it('returns a clear PipelineError for corrupt image files', async () => {
    const corrupt = await loadFixture('corrupt.jpg');
    await expect(decodeImage(corrupt)).rejects.toThrowError(PipelineError);
  });
});

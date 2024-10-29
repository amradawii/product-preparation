import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeImage } from '../../src/lib/pipeline/decode';
import { parseHexColor, resizeAndCompose } from '../../src/lib/pipeline/resize';
import type { RawImageData } from '../../src/lib/pipeline/types';
import { initDecodersForNode, initResizeForNode } from '../helpers/init-wasm';

function makeSolid(
  width: number,
  height: number,
  rgba: [number, number, number, number]
): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return { width, height, data };
}

function pixelAt(img: RawImageData, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

beforeAll(async () => {
  await Promise.all([initDecodersForNode(), initResizeForNode()]);
});

describe('resizeAndCompose', () => {
  it('parses 3-digit and 6-digit hex colours', () => {
    expect(parseHexColor('#fff')).toEqual([255, 255, 255]);
    expect(parseHexColor('#10b981')).toEqual([16, 185, 129]);
    expect(() => parseHexColor('not-a-color')).toThrowError(/Invalid background colour/i);
  });

  it('downscales a landscape image with Lanczos3 and pads onto an exact white square', async () => {
    const src = makeSolid(120, 60, [16, 185, 129, 255]);
    const { image, plan } = await resizeAndCompose(src, {
      sizeMode: 'fixed',
      targetWidth: 60,
      targetHeight: 60,
      fit: 'fit',
      noEnlarge: true,
      background: { type: 'color', hex: '#ffffff' }
    });

    expect(image.width).toBe(60);
    expect(image.height).toBe(60);
    expect(plan.scaledWidth).toBe(60);
    expect(plan.scaledHeight).toBe(30);
    expect(plan.offsetY).toBe(15);

    // Top padding row is pure white.
    expect(pixelAt(image, 30, 5)).toEqual([255, 255, 255, 255]);
    // Centre pixel is emerald.
    const center = pixelAt(image, 30, 30);
    expect(center[0]).toBeLessThan(25);
    expect(center[1]).toBeGreaterThan(175);
    expect(center[2]).toBeGreaterThan(120);
    expect(center[3]).toBe(255);
  });

  it('flattens semi-transparent pixels onto a custom background colour without canvas premultiply', async () => {
    // 50% alpha red (255, 0, 0, 128) over black (#000000) -> ~128, 0, 0, 255
    const src = makeSolid(20, 20, [255, 0, 0, 128]);
    const { image } = await resizeAndCompose(src, {
      sizeMode: 'keep',
      targetWidth: 20,
      targetHeight: 20,
      fit: 'fit',
      noEnlarge: true,
      background: { type: 'color', hex: '#000000' }
    });

    expect(image.width).toBe(20);
    expect(image.height).toBe(20);
    expect(pixelAt(image, 10, 10)).toEqual([128, 0, 0, 255]);
  });

  it('keeps transparent padding and preserves raw pixel values verbatim when background is transparent', async () => {
    const src = makeSolid(10, 10, [12, 34, 56, 7]);
    const { image } = await resizeAndCompose(src, {
      sizeMode: 'fixed',
      targetWidth: 20,
      targetHeight: 20,
      fit: 'fit',
      noEnlarge: true,
      background: { type: 'transparent' }
    });

    expect(image.width).toBe(20);
    expect(image.height).toBe(20);
    // Corner padding is transparent black.
    expect(pixelAt(image, 0, 0)).toEqual([0, 0, 0, 0]);
    // Low-alpha interior pixel survives bit-for-bit (no canvas premultiplication rounding).
    expect(pixelAt(image, 10, 10)).toEqual([12, 34, 56, 7]);
  });

  it('keeps EXIF-rotated JPEG upright when decoded and resized onto a square canvas', async () => {
    const bytes = new Uint8Array(
      await readFile(path.resolve(process.cwd(), 'tests/fixtures/exif-rotated.jpg'))
    );
    const decoded = await decodeImage(bytes, { preferFallback: true });
    // Upright decoded dimensions: 16x24 (portrait)
    expect(decoded.image.width).toBe(16);
    expect(decoded.image.height).toBe(24);

    const { image, plan } = await resizeAndCompose(decoded.image, {
      sizeMode: 'fixed',
      targetWidth: 48,
      targetHeight: 48,
      fit: 'fit',
      noEnlarge: false,
      background: { type: 'color', hex: '#ffffff' }
    });

    expect(image.width).toBe(48);
    expect(image.height).toBe(48);
    expect(plan.scaledWidth).toBe(32);
    expect(plan.scaledHeight).toBe(48);
    expect(plan.offsetX).toBe(8);

    // Left padding is white.
    expect(pixelAt(image, 2, 24)).toEqual([255, 255, 255, 255]);
    // Crimson corner moved from raw top-left to upright top-right (inside x=8..40 -> around x=35, y=6).
    const uprightTopRight = pixelAt(image, 34, 6);
    expect(uprightTopRight[0]).toBeGreaterThan(170);
    expect(uprightTopRight[1]).toBeLessThan(80);
  });
});

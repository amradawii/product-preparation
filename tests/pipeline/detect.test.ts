import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertWithinLimits,
  detectFormat,
  inspectImage,
  prepareSvgMarkup
} from '../../src/lib/pipeline/detect';
import { PipelineError } from '../../src/lib/pipeline/types';

const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures');

async function loadFixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(fixturesDir, name)));
}

describe('detectFormat & inspectImage', () => {
  it.each([
    ['sample.jpg', 'jpeg', 32, 24, false],
    ['sample.png', 'png', 40, 30, false],
    ['sample.gif', 'gif', 28, 20, false],
    ['animated.gif', 'gif', 20, 16, true],
    ['sample.svg', 'svg', 64, 48, false],
    ['sample.bmp', 'bmp', 24, 16, false],
    ['sample.webp', 'webp', 36, 28, false],
    ['sample.avif', 'avif', 32, 20, false]
  ] as const)(
    'inspects %s as %s (%dx%d, animated=%s)',
    async (file, format, width, height, animated) => {
      const bytes = await loadFixture(file);
      expect(detectFormat(bytes)).toBe(format);

      const info = inspectImage(bytes);
      expect(info.format).toBe(format);
      expect(info.width).toBe(width);
      expect(info.height).toBe(height);
      expect(info.animated).toBe(animated);
    }
  );

  it('detects a renamed JPEG saved with a .png extension by magic bytes', async () => {
    const bytes = await loadFixture('renamed-jpeg.png');
    expect(detectFormat(bytes)).toBe('jpeg');
    expect(inspectImage(bytes)).toMatchObject({ format: 'jpeg', width: 32, height: 24 });
  });

  it('rejects unsupported random bytes with UNSUPPORTED_FORMAT', () => {
    const random = new TextEncoder().encode('hello world not an image');
    expect(detectFormat(random)).toBeNull();
    expect(() => inspectImage(random)).toThrowError(PipelineError);
    try {
      inspectImage(random);
    } catch (err) {
      expect((err as PipelineError).code).toBe('UNSUPPORTED_FORMAT');
    }
  });

  it('rejects images exceeding 50 megapixels from header dimensions before decoding', () => {
    // Minimal fake PNG header declaring 10000 x 6000 (60 MP)
    const pngHeader = new Uint8Array(30);
    pngHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(pngHeader.buffer);
    view.setUint32(8, 13, false); // IHDR length
    pngHeader.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
    view.setUint32(16, 10_000, false);
    view.setUint32(20, 6_000, false);
    pngHeader[24] = 8;

    const info = inspectImage(pngHeader);
    expect(info).toMatchObject({ format: 'png', width: 10_000, height: 6_000 });
    expect(() => assertWithinLimits(pngHeader, info)).toThrowError(/50 megapixel/i);
  });

  it('rejects SVG without width, height, or viewBox', () => {
    const badSvg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>'
    );
    expect(detectFormat(badSvg)).toBe('svg');
    expect(() => inspectImage(badSvg)).toThrowError(/no width, height, or viewBox/i);
  });

  it('derives dimensions from viewBox and rewrites root attributes for sharp rasterisation', () => {
    const vbSvg = new TextEncoder().encode(
      '<svg viewBox="0 0 120 60"><circle cx="60" cy="30" r="20" /></svg>'
    );
    const info = inspectImage(vbSvg);
    expect(info).toMatchObject({
      format: 'svg',
      width: 120,
      height: 60,
      svgHasExplicitSize: false
    });

    const prepared = prepareSvgMarkup(vbSvg, 800, 400);
    expect(prepared.width).toBe(800);
    expect(prepared.height).toBe(400);
    expect(prepared.markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(prepared.markup).toContain('width="800"');
    expect(prepared.markup).toContain('height="400"');
  });
});

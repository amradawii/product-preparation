import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeImage } from '../../src/lib/pipeline/decode';
import { detectFormat, inspectImage, prepareSvgMarkup } from '../../src/lib/pipeline/detect';
import { PipelineError } from '../../src/lib/pipeline/types';
import { initDecodersForNode } from '../helpers/init-wasm';

const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures');

async function loadFixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(fixturesDir, name)));
}

beforeAll(async () => {
  await initDecodersForNode();
});

describe('format edge cases (SVG, animated GIF, 16-bit PNG, CMYK JPEG)', () => {
  it('handles SVG with viewBox only and injects explicit target dimensions', async () => {
    const bytes = await loadFixture('svg-viewbox-only.svg');
    const info = inspectImage(bytes);
    expect(info).toMatchObject({
      format: 'svg',
      width: 120,
      height: 80,
      svgHasExplicitSize: false
    });

    const prepared = prepareSvgMarkup(bytes, 800, 533);
    expect(prepared.width).toBe(800);
    expect(prepared.height).toBe(533);
    expect(prepared.markup).toContain('width="800"');
    expect(prepared.markup).toContain('height="533"');
    expect(prepared.markup).toContain('viewBox="0 0 120 80"');
  });

  it('rejects SVG missing width, height, and viewBox with a clear one-line error', async () => {
    const bytes = await loadFixture('svg-no-size.svg');
    expect(detectFormat(bytes)).toBe('svg');
    await expect(decodeImage(bytes)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof PipelineError &&
        err.code === 'SVG_MISSING_SIZE' &&
        /no width, height, or viewBox/i.test(err.message)
    );
  });

  it('strips embedded <script> tags and inline event handlers when preparing SVG markup', async () => {
    const bytes = await loadFixture('svg-with-script.svg');
    const info = inspectImage(bytes);
    expect(info).toMatchObject({ format: 'svg', width: 80, height: 80 });

    const prepared = prepareSvgMarkup(bytes, 400, 400);
    expect(prepared.markup).not.toMatch(/<script/i);
    expect(prepared.markup).not.toMatch(/\bonload\s*=/i);
    expect(prepared.markup).toContain('width="400"');
    expect(prepared.markup).toContain('height="400"');
  });

  it('handles percentage-sized SVG that provides a valid viewBox', () => {
    const pctSvg = new TextEncoder().encode(
      '<svg width="100%" height="100%" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>'
    );
    const info = inspectImage(pctSvg);
    expect(info).toMatchObject({ format: 'svg', width: 200, height: 100 });
    const prepared = prepareSvgMarkup(pctSvg, 800, 400);
    expect(prepared.markup).not.toContain('100%');
    expect(prepared.markup).toContain('width="800"');
    expect(prepared.markup).toContain('height="400"');
  });

  it('detects and decodes 16-bit PNG cleanly or returns a clear PNG_16BIT_UNSUPPORTED error in fallback mode', async () => {
    const bytes = await loadFixture('sample-16bit.png');
    const info = inspectImage(bytes);
    expect(info).toMatchObject({ format: 'png', width: 24, height: 16, bitDepth: 16 });

    try {
      const decoded = await decodeImage(bytes, { preferFallback: true });
      expect(decoded.image.width).toBe(24);
      expect(decoded.image.height).toBe(16);
      expect(decoded.image.data.byteLength).toBe(24 * 16 * 4);
    } catch (err) {
      expect(err).toBeInstanceOf(PipelineError);
      expect((err as PipelineError).code).toBe('PNG_16BIT_UNSUPPORTED');
      expect((err as PipelineError).message).toMatch(/16-bit PNG/i);
    }
  });

  it('detects CMYK JPEG from SOF components and returns a clear one-line error in fallback mode', async () => {
    const bytes = await loadFixture('sample-cmyk.jpg');
    const info = inspectImage(bytes);
    expect(info).toMatchObject({ format: 'jpeg', width: 16, height: 16, isCmyk: true });

    await expect(decodeImage(bytes, { preferFallback: true })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof PipelineError &&
        err.code === 'CMYK_UNSUPPORTED' &&
        /CMYK JPEG/i.test(err.message)
    );
  });

  it('uses the browser decoder first for 16-bit PNG and CMYK JPEG when createImageBitmap is available', async () => {
    const origCreateImageBitmap = globalThis.createImageBitmap;
    const origOffscreenCanvas = globalThis.OffscreenCanvas;

    try {
      (globalThis as Record<string, unknown>).createImageBitmap = async () => ({
        width: 16,
        height: 16,
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
            getImageData: () => ({
              width: 16,
              height: 16,
              data: new Uint8ClampedArray(16 * 16 * 4).fill(255)
            })
          };
        }
      };

      const cmyk = await decodeImage(await loadFixture('sample-cmyk.jpg'));
      expect(cmyk.usedBrowserDecoder).toBe(true);
      expect(cmyk.image.width).toBe(16);

      const png16 = await decodeImage(await loadFixture('sample-16bit.png'));
      expect(png16.usedBrowserDecoder).toBe(true);
      expect(png16.image.width).toBe(16);
    } finally {
      (globalThis as Record<string, unknown>).createImageBitmap = origCreateImageBitmap;
      (globalThis as Record<string, unknown>).OffscreenCanvas = origOffscreenCanvas;
    }
  });

  it('decodes animated GIF first frame and includes the animated notice', async () => {
    const bytes = await loadFixture('animated.gif');
    const decoded = await decodeImage(bytes, { preferFallback: true });
    expect(decoded.format).toBe('gif');
    expect(decoded.image.width).toBe(20);
    expect(decoded.image.height).toBe(16);
    expect(decoded.notices).toEqual(['Animated GIF: first frame used']);
  });

  it('rejects truncated PNG with a clear CORRUPT_IMAGE error', async () => {
    const png = await loadFixture('sample.png');
    const truncated = png.subarray(0, 40);
    await expect(decodeImage(truncated, { preferFallback: true })).rejects.toSatisfy(
      (err: unknown) => err instanceof PipelineError && err.code === 'CORRUPT_IMAGE'
    );
  });
});

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { revokeCompareUrls, revokeItemUrls, type BatchItem } from '../../src/lib/batch';
import { inspectImage } from '../../src/lib/pipeline/detect';
import {
  downscaleForThumbnail,
  runPipelineJob,
  THUMBNAIL_MAX_PX
} from '../../src/lib/worker/worker';
import {
  initDecodersForNode,
  initResizeForNode,
  initWebpEncodeForNode
} from '../helpers/init-wasm';

beforeAll(async () => {
  await Promise.all([initDecodersForNode(), initResizeForNode(), initWebpEncodeForNode()]);
});

describe('memory and thumbnail optimisations', () => {
  it('downscales large outputs to <= 320px thumbnails while skipping small outputs', () => {
    const small = {
      width: 200,
      height: 150,
      data: new Uint8ClampedArray(200 * 150 * 4)
    };
    expect(downscaleForThumbnail(small)).toBeNull();

    const large = {
      width: 1200,
      height: 800,
      data: new Uint8ClampedArray(1200 * 800 * 4).fill(255)
    };
    const thumb = downscaleForThumbnail(large);
    expect(thumb).not.toBeNull();
    expect(thumb!.width).toBe(THUMBNAIL_MAX_PX);
    expect(thumb!.height).toBe(Math.round((800 * THUMBNAIL_MAX_PX) / 1200));
  });

  it('emits a compact WebP thumbnail alongside large pipeline outputs', async () => {
    const width = 640;
    const height = 640;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 16;
      pixels[i + 1] = 185;
      pixels[i + 2] = 129;
      pixels[i + 3] = 255;
    }

    const res = await runPipelineJob({
      id: 'big-1',
      input: {
        kind: 'raster',
        pixels: pixels.buffer,
        width,
        height,
        originalWidth: width,
        originalHeight: height,
        originalBytes: pixels.byteLength,
        format: 'png',
        notices: []
      },
      settings: {
        sizeMode: 'fixed',
        targetWidth: 640,
        targetHeight: 640,
        fit: 'fit',
        noEnlarge: true,
        background: { type: 'color', hex: '#ffffff' },
        qualityPreset: 'best',
        targetKb: 150
      }
    });

    expect(res.thumbnailBuffer).toBeDefined();
    const thumbInfo = inspectImage(new Uint8Array(res.thumbnailBuffer!));
    expect(thumbInfo.format).toBe('webp');
    expect(thumbInfo.width).toBeLessThanOrEqual(THUMBNAIL_MAX_PX);
    expect(thumbInfo.height).toBeLessThanOrEqual(THUMBNAIL_MAX_PX);
  });

  it('revokes compare URLs independently and revokes all URLs on item cleanup', () => {
    const origRevoke = URL.revokeObjectURL;
    const revoked: string[] = [];
    URL.revokeObjectURL = vi.fn((url: string) => revoked.push(url));

    try {
      const item: BatchItem = {
        id: '1',
        file: new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
        originalName: 'a.jpg',
        outputName: 'a.webp',
        originalBytes: 100,
        status: 'done',
        progress: 1,
        thumbnailUrl: 'blob:thumb',
        outputUrl: 'blob:full',
        originalUrl: 'blob:orig',
        notices: []
      };

      revokeCompareUrls(item);
      expect(revoked).toEqual(['blob:full', 'blob:orig']);
      expect(item.thumbnailUrl).toBe('blob:thumb');

      revokeItemUrls(item);
      expect(revoked).toEqual(['blob:full', 'blob:orig', 'blob:thumb']);
      expect(item.thumbnailUrl).toBeUndefined();
    } finally {
      URL.revokeObjectURL = origRevoke;
    }
  });
});

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyOrientation,
  orientedDimensions,
  readExifOrientation
} from '../../src/lib/pipeline/orient';
import type { ExifOrientation, RawImageData } from '../../src/lib/pipeline/types';

function make2x3Grid(): RawImageData {
  // 2 columns x 3 rows, each pixel has a unique R value 1..6:
  // [1, 2]
  // [3, 4]
  // [5, 6]
  const data = new Uint8ClampedArray(2 * 3 * 4);
  for (let i = 0; i < 6; i++) {
    data[i * 4] = i + 1;
    data[i * 4 + 3] = 255;
  }
  return { width: 2, height: 3, data };
}

function readReds(img: RawImageData): number[] {
  const out: number[] = [];
  for (let i = 0; i < img.width * img.height; i++) {
    out.push(img.data[i * 4]);
  }
  return out;
}

describe('orient', () => {
  it('reads EXIF orientation from rotated JPEG fixture', async () => {
    const bytes = new Uint8Array(
      await readFile(path.resolve(process.cwd(), 'tests/fixtures/exif-rotated.jpg'))
    );
    expect(readExifOrientation(bytes, 'jpeg')).toBe(6);
  });

  it('defaults to orientation 1 when EXIF is absent', async () => {
    const bytes = new Uint8Array(
      await readFile(path.resolve(process.cwd(), 'tests/fixtures/sample.jpg'))
    );
    expect(readExifOrientation(bytes, 'jpeg')).toBe(1);
  });

  it.each<[ExifOrientation, number, number, number[]]>([
    [1, 2, 3, [1, 2, 3, 4, 5, 6]],
    [2, 2, 3, [2, 1, 4, 3, 6, 5]],
    [3, 2, 3, [6, 5, 4, 3, 2, 1]],
    [4, 2, 3, [5, 6, 3, 4, 1, 2]],
    [5, 3, 2, [1, 3, 5, 2, 4, 6]],
    [6, 3, 2, [5, 3, 1, 6, 4, 2]],
    [7, 3, 2, [6, 4, 2, 5, 3, 1]],
    [8, 3, 2, [2, 4, 6, 1, 3, 5]]
  ])('transforms orientation %i to %ix%i correctly', (orientation, expW, expH, expected) => {
    const result = applyOrientation(make2x3Grid(), orientation);
    expect(orientedDimensions(2, 3, orientation)).toEqual({ width: expW, height: expH });
    expect(result.width).toBe(expW);
    expect(result.height).toBe(expH);
    expect(readReds(result)).toEqual(expected);
  });
});

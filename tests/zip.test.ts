import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { dedupeOutputNames } from '../src/lib/pipeline/names';
import { buildZipFilename, createStreamingZip, createStreamingZipBytes } from '../src/lib/zip';

describe('streaming STORE zip', () => {
  it('packages multiple WebP entries cleanly and preserves exact bytes and Unicode names', async () => {
    const rawNames = ['Product A.jpg', 'product a.png', 'قميص أبيض.jpg'];
    const names = dedupeOutputNames(rawNames);
    const payloads = [
      new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]),
      new Uint8Array([0x52, 0x49, 0x46, 0x46, 5, 6, 7, 8]),
      new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 10, 11, 12])
    ];

    const zipBytes = await createStreamingZipBytes(
      names.map((name, i) => ({ name, data: payloads[i] }))
    );

    // Local file header starts with PK\x03\x04
    expect(zipBytes[0]).toBe(0x50);
    expect(zipBytes[1]).toBe(0x4b);
    expect(zipBytes[2]).toBe(0x03);
    expect(zipBytes[3]).toBe(0x04);
    // Compression method at offset 8..9 must be 0 (STORE).
    expect(zipBytes[8] | (zipBytes[9] << 8)).toBe(0);

    const extracted = unzipSync(zipBytes);
    expect(Object.keys(extracted).sort()).toEqual([...names].sort());
    for (let i = 0; i < names.length; i++) {
      expect(extracted[names[i]]).toEqual(payloads[i]);
    }
  });

  it('streams Blob inputs and reports progress cleanly', async () => {
    const progressCalls: [number, number][] = [];
    const blob = await createStreamingZip(
      [
        { name: 'one.webp', data: new Blob([new Uint8Array([1, 2, 3])]) },
        { name: 'two.webp', data: new Blob([new Uint8Array([4, 5, 6, 7])]) }
      ],
      (done, total) => progressCalls.push([done, total])
    );

    expect(blob.type).toBe('application/zip');
    expect(progressCalls).toEqual([
      [1, 2],
      [2, 2]
    ]);

    const extracted = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(extracted['one.webp']).toEqual(new Uint8Array([1, 2, 3]));
    expect(extracted['two.webp']).toEqual(new Uint8Array([4, 5, 6, 7]));
  });

  it('formats a clean dated zip filename', () => {
    expect(buildZipFilename(new Date(2024, 11, 1))).toBe('productprep-2024-12-01.zip');
  });
});

import { describe, expect, it } from 'vitest';
import { dedupeOutputNames, slugifyStem, toOutputName } from '../../src/lib/pipeline/names';

describe('names (slugify & dedupe)', () => {
  it.each([
    ['Blue Running Shoe.JPG', 'blue-running-shoe.webp'],
    ['  My   Product___Photo (2024)!.png  ', 'my-product-photo-2024.webp'],
    ['قميص أبيض صيفي.jpg', 'قميص-أبيض-صيفي.webp'],
    ['Café Crème Mug.webp', 'café-crème-mug.webp'],
    ['商品 01.png', '商品-01.webp'],
    ['🔥🔥🔥.png', 'image.webp'],
    ['CON.jpg', 'con-file.webp'],
    ['photo.v2.final.jpeg', 'photo-v2-final.webp'],
    ['folder/sub/Sneaker #4.bmp', 'sneaker-4.webp']
  ])('normalises %s -> %s', (input, expected) => {
    expect(toOutputName(input)).toBe(expected);
  });

  it('truncates overly long names cleanly without trailing hyphens', () => {
    const longName = `${'product-photo-'.repeat(12)}final.jpg`;
    const stem = slugifyStem(longName);
    expect(Array.from(stem).length).toBeLessThanOrEqual(80);
    expect(stem.endsWith('-')).toBe(false);
  });

  it('deduplicates colliding names with -2, -3 suffixes case-insensitively', () => {
    const output = dedupeOutputNames([
      'White Tee.jpg',
      'white tee.png',
      'WHITE_TEE.webp',
      'قميص أبيض.jpg',
      'قميص أبيض.png',
      '🔥.png',
      '✨.jpg'
    ]);

    expect(output).toEqual([
      'white-tee.webp',
      'white-tee-2.webp',
      'white-tee-3.webp',
      'قميص-أبيض.webp',
      'قميص-أبيض-2.webp',
      'image.webp',
      'image-2.webp'
    ]);
  });
});

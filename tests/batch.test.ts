import { describe, expect, it } from 'vitest';
import {
  computeBatchStats,
  defaultWebpName,
  formatBatchSummary,
  formatSavingsLabel,
  savingsDeltaPercent,
  type BatchItem
} from '../src/lib/batch';

function makeItem(partial: Partial<BatchItem>): BatchItem {
  return {
    id: '1',
    file: new File(['a'], 'product.jpg', { type: 'image/jpeg' }),
    originalName: 'product.jpg',
    outputName: 'product.webp',
    originalBytes: 100_000,
    status: 'done',
    progress: 1,
    outputBytes: 13_000,
    notices: [],
    ...partial
  };
}

describe('batch helpers', () => {
  it('computes savings percentage for smaller, equal, and larger WebP outputs', () => {
    expect(savingsDeltaPercent(100_000, 13_000)).toBe(-87);
    expect(formatSavingsLabel(100_000, 13_000)).toEqual({ label: '-87%', isSmaller: true });
    expect(formatSavingsLabel(10_000, 11_200)).toEqual({ label: '+12%', isSmaller: false });
    expect(formatSavingsLabel(10_000, 10_000)).toEqual({ label: '0%', isSmaller: false });
  });

  it('aggregates batch stats and formats the summary line cleanly', () => {
    const items: BatchItem[] = [
      makeItem({ id: '1', originalBytes: 1_000_000, outputBytes: 100_000, status: 'done' }),
      makeItem({ id: '2', originalBytes: 1_000_000, outputBytes: 100_000, status: 'done' }),
      makeItem({ id: '3', originalBytes: 500_000, outputBytes: undefined, status: 'working' })
    ];

    const stats = computeBatchStats(items);
    expect(stats).toMatchObject({
      total: 3,
      doneCount: 2,
      workingCount: 1,
      queuedCount: 0,
      errorCount: 0,
      totalOriginalBytes: 2_000_000,
      totalOutputBytes: 200_000,
      isProcessing: true
    });

    const summary = formatBatchSummary(stats);
    expect(summary).toContain('2 of 3 done');
    expect(summary).toContain('-90%');
  });

  it('builds default .webp filenames from original names', () => {
    expect(defaultWebpName('Blue Shirt.PNG')).toBe('Blue Shirt.webp');
    expect(defaultWebpName('noext')).toBe('noext.webp');
  });
});

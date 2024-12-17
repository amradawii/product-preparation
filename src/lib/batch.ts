import { formatBytes } from './settings';
import type { WorkerStage } from './worker/protocol';

export type ItemStatus = 'queued' | 'working' | 'done' | 'error';

export interface BatchItem {
  id: string;
  file: File;
  originalName: string;
  outputName: string;
  originalBytes: number;
  status: ItemStatus;
  stage?: WorkerStage;
  progress: number;
  originalUrl?: string;
  outputBlob?: Blob;
  thumbnailUrl?: string;
  outputUrl?: string;
  outputBytes?: number;
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
  notices: string[];
  error?: string;
}

export interface BatchStats {
  total: number;
  doneCount: number;
  workingCount: number;
  queuedCount: number;
  errorCount: number;
  totalOriginalBytes: number;
  totalOutputBytes: number;
  isProcessing: boolean;
}

export function defaultWebpName(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, '').trim() || 'image';
  return `${base}.webp`;
}

export function savingsDeltaPercent(originalBytes: number, outputBytes: number): number {
  if (originalBytes <= 0) return 0;
  return Math.round(((outputBytes - originalBytes) / originalBytes) * 100);
}

export function formatSavingsLabel(
  originalBytes: number,
  outputBytes: number
): { label: string; isSmaller: boolean } {
  const delta = savingsDeltaPercent(originalBytes, outputBytes);
  if (delta < 0) {
    return { label: `${delta}%`, isSmaller: true };
  }
  if (delta > 0) {
    return { label: `+${delta}%`, isSmaller: false };
  }
  return { label: '0%', isSmaller: false };
}

export function computeBatchStats(items: readonly BatchItem[]): BatchStats {
  let doneCount = 0;
  let workingCount = 0;
  let queuedCount = 0;
  let errorCount = 0;
  let totalOriginalBytes = 0;
  let totalOutputBytes = 0;

  for (const item of items) {
    if (item.status === 'done') {
      doneCount++;
      totalOriginalBytes += item.originalBytes;
      totalOutputBytes += item.outputBytes ?? 0;
    } else if (item.status === 'working') {
      workingCount++;
    } else if (item.status === 'queued') {
      queuedCount++;
    } else if (item.status === 'error') {
      errorCount++;
    }
  }

  return {
    total: items.length,
    doneCount,
    workingCount,
    queuedCount,
    errorCount,
    totalOriginalBytes,
    totalOutputBytes,
    isProcessing: workingCount + queuedCount > 0
  };
}

export function formatBatchSummary(stats: BatchStats): string {
  const countPart = `${stats.doneCount} of ${stats.total} done`;
  if (stats.doneCount === 0) {
    if (stats.isProcessing) {
      return `Processing ${stats.total} ${stats.total === 1 ? 'image' : 'images'}...`;
    }
    if (stats.errorCount > 0) {
      return `${stats.errorCount} of ${stats.total} failed`;
    }
    return countPart;
  }

  const savings = formatSavingsLabel(stats.totalOriginalBytes, stats.totalOutputBytes);
  const failedPart = stats.errorCount > 0 ? ` · ${stats.errorCount} failed` : '';
  return `${countPart}${failedPart} · ${formatBytes(stats.totalOriginalBytes)} → ${formatBytes(stats.totalOutputBytes)} (${savings.label})`;
}

export function revokeCompareUrls(item: BatchItem): void {
  if (item.outputUrl) {
    URL.revokeObjectURL(item.outputUrl);
    item.outputUrl = undefined;
  }
  if (item.originalUrl) {
    URL.revokeObjectURL(item.originalUrl);
    item.originalUrl = undefined;
  }
}

export function revokeItemUrls(item: BatchItem): void {
  if (item.thumbnailUrl) {
    URL.revokeObjectURL(item.thumbnailUrl);
    item.thumbnailUrl = undefined;
  }
  revokeCompareUrls(item);
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

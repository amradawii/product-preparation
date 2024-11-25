// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import '@testing-library/svelte/vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { BatchItem, BatchStats } from '../../src/lib/batch';
import BatchBar from '../../src/lib/ui/BatchBar.svelte';
import CompareSlider from '../../src/lib/ui/CompareSlider.svelte';
import ResultCard from '../../src/lib/ui/ResultCard.svelte';

function makeDoneItem(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    id: 'img-1',
    file: new File(['raw'], 'mug.jpg', { type: 'image/jpeg' }),
    originalName: 'mug.jpg',
    outputName: 'mug.webp',
    originalBytes: 100 * 1024,
    outputBytes: 13 * 1024,
    width: 800,
    height: 800,
    originalWidth: 1600,
    originalHeight: 1200,
    status: 'done',
    progress: 1,
    originalUrl: 'blob:before',
    outputUrl: 'blob:after',
    outputBlob: new Blob(['webp'], { type: 'image/webp' }),
    notices: [],
    ...overrides
  };
}

describe('ResultCard', () => {
  it('shows filename, size savings, dimensions, notices, and triggers download and compare', async () => {
    const item = makeDoneItem({ notices: ['Animated GIF: first frame used'] });
    const onCompare = vi.fn();
    const onDownload = vi.fn();
    const onRemove = vi.fn();

    render(ResultCard, { props: { item, onCompare, onDownload, onRemove } });

    expect(screen.getByText('mug.webp')).toBeInTheDocument();
    expect(screen.getByText(/100 KB → 13 KB/)).toBeInTheDocument();
    expect(screen.getByText('-87%')).toBeInTheDocument();
    expect(screen.getByText('800 × 800 px')).toBeInTheDocument();
    expect(screen.getByText('Animated GIF: first frame used')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalledWith(item);

    await fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(onCompare).toHaveBeenCalledWith(item);
  });

  it('shows an error card with a clear one-line reason', () => {
    const item = makeDoneItem({
      status: 'error',
      outputUrl: undefined,
      outputBytes: undefined,
      error: 'Could not decode this image; the file appears to be damaged.'
    });

    render(ResultCard, {
      props: { item, onCompare: vi.fn(), onDownload: vi.fn(), onRemove: vi.fn() }
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/damaged/i);
  });
});

describe('CompareSlider', () => {
  it('supports keyboard adjustment (arrows, Home, End) and closes on Escape', async () => {
    const item = makeDoneItem();
    const onClose = vi.fn();
    const onDownload = vi.fn();

    render(CompareSlider, { props: { item, onClose, onDownload } });

    const slider = screen.getByRole('slider', { name: /split position/i });
    expect(slider).toHaveAttribute('aria-valuenow', '50');

    await fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '55');

    await fireEvent.keyDown(slider, { key: 'ArrowLeft', shiftKey: true });
    expect(slider).toHaveAttribute('aria-valuenow', '54');

    await fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');

    await fireEvent.keyDown(slider, { key: 'End' });
    expect(slider).toHaveAttribute('aria-valuenow', '100');

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('BatchBar', () => {
  it('shows totals, Cancel while processing, and Clear', async () => {
    const stats: BatchStats = {
      total: 4,
      doneCount: 2,
      workingCount: 1,
      queuedCount: 1,
      errorCount: 0,
      totalOriginalBytes: 2 * 1024 * 1024,
      totalOutputBytes: 200 * 1024,
      isProcessing: true
    };
    const onCancelAll = vi.fn();
    const onClear = vi.fn();

    render(BatchBar, { props: { stats, onCancelAll, onClear } });

    expect(screen.getByText(/2 of 4 done/)).toBeInTheDocument();
    expect(screen.getByText(/-90%/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancelAll).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});

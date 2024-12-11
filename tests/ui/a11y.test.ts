// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import '@testing-library/svelte/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRequest, WorkerResponse } from '../../src/lib/worker/protocol';
import Page from '../../src/routes/+page.svelte';

class InstantMockWorker {
  private messageListeners = new Set<(e: MessageEvent<WorkerResponse>) => void>();

  postMessage(message: WorkerRequest): void {
    const out = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]).buffer;
    setTimeout(() => {
      const done: WorkerResponse = {
        type: 'done',
        id: message.id,
        outputBuffer: out,
        width: message.settings.targetWidth,
        height: message.settings.targetHeight,
        originalWidth: 1200,
        originalHeight: 900,
        originalBytes: 240_000,
        outputBytes: 24_000,
        quality: 82,
        lossless: false,
        format: 'jpeg',
        notices: []
      };
      for (const fn of this.messageListeners) {
        fn({ data: done } as MessageEvent<WorkerResponse>);
      }
    }, 5);
  }

  terminate(): void {}

  addEventListener(type: string, listener: (e: MessageEvent<WorkerResponse>) => void): void {
    if (type === 'message') this.messageListeners.add(listener);
  }

  removeEventListener(type: string, listener: (e: MessageEvent<WorkerResponse>) => void): void {
    if (type === 'message') this.messageListeners.delete(listener);
  }
}

const origWorker = globalThis.Worker;
const origCreateObjectURL = URL.createObjectURL;
const origRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  localStorage.clear();
  (globalThis as unknown as { Worker: unknown }).Worker = InstantMockWorker;
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  (globalThis as unknown as { Worker: unknown }).Worker = origWorker;
  URL.createObjectURL = origCreateObjectURL;
  URL.revokeObjectURL = origRevokeObjectURL;
});

function makeJsdomFile(bytes: Uint8Array, name: string, type: string): File {
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.slice().buffer
  });
  return file;
}

describe('keyboard-only batch workflow and accessibility', () => {
  it('completes a batch, announces status via aria-live, opens Compare with focus management, and clears cleanly', async () => {
    render(Page);

    // Every primary control has an accessible label and skip link exists.
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument();
    expect(screen.getByLabelText('Size')).toBeInTheDocument();
    expect(screen.getByLabelText('Fit')).toBeInTheDocument();
    expect(screen.getByLabelText('Background')).toBeInTheDocument();
    expect(screen.getByLabelText('Quality')).toBeInTheDocument();
    expect(screen.getByLabelText("Don't enlarge small images")).toBeInTheDocument();

    // Add two files through the accessible file input.
    const input = screen.getByLabelText('Choose images to convert') as HTMLInputElement;
    const f1 = makeJsdomFile(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]),
      'Mug Shot.jpg',
      'image/jpeg'
    );
    const f2 = makeJsdomFile(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 3, 4]),
      'Mug Shot.png',
      'image/png'
    );
    await fireEvent.change(input, { target: { files: [f1, f2] } });

    // Wait for both items to finish with deduped clean names and live status announcement.
    await waitFor(() => {
      expect(screen.getByText('mug-shot.webp')).toBeInTheDocument();
      expect(screen.getByText('mug-shot-2.webp')).toBeInTheDocument();
      expect(screen.getByText(/2 of 2 done/)).toBeInTheDocument();
    });

    const liveStatus = screen.getByRole('status');
    expect(liveStatus).toHaveTextContent(/All 2 images are ready/i);

    // Open CompareSlider from a focused card trigger and verify focus moves to slider handle.
    const compareBtn = screen.getByRole('button', {
      name: 'Compare before and after for Mug Shot.jpg'
    });
    compareBtn.focus();
    await fireEvent.click(compareBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const slider = screen.getByRole('slider', { name: /split position/i });
    expect(document.activeElement).toBe(slider);

    // Adjust split using keyboard arrows.
    await fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '55');

    // Escape closes dialog and returns focus to trigger button.
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(compareBtn);

    // Download all (.zip) button is enabled and Clear resets the batch cleanly.
    expect(screen.getByRole('button', { name: 'Download all (.zip)' })).not.toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('mug-shot.webp')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Cleared all images/i);
  });
});

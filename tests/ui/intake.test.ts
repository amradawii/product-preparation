// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import '@testing-library/svelte/vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES } from '../../src/lib/pipeline/types';
import { STORAGE_KEY } from '../../src/lib/settings';
import Page from '../../src/routes/+page.svelte';

beforeEach(() => {
  localStorage.clear();
});

describe('drop zone and settings bar', () => {
  it('persists changed settings to localStorage and restores them on reload', async () => {
    const first = render(Page);

    const sizeSelect = screen.getByLabelText('Size') as HTMLSelectElement;
    const qualitySelect = screen.getByLabelText('Quality') as HTMLSelectElement;

    await fireEvent.change(sizeSelect, { target: { value: '1200' } });
    await fireEvent.change(qualitySelect, { target: { value: 'smaller' } });

    expect(localStorage.getItem(STORAGE_KEY)).toContain('"sizePreset":"1200"');
    expect(localStorage.getItem(STORAGE_KEY)).toContain('"qualityPreset":"smaller"');

    first.unmount();
    render(Page);

    expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('1200');
    expect((screen.getByLabelText('Quality') as HTMLSelectElement).value).toBe('smaller');
  });

  it('supports Custom Width x Height with square link on by default and unlockable for portraits', async () => {
    render(Page);

    await fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'custom' } });

    const widthInput = screen.getByLabelText('Custom width in pixels') as HTMLInputElement;
    const heightInput = screen.getByLabelText('Custom height in pixels') as HTMLInputElement;
    const squareBtn = screen.getByRole('button', { name: 'Keep square' });

    expect(squareBtn).toHaveAttribute('aria-pressed', 'true');

    await fireEvent.change(widthInput, { target: { value: '1000' } });
    expect(heightInput.value).toBe('1000');

    await fireEvent.click(squareBtn);
    expect(squareBtn).toHaveAttribute('aria-pressed', 'false');

    await fireEvent.change(widthInput, { target: { value: '1200' } });
    await fireEvent.change(heightInput, { target: { value: '1600' } });
    expect(widthInput.value).toBe('1200');
    expect(heightInput.value).toBe('1600');
  });

  it('disables Fit and Dont enlarge when Keep size is selected while keeping Background enabled', async () => {
    render(Page);

    await fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'keep' } });

    expect(screen.getByLabelText('Fit')).toBeDisabled();
    expect(screen.getByLabelText("Don't enlarge small images")).toBeDisabled();
    expect(screen.getByLabelText('Background')).not.toBeDisabled();
    expect(screen.getByText(/Original dimensions are kept/i)).toBeInTheDocument();
  });

  it('explains rejected oversized files while accepting valid files from the file input', async () => {
    render(Page);

    const input = screen.getByLabelText('Choose images to convert') as HTMLInputElement;
    const valid = new File([new Uint8Array([1, 2, 3, 4])], 'shoe.jpg', { type: 'image/jpeg' });
    const tooBig = new File(['x'], 'poster.png', { type: 'image/png' });
    Object.defineProperty(tooBig, 'size', { value: MAX_FILE_BYTES + 1024 });

    await fireEvent.change(input, { target: { files: [valid, tooBig] } });

    expect(screen.getByText(/poster\.png.*40 MB/i)).toBeInTheDocument();
    expect(screen.getByText(/1 image ready/i)).toBeInTheDocument();
  });

  it('accepts images pasted from the clipboard', async () => {
    render(Page);

    const pastedFile = new File([new Uint8Array([1, 2, 3, 4])], 'clip.png', { type: 'image/png' });
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => pastedFile
          }
        ],
        files: [pastedFile]
      }
    });

    window.dispatchEvent(pasteEvent);
    expect(await screen.findByText(/1 image ready/i)).toBeInTheDocument();
  });
});

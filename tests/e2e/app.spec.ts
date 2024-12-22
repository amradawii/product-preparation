import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { detectFormat, inspectImage } from '../../src/lib/pipeline/detect';
import { listWebpChunks } from '../../src/lib/pipeline/encode';

const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures');

function trackErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(String(err));
  });
  return errors;
}

test.describe('ProductPrep end-to-end', () => {
  test('converts 20 mixed-format files to exact 800x800 WebPs and exports a valid zip with 0 console errors', async ({
    page
  }) => {
    const errors = trackErrors(page);
    await page.goto('/');

    // 20 mixed files covering all 7 formats, edge cases, Unicode names, and duplicate names.
    const specs: Array<{ fixture: string; name: string; mime: string }> = [
      { fixture: 'sample.jpg', name: 'White Sneaker.jpg', mime: 'image/jpeg' },
      { fixture: 'sample.png', name: 'Glass Bottle.png', mime: 'image/png' },
      { fixture: 'sample.gif', name: 'Vintage Badge.gif', mime: 'image/gif' },
      { fixture: 'animated.gif', name: 'Spinner Icon.gif', mime: 'image/gif' },
      { fixture: 'sample.svg', name: 'Brand Mark.svg', mime: 'image/svg+xml' },
      { fixture: 'svg-viewbox-only.svg', name: 'Vector Tag.svg', mime: 'image/svg+xml' },
      { fixture: 'svg-with-script.svg', name: 'Safe Check.svg', mime: 'image/svg+xml' },
      { fixture: 'sample.bmp', name: 'Legacy Asset.bmp', mime: 'image/bmp' },
      { fixture: 'sample.webp', name: 'Existing WebP.webp', mime: 'image/webp' },
      { fixture: 'sample.avif', name: 'Modern Shot.avif', mime: 'image/avif' },
      { fixture: 'exif-rotated.jpg', name: 'Phone Portrait.jpg', mime: 'image/jpeg' },
      { fixture: 'renamed-jpeg.png', name: 'Actually Jpeg.png', mime: 'image/png' },
      { fixture: 'sample-16bit.png', name: 'Studio 16bit.png', mime: 'image/png' },
      { fixture: 'sample-cmyk.jpg', name: 'Print CMYK.jpg', mime: 'image/jpeg' },
      { fixture: 'sample.jpg', name: 'White Sneaker.png', mime: 'image/jpeg' },
      { fixture: 'sample.png', name: 'قميص أبيض.png', mime: 'image/png' },
      { fixture: 'sample.jpg', name: 'Café Mug.jpg', mime: 'image/jpeg' },
      { fixture: 'sample.bmp', name: 'Strap Detail.bmp', mime: 'image/bmp' },
      { fixture: 'sample.webp', name: 'Box Front.webp', mime: 'image/webp' },
      { fixture: 'sample.svg', name: 'Size Chart.svg', mime: 'image/svg+xml' }
    ];

    const payload = await Promise.all(
      specs.map(async (s) => ({
        name: s.name,
        mimeType: s.mime,
        buffer: await readFile(path.join(fixturesDir, s.fixture))
      }))
    );

    await page.locator('input[type="file"]').setInputFiles(payload);
    await expect(page.locator('footer')).toContainText('20 of 20 done', { timeout: 30_000 });

    // Confirm embedded SVG script never executed.
    const scriptRan = await page.evaluate(() =>
      Boolean((window as unknown as { __pwned?: boolean }).__pwned)
    );
    expect(scriptRan).toBe(false);

    // Confirm animated GIF notice appears.
    await expect(page.getByText('Animated GIF: first frame used')).toBeVisible();

    // Download the batch zip and inspect every entry inside.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download all (.zip)' }).click()
    ]);

    expect(download.suggestedFilename()).toMatch(/^productprep-\d{4}-\d{2}-\d{2}\.zip$/);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();

    const zipBytes = new Uint8Array(await readFile(downloadPath!));
    const entries = unzipSync(zipBytes);
    const names = Object.keys(entries);

    expect(names).toHaveLength(20);
    expect(names).toContain('white-sneaker.webp');
    expect(names).toContain('white-sneaker-2.webp');
    expect(names).toContain('قميص-أبيض.webp');

    for (const name of names) {
      expect(name.endsWith('.webp')).toBe(true);
      const data = entries[name];
      expect(detectFormat(data)).toBe('webp');
      const info = inspectImage(data);
      expect(info.width).toBe(800);
      expect(info.height).toBe(800);
      const chunks = listWebpChunks(data);
      expect(chunks).not.toContain('EXIF');
      expect(chunks).not.toContain('XMP ');
      expect(chunks).not.toContain('ICCP');
    }

    expect(errors).toEqual([]);
  });

  test('applies custom non-square dimensions, transparent background, and persists settings across reload', async ({
    page
  }) => {
    const errors = trackErrors(page);
    await page.goto('/');

    // Upload an image first with default 800x800 settings.
    await page.locator('input[type="file"]').setInputFiles(path.join(fixturesDir, 'sample.png'));
    await expect(page.locator('footer')).toContainText('1 of 1 done', { timeout: 20_000 });
    await expect(page.getByText('800 × 800 px')).toBeVisible();

    // Switch to Custom 300x400 (unlocking square) + Transparent background.
    await page.getByLabel('Size').selectOption('custom');
    await page.getByRole('button', { name: 'Keep square' }).click();
    await page.getByLabel('Custom width in pixels').fill('300');
    await page.getByLabel('Custom height in pixels').fill('400');
    await page.getByLabel('Background').selectOption('transparent');

    // Subtle "Apply to all images" button appears instead of auto re-running.
    const applyBtn = page.getByRole('button', { name: 'Apply to all images' });
    await expect(applyBtn).toBeVisible();
    await expect(page.getByText('800 × 800 px')).toBeVisible();

    await applyBtn.click();
    await expect(page.getByText('300 × 400 px')).toBeVisible({ timeout: 20_000 });

    // Settings persist after page reload.
    await page.reload();
    await expect(page.getByLabel('Size')).toHaveValue('custom');
    await expect(page.getByLabel('Custom width in pixels')).toHaveValue('300');
    await expect(page.getByLabel('Custom height in pixels')).toHaveValue('400');
    await expect(page.getByLabel('Background')).toHaveValue('transparent');

    expect(errors).toEqual([]);
  });

  test('isolates corrupt and invalid inputs with clear one-line errors', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');

    await page
      .locator('input[type="file"]')
      .setInputFiles([
        path.join(fixturesDir, 'sample.jpg'),
        path.join(fixturesDir, 'corrupt.jpg'),
        path.join(fixturesDir, 'svg-no-size.svg')
      ]);

    await expect(page.locator('footer')).toContainText('1 of 3 done · 2 failed', {
      timeout: 20_000
    });
    await expect(page.getByText(/no width, height, or viewBox/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('supports a complete keyboard-only flow including before/after slider and Escape close', async ({
    page
  }) => {
    const errors = trackErrors(page);
    await page.goto('/');

    // Tab to Size control and change to 1000x1000 via keyboard.
    const sizeSelect = page.getByLabel('Size');
    await sizeSelect.focus();
    await sizeSelect.selectOption('1000');

    // Upload a sample image and wait for completion.
    await page.locator('input[type="file"]').setInputFiles(path.join(fixturesDir, 'sample.jpg'));
    await expect(page.locator('footer')).toContainText('1 of 1 done', { timeout: 20_000 });

    // Focus the card's Compare button and open via Enter.
    const compareBtn = page.getByRole('button', {
      name: 'Compare before and after for sample.jpg'
    });
    await compareBtn.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const slider = page.getByRole('slider', { name: /split position/i });
    await expect(slider).toBeFocused();
    await expect(slider).toHaveAttribute('aria-valuenow', '50');

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuenow', '60');

    await page.keyboard.press('Home');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(compareBtn).toBeFocused();

    // Clear batch via keyboard.
    const clearBtn = page.getByRole('button', { name: 'Clear' });
    await clearBtn.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('footer')).not.toBeVisible();

    expect(errors).toEqual([]);
  });
});

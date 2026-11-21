import { describe, expect, it } from 'vitest';
import { MAX_FILES, MAX_FILE_BYTES } from '../src/lib/pipeline/types';
import {
  DEFAULT_SETTINGS,
  formatBytes,
  loadSettings,
  saveSettings,
  settingsEqual,
  STORAGE_KEY,
  toProcessSettings,
  validateIncomingFiles,
  type UserSettings
} from '../src/lib/settings';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    }
  };
}

function makeFakeFile(name: string, sizeBytes: number, type = 'image/jpeg'): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

describe('settings persistence and conversion', () => {
  it('returns sensible defaults when storage is empty or corrupt', () => {
    const store = createMemoryStorage();
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);

    store.setItem(STORAGE_KEY, '{not valid json');
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it('persists and restores customised settings', () => {
    const store = createMemoryStorage();
    const custom: UserSettings = {
      ...DEFAULT_SETTINGS,
      sizePreset: 'custom',
      customWidth: 1200,
      customHeight: 1600,
      lockSquare: false,
      fit: 'fill',
      backgroundPreset: 'custom',
      backgroundColor: '#f5f5f4',
      qualityPreset: 'target',
      customQuality: 85,
      targetKb: 120,
      noEnlarge: false
    };

    saveSettings(custom, store);
    expect(loadSettings(store)).toEqual(custom);

    const proc = toProcessSettings(custom);
    expect(proc).toEqual({
      sizeMode: 'fixed',
      targetWidth: 1200,
      targetHeight: 1600,
      fit: 'fill',
      noEnlarge: false,
      background: { type: 'color', hex: '#f5f5f4' },
      qualityPreset: 'target',
      customQuality: 85,
      targetKb: 120
    });
  });

  it('compares effective processing settings cleanly', () => {
    expect(settingsEqual(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toBe(true);
    expect(settingsEqual(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, sizePreset: '1000' })).toBe(
      false
    );
    expect(
      settingsEqual(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, backgroundPreset: 'transparent' })
    ).toBe(false);
    expect(
      settingsEqual(
        { ...DEFAULT_SETTINGS, qualityPreset: 'custom', customQuality: 90 },
        { ...DEFAULT_SETTINGS, qualityPreset: 'custom', customQuality: 60 }
      )
    ).toBe(false);
  });

  it('formats byte sizes cleanly', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(150 * 1024)).toBe('150 KB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.50 MB');
  });
});

describe('validateIncomingFiles', () => {
  it('explains oversized (>40 MB) and empty files while accepting valid ones', () => {
    const files = [
      makeFakeFile('good.jpg', 250_000),
      makeFakeFile('huge.png', MAX_FILE_BYTES + 1024),
      makeFakeFile('empty.jpg', 0)
    ];

    const res = validateIncomingFiles(files, 0);
    expect(res.accepted.map((f) => f.name)).toEqual(['good.jpg']);
    expect(res.rejections).toHaveLength(2);
    expect(res.rejections[0].reason).toMatch(/40 MB/i);
    expect(res.rejections[1].reason).toMatch(/empty/i);
  });

  it('enforces the 200-file batch cap with a clear summary message', () => {
    const files = Array.from({ length: 5 }, (_, i) => makeFakeFile(`img-${i}.jpg`, 10_000));
    const res = validateIncomingFiles(files, MAX_FILES - 2);

    expect(res.accepted).toHaveLength(2);
    expect(res.rejections).toHaveLength(1);
    expect(res.rejections[0].reason).toMatch(/200 files/i);
    expect(res.rejections[0].reason).toMatch(/3 extra files/i);
  });
});

import type { FitMode } from './pipeline/geometry';
import type { BackgroundOption } from './pipeline/resize';
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  TARGET_SIZE_DEFAULT_KB,
  type QualityPreset
} from './pipeline/types';
import type { ProcessSettings } from './worker/protocol';

export type SizePreset = '800' | '1000' | '1200' | '2000' | 'custom' | 'keep';
export type BackgroundPreset = 'white' | 'custom' | 'transparent';

export interface UserSettings {
  sizePreset: SizePreset;
  customWidth: number;
  customHeight: number;
  lockSquare: boolean;
  fit: FitMode;
  backgroundPreset: BackgroundPreset;
  backgroundColor: string;
  qualityPreset: QualityPreset;
  targetKb: number;
  noEnlarge: boolean;
}

export const STORAGE_KEY = 'productprep.settings.v1';

export const MIN_CUSTOM_DIMENSION = 16;
export const MAX_CUSTOM_DIMENSION = 10000;
export const MIN_TARGET_KB = 10;
export const MAX_TARGET_KB = 5000;

export const DEFAULT_SETTINGS: UserSettings = {
  sizePreset: '800',
  customWidth: 800,
  customHeight: 800,
  lockSquare: true,
  fit: 'fit',
  backgroundPreset: 'white',
  backgroundColor: '#f4f4f5',
  qualityPreset: 'best',
  targetKb: TARGET_SIZE_DEFAULT_KB,
  noEnlarge: true
};

const VALID_SIZE_PRESETS = new Set<SizePreset>(['800', '1000', '1200', '2000', 'custom', 'keep']);
const VALID_FIT_MODES = new Set<FitMode>(['fit', 'fill']);
const VALID_BG_PRESETS = new Set<BackgroundPreset>(['white', 'custom', 'transparent']);
const VALID_QUALITY_PRESETS = new Set<QualityPreset>(['best', 'smaller', 'lossless', 'target']);

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function sanitizeHex(value: unknown, fallback: string): string {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())) {
    return value.trim().toLowerCase();
  }
  return fallback;
}

export function sanitizeSettings(raw: unknown): UserSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }
  const obj = raw as Record<string, unknown>;
  const lockSquare =
    typeof obj.lockSquare === 'boolean' ? obj.lockSquare : DEFAULT_SETTINGS.lockSquare;
  const customWidth = clampInt(
    obj.customWidth,
    MIN_CUSTOM_DIMENSION,
    MAX_CUSTOM_DIMENSION,
    DEFAULT_SETTINGS.customWidth
  );
  const customHeight = lockSquare
    ? customWidth
    : clampInt(
        obj.customHeight,
        MIN_CUSTOM_DIMENSION,
        MAX_CUSTOM_DIMENSION,
        DEFAULT_SETTINGS.customHeight
      );

  return {
    sizePreset: VALID_SIZE_PRESETS.has(obj.sizePreset as SizePreset)
      ? (obj.sizePreset as SizePreset)
      : DEFAULT_SETTINGS.sizePreset,
    customWidth,
    customHeight,
    lockSquare,
    fit: VALID_FIT_MODES.has(obj.fit as FitMode) ? (obj.fit as FitMode) : DEFAULT_SETTINGS.fit,
    backgroundPreset: VALID_BG_PRESETS.has(obj.backgroundPreset as BackgroundPreset)
      ? (obj.backgroundPreset as BackgroundPreset)
      : DEFAULT_SETTINGS.backgroundPreset,
    backgroundColor: sanitizeHex(obj.backgroundColor, DEFAULT_SETTINGS.backgroundColor),
    qualityPreset: VALID_QUALITY_PRESETS.has(obj.qualityPreset as QualityPreset)
      ? (obj.qualityPreset as QualityPreset)
      : DEFAULT_SETTINGS.qualityPreset,
    targetKb: clampInt(obj.targetKb, MIN_TARGET_KB, MAX_TARGET_KB, DEFAULT_SETTINGS.targetKb),
    noEnlarge: typeof obj.noEnlarge === 'boolean' ? obj.noEnlarge : DEFAULT_SETTINGS.noEnlarge
  };
}

export function loadSettings(storage?: Pick<Storage, 'getItem'>): UserSettings {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store) return { ...DEFAULT_SETTINGS };
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: UserSettings, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store) return;
    store.setItem(STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
  } catch {
    // Ignore storage quota or private-mode errors gracefully.
  }
}

export function toProcessSettings(settings: UserSettings): ProcessSettings {
  let targetWidth = 800;
  let targetHeight = 800;
  const sizeMode = settings.sizePreset === 'keep' ? 'keep' : 'fixed';

  if (settings.sizePreset === 'custom') {
    targetWidth = clampInt(
      settings.customWidth,
      MIN_CUSTOM_DIMENSION,
      MAX_CUSTOM_DIMENSION,
      DEFAULT_SETTINGS.customWidth
    );
    targetHeight = settings.lockSquare
      ? targetWidth
      : clampInt(
          settings.customHeight,
          MIN_CUSTOM_DIMENSION,
          MAX_CUSTOM_DIMENSION,
          DEFAULT_SETTINGS.customHeight
        );
  } else if (settings.sizePreset !== 'keep') {
    const px = Number.parseInt(settings.sizePreset, 10);
    targetWidth = px;
    targetHeight = px;
  }

  let background: BackgroundOption;
  if (settings.backgroundPreset === 'transparent') {
    background = { type: 'transparent' };
  } else if (settings.backgroundPreset === 'custom') {
    background = {
      type: 'color',
      hex: sanitizeHex(settings.backgroundColor, DEFAULT_SETTINGS.backgroundColor)
    };
  } else {
    background = { type: 'color', hex: '#ffffff' };
  }

  return {
    sizeMode,
    targetWidth,
    targetHeight,
    fit: settings.fit,
    noEnlarge: settings.noEnlarge,
    background,
    qualityPreset: settings.qualityPreset,
    targetKb: clampInt(settings.targetKb, MIN_TARGET_KB, MAX_TARGET_KB, DEFAULT_SETTINGS.targetKb)
  };
}

export function settingsEqual(a: UserSettings, b: UserSettings): boolean {
  const pa = toProcessSettings(a);
  const pb = toProcessSettings(b);
  const bgSame =
    pa.background.type === pb.background.type &&
    (pa.background.type === 'transparent' ||
      (pb.background.type === 'color' && pa.background.hex === pb.background.hex));

  return (
    pa.sizeMode === pb.sizeMode &&
    pa.targetWidth === pb.targetWidth &&
    pa.targetHeight === pb.targetHeight &&
    pa.fit === pb.fit &&
    pa.noEnlarge === pb.noEnlarge &&
    bgSame &&
    pa.qualityPreset === pb.qualityPreset &&
    (pa.qualityPreset !== 'target' || pa.targetKb === pb.targetKb)
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
}

export interface FileRejection {
  name: string;
  reason: string;
}

export interface FileValidationResult {
  accepted: File[];
  rejections: FileRejection[];
}

export function validateIncomingFiles(
  incoming: readonly File[],
  currentCount: number
): FileValidationResult {
  const accepted: File[] = [];
  const rejections: FileRejection[] = [];
  let remaining = Math.max(0, MAX_FILES - currentCount);

  if (remaining === 0 && incoming.length > 0) {
    rejections.push({
      name: 'Batch limit',
      reason: `Batch is full (${MAX_FILES} files maximum). Clear some images to add more.`
    });
    return { accepted, rejections };
  }

  let skippedForLimit = 0;

  for (const file of incoming) {
    if (file.size === 0) {
      rejections.push({
        name: file.name || 'Unnamed file',
        reason: `${file.name || 'This file'} is empty.`
      });
      continue;
    }

    if (file.size > MAX_FILE_BYTES) {
      rejections.push({
        name: file.name,
        reason: `${file.name} is ${formatBytes(file.size)}, above the 40 MB per-file limit.`
      });
      continue;
    }

    if (remaining <= 0) {
      skippedForLimit++;
      continue;
    }

    accepted.push(file);
    remaining--;
  }

  if (skippedForLimit > 0) {
    const noun = skippedForLimit === 1 ? 'file was' : 'files were';
    rejections.push({
      name: 'Batch limit',
      reason: `Batch limit is ${MAX_FILES} files. ${skippedForLimit} extra ${noun} skipped.`
    });
  }

  return { accepted, rejections };
}

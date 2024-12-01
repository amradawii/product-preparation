const DEFAULT_MAX_STEM_LENGTH = 80;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function stripExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const trimmed = base.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot > 0) {
    return trimmed.slice(0, dot);
  }
  return trimmed;
}

function truncateCodePoints(str: string, maxLength: number): string {
  const chars = Array.from(str);
  if (chars.length <= maxLength) return str;
  return chars.slice(0, maxLength).join('');
}

/**
 * Produces a clean, URL- and filesystem-safe file stem:
 * - lowercased, hyphen-separated
 * - preserves Unicode letters and digits (Arabic, Latin accented, CJK, etc.)
 * - strips spaces, emojis, punctuation, and unsafe path characters
 */
export function slugifyStem(rawName: string, maxLength = DEFAULT_MAX_STEM_LENGTH): string {
  const stem = stripExtension(rawName).normalize('NFC').toLowerCase();

  let slug = stem.replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');

  if (slug.length > maxLength) {
    slug = truncateCodePoints(slug, maxLength).replace(/-+$/g, '');
  }

  if (!slug) {
    return 'image';
  }

  if (WINDOWS_RESERVED.test(slug)) {
    slug = `${slug}-file`;
  }

  return slug;
}

export function toOutputName(
  originalName: string,
  maxStemLength = DEFAULT_MAX_STEM_LENGTH
): string {
  return `${slugifyStem(originalName, maxStemLength)}.webp`;
}

/**
 * Assigns a clean, unique `.webp` filename and registers it in `usedLower`
 * (case-insensitive set so Windows/macOS zip extractions never collide).
 */
export function assignUniqueName(
  originalName: string,
  usedLower: Set<string>,
  maxStemLength = DEFAULT_MAX_STEM_LENGTH
): string {
  const stem = slugifyStem(originalName, maxStemLength);
  let candidate = `${stem}.webp`;

  if (!usedLower.has(candidate.toLowerCase())) {
    usedLower.add(candidate.toLowerCase());
    return candidate;
  }

  let n = 2;
  while (true) {
    const suffix = `-${n}`;
    const trimmedStem = truncateCodePoints(
      stem,
      Math.max(1, maxStemLength - suffix.length)
    ).replace(/-+$/g, '');
    candidate = `${trimmedStem || 'image'}${suffix}.webp`;
    if (!usedLower.has(candidate.toLowerCase())) {
      usedLower.add(candidate.toLowerCase());
      return candidate;
    }
    n++;
  }
}

export function dedupeOutputNames(
  originalNames: readonly string[],
  maxStemLength = DEFAULT_MAX_STEM_LENGTH
): string[] {
  const used = new Set<string>();
  return originalNames.map((name) => assignUniqueName(name, used, maxStemLength));
}

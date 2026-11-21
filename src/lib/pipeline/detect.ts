import {
  MAX_FILE_BYTES,
  MAX_MEGAPIXELS,
  MAX_PIXELS,
  PipelineError,
  type ImageFormat,
  type ImageInfo
} from './types';

function readUint16BE(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}

function readUint16LE(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function readUint32BE(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function readUint32LE(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function readInt32LE(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
}

function readAscii(b: Uint8Array, start: number, len: number): string {
  let s = '';
  const end = Math.min(b.length, start + len);
  for (let i = start; i < end; i++) {
    s += String.fromCharCode(b[i]);
  }
  return s;
}

function isAvifBrand(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (readAscii(bytes, 4, 4) !== 'ftyp') return false;
  const boxSize = Math.min(readUint32BE(bytes, 0), bytes.length);
  if (boxSize < 12) return false;

  const major = readAscii(bytes, 8, 4);
  if (major === 'avif' || major === 'avis') return true;

  for (let pos = 16; pos + 4 <= boxSize; pos += 4) {
    const brand = readAscii(bytes, pos, 4);
    if (brand === 'avif' || brand === 'avis') return true;
  }
  return false;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const sampleLen = Math.min(bytes.length, 4096);
  if (sampleLen < 4) return false;

  // Reject obvious binary files containing NUL bytes in the leading snippet.
  for (let i = 0; i < sampleLen; i++) {
    if (bytes[i] === 0) return false;
  }

  let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, sampleLen));
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('<')) return false;

  return /<svg(?:\s|>|\/|$)/i.test(trimmed);
}

export function detectFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 4) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }

  // GIF: GIF87a or GIF89a
  if (bytes.length >= 6) {
    const sig = readAscii(bytes, 0, 6);
    if (sig === 'GIF87a' || sig === 'GIF89a') {
      return 'gif';
    }
  }

  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    readAscii(bytes, 0, 4) === 'RIFF' &&
    readAscii(bytes, 8, 4) === 'WEBP'
  ) {
    return 'webp';
  }

  // AVIF: ISO BMFF ftyp box with avif/avis brand
  if (isAvifBrand(bytes)) {
    return 'avif';
  }

  // BMP: BM + valid DIB header size
  if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const dibSize = readUint32LE(bytes, 14);
    if (
      dibSize === 12 ||
      dibSize === 40 ||
      dibSize === 52 ||
      dibSize === 56 ||
      dibSize === 108 ||
      dibSize === 124
    ) {
      return 'bmp';
    }
  }

  // SVG: XML/text starting with <svg (or XML prolog/comments before <svg)
  if (looksLikeSvg(bytes)) {
    return 'svg';
  }

  return null;
}

function inspectPng(bytes: Uint8Array): ImageInfo {
  if (bytes.length < 26 || readAscii(bytes, 12, 4) !== 'IHDR') {
    throw new PipelineError('CORRUPT_IMAGE', 'This PNG file has a damaged header.');
  }
  const ihdrLen = readUint32BE(bytes, 8);
  if (ihdrLen !== 13) {
    throw new PipelineError('CORRUPT_IMAGE', 'This PNG file has an invalid IHDR chunk.');
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  const bitDepth = bytes[24];
  if (width === 0 || height === 0) {
    throw new PipelineError('CORRUPT_IMAGE', 'This PNG file has invalid dimensions.');
  }
  return { format: 'png', width, height, animated: false, bitDepth };
}

function inspectJpeg(bytes: Uint8Array): ImageInfo {
  let pos = 2;
  let width = 0;
  let height = 0;
  let components = 0;

  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) break;

    const marker = bytes[pos++];
    if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    if (pos + 2 > bytes.length) break;
    const segLen = readUint16BE(bytes, pos);
    if (segLen < 2 || pos + segLen > bytes.length) {
      throw new PipelineError('CORRUPT_IMAGE', 'This JPEG file is truncated or damaged.');
    }

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSof && segLen >= 8) {
      height = readUint16BE(bytes, pos + 3);
      width = readUint16BE(bytes, pos + 5);
      components = bytes[pos + 7];
      break;
    }

    pos += segLen;
  }

  if (width === 0 || height === 0) {
    throw new PipelineError('CORRUPT_IMAGE', 'This JPEG file is missing image dimensions.');
  }

  return {
    format: 'jpeg',
    width,
    height,
    animated: false,
    isCmyk: components === 4
  };
}

function inspectGif(bytes: Uint8Array): ImageInfo {
  if (bytes.length < 13) {
    throw new PipelineError('CORRUPT_IMAGE', 'This GIF file has a damaged header.');
  }
  const width = readUint16LE(bytes, 6);
  const height = readUint16LE(bytes, 8);
  if (width === 0 || height === 0) {
    throw new PipelineError('CORRUPT_IMAGE', 'This GIF file has invalid dimensions.');
  }

  let pos = 13;
  const packed = bytes[10];
  if ((packed & 0x80) !== 0) {
    const gctSize = 3 * (1 << ((packed & 0x07) + 1));
    pos += gctSize;
  }

  let frameCount = 0;
  while (pos < bytes.length && frameCount < 2) {
    const introducer = bytes[pos++];
    if (introducer === 0x3b) break; // Trailer
    if (introducer === 0x21) {
      // Extension block
      if (pos >= bytes.length) break;
      pos++; // label
      while (pos < bytes.length) {
        const subLen = bytes[pos++];
        if (subLen === 0) break;
        pos += subLen;
      }
    } else if (introducer === 0x2c) {
      // Image descriptor
      frameCount++;
      if (pos + 9 > bytes.length) break;
      const localPacked = bytes[pos + 8];
      pos += 9;
      if ((localPacked & 0x80) !== 0) {
        pos += 3 * (1 << ((localPacked & 0x07) + 1));
      }
      if (pos >= bytes.length) break;
      pos++; // LZW minimum code size
      while (pos < bytes.length) {
        const subLen = bytes[pos++];
        if (subLen === 0) break;
        pos += subLen;
      }
    } else {
      break;
    }
  }

  return {
    format: 'gif',
    width,
    height,
    animated: frameCount > 1
  };
}

function inspectBmp(bytes: Uint8Array): ImageInfo {
  if (bytes.length < 26) {
    throw new PipelineError('CORRUPT_IMAGE', 'This BMP file has a damaged header.');
  }
  const dibSize = readUint32LE(bytes, 14);
  let width: number;
  let height: number;
  if (dibSize === 12) {
    width = readUint16LE(bytes, 18);
    height = readUint16LE(bytes, 20);
  } else {
    width = readInt32LE(bytes, 18);
    height = Math.abs(readInt32LE(bytes, 22));
  }
  if (width <= 0 || height <= 0) {
    throw new PipelineError('CORRUPT_IMAGE', 'This BMP file has invalid dimensions.');
  }
  return { format: 'bmp', width, height, animated: false };
}

function inspectWebp(bytes: Uint8Array): ImageInfo {
  if (bytes.length < 30) {
    throw new PipelineError('CORRUPT_IMAGE', 'This WebP file has a damaged header.');
  }
  const chunk = readAscii(bytes, 12, 4);

  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      throw new PipelineError('CORRUPT_IMAGE', 'This WebP file has an invalid VP8 frame.');
    }
    const width = readUint16LE(bytes, 26) & 0x3fff;
    const height = readUint16LE(bytes, 28) & 0x3fff;
    return { format: 'webp', width, height, animated: false };
  }

  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) {
      throw new PipelineError('CORRUPT_IMAGE', 'This WebP file has an invalid VP8L header.');
    }
    const bits = readUint32LE(bytes, 21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { format: 'webp', width, height, animated: false };
  }

  if (chunk === 'VP8X') {
    const flags = bytes[20];
    const animated = (flags & 0x02) !== 0;
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { format: 'webp', width, height, animated };
  }

  throw new PipelineError('CORRUPT_IMAGE', 'This WebP file has an unrecognised header.');
}

function findIspeDimensions(
  bytes: Uint8Array,
  start: number,
  end: number
): { width: number; height: number } | null {
  let best: { width: number; height: number } | null = null;
  let pos = start;

  while (pos + 8 <= end) {
    let size = readUint32BE(bytes, pos);
    const type = readAscii(bytes, pos + 4, 4);
    let headerLen = 8;

    if (size === 1) {
      if (pos + 16 > end) break;
      const hi = readUint32BE(bytes, pos + 8);
      const lo = readUint32BE(bytes, pos + 12);
      size = hi * 0x100000000 + lo;
      headerLen = 16;
    } else if (size === 0) {
      size = end - pos;
    }

    if (size < headerLen || pos + size > end) break;
    const contentStart = pos + headerLen;
    const contentEnd = pos + size;

    if (type === 'ispe' && contentStart + 12 <= contentEnd) {
      const width = readUint32BE(bytes, contentStart + 4);
      const height = readUint32BE(bytes, contentStart + 8);
      if (width > 0 && height > 0) {
        if (!best || width * height > best.width * best.height) {
          best = { width, height };
        }
      }
    } else if (type === 'meta' && contentStart + 4 <= contentEnd) {
      const found = findIspeDimensions(bytes, contentStart + 4, contentEnd);
      if (found && (!best || found.width * found.height > best.width * best.height)) {
        best = found;
      }
    } else if (type === 'iprp' || type === 'ipco') {
      const found = findIspeDimensions(bytes, contentStart, contentEnd);
      if (found && (!best || found.width * found.height > best.width * best.height)) {
        best = found;
      }
    }

    pos = contentEnd;
  }

  return best;
}

function inspectAvif(bytes: Uint8Array): ImageInfo {
  const dims = findIspeDimensions(bytes, 0, bytes.length);
  if (!dims || dims.width === 0 || dims.height === 0) {
    throw new PipelineError('CORRUPT_IMAGE', 'This AVIF file is missing image dimensions.');
  }
  const animated = readAscii(bytes, 8, 4) === 'avis';
  return { format: 'avif', width: dims.width, height: dims.height, animated };
}

function parseSvgLength(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = /^([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|pt|pc|in|cm|mm)?$/i.exec(trimmed);
  if (!match) return null;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = (match[2] ?? 'px').toLowerCase();
  switch (unit) {
    case 'px':
      return value;
    case 'pt':
      return value * (96 / 72);
    case 'pc':
      return value * 16;
    case 'in':
      return value * 96;
    case 'cm':
      return value * (96 / 2.54);
    case 'mm':
      return value * (96 / 25.4);
    default:
      return null;
  }
}

function extractSvgRootTag(markup: string): { tag: string; start: number; end: number } | null {
  const match = /<svg\b[^>]*>/i.exec(markup);
  if (!match || match.index === undefined) return null;
  return { tag: match[0], start: match.index, end: match.index + match[0].length };
}

function readAttr(tag: string, name: string): string | null {
  const regex = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = regex.exec(tag);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

function parseViewBox(raw: string | null): { width: number; height: number } | null {
  if (!raw) return null;
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map((n) => Number.parseFloat(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [, , w, h] = parts;
  if (w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}

function inspectSvg(bytes: Uint8Array): ImageInfo {
  const markup = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const root = extractSvgRootTag(markup);
  if (!root) {
    throw new PipelineError('CORRUPT_IMAGE', 'This SVG file is missing a root <svg> element.');
  }

  const wAttr = parseSvgLength(readAttr(root.tag, 'width'));
  const hAttr = parseSvgLength(readAttr(root.tag, 'height'));
  const viewBox = parseViewBox(readAttr(root.tag, 'viewBox'));

  let width: number;
  let height: number;
  let svgHasExplicitSize = false;

  if (wAttr !== null && hAttr !== null) {
    width = Math.round(wAttr);
    height = Math.round(hAttr);
    svgHasExplicitSize = true;
  } else if (viewBox) {
    if (wAttr !== null) {
      width = Math.round(wAttr);
      height = Math.max(1, Math.round((wAttr * viewBox.height) / viewBox.width));
      svgHasExplicitSize = true;
    } else if (hAttr !== null) {
      height = Math.round(hAttr);
      width = Math.max(1, Math.round((hAttr * viewBox.width) / viewBox.height));
      svgHasExplicitSize = true;
    } else {
      width = Math.max(1, Math.round(viewBox.width));
      height = Math.max(1, Math.round(viewBox.height));
    }
  } else {
    throw new PipelineError(
      'SVG_MISSING_SIZE',
      'This SVG has no width, height, or viewBox and cannot be sized.'
    );
  }

  return {
    format: 'svg',
    width,
    height,
    animated: false,
    svgHasExplicitSize
  };
}

function sanitizeSvgMarkup(markup: string): string {
  return markup
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

/**
 * Rewrites the root <svg> tag so browsers rasterise cleanly at exact pixel dimensions,
 * even when the input only defines a viewBox or lacks an xmlns attribute, while stripping
 * any embedded script or inline event handler markup as defense in depth.
 */
export function prepareSvgMarkup(
  bytes: Uint8Array,
  targetWidth?: number,
  targetHeight?: number
): { markup: string; width: number; height: number } {
  const info = inspectSvg(bytes);
  const width = Math.max(1, Math.round(targetWidth ?? info.width));
  const height = Math.max(1, Math.round(targetHeight ?? info.height));

  let original = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (original.charCodeAt(0) === 0xfeff) {
    original = original.slice(1);
  }
  const sanitized = sanitizeSvgMarkup(original);
  const root = extractSvgRootTag(sanitized);
  if (!root) {
    throw new PipelineError('CORRUPT_IMAGE', 'This SVG file is missing a root <svg> element.');
  }

  let tag = root.tag;
  const selfClosing = tag.endsWith('/>');
  tag = tag.slice(0, selfClosing ? -2 : -1);

  const hasXmlns = /\bxmlns\s*=/i.test(tag);
  const hasViewBox = /\bviewBox\s*=/i.test(tag);

  // Strip existing width / height attributes so we set explicit target pixels.
  tag = tag.replace(/\s+\bwidth\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  tag = tag.replace(/\s+\bheight\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');

  if (!hasXmlns) {
    tag += ' xmlns="http://www.w3.org/2000/svg"';
  }
  if (!hasViewBox) {
    tag += ` viewBox="0 0 ${info.width} ${info.height}"`;
  }
  tag += ` width="${width}" height="${height}"`;
  tag += selfClosing ? '/>' : '>';

  const markup = sanitized.slice(0, root.start) + tag + sanitized.slice(root.end);
  return { markup, width, height };
}

export function inspectImage(bytes: Uint8Array): ImageInfo {
  const format = detectFormat(bytes);
  if (!format) {
    throw new PipelineError(
      'UNSUPPORTED_FORMAT',
      'Unsupported file format. Use JPG, PNG, GIF, SVG, BMP, WebP, or AVIF.'
    );
  }

  switch (format) {
    case 'png':
      return inspectPng(bytes);
    case 'jpeg':
      return inspectJpeg(bytes);
    case 'gif':
      return inspectGif(bytes);
    case 'bmp':
      return inspectBmp(bytes);
    case 'webp':
      return inspectWebp(bytes);
    case 'avif':
      return inspectAvif(bytes);
    case 'svg':
      return inspectSvg(bytes);
  }
}

export function assertWithinLimits(bytes: Uint8Array, info: ImageInfo): void {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new PipelineError('TOO_LARGE_FILE', 'File is larger than 40 MB and cannot be processed.');
  }

  const pixels = info.width * info.height;
  if (!Number.isFinite(pixels) || pixels <= 0) {
    throw new PipelineError('CORRUPT_IMAGE', 'Image has invalid dimensions.');
  }

  if (pixels > MAX_PIXELS) {
    const mp = (pixels / 1_000_000).toFixed(1);
    throw new PipelineError(
      'TOO_MANY_PIXELS',
      `Image is ${mp} megapixels, above the ${MAX_MEGAPIXELS} megapixel limit.`
    );
  }
}

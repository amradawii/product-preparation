import type { ExifOrientation, ImageFormat, RawImageData } from './types';

function readUint16(b: Uint8Array, o: number, littleEndian: boolean): number {
  return littleEndian ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
}

function readUint32(b: Uint8Array, o: number, littleEndian: boolean): number {
  if (littleEndian) {
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  }
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function readAscii(b: Uint8Array, start: number, len: number): string {
  let out = '';
  const end = Math.min(b.length, start + len);
  for (let i = start; i < end; i++) {
    out += String.fromCharCode(b[i]);
  }
  return out;
}

function parseTiffOrientation(
  bytes: Uint8Array,
  tiffStart: number,
  limit: number
): ExifOrientation {
  if (tiffStart + 8 > limit) return 1;

  const byteOrder = readAscii(bytes, tiffStart, 2);
  let littleEndian: boolean;
  if (byteOrder === 'II') {
    littleEndian = true;
  } else if (byteOrder === 'MM') {
    littleEndian = false;
  } else {
    return 1;
  }

  if (readUint16(bytes, tiffStart + 2, littleEndian) !== 42) return 1;

  const ifdOffset = readUint32(bytes, tiffStart + 4, littleEndian);
  const ifdStart = tiffStart + ifdOffset;
  if (ifdStart + 2 > limit) return 1;

  const entryCount = readUint16(bytes, ifdStart, littleEndian);
  for (let i = 0; i < entryCount; i++) {
    const entryPos = ifdStart + 2 + i * 12;
    if (entryPos + 12 > limit) break;

    const tag = readUint16(bytes, entryPos, littleEndian);
    if (tag === 0x0112) {
      const value = readUint16(bytes, entryPos + 8, littleEndian);
      if (value >= 1 && value <= 8) {
        return value as ExifOrientation;
      }
      return 1;
    }
  }

  return 1;
}

function readJpegExifOrientation(bytes: Uint8Array): ExifOrientation {
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) break;

    const marker = bytes[pos++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    if (pos + 2 > bytes.length) break;
    const segLen = (bytes[pos] << 8) | bytes[pos + 1];
    if (segLen < 2 || pos + segLen > bytes.length) break;

    if (marker === 0xe1 && segLen >= 16 && readAscii(bytes, pos + 2, 6) === 'Exif\0\0') {
      return parseTiffOrientation(bytes, pos + 8, pos + segLen);
    }

    pos += segLen;
  }
  return 1;
}

function readPngExifOrientation(bytes: Uint8Array): ExifOrientation {
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len = readUint32(bytes, pos, false);
    const type = readAscii(bytes, pos + 4, 4);
    const dataStart = pos + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) break;

    if (type === 'eXIf') {
      return parseTiffOrientation(bytes, dataStart, dataEnd);
    }
    if (type === 'IEND') break;
    pos = dataEnd + 4;
  }
  return 1;
}

function readWebpExifOrientation(bytes: Uint8Array): ExifOrientation {
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const fourcc = readAscii(bytes, pos, 4);
    const chunkSize = readUint32(bytes, pos + 4, true);
    const dataStart = pos + 8;
    const dataEnd = Math.min(bytes.length, dataStart + chunkSize);

    if (fourcc === 'EXIF') {
      const offset =
        dataStart + 6 <= dataEnd && readAscii(bytes, dataStart, 6) === 'Exif\0\0'
          ? dataStart + 6
          : dataStart;
      return parseTiffOrientation(bytes, offset, dataEnd);
    }

    pos = dataStart + chunkSize + (chunkSize % 2);
  }
  return 1;
}

export function readExifOrientation(bytes: Uint8Array, format: ImageFormat): ExifOrientation {
  switch (format) {
    case 'jpeg':
      return readJpegExifOrientation(bytes);
    case 'png':
      return readPngExifOrientation(bytes);
    case 'webp':
      return readWebpExifOrientation(bytes);
    default:
      return 1;
  }
}

export function orientedDimensions(
  width: number,
  height: number,
  orientation: ExifOrientation
): { width: number; height: number } {
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}

export function applyOrientation(image: RawImageData, orientation: ExifOrientation): RawImageData {
  if (orientation === 1) return image;

  const { width: srcW, height: srcH, data: src } = image;
  const swap = orientation >= 5;
  const dstW = swap ? srcH : srcW;
  const dstH = swap ? srcW : srcH;
  const dst = new Uint8ClampedArray(dstW * dstH * 4);

  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      let dx: number;
      let dy: number;

      switch (orientation) {
        case 2: // flip horizontal
          dx = srcW - 1 - x;
          dy = y;
          break;
        case 3: // rotate 180
          dx = srcW - 1 - x;
          dy = srcH - 1 - y;
          break;
        case 4: // flip vertical
          dx = x;
          dy = srcH - 1 - y;
          break;
        case 5: // transpose
          dx = y;
          dy = x;
          break;
        case 6: // rotate 90 CW
          dx = srcH - 1 - y;
          dy = x;
          break;
        case 7: // transverse
          dx = srcH - 1 - y;
          dy = srcW - 1 - x;
          break;
        case 8: // rotate 270 CW (90 CCW)
          dx = y;
          dy = srcW - 1 - x;
          break;
      }

      const srcIdx = (y * srcW + x) * 4;
      const dstIdx = (dy * dstW + dx) * 4;
      dst[dstIdx] = src[srcIdx];
      dst[dstIdx + 1] = src[srcIdx + 1];
      dst[dstIdx + 2] = src[srcIdx + 2];
      dst[dstIdx + 3] = src[srcIdx + 3];
    }
  }

  return { width: dstW, height: dstH, data: dst };
}

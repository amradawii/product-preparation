import { PipelineError, type RawImageData } from '../types';

function readUint16LE(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function readUint32LE(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function readInt32LE(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
}

function maskShiftAndScale(mask: number): { shift: number; max: number } {
  if (mask === 0) return { shift: 0, max: 0 };
  let shift = 0;
  let m = mask >>> 0;
  while ((m & 1) === 0 && shift < 32) {
    m >>>= 1;
    shift++;
  }
  return { shift, max: m };
}

function extractChannel(value: number, mask: number, shift: number, max: number): number {
  if (max === 0) return 0;
  const raw = (value & mask) >>> shift;
  return max === 255 ? raw : Math.round((raw * 255) / max);
}

export function decodeBmp(bytes: Uint8Array): RawImageData {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    throw new PipelineError('CORRUPT_IMAGE', 'This BMP file has a damaged header.');
  }

  const pixelOffset = readUint32LE(bytes, 10);
  const dibSize = readUint32LE(bytes, 14);

  let width: number;
  let rawHeight: number;
  let bpp: number;
  let compression = 0;
  let paletteCount = 0;
  let paletteEntrySize = 4;

  if (dibSize === 12) {
    width = readUint16LE(bytes, 18);
    rawHeight = readUint16LE(bytes, 20);
    bpp = readUint16LE(bytes, 24);
    paletteEntrySize = 3;
  } else if (dibSize >= 40 && bytes.length >= 14 + dibSize) {
    width = readInt32LE(bytes, 18);
    rawHeight = readInt32LE(bytes, 22);
    bpp = readUint16LE(bytes, 28);
    compression = readUint32LE(bytes, 30);
    paletteCount = readUint32LE(bytes, 46);
  } else {
    throw new PipelineError('CORRUPT_IMAGE', 'This BMP file has an unsupported DIB header.');
  }

  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  if (width <= 0 || height <= 0) {
    throw new PipelineError('CORRUPT_IMAGE', 'This BMP file has invalid dimensions.');
  }

  if (compression !== 0 && compression !== 3) {
    throw new PipelineError(
      'DECODE_FAILED',
      'Compressed BMP variants are not supported by the fallback decoder.'
    );
  }

  const rowStride = Math.floor((bpp * width + 31) / 32) * 4;
  if (pixelOffset + rowStride * height > bytes.length) {
    throw new PipelineError('CORRUPT_IMAGE', 'This BMP file is truncated or damaged.');
  }

  const paletteOffset = 14 + dibSize;
  const maxPalette = bpp <= 8 ? (paletteCount > 0 ? paletteCount : 1 << bpp) : 0;

  let rMask = 0x00ff0000;
  let gMask = 0x0000ff00;
  let bMask = 0x000000ff;
  let aMask = 0xff000000;

  if (compression === 3) {
    const maskOffset = dibSize >= 52 ? 54 : paletteOffset;
    if (maskOffset + 12 > bytes.length) {
      throw new PipelineError('CORRUPT_IMAGE', 'This BMP file is missing color bitmasks.');
    }
    rMask = readUint32LE(bytes, maskOffset);
    gMask = readUint32LE(bytes, maskOffset + 4);
    bMask = readUint32LE(bytes, maskOffset + 8);
    aMask =
      dibSize >= 56 && maskOffset + 16 <= bytes.length ? readUint32LE(bytes, maskOffset + 12) : 0;
  } else if (bpp === 16) {
    rMask = 0x7c00;
    gMask = 0x03e0;
    bMask = 0x001f;
    aMask = 0;
  }

  const rInfo = maskShiftAndScale(rMask);
  const gInfo = maskShiftAndScale(gMask);
  const bInfo = maskShiftAndScale(bMask);
  const aInfo = maskShiftAndScale(aMask);

  const out = new Uint8ClampedArray(width * height * 4);
  let sawNonZeroAlpha = false;

  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    const rowStart = pixelOffset + srcRow * rowStride;

    for (let x = 0; x < width; x++) {
      const dstIdx = (y * width + x) * 4;

      if (bpp === 24) {
        const p = rowStart + x * 3;
        out[dstIdx] = bytes[p + 2];
        out[dstIdx + 1] = bytes[p + 1];
        out[dstIdx + 2] = bytes[p];
        out[dstIdx + 3] = 255;
      } else if (bpp === 32) {
        const p = rowStart + x * 4;
        if (compression === 3) {
          const v = readUint32LE(bytes, p);
          out[dstIdx] = extractChannel(v, rMask, rInfo.shift, rInfo.max);
          out[dstIdx + 1] = extractChannel(v, gMask, gInfo.shift, gInfo.max);
          out[dstIdx + 2] = extractChannel(v, bMask, bInfo.shift, bInfo.max);
          const a = aInfo.max > 0 ? extractChannel(v, aMask, aInfo.shift, aInfo.max) : 255;
          if (a !== 0) sawNonZeroAlpha = true;
          out[dstIdx + 3] = a;
        } else {
          out[dstIdx] = bytes[p + 2];
          out[dstIdx + 1] = bytes[p + 1];
          out[dstIdx + 2] = bytes[p];
          const a = bytes[p + 3];
          if (a !== 0) sawNonZeroAlpha = true;
          out[dstIdx + 3] = a;
        }
      } else if (bpp === 16) {
        const v = readUint16LE(bytes, rowStart + x * 2);
        out[dstIdx] = extractChannel(v, rMask, rInfo.shift, rInfo.max);
        out[dstIdx + 1] = extractChannel(v, gMask, gInfo.shift, gInfo.max);
        out[dstIdx + 2] = extractChannel(v, bMask, bInfo.shift, bInfo.max);
        out[dstIdx + 3] = aInfo.max > 0 ? extractChannel(v, aMask, aInfo.shift, aInfo.max) : 255;
      } else if (bpp === 8 || bpp === 4 || bpp === 1) {
        let colorIdx: number;
        if (bpp === 8) {
          colorIdx = bytes[rowStart + x];
        } else if (bpp === 4) {
          const byte = bytes[rowStart + (x >> 1)];
          colorIdx = (x & 1) === 0 ? byte >> 4 : byte & 0x0f;
        } else {
          const byte = bytes[rowStart + (x >> 3)];
          colorIdx = (byte >> (7 - (x & 7))) & 1;
        }
        if (colorIdx >= maxPalette) {
          throw new PipelineError(
            'CORRUPT_IMAGE',
            'This BMP file has an out-of-range palette index.'
          );
        }
        const p = paletteOffset + colorIdx * paletteEntrySize;
        if (p + 3 > bytes.length) {
          throw new PipelineError('CORRUPT_IMAGE', 'This BMP file has a truncated color table.');
        }
        out[dstIdx] = bytes[p + 2];
        out[dstIdx + 1] = bytes[p + 1];
        out[dstIdx + 2] = bytes[p];
        out[dstIdx + 3] = 255;
      } else {
        throw new PipelineError('DECODE_FAILED', `Unsupported BMP bit depth (${bpp}-bit).`);
      }
    }
  }

  // Standard 32-bit BI_RGB BMPs often leave the 4th byte as 0 (BGRX).
  if (bpp === 32 && !sawNonZeroAlpha) {
    for (let i = 3; i < out.length; i += 4) {
      out[i] = 255;
    }
  }

  return { width, height, data: out };
}

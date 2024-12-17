export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'svg' | 'bmp' | 'webp' | 'avif';

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_MEGAPIXELS = 50;
export const MAX_PIXELS = MAX_MEGAPIXELS * 1_000_000;
export const TARGET_SIZE_DEFAULT_KB = 150;

export type QualityPreset = 'best' | 'smaller' | 'lossless' | 'target';

export interface RawImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
  animated: boolean;
  bitDepth?: number;
  isCmyk?: boolean;
  svgHasExplicitSize?: boolean;
}

export type PipelineErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'CORRUPT_IMAGE'
  | 'TOO_LARGE_FILE'
  | 'TOO_MANY_PIXELS'
  | 'SVG_MISSING_SIZE'
  | 'CMYK_UNSUPPORTED'
  | 'PNG_16BIT_UNSUPPORTED'
  | 'DECODE_FAILED'
  | 'ENCODE_FAILED';

export class PipelineError extends Error {
  readonly code: PipelineErrorCode;

  constructor(code: PipelineErrorCode, message: string) {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
  }
}

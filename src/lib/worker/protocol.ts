import type { QualityPreset } from '../pipeline/encode';
import type { FitMode, SizeMode } from '../pipeline/geometry';
import type { BackgroundOption } from '../pipeline/resize';
import type { ImageFormat } from '../pipeline/types';

export interface ProcessSettings {
  sizeMode: SizeMode;
  targetWidth: number;
  targetHeight: number;
  fit: FitMode;
  noEnlarge: boolean;
  background: BackgroundOption;
  qualityPreset: QualityPreset;
  targetKb: number;
}

export type WorkerJobInput =
  | {
      kind: 'file';
      buffer: ArrayBuffer;
    }
  | {
      kind: 'raster';
      pixels: ArrayBuffer;
      width: number;
      height: number;
      originalWidth: number;
      originalHeight: number;
      originalBytes: number;
      format: ImageFormat;
      notices: string[];
    };

export interface WorkerRequest {
  id: string;
  input: WorkerJobInput;
  settings: ProcessSettings;
}

export type WorkerStage = 'decoding' | 'resizing' | 'encoding';

export interface WorkerProgressMessage {
  type: 'progress';
  id: string;
  stage: WorkerStage;
  progress: number;
}

export interface WorkerSuccessResult {
  type: 'done';
  id: string;
  outputBuffer: ArrayBuffer;
  /** Compact thumbnail WebP (<= 320px) for low-memory grid rendering, omitted if output is already small. */
  thumbnailBuffer?: ArrayBuffer;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  outputBytes: number;
  quality: number;
  lossless: boolean;
  format: ImageFormat;
  notices: string[];
}

export interface WorkerErrorResult {
  type: 'error';
  id: string;
  code: string;
  message: string;
}

export type WorkerResponse = WorkerProgressMessage | WorkerSuccessResult | WorkerErrorResult;

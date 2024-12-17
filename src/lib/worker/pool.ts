import { assertWithinLimits, detectFormat, inspectImage } from '../pipeline/detect';
import { computeGeometry } from '../pipeline/geometry';
import { rasterizeSvgOnMainThread } from '../pipeline/svg';
import { PipelineError } from '../pipeline/types';
import type {
  ProcessSettings,
  WorkerJobInput,
  WorkerRequest,
  WorkerResponse,
  WorkerStage,
  WorkerSuccessResult
} from './protocol';

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerResponse>) => void
  ): void;
  removeEventListener(type: 'error', listener: (event: Event) => void): void;
}

export interface PoolOptions {
  concurrency?: number;
  createWorker?: () => WorkerLike;
  svgRasterizer?: (
    bytes: Uint8Array,
    targetWidth: number,
    targetHeight: number
  ) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}

export interface PoolJobCallbacks {
  onProgress?: (stage: WorkerStage, progress: number) => void;
}

export type PoolJobOutcome =
  | { status: 'done'; result: WorkerSuccessResult }
  | { status: 'error'; id: string; code: string; message: string }
  | { status: 'cancelled'; id: string };

export interface PoolTask {
  id: string;
  getBuffer: () => Promise<ArrayBuffer>;
  settings: ProcessSettings;
  callbacks?: PoolJobCallbacks;
}

interface InternalTask {
  id: string;
  getBuffer: () => Promise<ArrayBuffer>;
  settings: ProcessSettings;
  callbacks?: PoolJobCallbacks;
  cancelled: boolean;
  resolve: (outcome: PoolJobOutcome) => void;
}

interface WorkerSlot {
  worker: WorkerLike;
  busy: boolean;
  currentTask: InternalTask | null;
  onMessage: (event: MessageEvent<WorkerResponse>) => void;
  onError: (event: Event) => void;
}

export function getDefaultPoolSize(hardwareConcurrency?: number): number {
  const cores =
    hardwareConcurrency ??
    (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined) ??
    2;
  const safeCores = Number.isFinite(cores) && cores > 0 ? Math.floor(cores) : 2;
  return Math.max(1, Math.min(4, safeCores - 1));
}

function defaultCreateWorker(): WorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module'
  }) as unknown as WorkerLike;
}

export class ImageWorkerPool {
  readonly concurrency: number;
  private readonly createWorker: () => WorkerLike;
  private readonly svgRasterizer: NonNullable<PoolOptions['svgRasterizer']>;
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: InternalTask[] = [];
  private readonly activeById = new Map<string, WorkerSlot>();
  private disposed = false;

  constructor(options: PoolOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? getDefaultPoolSize());
    this.createWorker = options.createWorker ?? defaultCreateWorker;
    this.svgRasterizer = options.svgRasterizer ?? rasterizeSvgOnMainThread;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  get activeCount(): number {
    return this.activeById.size;
  }

  submit(task: PoolTask): Promise<PoolJobOutcome> {
    if (this.disposed) {
      return Promise.resolve({ status: 'cancelled', id: task.id });
    }

    return new Promise<PoolJobOutcome>((resolve) => {
      this.queue.push({
        id: task.id,
        getBuffer: task.getBuffer,
        settings: task.settings,
        callbacks: task.callbacks,
        cancelled: false,
        resolve
      });
      this.pump();
    });
  }

  cancel(id: string): boolean {
    const queueIdx = this.queue.findIndex((t) => t.id === id);
    if (queueIdx !== -1) {
      const [task] = this.queue.splice(queueIdx, 1);
      task.cancelled = true;
      task.resolve({ status: 'cancelled', id: task.id });
      return true;
    }

    const activeSlot = this.activeById.get(id);
    if (activeSlot && activeSlot.currentTask) {
      const task = activeSlot.currentTask;
      task.cancelled = true;
      this.activeById.delete(id);
      this.destroySlot(activeSlot);
      task.resolve({ status: 'cancelled', id: task.id });
      this.pump();
      return true;
    }

    return false;
  }

  cancelAll(): void {
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      task.cancelled = true;
      task.resolve({ status: 'cancelled', id: task.id });
    }

    const activeSlots = [...this.activeById.values()];
    this.activeById.clear();
    for (const slot of activeSlots) {
      const task = slot.currentTask;
      this.destroySlot(slot);
      if (task && !task.cancelled) {
        task.cancelled = true;
        task.resolve({ status: 'cancelled', id: task.id });
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelAll();
    while (this.slots.length > 0) {
      this.destroySlot(this.slots[0]);
    }
  }

  private destroySlot(slot: WorkerSlot): void {
    slot.worker.removeEventListener('message', slot.onMessage);
    slot.worker.removeEventListener('error', slot.onError);
    slot.worker.terminate();
    slot.busy = false;
    slot.currentTask = null;
    const idx = this.slots.indexOf(slot);
    if (idx !== -1) {
      this.slots.splice(idx, 1);
    }
  }

  private acquireIdleSlot(): WorkerSlot | null {
    const existing = this.slots.find((s) => !s.busy);
    if (existing) return existing;

    if (this.slots.length >= this.concurrency) return null;

    const worker = this.createWorker();
    const slot: WorkerSlot = {
      worker,
      busy: false,
      currentTask: null,
      onMessage: (event) => this.handleWorkerMessage(slot, event.data),
      onError: () => this.handleWorkerCrash(slot)
    };
    worker.addEventListener('message', slot.onMessage);
    worker.addEventListener('error', slot.onError);
    this.slots.push(slot);
    return slot;
  }

  private pump(): void {
    if (this.disposed) return;

    while (this.queue.length > 0) {
      const slot = this.acquireIdleSlot();
      if (!slot) break;

      const task = this.queue.shift()!;
      if (task.cancelled) {
        task.resolve({ status: 'cancelled', id: task.id });
        continue;
      }

      slot.busy = true;
      slot.currentTask = task;
      this.activeById.set(task.id, slot);
      void this.dispatchTask(slot, task);
    }
  }

  private async dispatchTask(slot: WorkerSlot, task: InternalTask): Promise<void> {
    try {
      const buffer = await task.getBuffer();
      if (task.cancelled || this.disposed) {
        this.releaseSlot(slot, task.id);
        return;
      }

      const bytes = new Uint8Array(buffer);
      const format = detectFormat(bytes);

      let input: WorkerJobInput;
      let transfer: Transferable[];

      if (format === 'svg') {
        const info = inspectImage(bytes);
        assertWithinLimits(bytes, info);
        task.callbacks?.onProgress?.('decoding', 0.2);

        const plan = computeGeometry({
          srcWidth: info.width,
          srcHeight: info.height,
          sizeMode: task.settings.sizeMode,
          targetWidth: task.settings.targetWidth,
          targetHeight: task.settings.targetHeight,
          fit: task.settings.fit,
          noEnlarge: task.settings.noEnlarge,
          isVector: true
        });

        const raster = await this.svgRasterizer(bytes, plan.scaledWidth, plan.scaledHeight);
        if (task.cancelled || this.disposed) {
          this.releaseSlot(slot, task.id);
          return;
        }

        const pixelBuf =
          raster.data.buffer instanceof ArrayBuffer &&
          raster.data.byteOffset === 0 &&
          raster.data.byteLength === raster.data.buffer.byteLength
            ? raster.data.buffer
            : raster.data.slice().buffer;

        input = {
          kind: 'raster',
          pixels: pixelBuf,
          width: raster.width,
          height: raster.height,
          originalWidth: info.width,
          originalHeight: info.height,
          originalBytes: bytes.byteLength,
          format: 'svg',
          notices: []
        };
        transfer = [pixelBuf];
      } else {
        input = { kind: 'file', buffer };
        transfer = [buffer];
      }

      const request: WorkerRequest = {
        id: task.id,
        input,
        settings: task.settings
      };
      slot.worker.postMessage(request, transfer);
    } catch (err) {
      this.releaseSlot(slot, task.id);
      if (task.cancelled) return;
      const code = err instanceof PipelineError ? err.code : 'DECODE_FAILED';
      const message =
        err instanceof Error && err.message ? err.message : 'Could not process this image.';
      task.resolve({ status: 'error', id: task.id, code, message });
      this.pump();
    }
  }

  private releaseSlot(slot: WorkerSlot, taskId: string): void {
    this.activeById.delete(taskId);
    if (this.slots.includes(slot)) {
      slot.busy = false;
      slot.currentTask = null;
    }
  }

  private handleWorkerMessage(slot: WorkerSlot, msg: WorkerResponse): void {
    const task = slot.currentTask;
    if (!task || task.id !== msg.id || task.cancelled) return;

    if (msg.type === 'progress') {
      task.callbacks?.onProgress?.(msg.stage, msg.progress);
      return;
    }

    this.releaseSlot(slot, task.id);
    if (msg.type === 'done') {
      task.resolve({ status: 'done', result: msg });
    } else {
      task.resolve({ status: 'error', id: msg.id, code: msg.code, message: msg.message });
    }
    this.pump();
  }

  private handleWorkerCrash(slot: WorkerSlot): void {
    const task = slot.currentTask;
    if (task) {
      this.activeById.delete(task.id);
    }
    this.destroySlot(slot);
    if (task && !task.cancelled) {
      task.resolve({
        status: 'error',
        id: task.id,
        code: 'DECODE_FAILED',
        message: 'Image worker stopped unexpectedly while processing this file.'
      });
    }
    this.pump();
  }
}

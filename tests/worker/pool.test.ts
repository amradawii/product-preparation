import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { detectFormat, inspectImage } from '../../src/lib/pipeline/detect';
import { getDefaultPoolSize, ImageWorkerPool, type WorkerLike } from '../../src/lib/worker/pool';
import type { ProcessSettings, WorkerRequest, WorkerResponse } from '../../src/lib/worker/protocol';
import { runPipelineJob } from '../../src/lib/worker/worker';
import {
  initDecodersForNode,
  initResizeForNode,
  initWebpEncodeForNode
} from '../helpers/init-wasm';

const defaultSettings: ProcessSettings = {
  sizeMode: 'fixed',
  targetWidth: 64,
  targetHeight: 64,
  fit: 'fit',
  noEnlarge: true,
  background: { type: 'color', hex: '#ffffff' },
  qualityPreset: 'best',
  targetKb: 150
};

class MockWorker implements WorkerLike {
  private messageListeners = new Set<(e: MessageEvent<WorkerResponse>) => void>();
  private errorListeners = new Set<(e: Event) => void>();
  terminated = false;
  lastTransferCount = 0;

  constructor(private readonly handler: (req: WorkerRequest, worker: MockWorker) => void) {}

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.lastTransferCount = transfer?.length ?? 0;
    this.handler(message as WorkerRequest, this);
  }

  emitMessage(msg: WorkerResponse): void {
    if (this.terminated) return;
    for (const fn of this.messageListeners) {
      fn({ data: msg } as MessageEvent<WorkerResponse>);
    }
  }

  emitError(): void {
    if (this.terminated) return;
    for (const fn of this.errorListeners) {
      fn(new Event('error'));
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: 'message' | 'error', listener: (...args: never[]) => void): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (e: MessageEvent<WorkerResponse>) => void);
    } else {
      this.errorListeners.add(listener as (e: Event) => void);
    }
  }

  removeEventListener(type: 'message' | 'error', listener: (...args: never[]) => void): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (e: MessageEvent<WorkerResponse>) => void);
    } else {
      this.errorListeners.delete(listener as (e: Event) => void);
    }
  }
}

beforeAll(async () => {
  await Promise.all([initDecodersForNode(), initResizeForNode(), initWebpEncodeForNode()]);
});

describe('getDefaultPoolSize', () => {
  it('enforces a floor of 1 and ceiling of 4 workers', () => {
    expect(getDefaultPoolSize(1)).toBe(1);
    expect(getDefaultPoolSize(2)).toBe(1);
    expect(getDefaultPoolSize(3)).toBe(2);
    expect(getDefaultPoolSize(4)).toBe(3);
    expect(getDefaultPoolSize(8)).toBe(4);
    expect(getDefaultPoolSize(16)).toBe(4);
  });
});

describe('ImageWorkerPool', () => {
  it('respects the concurrency limit and transfers buffers zero-copy', async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const workers: MockWorker[] = [];

    const pool = new ImageWorkerPool({
      concurrency: 2,
      createWorker: () => {
        const w = new MockWorker((req, self) => {
          inFlight++;
          peakInFlight = Math.max(peakInFlight, inFlight);
          self.emitMessage({ type: 'progress', id: req.id, stage: 'encoding', progress: 0.8 });
          setTimeout(() => {
            inFlight--;
            self.emitMessage({
              type: 'done',
              id: req.id,
              outputBuffer: new ArrayBuffer(16),
              width: 64,
              height: 64,
              originalWidth: 32,
              originalHeight: 24,
              originalBytes: 32,
              outputBytes: 16,
              quality: 82,
              lossless: false,
              format: 'jpeg',
              notices: []
            });
          }, 15);
        });
        workers.push(w);
        return w;
      }
    });

    const progressSeen: string[] = [];
    const jobs = Array.from({ length: 8 }, (_, idx) =>
      pool.submit({
        id: `job-${idx}`,
        getBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer,
        settings: defaultSettings,
        callbacks: {
          onProgress: (stage) => progressSeen.push(`${idx}:${stage}`)
        }
      })
    );

    const outcomes = await Promise.all(jobs);
    pool.dispose();

    expect(peakInFlight).toBe(2);
    expect(workers.length).toBe(2);
    expect(workers.every((w) => w.lastTransferCount === 1)).toBe(true);
    expect(outcomes.every((o) => o.status === 'done')).toBe(true);
    expect(progressSeen.length).toBe(8);
  });

  it('cancels queued work immediately without executing it and terminates active work on cancelAll', async () => {
    const started: string[] = [];
    const createdWorkers: MockWorker[] = [];

    const pool = new ImageWorkerPool({
      concurrency: 1,
      createWorker: () => {
        const w = new MockWorker((req) => {
          started.push(req.id);
        });
        createdWorkers.push(w);
        return w;
      }
    });

    const p1 = pool.submit({
      id: 'first',
      getBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer,
      settings: defaultSettings
    });
    const p2 = pool.submit({
      id: 'second',
      getBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer,
      settings: defaultSettings
    });
    const p3 = pool.submit({
      id: 'third',
      getBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer,
      settings: defaultSettings
    });

    // Wait one microtask so job 1 is dispatched to the worker.
    await Promise.resolve();
    await Promise.resolve();

    expect(pool.cancel('second')).toBe(true);
    expect(await p2).toEqual({ status: 'cancelled', id: 'second' });

    pool.cancelAll();
    const [o1, o3] = await Promise.all([p1, p3]);
    expect(o1).toEqual({ status: 'cancelled', id: 'first' });
    expect(o3).toEqual({ status: 'cancelled', id: 'third' });
    expect(started).toEqual(['first']);
    expect(createdWorkers[0].terminated).toBe(true);
  });

  it('isolates single-file errors and worker crashes without stopping the rest of the batch', async () => {
    const pool = new ImageWorkerPool({
      concurrency: 2,
      createWorker: () =>
        new MockWorker((req, self) => {
          setTimeout(() => {
            if (req.id === 'bad-error') {
              self.emitMessage({
                type: 'error',
                id: req.id,
                code: 'CORRUPT_IMAGE',
                message: 'Could not decode this image.'
              });
            } else if (req.id === 'bad-crash') {
              self.emitError();
            } else {
              self.emitMessage({
                type: 'done',
                id: req.id,
                outputBuffer: new ArrayBuffer(12),
                width: 64,
                height: 64,
                originalWidth: 32,
                originalHeight: 24,
                originalBytes: 32,
                outputBytes: 12,
                quality: 82,
                lossless: false,
                format: 'jpeg',
                notices: []
              });
            }
          }, 10);
        })
    });

    const ids = ['ok-1', 'bad-error', 'bad-crash', 'ok-2', 'ok-3'];
    const outcomes = await Promise.all(
      ids.map((id) =>
        pool.submit({
          id,
          getBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer,
          settings: defaultSettings
        })
      )
    );
    pool.dispose();

    expect(outcomes.map((o) => o.status)).toEqual(['done', 'error', 'error', 'done', 'done']);
  });

  it('rasterises SVG on the main thread at target size (ignoring noEnlarge) before sending to worker', async () => {
    const svgBytes = new Uint8Array(
      await readFile(path.resolve(process.cwd(), 'tests/fixtures/sample.svg'))
    );
    let receivedRequest: WorkerRequest | null = null;

    const pool = new ImageWorkerPool({
      concurrency: 1,
      svgRasterizer: async (_bytes, width, height) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4)
      }),
      createWorker: () =>
        new MockWorker((req, self) => {
          receivedRequest = req;
          void runPipelineJob(req).then((res) => self.emitMessage(res));
        })
    });

    const outcome = await pool.submit({
      id: 'svg-1',
      getBuffer: async () => svgBytes.slice().buffer,
      settings: {
        ...defaultSettings,
        targetWidth: 200,
        targetHeight: 200,
        noEnlarge: true
      }
    });
    pool.dispose();

    expect(receivedRequest).not.toBeNull();
    expect(receivedRequest!.input.kind).toBe('raster');
    if (receivedRequest!.input.kind === 'raster') {
      // sample.svg is 64x48 -> fit into 200x200 ignores noEnlarge -> 200x150
      expect(receivedRequest!.input.width).toBe(200);
      expect(receivedRequest!.input.height).toBe(150);
    }

    expect(outcome.status).toBe('done');
    if (outcome.status === 'done') {
      const outBytes = new Uint8Array(outcome.result.outputBuffer);
      expect(detectFormat(outBytes)).toBe('webp');
      expect(inspectImage(outBytes)).toMatchObject({ width: 200, height: 200 });
    }
  });
});

describe('runPipelineJob', () => {
  it('processes real JPEG and animated GIF fixtures end-to-end with progress stages', async () => {
    const jpg = await readFile(path.resolve(process.cwd(), 'tests/fixtures/sample.jpg'));
    const stages: string[] = [];

    const jpgRes = await runPipelineJob(
      {
        id: 'jpg-1',
        input: {
          kind: 'file',
          buffer: jpg.buffer.slice(jpg.byteOffset, jpg.byteOffset + jpg.byteLength)
        },
        settings: defaultSettings
      },
      (stage) => stages.push(stage)
    );

    expect(stages).toEqual(['decoding', 'resizing', 'encoding']);
    expect(jpgRes.width).toBe(64);
    expect(jpgRes.height).toBe(64);
    expect(detectFormat(new Uint8Array(jpgRes.outputBuffer))).toBe('webp');

    const gif = await readFile(path.resolve(process.cwd(), 'tests/fixtures/animated.gif'));
    const gifRes = await runPipelineJob({
      id: 'gif-1',
      input: {
        kind: 'file',
        buffer: gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength)
      },
      settings: defaultSettings
    });
    expect(gifRes.notices).toContain('Animated GIF: first frame used');
  });
});

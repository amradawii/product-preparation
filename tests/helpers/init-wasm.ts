import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { init as initAvifDecode } from '@jsquash/avif/decode';
import { init as initJpegDecode } from '@jsquash/jpeg/decode';
import { init as initPngDecode } from '@jsquash/png/decode';
import { initResize } from '@jsquash/resize';
import { init as initWebpDecode } from '@jsquash/webp/decode';

let decodersInitialized = false;
let resizeInitialized = false;

class NodeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly colorSpace: PredefinedColorSpace = 'srgb';

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? dataOrWidth.length / (4 * widthOrHeight);
    }
  }
}

export function ensureNodeImageData(): void {
  if (typeof globalThis.ImageData === 'undefined') {
    (globalThis as unknown as { ImageData: typeof NodeImageData }).ImageData = NodeImageData;
  }
}

async function loadWasmModule(relativeFromNodeModules: string): Promise<WebAssembly.Module> {
  const fullPath = path.resolve(process.cwd(), 'node_modules', relativeFromNodeModules);
  const buf = await readFile(fullPath);
  return WebAssembly.compile(buf);
}

export async function initDecodersForNode(): Promise<void> {
  ensureNodeImageData();
  if (decodersInitialized) return;

  const [jpegMod, pngBuf, webpMod, avifMod] = await Promise.all([
    loadWasmModule('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
    readFile(
      path.resolve(process.cwd(), 'node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm')
    ),
    loadWasmModule('@jsquash/webp/codec/dec/webp_dec.wasm'),
    loadWasmModule('@jsquash/avif/codec/dec/avif_dec.wasm')
  ]);

  await Promise.all([
    initJpegDecode(jpegMod),
    initPngDecode(pngBuf),
    initWebpDecode(webpMod),
    initAvifDecode(avifMod)
  ]);

  decodersInitialized = true;
}

export async function initResizeForNode(): Promise<void> {
  ensureNodeImageData();
  if (resizeInitialized) return;

  const resizeBuf = await readFile(
    path.resolve(
      process.cwd(),
      'node_modules/@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm'
    )
  );
  await initResize(resizeBuf);
  resizeInitialized = true;
}

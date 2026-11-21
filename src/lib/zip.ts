import { Zip, ZipPassThrough } from 'fflate';

export interface ZipEntryInput {
  name: string;
  data: Uint8Array | Blob;
}

const STREAM_CHUNK_BYTES = 256 * 1024;

async function feedBlob(stream: ZipPassThrough, blob: Blob): Promise<void> {
  if (blob.size === 0) {
    stream.push(new Uint8Array(0), true);
    return;
  }

  let offset = 0;
  while (offset < blob.size) {
    const end = Math.min(blob.size, offset + STREAM_CHUNK_BYTES);
    const sliceBuf = await blob.slice(offset, end).arrayBuffer();
    const isLast = end >= blob.size;
    stream.push(new Uint8Array(sliceBuf), isLast);
    offset = end;
  }
}

function feedBytes(stream: ZipPassThrough, bytes: Uint8Array): void {
  if (bytes.byteLength === 0) {
    stream.push(new Uint8Array(0), true);
    return;
  }

  let offset = 0;
  while (offset < bytes.byteLength) {
    const end = Math.min(bytes.byteLength, offset + STREAM_CHUNK_BYTES);
    const isLast = end >= bytes.byteLength;
    stream.push(bytes.subarray(offset, end), isLast);
    offset = end;
  }
}

/**
 * Builds a ZIP archive in streaming STORE mode (level 0, no redundant DEFLATE pass
 * since WebP images are already compressed).
 */
export async function createStreamingZipChunks(
  entries: readonly ZipEntryInput[],
  onProgress?: (completed: number, total: number) => void
): Promise<Uint8Array<ArrayBuffer>[]> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];

  let zipError: Error | null = null;
  const zip = new Zip((err, data) => {
    if (err) {
      zipError = err;
      return;
    }
    if (data && data.byteLength > 0) {
      chunks.push(
        data.buffer instanceof ArrayBuffer
          ? (data as Uint8Array<ArrayBuffer>)
          : new Uint8Array(data)
      );
    }
  });

  const total = entries.length;
  for (let i = 0; i < total; i++) {
    const entry = entries[i];
    const pass = new ZipPassThrough(entry.name);
    zip.add(pass);

    if (entry.data instanceof Uint8Array) {
      feedBytes(pass, entry.data);
    } else {
      await feedBlob(pass, entry.data);
    }

    if (zipError) throw zipError;
    onProgress?.(i + 1, total);

    // Yield periodically during large batches so the browser UI stays responsive.
    if ((i + 1) % 8 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  zip.end();
  if (zipError) throw zipError;

  return chunks;
}

export async function createStreamingZip(
  entries: readonly ZipEntryInput[],
  onProgress?: (completed: number, total: number) => void
): Promise<Blob> {
  const chunks = await createStreamingZipChunks(entries, onProgress);
  return new Blob(chunks, { type: 'application/zip' });
}

export async function createStreamingZipBytes(
  entries: readonly ZipEntryInput[]
): Promise<Uint8Array> {
  const chunks = await createStreamingZipChunks(entries);
  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function buildZipFilename(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `productprep-${yyyy}-${mm}-${dd}.zip`;
}

<script lang="ts">
  import { formatSavingsLabel, type BatchItem } from '$lib/batch';
  import { formatBytes } from '$lib/settings';

  interface Props {
    item: BatchItem;
    onCompare: (item: BatchItem) => void;
    onDownload: (item: BatchItem) => void;
    onRemove: (id: string) => void;
  }

  let { item, onCompare, onDownload, onRemove }: Props = $props();

  const savings = $derived(
    item.status === 'done' && item.outputBytes !== undefined
      ? formatSavingsLabel(item.originalBytes, item.outputBytes)
      : null
  );

  const stageLabel = $derived.by(() => {
    if (item.status === 'queued') return 'Queued';
    if (item.stage === 'decoding') return 'Reading image...';
    if (item.stage === 'resizing') return 'Resizing...';
    if (item.stage === 'encoding') return 'Compressing...';
    return 'Working...';
  });
  const previewUrl = $derived(item.thumbnailUrl ?? item.outputUrl);
</script>

<article
  class="animate-card-in group flex flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors duration-150 hover:border-zinc-300"
>
  <!-- Thumbnail area -->
  <div class="relative aspect-square w-full overflow-hidden border-b border-zinc-100">
    {#if item.status === 'done' && previewUrl}
      <button
        type="button"
        onclick={() => onCompare(item)}
        aria-label="Compare before and after for {item.originalName}"
        class="checkerboard relative block h-full w-full cursor-pointer p-2 text-left"
      >
        <img
          src={previewUrl}
          alt={item.outputName}
          loading="lazy"
          decoding="async"
          class="h-full w-full object-contain"
        />
        <span
          class="pointer-events-none absolute bottom-2 right-2 rounded-md border border-zinc-200/90 bg-white/95 px-2 py-0.5 text-[11px] font-medium text-zinc-700 opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          Compare
        </span>
      </button>
    {:else if item.status === 'error'}
      <div
        class="flex h-full w-full flex-col items-center justify-center bg-zinc-50 p-4 text-center"
      >
        <span
          class="mb-2 flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-600"
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </span>
        <span class="text-xs font-medium text-rose-700">Failed</span>
      </div>
    {:else}
      <div
        class="checkerboard flex h-full w-full flex-col items-center justify-center p-4 text-center"
      >
        <span
          class="rounded-md bg-white/90 px-2.5 py-1 text-xs font-medium text-zinc-600 shadow-sm"
        >
          {stageLabel}
        </span>
        <div
          class="absolute inset-x-0 bottom-0 h-1 bg-zinc-100"
          role="progressbar"
          aria-label="Processing progress for {item.originalName}"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(item.progress * 100)}
        >
          <div
            class="h-full bg-emerald-500 transition-[width] duration-200 {item.status === 'queued'
              ? 'motion-safe:animate-pulse'
              : ''}"
            style="width: {Math.max(
              item.status === 'working' ? 12 : item.status === 'queued' ? 6 : 0,
              Math.round(item.progress * 100)
            )}%"
          ></div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Details & actions -->
  <div class="flex flex-1 flex-col justify-between gap-2.5 p-3">
    <div class="min-w-0 space-y-1">
      <p class="truncate text-sm font-medium text-zinc-900" title={item.outputName}>
        {item.outputName}
      </p>

      {#if item.status === 'done' && item.outputBytes !== undefined && savings}
        <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums">
          <span class="text-zinc-500">
            {formatBytes(item.originalBytes)} → {formatBytes(item.outputBytes)}
          </span>
          <span
            class="rounded px-1.5 py-0.5 text-[11px] font-medium {savings.isSmaller
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-zinc-100 text-zinc-600'}"
          >
            {savings.label}
          </span>
        </div>
        {#if item.width && item.height}
          <p class="text-[11px] tabular-nums text-zinc-400">
            {item.width} × {item.height} px
          </p>
        {/if}
      {:else if item.status === 'error'}
        <p class="text-xs leading-snug text-rose-700" role="alert">
          {item.error ?? 'Could not process this image.'}
        </p>
      {:else}
        <p class="text-xs tabular-nums text-zinc-500">
          {formatBytes(item.originalBytes)} · {stageLabel}
        </p>
      {/if}

      {#if item.notices.length > 0}
        {#each item.notices as notice (notice)}
          <p class="text-[11px] leading-snug text-amber-700">{notice}</p>
        {/each}
      {/if}
    </div>

    <div class="flex items-center justify-between gap-2 border-t border-zinc-100 pt-2">
      {#if item.status === 'done'}
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            onclick={() => onDownload(item)}
            class="inline-flex h-7 items-center rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
          >
            Download
          </button>
          <button
            type="button"
            onclick={() => onCompare(item)}
            class="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            Compare
          </button>
        </div>
      {:else if item.status === 'queued' || item.status === 'working'}
        <button
          type="button"
          onclick={() => onRemove(item.id)}
          class="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
        >
          Cancel
        </button>
      {:else}
        <span></span>
      {/if}

      <button
        type="button"
        onclick={() => onRemove(item.id)}
        aria-label="Remove {item.originalName}"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  </div>
</article>

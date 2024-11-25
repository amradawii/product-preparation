<script lang="ts">
  import { formatBatchSummary, type BatchStats } from '$lib/batch';

  interface Props {
    stats: BatchStats;
    zipping?: boolean;
    onDownloadAll?: () => void;
    onCancelAll?: () => void;
    onClear: () => void;
  }

  let { stats, zipping = false, onDownloadAll, onCancelAll, onClear }: Props = $props();

  const summary = $derived(formatBatchSummary(stats));
</script>

<footer
  aria-label="Batch actions"
  class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/90 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
>
  <p class="text-sm tabular-nums text-zinc-700" aria-live="polite">
    {summary}
  </p>

  <div class="flex flex-wrap items-center gap-2">
    {#if stats.isProcessing && onCancelAll}
      <button
        type="button"
        onclick={onCancelAll}
        class="inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
      >
        Cancel
      </button>
    {/if}

    {#if onDownloadAll}
      <button
        type="button"
        disabled={stats.doneCount === 0 || zipping}
        onclick={onDownloadAll}
        class="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
      >
        {#if zipping}
          Building zip...
        {:else}
          Download all (.zip)
        {/if}
      </button>
    {/if}

    <button
      type="button"
      onclick={onClear}
      class="inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
    >
      Clear
    </button>
  </div>
</footer>

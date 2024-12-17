<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    computeBatchStats,
    revokeCompareUrls,
    revokeItemUrls,
    triggerBlobDownload,
    type BatchItem
  } from '$lib/batch';
  import { assignUniqueName } from '$lib/pipeline/names';
  import { MAX_FILES } from '$lib/pipeline/types';
  import {
    DEFAULT_SETTINGS,
    loadSettings,
    saveSettings,
    settingsEqual,
    toProcessSettings,
    validateIncomingFiles,
    type FileRejection,
    type UserSettings
  } from '$lib/settings';
  import BatchBar from '$lib/ui/BatchBar.svelte';
  import CompareSlider from '$lib/ui/CompareSlider.svelte';
  import DropZone from '$lib/ui/DropZone.svelte';
  import ResultCard from '$lib/ui/ResultCard.svelte';
  import SettingsBar from '$lib/ui/SettingsBar.svelte';
  import { ImageWorkerPool } from '$lib/worker/pool';
  import { buildZipFilename, createStreamingZip } from '$lib/zip';

  let settings = $state<UserSettings>({ ...DEFAULT_SETTINGS });
  let appliedSettings = $state<UserSettings | null>(null);
  let items = $state<BatchItem[]>([]);
  let rejections = $state<FileRejection[]>([]);
  let comparingId = $state<string | null>(null);
  let zipping = $state(false);
  let hydrated = $state(false);
  let announcement = $state('');
  let hadActiveWork = false;

  let pool: ImageWorkerPool | null = null;
  let nextId = 1;

  const stats = $derived(computeBatchStats(items));
  const hasPendingChanges = $derived(
    items.length > 0 && appliedSettings !== null && !settingsEqual(settings, appliedSettings)
  );
  const comparingItem = $derived(
    comparingId ? (items.find((i) => i.id === comparingId) ?? null) : null
  );

  $effect(() => {
    if (stats.isProcessing) {
      hadActiveWork = true;
    } else if (hadActiveWork && stats.total > 0) {
      hadActiveWork = false;
      if (stats.errorCount > 0) {
        announcement = `Batch finished: ${stats.doneCount} ready, ${stats.errorCount} failed.`;
      } else {
        announcement = `All ${stats.doneCount} ${stats.doneCount === 1 ? 'image is' : 'images are'} ready.`;
      }
    }
  });

  function ensurePool(): ImageWorkerPool | null {
    if (typeof Worker === 'undefined') return null;
    if (!pool) {
      pool = new ImageWorkerPool();
    }
    return pool;
  }

  onMount(() => {
    settings = loadSettings();
    hydrated = true;
  });

  onDestroy(() => {
    pool?.dispose();
    pool = null;
    for (const item of items) {
      revokeItemUrls(item);
    }
  });

  function handleSettingsChange(next: UserSettings) {
    settings = next;
    if (hydrated) {
      saveSettings(next);
    }
  }

  function updateItem(id: string, patch: Partial<BatchItem>) {
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return;
    items[idx] = { ...items[idx], ...patch };
  }

  function enqueueItem(item: BatchItem, runSettings: UserSettings) {
    const activePool = ensurePool();
    if (!activePool) return;

    const procSettings = toProcessSettings(runSettings);
    void activePool
      .submit({
        id: item.id,
        getBuffer: () => item.file.arrayBuffer(),
        settings: procSettings,
        callbacks: {
          onProgress: (stage, progress) => {
            updateItem(item.id, { status: 'working', stage, progress });
          }
        }
      })
      .then((outcome) => {
        const current = items.find((i) => i.id === item.id);
        if (!current) return;

        if (outcome.status === 'done') {
          revokeItemUrls(current);
          const blob = new Blob([outcome.result.outputBuffer], { type: 'image/webp' });
          const thumbBlob = outcome.result.thumbnailBuffer
            ? new Blob([outcome.result.thumbnailBuffer], { type: 'image/webp' })
            : blob;
          const thumbnailUrl = URL.createObjectURL(thumbBlob);
          updateItem(item.id, {
            status: 'done',
            progress: 1,
            stage: undefined,
            outputBlob: blob,
            thumbnailUrl,
            outputUrl: undefined,
            originalUrl: undefined,
            outputBytes: outcome.result.outputBytes,
            width: outcome.result.width,
            height: outcome.result.height,
            originalWidth: outcome.result.originalWidth,
            originalHeight: outcome.result.originalHeight,
            notices: outcome.result.notices,
            error: undefined
          });
        } else if (outcome.status === 'error') {
          updateItem(item.id, {
            status: 'error',
            progress: 0,
            stage: undefined,
            error: outcome.message
          });
        }
      });
  }

  function handleFiles(incoming: File[]) {
    const result = validateIncomingFiles(incoming, items.length);
    if (result.rejections.length > 0) {
      rejections = result.rejections;
    }
    if (result.accepted.length === 0) return;

    const runSettings = { ...settings };
    if (appliedSettings === null) {
      appliedSettings = runSettings;
    }

    const usedNames = new Set(items.map((i) => i.outputName.toLowerCase()));
    const created: BatchItem[] = result.accepted.map((file) => {
      const originalName = file.name || 'image';
      return {
        id: `img-${nextId++}`,
        file,
        originalName,
        outputName: assignUniqueName(originalName, usedNames),
        originalBytes: file.size,
        status: 'queued',
        progress: 0,
        notices: []
      };
    });

    items = [...items, ...created];
    announcement = `Added ${created.length} ${created.length === 1 ? 'image' : 'images'} for processing.`;
    for (const item of created) {
      enqueueItem(item, runSettings);
    }
  }

  function handleApplyAll() {
    if (items.length === 0) return;
    pool?.cancelAll();

    const runSettings = { ...settings };
    appliedSettings = runSettings;

    items = items.map((item) => {
      revokeItemUrls(item);
      return {
        ...item,
        status: 'queued',
        stage: undefined,
        progress: 0,
        outputBlob: undefined,
        thumbnailUrl: undefined,
        outputUrl: undefined,
        originalUrl: undefined,
        outputBytes: undefined,
        notices: [],
        error: undefined
      };
    });

    for (const item of items) {
      enqueueItem(item, runSettings);
    }
  }

  function handleRemove(id: string) {
    pool?.cancel(id);
    const target = items.find((i) => i.id === id);
    if (target) {
      revokeItemUrls(target);
    }
    if (comparingId === id) {
      comparingId = null;
    }
    items = items.filter((i) => i.id !== id);
    if (items.length === 0) {
      appliedSettings = null;
    }
  }

  function handleCancelAll() {
    pool?.cancelAll();
    items = items.filter((item) => {
      if (item.status === 'queued' || item.status === 'working') {
        revokeItemUrls(item);
        return false;
      }
      return true;
    });
    if (items.length === 0) {
      appliedSettings = null;
    }
  }

  function handleClear() {
    pool?.cancelAll();
    for (const item of items) {
      revokeItemUrls(item);
    }
    items = [];
    comparingId = null;
    appliedSettings = null;
    rejections = [];
    hadActiveWork = false;
    announcement = 'Cleared all images.';
  }

  function handleCompare(item: BatchItem) {
    const patch: Partial<BatchItem> = {};
    if (!item.originalUrl) {
      patch.originalUrl = URL.createObjectURL(item.file);
    }
    if (!item.outputUrl && item.outputBlob) {
      patch.outputUrl = URL.createObjectURL(item.outputBlob);
    }
    if (Object.keys(patch).length > 0) {
      updateItem(item.id, patch);
    }
    comparingId = item.id;
  }

  function handleCloseCompare() {
    if (comparingId) {
      const target = items.find((i) => i.id === comparingId);
      if (target) {
        revokeCompareUrls(target);
        updateItem(target.id, { originalUrl: undefined, outputUrl: undefined });
      }
    }
    comparingId = null;
  }

  function handleDownload(item: BatchItem) {
    if (!item.outputBlob) return;
    triggerBlobDownload(item.outputBlob, item.outputName);
  }

  async function handleDownloadAll() {
    if (zipping) return;
    const ready = items.filter((item) => item.status === 'done' && item.outputBlob);
    if (ready.length === 0) return;

    zipping = true;
    try {
      const zipBlob = await createStreamingZip(
        ready.map((item) => ({
          name: item.outputName,
          data: item.outputBlob!
        }))
      );
      triggerBlobDownload(zipBlob, buildZipFilename());
      announcement = `Downloaded zip with ${ready.length} ${ready.length === 1 ? 'image' : 'images'}.`;
    } finally {
      zipping = false;
    }
  }

  function dismissRejections() {
    rejections = [];
  }
</script>

<div class="min-h-screen bg-zinc-50 text-zinc-900">
  <a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-zinc-900 focus:shadow"
  >
    Skip to content
  </a>

  <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
    {announcement}
  </p>

  <header class="border-b border-zinc-200/80 bg-white">
    <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
      <div class="flex items-center gap-2.5">
        <span
          class="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900"
          aria-hidden="true"
        >
          <span class="h-2.5 w-2.5 rounded-sm bg-emerald-500"></span>
        </span>
        <span class="text-[15px] font-semibold tracking-tight text-zinc-900">ProductPrep</span>
      </div>
      <span class="text-xs text-zinc-500">Your images never leave your device</span>
    </div>
  </header>

  <main id="main-content" class="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:py-10">
    <div>
      <h1 class="text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">
        Make product photos ready for your store.
      </h1>
    </div>

    <DropZone
      onFiles={handleFiles}
      compact={items.length > 0}
      disabled={items.length >= MAX_FILES}
    />

    {#if rejections.length > 0}
      <div
        role="status"
        aria-live="polite"
        class="flex items-start justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900"
      >
        <ul class="space-y-1">
          {#each rejections as item (item.name + item.reason)}
            <li>{item.reason}</li>
          {/each}
        </ul>
        <button
          type="button"
          onclick={dismissRejections}
          class="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
        >
          Dismiss
        </button>
      </div>
    {/if}

    <SettingsBar
      {settings}
      onChange={handleSettingsChange}
      {hasPendingChanges}
      onApplyAll={handleApplyAll}
    />

    {#if items.length > 0}
      <section aria-label="Processed images" class="space-y-4">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {#each items as item (item.id)}
            <ResultCard
              {item}
              onCompare={handleCompare}
              onDownload={handleDownload}
              onRemove={handleRemove}
            />
          {/each}
        </div>

        <BatchBar
          {stats}
          {zipping}
          onDownloadAll={handleDownloadAll}
          onCancelAll={handleCancelAll}
          onClear={handleClear}
        />
      </section>
    {:else}
      <p class="text-center text-xs text-zinc-500">
        Photos are converted to WebP right in your browser, with location and camera data removed.
      </p>
    {/if}
  </main>

  {#if comparingItem}
    <CompareSlider item={comparingItem} onClose={handleCloseCompare} onDownload={handleDownload} />
  {/if}
</div>

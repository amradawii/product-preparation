<script lang="ts">
  import { onMount } from 'svelte';
  import { MAX_FILES } from '$lib/pipeline/types';
  import {
    DEFAULT_SETTINGS,
    loadSettings,
    saveSettings,
    validateIncomingFiles,
    type FileRejection,
    type UserSettings
  } from '$lib/settings';
  import DropZone from '$lib/ui/DropZone.svelte';
  import SettingsBar from '$lib/ui/SettingsBar.svelte';

  let settings = $state<UserSettings>({ ...DEFAULT_SETTINGS });
  let queuedFiles = $state<File[]>([]);
  let rejections = $state<FileRejection[]>([]);
  let hydrated = $state(false);

  onMount(() => {
    settings = loadSettings();
    hydrated = true;
  });

  function handleSettingsChange(next: UserSettings) {
    settings = next;
    if (hydrated) {
      saveSettings(next);
    }
  }

  function handleFiles(incoming: File[]) {
    const result = validateIncomingFiles(incoming, queuedFiles.length);
    if (result.accepted.length > 0) {
      queuedFiles = [...queuedFiles, ...result.accepted];
    }
    if (result.rejections.length > 0) {
      rejections = result.rejections;
    }
  }

  function dismissRejections() {
    rejections = [];
  }
</script>

<div class="min-h-screen bg-zinc-50 text-zinc-900">
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

  <main class="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:py-10">
    <div>
      <h1 class="text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">
        Make product photos ready for your store.
      </h1>
    </div>

    <DropZone
      onFiles={handleFiles}
      compact={queuedFiles.length > 0}
      disabled={queuedFiles.length >= MAX_FILES}
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

    <SettingsBar {settings} onChange={handleSettingsChange} />

    {#if queuedFiles.length > 0}
      <p class="text-xs text-zinc-500" aria-live="polite">
        {queuedFiles.length}
        {queuedFiles.length === 1 ? 'image' : 'images'} ready.
      </p>
    {/if}
  </main>
</div>

<script lang="ts">
  import {
    MAX_CUSTOM_DIMENSION,
    MAX_TARGET_KB,
    MIN_CUSTOM_DIMENSION,
    MIN_TARGET_KB,
    type BackgroundPreset,
    type SizePreset,
    type UserSettings
  } from '$lib/settings';
  import { CUSTOM_QUALITY_STEPS, type QualityPreset } from '$lib/pipeline/types';
  import type { FitMode } from '$lib/pipeline/geometry';

  interface Props {
    settings: UserSettings;
    onChange: (next: UserSettings) => void;
    hasPendingChanges?: boolean;
    onApplyAll?: () => void;
  }

  let { settings, onChange, hasPendingChanges = false, onApplyAll }: Props = $props();

  const isKeepSize = $derived(settings.sizePreset === 'keep');

  function update(patch: Partial<UserSettings>) {
    onChange({ ...settings, ...patch });
  }

  function handleSizePreset(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value as SizePreset;
    update({ sizePreset: value });
  }

  function handleCustomWidth(event: Event) {
    const raw = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
    if (!Number.isFinite(raw)) return;
    const width = Math.max(MIN_CUSTOM_DIMENSION, Math.min(MAX_CUSTOM_DIMENSION, raw));
    update(
      settings.lockSquare ? { customWidth: width, customHeight: width } : { customWidth: width }
    );
  }

  function handleCustomHeight(event: Event) {
    const raw = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
    if (!Number.isFinite(raw)) return;
    const height = Math.max(MIN_CUSTOM_DIMENSION, Math.min(MAX_CUSTOM_DIMENSION, raw));
    update(
      settings.lockSquare ? { customWidth: height, customHeight: height } : { customHeight: height }
    );
  }

  function toggleSquareLock() {
    const nextLock = !settings.lockSquare;
    update(
      nextLock ? { lockSquare: true, customHeight: settings.customWidth } : { lockSquare: false }
    );
  }

  function handleFit(event: Event) {
    update({ fit: (event.currentTarget as HTMLSelectElement).value as FitMode });
  }

  function handleBackgroundPreset(event: Event) {
    update({
      backgroundPreset: (event.currentTarget as HTMLSelectElement).value as BackgroundPreset
    });
  }

  function handleBackgroundColor(event: Event) {
    update({ backgroundColor: (event.currentTarget as HTMLInputElement).value });
  }

  function handleQualityPreset(event: Event) {
    update({
      qualityPreset: (event.currentTarget as HTMLSelectElement).value as QualityPreset
    });
  }

  function handleCustomQuality(event: Event) {
    const raw = Number.parseInt((event.currentTarget as HTMLSelectElement).value, 10);
    if (!Number.isFinite(raw)) return;
    update({ customQuality: raw });
  }

  function handleTargetKb(event: Event) {
    const raw = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
    if (!Number.isFinite(raw)) return;
    const kb = Math.max(MIN_TARGET_KB, Math.min(MAX_TARGET_KB, raw));
    update({ targetKb: kb });
  }

  function handleNoEnlarge(event: Event) {
    update({ noEnlarge: (event.currentTarget as HTMLInputElement).checked });
  }
</script>

<section
  aria-label="Output settings"
  class="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <!-- Size -->
    <div class="flex flex-col gap-1.5">
      <label for="setting-size" class="text-xs font-medium text-zinc-600">Size</label>
      <select
        id="setting-size"
        value={settings.sizePreset}
        onchange={handleSizePreset}
        class="h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 transition-colors hover:border-zinc-300"
      >
        <option value="800">800 × 800</option>
        <option value="1000">1000 × 1000</option>
        <option value="1200">1200 × 1200</option>
        <option value="2000">2000 × 2000</option>
        <option value="custom">Custom</option>
        <option value="keep">Keep size</option>
      </select>

      {#if settings.sizePreset === 'custom'}
        <div class="mt-1 flex items-center gap-1.5">
          <input
            type="number"
            aria-label="Custom width in pixels"
            min={MIN_CUSTOM_DIMENSION}
            max={MAX_CUSTOM_DIMENSION}
            value={settings.customWidth}
            onchange={handleCustomWidth}
            class="h-8 w-20 rounded-lg border border-zinc-200 bg-white px-2 text-sm tabular-nums text-zinc-900"
          />
          <span class="text-xs text-zinc-400" aria-hidden="true">×</span>
          <input
            type="number"
            aria-label="Custom height in pixels"
            min={MIN_CUSTOM_DIMENSION}
            max={MAX_CUSTOM_DIMENSION}
            value={settings.customHeight}
            onchange={handleCustomHeight}
            class="h-8 w-20 rounded-lg border border-zinc-200 bg-white px-2 text-sm tabular-nums text-zinc-900"
          />
          <button
            type="button"
            aria-pressed={settings.lockSquare}
            aria-label="Keep square"
            title={settings.lockSquare ? 'Square locked (click to unlock)' : 'Square unlocked'}
            onclick={toggleSquareLock}
            class="inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-medium transition-colors {settings.lockSquare
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300'}"
          >
            Square
          </button>
        </div>
      {/if}
    </div>

    <!-- Fit -->
    <div class="flex flex-col gap-1.5">
      <label
        for="setting-fit"
        class="text-xs font-medium {isKeepSize ? 'text-zinc-400' : 'text-zinc-600'}"
      >
        Fit
      </label>
      <select
        id="setting-fit"
        value={settings.fit}
        disabled={isKeepSize}
        onchange={handleFit}
        class="h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 transition-colors hover:border-zinc-300 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
      >
        <option value="fit">Fit inside</option>
        <option value="fill">Fill and crop</option>
      </select>
      {#if isKeepSize}
        <span class="text-[11px] text-zinc-400">Original dimensions are kept</span>
      {/if}
    </div>

    <!-- Background -->
    <div class="flex flex-col gap-1.5">
      <label for="setting-background" class="text-xs font-medium text-zinc-600">Background</label>
      <div class="flex items-center gap-2">
        <select
          id="setting-background"
          value={settings.backgroundPreset}
          onchange={handleBackgroundPreset}
          class="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 transition-colors hover:border-zinc-300"
        >
          <option value="white">White</option>
          <option value="custom">Custom colour</option>
          <option value="transparent">Transparent</option>
        </select>

        {#if settings.backgroundPreset === 'custom'}
          <label
            class="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 text-xs font-mono text-zinc-600 hover:border-zinc-300"
          >
            <input
              type="color"
              aria-label="Custom background colour"
              value={settings.backgroundColor}
              oninput={handleBackgroundColor}
              class="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <span class="uppercase">{settings.backgroundColor}</span>
          </label>
        {/if}
      </div>
    </div>

    <!-- Quality -->
    <div class="flex flex-col gap-1.5">
      <label for="setting-quality" class="text-xs font-medium text-zinc-600">Quality</label>
      <div class="flex items-center gap-2">
        <select
          id="setting-quality"
          value={settings.qualityPreset}
          onchange={handleQualityPreset}
          class="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 transition-colors hover:border-zinc-300"
        >
          <option value="best">Best for stores</option>
          <option value="smaller">Smaller files</option>
          <option value="lossless">Lossless</option>
          <option value="target">Target size</option>
          <option value="custom">Custom (%)</option>
        </select>

        {#if settings.qualityPreset === 'custom'}
          <select
            aria-label="Custom quality percentage"
            value={settings.customQuality}
            onchange={handleCustomQuality}
            class="h-9 shrink-0 rounded-lg border border-zinc-200 bg-white px-2 text-sm tabular-nums text-zinc-900 transition-colors hover:border-zinc-300"
          >
            {#each CUSTOM_QUALITY_STEPS as pct (pct)}
              <option value={pct}>{pct}%</option>
            {/each}
          </select>
        {/if}

        {#if settings.qualityPreset === 'target'}
          <div class="flex shrink-0 items-center gap-1">
            <input
              type="number"
              aria-label="Target file size in kilobytes"
              min={MIN_TARGET_KB}
              max={MAX_TARGET_KB}
              value={settings.targetKb}
              onchange={handleTargetKb}
              class="h-9 w-20 rounded-lg border border-zinc-200 bg-white px-2 text-sm tabular-nums text-zinc-900"
            />
            <span class="text-xs text-zinc-500">KB</span>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Secondary row: Don't enlarge + Apply to all -->
  <div
    class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3.5"
  >
    <div class="flex flex-wrap items-center gap-2">
      <label
        class="inline-flex items-center gap-2 text-sm {isKeepSize
          ? 'cursor-not-allowed text-zinc-400'
          : 'cursor-pointer text-zinc-700'}"
      >
        <input
          type="checkbox"
          checked={settings.noEnlarge}
          disabled={isKeepSize}
          onchange={handleNoEnlarge}
          class="h-4 w-4 rounded border-zinc-300 accent-emerald-600 disabled:cursor-not-allowed"
        />
        <span>Don't enlarge small images</span>
      </label>
      {#if isKeepSize}
        <span class="text-xs text-zinc-400">· Not used with Keep size</span>
      {/if}
    </div>

    {#if hasPendingChanges && onApplyAll}
      <button
        type="button"
        onclick={onApplyAll}
        class="inline-flex h-8 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100/70"
      >
        Apply to all images
      </button>
    {/if}
  </div>
</section>

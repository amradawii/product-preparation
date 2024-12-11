<script lang="ts">
  import { onMount } from 'svelte';
  import { formatSavingsLabel, type BatchItem } from '$lib/batch';
  import { formatBytes } from '$lib/settings';

  interface Props {
    item: BatchItem;
    onClose: () => void;
    onDownload: (item: BatchItem) => void;
  }

  let { item, onClose, onDownload }: Props = $props();

  let position = $state(50);
  let dragging = $state(false);
  let stageEl: HTMLDivElement | undefined = $state();
  let dialogEl: HTMLDivElement | undefined = $state();
  let sliderEl: HTMLDivElement | undefined = $state();

  const savings = $derived(
    item.outputBytes !== undefined ? formatSavingsLabel(item.originalBytes, item.outputBytes) : null
  );

  onMount(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sliderEl?.focus();

    return () => {
      previousFocus?.focus();
    };
  });

  function clampPosition(value: number): number {
    return Math.max(0, Math.min(100, value));
  }

  function updateFromClientX(clientX: number) {
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    position = clampPosition(pct);
  }

  function handlePointerDown(event: PointerEvent) {
    if (!stageEl) return;
    dragging = true;
    if (typeof stageEl.setPointerCapture === 'function') {
      stageEl.setPointerCapture(event.pointerId);
    }
    updateFromClientX(event.clientX);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragging) return;
    updateFromClientX(event.clientX);
  }

  function handlePointerUp(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    if (stageEl && typeof stageEl.releasePointerCapture === 'function') {
      try {
        stageEl.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore if pointer capture was already released.
      }
    }
  }

  function handleSliderKeydown(event: KeyboardEvent) {
    const step = event.shiftKey ? 1 : 5;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      position = clampPosition(position - step);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      position = clampPosition(position + step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      position = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      position = 100;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'Tab' && dialogEl) {
      const focusables = Array.from(
        dialogEl.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialogEl.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogEl.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
  <button
    type="button"
    tabindex="-1"
    aria-label="Close comparison"
    onclick={onClose}
    class="fixed inset-0 bg-zinc-950/60"
  ></button>

  <div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-label="Before and after comparison for {item.originalName}"
    class="animate-dialog-in relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl"
  >
    <!-- Header -->
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3.5"
    >
      <div class="min-w-0">
        <h2 class="truncate text-sm font-semibold text-zinc-900">{item.outputName}</h2>
        <p class="mt-0.5 text-xs tabular-nums text-zinc-500">
          Before: {formatBytes(item.originalBytes)}
          {#if item.originalWidth && item.originalHeight}
            ({item.originalWidth} × {item.originalHeight})
          {/if}
          · After: {formatBytes(item.outputBytes ?? 0)}
          {#if item.width && item.height}
            ({item.width} × {item.height})
          {/if}
          {#if savings}
            · <span class={savings.isSmaller ? 'font-medium text-emerald-700' : 'text-zinc-600'}
              >{savings.label}</span
            >
          {/if}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          onclick={() => onDownload(item)}
          class="inline-flex h-8 items-center rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
        >
          Download WebP
        </button>
        <button
          type="button"
          onclick={onClose}
          aria-label="Close comparison"
          class="inline-flex h-8 items-center rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          Close
        </button>
      </div>
    </div>

    <!-- Split comparison stage -->
    <div class="flex flex-1 items-center justify-center overflow-hidden bg-zinc-100/70 p-4">
      <div
        bind:this={stageEl}
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerUp}
        class="checkerboard relative aspect-square max-h-[68vh] w-full max-w-[68vh] cursor-ew-resize touch-none select-none overflow-hidden rounded-lg border border-zinc-200"
      >
        <!-- After (WebP) full background layer -->
        {#if item.outputUrl}
          <img
            src={item.outputUrl}
            alt="Processed WebP output for {item.outputName}"
            draggable="false"
            class="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
        {/if}

        <!-- Before (original) clipped to the left side of the divider -->
        {#if item.originalUrl}
          <div
            class="pointer-events-none absolute inset-0"
            style="clip-path: inset(0 {100 - position}% 0 0)"
          >
            <img
              src={item.originalUrl}
              alt="Original image {item.originalName}"
              draggable="false"
              class="h-full w-full object-contain"
            />
          </div>
        {/if}

        <!-- Corner labels -->
        <span
          class="pointer-events-none absolute left-3 top-3 rounded-md bg-zinc-900/75 px-2 py-0.5 text-[11px] font-medium text-white"
        >
          Before
        </span>
        <span
          class="pointer-events-none absolute right-3 top-3 rounded-md bg-zinc-900/75 px-2 py-0.5 text-[11px] font-medium text-white"
        >
          After (WebP)
        </span>

        <!-- Divider line & keyboard-accessible handle -->
        <div
          class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(24,24,27,0.2)]"
          style="left: {position}%"
        ></div>

        <div
          bind:this={sliderEl}
          role="slider"
          tabindex="0"
          aria-label="Before and after split position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(position)}
          onkeydown={handleSliderKeydown}
          class="absolute top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 shadow-md transition-transform hover:scale-105"
          style="left: {position}%"
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
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
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
            aria-hidden="true"
            class="-ml-2"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </div>
    </div>

    <!-- Footer hint -->
    <div class="border-t border-zinc-100 px-5 py-2.5 text-center text-xs text-zinc-500">
      Drag the divider or use left and right arrow keys to compare. Press Escape to close.
    </div>
  </div>
</div>

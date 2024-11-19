<script lang="ts">
  interface Props {
    onFiles: (files: File[]) => void;
    compact?: boolean;
    disabled?: boolean;
  }

  let { onFiles, compact = false, disabled = false }: Props = $props();

  let inputEl: HTMLInputElement | undefined = $state();
  let dragDepth = $state(0);
  const isDragging = $derived(dragDepth > 0 && !disabled);

  function openPicker() {
    if (disabled) return;
    inputEl?.click();
  }

  function handleInputChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const list = target.files;
    if (list && list.length > 0) {
      onFiles(Array.from(list));
    }
    target.value = '';
  }

  function handleDragEnter(event: DragEvent) {
    event.preventDefault();
    if (disabled) return;
    dragDepth += 1;
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    }
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragDepth = 0;
    if (disabled) return;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      onFiles(Array.from(files));
    }
  }

  function handleWindowPaste(event: ClipboardEvent) {
    if (disabled) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement &&
      active.type !== 'file' &&
      active.type !== 'checkbox' &&
      active.type !== 'button'
    ) {
      return;
    }

    const items = event.clipboardData?.items;
    const collected: File[] = [];

    if (items && items.length > 0) {
      let idx = 1;
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const raw = item.getAsFile();
          if (raw) {
            if (raw.name) {
              collected.push(raw);
            } else {
              const ext = raw.type.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
              collected.push(new File([raw], `pasted-image-${idx++}.${ext}`, { type: raw.type }));
            }
          }
        }
      }
    } else if (event.clipboardData?.files && event.clipboardData.files.length > 0) {
      collected.push(...Array.from(event.clipboardData.files));
    }

    if (collected.length > 0) {
      event.preventDefault();
      onFiles(collected);
    }
  }
</script>

<svelte:window onpaste={handleWindowPaste} />

<div
  role="region"
  aria-label="Image upload drop zone"
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  class="rounded-xl border border-dashed transition-colors duration-150 {isDragging
    ? 'border-emerald-500 bg-emerald-50/50'
    : disabled
      ? 'border-zinc-200 bg-zinc-100/70'
      : 'border-zinc-300 bg-white hover:border-zinc-400'}"
>
  <input
    bind:this={inputEl}
    type="file"
    multiple
    accept="image/jpeg,image/png,image/gif,image/svg+xml,image/bmp,image/webp,image/avif,.jpg,.jpeg,.png,.gif,.svg,.bmp,.webp,.avif"
    class="sr-only"
    aria-label="Choose images to convert"
    {disabled}
    onchange={handleInputChange}
  />

  <button
    type="button"
    {disabled}
    onclick={openPicker}
    class="flex w-full flex-col items-center justify-center rounded-xl text-center transition-colors duration-150 disabled:cursor-not-allowed {compact
      ? 'px-6 py-5'
      : 'px-6 py-11 sm:py-14'}"
  >
    <span
      class="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border transition-colors duration-150 {isDragging
        ? 'border-emerald-300 bg-emerald-100/70 text-emerald-700'
        : 'border-zinc-200 bg-zinc-50 text-zinc-500'}"
      aria-hidden="true"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    </span>

    <span class="text-[15px] font-medium text-zinc-900">
      {#if disabled}
        Batch limit reached (200 files)
      {:else if isDragging}
        Release to add images
      {:else}
        Drop images or click to choose
      {/if}
    </span>

    <span class="mt-1.5 text-xs text-zinc-500">
      {#if disabled}
        Clear some images to add more.
      {:else}
        JPG, PNG, GIF, SVG, BMP, WebP, AVIF · Up to 200 files, 40 MB each · Paste works too
      {/if}
    </span>
  </button>
</div>

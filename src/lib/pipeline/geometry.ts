export type FitMode = 'fit' | 'fill';
export type SizeMode = 'fixed' | 'keep';

export interface GeometryInput {
  srcWidth: number;
  srcHeight: number;
  sizeMode: SizeMode;
  targetWidth: number;
  targetHeight: number;
  fit: FitMode;
  noEnlarge: boolean;
  /** Vector inputs (SVG) ignore noEnlarge and always rasterise at target size. */
  isVector?: boolean;
}

export interface GeometryPlan {
  canvasWidth: number;
  canvasHeight: number;
  scaledWidth: number;
  scaledHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  needsResize: boolean;
  hasPadding: boolean;
}

export function computeGeometry(input: GeometryInput): GeometryPlan {
  const srcWidth = Math.max(1, Math.round(input.srcWidth));
  const srcHeight = Math.max(1, Math.round(input.srcHeight));

  if (input.sizeMode === 'keep') {
    return {
      canvasWidth: srcWidth,
      canvasHeight: srcHeight,
      scaledWidth: srcWidth,
      scaledHeight: srcHeight,
      cropX: 0,
      cropY: 0,
      cropWidth: srcWidth,
      cropHeight: srcHeight,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      needsResize: false,
      hasPadding: false
    };
  }

  const canvasWidth = Math.max(1, Math.round(input.targetWidth));
  const canvasHeight = Math.max(1, Math.round(input.targetHeight));

  const scaleX = canvasWidth / srcWidth;
  const scaleY = canvasHeight / srcHeight;
  const rawScale = input.fit === 'fit' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);

  const capEnlarge = input.noEnlarge && !input.isVector;
  const scale = capEnlarge ? Math.min(1, rawScale) : rawScale;

  let scaledWidth: number;
  let scaledHeight: number;

  if (scale === 1) {
    scaledWidth = srcWidth;
    scaledHeight = srcHeight;
  } else {
    scaledWidth = Math.max(1, Math.round(srcWidth * scale));
    scaledHeight = Math.max(1, Math.round(srcHeight * scale));

    if (input.fit === 'fit') {
      if (scaledWidth > canvasWidth) scaledWidth = canvasWidth;
      if (scaledHeight > canvasHeight) scaledHeight = canvasHeight;
    } else if (!capEnlarge || rawScale <= 1) {
      if (scaledWidth < canvasWidth) scaledWidth = canvasWidth;
      if (scaledHeight < canvasHeight) scaledHeight = canvasHeight;
    }
  }

  const cropWidth = Math.min(scaledWidth, canvasWidth);
  const cropHeight = Math.min(scaledHeight, canvasHeight);
  const cropX = Math.floor((scaledWidth - cropWidth) / 2);
  const cropY = Math.floor((scaledHeight - cropHeight) / 2);
  const offsetX = Math.floor((canvasWidth - cropWidth) / 2);
  const offsetY = Math.floor((canvasHeight - cropHeight) / 2);

  return {
    canvasWidth,
    canvasHeight,
    scaledWidth,
    scaledHeight,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    offsetX,
    offsetY,
    scale,
    needsResize: scaledWidth !== srcWidth || scaledHeight !== srcHeight,
    hasPadding: cropWidth < canvasWidth || cropHeight < canvasHeight
  };
}

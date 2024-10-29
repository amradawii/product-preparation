import { describe, expect, it } from 'vitest';
import { computeGeometry, type GeometryInput } from '../../src/lib/pipeline/geometry';

interface GeometryCase {
  name: string;
  input: GeometryInput;
  expected: {
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
    needsResize: boolean;
    hasPadding: boolean;
  };
}

const cases: GeometryCase[] = [
  {
    name: 'landscape fit into 800x800',
    input: {
      srcWidth: 1600,
      srcHeight: 800,
      sizeMode: 'fixed',
      targetWidth: 800,
      targetHeight: 800,
      fit: 'fit',
      noEnlarge: true
    },
    expected: {
      canvasWidth: 800,
      canvasHeight: 800,
      scaledWidth: 800,
      scaledHeight: 400,
      cropX: 0,
      cropY: 0,
      cropWidth: 800,
      cropHeight: 400,
      offsetX: 0,
      offsetY: 200,
      needsResize: true,
      hasPadding: true
    }
  },
  {
    name: 'portrait fit into 800x800',
    input: {
      srcWidth: 900,
      srcHeight: 1800,
      sizeMode: 'fixed',
      targetWidth: 800,
      targetHeight: 800,
      fit: 'fit',
      noEnlarge: true
    },
    expected: {
      canvasWidth: 800,
      canvasHeight: 800,
      scaledWidth: 400,
      scaledHeight: 800,
      cropX: 0,
      cropY: 0,
      cropWidth: 400,
      cropHeight: 800,
      offsetX: 200,
      offsetY: 0,
      needsResize: true,
      hasPadding: true
    }
  },
  {
    name: 'square exact match skips resize',
    input: {
      srcWidth: 800,
      srcHeight: 800,
      sizeMode: 'fixed',
      targetWidth: 800,
      targetHeight: 800,
      fit: 'fit',
      noEnlarge: true
    },
    expected: {
      canvasWidth: 800,
      canvasHeight: 800,
      scaledWidth: 800,
      scaledHeight: 800,
      cropX: 0,
      cropY: 0,
      cropWidth: 800,
      cropHeight: 800,
      offsetX: 0,
      offsetY: 0,
      needsResize: false,
      hasPadding: false
    }
  },
  {
    name: 'tiny photo centered without enlarging when noEnlarge is true',
    input: {
      srcWidth: 400,
      srcHeight: 300,
      sizeMode: 'fixed',
      targetWidth: 800,
      targetHeight: 800,
      fit: 'fit',
      noEnlarge: true
    },
    expected: {
      canvasWidth: 800,
      canvasHeight: 800,
      scaledWidth: 400,
      scaledHeight: 300,
      cropX: 0,
      cropY: 0,
      cropWidth: 400,
      cropHeight: 300,
      offsetX: 200,
      offsetY: 250,
      needsResize: false,
      hasPadding: true
    }
  },
  {
    name: 'tiny photo enlarged when noEnlarge is false',
    input: {
      srcWidth: 400,
      srcHeight: 300,
      sizeMode: 'fixed',
      targetWidth: 800,
      targetHeight: 800,
      fit: 'fit',
      noEnlarge: false
    },
    expected: {
      canvasWidth: 800,
      canvasHeight: 800,
      scaledWidth: 800,
      scaledHeight: 600,
      cropX: 0,
      cropY: 0,
      cropWidth: 800,
      cropHeight: 600,
      offsetX: 0,
      offsetY: 100,
      needsResize: true,
      hasPadding: true
    }
  },
  {
    name: 'small SVG ignores noEnlarge and scales cleanly to target size',
    input: {
      srcWidth: 64,
      srcHeight: 48,
      sizeMode: 'fixed',
      targetWidth: 800,
      targetHeight: 800,
      fit: 'fit',
      noEnlarge: true,
      isVector: true
    },
    expected: {
      canvasWidth: 800,
      canvasHeight: 800,
      scaledWidth: 800,
      scaledHeight: 600,
      cropX: 0,
      cropY: 0,
      cropWidth: 800,
      cropHeight: 600,
      offsetX: 0,
      offsetY: 100,
      needsResize: true,
      hasPadding: true
    }
  },
  {
    name: 'huge 6000x4000 landscape fill-and-crop into 800x800',
    input: {
      srcWidth: 6000,
      srcHeight: 4000,
      sizeMode: 'fixed',
      targetWidth: 800,
      targetHeight: 800,
      fit: 'fill',
      noEnlarge: true
    },
    expected: {
      canvasWidth: 800,
      canvasHeight: 800,
      scaledWidth: 1200,
      scaledHeight: 800,
      cropX: 200,
      cropY: 0,
      cropWidth: 800,
      cropHeight: 800,
      offsetX: 0,
      offsetY: 0,
      needsResize: true,
      hasPadding: false
    }
  },
  {
    name: 'tall thin small photo fill-and-crop with noEnlarge crops vertically without upscaling width',
    input: {
      srcWidth: 400,
      srcHeight: 1200,
      sizeMode: 'fixed',
      targetWidth: 800,
      targetHeight: 800,
      fit: 'fill',
      noEnlarge: true
    },
    expected: {
      canvasWidth: 800,
      canvasHeight: 800,
      scaledWidth: 400,
      scaledHeight: 1200,
      cropX: 0,
      cropY: 200,
      cropWidth: 400,
      cropHeight: 800,
      offsetX: 200,
      offsetY: 0,
      needsResize: false,
      hasPadding: true
    }
  },
  {
    name: 'odd dimensions 1001x333 fit into 800x800',
    input: {
      srcWidth: 1001,
      srcHeight: 333,
      sizeMode: 'fixed',
      targetWidth: 800,
      targetHeight: 800,
      fit: 'fit',
      noEnlarge: true
    },
    expected: {
      canvasWidth: 800,
      canvasHeight: 800,
      scaledWidth: 800,
      scaledHeight: 266,
      cropX: 0,
      cropY: 0,
      cropWidth: 800,
      cropHeight: 266,
      offsetX: 0,
      offsetY: 267,
      needsResize: true,
      hasPadding: true
    }
  },
  {
    name: 'non-square portrait target 1200x1600 with square source',
    input: {
      srcWidth: 2000,
      srcHeight: 2000,
      sizeMode: 'fixed',
      targetWidth: 1200,
      targetHeight: 1600,
      fit: 'fit',
      noEnlarge: true
    },
    expected: {
      canvasWidth: 1200,
      canvasHeight: 1600,
      scaledWidth: 1200,
      scaledHeight: 1200,
      cropX: 0,
      cropY: 0,
      cropWidth: 1200,
      cropHeight: 1200,
      offsetX: 0,
      offsetY: 200,
      needsResize: true,
      hasPadding: true
    }
  },
  {
    name: 'keep size preserves original dimensions and skips resize',
    input: {
      srcWidth: 1234,
      srcHeight: 987,
      sizeMode: 'keep',
      targetWidth: 800,
      targetHeight: 800,
      fit: 'fit',
      noEnlarge: true
    },
    expected: {
      canvasWidth: 1234,
      canvasHeight: 987,
      scaledWidth: 1234,
      scaledHeight: 987,
      cropX: 0,
      cropY: 0,
      cropWidth: 1234,
      cropHeight: 987,
      offsetX: 0,
      offsetY: 0,
      needsResize: false,
      hasPadding: false
    }
  }
];

describe('computeGeometry', () => {
  it.each(cases)('$name', ({ input, expected }) => {
    const plan = computeGeometry(input);
    expect(plan).toMatchObject(expected);

    // Aspect ratio invariant: scaled dimensions never stretch the source.
    const srcRatio = input.srcWidth / input.srcHeight;
    const scaledRatio = plan.scaledWidth / plan.scaledHeight;
    expect(Math.abs(scaledRatio - srcRatio) / srcRatio).toBeLessThan(0.01);
  });
});

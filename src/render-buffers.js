import { DISPLAY_SIZE, FIELD_SIZE } from './config.js';

const isLittleEndian = new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44;
export function packRGBA(r, g, b, a) {
    return isLittleEndian
        ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
        : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

export const SCOPE_BG = '#020a05';
export const SCOPE_BG_RGB = '2, 10, 5';
export const NODAL_BASE = { r: 70, g: 255, b: 130 };

export const nodalColorLUT = new Uint32Array(256);
export const particleColorLUT = new Uint32Array(256);
for (let a = 0; a < 256; a++) {
    nodalColorLUT[a] = packRGBA(NODAL_BASE.r, NODAL_BASE.g, NODAL_BASE.b, a);
    particleColorLUT[a] = packRGBA(205, 255, 220, a);
}

function createLayer(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    return { canvas, ctx, imageData, pixels32: new Uint32Array(imageData.data.buffer) };
}

export function createPlateBuffers() {
    const nodal = createLayer(FIELD_SIZE);
    const gold = createLayer(FIELD_SIZE);
    const clash = createLayer(FIELD_SIZE);
    const particle = createLayer(DISPLAY_SIZE);

    const trailCanvas = document.createElement('canvas');
    trailCanvas.width = DISPLAY_SIZE;
    trailCanvas.height = DISPLAY_SIZE;
    const trailCtx = trailCanvas.getContext('2d');
    trailCtx.fillStyle = SCOPE_BG;
    trailCtx.fillRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);

    return {
        nodalCanvas: nodal.canvas, nodalCtx: nodal.ctx, nodalImageData: nodal.imageData, nodalPixels32: nodal.pixels32,
        goldCanvas: gold.canvas, goldCtx: gold.ctx, goldImageData: gold.imageData, goldPixels32: gold.pixels32,
        clashCanvas: clash.canvas, clashCtx: clash.ctx, clashImageData: clash.imageData, clashPixels32: clash.pixels32,
        particleStampCanvas: particle.canvas, particleStampCtx: particle.ctx, particleImageData: particle.imageData, particlePixels32: particle.pixels32,
        trailCanvas, trailCtx
    };
}

export const MAIN_PLATE = createPlateBuffers();
export let nodalCanvas, nodalCtx, nodalImageData, nodalPixels32, goldCanvas, goldCtx, goldImageData, goldPixels32, clashCanvas, clashCtx, clashImageData, clashPixels32, particleStampCanvas, particleStampCtx, particleImageData, particlePixels32, trailCanvas, trailCtx;
export function bindPlateBuffers(b) {
    nodalCanvas = b.nodalCanvas;
    nodalCtx = b.nodalCtx;
    nodalImageData = b.nodalImageData;
    nodalPixels32 = b.nodalPixels32;
    goldCanvas = b.goldCanvas;
    goldCtx = b.goldCtx;
    goldImageData = b.goldImageData;
    goldPixels32 = b.goldPixels32;
    clashCanvas = b.clashCanvas;
    clashCtx = b.clashCtx;
    clashImageData = b.clashImageData;
    clashPixels32 = b.clashPixels32;
    particleStampCanvas = b.particleStampCanvas;
    particleStampCtx = b.particleStampCtx;
    particleImageData = b.particleImageData;
    particlePixels32 = b.particlePixels32;
    trailCanvas = b.trailCanvas;
    trailCtx = b.trailCtx;
}
bindPlateBuffers(MAIN_PLATE);

export const graticuleCanvas = document.createElement('canvas');
graticuleCanvas.width = DISPLAY_SIZE;
graticuleCanvas.height = DISPLAY_SIZE;
(function buildGraticule() {
    const g = graticuleCanvas.getContext('2d');
    const divs = 10;
    const step = DISPLAY_SIZE / divs;
    const mid = DISPLAY_SIZE / 2;
    g.lineWidth = 1;

    g.strokeStyle = 'rgba(61, 255, 122, 0.13)';
    g.beginPath();
    for (let i = 1; i < divs; i++) {
        const p = Math.round(i * step) + 0.5;
        g.moveTo(p, 0); g.lineTo(p, DISPLAY_SIZE);
        g.moveTo(0, p); g.lineTo(DISPLAY_SIZE, p);
    }
    g.stroke();

    g.strokeStyle = 'rgba(61, 255, 122, 0.34)';
    g.beginPath();
    g.moveTo(mid + 0.5, 0); g.lineTo(mid + 0.5, DISPLAY_SIZE);
    g.moveTo(0, mid + 0.5); g.lineTo(DISPLAY_SIZE, mid + 0.5);
    g.stroke();

    g.beginPath();
    for (let i = 0; i <= divs * 5; i++) {
        const p = Math.round(i * step / 5) + 0.5;
        const len = (i % 5 === 0) ? 7 : 4;
        g.moveTo(p, mid - len); g.lineTo(p, mid + len);
        g.moveTo(mid - len, p); g.lineTo(mid + len, p);
    }
    g.stroke();

    g.strokeStyle = 'rgba(61, 255, 122, 0.4)';
    g.strokeRect(0.5, 0.5, DISPLAY_SIZE - 1, DISPLAY_SIZE - 1);
})();

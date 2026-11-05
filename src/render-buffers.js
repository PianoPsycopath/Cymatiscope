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

function createTrail(size) {
    const trailCanvas = document.createElement('canvas');
    trailCanvas.width = size;
    trailCanvas.height = size;
    const trailCtx = trailCanvas.getContext('2d');
    trailCtx.fillStyle = SCOPE_BG;
    trailCtx.fillRect(0, 0, size, size);
    return { trailCanvas, trailCtx };
}

export function createPlateBuffers(size = DISPLAY_SIZE) {
    const nodal = createLayer(FIELD_SIZE);
    const gold = createLayer(FIELD_SIZE);
    const clash = createLayer(FIELD_SIZE);
    const particle = createLayer(size);
    const { trailCanvas, trailCtx } = createTrail(size);

    return {
        nodalCanvas: nodal.canvas, nodalCtx: nodal.ctx, nodalImageData: nodal.imageData, nodalPixels32: nodal.pixels32,
        goldCanvas: gold.canvas, goldCtx: gold.ctx, goldImageData: gold.imageData, goldPixels32: gold.pixels32,
        clashCanvas: clash.canvas, clashCtx: clash.ctx, clashImageData: clash.imageData, clashPixels32: clash.pixels32,
        particleStampCanvas: particle.canvas, particleStampCtx: particle.ctx, particleImageData: particle.imageData, particlePixels32: particle.pixels32,
        trailCanvas, trailCtx,
        size
    };
}

export const MAIN_PLATE = createPlateBuffers();
export let nodalCanvas, nodalCtx, nodalImageData, nodalPixels32, goldCanvas, goldCtx, goldImageData, goldPixels32, clashCanvas, clashCtx, clashImageData, clashPixels32, particleStampCanvas, particleStampCtx, particleImageData, particlePixels32, trailCanvas, trailCtx;
export let plateSize = DISPLAY_SIZE;
let boundPlate = MAIN_PLATE;
export function bindPlateBuffers(b) {
    boundPlate = b;
    plateSize = b.size;
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

// Rebuild the particle layer and trail of the bound plate at a new pixel size.
export function resizeBoundPlate(size) {
    if (boundPlate.size === size) return;
    const particle = createLayer(size);
    const trail = createTrail(size);
    boundPlate.particleStampCanvas = particle.canvas;
    boundPlate.particleStampCtx = particle.ctx;
    boundPlate.particleImageData = particle.imageData;
    boundPlate.particlePixels32 = particle.pixels32;
    boundPlate.trailCanvas = trail.trailCanvas;
    boundPlate.trailCtx = trail.trailCtx;
    boundPlate.size = size;
    bindPlateBuffers(boundPlate);
}

const graticuleCache = new Map();
export function getGraticule(size) {
    let cv = graticuleCache.get(size);
    if (cv) return cv;
    cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const g = cv.getContext('2d');
    const k = size / DISPLAY_SIZE;
    const lw = Math.max(1, Math.round(k));
    const o = (lw % 2) / 2;
    const divs = 10;
    const step = size / divs;
    const mid = size / 2;
    g.lineWidth = lw;

    g.strokeStyle = 'rgba(61, 255, 122, 0.13)';
    g.beginPath();
    for (let i = 1; i < divs; i++) {
        const p = Math.round(i * step) + o;
        g.moveTo(p, 0); g.lineTo(p, size);
        g.moveTo(0, p); g.lineTo(size, p);
    }
    g.stroke();

    g.strokeStyle = 'rgba(61, 255, 122, 0.34)';
    g.beginPath();
    g.moveTo(mid + o, 0); g.lineTo(mid + o, size);
    g.moveTo(0, mid + o); g.lineTo(size, mid + o);
    g.stroke();

    g.beginPath();
    for (let i = 0; i <= divs * 5; i++) {
        const p = Math.round(i * step / 5) + o;
        const len = ((i % 5 === 0) ? 7 : 4) * k;
        g.moveTo(p, mid - len); g.lineTo(p, mid + len);
        g.moveTo(mid - len, p); g.lineTo(mid + len, p);
    }
    g.stroke();

    g.strokeStyle = 'rgba(61, 255, 122, 0.4)';
    g.strokeRect(lw / 2, lw / 2, size - lw, size - lw);
    graticuleCache.set(size, cv);
    return cv;
}
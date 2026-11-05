import { DISPLAY_SIZE, FIELD_SIZE, NUM_PARTICLES, state } from './config.js';
import { ampField } from './lookup-tables.js';
import {
    particleColorLUT,
    particleImageData,
    particlePixels32,
    particleStampCanvas,
    particleStampCtx,
    SCOPE_BG_RGB,
    trailCtx,
} from './render-buffers.js';
import { fieldModeCount } from './wave-field.js';
import { joltShape3D } from './shape-3d.js';
import { fxVisSoft } from './fx-plate.js';
import { joltMultiView, multiViewActive } from './multi-view.js';

function seedParticleSet(s) {
    for (let i = 0; i < NUM_PARTICLES; i++) {
        s.pxArr[i] = Math.random() * 2 - 1;
        s.pyArr[i] = Math.random() * 2 - 1;
        s.pvxArr[i] = 0;
        s.pvyArr[i] = 0;
        s.pFricArr[i] = 0.80 + Math.random() * 0.08;
        s.pSpeedArr[i] = 0.0085 + Math.random() * 0.0045;
    }
}

export function createParticleSet() {
    const s = {
        pxArr: new Float32Array(NUM_PARTICLES),
        pyArr: new Float32Array(NUM_PARTICLES),
        pvxArr: new Float32Array(NUM_PARTICLES),
        pvyArr: new Float32Array(NUM_PARTICLES),
        pFricArr: new Float32Array(NUM_PARTICLES),
        pSpeedArr: new Float32Array(NUM_PARTICLES)
    };
    seedParticleSet(s);
    return s;
}

export const MAIN_PARTICLES = createParticleSet();
export let pxArr = MAIN_PARTICLES.pxArr;
export let pyArr = MAIN_PARTICLES.pyArr;
let pvxArr = MAIN_PARTICLES.pvxArr;
let pvyArr = MAIN_PARTICLES.pvyArr;
let pFricArr = MAIN_PARTICLES.pFricArr;
let pSpeedArr = MAIN_PARTICLES.pSpeedArr;

export function bindParticleSet(s) {
    pxArr = s.pxArr;
    pyArr = s.pyArr;
    pvxArr = s.pvxArr;
    pvyArr = s.pvyArr;
    pFricArr = s.pFricArr;
    pSpeedArr = s.pSpeedArr;
}

export function joltBoundParticles(strength) {
    for (let i = 0; i < NUM_PARTICLES; i++) {
        pvxArr[i] += (Math.random() - 0.5) * strength;
        pvyArr[i] += (Math.random() - 0.5) * strength;
    }
}

export function joltParticles(strength = 0.08) {
    if (multiViewActive()) { joltMultiView(strength); return; }
    if (state.shape3d) { joltShape3D(strength); return; }
    joltBoundParticles(strength);
}

export function updateAndDrawParticles() {
    particlePixels32.fill(0);

    const hasSound = fieldModeCount > 0;
    const isCircle = state.plateShape === 'circle';
    const speedMult = state.globalSpeedMultiplier;
    const scaleToGrid = (FIELD_SIZE - 3) * 0.5;
    const scaleToCanvas = (DISPLAY_SIZE - 2) * 0.5;

    for (let i = 0; i < NUM_PARTICLES; i++) {
        let x = pxArr[i];
        let y = pyArr[i];
        let vx = pvxArr[i];
        let vy = pvyArr[i];

        if (hasSound) {
            // Keep the index from 1 to FIELD_SIZE - 2. The central differences then stay in range.
            const gx = ((x + 1.0) * scaleToGrid + 1) | 0;
            const gy = ((y + 1.0) * scaleToGrid + 1) | 0;
            const idx = gy * FIELD_SIZE + gx;

            const z = ampField[idx];
            const absZ = z < 0 ? -z : z;
            const dzdx = (ampField[idx + 1] - ampField[idx - 1]) * 0.5;
            const dzdy = (ampField[idx + FIELD_SIZE] - ampField[idx - FIELD_SIZE]) * 0.5;

            const signZ = z >= 0 ? 1.0 : -1.0;
            const gradMag = Math.sqrt(dzdx * dzdx + dzdy * dzdy) + 1e-4;
            const stepMag = Math.min(absZ, 0.35) / gradMag;

            const pSpeed = pSpeedArr[i] * speedMult;
            vx -= signZ * dzdx * stepMag * pSpeed;
            vy -= signZ * dzdy * stepMag * pSpeed;

            // The jitter grows with |z|. Grains on a nodal line stay still.
            const jitter = absZ * 0.028 * speedMult;
            vx += (Math.random() - 0.5) * jitter;
            vy += (Math.random() - 0.5) * jitter;
        } else {
            vx += (Math.random() - 0.5) * 0.0015 * speedMult;
            vy += (Math.random() - 0.5) * 0.0015 * speedMult;
        }

        const fric = pFricArr[i];
        vx *= fric;
        vy *= fric;
        x += vx;
        y += vy;

        if (!isCircle) {
            if (x < -1.0) { x = -1.0; vx *= -0.5; }
            else if (x > 1.0) { x = 1.0; vx *= -0.5; }
            if (y < -1.0) { y = -1.0; vy *= -0.5; }
            else if (y > 1.0) { y = 1.0; vy *= -0.5; }
        } else {
            const rSq = x * x + y * y;
            if (rSq > 1.0) {
                const invR = 1.0 / Math.sqrt(rSq);
                const nx = x * invR;
                const ny = y * invR;
                const dot = vx * nx + vy * ny;
                vx = (vx - 2.0 * dot * nx) * 0.5;
                vy = (vy - 2.0 * dot * ny) * 0.5;
                x = nx * 0.995;
                y = ny * 0.995;
            }
        }

        pxArr[i] = x;
        pyArr[i] = y;
        pvxArr[i] = vx;
        pvyArr[i] = vy;

        const cpx = ((x + 1.0) * scaleToCanvas) | 0;
        const cpy = ((y + 1.0) * scaleToCanvas) | 0;
        const velSq = vx * vx + vy * vy;
        const alphaIdx = Math.max(45, Math.min(255, (255 - velSq * 35000) | 0));
        const color32 = particleColorLUT[alphaIdx];

        const pRow = cpy * DISPLAY_SIZE + cpx;
        particlePixels32[pRow] = color32;
        particlePixels32[pRow + 1] = color32;
        particlePixels32[pRow + DISPLAY_SIZE] = color32;
    }

    particleStampCtx.putImageData(particleImageData, 0, 0);

    const baseTrail = (state.isListeningToTab && state.audioSyncMode === 'continuous') ? 0.22 : 0.34;
    const trailAlpha = Math.max(0.1, baseTrail - 0.2 * fxVisSoft());
    trailCtx.fillStyle = `rgba(${SCOPE_BG_RGB}, ${trailAlpha})`;
    trailCtx.fillRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    trailCtx.drawImage(particleStampCanvas, 0, 0);
}

import { FIELD_SIZE, state } from './config.js';
import { ampField, cellInsideCircle, clashField, goldField } from './lookup-tables.js';
import {
    clashCtx,
    clashImageData,
    clashPixels32,
    goldCtx,
    goldImageData,
    goldPixels32,
    NODAL_BASE,
    nodalColorLUT,
    nodalCtx,
    nodalImageData,
    nodalPixels32,
    packRGBA,
} from './render-buffers.js';
import { plateFade } from './wave-field.js';
import { fxVisSoft } from './fx-plate.js';

export function smoothShare(share) {
    const g = (share - 0.45) / 0.35;
    return g <= 0 ? 0 : (g >= 1 ? 1 : g * g * (3 - 2 * g));
}

function gradientShare2D(field, idx, dzdx, dzdy) {
    const fx = (field[idx + 1] - field[idx - 1]) * 0.5;
    const fy = (field[idx + FIELD_SIZE] - field[idx - FIELD_SIZE]) * 0.5;
    const fMag = Math.sqrt(fx * fx + fy * fy);
    const rx = dzdx - fx;
    const ry = dzdy - fy;
    return fMag / (fMag + Math.sqrt(rx * rx + ry * ry) + 1e-6);
}

export function renderNodalLinesDesmos() {
    const isCircle = state.plateShape === 'circle';
    const soft = fxVisSoft();
    const halfWidth = 0.85 + 0.6 * soft;
    const feather = 0.9 + 2.2 * soft;
    const invFeather = 1.0 / feather;
    const fadeMul = plateFade;

    const useGold = state.showGoldenHarmonics && state.goldLevel > 0.01 && state.goldModeCount > 0;
    const useClash = state.showClashingHarmonics && state.clashLevel > 0.01 && state.clashModeCount > 0;
    const partialGold = useGold && !state.goldAllModes;
    const partialClash = useClash && !state.clashAllModes;
    const now = performance.now();
    const shimmerT = now * 0.004;
    const flickerT = now * 0.016;
    let anyGold = false;
    let anyClash = false;

    nodalPixels32.fill(0);
    if (useGold) goldPixels32.fill(0);
    if (useClash) clashPixels32.fill(0);

    for (let y = 1; y < FIELD_SIZE - 1; y++) {
        const row = y * FIELD_SIZE;
        for (let x = 1; x < FIELD_SIZE - 1; x++) {
            const idx = row + x;
            if (isCircle && !cellInsideCircle[idx]) continue;

            const z = ampField[idx];
            const absZ = z < 0 ? -z : z;
            const dzdx = (ampField[idx + 1] - ampField[idx - 1]) * 0.5;
            const dzdy = (ampField[idx + FIELD_SIZE] - ampField[idx - FIELD_SIZE]) * 0.5;
            const gradMag = Math.sqrt(dzdx * dzdx + dzdy * dzdy) + 1e-6;

            // |z| / |grad z| approximates the distance to the zero line.
            // This keeps the line width the same at all frequencies.
            const dist = absZ / gradMag;
            const t = (halfWidth + feather - dist) * invFeather;
            if (t <= 0) continue;

            const a0 = t >= 1 ? 255 : (t * t * (3 - 2 * t) * 255) | 0;
            const a = fadeMul >= 1 ? a0 : (a0 * fadeMul) | 0;
            let color = nodalColorLUT[a];

            if (useGold || useClash) {
                let gtGold = 0;
                let gtClash = 0;
                if (useGold) {
                    const share = partialGold ? gradientShare2D(goldField, idx, dzdx, dzdy) : 1;
                    gtGold = smoothShare(share) * state.goldLevel;
                }
                if (useClash) {
                    const share = partialClash ? gradientShare2D(clashField, idx, dzdx, dzdy) : 1;
                    gtClash = smoothShare(share) * state.clashLevel;
                }

                if (gtClash > gtGold) {
                    if (gtClash > 0.02) {
                        const flicker = 0.5 + 0.5 * Math.sin(flickerT + x * 0.21 - y * 0.17);
                        const redG = 40 + 55 * flicker;
                        const redB = 55 + 40 * flicker;
                        color = packRGBA(
                            (NODAL_BASE.r + (255 - NODAL_BASE.r) * gtClash) | 0,
                            (NODAL_BASE.g + (redG - NODAL_BASE.g) * gtClash) | 0,
                            (NODAL_BASE.b + (redB - NODAL_BASE.b) * gtClash) | 0,
                            a
                        );
                        clashPixels32[idx] = packRGBA(255, redG | 0, redB | 0, (a * gtClash) | 0);
                        anyClash = true;
                    }
                } else if (gtGold > 0.02) {
                    const shimmer = 0.5 + 0.5 * Math.sin(shimmerT + x * 0.045 + y * 0.03);
                    const goldG = 190 + 46 * shimmer;
                    const goldB = 40 + 110 * shimmer;
                    color = packRGBA(
                        (NODAL_BASE.r + (255 - NODAL_BASE.r) * gtGold) | 0,
                        (NODAL_BASE.g + (goldG - NODAL_BASE.g) * gtGold) | 0,
                        (NODAL_BASE.b + (goldB - NODAL_BASE.b) * gtGold) | 0,
                        a
                    );
                    goldPixels32[idx] = packRGBA(255, goldG | 0, goldB | 0, (a * gtGold) | 0);
                    anyGold = true;
                }
            }

            nodalPixels32[idx] = color;
        }
    }

    nodalCtx.putImageData(nodalImageData, 0, 0);
    state.goldLayerVisible = anyGold;
    state.clashLayerVisible = anyClash;
    if (anyGold) goldCtx.putImageData(goldImageData, 0, 0);
    if (anyClash) clashCtx.putImageData(clashImageData, 0, 0);
}

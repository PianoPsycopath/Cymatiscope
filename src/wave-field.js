import {
    activeKeysMap,
    activeWaveModes,
    audioPeakSlots,
    FIELD_CELLS,
    FIELD_SIZE,
    R_BINS,
    state,
    THETA_BINS,
} from './config.js';
import {
    ampField,
    cellInsideCircle,
    cellRIndex,
    cellThetaIndex,
    clashField,
    cosM,
    cosMR,
    cosN,
    cosNTheta,
    goldField,
    normCoord,
} from './lookup-tables.js';
import { accumulateModeVolume, ampVol, clashVol, goldVol } from './volume-field.js';
import {
    analyzeHarmony,
    GOLD_MIN,
    setHarmonyReadout,
    updateClashLevel,
    updateGoldLevel,
} from './harmony-analysis.js';
import { fxFilterModes, fxGhostModes } from './fx-plate.js';

export function accumulateMode(mode, w, target) {
    const pi = Math.PI;

    if (state.plateShape === 'square') {
        // Use two cosine tables for each note. This is faster than one cosine for each cell.
        const mPi = mode.m * pi;
        const nPi = mode.n * pi;
        for (let i = 0; i < FIELD_SIZE; i++) {
            const c = normCoord[i];
            cosM[i] = Math.cos(mPi * c);
            cosN[i] = Math.cos(nPi * c);
        }

        let idx = 0;
        for (let y = 0; y < FIELD_SIZE; y++) {
            const cmY = cosM[y];
            const cnY = cosN[y];
            for (let x = 0; x < FIELD_SIZE; x++) {
                target[idx++] += w * (cosN[x] * cmY - cosM[x] * cnY);
            }
        }
    } else {
        const mPi = mode.m * pi;
        const nSym = mode.nCirc;

        for (let r = 0; r < R_BINS; r++) {
            cosMR[r] = Math.cos(mPi * (r / (R_BINS - 1)));
        }
        for (let t = 0; t < THETA_BINS; t++) {
            cosNTheta[t] = Math.cos(nSym * (t / THETA_BINS) * pi * 2);
        }

        for (let i = 0; i < FIELD_CELLS; i++) {
            if (cellInsideCircle[i]) {
                target[i] += w * cosMR[cellRIndex[i]] * cosNTheta[cellThetaIndex[i]];
            }
        }
    }
}

export let plateFade = 1;
export let fieldModeCount = 0;
const NO_GHOSTS = [];
const NO_HARMONY = { maxStrength: 0, maxClash: 0, labels: [], clashLabels: [] };
const waveFrame = { modeCount: 0, fieldCount: 0, ghosts: NO_GHOSTS, invTotalWeight: 0 };

function makeMode(freq, weight, audio) {
    return {
        freq,
        m: freq / 120,
        n: freq / 80,
        nCirc: Math.max(1, Math.round(freq / 150)),
        weight,
        audio
    };
}

export function prepareWaveModes() {
    activeWaveModes.length = 0;
    state.totalWaveWeight = 0;

    for (const item of activeKeysMap.values()) {
        activeWaveModes.push(makeMode(item.freq, 1.0));
        state.totalWaveWeight += 1.0;
    }

    if (state.isListeningToTab) {
        if (state.audioSyncMode === 'locked') {
            for (let i = 0; i < state.lockedAudioPeaks.length; i++) {
                const mode = state.lockedAudioPeaks[i];
                mode.audio = true;
                activeWaveModes.push(mode);
                state.totalWaveWeight += mode.weight;
            }
        } else {
            for (let i = 0; i < audioPeakSlots.length; i++) {
                const slot = audioPeakSlots[i];
                activeWaveModes.push(makeMode(slot.freq, slot.weight, true));
                state.totalWaveWeight += slot.weight;
            }
        }
    }

    fxFilterModes(activeWaveModes);
    state.totalWaveWeight = 0;
    for (let i = 0; i < activeWaveModes.length; i++) state.totalWaveWeight += activeWaveModes[i].weight;
    const ghosts = fxGhostModes(activeWaveModes, performance.now());
    let ghostWeight = 0;
    for (let i = 0; i < ghosts.length; i++) ghostWeight += ghosts[i].weight;

    const modeCount = activeWaveModes.length;
    const fieldCount = modeCount + ghosts.length;
    fieldModeCount = fieldCount;
    waveFrame.modeCount = modeCount;
    waveFrame.fieldCount = fieldCount;
    waveFrame.ghosts = ghosts;

    if (fieldCount === 0) {
        state.goldModeCount = 0;
        state.goldAllModes = false;
        state.clashModeCount = 0;
        state.clashAllModes = false;
        updateGoldLevel(0);
        updateClashLevel(0);
        setHarmonyReadout(null, null);
        return;
    }

    // When only ghosts are left, the plate fades out with them.
    plateFade = modeCount > 0 ? 1 : Math.min(1, ghostWeight);
    waveFrame.invTotalWeight = plateFade / (state.totalWaveWeight + ghostWeight);
    const harmony = modeCount > 0 ? analyzeHarmony(activeWaveModes) : NO_HARMONY;

    state.goldModeCount = 0;
    state.clashModeCount = 0;
    for (let i = 0; i < modeCount; i++) {
        const mode = activeWaveModes[i];
        if (mode.gold > GOLD_MIN) state.goldModeCount++;
        if (mode.clash > GOLD_MIN) state.clashModeCount++;
    }
    state.goldAllModes = state.goldModeCount === fieldCount;
    state.clashAllModes = state.clashModeCount === fieldCount;

    updateGoldLevel(harmony.maxStrength);
    updateClashLevel(harmony.maxClash);
    setHarmonyReadout(harmony.labels, harmony.clashLabels);
}

export function accumulateWaveField(F, G, C, acc) {
    F.fill(0);
    if (waveFrame.fieldCount === 0) return;

    const modeCount = waveFrame.modeCount;
    const ghosts = waveFrame.ghosts;
    const invTotalWeight = waveFrame.invTotalWeight;

    for (let i = 0; i < modeCount; i++) {
        const mode = activeWaveModes[i];
        acc(mode, mode.weight * invTotalWeight, F);
    }
    for (let i = 0; i < ghosts.length; i++) {
        acc(ghosts[i], ghosts[i].weight * invTotalWeight, F);
    }

    if (!state.showNodalLines) return;

    if (state.showGoldenHarmonics && state.goldModeCount > 0 && !state.goldAllModes) {
        G.fill(0);
        for (let i = 0; i < modeCount; i++) {
            const mode = activeWaveModes[i];
            if (mode.gold > GOLD_MIN) acc(mode, mode.weight * invTotalWeight, G);
        }
    }
    if (state.showClashingHarmonics && state.clashModeCount > 0 && !state.clashAllModes) {
        C.fill(0);
        for (let i = 0; i < modeCount; i++) {
            const mode = activeWaveModes[i];
            if (mode.clash > GOLD_MIN) acc(mode, mode.weight * invTotalWeight, C);
        }
    }
}

export function computeWaveField() {
    prepareWaveModes();
    if (state.shape3d !== null) accumulateWaveField(ampVol, goldVol, clashVol, accumulateModeVolume);
    else accumulateWaveField(ampField, goldField, clashField, accumulateMode);
}

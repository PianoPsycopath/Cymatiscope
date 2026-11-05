function accumulateMode(mode, w, target) {
    const pi = Math.PI;

    if (plateShape === 'square') {
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

let plateFade = 1;
let fieldModeCount = 0;
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

function prepareWaveModes() {
    activeWaveModes.length = 0;
    totalWaveWeight = 0;

    for (const item of activeKeysMap.values()) {
        activeWaveModes.push(makeMode(item.freq, 1.0));
        totalWaveWeight += 1.0;
    }

    if (isListeningToTab) {
        if (audioSyncMode === 'locked') {
            for (let i = 0; i < lockedAudioPeaks.length; i++) {
                const mode = lockedAudioPeaks[i];
                mode.audio = true;
                activeWaveModes.push(mode);
                totalWaveWeight += mode.weight;
            }
        } else {
            for (let i = 0; i < audioPeakSlots.length; i++) {
                const slot = audioPeakSlots[i];
                activeWaveModes.push(makeMode(slot.freq, slot.weight, true));
                totalWaveWeight += slot.weight;
            }
        }
    }

    fxFilterModes(activeWaveModes);
    totalWaveWeight = 0;
    for (let i = 0; i < activeWaveModes.length; i++) totalWaveWeight += activeWaveModes[i].weight;
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
        goldModeCount = 0;
        goldAllModes = false;
        clashModeCount = 0;
        clashAllModes = false;
        updateGoldLevel(0);
        updateClashLevel(0);
        setHarmonyReadout(null, null);
        return;
    }

    // When only ghosts are left, the plate fades out with them.
    plateFade = modeCount > 0 ? 1 : Math.min(1, ghostWeight);
    waveFrame.invTotalWeight = plateFade / (totalWaveWeight + ghostWeight);
    const harmony = modeCount > 0 ? analyzeHarmony(activeWaveModes) : NO_HARMONY;

    goldModeCount = 0;
    clashModeCount = 0;
    for (let i = 0; i < modeCount; i++) {
        const mode = activeWaveModes[i];
        if (mode.gold > GOLD_MIN) goldModeCount++;
        if (mode.clash > GOLD_MIN) clashModeCount++;
    }
    goldAllModes = goldModeCount === fieldCount;
    clashAllModes = clashModeCount === fieldCount;

    updateGoldLevel(harmony.maxStrength);
    updateClashLevel(harmony.maxClash);
    setHarmonyReadout(harmony.labels, harmony.clashLabels);
}

function accumulateWaveField(F, G, C, acc) {
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

    if (!showNodalLines) return;

    if (showGoldenHarmonics && goldModeCount > 0 && !goldAllModes) {
        G.fill(0);
        for (let i = 0; i < modeCount; i++) {
            const mode = activeWaveModes[i];
            if (mode.gold > GOLD_MIN) acc(mode, mode.weight * invTotalWeight, G);
        }
    }
    if (showClashingHarmonics && clashModeCount > 0 && !clashAllModes) {
        C.fill(0);
        for (let i = 0; i < modeCount; i++) {
            const mode = activeWaveModes[i];
            if (mode.clash > GOLD_MIN) acc(mode, mode.weight * invTotalWeight, C);
        }
    }
}

function computeWaveField() {
    prepareWaveModes();
    if (shape3d !== null) accumulateWaveField(ampVol, goldVol, clashVol, accumulateModeVolume);
    else accumulateWaveField(ampField, goldField, clashField, accumulateMode);
}

let isListeningToTab = false;
let tabAudioCtx;
let tabAnalyser;
let tabStream;
let tabAudioDataArray;
// This analyser has little smoothing. Smoothing blurs the sharp onsets that the tracker needs.
let onsetAnalyser;
let onsetDb;
let harmonyTracker = null;
// Take the snapshot after the change. The new notes then fill the FFT window.
let pendingSnapshotAt = 0;
let meterHold = 0;
let lastChordShown = null;
let uiFrameCount = 0;
const SNAPSHOT_DELAY_MS = 100;

const energyBarFill = document.getElementById('energyBarFill');
const thresholdMarker = document.getElementById('thresholdMarker');
const changeStateText = document.getElementById('changeStateText');
const changeLed = document.getElementById('changeLed');
const chordReadout = document.getElementById('chordReadout');
const changeCountBadge = document.getElementById('changeCountBadge');
const canvasChangeBadge = document.getElementById('canvasChangeBadge');
const formLockStatus = document.getElementById('formLockStatus');

function lockFormFromPeaks(peaks, flip) {
    const top = peaks.slice(0, 4);
    if (top.length === 0) return;
    if (flip) formFlipSign = -formFlipSign;

    lockedAudioPeaks = top.map((peak, idx) => {
        const freq = Math.max(40, Math.min(peak.freq, 2000));
        const swap = formFlipSign < 0 && idx % 2 === 0;
        return {
            freq,
            m: swap ? freq / 80 : freq / 120,
            n: swap ? freq / 120 : freq / 80,
            nCirc: Math.max(1, Math.round(freq / (swap ? 135 : 150))),
            weight: Math.max(0.25, Math.min(1.0, peak.norm))
        };
    });

    joltParticles(0.14);
    updateDisplay();
}

function lockFormFromSpectrum(selectedPeaks, nyquist, binCount, flip) {
    lockFormFromPeaks(selectedPeaks.map(p => ({
        freq: (p.index * nyquist) / binCount,
        norm: (p.value - 95) / 155
    })), flip);
}

function flashFormChange(isFormChange) {
    changeLed.className = isFormChange ? 'led snap' : 'led hit';
    changeStateText.textContent = isFormChange ? 'FORM SNAP!' : 'CHANGE';
    changeStateText.className = isFormChange ? 'st-snap' : 'st-hit';

    setTimeout(() => {
        changeLed.className = 'led';
        changeStateText.textContent = audioSyncMode === 'locked' ? 'Locked' : 'Tracking';
        changeStateText.className = 'st-idle';
    }, 130);
}

function extractTopPeaks(nyquist, binCount) {
    const maxBin = Math.min(binCount - 2, Math.ceil((2200 / nyquist) * binCount));
    const candidates = [];
    for (let i = 3; i < maxBin; i++) {
        const val = tabAudioDataArray[i];
        if (val > 105 && val >= tabAudioDataArray[i - 1] && val > tabAudioDataArray[i + 1]) {
            candidates.push({ index: i, value: val });
        }
    }
    candidates.sort((a, b) => b.value - a.value);
    const selectedPeaks = [];
    for (let i = 0; i < candidates.length && selectedPeaks.length < 8; i++) {
        const cand = candidates[i];
        let tooClose = false;
        for (let j = 0; j < selectedPeaks.length; j++) {
            if (Math.abs(selectedPeaks[j].index - cand.index) <= 4) {
                tooClose = true;
                break;
            }
        }
        if (!tooClose) selectedPeaks.push(cand);
    }
    return selectedPeaks;
}

function updateContinuousSlots(selectedPeaks, nyquist, binCount) {
    for (let i = audioPeakSlots.length - 1; i >= 0; i--) {
        audioPeakSlots[i].weight *= 0.88;
        if (audioPeakSlots[i].weight < 0.05) audioPeakSlots.splice(i, 1);
    }

    for (let i = 0; i < selectedPeaks.length; i++) {
        const peak = selectedPeaks[i];
        const rawFreq = (peak.index * nyquist) / binCount;
        const freq = Math.max(35, Math.min(rawFreq, 2000));
        const normAmp = Math.min(1.0, (peak.value - 105) / 150);

        let matchedSlot = null;
        for (let s = 0; s < audioPeakSlots.length; s++) {
            if (Math.abs(audioPeakSlots[s].binIndex - peak.index) <= 3) {
                matchedSlot = audioPeakSlots[s];
                break;
            }
        }

        if (matchedSlot) {
            matchedSlot.binIndex = peak.index;
            matchedSlot.freq = matchedSlot.freq * 0.65 + freq * 0.35;
            matchedSlot.weight = Math.min(1.0, matchedSlot.weight * 0.5 + normAmp * 0.5);
        } else if (audioPeakSlots.length < 8) {
            audioPeakSlots.push({ binIndex: peak.index, freq, weight: normAmp * 0.75 });
        } else {
            let weakestIdx = 0;
            for (let s = 1; s < audioPeakSlots.length; s++) {
                if (audioPeakSlots[s].weight < audioPeakSlots[weakestIdx].weight) weakestIdx = s;
            }
            if (normAmp > audioPeakSlots[weakestIdx].weight) {
                audioPeakSlots[weakestIdx] = { binIndex: peak.index, freq, weight: normAmp * 0.75 };
            }
        }
    }
}

function processTabAudioSpectrum(nowMs) {
    if (!isListeningToTab || !tabAnalyser || (!fileMode && !harmonyTracker)) return;

    const binCount = tabAnalyser.frequencyBinCount;
    if (!tabAudioDataArray || tabAudioDataArray.length !== binCount) {
        tabAudioDataArray = new Uint8Array(binCount);
    }
    tabAnalyser.getByteFrequencyData(tabAudioDataArray);
    if (!fileMode) onsetAnalyser.getFloatFrequencyData(onsetDb);

    const nyquist = tabAudioCtx.sampleRate * 0.5;

    const res = fileMode ? fileScheduleStep(nowMs) : harmonyTracker.process(onsetDb, nowMs, changeSensitivity, minChangeGapMs);

    const meterRatio = Math.min(1.0, res.onset / (res.threshold * 1.55));
    meterHold = Math.max(meterRatio, meterHold * 0.82);
    energyBarFill.style.width = `${(meterHold * 100).toFixed(1)}%`;
    thresholdMarker.style.left = `${((1 / 1.55) * 100).toFixed(1)}%`;

    if (res.label !== lastChordShown) {
        lastChordShown = res.label;
        chordReadout.textContent = res.label;
    }

    const selectedPeaks = extractTopPeaks(nyquist, binCount);

    if (res.change) {
        changeCounter = (changeCounter % changesPerForm) + 1;
        const shouldChangeForm = (changeCounter === 1);
        changeCountBadge.textContent = `${changeCounter}/${changesPerForm}`;

        flashFormChange(shouldChangeForm);
        joltParticles(0.03 + 0.05 * Math.max(0, Math.min(1, res.change.strength - 1)));

        if (audioSyncMode === 'locked' && shouldChangeForm) {
            if (fileMode && res.change.event) lockFormFromPeaks(res.change.event.peaks, true);
            else pendingSnapshotAt = nowMs + SNAPSHOT_DELAY_MS;
        }
    }

    if (pendingSnapshotAt > 0 && nowMs >= pendingSnapshotAt) {
        pendingSnapshotAt = 0;
        if (audioSyncMode === 'locked' && selectedPeaks.length > 0) {
            lockFormFromSpectrum(selectedPeaks, nyquist, binCount, true);
        }
    } else if (!fileMode && audioSyncMode === 'locked' && lockedAudioPeaks.length === 0 && selectedPeaks.length > 0) {
        lockFormFromSpectrum(selectedPeaks, nyquist, binCount, false);
    }

    updateContinuousSlots(selectedPeaks, nyquist, binCount);

    uiFrameCount++;
    if (uiFrameCount % 10 === 0 && audioSyncMode === 'continuous') {
        updateDisplay();
    }
}

const btnTabAudio = document.getElementById('btnTabAudio');

btnTabAudio.addEventListener('click', async () => {
    if (fileMode) stopFileAudio();
    if (isListeningToTab) {
        stopTabAudio();
        return;
    }
    try {
        const wantFx = fxTabWanted();
        const canFx = wantFx && fxTabCanMute();
        if (wantFx && !canFx) fxStatus('This browser cannot mute tab audio: tab effects unavailable', 'busy');
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: Object.assign({
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }, canFx ? { suppressLocalAudioPlayback: true } : {})
        });
        if (stream.getAudioTracks().length === 0) {
            document.getElementById('activeKeysDisplay').innerHTML =
                '<span class="warn">NO AUDIO SHARED - ENABLE "SHARE TAB AUDIO"</span>';
            stream.getTracks().forEach(t => t.stop());
            return;
        }
        tabStream = stream;

        tabAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = tabAudioCtx.createMediaStreamSource(stream);
        tabAnalyser = tabAudioCtx.createAnalyser();
        tabAnalyser.fftSize = 4096;
        tabAnalyser.smoothingTimeConstant = 0.55;
        source.connect(tabAnalyser);

        // The tab is muted here, so this path is the only sound the user hears.
        // Analysis stays on the dry signal.
        if (canFx) {
            const chain = fxCreate(tabAudioCtx);
            source.connect(chain.input);
            chain.output.connect(tabAudioCtx.destination);
        }

        onsetAnalyser = tabAudioCtx.createAnalyser();
        onsetAnalyser.fftSize = 8192;
        onsetAnalyser.smoothingTimeConstant = 0.4;
        source.connect(onsetAnalyser);
        onsetDb = new Float32Array(onsetAnalyser.frequencyBinCount);

        harmonyTracker = new HarmonyChangeTracker(tabAudioCtx.sampleRate, onsetAnalyser.frequencyBinCount);
        pendingSnapshotAt = 0;
        meterHold = 0;
        lastChordShown = null;
        chordReadout.textContent = '--';
        lockedAudioPeaks = [];
        changeCounter = 0;

        isListeningToTab = true;
        canvasChangeBadge.classList.remove('hidden');
        if (audioSyncMode === 'locked') formLockStatus.classList.remove('hidden');

        btnTabAudio.innerText = "Stop Listening";
        btnTabAudio.classList.add('live');

        stream.getVideoTracks()[0].onended = () => {
            stopTabAudio();
        };
    } catch (err) {
        console.error(err);
        document.getElementById('activeKeysDisplay').innerHTML =
            '<span class="err">AUDIO CAPTURE CANCELLED OR DENIED</span>';
    }
});

function stopTabAudio() {
    isListeningToTab = false;
    if (tabStream) tabStream.getTracks().forEach(t => t.stop());
    if (tabAudioCtx) tabAudioCtx.close();
    audioPeakSlots.length = 0;
    lockedAudioPeaks.length = 0;
    harmonyTracker = null;
    onsetAnalyser = null;
    pendingSnapshotAt = 0;
    meterHold = 0;
    energyBarFill.style.width = '0%';
    chordReadout.textContent = '--';
    canvasChangeBadge.classList.add('hidden');
    formLockStatus.classList.add('hidden');
    updateDisplay();

    btnTabAudio.innerText = "Listen to Tab Audio";
    btnTabAudio.classList.remove('live');
}

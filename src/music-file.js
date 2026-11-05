import { audioPeakSlots, state } from './config.js';
import {
    FILE_HOP,
    FILE_N,
    FILE_SR,
    fileThr,
    runHarmonyAnalysis,
    transformMono,
} from './file-analysis.js';
import {
    canvasChangeBadge,
    chordReadout,
    energyBarFill,
    formLockStatus,
    lockFormFromPeaks,
    stopTabAudio,
} from './live-audio.js';
import { updateDisplay } from './ui-piano.js';
import { fxCreate } from './fx-chain.js';

export let fileMode = false;
let fileAudioCtx = null;
let fileAnalyserNode = null;
let fileEvIdx = 0;
let fileLabel = '--';
let fileSyncMs = 0;
let fileLastPos = 0;
let fileLoadToken = 0;
let reanalyzeTimer = 0;
let fileName = '';

const musicPlayer = document.getElementById('musicPlayer');
const musicStatus = document.getElementById('musicStatus');
const musicProgress = document.getElementById('musicProgress');
const musicProgressFill = document.getElementById('musicProgressFill');
const btnCloseMusic = document.getElementById('btnCloseMusic');

state.fileProgressCb = (frac) => {
    musicProgressFill.style.width = `${(frac * 100).toFixed(0)}%`;
};

function resyncFileEvents(posMs) {
    let idx = 0;
    while (idx < state.fileEvents.length && state.fileEvents[idx].t * 1000 <= posMs) idx++;
    fileEvIdx = idx;
    state.changeCounter = 0;
    if (idx > 0) {
        const prev = state.fileEvents[idx - 1];
        fileLabel = prev.label;
        if (state.audioSyncMode === 'locked') lockFormFromPeaks(prev.peaks, false);
    } else {
        fileLabel = '--';
        state.lockedAudioPeaks = [];
        updateDisplay();
    }
    fileLastPos = posMs;
}

export function fileScheduleStep(nowMs) {
    const posMs = musicPlayer.currentTime * 1000 + fileSyncMs;
    if (posMs < fileLastPos - 50 || posMs > fileLastPos + 1000) resyncFileEvents(posMs);
    fileLastPos = posMs;

    let change = null;
    while (fileEvIdx < state.fileEvents.length && state.fileEvents[fileEvIdx].t * 1000 <= posMs) {
        const ev = state.fileEvents[fileEvIdx++];
        fileLabel = ev.label;
        change = { strength: 1.6, event: ev };
    }

    let frame = Math.floor(((posMs / 1000) * FILE_SR - FILE_N / 2) / FILE_HOP);
    frame = Math.max(0, Math.min(state.fileFrames - 1, frame));
    const onset = state.fileDists ? state.fileDists[frame] : 0;
    return { change, onset, threshold: fileThr, label: fileLabel };
}

function setMusicStatus() {
    const dur = isFinite(musicPlayer.duration) ? ` · ${Math.floor(musicPlayer.duration / 60)}:${String(Math.floor(musicPlayer.duration % 60)).padStart(2, '0')}` : '';
    musicStatus.textContent = `${fileName}${dur} · ${state.fileEvents.length} harmony changes found`;
    musicStatus.className = 'status-line ok';
}

function enterFileMode() {
    if (!state.fileSpectra || fileMode) return;
    if (state.isListeningToTab) stopTabAudio();

    if (!fileAudioCtx) {
        fileAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = fileAudioCtx.createMediaElementSource(musicPlayer);
        const chain = fxCreate(fileAudioCtx);
        src.connect(chain.input);
        chain.output.connect(fileAudioCtx.destination);
        fileAnalyserNode = fileAudioCtx.createAnalyser();
        fileAnalyserNode.fftSize = 4096;
        fileAnalyserNode.smoothingTimeConstant = 0.55;
        src.connect(fileAnalyserNode);
    }
    if (fileAudioCtx.state === 'suspended') fileAudioCtx.resume();

    state.tabAudioCtx = fileAudioCtx;
    state.tabAnalyser = fileAnalyserNode;
    audioPeakSlots.length = 0;
    state.lockedAudioPeaks = [];
    state.changeCounter = 0;
    state.meterHold = 0;
    state.lastChordShown = null;
    fileMode = true;
    state.isListeningToTab = true;
    resyncFileEvents(musicPlayer.currentTime * 1000 + fileSyncMs);

    canvasChangeBadge.classList.remove('hidden');
    if (state.audioSyncMode === 'locked') formLockStatus.classList.remove('hidden');
}

export function stopFileAudio() {
    if (!fileMode) return;
    musicPlayer.pause();
    fileMode = false;
    state.isListeningToTab = false;
    state.lockedAudioPeaks.length = 0;
    audioPeakSlots.length = 0;
    energyBarFill.style.width = '0%';
    chordReadout.textContent = '--';
    canvasChangeBadge.classList.add('hidden');
    formLockStatus.classList.add('hidden');
    updateDisplay();
}

function closeMusicFile() {
    fileLoadToken++;
    stopFileAudio();
    musicPlayer.removeAttribute('src');
    musicPlayer.load();
    if (musicPlayer.dataset.url) { URL.revokeObjectURL(musicPlayer.dataset.url); delete musicPlayer.dataset.url; }
    state.fileSpectra = null;
    state.fileDists = null;
    state.fileEvents = [];
    state.fileFrames = 0;
    musicPlayer.classList.add('hidden');
    btnCloseMusic.classList.add('hidden');
    musicProgress.classList.add('hidden');
    musicStatus.textContent = 'No file loaded';
    musicStatus.className = 'status-line';
}

async function loadMusicFile(file) {
    const token = ++fileLoadToken;
    if (fileMode) stopFileAudio();
    else if (state.isListeningToTab) stopTabAudio();
    musicPlayer.pause();

    fileName = file.name;
    musicStatus.textContent = `Decoding ${file.name}...`;
    musicStatus.className = 'status-line busy';
    musicProgress.classList.remove('hidden');
    state.fileProgressCb(0);

    try {
        const ab = await file.arrayBuffer();
        // Decoding in this context changes the sample rate to FILE_SR.
        const off = new OfflineAudioContext(1, 1, FILE_SR);
        const buf = await off.decodeAudioData(ab);
        if (token !== fileLoadToken) return;

        const n = buf.length;
        const chs = buf.numberOfChannels;
        const mono = new Float32Array(n);
        for (let c = 0; c < chs; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < n; i++) mono[i] += d[i] / chs;
        }

        musicStatus.textContent = `Analysing ${file.name}...`;
        const ok = await transformMono(mono, () => token !== fileLoadToken);
        if (!ok || token !== fileLoadToken) return;

        runHarmonyAnalysis(state.changeSensitivity, state.minChangeGapMs);

        if (musicPlayer.dataset.url) URL.revokeObjectURL(musicPlayer.dataset.url);
        const url = URL.createObjectURL(file);
        musicPlayer.dataset.url = url;
        musicPlayer.src = url;
        musicPlayer.classList.remove('hidden');
        btnCloseMusic.classList.remove('hidden');
        musicProgress.classList.add('hidden');
        setMusicStatus();
        enterFileMode();
    } catch (err) {
        console.error(err);
        musicProgress.classList.add('hidden');
        musicStatus.textContent = "Couldn't decode that file. Try MP3, WAV, OGG or M4A.";
        musicStatus.className = 'status-line err';
    }
}

export function scheduleReanalysis() {
    if (!state.fileSpectra) return;
    clearTimeout(reanalyzeTimer);
    reanalyzeTimer = setTimeout(() => {
        runHarmonyAnalysis(state.changeSensitivity, state.minChangeGapMs);
        if (fileMode) resyncFileEvents(musicPlayer.currentTime * 1000 + fileSyncMs);
        setMusicStatus();
    }, 300);
}

document.getElementById('musicFileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) loadMusicFile(file);
    e.target.value = '';
});
btnCloseMusic.addEventListener('click', closeMusicFile);
musicPlayer.addEventListener('play', () => {
    if (fileAudioCtx && fileAudioCtx.state === 'suspended') fileAudioCtx.resume();
    if (state.fileSpectra && !fileMode) enterFileMode();
});
musicPlayer.addEventListener('seeked', () => {
    if (fileMode) resyncFileEvents(musicPlayer.currentTime * 1000 + fileSyncMs);
});
const syncLabel = document.getElementById('syncLabel');
document.getElementById('syncSlider').addEventListener('input', (e) => {
    fileSyncMs = parseInt(e.target.value, 10);
    syncLabel.textContent = `${fileSyncMs > 0 ? '+' : ''}${fileSyncMs}ms`;
    if (fileMode) resyncFileEvents(musicPlayer.currentTime * 1000 + fileSyncMs);
});

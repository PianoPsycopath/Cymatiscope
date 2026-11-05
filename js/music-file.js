let fileMode = false;
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

fileProgressCb = (frac) => {
    musicProgressFill.style.width = `${(frac * 100).toFixed(0)}%`;
};

function resyncFileEvents(posMs) {
    let idx = 0;
    while (idx < fileEvents.length && fileEvents[idx].t * 1000 <= posMs) idx++;
    fileEvIdx = idx;
    changeCounter = 0;
    if (idx > 0) {
        const prev = fileEvents[idx - 1];
        fileLabel = prev.label;
        if (audioSyncMode === 'locked') lockFormFromPeaks(prev.peaks, false);
    } else {
        fileLabel = '--';
        lockedAudioPeaks = [];
        updateDisplay();
    }
    fileLastPos = posMs;
}

function fileScheduleStep(nowMs) {
    const posMs = musicPlayer.currentTime * 1000 + fileSyncMs;
    if (posMs < fileLastPos - 50 || posMs > fileLastPos + 1000) resyncFileEvents(posMs);
    fileLastPos = posMs;

    let change = null;
    while (fileEvIdx < fileEvents.length && fileEvents[fileEvIdx].t * 1000 <= posMs) {
        const ev = fileEvents[fileEvIdx++];
        fileLabel = ev.label;
        change = { strength: 1.6, event: ev };
    }

    let frame = Math.floor(((posMs / 1000) * FILE_SR - FILE_N / 2) / FILE_HOP);
    frame = Math.max(0, Math.min(fileFrames - 1, frame));
    const onset = fileDists ? fileDists[frame] : 0;
    return { change, onset, threshold: fileThr, label: fileLabel };
}

function setMusicStatus() {
    const dur = isFinite(musicPlayer.duration) ? ` · ${Math.floor(musicPlayer.duration / 60)}:${String(Math.floor(musicPlayer.duration % 60)).padStart(2, '0')}` : '';
    musicStatus.textContent = `${fileName}${dur} · ${fileEvents.length} harmony changes found`;
    musicStatus.className = 'status-line ok';
}

function enterFileMode() {
    if (!fileSpectra || fileMode) return;
    if (isListeningToTab) stopTabAudio();

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

    tabAudioCtx = fileAudioCtx;
    tabAnalyser = fileAnalyserNode;
    audioPeakSlots.length = 0;
    lockedAudioPeaks = [];
    changeCounter = 0;
    meterHold = 0;
    lastChordShown = null;
    fileMode = true;
    isListeningToTab = true;
    resyncFileEvents(musicPlayer.currentTime * 1000 + fileSyncMs);

    canvasChangeBadge.classList.remove('hidden');
    if (audioSyncMode === 'locked') formLockStatus.classList.remove('hidden');
}

function stopFileAudio() {
    if (!fileMode) return;
    musicPlayer.pause();
    fileMode = false;
    isListeningToTab = false;
    lockedAudioPeaks.length = 0;
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
    fileSpectra = null;
    fileDists = null;
    fileEvents = [];
    fileFrames = 0;
    musicPlayer.classList.add('hidden');
    btnCloseMusic.classList.add('hidden');
    musicProgress.classList.add('hidden');
    musicStatus.textContent = 'No file loaded';
    musicStatus.className = 'status-line';
}

async function loadMusicFile(file) {
    const token = ++fileLoadToken;
    if (fileMode) stopFileAudio();
    else if (isListeningToTab) stopTabAudio();
    musicPlayer.pause();

    fileName = file.name;
    musicStatus.textContent = `Decoding ${file.name}...`;
    musicStatus.className = 'status-line busy';
    musicProgress.classList.remove('hidden');
    fileProgressCb(0);

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

        runHarmonyAnalysis(changeSensitivity, minChangeGapMs);

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

function scheduleReanalysis() {
    if (!fileSpectra) return;
    clearTimeout(reanalyzeTimer);
    reanalyzeTimer = setTimeout(() => {
        runHarmonyAnalysis(changeSensitivity, minChangeGapMs);
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
    if (fileSpectra && !fileMode) enterFileMode();
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

import { audioCtx, masterGain } from './synth.js';
import { NUM_PARTICLES, state } from './config.js';
import { joltParticles, pxArr, pyArr } from './particles.js';
import {
    resizeShape3D,
    setShape3D,
    setShape3DAutoOrbit,
    setShape3DCutaway,
    setShape3DLattice,
    setShape3DLock,
    setShape3DSkin,
} from './shape-3d.js';
import {
    changeCountBadge,
    extractTopPeaks,
    flashFormChange,
    formLockStatus,
    lockFormFromSpectrum,
    tabAudioDataArray,
} from './live-audio.js';
import { scheduleReanalysis } from './music-file.js';
import { updateDisplay } from './ui-piano.js';

const btnSquare = document.getElementById('btnSquare');
const btnCircle = document.getElementById('btnCircle');

const shapeButtons = { square: btnSquare, circle: btnCircle };
document.querySelectorAll('[data-shape3d]').forEach(btn => { shapeButtons[btn.dataset.shape3d] = btn; });

function setPlateShape(shape) {
    const is3D = shape !== 'square' && shape !== 'circle';
    if (!setShape3D(is3D ? shape : null)) return;
    state.plateShape = is3D ? 'square' : shape;
    for (const key in shapeButtons) shapeButtons[key].classList.toggle('on', key === shape);
    if (state.plateShape === 'circle') {
        for (let i = 0; i < NUM_PARTICLES; i++) {
            const rSq = pxArr[i] * pxArr[i] + pyArr[i] * pyArr[i];
            if (rSq > 1.0) {
                const invR = 0.99 / Math.sqrt(rSq);
                pxArr[i] *= invR;
                pyArr[i] *= invR;
            }
        }
    }
    joltParticles(0.18);
}

for (const key in shapeButtons) {
    shapeButtons[key].addEventListener('click', () => setPlateShape(key));
}

const autoOrbitToggle = document.getElementById('autoOrbitToggle');
autoOrbitToggle.addEventListener('change', (e) => setShape3DAutoOrbit(e.target.checked));

document.getElementById('latticeSlider').addEventListener('input', (e) => setShape3DLattice(parseInt(e.target.value, 10)));
document.getElementById('cutawaySlider').addEventListener('input', (e) => setShape3DCutaway(parseFloat(e.target.value) / 100));
document.getElementById('skinToggle').addEventListener('change', (e) => setShape3DSkin(e.target.checked));

document.getElementById('rotLockToggle').addEventListener('change', (e) => {
    setShape3DLock(e.target.checked);
    autoOrbitToggle.disabled = e.target.checked;
});

const btnFullscreen = document.getElementById('btnFullscreen');
const scopeScreenEl = document.querySelector('.scope-screen');
const fsRequest = scopeScreenEl.requestFullscreen || scopeScreenEl.webkitRequestFullscreen;
const fsExit = document.exitFullscreen || document.webkitExitFullscreen;
function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }

if (!fsRequest) {
    btnFullscreen.classList.add('hidden');
} else {
    btnFullscreen.addEventListener('click', () => {
        if (fsElement()) fsExit.call(document);
        else fsRequest.call(scopeScreenEl);
    });
}
function onFullscreenChange() {
    btnFullscreen.textContent = fsElement() ? '✕ EXIT' : '⛶ FULL';
    // Wait for the layout. The canvas size is then correct.
    setTimeout(resizeShape3D, 60);
}
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);
window.addEventListener('resize', resizeShape3D);

document.getElementById('speedSlider').addEventListener('input', (e) => {
    state.globalSpeedMultiplier = parseFloat(e.target.value);
});

document.getElementById('volumeSlider').addEventListener('input', (e) => {
    state.synthVolume = parseFloat(e.target.value);
    if (masterGain) {
        masterGain.gain.setTargetAtTime(state.synthVolume, audioCtx.currentTime, 0.02);
    }
});

document.getElementById('nodalToggle').addEventListener('change', (e) => {
    state.showNodalLines = e.target.checked;
});

function resetHarmonyReadout() {
    state.lastHarmonyUpdate = 0;
    state.lastHarmonyStr = '\u0000';
}

document.getElementById('goldToggle').addEventListener('change', (e) => {
    state.showGoldenHarmonics = e.target.checked;
    resetHarmonyReadout();
});

document.getElementById('clashToggle').addEventListener('change', (e) => {
    state.showClashingHarmonics = e.target.checked;
    resetHarmonyReadout();
});

document.getElementById('particleToggle').addEventListener('change', (e) => {
    state.showParticles = e.target.checked;
});

const btnModeLocked = document.getElementById('btnModeLocked');
const btnModeContinuous = document.getElementById('btnModeContinuous');
const changeEveryContainer = document.getElementById('changeEveryContainer');

function setAudioSyncMode(mode) {
    state.audioSyncMode = mode;
    btnModeLocked.classList.toggle('on', mode === 'locked');
    btnModeContinuous.classList.toggle('on', mode !== 'locked');
    changeEveryContainer.classList.toggle('dim', mode !== 'locked');
    if (mode === 'locked') {
        if (state.isListeningToTab) formLockStatus.classList.remove('hidden');
    } else {
        formLockStatus.classList.add('hidden');
    }
    updateDisplay();
}

btnModeLocked.addEventListener('click', () => setAudioSyncMode('locked'));
btnModeContinuous.addEventListener('click', () => setAudioSyncMode('continuous'));

document.querySelectorAll('.change-div-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        state.changesPerForm = parseInt(btn.dataset.changes, 10);
        state.changeCounter = 0;
        changeCountBadge.textContent = `1/${state.changesPerForm}`;
        document.querySelectorAll('.change-div-btn').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
    });
});

document.getElementById('sensitivitySlider').addEventListener('input', (e) => {
    // A higher slider value gives a lower threshold, which is more sensitive.
    state.changeSensitivity = 3.2 - 1.3 * parseFloat(e.target.value);
    if (state.fileSpectra) scheduleReanalysis();
});

const cooldownLabel = document.getElementById('cooldownLabel');
document.getElementById('cooldownSlider').addEventListener('input', (e) => {
    state.minChangeGapMs = parseInt(e.target.value, 10);
    cooldownLabel.textContent = `${state.minChangeGapMs}ms`;
    if (state.fileSpectra) scheduleReanalysis();
});

document.getElementById('btnSnapForm').addEventListener('click', () => {
    flashFormChange(true);

    if (state.isListeningToTab && state.tabAnalyser && tabAudioDataArray) {
        const nyquist = state.tabAudioCtx.sampleRate * 0.5;
        const binCount = state.tabAnalyser.frequencyBinCount;
        lockFormFromSpectrum(extractTopPeaks(nyquist, binCount), nyquist, binCount, true);
    } else {
        joltParticles(0.18);
    }
});

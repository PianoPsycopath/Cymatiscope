import './synth.js';
import { ctx, state } from './config.js';
import './lookup-tables.js';
import './volume-field.js';
import './render-buffers.js';
import './particles.js';
import './harmony-analysis.js';
import { computeWaveField, prepareWaveModes } from './wave-field.js';
import './nodal-renderer.js';
import { renderShape3D } from './shape-3d.js';
import './harmony-tracker.js';
import './file-analysis.js';
import { processTabAudioSpectrum } from './live-audio.js';
import './music-file.js';
import './ui-piano.js';
import './ui-controls.js';
import './fx-chain.js';
import './dials.js';
import './fx-plate.js';
import { updateScore } from './score-input.js';
import { updateSpectrumGraph } from './spectrum-graph.js';
import { updateTension } from './tension-meter.js';
import { drawPlate2D } from './plate-view.js';
import { multiViewActive, renderMultiView } from './multi-view.js';

let fpsFrames = 0;
let fpsLastTime = performance.now();
const fpsDisplayEl = document.getElementById('fpsDisplay');

function loop(now) {
    fpsFrames++;
    if (now - fpsLastTime >= 500) {
        const currentFps = Math.min(60, Math.round((fpsFrames * 1000) / (now - fpsLastTime)));
        fpsDisplayEl.textContent = `${currentFps} FPS`;
        fpsFrames = 0;
        fpsLastTime = now;
    }

    if (state.isListeningToTab) {
        processTabAudioSpectrum(now);
    }

    updateScore(now);
    const multi = multiViewActive();
    if (multi) prepareWaveModes();
    else computeWaveField();
    updateTension(now);

    if (multi) {
        renderMultiView(now);
    } else if (state.shape3d) {
        renderShape3D(now);
    } else {
        drawPlate2D(ctx);
    }

    updateSpectrumGraph(now);
    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

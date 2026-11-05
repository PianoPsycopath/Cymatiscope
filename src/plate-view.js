import { DISPLAY_SIZE, state } from './config.js';
import {
    clashCanvas,
    getGraticule,
    goldCanvas,
    nodalCanvas,
    plateSize,
    resizeBoundPlate,
    SCOPE_BG,
    trailCanvas,
} from './render-buffers.js';
import { updateAndDrawParticles } from './particles.js';
import { fieldModeCount } from './wave-field.js';
import { renderNodalLinesDesmos } from './nodal-renderer.js';

const MAX_FS_SIZE = 1600;

// In full screen the canvas gets about one pixel per screen pixel (up to a limit). It is not stretched from 600.
function targetSize(cv) {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fs) return DISPLAY_SIZE;
    const px = cv.clientWidth * (window.devicePixelRatio || 1);
    return Math.max(DISPLAY_SIZE, Math.min(MAX_FS_SIZE, Math.round(px / 100) * 100));
}

export function drawPlate2D(c) {
    const cv = c.canvas;
    const S = targetSize(cv);
    if (cv.width !== S) { cv.width = S; cv.height = S; }
    if (plateSize !== S) resizeBoundPlate(S);
    const k = S / DISPLAY_SIZE;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';

    if (state.showParticles) {
        updateAndDrawParticles();
        c.drawImage(trailCanvas, 0, 0);
    } else {
        c.fillStyle = SCOPE_BG;
        c.fillRect(0, 0, S, S);
    }

    if (state.showNodalLines && fieldModeCount > 0) {
        renderNodalLinesDesmos();
        if (state.goldLayerVisible) {
            c.save();
            c.shadowColor = 'rgba(255, 200, 60, 0.95)';
            c.shadowBlur = 12 * k;
            c.drawImage(goldCanvas, 0, 0, S, S);
            c.restore();
        }
        if (state.clashLayerVisible) {
            c.save();
            c.shadowColor = 'rgba(255, 50, 70, 0.95)';
            c.shadowBlur = 10 * k;
            c.drawImage(clashCanvas, 0, 0, S, S);
            c.restore();
        }
        c.drawImage(nodalCanvas, 0, 0, S, S);
    }

    if (state.plateShape === 'circle') {
        c.beginPath();
        c.arc(S * 0.5, S * 0.5, S * 0.5, 0, Math.PI * 2);
        c.rect(0, 0, S, S);
        c.fillStyle = SCOPE_BG;
        c.fill('evenodd');

        c.beginPath();
        c.arc(S * 0.5, S * 0.5, S * 0.5 - k, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(61, 255, 122, 0.45)';
        c.lineWidth = 2 * k;
        c.stroke();
    }

    // The graticule covers the full screen, also outside a circular plate.
    c.drawImage(getGraticule(S), 0, 0);
}
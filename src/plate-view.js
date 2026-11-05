import { DISPLAY_SIZE, state } from './config.js';
import {
    clashCanvas,
    goldCanvas,
    graticuleCanvas,
    nodalCanvas,
    SCOPE_BG,
    trailCanvas,
} from './render-buffers.js';
import { updateAndDrawParticles } from './particles.js';
import { fieldModeCount } from './wave-field.js';
import { renderNodalLinesDesmos } from './nodal-renderer.js';

export function drawPlate2D(c) {
    if (state.showParticles) {
        updateAndDrawParticles();
        c.drawImage(trailCanvas, 0, 0);
    } else {
        c.fillStyle = SCOPE_BG;
        c.fillRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    }

    if (state.showNodalLines && fieldModeCount > 0) {
        renderNodalLinesDesmos();
        if (state.goldLayerVisible) {
            c.save();
            c.shadowColor = 'rgba(255, 200, 60, 0.95)';
            c.shadowBlur = 12;
            c.drawImage(goldCanvas, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
            c.restore();
        }
        if (state.clashLayerVisible) {
            c.save();
            c.shadowColor = 'rgba(255, 50, 70, 0.95)';
            c.shadowBlur = 10;
            c.drawImage(clashCanvas, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
            c.restore();
        }
        c.drawImage(nodalCanvas, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    }

    if (state.plateShape === 'circle') {
        c.beginPath();
        c.arc(DISPLAY_SIZE * 0.5, DISPLAY_SIZE * 0.5, DISPLAY_SIZE * 0.5, 0, Math.PI * 2);
        c.rect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
        c.fillStyle = SCOPE_BG;
        c.fill('evenodd');

        c.beginPath();
        c.arc(DISPLAY_SIZE * 0.5, DISPLAY_SIZE * 0.5, DISPLAY_SIZE * 0.5 - 1, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(61, 255, 122, 0.45)';
        c.lineWidth = 2;
        c.stroke();
    }

    // The graticule covers the full screen, also outside a circular plate.
    c.drawImage(graticuleCanvas, 0, 0);
}

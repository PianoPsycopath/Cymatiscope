function drawPlate2D(c) {
    if (showParticles) {
        updateAndDrawParticles();
        c.drawImage(trailCanvas, 0, 0);
    } else {
        c.fillStyle = SCOPE_BG;
        c.fillRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    }

    if (showNodalLines && fieldModeCount > 0) {
        renderNodalLinesDesmos();
        if (goldLayerVisible) {
            c.save();
            c.shadowColor = 'rgba(255, 200, 60, 0.95)';
            c.shadowBlur = 12;
            c.drawImage(goldCanvas, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
            c.restore();
        }
        if (clashLayerVisible) {
            c.save();
            c.shadowColor = 'rgba(255, 50, 70, 0.95)';
            c.shadowBlur = 10;
            c.drawImage(clashCanvas, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
            c.restore();
        }
        c.drawImage(nodalCanvas, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    }

    if (plateShape === 'circle') {
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

    if (isListeningToTab) {
        processTabAudioSpectrum(now);
    }

    updateScore(now);
    const multi = multiViewActive();
    if (multi) prepareWaveModes();
    else computeWaveField();
    updateTension(now);

    if (multi) {
        renderMultiView(now);
    } else if (shape3d) {
        renderShape3D(now);
    } else {
        drawPlate2D(ctx);
    }

    updateSpectrumGraph(now);
    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

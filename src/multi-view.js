import { DISPLAY_SIZE, NUM_PARTICLES, state } from './config.js';
import {
    ampField,
    bindFieldSet,
    clashField,
    createFieldSet,
    goldField,
    MAIN_FIELDS,
} from './lookup-tables.js';
import { accumulateModeVolume, useVolumeDomain } from './volume-field.js';
import { bindPlateBuffers, createPlateBuffers, MAIN_PLATE } from './render-buffers.js';
import {
    bindParticleSet,
    createParticleSet,
    joltBoundParticles,
    MAIN_PARTICLES,
} from './particles.js';
import { accumulateMode, accumulateWaveField } from './wave-field.js';
import { createShape3D, SHAPE3D_KINDS } from './shape-3d.js';
import { drawPlate2D } from './plate-view.js';

const MULTI_LAYOUTS = {
    single: { label: 'SINGLE',  key: '1', views: null },
    pair:   { label: '2D PAIR', key: '2', cols: 2, rows: 1, views: ['square', 'circle'] },
    quad:   { label: 'QUAD',    key: '3', cols: 2, rows: 2, views: ['square', 'circle', 'cube', 'sphere'] },
    all3d:  { label: '3D QUAD', key: '4', cols: 2, rows: 2, views: ['cube', 'sphere', 'cylinder', 'torus'] },
    six:    { label: 'ALL SIX', key: '5', cols: 3, rows: 2, views: ['square', 'circle', 'cube', 'sphere', 'cylinder', 'torus'] }
};
const MULTI_LAYOUT_ORDER = ['single', 'pair', 'quad', 'all3d', 'six'];
const MULTI_3D_PARTICLES = 8000;

const mvScope = document.querySelector('.scope-screen');
const mvMusicPlayer = document.getElementById('musicPlayer');
const mvScoreBtn = document.getElementById('btnScorePlay');
let mvLayout = 'single';
let mvActive = false;
let mvViews = [];
const mvPool = {};
let mvGrid = null, mvBar = null, mvFlashEl = null, mvPlayLabel = null, mvIdleTimer = 0, mvFlashTimer = 0;

export function multiViewActive() { return mvActive; }
function mvFullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }

function createView2D(shape) {
    const view = { shape, plate: createPlateBuffers(), particles: createParticleSet(), fields: createFieldSet() };
    if (shape === 'circle') {
        const p = view.particles;
        for (let i = 0; i < NUM_PARTICLES; i++) {
            const rSq = p.pxArr[i] * p.pxArr[i] + p.pyArr[i] * p.pyArr[i];
            if (rSq > 1.0) {
                const invR = 0.99 / Math.sqrt(rSq);
                p.pxArr[i] *= invR;
                p.pyArr[i] *= invR;
            }
        }
    }
    return view;
}
function bindView2D(view) {
    bindPlateBuffers(view.plate);
    bindParticleSet(view.particles);
    bindFieldSet(view.fields);
    state.plateShape = view.shape;
}
function bindMainView2D(shape) {
    bindPlateBuffers(MAIN_PLATE);
    bindParticleSet(MAIN_PARTICLES);
    bindFieldSet(MAIN_FIELDS);
    state.plateShape = shape;
}

function mvGetPanel(kind) {
    if (mvPool[kind]) return mvPool[kind];

    const is3D = SHAPE3D_KINDS[kind] !== undefined;
    const el = document.createElement('div');
    el.className = 'mv-panel';
    const cv = document.createElement('canvas');
    const label = document.createElement('span');
    label.className = 'mv-label';
    label.textContent = kind.toUpperCase();
    el.appendChild(cv);
    el.appendChild(label);

    const panel = { kind, is3D, el, canvas: cv };
    if (is3D) {
        mvGrid.appendChild(el);
        panel.inst = createShape3D({ canvas: cv, particles: MULTI_3D_PARTICLES, pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5) });
        panel.inst.setName(kind);
        mvGrid.removeChild(el);
    } else {
        cv.width = DISPLAY_SIZE;
        cv.height = DISPLAY_SIZE;
        panel.ctx = cv.getContext('2d');
        panel.view2D = createView2D(kind);
    }
    mvPool[kind] = panel;
    return panel;
}

function mvApplyLayout() {
    const layout = MULTI_LAYOUTS[mvLayout];
    const wantMulti = !!(mvFullscreenElement() && layout.views);

    mvViews = [];
    if (wantMulti) {
        mvGrid.innerHTML = '';
        for (const kind of layout.views) {
            try {
                const panel = mvGetPanel(kind);
                mvGrid.appendChild(panel.el);
                mvViews.push(panel);
            } catch (err) {
                console.warn('Panel unavailable:', kind, err);
            }
        }
        mvGrid.style.gridTemplateColumns = `repeat(${layout.cols}, minmax(0, 1fr))`;
        mvGrid.style.gridTemplateRows = `repeat(${layout.rows}, minmax(0, 1fr))`;
    }
    mvActive = wantMulti && mvViews.length > 0;
    mvScope.classList.toggle('mode-multi', mvActive);
    mvUpdateBar();
    requestAnimationFrame(() => { for (const p of mvViews) if (p.inst) p.inst.resize(); });
}

function mvSetLayout(id) {
    if (!MULTI_LAYOUTS[id]) return;
    mvLayout = id;
    mvApplyLayout();
}

export function renderMultiView(now) {
    const savedShape = state.plateShape;
    for (let i = 0; i < mvViews.length; i++) {
        const p = mvViews[i];
        if (p.is3D) {
            useVolumeDomain(p.kind);
            const v = p.inst.vol;
            accumulateWaveField(v.amp, v.gold, v.clash, accumulateModeVolume);
            p.inst.render(now);
        } else {
            bindView2D(p.view2D);
            accumulateWaveField(ampField, goldField, clashField, accumulateMode);
            drawPlate2D(p.ctx);
        }
    }
    bindMainView2D(savedShape);
}

export function joltMultiView(strength) {
    const savedShape = state.plateShape;
    for (let i = 0; i < mvViews.length; i++) {
        const p = mvViews[i];
        if (p.is3D) p.inst.jolt(strength);
        else { bindView2D(p.view2D); joltBoundParticles(strength); }
    }
    bindMainView2D(savedShape);
}

function mvToggleMusic() {
    const hasFile = !!(mvMusicPlayer.currentSrc || mvMusicPlayer.getAttribute('src'));
    const scorePlaying = !mvScoreBtn.disabled && mvScoreBtn.textContent === 'Pause';

    if (scorePlaying) {
        mvScoreBtn.click();
        mvFlash('SCORE STOPPED');
    } else if (hasFile) {
        if (mvMusicPlayer.paused) {
            const started = mvMusicPlayer.play();
            if (started && started.catch) started.catch(() => mvFlash('PLAYBACK BLOCKED'));
            mvFlash('PLAY');
        } else {
            mvMusicPlayer.pause();
            mvFlash('PAUSE');
        }
    } else if (!mvScoreBtn.disabled) {
        mvScoreBtn.click();
        mvFlash('SCORE PLAY');
    } else {
        mvFlash('NO MUSIC LOADED');
    }
    mvUpdateBar();
}

function mvFlash(text) {
    mvFlashEl.textContent = text;
    mvFlashEl.classList.add('on');
    clearTimeout(mvFlashTimer);
    mvFlashTimer = setTimeout(() => mvFlashEl.classList.remove('on'), 1400);
}

function mvBuildUi() {
    mvGrid = document.createElement('div');
    mvGrid.id = 'multiGrid';
    mvScope.appendChild(mvGrid);

    mvBar = document.createElement('div');
    mvBar.className = 'fs-bar';
    let html = '';
    for (const id of MULTI_LAYOUT_ORDER) {
        const layout = MULTI_LAYOUTS[id];
        html += `<button class="fs-btn" data-layout="${id}" title="Layout ${layout.key}"><b>${layout.key}</b> ${layout.label}</button>`;
    }
    html += '<span class="fs-sep"></span><button class="fs-btn" id="fsPlay" title="Play / pause the loaded music (Space)"><b>SPACE</b> <span id="fsPlayLabel">PLAY</span></button>';
    html += '<span class="fs-hint">ESC EXIT</span>';
    mvBar.innerHTML = html;
    mvScope.appendChild(mvBar);

    mvFlashEl = document.createElement('div');
    mvFlashEl.className = 'fs-flash';
    mvScope.appendChild(mvFlashEl);

    mvPlayLabel = mvBar.querySelector('#fsPlayLabel');
    mvBar.querySelectorAll('[data-layout]').forEach(b => b.addEventListener('click', () => mvSetLayout(b.dataset.layout)));
    mvBar.querySelector('#fsPlay').addEventListener('click', mvToggleMusic);
}

function mvUpdateBar() {
    mvBar.querySelectorAll('[data-layout]').forEach(b => b.classList.toggle('on', b.dataset.layout === mvLayout));
    mvPlayLabel.textContent = mvMusicPlayer.paused ? 'PLAY' : 'PAUSE';
}

function mvPokeBar() {
    mvScope.classList.remove('fs-idle');
    clearTimeout(mvIdleTimer);
    mvIdleTimer = setTimeout(() => { if (mvFullscreenElement()) mvScope.classList.add('fs-idle'); }, 3000);
}

function mvOnFullscreenChange() {
    const fs = !!mvFullscreenElement();
    mvScope.classList.toggle('is-fs', fs);
    // Remove focus from buttons. Space then does not press them.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (fs) mvPokeBar();
    else { clearTimeout(mvIdleTimer); mvScope.classList.remove('fs-idle'); }
    mvApplyLayout();
}

mvBuildUi();
mvUpdateBar();
document.addEventListener('fullscreenchange', mvOnFullscreenChange);
document.addEventListener('webkitfullscreenchange', mvOnFullscreenChange);
mvScope.addEventListener('mousemove', () => { if (mvFullscreenElement()) mvPokeBar(); });
['play', 'pause', 'ended', 'emptied'].forEach(ev => mvMusicPlayer.addEventListener(ev, mvUpdateBar));

// Use the capture phase to get Space and the number keys before other handlers.
document.addEventListener('keydown', (e) => {
    if (!mvFullscreenElement() || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) mvToggleMusic();
        mvPokeBar();
    } else if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        mvSetLayout(MULTI_LAYOUT_ORDER[parseInt(e.key, 10) - 1]);
        mvPokeBar();
    }
}, true);
document.addEventListener('keyup', (e) => {
    if (mvFullscreenElement() && e.code === 'Space') e.preventDefault();
}, true);

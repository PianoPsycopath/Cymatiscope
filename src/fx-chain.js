import { masterGain } from './synth.js';
import { state } from './config.js';
import { fileMode } from './music-file.js';
import { dialSync } from './dials.js';

export const fxParams = {
    enabled: true,
    plate: true,
    wet: 100,
    revMix: 25,
    revDecay: 2.0,
    revDamp: 50,
    revPre: 20,
    echoMix: 0,
    echoTime: 320,
    echoFb: 35,
    lp: 100,
    hp: 0
};

const FX_PRESETS = {
    dry:       { revMix: 0,  revDecay: 1.0, revDamp: 50, revPre: 0,  echoMix: 0,  echoTime: 320, echoFb: 35, lp: 100, hp: 0 },
    room:      { revMix: 18, revDecay: 0.8, revDamp: 60, revPre: 5,  echoMix: 0,  echoTime: 320, echoFb: 35, lp: 100, hp: 0 },
    hall:      { revMix: 30, revDecay: 2.4, revDamp: 45, revPre: 25, echoMix: 0,  echoTime: 320, echoFb: 35, lp: 100, hp: 0 },
    cathedral: { revMix: 45, revDecay: 5.5, revDamp: 35, revPre: 40, echoMix: 0,  echoTime: 320, echoFb: 35, lp: 100, hp: 0 },
    dub:       { revMix: 25, revDecay: 1.5, revDamp: 55, revPre: 10, echoMix: 40, echoTime: 375, echoFb: 55, lp: 85,  hp: 15 },
    lofi:      { revMix: 10, revDecay: 0.9, revDamp: 70, revPre: 0,  echoMix: 0,  echoTime: 320, echoFb: 35, lp: 28,  hp: 35 }
};

const FX_CONTROLS = [
    { id: 'fxWet',       key: 'wet',       fmt: v => Math.round(v) + '%' },
    { id: 'fxRevMix',    key: 'revMix',    fmt: v => Math.round(v) + '%' },
    { id: 'fxRevDecay',  key: 'revDecay',  fmt: v => (+v).toFixed(1) + 's' },
    { id: 'fxRevDamp',   key: 'revDamp',   fmt: v => Math.round(v) + '%' },
    { id: 'fxRevPre',    key: 'revPre',    fmt: v => Math.round(v) + 'ms' },
    { id: 'fxEchoMix',   key: 'echoMix',   fmt: v => Math.round(v) + '%' },
    { id: 'fxEchoTime',  key: 'echoTime',  fmt: v => Math.round(v) + 'ms' },
    { id: 'fxEchoFb',    key: 'echoFb',    fmt: v => Math.round(v) + '%' },
    { id: 'fxLp',        key: 'lp',        fmt: v => fxHz(fxLpHz(v)) },
    { id: 'fxHp',        key: 'hp',        fmt: v => fxHz(fxHpHz(v)) }
];

export function fxLpHz(v) { return 200 * Math.pow(100, v / 100); }
export function fxHpHz(v) { return 20 * Math.pow(100, v / 100); }
function fxHz(f) { return f >= 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f) + 'Hz'; }

const fxChains = [];
const fxIRCache = new Map();
let fxIrDecay = -1;
let fxIrDamp = -1;
let fxIrTimer = 0;
let fxSwapping = false;
let fxSynthHooked = null;
export let fxSynthTap = null;

function fxMakeIR(ctx, seconds, damping) {
    const rate = ctx.sampleRate;
    const len = Math.max(64, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    const d = damping / 100;
    const fade = Math.min(len, Math.floor(rate * 0.003));
    for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const k = Math.max(0.04, 1 - d * (0.55 + 0.4 * t));
            lp += ((Math.random() * 2 - 1) - lp) * k;
            const env = Math.exp(-6.9 * t);
            data[i] = lp * env * (i < fade ? i / fade : 1);
        }
    }
    return buf;
}

function fxIrFor(ctx) {
    let b = fxIRCache.get(ctx.sampleRate);
    if (!b) {
        b = fxMakeIR(ctx, fxIrDecay, fxIrDamp);
        fxIRCache.set(ctx.sampleRate, b);
    }
    return b;
}

function fxRebuildIR(immediate) {
    if (fxIrDecay === fxParams.revDecay && fxIrDamp === fxParams.revDamp) return;
    const swap = () => {
        fxIrTimer = 0;
        fxIrDecay = fxParams.revDecay;
        fxIrDamp = fxParams.revDamp;
        fxIRCache.clear();
        for (const c of fxChains) c.conv.buffer = fxIrFor(c.ctx);
        fxSwapping = false;
        fxApply();
    };
    if (immediate) { swap(); return; }
    clearTimeout(fxIrTimer);
    // Lower the wet signal while the buffer changes. This prevents a click.
    fxSwapping = true;
    fxIrTimer = setTimeout(swap, 140);
}

export function fxCreate(ctx) {
    const input = ctx.createGain();
    const output = ctx.createGain();

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.Q.value = 0.707;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.707;
    input.connect(hp);
    hp.connect(lp);
    lp.connect(output);

    const preDelay = ctx.createDelay(0.25);
    const conv = ctx.createConvolver();
    const revWet = ctx.createGain();
    lp.connect(preDelay);
    preDelay.connect(conv);
    conv.connect(revWet);
    revWet.connect(output);

    const echoDelay = ctx.createDelay(1.5);
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 3500;
    const echoFbGain = ctx.createGain();
    const echoWet = ctx.createGain();
    lp.connect(echoDelay);
    echoDelay.connect(echoTone);
    echoTone.connect(echoFbGain);
    echoFbGain.connect(echoDelay);
    echoTone.connect(echoWet);
    echoWet.connect(output);

    fxChains.push({ ctx, hp, lp, preDelay, conv, revWet, echoDelay, echoFbGain, echoWet });
    if (fxIrDecay !== fxParams.revDecay || fxIrDamp !== fxParams.revDamp) fxRebuildIR(true);
    else conv.buffer = fxIrFor(ctx);
    fxApply();
    return { input, output };
}

function fxApply() {
    const p = fxParams;
    const on = p.enabled;
    const wet = p.wet / 100;
    const tc = 0.03;

    for (let i = fxChains.length - 1; i >= 0; i--) {
        const c = fxChains[i];
        if (c.ctx.state === 'closed') { fxChains.splice(i, 1); continue; }
        const t = c.ctx.currentTime;
        c.revWet.gain.setTargetAtTime(on && !fxSwapping ? wet * p.revMix / 100 : 0, t, fxSwapping ? 0.01 : tc);
        c.echoWet.gain.setTargetAtTime(on ? wet * p.echoMix / 100 : 0, t, tc);
        c.hp.frequency.setTargetAtTime(on ? fxHpHz(p.hp) : 20, t, tc);
        c.lp.frequency.setTargetAtTime(on ? fxLpHz(p.lp) : 20000, t, tc);
        c.preDelay.delayTime.setTargetAtTime(p.revPre / 1000, t, tc);
        c.echoDelay.delayTime.setTargetAtTime(p.echoTime / 1000, t, tc);
        c.echoFbGain.gain.setTargetAtTime(Math.min(0.9, p.echoFb / 100), t, tc);
    }

    if (fxIrDecay !== p.revDecay || fxIrDamp !== p.revDamp) fxRebuildIR(false);
}

const fxStatusEl = document.getElementById('fxStatus');
export function fxStatus(text, cls) {
    fxStatusEl.textContent = text;
    fxStatusEl.className = 'status-line' + (cls ? ' ' + cls : '');
}

function fxHookSynth() {
    if (!masterGain || fxSynthHooked === masterGain) return;
    const g = masterGain;
    const c = g.context;
    fxSynthHooked = g;
    try {
        g.disconnect(c.destination);
    } catch (e) {
        fxStatus('Piano: effects not inserted (synth is not wired straight to the output)', 'busy');
        return;
    }
    const chain = fxCreate(c);
    g.connect(chain.input);
    chain.output.connect(c.destination);
    fxSynthTap = chain.output;
}
// masterGain does not exist before the first key press. Check for it at intervals.
setInterval(fxHookSynth, 400);

const fxTabEl = document.getElementById('fxTab');
export function fxTabWanted() { return fxTabEl.checked; }
export function fxTabCanMute() {
    const supported = navigator.mediaDevices && navigator.mediaDevices.getSupportedConstraints
        ? navigator.mediaDevices.getSupportedConstraints() : {};
    return !!supported.suppressLocalAudioPlayback;
}
fxTabEl.addEventListener('change', () => {
    const capturing = state.isListeningToTab && !fileMode;
    if (capturing) fxStatus('Restart tab capture to apply', 'busy');
    else if (fxTabEl.checked && !fxTabCanMute()) fxStatus('This browser cannot mute tab audio: tab effects unavailable', 'busy');
    else fxStatus('');
});

const fxEnableEl = document.getElementById('fxEnable');
const fxPlateEl = document.getElementById('fxPlate');
fxPlateEl.checked = fxParams.plate;
fxPlateEl.addEventListener('change', () => { fxParams.plate = fxPlateEl.checked; });

function fxShowValue(c) {
    document.getElementById(c.id + 'Val').textContent = c.fmt(fxParams[c.key]);
}

for (const c of FX_CONTROLS) {
    const el = document.getElementById(c.id);
    el.value = fxParams[c.key];
    fxShowValue(c);
    el.addEventListener('input', () => {
        fxParams[c.key] = parseFloat(el.value);
        fxShowValue(c);
        document.querySelectorAll('[data-fx-preset]').forEach(b => b.classList.remove('on'));
        fxApply();
    });
}

fxEnableEl.checked = fxParams.enabled;
fxEnableEl.addEventListener('change', () => {
    fxParams.enabled = fxEnableEl.checked;
    fxApply();
});

document.querySelectorAll('[data-fx-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
        const preset = FX_PRESETS[btn.dataset.fxPreset];
        if (!preset) return;
        Object.assign(fxParams, preset);
        for (const c of FX_CONTROLS) {
            if (!(c.key in preset)) continue;
            const el = document.getElementById(c.id);
            el.value = fxParams[c.key];
            fxShowValue(c);
            dialSync(el);
        }
        document.querySelectorAll('[data-fx-preset]').forEach(b => b.classList.toggle('on', b === btn));
        fxApply();
    });
});

const FILE_SR = 11025;
const FILE_N = 2048;
const FILE_HOP = 256;
const FILE_BINS = 420;

let fileSpectra = null;
let fileFrames = 0;
let fileDists = null;
let fileThr = 0.2;
let fileEvents = [];
let fileProgressCb = () => {};

const FFT_REV = new Uint16Array(FILE_N);
const FFT_COS = new Float64Array(FILE_N / 2);
const FFT_SIN = new Float64Array(FILE_N / 2);
const FFT_WIN = new Float64Array(FILE_N);
const fftRe = new Float64Array(FILE_N);
const fftIm = new Float64Array(FILE_N);
(function initFft() {
    const bits = Math.log2(FILE_N);
    for (let i = 0; i < FILE_N; i++) {
        let r = 0;
        for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
        FFT_REV[i] = r;
        FFT_WIN[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (FILE_N - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (FILE_N - 1));
    }
    for (let i = 0; i < FILE_N / 2; i++) {
        FFT_COS[i] = Math.cos(-2 * Math.PI * i / FILE_N);
        FFT_SIN[i] = Math.sin(-2 * Math.PI * i / FILE_N);
    }
})();

function fftInPlace(re, im) {
    const n = FILE_N;
    for (let i = 0; i < n; i++) {
        const j = FFT_REV[i];
        if (j > i) {
            const tr = re[i]; re[i] = re[j]; re[j] = tr;
            const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }
    for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = n / size;
        for (let start = 0; start < n; start += size) {
            for (let k = 0, t = 0; k < half; k++, t += step) {
                const wr = FFT_COS[t], wi = FFT_SIN[t];
                const a = start + k, b = a + half;
                const xr = re[b] * wr - im[b] * wi;
                const xi = re[b] * wi + im[b] * wr;
                re[b] = re[a] - xr; im[b] = im[a] - xi;
                re[a] += xr;        im[a] += xi;
            }
        }
    }
}

async function transformMono(mono, isCancelled) {
    const n = mono.length;
    fileFrames = Math.max(1, Math.floor((n - FILE_N) / FILE_HOP) + 1);
    fileSpectra = new Float32Array(fileFrames * FILE_BINS);
    for (let f = 0; f < fileFrames; f++) {
        const s = f * FILE_HOP;
        for (let i = 0; i < FILE_N; i++) {
            const x = s + i < n ? mono[s + i] : 0;
            fftRe[i] = x * FFT_WIN[i];
            fftIm[i] = 0;
        }
        fftInPlace(fftRe, fftIm);
        const o = f * FILE_BINS;
        for (let k = 0; k < FILE_BINS; k++) {
            const mag = Math.sqrt(fftRe[k] * fftRe[k] + fftIm[k] * fftIm[k]) / FILE_N;
            fileSpectra[o + k] = 20 * Math.log10(mag + 1e-9);
        }
        if (f % 150 === 0) {
            fileProgressCb(f / fileFrames);
            await new Promise(r => setTimeout(r, 0));
            if (isCancelled()) return false;
        }
    }
    fileProgressCb(1);
    return true;
}

function extractPeaksFromSpectrum(spec) {
    const binHz = FILE_SR / FILE_N;
    const minBin = Math.ceil(35 / binHz);
    const maxBin = Math.min(FILE_BINS - 2, Math.ceil(2200 / binHz));
    const cands = [];
    for (let i = minBin; i < maxBin; i++) {
        const v = spec[i];
        if (v > -71 && v >= spec[i - 1] && v > spec[i + 1]) {
            const a = spec[i - 1], c = spec[i + 1];
            const d = a - 2 * v + c;
            const shift = d < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / d)) : 0;
            cands.push({ freq: (i + shift) * binHz, db: v });
        }
    }
    cands.sort((p, q) => q.db - p.db);
    const out = [];
    for (let i = 0; i < cands.length && out.length < 8; i++) {
        let close = false;
        for (let j = 0; j < out.length; j++) {
            if (Math.abs(out[j].freq - cands[i].freq) <= 47) { close = true; break; }
        }
        if (!close) out.push(cands[i]);
    }
    return out.map(p => ({ freq: p.freq, norm: Math.max(0.25, Math.min(1, (p.db + 73.9) / 42.55)) }));
}

function runHarmonyAnalysis(k, minGapMs) {
    const tracker = new HarmonyChangeTracker(FILE_SR, FILE_N / 2);
    const events = [];
    fileDists = new Float32Array(fileFrames);
    for (let f = 0; f < fileFrames; f++) {
        const spec = fileSpectra.subarray(f * FILE_BINS, (f + 1) * FILE_BINS);
        const tMs = ((f * FILE_HOP + FILE_N / 2) / FILE_SR) * 1000;
        const res = tracker.process(spec, tMs, k, minGapMs);
        fileDists[f] = res.onset;
        fileThr = res.threshold;
        if (res.change) events.push({ t: res.change.onsetTime / 1000, frame: f, label: res.label, peaks: [] });
    }
    for (const ev of events) {
        // Read the form 3 frames after the change. The new notes then fill the window.
        const f2 = Math.min(fileFrames - 1, ev.frame + 3);
        ev.peaks = extractPeaksFromSpectrum(fileSpectra.subarray(f2 * FILE_BINS, (f2 + 1) * FILE_BINS));
    }
    events.sort((a, b) => a.t - b.t);
    fileEvents = events.filter(ev => ev.peaks.length > 0);
    return fileEvents;
}

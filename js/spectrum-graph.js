const SG_FMIN = 30;
const SG_FMAX = 12000;
const SG_METER_W = 16;
const SG_FRAME_MS = 33;
const SG_MAX_PEAKS = 4;
const SG_PEAK_MIN = 0.3;
const SG_PEAK_SEP = 40;
const SG_DB_FLOOR = -60;
const SG_SEGMENTS = 20;
const SG_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const sgCanvas = document.getElementById('spectrumCanvas');
const sgCtx = sgCanvas.getContext('2d');
const SG_W = sgCanvas.width;
const SG_H = sgCanvas.height;
const SG_X0 = 3;
const SG_PLOT_W = SG_W - SG_METER_W - 10;
const SG_TOP = 14;
const SG_BOT = SG_H - 14;
const SG_RATIO = Math.pow(SG_FMAX / SG_FMIN, 1 / SG_PLOT_W);
const sgCols = new Float32Array(SG_PLOT_W);

const sgBound = { tab: null, synth: null, score: null };
let sgSynthTap = { src: null, node: null };
let sgLast = 0;
let sgLevel = 0;
let sgPeakHold = 0;
let sgPeakAt = 0;

function sgSynthAnalyser() {
    // Use the effects output when it exists. It is the sound the user hears.
    const src = fxSynthTap || masterGain;
    if (!src) return null;
    if (sgSynthTap.src === src) return sgSynthTap.node;
    try {
        const an = src.context.createAnalyser();
        an.fftSize = 8192;
        an.smoothingTimeConstant = 0.6;
        src.connect(an);
        sgSynthTap = { src, node: an };
        return an;
    } catch (e) {
        sgSynthTap = { src, node: null };
        return null;
    }
}

function sgBind(key, an) {
    let b = sgBound[key];
    if (!b || b.an !== an) {
        b = { an, f: new Uint8Array(an.frequencyBinCount), t: new Uint8Array(an.fftSize) };
        sgBound[key] = b;
    }
    return b;
}

function sgSample(b) {
    const an = b.an;
    an.getByteFrequencyData(b.f);
    an.getByteTimeDomainData(b.t);
    const bins = b.f.length;
    const binHz = an.context.sampleRate / an.fftSize;

    let f0 = SG_FMIN;
    for (let x = 0; x < SG_PLOT_W; x++) {
        const f1 = f0 * SG_RATIO;
        const b0 = f0 / binHz;
        const b1 = f1 / binHz;
        let v = 0;
        if (b1 - b0 < 1) {
            const c = (b0 + b1) * 0.5;
            const i = Math.floor(c);
            if (i + 1 < bins) { const fr = c - i; v = b.f[i] * (1 - fr) + b.f[i + 1] * fr; }
        } else {
            const hi = Math.min(bins - 1, Math.ceil(b1));
            for (let k = Math.floor(b0); k <= hi; k++) if (b.f[k] > v) v = b.f[k];
        }
        v /= 255;
        if (v > sgCols[x]) sgCols[x] = v;
        f0 = f1;
    }

    let sum = 0;
    for (let i = 0; i < b.t.length; i++) { const s = (b.t[i] - 128) / 128; sum += s * s; }
    return Math.sqrt(sum / b.t.length);
}

function sgX(f) { return SG_X0 + (Math.log(f / SG_FMIN) / Math.log(SG_FMAX / SG_FMIN)) * SG_PLOT_W; }
function sgY(v) { return SG_BOT - v * (SG_BOT - SG_TOP); }

function sgNoteName(f) {
    const midi = Math.round(69 + 12 * Math.log2(f / 440));
    return SG_NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

function sgFindPeaks() {
    const cand = [];
    for (let x = 2; x < SG_PLOT_W - 2; x++) {
        const v = sgCols[x];
        if (v >= SG_PEAK_MIN && v >= sgCols[x - 1] && v > sgCols[x + 1] && v >= sgCols[x - 2] && v > sgCols[x + 2]) {
            cand.push({ x, v });
        }
    }
    cand.sort((a, b) => b.v - a.v);
    const out = [];
    for (let i = 0; i < cand.length && out.length < SG_MAX_PEAKS; i++) {
        let ok = true;
        for (let j = 0; j < out.length; j++) if (Math.abs(out[j].x - cand[i].x) < SG_PEAK_SEP) { ok = false; break; }
        if (ok) out.push(cand[i]);
    }
    return out;
}

function sgDrawGrid(g) {
    g.lineWidth = 1;
    g.font = '9px ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'alphabetic';

    g.strokeStyle = 'rgba(107, 51, 12, 0.35)';
    g.beginPath();
    for (let i = 1; i < 4; i++) {
        const y = Math.round(SG_TOP + (i / 4) * (SG_BOT - SG_TOP)) + 0.5;
        g.moveTo(SG_X0, y); g.lineTo(SG_X0 + SG_PLOT_W, y);
    }
    g.stroke();

    const marks = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
    const labelled = { 100: '100', 1000: '1k', 10000: '10k' };
    g.strokeStyle = 'rgba(107, 51, 12, 0.5)';
    g.beginPath();
    for (const f of marks) {
        const x = Math.round(sgX(f)) + 0.5;
        g.moveTo(x, SG_TOP); g.lineTo(x, SG_BOT);
    }
    g.stroke();

    g.fillStyle = '#8a5a30';
    g.textAlign = 'center';
    for (const f in labelled) g.fillText(labelled[f], sgX(+f), SG_H - 3);
    g.textAlign = 'left';
    g.fillText('SPECTRUM // LOG Hz', SG_X0 + 2, 10);

    g.strokeStyle = 'rgba(107, 51, 12, 0.8)';
    g.strokeRect(SG_X0 + 0.5, SG_TOP + 0.5, SG_PLOT_W - 1, SG_BOT - SG_TOP);
}

function sgDrawMeter(g, now, rms) {
    const dB = 20 * Math.log10(Math.max(rms, 1e-5));
    const lvl = Math.max(0, Math.min(1, (dB - SG_DB_FLOOR) / -SG_DB_FLOOR));
    sgLevel += (lvl - sgLevel) * (lvl > sgLevel ? 0.6 : 0.12);
    if (lvl >= sgPeakHold) { sgPeakHold = lvl; sgPeakAt = now; }
    else if (now - sgPeakAt > 700) sgPeakHold = Math.max(0, sgPeakHold - 0.02);

    const mx = SG_W - SG_METER_W - 2;
    const segH = (SG_BOT - SG_TOP) / SG_SEGMENTS;
    const lit = Math.round(sgLevel * SG_SEGMENTS);
    const peakSeg = Math.min(SG_SEGMENTS - 1, Math.round(sgPeakHold * SG_SEGMENTS));

    for (let i = 0; i < SG_SEGMENTS; i++) {
        const frac = (i + 1) / SG_SEGMENTS;
        const y = SG_BOT - (i + 1) * segH + 1;
        const base = frac > 0.85 ? '255, 46, 62' : (frac > 0.6 ? '255, 176, 0' : '61, 255, 122');
        const on = i < lit || (i === peakSeg && sgPeakHold > 0.02);
        g.fillStyle = `rgba(${base}, ${on ? 1 : 0.14})`;
        g.fillRect(mx, y, SG_METER_W, Math.max(1, segH - 2));
    }
    g.fillStyle = '#8a5a30';
    g.textAlign = 'center';
    g.fillText('VOL', mx + SG_METER_W / 2, SG_H - 3);
    g.textAlign = 'left';
}

function updateSpectrumGraph(now) {
    if (now - sgLast < SG_FRAME_MS) return;
    sgLast = now;

    sgCols.fill(0);
    let energy = 0;

    if (isListeningToTab && tabAnalyser) {
        const r = sgSample(sgBind('tab', tabAnalyser));
        energy += r * r;
    }
    const synthAn = sgSynthAnalyser();
    if (synthAn) {
        const r = sgSample(sgBind('synth', synthAn));
        energy += r * r;
    }
    if (scoreAnalyser) {
        const r = sgSample(sgBind('score', scoreAnalyser));
        energy += r * r;
    }
    const rms = Math.sqrt(energy);

    const g = sgCtx;
    g.clearRect(0, 0, SG_W, SG_H);
    sgDrawGrid(g);

    g.beginPath();
    g.moveTo(SG_X0, SG_BOT);
    for (let x = 0; x < SG_PLOT_W; x++) g.lineTo(SG_X0 + x, sgY(sgCols[x]));
    g.lineTo(SG_X0 + SG_PLOT_W - 1, SG_BOT);
    g.closePath();
    g.fillStyle = 'rgba(58, 160, 255, 0.16)';
    g.fill();

    g.beginPath();
    for (let x = 0; x < SG_PLOT_W; x++) {
        const px = SG_X0 + x, py = sgY(sgCols[x]);
        if (x === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.strokeStyle = '#3aa0ff';
    g.lineWidth = 1.5;
    g.stroke();

    const peaks = sgFindPeaks();
    g.font = '9px ui-monospace, Menlo, Consolas, monospace';
    g.textAlign = 'center';
    for (let i = 0; i < peaks.length; i++) {
        const p = peaks[i];
        const f = SG_FMIN * Math.pow(SG_RATIO, p.x);
        const px = SG_X0 + p.x, py = sgY(p.v);
        g.fillStyle = '#d6ecff';
        g.fillRect(px - 1.5, py - 1.5, 3, 3);
        const label = sgNoteName(f) + ' ' + Math.round(f);
        const tx = Math.max(SG_X0 + 24, Math.min(SG_X0 + SG_PLOT_W - 24, px));
        g.fillStyle = '#8fc8ff';
        g.fillText(label, tx, Math.max(SG_TOP + 9, py - 5));
    }
    g.textAlign = 'left';

    sgDrawMeter(g, now, rms);
}

const TN_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const TN_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const TN_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function tnNormalise(p) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 12; i++) { if (p[i] < lo) lo = p[i]; if (p[i] > hi) hi = p[i]; }
    return p.map(v => (v - lo) / (hi - lo));
}
const TN_STAB_MAJOR = tnNormalise(TN_MAJOR);
const TN_STAB_MINOR = tnNormalise(TN_MINOR);

const TN_RISE = 0.7;
const TN_FALL = 0.75;
const TN_RUN_BONUS = 0.05;
const TN_STABLE_BELOW = 0.3;
// A new note must hold for this time. This hides piano clicks and FFT noise.
const TN_DEBOUNCE_MS = 70;
const TN_RESET_SILENCE_MS = 900;
const TN_HIST_LEN = 200;

const tnFillEl = document.getElementById('tensionFill');
const tnStateEl = document.getElementById('tensionState');
const tnKeyEl = document.getElementById('tensionKey');
const tnGraphEl = document.getElementById('tensionGraph');
const tnGraphCtx = tnGraphEl.getContext('2d');

const tn = {
    hist: new Float32Array(12),
    tonic: -1,
    minor: false,
    T: 0,
    shown: 0,
    run: 0,
    events: 0,
    sig: -1,
    pendingSig: -2,
    pendingSince: 0,
    silentSince: 0,
    state: 'IDLE',
    lastKeyText: '',
    lastStateText: '',
    ring: new Float32Array(TN_HIST_LEN),
    ringPos: 0,
    lastSample: 0
};

function tnPearson(x, y) {
    let mx = 0, my = 0;
    for (let i = 0; i < 12; i++) { mx += x[i]; my += y[i]; }
    mx /= 12; my /= 12;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < 12; i++) {
        const a = x[i] - mx, b = y[i] - my;
        num += a * b; dx += a * a; dy += b * b;
    }
    const den = Math.sqrt(dx * dy);
    return den < 1e-9 ? 0 : num / den;
}

function tnEstimateKey() {
    const rot = new Float32Array(12);
    let best = -2, bestT = 0, bestMinor = false, cur = -2;
    for (let m = 0; m < 2; m++) {
        const prof = m ? TN_MINOR : TN_MAJOR;
        for (let t = 0; t < 12; t++) {
            for (let i = 0; i < 12; i++) rot[i] = tn.hist[(t + i) % 12];
            const s = tnPearson(rot, prof);
            if (s > best) { best = s; bestT = t; bestMinor = !!m; }
            if (t === tn.tonic && !!m === tn.minor) cur = s;
        }
    }
    // Change the key only when the new fit is clearly better. The key then does not flip on each note.
    if (tn.tonic < 0 || best > cur + 0.08) {
        tn.tonic = bestT;
        tn.minor = bestMinor;
    }
}

function tnReadMelody() {
    if (scoreMelodyMidi >= 0) return ((scoreMelodyMidi % 12) + 12) % 12;
    let freq = 0;
    if (!isListeningToTab && activeKeysMap.size > 0) {
        for (const item of activeKeysMap.values()) freq = item.freq;
    } else {
        let best = 0;
        for (let i = 0; i < activeWaveModes.length; i++) {
            const m = activeWaveModes[i];
            const score = m.weight * ((m.freq >= 150 && m.freq <= 1400) ? 1 : 0.4);
            if (score > best) { best = score; freq = m.freq; }
        }
    }
    if (freq <= 0) return -1;
    const midi = 69 + 12 * Math.log2(freq / 440);
    return ((Math.round(midi) % 12) + 12) % 12;
}

function tnOnEvent(melody) {
    const first = tn.events === 0;

    for (let i = 0; i < 12; i++) tn.hist[i] *= 0.9;
    tn.hist[melody] += first ? 2.0 : 1.0;
    tnEstimateKey();

    const stab = tn.minor ? TN_STAB_MINOR : TN_STAB_MAJOR;
    const inst = 1 - stab[(melody - tn.tonic + 12) % 12];

    tn.run = inst >= TN_STABLE_BELOW ? tn.run + 1 : 0;
    const target = Math.min(1, inst + TN_RUN_BONUS * tn.run);
    const old = tn.T;
    if (first) tn.T = inst * 0.5;
    else if (target > old) tn.T = old + (target - old) * TN_RISE;
    else tn.T = old - (old - target) * TN_FALL;
    tn.T = Math.max(0, Math.min(1, tn.T));
    tn.events++;

    const delta = tn.T - old;
    if (first) tn.state = 'OPEN';
    else if (delta > 0.04) tn.state = 'RISING';
    else if (delta < -0.04) tn.state = (inst < 0.15 && tn.T < 0.2 && old > 0.25) ? 'RESOLVED' : 'RELEASING';
    else tn.state = 'HOLDING';
}

function tnReset() {
    tn.T = 0;
    tn.run = 0;
    tn.events = 0;
    tn.sig = -1;
    tn.pendingSig = -2;
    for (let i = 0; i < 12; i++) tn.hist[i] *= 0.5;
    tn.state = 'IDLE';
}

function tnDrawGraph() {
    const w = tnGraphEl.width, h = tnGraphEl.height;
    const g = tnGraphCtx;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(107, 51, 12, 0.8)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, h * 0.5 + 0.5); g.lineTo(w, h * 0.5 + 0.5);
    g.stroke();

    g.strokeStyle = '#ffb000';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < TN_HIST_LEN; i++) {
        const v = tn.ring[(tn.ringPos + i) % TN_HIST_LEN];
        const x = (i / (TN_HIST_LEN - 1)) * (w - 2) + 1;
        const y = h - 3 - v * (h - 6);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
}

function updateTension(now) {
    const melody = (activeKeysMap.size > 0 || activeWaveModes.length > 0) ? tnReadMelody() : -1;

    if (melody < 0) {
        if (tn.silentSince === 0) tn.silentSince = now;
        if (now - tn.silentSince > TN_RESET_SILENCE_MS && tn.state !== 'IDLE') tnReset();
    } else {
        tn.silentSince = 0;
        if (melody !== tn.sig) {
            if (melody !== tn.pendingSig) { tn.pendingSig = melody; tn.pendingSince = now; }
            else if (now - tn.pendingSince >= TN_DEBOUNCE_MS) {
                tn.sig = melody;
                tnOnEvent(melody);
            }
        } else {
            tn.pendingSig = -2;
        }
    }

    tn.shown += (tn.T - tn.shown) * 0.15;
    if (tn.shown < 0.002) tn.shown = 0;
    tnFillEl.style.clipPath = `inset(0 ${(100 - tn.shown * 100).toFixed(1)}% 0 0)`;

    const keyText = tn.tonic >= 0 && tn.events > 0 ? 'KEY ' + TN_NOTE_NAMES[tn.tonic] + (tn.minor ? 'm' : '') : 'KEY --';
    if (keyText !== tn.lastKeyText) { tn.lastKeyText = keyText; tnKeyEl.textContent = keyText; }
    const stateText = tn.state;
    if (stateText !== tn.lastStateText) {
        tn.lastStateText = stateText;
        tnStateEl.textContent = stateText;
        tnStateEl.className = stateText === 'RISING' ? 'st-up'
            : (stateText === 'RELEASING' || stateText === 'RESOLVED') ? 'st-down'
            : stateText === 'IDLE' ? 'st-idle' : 'st-hit';
    }

    if (now - tn.lastSample >= 100) {
        tn.lastSample = now;
        tn.ring[tn.ringPos] = tn.shown;
        tn.ringPos = (tn.ringPos + 1) % TN_HIST_LEN;
        tnDrawGraph();
    }
}

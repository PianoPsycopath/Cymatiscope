const FX_VIS_REV_GAIN = 2.5;
const FX_VIS_ECHO_GAIN = 2.5;
const FX_GHOST_MAX = 6;
const FX_GHOST_MIN_WEIGHT = 0.03;
const FX_FILTER_CUT = 0.08;
const FX_ECHO_REPEATS = 4;

const fxTails = new Map();
const fxEchoHist = [];
let fxEchoSig = '';
let fxTailLast = 0;

function fxVisActive() {
    return fxParams.enabled && fxParams.plate;
}

function fxVisSoft() {
    return fxVisActive() ? Math.min(1, (fxParams.revMix / 100) * (fxParams.wet / 100)) : 0;
}

function fxFilterModes(modes) {
    if (!fxVisActive()) return;
    const lpHz = fxLpHz(fxParams.lp);
    const hpHz = fxHpHz(fxParams.hp);
    if (lpHz >= 19000 && hpHz <= 25) return;
    let kept = 0;
    for (let i = 0; i < modes.length; i++) {
        const m = modes[i];
        const gain = 1 / Math.sqrt(1 + Math.pow(m.freq / lpHz, 4)) / Math.sqrt(1 + Math.pow(hpHz / m.freq, 4));
        if (gain < FX_FILTER_CUT) continue;
        modes[kept++] = gain > 0.995 ? m : Object.assign({}, m, { weight: m.weight * gain });
    }
    modes.length = kept;
}

function fxSignature(modes) {
    const keys = [];
    for (let i = 0; i < modes.length; i++) keys.push(Math.round(modes[i].freq * 2));
    return keys.sort((a, b) => a - b).join(',');
}

function fxCopyMode(m, weight, ghost) {
    return { freq: m.freq, m: m.m, n: m.n, nCirc: m.nCirc, weight, audio: m.audio, ghost };
}

// Ghost modes stay out of the harmony analysis. They must not show as notes.
function fxGhostModes(modes, now) {
    const ghosts = [];
    if (!fxVisActive()) {
        fxTails.clear();
        fxEchoHist.length = 0;
        fxEchoSig = '';
        fxTailLast = now;
        return ghosts;
    }
    const dt = Math.min(0.1, Math.max(0, (now - fxTailLast) / 1000));
    fxTailLast = now;
    const wet = fxParams.wet / 100;

    if (fxParams.revMix > 0 && wet > 0) {
        const decay = Math.exp(-6.9 * dt / Math.max(0.3, fxParams.revDecay));
        const gain = Math.min(1, (fxParams.revMix / 100) * wet * FX_VIS_REV_GAIN);

        for (const s of fxTails.values()) s.live = false;
        for (let i = 0; i < modes.length; i++) {
            const m = modes[i];
            const key = Math.round(m.freq * 4);
            let s = fxTails.get(key);
            if (!s) { s = {}; fxTails.set(key, s); }
            s.freq = m.freq; s.m = m.m; s.n = m.n; s.nCirc = m.nCirc; s.audio = m.audio;
            s.level = m.weight;
            s.live = true;
        }
        const tails = [];
        for (const [key, s] of fxTails) {
            if (s.live) continue;
            s.level *= decay;
            if (s.level * gain < FX_GHOST_MIN_WEIGHT) { fxTails.delete(key); continue; }
            tails.push(s);
        }
        tails.sort((a, b) => b.level - a.level);
        for (let i = 0; i < tails.length && i < FX_GHOST_MAX; i++) ghosts.push(fxCopyMode(tails[i], tails[i].level * gain, true));
    } else {
        fxTails.clear();
    }

    if (fxParams.echoMix > 0 && wet > 0) {
        const sig = fxSignature(modes);
        if (sig !== fxEchoSig) {
            fxEchoSig = sig;
            fxEchoHist.push({ t: now, sig, modes: modes.map(m => fxCopyMode(m, m.weight, false)) });
        }
        const echoTime = fxParams.echoTime;
        const maxAge = echoTime * (FX_ECHO_REPEATS + 1) + 1000;
        while (fxEchoHist.length > 1 && now - fxEchoHist[1].t > maxAge) fxEchoHist.shift();

        const fb = Math.min(0.9, fxParams.echoFb / 100);
        const gain = Math.min(1, (fxParams.echoMix / 100) * wet * FX_VIS_ECHO_GAIN);
        const echoes = [];
        for (let k = 1; k <= FX_ECHO_REPEATS; k++) {
            const w = gain * Math.pow(fb, k - 1);
            if (w < FX_GHOST_MIN_WEIGHT) break;
            const tt = now - k * echoTime;
            let snap = null;
            for (let i = fxEchoHist.length - 1; i >= 0; i--) if (fxEchoHist[i].t <= tt) { snap = fxEchoHist[i]; break; }
            if (!snap || snap.sig === sig) continue;
            for (let i = 0; i < snap.modes.length; i++) echoes.push(fxCopyMode(snap.modes[i], snap.modes[i].weight * w, true));
        }
        echoes.sort((a, b) => b.weight - a.weight);
        for (let i = 0; i < echoes.length && i < FX_GHOST_MAX; i++) ghosts.push(echoes[i]);
    } else {
        fxEchoHist.length = 0;
        fxEchoSig = '';
    }

    return ghosts;
}

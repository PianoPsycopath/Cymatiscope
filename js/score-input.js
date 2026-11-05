const SC_GAIN_SCALE = 3;
const SC_MIN_NOTE_SEC = 0.06;
const SC_SOUNDFONT = 'FluidR3_GM';
const SC_LEAD_IN = 0.15;
const SC_LOOKAHEAD = 0.3;
const SC_SAMPLE_GAIN = 0.25;
const SC_MAX_INSTRUMENTS = 8;
const SC_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SC_GM = ['acoustic_grand_piano', 'bright_acoustic_piano', 'electric_grand_piano', 'honkytonk_piano', 'electric_piano_1', 'electric_piano_2', 'harpsichord', 'clavinet', 'celesta', 'glockenspiel', 'music_box', 'vibraphone', 'marimba', 'xylophone', 'tubular_bells', 'dulcimer', 'drawbar_organ', 'percussive_organ', 'rock_organ', 'church_organ', 'reed_organ', 'accordion', 'harmonica', 'tango_accordion', 'acoustic_guitar_nylon', 'acoustic_guitar_steel', 'electric_guitar_jazz', 'electric_guitar_clean', 'electric_guitar_muted', 'overdriven_guitar', 'distortion_guitar', 'guitar_harmonics', 'acoustic_bass', 'electric_bass_finger', 'electric_bass_pick', 'fretless_bass', 'slap_bass_1', 'slap_bass_2', 'synth_bass_1', 'synth_bass_2', 'violin', 'viola', 'cello', 'contrabass', 'tremolo_strings', 'pizzicato_strings', 'orchestral_harp', 'timpani', 'string_ensemble_1', 'string_ensemble_2', 'synth_strings_1', 'synth_strings_2', 'choir_aahs', 'voice_oohs', 'synth_choir', 'orchestra_hit', 'trumpet', 'trombone', 'tuba', 'muted_trumpet', 'french_horn', 'brass_section', 'synth_brass_1', 'synth_brass_2', 'soprano_sax', 'alto_sax', 'tenor_sax', 'baritone_sax', 'oboe', 'english_horn', 'bassoon', 'clarinet', 'piccolo', 'flute', 'recorder', 'pan_flute', 'blown_bottle', 'shakuhachi', 'whistle', 'ocarina', 'lead_1_square', 'lead_2_sawtooth', 'lead_3_calliope', 'lead_4_chiff', 'lead_5_charang', 'lead_6_voice', 'lead_7_fifths', 'lead_8_bass__lead', 'pad_1_new_age', 'pad_2_warm', 'pad_3_polysynth', 'pad_4_choir', 'pad_5_bowed', 'pad_6_metallic', 'pad_7_halo', 'pad_8_sweep', 'fx_1_rain', 'fx_2_soundtrack', 'fx_3_crystal', 'fx_4_atmosphere', 'fx_5_brightness', 'fx_6_goblins', 'fx_7_echoes', 'fx_8_scifi', 'sitar', 'banjo', 'shamisen', 'koto', 'kalimba', 'bagpipe', 'fiddle', 'shanai', 'tinkle_bell', 'agogo', 'steel_drums', 'woodblock', 'taiko_drum', 'melodic_tom', 'synth_drum', 'reverse_cymbal', 'guitar_fret_noise', 'breath_noise', 'seashore', 'bird_tweet', 'telephone_ring', 'helicopter', 'applause', 'gunshot'];

let scoreAnalyser = null;
let scoreMelodyMidi = -1;

const scFileInput = document.getElementById('scoreFileInput');
const scStatusEl = document.getElementById('scoreStatus');
const scPlayBtn = document.getElementById('btnScorePlay');
const scProgress = document.getElementById('scoreProgress');
const scProgressFill = document.getElementById('scoreProgressFill');
const scMidiBtn = document.getElementById('btnMidiIn');
const scInstSel = document.getElementById('scoreInstrument');
// activeKeysMap needs an element. Score notes have no piano key.
const scDummyEl = document.createElement('div');

const sc = {
    ctx: null, master: null,
    notes: [], dur: 0, name: '',
    playing: false, pos: 0, t0: 0,
    queue: [],
    aIdx: 0,
    idx: 0,
    sched: [],
    active: [],
    instruments: new Map(),
    loading: new Map(),
    failed: new Set(),
    liveProg: 0,
    owned: new Map(),
    live: new Map(),
    liveOrder: [],
    pedal: false,
    sustained: new Set(),
    dirty: false,
    lastGain: -1,
    lastSecShown: -1,
    midiAccess: null,
    midiOn: false
};

function scFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function scLabel(midi) { return SC_NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }
function scFmt(s) { return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

function scSetStatus(text, cls) {
    scStatusEl.textContent = text;
    scStatusEl.className = 'status-line' + (cls ? ' ' + cls : '');
}

function scParseMidi(buf) {
    const u = new Uint8Array(buf);
    const d = new DataView(buf);
    let p = 0;
    const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u[p++]); return s; };
    const varlen = () => { let v = 0, b; do { b = u[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

    if (str(4) !== 'MThd') throw new Error('Not a MIDI file');
    const hlen = d.getUint32(p); p += 4;
    const ntrk = d.getUint16(p + 2);
    const division = d.getUint16(p + 4);
    p += hlen;
    if (division & 0x8000) throw new Error('SMPTE timing not supported');
    const ppq = division;

    const tempos = [];
    const raw = [];
    const progs = [];

    for (let ti = 0; ti < ntrk && p + 8 <= u.length; ti++) {
        const id = str(4);
        const len = d.getUint32(p); p += 4;
        const end = Math.min(u.length, p + len);
        if (id !== 'MTrk') { p = end; continue; }

        let tick = 0, run = 0;
        const open = new Map();
        while (p < end) {
            tick += varlen();
            let st = u[p];
            if (st < 0x80) st = run; else p++;

            if (st === 0xFF) {
                const type = u[p++];
                const mlen = varlen();
                if (type === 0x51 && mlen === 3) tempos.push({ tick, us: (u[p] << 16) | (u[p + 1] << 8) | u[p + 2] });
                p += mlen;
                if (type === 0x2F) break;
                continue;
            }
            if (st === 0xF0 || st === 0xF7) { p += varlen(); continue; }

            run = st;
            const hi = st & 0xF0, ch = st & 0x0F;
            if (hi === 0xC0 || hi === 0xD0) {
                if (hi === 0xC0) progs.push({ tick, ch, prog: u[p] });
                p += 1;
                continue;
            }
            const a = u[p++], b = u[p++];
            // Skip the drum channel. Drum hits have no pitch.
            if (ch === 9) continue;

            const key = ch * 128 + a;
            if (hi === 0x90 && b > 0) {
                if (!open.has(key)) open.set(key, []);
                open.get(key).push({ tick, vel: b });
            } else if (hi === 0x80 || hi === 0x90) {
                const stack = open.get(key);
                if (stack && stack.length) {
                    const s = stack.shift();
                    raw.push({ s: s.tick, e: tick, midi: a, vel: s.vel / 127, track: ti, ch });
                }
            }
        }
        for (const [key, stack] of open) {
            for (const s of stack) raw.push({ s: s.tick, e: tick, midi: key % 128, vel: s.vel / 127, track: ti, ch: Math.floor(key / 128) });
        }
        p = end;
    }

    tempos.sort((x, y) => x.tick - y.tick);
    const segs = [{ tick: 0, sec: 0, us: 500000 }];
    let sec = 0, lastTick = 0, us = 500000;
    for (const t of tempos) {
        sec += (t.tick - lastTick) * us / 1e6 / ppq;
        lastTick = t.tick;
        us = t.us;
        segs.push({ tick: t.tick, sec, us });
    }
    const toSec = (tick) => {
        let s = segs[0];
        for (let i = segs.length - 1; i >= 0; i--) if (segs[i].tick <= tick) { s = segs[i]; break; }
        return s.sec + (tick - s.tick) * s.us / 1e6 / ppq;
    };

    progs.sort((x, y) => x.tick - y.tick);
    const progAt = (ch, tick) => {
        let pr = 0;
        for (let i = 0; i < progs.length && progs[i].tick <= tick; i++) if (progs[i].ch === ch) pr = progs[i].prog;
        return pr;
    };

    return raw.map(n => ({ start: toSec(n.s), end: toSec(n.e), midi: n.midi, vel: n.vel, track: n.track, prog: progAt(n.ch, n.s) }));
}

function scParseMusicXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid XML');
    const root = doc.documentElement;
    if (root.nodeName !== 'score-partwise') throw new Error('Only score-partwise MusicXML is supported');

    const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const first = (el, name) => el.getElementsByTagName(name)[0];
    const num = (el, name) => { const c = first(el, name); return c ? parseFloat(c.textContent) || 0 : 0; };

    const tempoMap = [{ q: 0, bpm: 120 }];
    const raw = [];

    const progOf = {};
    const scoreParts = root.getElementsByTagName('score-part');
    for (let i = 0; i < scoreParts.length; i++) {
        const mp = first(scoreParts[i], 'midi-program');
        if (mp) progOf[scoreParts[i].getAttribute('id')] = Math.max(0, Math.min(127, (parseInt(mp.textContent, 10) || 1) - 1));
    }

    const parts = root.getElementsByTagName('part');
    for (let pi = 0; pi < parts.length; pi++) {
        const measures = parts[pi].getElementsByTagName('measure');
        const prog = progOf[parts[pi].getAttribute('id')] || 0;
        let div = 1, t = 0, lastStart = 0, transpose = 0;
        const openTies = new Map();

        for (let mi = 0; mi < measures.length; mi++) {
            let maxT = t;
            const kids = measures[mi].children;
            for (let ki = 0; ki < kids.length; ki++) {
                const el = kids[ki];
                const name = el.nodeName;

                if (name === 'attributes') {
                    const dv = num(el, 'divisions');
                    if (dv > 0) div = dv;
                    const tr = first(el, 'transpose');
                    if (tr) transpose = Math.round(num(tr, 'chromatic') + 12 * num(tr, 'octave-change'));
                } else if (name === 'backup') {
                    t -= num(el, 'duration');
                } else if (name === 'forward') {
                    t += num(el, 'duration');
                } else if (name === 'direction' || name === 'sound') {
                    const s = name === 'sound' ? el : first(el, 'sound');
                    const bpm = s ? parseFloat(s.getAttribute('tempo')) : NaN;
                    if (pi === 0 && bpm > 0) tempoMap.push({ q: t / div, bpm });
                } else if (name === 'note') {
                    const has = (n) => el.getElementsByTagName(n).length > 0;
                    if (has('grace')) continue;
                    const dur = num(el, 'duration');
                    const isChord = has('chord');
                    const start = isChord ? lastStart : t;

                    const pitch = first(el, 'pitch');
                    if (pitch && !has('rest') && !has('cue')) {
                        const step = first(pitch, 'step').textContent.trim();
                        const midi = (parseInt(first(pitch, 'octave').textContent, 10) + 1) * 12
                            + STEP[step] + Math.round(num(pitch, 'alter')) + transpose;
                        const ties = Array.from(el.getElementsByTagName('tie')).map(x => x.getAttribute('type'));
                        const q1 = (start + dur) / div;

                        if (ties.includes('stop') && openTies.has(midi)) {
                            const n = openTies.get(midi);
                            n.q1 = q1;
                            if (!ties.includes('start')) openTies.delete(midi);
                        } else {
                            const n = { q0: start / div, q1, midi, track: pi, prog };
                            raw.push(n);
                            if (ties.includes('start')) openTies.set(midi, n);
                        }
                    }
                    if (!isChord) { lastStart = t; t += dur; }
                }
                if (t > maxT) maxT = t;
            }
            t = maxT;
        }
    }

    tempoMap.sort((a, b) => a.q - b.q);
    const segs = [];
    let sec = 0, lastQ = 0, bpm = tempoMap[0].bpm;
    segs.push({ q: 0, sec: 0, bpm });
    for (let i = 1; i < tempoMap.length; i++) {
        sec += (tempoMap[i].q - lastQ) * 60 / bpm;
        lastQ = tempoMap[i].q;
        bpm = tempoMap[i].bpm;
        segs.push({ q: lastQ, sec, bpm });
    }
    const toSec = (q) => {
        let s = segs[0];
        for (let i = segs.length - 1; i >= 0; i--) if (segs[i].q <= q) { s = segs[i]; break; }
        return s.sec + (q - s.q) * 60 / s.bpm;
    };

    return raw.map(n => ({ start: toSec(n.q0), end: toSec(n.q1), midi: n.midi, vel: 0.7, track: n.track, prog: n.prog }));
}

function scEnsureAudio() {
    if (!sc.ctx) {
        sc.ctx = new (window.AudioContext || window.webkitAudioContext)();
        sc.master = sc.ctx.createGain();
        sc.master.gain.value = 0.2;
        const comp = sc.ctx.createDynamicsCompressor();
        scoreAnalyser = sc.ctx.createAnalyser();
        scoreAnalyser.fftSize = 8192;
        scoreAnalyser.smoothingTimeConstant = 0.6;
        const chain = fxCreate(sc.ctx);
        sc.master.connect(chain.input);
        chain.output.connect(comp);
        chain.output.connect(scoreAnalyser);
        comp.connect(sc.ctx.destination);
        sc.lastGain = -1;
    }
    if (sc.ctx.state === 'suspended') sc.ctx.resume();
}

function scProgName(p) {
    return SC_GM[p].replace(/_+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function scOverrideProg() {
    return scInstSel.value !== 'file' ? parseInt(scInstSel.value, 10) : -1;
}
function scProgramFor(note) {
    const o = scOverrideProg();
    return o >= 0 ? o : note.prog;
}
function scLiveProgram() {
    const o = scOverrideProg();
    return o >= 0 ? o : sc.liveProg;
}

function scLoadProgram(prog) {
    if (sc.instruments.has(prog)) return Promise.resolve(true);
    // The soundfont script can fail to load. Notes then use sine voices.
    if (sc.failed.has(prog) || typeof Soundfont === 'undefined') return Promise.resolve(false);
    if (sc.loading.has(prog)) return sc.loading.get(prog);
    scEnsureAudio();
    const pr = Soundfont.instrument(sc.ctx, SC_GM[prog], { soundfont: SC_SOUNDFONT, format: 'mp3', destination: sc.master })
        .then(inst => { sc.instruments.set(prog, inst); sc.loading.delete(prog); return true; })
        .catch(err => { console.error('Instrument load failed:', SC_GM[prog], err); sc.failed.add(prog); sc.loading.delete(prog); return false; });
    sc.loading.set(prog, pr);
    return pr;
}

async function scLoadPrograms(progs) {
    const list = Array.from(progs);
    let done = 0;
    scSetStatus(`Loading instruments 0/${list.length}...`, 'busy');
    const results = await Promise.all(list.map(p => scLoadProgram(p).then(ok => {
        done++;
        scSetStatus(`Loading instruments ${done}/${list.length}...`, 'busy');
        return ok;
    })));
    return results.every(Boolean);
}

function scNeededPrograms() {
    const o = scOverrideProg();
    if (o >= 0) return new Set([o]);
    return new Set(sc.notes.map(n => n.prog));
}

function scInfoText() {
    return sc.notes.length ? `${sc.name} · ${sc.notes.length} notes · ${scFmt(sc.dur)}` : 'No score';
}

function scSine(midi, vel, when, dur) {
    const t0 = Math.max(when, sc.ctx.currentTime);
    const osc = sc.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = scFreq(midi);
    const g = sc.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.25 + 0.5 * vel, t0 + 0.012);
    osc.connect(g);
    g.connect(sc.master);
    osc.start(t0);
    let stopped = false;
    const h = {
        stop(t) {
            if (stopped) return;
            stopped = true;
            t = Math.max(t, sc.ctx.currentTime);
            try {
                if (t <= t0) { osc.stop(t0); return; }
                g.gain.cancelScheduledValues(t);
                g.gain.setTargetAtTime(0, t, 0.05);
                osc.stop(t + 0.4);
            } catch (e) {}
        }
    };
    if (dur) h.stop(t0 + dur);
    return h;
}

function scStartVoice(prog, midi, vel, when, dur) {
    scEnsureAudio();
    const inst = sc.instruments.get(prog);
    if (inst) {
        const opts = { gain: SC_SAMPLE_GAIN + vel };
        if (dur) opts.duration = dur;
        const node = inst.play(midi, when, opts);
        return { stop(t) { if (node && node.stop) node.stop(t); } };
    }
    if (typeof Soundfont !== 'undefined' && !sc.failed.has(prog)) scLoadProgram(prog);
    return scSine(midi, vel, when, dur);
}

function scKeyOn(midi) {
    let o = sc.owned.get(midi);
    if (o) { o.n++; return; }
    const label = scLabel(midi);
    o = { n: 1, added: false, label };
    if (!activeKeysMap.has(label)) {
        activeKeysMap.set(label, { freq: scFreq(midi), element: scDummyEl });
        o.added = true;
        sc.dirty = true;
    }
    sc.owned.set(midi, o);
}

function scKeyOff(midi) {
    const o = sc.owned.get(midi);
    if (!o) return;
    if (--o.n > 0) return;
    sc.owned.delete(midi);
    if (o.added) {
        activeKeysMap.delete(o.label);
        sc.dirty = true;
    }
}

function scScheduleNote(n) {
    const when = sc.t0 + n.start;
    const h = scStartVoice(scProgramFor(n), n.midi, n.vel, when, n.end - n.start);
    sc.sched.push({ note: n, h });
}

function scDrawProgress() {
    scProgressFill.style.width = (sc.dur > 0 ? Math.min(100, (sc.pos / sc.dur) * 100) : 0).toFixed(1) + '%';
}

function scPlay() {
    if (!sc.notes.length) return;
    scEnsureAudio();
    sc.t0 = sc.ctx.currentTime + SC_LEAD_IN - sc.pos;

    const carry = [];
    let i = 0;
    while (i < sc.notes.length && sc.notes[i].start < sc.pos) {
        const n = sc.notes[i];
        if (n.end > sc.pos) carry.push({ start: sc.pos, end: n.end, midi: n.midi, vel: n.vel, track: n.track, prog: n.prog });
        i++;
    }
    sc.queue = carry.concat(sc.notes.slice(i));
    sc.aIdx = 0;
    sc.idx = 0;
    sc.playing = true;
    scPlayBtn.textContent = 'Pause';
}

function scPause() {
    if (sc.ctx) {
        const t = sc.ctx.currentTime;
        for (const s of sc.sched) s.h.stop(t);
    }
    sc.sched.length = 0;
    for (const a of sc.active) scKeyOff(a.note.midi);
    sc.active.length = 0;
    sc.playing = false;
    scPlayBtn.textContent = 'Play';
}

function scSeek(sec) {
    const wasPlaying = sc.playing;
    if (wasPlaying) scPause();
    sc.pos = Math.max(0, Math.min(sc.dur, sec));
    scDrawProgress();
    if (wasPlaying) scPlay();
}

function updateScore(now) {
    if (sc.ctx) {
        const g = synthVolume * SC_GAIN_SCALE;
        if (g !== sc.lastGain) { sc.lastGain = g; sc.master.gain.setTargetAtTime(g, sc.ctx.currentTime, 0.02); }
    }

    if (sc.playing) {
        const ctx = sc.ctx;
        // Subtract the output latency. The picture then matches the sound.
        const latency = ctx.outputLatency || ctx.baseLatency || 0;
        const audioPos = ctx.currentTime - sc.t0;
        sc.pos = Math.max(0, audioPos - latency);
        const q = sc.queue;

        while (sc.aIdx < q.length && q[sc.aIdx].start <= audioPos + SC_LOOKAHEAD) scScheduleNote(q[sc.aIdx++]);
        while (sc.idx < q.length && q[sc.idx].start <= sc.pos) {
            const n = q[sc.idx++];
            sc.active.push({ note: n });
            scKeyOn(n.midi);
        }
        for (let i = sc.active.length - 1; i >= 0; i--) {
            if (sc.active[i].note.end <= sc.pos) { scKeyOff(sc.active[i].note.midi); sc.active.splice(i, 1); }
        }
        for (let i = sc.sched.length - 1; i >= 0; i--) {
            if (sc.sched[i].note.end + 2 < audioPos) sc.sched.splice(i, 1);
        }

        if (sc.pos >= sc.dur && sc.idx >= q.length && sc.active.length === 0) {
            scPause();
            sc.pos = 0;
        }
        scDrawProgress();
        const secNow = Math.floor(sc.pos);
        if (secNow !== sc.lastSecShown) {
            sc.lastSecShown = secNow;
            scSetStatus(`${sc.name} ${scFmt(sc.pos)} / ${scFmt(sc.dur)}`, 'ok');
        }
    }

    let lead = -1;
    if (sc.liveOrder.length) lead = sc.liveOrder[sc.liveOrder.length - 1];
    else for (let i = 0; i < sc.active.length; i++) if (sc.active[i].note.midi > lead) lead = sc.active[i].note.midi;
    scoreMelodyMidi = lead;

    if (sc.dirty) {
        sc.dirty = false;
        updateDisplay();
    }
}

(function buildInstrumentList() {
    const first = document.createElement('option');
    first.value = 'file';
    first.textContent = 'Instruments: from file';
    scInstSel.appendChild(first);
    for (let i = 0; i < SC_GM.length; i++) {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = String(i + 1).padStart(3, '0') + ' ' + scProgName(i);
        scInstSel.appendChild(o);
    }
})();

scInstSel.addEventListener('change', async () => {
    const o = scOverrideProg();
    if (o < 0) {
        if (sc.notes.length) { scSetStatus('Loading instruments...', 'busy'); await scLoadPrograms(scNeededPrograms()); }
        scSetStatus(scInfoText(), 'ok');
        return;
    }
    scEnsureAudio();
    scSetStatus('Loading ' + scProgName(o) + '...', 'busy');
    const ok = await scLoadProgram(o);
    scSetStatus(ok ? scInfoText() : 'Samples unavailable, using sine', ok ? 'ok' : 'busy');
});

let scLoadToken = 0;

scFileInput.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const token = ++scLoadToken;
    scPause();
    sc.pos = 0;
    scPlayBtn.disabled = true;
    scSetStatus('Reading...', 'busy');
    try {
        const buf = await f.arrayBuffer();
        const h = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
        let notes;
        if (h[0] === 0x4D && h[1] === 0x54 && h[2] === 0x68 && h[3] === 0x64) notes = scParseMidi(buf);
        else if (h[0] === 0x50 && h[1] === 0x4B) throw new Error('.mxl not supported: export uncompressed MusicXML');
        else notes = scParseMusicXml(new TextDecoder().decode(buf));

        if (!notes.length) throw new Error('No notes found');
        for (const n of notes) if (n.end < n.start + SC_MIN_NOTE_SEC) n.end = n.start + SC_MIN_NOTE_SEC;
        notes.sort((a, b) => a.start - b.start);

        const counts = new Map();
        for (const n of notes) counts.set(n.prog, (counts.get(n.prog) || 0) + 1);
        if (counts.size > SC_MAX_INSTRUMENTS) {
            const keep = new Set(Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, SC_MAX_INSTRUMENTS).map(e => e[0]));
            for (const n of notes) if (!keep.has(n.prog)) n.prog = 0;
        }

        sc.notes = notes;
        sc.dur = notes.reduce((mx, n) => Math.max(mx, n.end), 0);
        sc.name = f.name.replace(/\.[^.]+$/, '');
        sc.lastSecShown = -1;
        scDrawProgress();

        scEnsureAudio();
        const ok = await scLoadPrograms(scNeededPrograms());
        if (token !== scLoadToken) return;
        scPlayBtn.disabled = false;
        if (ok) scSetStatus(scInfoText(), 'ok');
        else scSetStatus('Samples unavailable, using sine · ' + scInfoText(), 'busy');
    } catch (err) {
        console.error(err);
        sc.notes = [];
        sc.dur = 0;
        scPlayBtn.disabled = true;
        scDrawProgress();
        scSetStatus(err.message || 'Could not read file', 'err');
    }
});

scPlayBtn.addEventListener('click', () => { if (sc.playing) scPause(); else scPlay(); });

scProgress.addEventListener('click', (e) => {
    if (!sc.dur) return;
    const r = scProgress.getBoundingClientRect();
    scSeek(sc.dur * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
});

function scLiveOn(midi, vel) {
    scEnsureAudio();
    if (sc.live.has(midi)) { sc.live.get(midi).stop(sc.ctx.currentTime); scKeyOff(midi); }
    sc.sustained.delete(midi);
    sc.live.set(midi, scStartVoice(scLiveProgram(), midi, vel, sc.ctx.currentTime));
    sc.liveOrder = sc.liveOrder.filter(x => x !== midi);
    sc.liveOrder.push(midi);
    scKeyOn(midi);
}

function scLiveRelease(midi) {
    const v = sc.live.get(midi);
    if (!v) return;
    v.stop(sc.ctx.currentTime);
    sc.live.delete(midi);
    scKeyOff(midi);
}

function scLiveOff(midi) {
    sc.liveOrder = sc.liveOrder.filter(x => x !== midi);
    if (sc.pedal) sc.sustained.add(midi);
    else scLiveRelease(midi);
}

function scOnMidi(e) {
    const st = e.data[0], a = e.data[1], b = e.data[2];
    const hi = st & 0xF0;
    if ((st & 0x0F) === 9) return;
    if (hi === 0x90 && b > 0) scLiveOn(a, b / 127);
    else if (hi === 0x80 || hi === 0x90) scLiveOff(a);
    else if (hi === 0xC0) {
        sc.liveProg = a;
        if (scOverrideProg() < 0) scLoadProgram(a);
    } else if (hi === 0xB0 && a === 64) {
        sc.pedal = b >= 64;
        if (!sc.pedal) { for (const m of sc.sustained) scLiveRelease(m); sc.sustained.clear(); }
    }
}

function scBindMidiInputs() {
    const names = [];
    for (const input of sc.midiAccess.inputs.values()) {
        input.onmidimessage = scOnMidi;
        names.push(input.name);
    }
    scMidiBtn.textContent = names.length ? 'MIDI: ' + names[0] + (names.length > 1 ? ' +' + (names.length - 1) : '') : 'MIDI: no device';
}

function scMidiOff() {
    sc.midiOn = false;
    if (sc.midiAccess) for (const input of sc.midiAccess.inputs.values()) input.onmidimessage = null;
    for (const m of Array.from(sc.live.keys())) scLiveRelease(m);
    sc.liveOrder.length = 0;
    sc.sustained.clear();
    sc.pedal = false;
    scMidiBtn.classList.remove('on');
    scMidiBtn.textContent = 'MIDI Keyboard';
}

scMidiBtn.addEventListener('click', async () => {
    if (sc.midiOn) { scMidiOff(); return; }
    if (!navigator.requestMIDIAccess) { scMidiBtn.textContent = 'MIDI not supported'; return; }
    try {
        sc.midiAccess = await navigator.requestMIDIAccess();
    } catch (err) {
        scMidiBtn.textContent = 'MIDI denied';
        return;
    }
    scEnsureAudio();
    scLoadProgram(scLiveProgram());
    sc.midiOn = true;
    sc.midiAccess.onstatechange = () => { if (sc.midiOn) scBindMidiInputs(); };
    scBindMidiInputs();
    scMidiBtn.classList.add('on');
});

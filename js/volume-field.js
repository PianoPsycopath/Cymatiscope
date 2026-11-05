const VOL_N = 40;
const VOL_N2 = VOL_N * VOL_N;
const VOL_CELLS = VOL_N2 * VOL_N;
const VOL_STEP = 2 / (VOL_N - 1);
const VOL_RAD_BINS = 256;
const VOL_A_BINS = 512;
const VOL_B_BINS = 512;
const VOL_TORUS_R = 0.62;
const VOL_TORUS_A = 0.38;

const volCoord = new Float32Array(VOL_N);
for (let i = 0; i < VOL_N; i++) volCoord[i] = (i / (VOL_N - 1)) * 2 - 1;

const ampVol = new Float32Array(VOL_CELLS);
const goldVol = new Float32Array(VOL_CELLS);
const clashVol = new Float32Array(VOL_CELLS);

let volInsideList, volRad, volA, volB, volCellValid;
let volInsideCount = 0;
let volShapeName = 'cube';
let volBMin = -Math.PI;
let volBMax = Math.PI;
const volDomains = {};

function buildVolumeDomain(name) {
    const d = {
        inside: new Uint8Array(VOL_CELLS),
        list: new Int32Array(VOL_CELLS),
        count: 0,
        rad: new Uint8Array(VOL_CELLS),
        a: new Uint16Array(VOL_CELLS),
        b: new Uint16Array(VOL_CELLS),
        valid: new Uint8Array(VOL_CELLS),
        bMin: name === 'sphere' ? 0 : -Math.PI,
        bMax: Math.PI
    };
    const twoPi = Math.PI * 2;
    const bSpan = d.bMax - d.bMin;

    let idx = 0;
    for (let z = 0; z < VOL_N; z++) {
        const pz = volCoord[z];
        for (let y = 0; y < VOL_N; y++) {
            const py = volCoord[y];
            for (let x = 0; x < VOL_N; x++) {
                const px = volCoord[x];
                let inside = 1, rad = 0, th = 0, b = 0;

                if (name === 'sphere') {
                    const r = Math.sqrt(px * px + py * py + pz * pz);
                    inside = r <= 1 ? 1 : 0;
                    rad = r;
                    th = Math.atan2(pz, px) + Math.PI;
                    b = r > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, py / r))) : 0;
                } else if (name === 'cylinder') {
                    const rho = Math.sqrt(px * px + pz * pz);
                    inside = rho <= 1 ? 1 : 0;
                    rad = rho;
                    th = Math.atan2(pz, px) + Math.PI;
                    b = Math.PI * py;
                } else if (name === 'torus') {
                    const rho = Math.sqrt(px * px + pz * pz);
                    const dx = rho - VOL_TORUS_R;
                    const dd = Math.sqrt(dx * dx + py * py);
                    inside = dd <= VOL_TORUS_A ? 1 : 0;
                    rad = dd / VOL_TORUS_A;
                    th = Math.atan2(pz, px) + Math.PI;
                    b = Math.atan2(py, dx);
                }

                if (th >= twoPi) th -= twoPi;
                d.inside[idx] = inside;
                if (inside) d.list[d.count++] = idx;
                d.rad[idx] = Math.min(VOL_RAD_BINS - 1, ((rad > 1 ? 1 : rad) * (VOL_RAD_BINS - 1) + 0.5) | 0);
                d.a[idx] = Math.min(VOL_A_BINS - 1, ((th / twoPi) * VOL_A_BINS) | 0);
                d.b[idx] = Math.max(0, Math.min(VOL_B_BINS - 1, (((b - d.bMin) / bSpan) * (VOL_B_BINS - 1) + 0.5) | 0));
                idx++;
            }
        }
    }

    for (let z = 0; z < VOL_N - 1; z++) {
        for (let y = 0; y < VOL_N - 1; y++) {
            for (let x = 0; x < VOL_N - 1; x++) {
                const i = z * VOL_N2 + y * VOL_N + x;
                const s = d.inside;
                if (s[i] && s[i + 1] && s[i + VOL_N] && s[i + VOL_N + 1] &&
                    s[i + VOL_N2] && s[i + VOL_N2 + 1] && s[i + VOL_N2 + VOL_N] && s[i + VOL_N2 + VOL_N + 1]) {
                    d.valid[i] = 1;
                }
            }
        }
    }
    return d;
}

// Each shape builds its tables one time. Views can then change shape without delay.
function useVolumeDomain(name) {
    let d = volDomains[name];
    if (!d) d = volDomains[name] = buildVolumeDomain(name);
    volShapeName = name;
    volInsideList = d.list;
    volInsideCount = d.count;
    volRad = d.rad;
    volA = d.a;
    volB = d.b;
    volCellValid = d.valid;
    volBMin = d.bMin;
    volBMax = d.bMax;
}
useVolumeDomain('cube');

function createVolumeSet() {
    return { amp: new Float32Array(VOL_CELLS), gold: new Float32Array(VOL_CELLS), clash: new Float32Array(VOL_CELLS) };
}
const MAIN_VOLUME = { amp: ampVol, gold: goldVol, clash: clashVol };

const vCosM = new Float32Array(VOL_N);
const vCosN = new Float32Array(VOL_N);
const vCosP = new Float32Array(VOL_N);
const vCosRad = new Float32Array(VOL_RAD_BINS);
const vCosA = new Float32Array(VOL_A_BINS);
const vCosB = new Float32Array(VOL_B_BINS);

function accumulateModeVolume(mode, w, target) {
    const pi = Math.PI;
    const n = mode.n;

    if (volShapeName === 'cube') {
        const mPi = mode.m * pi;
        const nPi = n * pi;
        const pPi = n * 0.8 * pi;
        for (let i = 0; i < VOL_N; i++) {
            const c = volCoord[i];
            vCosM[i] = Math.cos(mPi * c);
            vCosN[i] = Math.cos(nPi * c);
            vCosP[i] = Math.cos(pPi * c);
        }
        let idx = 0;
        for (let z = 0; z < VOL_N; z++) {
            const cPz = vCosP[z];
            const cMz = vCosM[z];
            for (let y = 0; y < VOL_N; y++) {
                const a = vCosN[y] * cPz;
                const b = vCosP[y] * cMz;
                for (let x = 0; x < VOL_N; x++) {
                    target[idx++] += w * (vCosM[x] * a - vCosN[x] * b);
                }
            }
        }
        return;
    }

    const mPi = mode.m * pi;
    const nA = mode.nCirc || Math.max(1, Math.round(n * 80 / 150));
    const pB = volShapeName === 'cylinder' ? n * 0.8 : Math.max(1, Math.round(n * 0.727));
    const bSpan = volBMax - volBMin;
    for (let r = 0; r < VOL_RAD_BINS; r++) vCosRad[r] = Math.cos(mPi * (r / (VOL_RAD_BINS - 1)));
    for (let a = 0; a < VOL_A_BINS; a++) vCosA[a] = Math.cos(nA * 2 * pi * (a / VOL_A_BINS));
    for (let b = 0; b < VOL_B_BINS; b++) vCosB[b] = Math.cos(pB * (volBMin + bSpan * (b / (VOL_B_BINS - 1))));

    for (let k = 0; k < volInsideCount; k++) {
        const i = volInsideList[k];
        target[i] += w * vCosRad[volRad[i]] * vCosA[volA[i]] * vCosB[volB[i]];
    }
}

const surfPos = new Float32Array(VOL_CELLS * 3);
const surfVertCell = new Int32Array(VOL_CELLS);
const surfCX = new Uint8Array(VOL_CELLS);
const surfCY = new Uint8Array(VOL_CELLS);
const surfCZ = new Uint8Array(VOL_CELLS);
const surfLineIdx = new Uint32Array(VOL_CELLS * 6);
const surfTriIdx = new Uint32Array(VOL_CELLS * 18);
const surfCellVert = new Int32Array(VOL_CELLS);
let surfVertCount = 0;
let surfLineCount = 0;
let surfLineStride = 2;
let surfTriCount = 0;

const SN_EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3];
const SN_EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
const snV = new Float32Array(8);
const snOff = [0, 1, VOL_N, VOL_N + 1, VOL_N2, VOL_N2 + 1, VOL_N2 + VOL_N, VOL_N2 + VOL_N + 1];

function extractVolumeSurface(F) {
    surfCellVert.fill(-1);
    let nv = 0, nl = 0, nt = 0;

    for (let z = 0; z < VOL_N - 1; z++) {
        for (let y = 0; y < VOL_N - 1; y++) {
            const row = z * VOL_N2 + y * VOL_N;
            for (let x = 0; x < VOL_N - 1; x++) {
                const i = row + x;
                if (!volCellValid[i]) continue;

                let mask = 0;
                for (let c = 0; c < 8; c++) {
                    const v = F[i + snOff[c]];
                    snV[c] = v;
                    if (v > 0) mask |= 1 << c;
                }
                if (mask === 0 || mask === 255) continue;

                let sx = 0, sy = 0, sz = 0, cnt = 0;
                for (let e = 0; e < 12; e++) {
                    const a = SN_EA[e], b = SN_EB[e];
                    if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
                    const va = snV[a];
                    const t = va / (va - snV[b]);
                    sx += (a & 1) + t * ((b & 1) - (a & 1));
                    sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
                    sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
                    cnt++;
                }
                const inv = 1 / cnt;
                const p = nv * 3;
                surfPos[p] = volCoord[x] + sx * inv * VOL_STEP;
                surfPos[p + 1] = volCoord[y] + sy * inv * VOL_STEP;
                surfPos[p + 2] = volCoord[z] + sz * inv * VOL_STEP;
                surfVertCell[nv] = i;
                surfCX[nv] = x; surfCY[nv] = y; surfCZ[nv] = z;
                surfCellVert[i] = nv;
                nv++;
            }
        }
    }

    const N = VOL_N, N2 = VOL_N2;
    for (let z = 1; z < N - 1; z++) {
        for (let y = 1; y < N - 1; y++) {
            for (let x = 0; x < N - 1; x++) {
                const i = z * N2 + y * N + x;
                if ((F[i] > 0) === (F[i + 1] > 0)) continue;
                const a = surfCellVert[i - N - N2], b = surfCellVert[i - N2], c = surfCellVert[i], d = surfCellVert[i - N];
                if ((a | b | c | d) < 0) continue;
                surfTriIdx[nt++] = a; surfTriIdx[nt++] = b; surfTriIdx[nt++] = c;
                surfTriIdx[nt++] = a; surfTriIdx[nt++] = c; surfTriIdx[nt++] = d;
            }
        }
    }
    for (let z = 1; z < N - 1; z++) {
        for (let y = 0; y < N - 1; y++) {
            for (let x = 1; x < N - 1; x++) {
                const i = z * N2 + y * N + x;
                if ((F[i] > 0) === (F[i + N] > 0)) continue;
                const a = surfCellVert[i - 1 - N2], b = surfCellVert[i - N2], c = surfCellVert[i], d = surfCellVert[i - 1];
                if ((a | b | c | d) < 0) continue;
                surfTriIdx[nt++] = a; surfTriIdx[nt++] = b; surfTriIdx[nt++] = c;
                surfTriIdx[nt++] = a; surfTriIdx[nt++] = c; surfTriIdx[nt++] = d;
            }
        }
    }
    for (let z = 0; z < N - 1; z++) {
        for (let y = 1; y < N - 1; y++) {
            for (let x = 1; x < N - 1; x++) {
                const i = z * N2 + y * N + x;
                if ((F[i] > 0) === (F[i + N2] > 0)) continue;
                const a = surfCellVert[i - 1 - N], b = surfCellVert[i - N], c = surfCellVert[i], d = surfCellVert[i - 1];
                if ((a | b | c | d) < 0) continue;
                surfTriIdx[nt++] = a; surfTriIdx[nt++] = b; surfTriIdx[nt++] = c;
                surfTriIdx[nt++] = a; surfTriIdx[nt++] = c; surfTriIdx[nt++] = d;
            }
        }
    }

    const s = surfLineStride;
    for (let k = 0; k < nv; k++) {
        const i = surfVertCell[k];
        const x = surfCX[k], y = surfCY[k], z = surfCZ[k];

        if (x < N - 2 && (s === 1 || (y + z) % s === 0)) {
            const j = surfCellVert[i + 1];
            if (j >= 0) {
                const n = (F[i + 1] > 0) + (F[i + 1 + N] > 0) + (F[i + 1 + N2] > 0) + (F[i + 1 + N + N2] > 0);
                if (n > 0 && n < 4) { surfLineIdx[nl++] = k; surfLineIdx[nl++] = j; }
            }
        }
        if (y < N - 2 && (s === 1 || (x + z) % s === 0)) {
            const j = surfCellVert[i + N];
            if (j >= 0) {
                const n = (F[i + N] > 0) + (F[i + N + 1] > 0) + (F[i + N + N2] > 0) + (F[i + N + 1 + N2] > 0);
                if (n > 0 && n < 4) { surfLineIdx[nl++] = k; surfLineIdx[nl++] = j; }
            }
        }
        if (z < N - 2 && (s === 1 || (x + y) % s === 0)) {
            const j = surfCellVert[i + N2];
            if (j >= 0) {
                const n = (F[i + N2] > 0) + (F[i + N2 + 1] > 0) + (F[i + N2 + N] > 0) + (F[i + N2 + N + 1] > 0);
                if (n > 0 && n < 4) { surfLineIdx[nl++] = k; surfLineIdx[nl++] = j; }
            }
        }
    }

    surfVertCount = nv;
    surfLineCount = nl;
    surfTriCount = nt;
}

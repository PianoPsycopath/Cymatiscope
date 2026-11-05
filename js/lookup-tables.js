const normCoord = new Float32Array(FIELD_SIZE);
for (let i = 0; i < FIELD_SIZE; i++) {
    normCoord[i] = (i / (FIELD_SIZE - 1)) * 2 - 1;
}

const cosM = new Float32Array(FIELD_SIZE);
const cosN = new Float32Array(FIELD_SIZE);

const cellRIndex = new Uint16Array(FIELD_CELLS);
const cellThetaIndex = new Uint16Array(FIELD_CELLS);
const cellInsideCircle = new Uint8Array(FIELD_CELLS);
const cosMR = new Float32Array(R_BINS);
const cosNTheta = new Float32Array(THETA_BINS);

function createFieldSet() {
    return {
        ampField: new Float32Array(FIELD_CELLS),
        goldField: new Float32Array(FIELD_CELLS),
        clashField: new Float32Array(FIELD_CELLS)
    };
}
const MAIN_FIELDS = createFieldSet();
let ampField = MAIN_FIELDS.ampField;
let goldField = MAIN_FIELDS.goldField;
let clashField = MAIN_FIELDS.clashField;
function bindFieldSet(s) {
    ampField = s.ampField;
    goldField = s.goldField;
    clashField = s.clashField;
}

function initPolarLookupTables() {
    const twoPi = Math.PI * 2;
    let idx = 0;
    for (let y = 0; y < FIELD_SIZE; y++) {
        const ny = normCoord[y];
        for (let x = 0; x < FIELD_SIZE; x++) {
            const nx = normCoord[x];
            const r = Math.sqrt(nx * nx + ny * ny);
            let theta = Math.atan2(ny, nx) + Math.PI * 0.5;
            if (theta < 0) theta += twoPi;
            if (theta >= twoPi) theta -= twoPi;

            const rClamped = r < 1.0 ? r : 1.0;
            cellRIndex[idx] = Math.min(R_BINS - 1, (rClamped * (R_BINS - 1)) | 0);
            cellThetaIndex[idx] = Math.min(THETA_BINS - 1, ((theta / twoPi) * THETA_BINS) | 0);
            cellInsideCircle[idx] = r <= 1.0 ? 1 : 0;
            idx++;
        }
    }
}
initPolarLookupTables();

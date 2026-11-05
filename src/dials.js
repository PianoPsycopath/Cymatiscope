const DIAL_SVG = 'http://www.w3.org/2000/svg';

const DIAL_X0 = 3, DIAL_Y0 = 3, DIAL_Y1 = 37;
const DIAL_S = DIAL_Y1 - DIAL_Y0;
const DIAL_H = 66;
const DIAL_LEN = DIAL_S + DIAL_H;
const DIAL_W_START = 16, DIAL_W_END = 6;
const DIAL_STOPS = [[0, [31, 224, 106]], [0.35, [61, 255, 122]], [0.62, [255, 176, 0]], [0.82, [255, 90, 26]], [1, [255, 46, 62]]];

const DIAL_A = DIAL_W_START + (DIAL_W_END - DIAL_W_START) * (DIAL_S / DIAL_LEN);
const DIAL_LV = DIAL_S - DIAL_A;
const DIAL_TOTAL = DIAL_LV + DIAL_H;
const DIAL_TC = DIAL_LV / DIAL_TOTAL;

function dialNode(tag, attrs, cls) {
    const n = document.createElementNS(DIAL_SVG, tag);
    if (cls) n.setAttribute('class', cls);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
}

function dialWidth(s) { return DIAL_W_START + (DIAL_W_END - DIAL_W_START) * (s / DIAL_LEN); }

function dialOuter(s, pad) { return s <= DIAL_S ? [DIAL_X0 - pad, DIAL_Y1 - s] : [DIAL_X0 + (s - DIAL_S), DIAL_Y0 - pad]; }
function dialInner(s, pad) { return s <= DIAL_S ? [DIAL_X0 + dialWidth(s) + pad, DIAL_Y1 - s] : [DIAL_X0 + (s - DIAL_S), DIAL_Y0 + dialWidth(s) + pad]; }

function dialPoints(pts) {
    return pts.map((p) => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
}

function dialSlice(s0, s1, pad) {
    const outer = [dialOuter(s0, pad)], inner = [dialInner(s0, pad)];
    if (s0 < DIAL_S && s1 > DIAL_S) {
        const a = dialWidth(DIAL_S);
        outer.push([DIAL_X0 - pad, DIAL_Y0 - pad]);
        inner.push([DIAL_X0 + a + pad, DIAL_Y0 + a + pad]);
    }
    outer.push(dialOuter(s1, pad));
    inner.push(dialInner(s1, pad));
    return dialPoints(outer.concat(inner.reverse()));
}

function dialTop(d) {
    if (d <= 0.05) return '';
    const aw = dialWidth(DIAL_LV);
    const x0 = DIAL_X0, y0 = DIAL_Y0;
    if (d <= aw) return dialPoints([[x0, y0], [x0 + d, y0], [x0 + d, y0 + DIAL_A], [x0, y0 + DIAL_A]]);
    return dialPoints([[x0, y0], [x0 + d, y0], [x0 + d, y0 + dialWidth(DIAL_S + d)], [x0 + aw, y0 + dialWidth(DIAL_S + aw)], [x0 + aw, y0 + DIAL_A], [x0, y0 + DIAL_A]]);
}

function dialColor(t) {
    for (let i = 1; i < DIAL_STOPS.length; i++) {
        if (t <= DIAL_STOPS[i][0]) {
            const a = DIAL_STOPS[i - 1], b = DIAL_STOPS[i], k = (t - a[0]) / (b[0] - a[0]);
            return 'rgb(' + a[1].map((c, n) => Math.round(c + (b[1][n] - c) * k)).join(',') + ')';
        }
    }
    return 'rgb(' + DIAL_STOPS[DIAL_STOPS.length - 1][1].join(',') + ')';
}

function dialDefs() {
    if (document.getElementById('dialGradV')) return;
    const svg = dialNode('svg', { width: 0, height: 0, 'aria-hidden': 'true', style: 'position:absolute' });
    const defs = dialNode('defs', {});
    const makeGradient = (id, coords, t0, t1) => {
        const g = dialNode('linearGradient', Object.assign({ id, gradientUnits: 'userSpaceOnUse' }, coords));
        for (let i = 0; i <= 12; i++) {
            g.appendChild(dialNode('stop', { offset: (i / 12).toFixed(3), 'stop-color': dialColor(t0 + (t1 - t0) * i / 12) }));
        }
        defs.appendChild(g);
    };
    makeGradient('dialGradV', { x1: 0, y1: DIAL_Y1, x2: 0, y2: DIAL_Y0 + DIAL_A }, 0, DIAL_TC);
    makeGradient('dialGradH', { x1: DIAL_X0, y1: 0, x2: DIAL_X0 + DIAL_H, y2: 0 }, DIAL_TC, 1);
    svg.appendChild(defs);
    document.body.appendChild(svg);
}

function dialBuild(input) {
    const attr = (name, fallback) => { const v = parseFloat(input.getAttribute(name)); return isNaN(v) ? fallback : v; };
    const min = attr('min', 0);
    const max = attr('max', 100);
    const step = attr('step', 1) || 1;
    const def = attr('value', parseFloat(input.value));
    const range = max - min;

    const dial = document.createElement('div');
    dial.className = 'dial';
    dial.tabIndex = 0;
    dial.setAttribute('role', 'slider');
    dial.setAttribute('aria-valuemin', min);
    dial.setAttribute('aria-valuemax', max);
    const label = input.id ? document.querySelector('label[for="' + input.id + '"]') : null;
    if (label) dial.setAttribute('aria-label', label.textContent.trim());

    const svg = dialNode('svg', { viewBox: '0 0 72 40' });
    svg.appendChild(dialNode('polygon', { points: dialSlice(0, DIAL_LEN, 2.4) }, 'd-frame'));
    svg.appendChild(dialNode('polygon', { points: dialSlice(0, DIAL_LEN, 1.2) }, 'd-bed'));

    svg.appendChild(dialNode('polygon', { points: dialSlice(0, DIAL_LV + 0.5, 0), fill: 'url(#dialGradV)' }, 'd-dim'));
    svg.appendChild(dialNode('polygon', { points: dialTop(DIAL_H), fill: 'url(#dialGradH)' }, 'd-dim'));
    const lit = dialNode('g', {}, 'd-lit');
    const litV = dialNode('polygon', { points: '', fill: 'url(#dialGradV)' });
    const litH = dialNode('polygon', { points: '', fill: 'url(#dialGradH)' });
    lit.appendChild(litV);
    lit.appendChild(litH);
    svg.appendChild(lit);
    dial.appendChild(svg);

    input.classList.add('dial-src');
    input.parentNode.insertBefore(dial, input);
    if (label) label.addEventListener('click', () => dial.focus());

    const fraction = () => Math.max(0, Math.min(1, (parseFloat(input.value) - min) / range));

    function update() {
        const s = fraction() * DIAL_TOTAL;
        litV.setAttribute('points', s > 0.05 ? dialSlice(0, Math.min(s, DIAL_LV + 0.5), 0) : '');
        litH.setAttribute('points', dialTop(s - DIAL_LV));
        dial.setAttribute('aria-valuenow', input.value);
        const valueEl = input.id ? document.getElementById(input.id + 'Val') : null;
        if (valueEl) dial.setAttribute('aria-valuetext', valueEl.textContent);
    }

    function setValue(v) {
        v = Math.max(min, Math.min(max, v));
        v = +(Math.round((v - min) / step) * step + min).toFixed(4);
        if (v === parseFloat(input.value)) return;
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        update();
    }

    let drag = null;
    dial.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        drag = { x: e.clientX, y: e.clientY, f: fraction() };
        dial.setPointerCapture(e.pointerId);
        dial.classList.add('active');
        dial.focus();
        e.preventDefault();
    });
    dial.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const travel = e.shiftKey ? 900 : 180;
        const delta = ((e.clientX - drag.x) + (drag.y - e.clientY)) / travel;
        setValue(min + Math.max(0, Math.min(1, drag.f + delta)) * range);
    });
    const endDrag = () => { drag = null; dial.classList.remove('active'); };
    dial.addEventListener('pointerup', endDrag);
    dial.addEventListener('pointercancel', endDrag);

    dial.addEventListener('wheel', (e) => {
        e.preventDefault();
        const inc = Math.max(step, range * (e.shiftKey ? 0.005 : 0.02));
        setValue(parseFloat(input.value) + (e.deltaY < 0 ? inc : -inc));
    }, { passive: false });

    dial.addEventListener('dblclick', () => setValue(def));

    dial.addEventListener('keydown', (e) => {
        const v = parseFloat(input.value);
        const big = Math.max(step, range * 0.1);
        let next = null;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = v + step;
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = v - step;
        else if (e.key === 'PageUp') next = v + big;
        else if (e.key === 'PageDown') next = v - big;
        else if (e.key === 'Home') next = min;
        else if (e.key === 'End') next = max;
        if (next === null) return;
        e.preventDefault();
        setValue(next);
    });

    input._dialUpdate = update;
    update();
}

export function dialSync(input) {
    if (input && input._dialUpdate) input._dialUpdate();
}

dialDefs();
document.querySelectorAll('input.dial-src').forEach(dialBuild);

"use strict";

const $c = id => document.getElementById(id);

const LS_CASCADE = "kns-cascade";
const LS_N = "kns-cascade-n";

const LOCK_OPEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 .5" stroke="currentColor" stroke-width="1.5"/></svg>`;
const LOCK_CLOSED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.5"/></svg>`;

const NODE_HTML = {
  pump: `
    <div class="node-box node-pump">
      <div class="node-title"><span class="node-num"></span> Насосная станция</div>
      <button class="node-lock" type="button" title="Заблокировать параметры"></button>
      <div class="nf"><label>Qr, л/с</label><input df-qr type="number" step="any" min="1"></div>
      <div class="nf"><label>tr, мин</label><input df-tr type="number" step="any" min="1"></div>
      <div class="nf"><label>Qнс, л/с</label><input df-q type="number" step="any" min="1"></div>
      <input class="q-range" type="range" step="0.5" min="1" title="Qнс — производительность, л/с">
      <div class="nf"><label>вне пика, %</label><input df-idle type="number" step="any" min="0" max="100"></div>
      <div class="lock-note"></div>
      <div class="node-summary">—</div>
      <button class="mode-toggle" type="button" title="Численный режим расчёта">Σ</button>
    </div>`,
  catch: `
    <div class="node-box node-catch">
      <div class="node-title"><span class="node-num"></span> Водосбор</div>
      <button class="node-lock" type="button" title="Заблокировать параметры"></button>
      <div class="nf"><label>F, га</label><input df-F type="number" step="any" min="0.01"></div>
      <div class="nf"><label>q₂₀, л/с·га</label><input df-q20 type="number" step="any" min="1"></div>
      <div class="nf"><label>P, лет</label><input df-P type="number" step="any" min="0.1"></div>
      <div class="nf"><label>tcon, мин</label><input df-tcon type="number" step="any" min="0"></div>
      <div class="catch-out">Qr = — · tr = —</div>
      <button class="catch-info" type="button" title="Формулы расчёта Qr и tr (п. 2.3.1)">?</button>
    </div>`,
  delay: `
    <div class="node-box node-delay">
      <div class="node-title"><span class="node-num"></span> Участок сети</div>
      <button class="node-lock" type="button" title="Заблокировать параметры"></button>
      <div class="nf"><label>v, м/с</label><input df-v type="number" step="any" min="0.01"></div>
      <div class="nf"><label>L, м</label><input df-l type="number" step="any" min="0"></div>
      <div class="delay-out">Δt = —</div>
    </div>`,
};

const NODE_DEFAULTS = {
  pump: { qr: 342.3, tr: 10, q: 100, idle: 50, mode: "analytic" },
  delay: { v: 1, l: 3600 },
  catch: {
    F: 3.9, q20: 80, P: 1.0, mr: 150, gamma: 1.54,
    psiMid: 0.634, zMid: 0.201, tcon: 3, tcan: 0,
    l1: 68, v1: 0.7, l2: 133, v2: 1.0, l3: 277, v3: 1.5,
    coeffMode: "variable",
  },
};

const NODE_PORTS = { pump: [1, 1], delay: [1, 1], catch: [0, 1] };
const NODE_LABEL = { pump: "КНС", delay: "Участок", catch: "Водосбор" };
const COMP_COLORS = ["#0b7285", "#f08c00", "#7048e8", "#2f9e44", "#e8590c", "#1098ad"];

const XMARK_HTML = `<svg class="ic ic-xmark" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M3.47 3.47a.75.75 0 0 1 1.06 0L8 6.94l3.47-3.47a.75.75 0 1 1 1.06 1.06L9.06 8l3.47 3.47a.75.75 0 1 1-1.06 1.06L8 9.06l-3.47 3.47a.75.75 0 0 1-1.06-1.06L6.94 8 3.47 4.53a.75.75 0 0 1 0-1.06" clip-rule="evenodd"/></svg>`;

const editor = new Drawflow($c("drawflow"));
editor.force_first_input = true;
editor.zoom_max = 5.0;
editor.zoom_min = 0.1;
editor.start();

function applyTransform() {
  editor.zoom_last_value = editor.zoom;
  editor.precanvas.style.transform =
    `translate(${editor.canvas_x}px, ${editor.canvas_y}px) scale(${editor.zoom})`;
  editor.dispatch("zoom", editor.zoom);
}

function setZoomAt(zNew, mx, my) {
  const zOld = editor.zoom;
  zNew = Math.min(editor.zoom_max, Math.max(editor.zoom_min, zNew));
  const cx = mx - (zNew / zOld) * (mx - editor.canvas_x);
  const cy = my - (zNew / zOld) * (my - editor.canvas_y);
  editor.zoom = zNew;
  editor.canvas_x = cx;
  editor.canvas_y = cy;
  applyTransform();
}

function fitView() {
  const nodes = [...document.querySelectorAll("#drawflow .drawflow-node")];
  if (!nodes.length) return;
  const z = editor.zoom;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const nd of nodes) {
    const data = editor.getNodeFromId(nd.id.replace("node-", ""));
    minX = Math.min(minX, data.pos_x);
    minY = Math.min(minY, data.pos_y);
    maxX = Math.max(maxX, data.pos_x + nd.offsetWidth / z);
    maxY = Math.max(maxY, data.pos_y + nd.offsetHeight / z);
  }
  const rect = $c("drawflow").getBoundingClientRect();
  const pad = 60;
  const zNew = Math.min(
    (rect.width - pad * 2) / Math.max(maxX - minX, 1),
    (rect.height - pad * 2) / Math.max(maxY - minY, 1),
    1.2
  );
  editor.zoom = Math.min(editor.zoom_max, Math.max(editor.zoom_min, zNew));
  editor.canvas_x = (rect.width - editor.zoom * (maxX + minX)) / 2;
  editor.canvas_y = (rect.height - editor.zoom * (maxY + minY)) / 2;
  applyTransform();
}

function zoomStep(dir) {
  const rect = $c("drawflow").getBoundingClientRect();
  setZoomAt(editor.zoom + dir * editor.zoom_value, rect.width / 2, rect.height / 2);
}

$c("zoomIn").addEventListener("click", () => zoomStep(1));
$c("zoomOut").addEventListener("click", () => zoomStep(-1));
$c("zoomFit").addEventListener("click", fitView);
window.addEventListener("wheel", e => {
  if (!(e.target instanceof Element) || !e.target.closest("#drawflow")) return;
  if (e.target.closest("input")) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const rect = $c("drawflow").getBoundingClientRect();
  const step = e.deltaY > 0 ? -editor.zoom_value : editor.zoom_value;
  setZoomAt(editor.zoom + step, e.clientX - rect.left, e.clientY - rect.top);
}, { capture: true, passive: false });
for (const id of ["zoomIn", "zoomOut", "zoomFit"]) {
  for (const ev of ["mousedown", "touchstart", "pointerdown", "click"]) {
    $c(id).addEventListener(ev, e => e.stopPropagation());
  }
}

let pinch = null;
$c("drawflow").addEventListener("touchstart", e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const [a, b] = e.touches;
    pinch = {
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      cx: (a.clientX + b.clientX) / 2,
      cy: (a.clientY + b.clientY) / 2,
    };
  }
}, { capture: true, passive: false });
$c("drawflow").addEventListener("touchmove", e => {
  if (e.touches.length === 2 && pinch) {
    e.preventDefault();
    e.stopPropagation();
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const cx = (a.clientX + b.clientX) / 2;
    const cy = (a.clientY + b.clientY) / 2;
    editor.canvas_x += cx - pinch.cx;
    editor.canvas_y += cy - pinch.cy;
    if (pinch.dist > 0) {
      const rect = $c("drawflow").getBoundingClientRect();
      setZoomAt(editor.zoom * dist / pinch.dist, cx - rect.left, cy - rect.top);
    } else {
      applyTransform();
    }
    pinch.dist = dist;
    pinch.cx = cx;
    pinch.cy = cy;
  }
}, { capture: true, passive: false });
$c("drawflow").addEventListener("touchend", e => {
  if (e.touches.length < 2) pinch = null;
}, true);

let results = {};
let sbNodeId = null;

function graphData() {
  return editor.export().drawflow.Home.data;
}

function getGlobalN() {
  const n = parseFloat($c("globalN").value);
  return n > 0 && n < 1 ? n : 0.71;
}

function saveScheme() {
  try {
    localStorage.setItem(LS_CASCADE, JSON.stringify(editor.export()));
    localStorage.setItem(LS_N, $c("globalN").value);
  } catch { /* приватный режим */ }
}

function addNodeOfType(type, x, y) {
  const [ni, no] = NODE_PORTS[type];
  return editor.addNode(type, ni, no, x, y, type, { ...NODE_DEFAULTS[type] }, NODE_HTML[type]);
}

function upstreamIds(id, data) {
  const nd = data[id];
  if (!nd) return [];
  const ids = [];
  for (const inp of Object.values(nd.inputs || {})) {
    for (const conn of inp.connections) ids.push(String(conn.node));
  }
  return ids;
}

function wouldCycle(outId, inId) {
  const data = graphData();
  const stack = [String(inId)];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === String(outId)) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const out of Object.values(data[cur]?.outputs || {})) {
      for (const conn of out.connections) stack.push(String(conn.node));
    }
  }
  return false;
}

function topoOrder(data) {
  const ids = Object.keys(data);
  const indeg = {};
  for (const id of ids) indeg[id] = upstreamIds(id, data).filter(u => data[u]).length;
  const queue = ids.filter(id => indeg[id] === 0);
  const order = [];
  const deg = { ...indeg };
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const out of Object.values(data[id].outputs || {})) {
      for (const conn of out.connections) {
        const t = String(conn.node);
        if (!(t in deg)) continue;
        if (--deg[t] === 0) queue.push(t);
      }
    }
  }
  for (const id of ids) if (!order.includes(id)) order.push(id);
  return order;
}

function delayDt(d) {
  const v = parseFloat(d.v), L = parseFloat(d.l ?? d.L);
  if (v > 0 && L >= 0) return L / v / 60;
  return Math.max(0, parseFloat(d.dt) || 0);
}

function num(x, fallback, min = -Infinity) {
  const v = parseFloat(x);
  return Number.isFinite(v) && v >= min ? v : fallback;
}

function catchParams(d, n) {
  const q20 = num(d.q20, 80, 0.01);
  const P = num(d.P, 1, 0.01);
  const mr = num(d.mr, 150, 1.01);
  const gamma = num(d.gamma, 1.54, 0.01);
  const F = num(d.F, 3.9, 0.001);
  const psiMid = num(d.psiMid, 0.634, 0.001);
  const zMid = num(d.zMid, 0.201, 0.001);
  const tcon = num(d.tcon, 3, 0);
  const tcan = num(d.tcan, 0, 0);
  const segs = [];
  for (const [l, v] of [[d.l1, d.v1], [d.l2, d.v2], [d.l3, d.v3]]) {
    const L = parseFloat(l), V = parseFloat(v);
    if (L > 0 && V > 0) segs.push({ l: L, v: V });
  }
  const A = q20 * 20 ** n * (1 + Math.log(P) / Math.log(mr)) ** gamma;
  const lvSum = segs.reduce((s, x) => s + x.l / x.v, 0);
  const tp = 0.017 * lvSum;
  const tr = tcon + tcan + tp;
  const variable = d.coeffMode !== "const";
  const Qr = tr > 0
    ? (variable ? zMid * A ** 1.2 * F / tr ** (1.2 * n - 0.1) : psiMid * A * F / tr ** n)
    : 0;
  return { q20, P, mr, gamma, F, psiMid, zMid, tcon, tcan, segs, A, lvSum, tp, tr, Qr, variable, n };
}

function catchHelp(p) {
  const segTex = p.segs.length
    ? p.segs.map(s => `\\frac{${fmt(s.l, 0)}}{${fmt(s.v, 2)}}`).join(" + ")
    : "0";
  return [
    { p: "Расходы дождевых вод определяются по методу предельных интенсивностей (раздел 5.3 рекомендаций; пример расчёта — п. 2.3.1 пособия)." },
    { p: "Параметр A, характеризующий интенсивность и продолжительность дождя для конкретной местности (п. 5.3.2):" },
    { tex: `A = q_{20}\\, 20^{\\,n}\\left(1+\\frac{\\lg P}{\\lg m_r}\\right)^{\\!\\gamma} = ${fmt(p.q20)}\\cdot 20^{${fmt(p.n)}}\\left(1+\\frac{\\lg ${fmt(p.P, 1)}}{\\lg ${fmt(p.mr, 0)}}\\right)^{${fmt(p.gamma)}} = ${fmt(p.A)}` },
    { ol: [
      "q₂₀ — интенсивность дождя для данной местности продолжительностью 20 мин при P = 1 год, л/с с 1 га (Приложение 2 рекомендаций или рис. 1 СНиП 2.04.03-85);",
      "n — показатель степени, климатический параметр местности (общий параметр схемы; таблица Приложения 3);",
      "mr — среднее количество дождей за год (таблица Приложения 3);",
      "P — период однократного превышения расчётной интенсивности дождя, годы (таблица 8 п. 5.3.3);",
      "γ — показатель степени (таблица Приложения 3).",
    ] },
    { p: "Продолжительность протекания дождевых вод по трубам до рассматриваемого сечения (формула (17)):" },
    { tex: `t_p = 0{,}017\\sum \\frac{l_p}{v_p} = 0{,}017\\left(${segTex}\\right) = 0{,}017\\cdot ${fmt(p.lvSum, 1)} = ${fmt(p.tp, 1)}\\ \\text{мин}` },
    { ol: [
      "lₚ — длина расчётных участков дождевой сети, м;",
      "vₚ — расчётная скорость течения на участках, м/с (принимается по гидравлическому расчёту сети).",
    ] },
    { p: "Расчётная продолжительность дождя (формула (15) п. 5.3.5):" },
    { tex: `t_r = t_{con} + t_{can} + t_p = ${fmt(p.tcon, 0)} + ${fmt(p.tcan, 0)} + ${fmt(p.tp, 1)} = ${fmt(p.tr, 1)}\\ \\text{мин}` },
    { ol: [
      "t_con — продолжительность протекания дождевых вод до уличного лотка (время поверхностной концентрации), мин;",
      "t_can — продолжительность протекания по уличным лоткам до дождеприёмника, мин;",
      "t_p — продолжительность протекания по трубам до рассматриваемого сечения, мин.",
    ] },
    ...(p.variable ? [
      { p: "Расчётный расход при переменном коэффициенте стока — формула (20):" },
      { tex: `Q_r = \\frac{z_{mid}\\, A^{1{,}2}\\, F}{t_r^{\\,1{,}2n\\,-\\,0{,}1}} = \\frac{${fmt(p.zMid, 3)}\\cdot ${fmt(p.A)}^{1{,}2}\\cdot ${fmt(p.F, 2)}}{${fmt(p.tr, 1)}^{\\,${fmt(1.2 * p.n - 0.1, 3)}}} = ${fmt(p.Qr, 1)}\\ \\text{л/с}` },
      { ol: [
        "z_mid — среднее значение коэффициента, характеризующего вид поверхности бассейна водосбора (коэффициент покрова); средневзвешенная величина по таблицам 11–12 рекомендаций или СНиП 2.04.03-85;",
        "A — параметр интенсивности дождя (см. выше);",
        "F — расчётная площадь стока (водосбора), га;",
        "t_r — расчётная продолжительность дождя, мин.",
      ] },
    ] : [
      { p: "Расчётный расход при постоянном коэффициенте стока — формула (12):" },
      { tex: `Q_r = \\frac{\\Psi_{mid}\\, A\\, F}{t_r^{\\,n}} = \\frac{${fmt(p.psiMid, 3)}\\cdot ${fmt(p.A)}\\cdot ${fmt(p.F, 2)}}{${fmt(p.tr, 1)}^{${fmt(p.n)}}} = ${fmt(p.Qr, 1)}\\ \\text{л/с}` },
      { ol: [
        "Ψ_mid — средний постоянный коэффициент стока; средневзвешенная величина по таблице 11 рекомендаций или СНиП 2.04.03-85;",
        "A — параметр интенсивности дождя (см. выше);",
        "F — расчётная площадь стока (водосбора), га;",
        "t_r — расчётная продолжительность дождя, мин.",
      ] },
    ]),
    { p: "При подключении к ноде насосной станции её параметры Qr и tr блокируются и принимаются равными рассчитанным здесь значениям." },
  ];
}

function computeCascade() {
  const data = graphData();
  const nGlob = getGlobalN();
  const totalDelay = Object.values(data)
    .filter(nd => nd.name === "delay")
    .reduce((s, nd) => s + delayDt(nd.data || {}), 0);

  const res = {};
  for (const id of topoOrder(data)) {
    const nd = data[id];
    const d = nd.data || {};
    if (nd.name === "catch") {
      const p = catchParams(d, nGlob);
      if (!(p.Qr > 0 && p.tr > 0)) { res[id] = null; continue; }
      res[id] = {
        series: sampleHydro(p.Qr, p.tr, nGlob, 4 * p.tr + totalDelay + 30),
        Qr: p.Qr, tr: p.tr, params: p, fromCatch: true,
      };
    } else if (nd.name === "delay") {
      const src = res[upstreamIds(id, data)[0]];
      if (!src) { res[id] = null; continue; }
      res[id] = {
        series: shiftSeries(src.series, delayDt(d)),
        fromCatch: !!src.fromCatch, Qr: src.Qr, tr: src.tr,
      };
    } else if (nd.name === "pump") {
      const Q = parseFloat(d.q);
      const ups = upstreamIds(id, data).map(u => ({ id: u, r: res[u] })).filter(x => x.r);
      const catchUps = ups.filter(x => x.r.fromCatch);
      const flowUps = ups.filter(x => !x.r.fromCatch);
      let Qr = parseFloat(d.qr), tr = parseFloat(d.tr), lockId = null, ownRain = null;
      if (catchUps.length) {
        const c = catchUps[0].r;
        Qr = c.Qr;
        tr = c.tr;
        lockId = catchUps[0].id;
        ownRain = c.series;
        flowUps.push(...catchUps.slice(1));
      }
      if (!(Qr > 0 && tr > 0 && Q > 0)) { res[id] = null; continue; }
      let idle = parseFloat(d.idle);
      if (!(idle >= 0)) idle = 50;
      idle = Math.min(idle, 100);
      ownRain = ownRain || sampleHydro(Qr, tr, nGlob, 4 * tr + totalDelay + 30);
      const inflow = combineSeries([ownRain, ...flowUps.map(x => x.r.series)]);
      const pureRain = flowUps.length === 0;
      const mode = d.mode === "numeric" ? "numeric" : "analytic";
      let r, eq = null;
      if (mode === "analytic") {
        if (pureRain) {
          eq = { Qr, tr, n: nGlob };
          r = Qr <= Q ? { tn: 0, tk: 0, W: 0, dry: true } : calc(Q, Qr, tr, nGlob);
        } else {
          const peak = seriesPeak(inflow);
          eq = { Qr: peak.q, tr: Math.max(peak.t, 0.5), n: nGlob };
          r = peak.q <= Q ? { tn: 0, tk: 0, W: 0, dry: true } : calc(Q, eq.Qr, eq.tr, eq.n);
        }
      } else {
        r = numericCalc(Q, inflow);
      }
      res[id] = {
        series: pumpOutSeries(Q, r, inflow.t[inflow.t.length - 1] + totalDelay, HYDRO_DT, idle),
        ownRain, inflow, r, Q, Qr, tr, idle, mode, eq, nEff: nGlob, lockId,
        approx: mode === "analytic" && !pureRain,
      };
    }
  }
  results = res;
  updateSummaries(data);
  saveScheme();
  refreshSidebar();
}

function nodeLocked(id) {
  return !!editor.getNodeFromId(id)?.data?.locked;
}

function updateSummaries(data = graphData()) {
  for (const [id, nd] of Object.entries(data)) {
    const num = document.querySelector(`#node-${id} .node-num`);
    if (num) num.textContent = `#${id}`;
    const isLocked = !!nd.data?.locked;
    const lockBtn = document.querySelector(`#node-${id} .node-lock`);
    if (lockBtn) {
      lockBtn.classList.toggle("active", isLocked);
      lockBtn.innerHTML = isLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
      lockBtn.title = isLocked ? "Разблокировать параметры" : "Заблокировать параметры";
    }
    for (const inp of document.querySelectorAll(`#node-${id} input`)) {
      inp.disabled = isLocked;
    }
    if (nd.name === "delay") {
      const out = document.querySelector(`#node-${id} .delay-out`);
      if (out) out.textContent = `Δt = ${fmt(delayDt(nd.data || {}), 1)} мин`;
      continue;
    }
    if (nd.name === "catch") {
      const out = document.querySelector(`#node-${id} .catch-out`);
      if (!out) continue;
      const r = results[id];
      out.textContent = r
        ? `Qr = ${fmt(r.Qr, 1)} л/с · tr = ${fmt(r.tr, 1)} мин`
        : "Qr = — · tr = —";
      continue;
    }
    if (nd.name !== "pump") continue;
    const mt = document.querySelector(`#node-${id} .mode-toggle`);
    if (mt) {
      mt.classList.toggle("active", (nd.data?.mode ?? "analytic") === "numeric");
      mt.disabled = isLocked;
    }
    const r = results[id];
    const locked = !!(r && r.lockId);
    const ln = document.querySelector(`#node-${id} .lock-note`);
    if (ln) {
      ln.classList.toggle("on", locked);
      if (locked) ln.textContent = `Qr, tr ← Водосбор #${r.lockId}`;
    }
    for (const k of ["qr", "tr"]) {
      const inp = document.querySelector(`#node-${id} input[df-${k}]`);
      if (!inp) continue;
      inp.disabled = isLocked || locked;
      if (locked && document.activeElement !== inp) {
        inp.value = String(Math.round((k === "qr" ? r.Qr : r.tr) * 100) / 100);
      }
    }
    const slider = document.querySelector(`#node-${id} .q-range`);
    if (slider && r) {
      slider.max = Math.ceil(r.Qr);
      if (document.activeElement !== slider) slider.value = Math.min(r.Q, r.Qr);
    }
    const el = document.querySelector(`#node-${id} .node-summary`);
    if (!el) continue;
    if (!r) {
      el.innerHTML = `<span class="warn">задайте Qr, tr, Qнс</span>`;
    } else if (r.r.dry) {
      el.innerHTML = `<span class="warn">Qнс ≥ притока — регулирование не требуется</span>`;
    } else {
      el.innerHTML =
        `Tн = ${fmt(r.r.tn)} мин · Tк = ${fmt(r.r.tk)} мин<br>` +
        `Wнс = <b>${fmt(r.r.W, 1)} м³</b>`;
    }
  }
}

const delayChart = (() => {
  let chart = null;
  return {
    update(dt, inSeries, outSeries) {
      const ts = outSeries.t.map(t => +t.toFixed(2));
      const inEnd = inSeries.t[inSeries.t.length - 1];
      const inLast = inSeries.q[inSeries.q.length - 1];
      const data = {
        labels: ts,
        datasets: [
          { label: "вход, л/с", data: outSeries.t.map(t => +(t <= inEnd ? interpAt(inSeries, t) : inLast).toFixed(2)),
            borderColor: "#1f6feb", borderWidth: 2, pointRadius: 0, stepped: true },
          { label: `выход (сдвиг ${fmt(dt, 1)} мин), л/с`, data: outSeries.q.map(q => +q.toFixed(2)),
            borderColor: "#f08c00", borderWidth: 2, borderDash: [6, 3], pointRadius: 0, stepped: true },
          { label: "Δt", data: [{ x: dt, y: 0 }, { x: dt, y: seriesPeak(inSeries).q }],
            borderColor: "#b26a00", borderWidth: 1, borderDash: [4, 4],
            pointRadius: 3, backgroundColor: "#b26a00", showLine: true },
        ],
      };
      if (chart) {
        chart.data = data;
        chart.update("none");
      } else {
        chart = new Chart($c("sbDelayChart"), {
          type: "line", data,
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "nearest", intersect: false },
            scales: {
              x: { type: "linear", title: { display: true, text: "T, мин" }, min: 0 },
              y: { title: { display: true, text: "Q, л/с" }, beginAtZero: true },
            },
            plugins: {
              legend: { labels: { filter: i => i.text !== "Δt", boxWidth: 14 } },
              tooltip: {
                callbacks: {
                  title: c => c.length ? `T = ${fmt(c[0].parsed.x, 1)} мин` : "",
                  label: c => `${c.dataset.label}: ${fmt(c.parsed.y, 1)} л/с`,
                },
              },
            },
          },
        });
      }
    },
  };
})();

const inflowChart = (() => {
  let chart = null;
  return {
    update(Q, r, combined, comps, outSeries) {
      const ts = combined.t.map(t => +t.toFixed(2));
      const qs = combined.q.map(q => +q.toFixed(2));
      const ds = [];
      comps.forEach((c, i) => {
        ds.push({
          label: c.label,
          data: combined.t.map(t => +interpAt(c.series, t).toFixed(2)),
          borderColor: COMP_COLORS[i % COMP_COLORS.length],
          borderWidth: 1, borderDash: [4, 3], pointRadius: 0,
        });
      });
      ds.push({ label: "Σ вход, л/с", data: qs, borderColor: "#1f6feb", borderWidth: 2, pointRadius: 0, tension: 0.15 });
      ds.push({
        label: "Wнс (площадь)",
        data: combined.t.map((t, i) => (!r.dry && t >= r.tn && t <= r.tk && qs[i] > Q ? qs[i] : null)),
        borderWidth: 0, pointRadius: 0, spanGaps: false,
        fill: { value: Q }, backgroundColor: "rgba(31, 111, 235, 0.18)",
      });
      ds.push({
        label: `Qнс = ${fmt(Q)} л/с`, data: combined.t.map(() => Q),
        borderColor: "#d6336c", borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0,
      });
      if (outSeries) {
        ds.push({
          label: "выход КНС, л/с", data: combined.t.map(t => +interpAt(outSeries, t).toFixed(2)),
          borderColor: "#2b8a3e", borderWidth: 1.5, pointRadius: 0, stepped: true,
        });
      }
      const marker = (t, label) => ({
        label, data: [{ x: t, y: 0 }, { x: t, y: interpAt(combined, t) }],
        borderColor: "#8a929c", borderWidth: 1, borderDash: [4, 4],
        pointRadius: 3, backgroundColor: "#8a929c", showLine: true,
      });
      if (!r.dry) ds.push(marker(r.tn, "Tн"), marker(r.tk, "Tк"));
      const data = { labels: ts, datasets: ds };
      if (chart) {
        chart.data = data;
        chart.update("none");
      } else {
        chart = new Chart($c("sbInflow"), {
          type: "line", data,
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "nearest", intersect: false },
            scales: {
              x: { type: "linear", title: { display: true, text: "T, мин" }, min: 0 },
              y: { title: { display: true, text: "Q, л/с" }, beginAtZero: true },
            },
            plugins: {
              legend: { labels: { filter: i => !["Tн", "Tк"].includes(i.text), boxWidth: 14 } },
              tooltip: {
                callbacks: {
                  title: c => c.length ? `T = ${fmt(c[0].parsed.x, 1)} мин` : "",
                  label: c => `${c.dataset.label}: ${fmt(c.parsed.y, 1)} л/с`,
                },
              },
            },
          },
        });
      }
    },
  };
})();

const sbWqChart = { inner: null };
const sbQtState = {};

function sbCalcFn(res) {
  return res.mode === "numeric"
    ? q => numericCalc(q, res.inflow)
    : q => calc(q, res.eq.Qr, res.eq.tr, res.eq.n);
}

const SB_CATCH_MAP = {
  sbCF: "F", sbCQ20: "q20", sbCP: "P", sbCMr: "mr", sbCGamma: "gamma",
  sbCPsi: "psiMid", sbCZ: "zMid", sbCTcon: "tcon", sbCTcan: "tcan",
  sbCL1: "l1", sbCV1: "v1", sbCL2: "l2", sbCV2: "v2", sbCL3: "l3", sbCV3: "v3",
};

function renderCatchSidebar(node) {
  $c("sbTitle").textContent = `Водосбор · нода #${sbNodeId}`;
  $c("sbCatch").hidden = false;
  $c("sbDelay").hidden = true;
  $c("sbEmpty").hidden = true;
  $c("sbContent").hidden = true;
  const d = node.data || {};
  for (const [elId, key] of Object.entries(SB_CATCH_MAP)) {
    const el = $c(elId);
    if (document.activeElement !== el) el.value = d[key];
  }
  for (const rb of document.querySelectorAll('input[name="sbCCoeff"]')) {
    rb.checked = rb.value === (d.coeffMode === "const" ? "const" : "variable");
  }
  const res = results[sbNodeId];
  $c("sbCOut").textContent = res
    ? `Qr = ${fmt(res.Qr, 1)} л/с · tr = ${fmt(res.tr, 1)} мин`
    : "задайте корректные параметры";
  applySidebarLock();
}

const SB_LOCK_INPUTS = ["sbQr", "sbTr", "sbQ", "sbQm3h", "sbQrange", "sbIdle", "sbV", "sbL"];

function applySidebarLock() {
  const isLocked = sbNodeId !== null && nodeLocked(sbNodeId);
  const btn = $c("sbLockBtn");
  btn.classList.toggle("active", isLocked);
  btn.innerHTML = isLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
  btn.title = isLocked ? "Разблокировать параметры" : "Заблокировать параметры";
  for (const id of [...SB_LOCK_INPUTS, ...Object.keys(SB_CATCH_MAP)]) {
    const el = $c(id);
    if (el) el.disabled = isLocked;
  }
  for (const rb of document.querySelectorAll('input[name="sbMode"], input[name="sbCCoeff"]')) {
    rb.disabled = isLocked;
  }
  if (!isLocked) {
    const res = results[sbNodeId];
    if (res?.lockId) {
      $c("sbQr").disabled = true;
      $c("sbTr").disabled = true;
    }
  }
}

function renderDelaySidebar(node) {
  $c("sbTitle").textContent = `Участок сети · нода #${sbNodeId}`;
  $c("sbDelay").hidden = false;
  $c("sbCatch").hidden = true;
  $c("sbEmpty").hidden = true;
  $c("sbContent").hidden = true;
  const d = node.data || {};
  if (document.activeElement !== $c("sbV")) $c("sbV").value = d.v;
  if (document.activeElement !== $c("sbL")) $c("sbL").value = d.l;
  const dt = delayDt(d);
  $c("sbDt").textContent = `Δt = L / (60·v) = ${fmt(dt, 1)} мин`;
  const srcId = upstreamIds(sbNodeId, graphData())[0];
  const src = srcId && results[srcId];
  const out = results[sbNodeId];
  const has = !!(src && out);
  $c("sbDelayChartWrap").hidden = !has;
  $c("sbDelayEmpty").hidden = has;
  if (has) delayChart.update(dt, src.series, out.series);
  applySidebarLock();
}

function renderSidebar() {
  if (sbNodeId === null) return;
  const node = editor.getNodeFromId(sbNodeId);
  if (!node) return;
  if (node.name === "delay") { renderDelaySidebar(node); return; }
  if (node.name === "catch") { renderCatchSidebar(node); return; }
  $c("sbDelay").hidden = true;
  $c("sbCatch").hidden = true;
  const res = results[sbNodeId];
  $c("sbTitle").textContent = `Насосная станция · нода #${sbNodeId}`;
  if (!node || !res) {
    $c("sbEmpty").hidden = false;
    $c("sbContent").hidden = true;
    return;
  }
  $c("sbEmpty").hidden = true;
  $c("sbContent").hidden = false;

  if (document.activeElement !== $c("sbQr")) $c("sbQr").value = res.Qr;
  if (document.activeElement !== $c("sbTr")) $c("sbTr").value = res.tr;
  $c("sbQr").disabled = !!res.lockId;
  $c("sbTr").disabled = !!res.lockId;
  $c("sbLock").hidden = !res.lockId;
  if (res.lockId) $c("sbLockSrc").textContent = `#${res.lockId}`;
  if (document.activeElement !== $c("sbQ")) $c("sbQ").value = res.Q;
  if (document.activeElement !== $c("sbQm3h")) $c("sbQm3h").value = +(res.Q * 3.6).toFixed(1);
  const qMax = seriesPeak(res.inflow).q;
  const rg = $c("sbQrange");
  rg.max = Math.ceil(qMax);
  if (document.activeElement !== rg) rg.value = Math.min(res.Q, qMax);
  if (document.activeElement !== $c("sbIdle")) $c("sbIdle").value = res.idle;
  for (const rb of document.querySelectorAll('input[name="sbMode"]')) {
    rb.checked = rb.value === res.mode;
  }
  $c("sbApprox").hidden = !res.approx;

  const data = graphData();
  const comps = [{ label: res.lockId ? `Водосбор #${res.lockId}` : "Дождь (собственный)", series: res.ownRain }];
  let lockSkipped = !res.lockId;
  for (const x of upstreamIds(sbNodeId, data)
    .map(u => ({ nd: data[u], r: results[u] }))
    .filter(x => x.r)) {
    if (!lockSkipped && x.r.fromCatch) { lockSkipped = true; continue; }
    comps.push({ label: `${NODE_LABEL[x.nd.name]} #${x.nd.id}`, series: x.r.series });
  }
  inflowChart.update(res.Q, res.r, res.inflow, comps, res.series);

  const numeric = res.mode === "numeric";
  if (numeric) {
    buildCards($c("sbCards"), res.Q, 0, 0, 0, res.r, true);
  } else {
    buildCards($c("sbCards"), res.Q, res.eq.Qr, res.eq.tr, res.eq.n, res.r, false);
  }

  if (!sbWqChart.inner) sbWqChart.inner = makeWQChart($c("sbChart"));
  const fn = sbCalcFn(res);
  const rangePts = [];
  const from = parseFloat($c("sbFrom").value), to = parseFloat($c("sbTo").value), step = parseFloat($c("sbStep").value);
  if (from > 0 && to > from && step > 0) {
    for (let q = from, i = 0; q <= to + 1e-9 && i < 51; q += step, i++) {
      rangePts.push({ x: +q.toFixed(2), y: +fn(q).W.toFixed(2) });
    }
  }
  sbWqChart.inner.update(res.Q, qMax, 0, 0, { rangePts, calcFn: fn });
  fillVariants($c("sbVariants").querySelector("tbody"), res.Q, from, to, step, fn);
  applySidebarLock();
}

function refreshSidebar() {
  if (sbNodeId === null) return;
  if (!editor.getNodeFromId(sbNodeId)) { closeSidebar(); return; }
  renderSidebar();
}

function markSidebarNode() {
  for (const el of document.querySelectorAll("#drawflow .drawflow-node.sb-active")) {
    el.classList.remove("sb-active");
  }
  if (sbNodeId !== null) {
    document.getElementById(`node-${sbNodeId}`)?.classList.add("sb-active");
  }
}

function openSidebar(id) {
  sbNodeId = id;
  markSidebarNode();
  $c("sidebar").hidden = false;
  const res = results[id];
  if (res && res.inflow) {
    const qMax = seriesPeak(res.inflow).q;
    if (!$c("sbFrom").value) {
      $c("sbFrom").value = Math.max(1, Math.round(qMax / 8));
      $c("sbTo").value = Math.round(qMax);
      $c("sbStep").value = Math.max(1, Math.round(qMax / 8));
    }
  }
  renderSidebar();
}

function closeSidebar() {
  sbNodeId = null;
  markSidebarNode();
  $c("sidebar").hidden = true;
}

function syncNodeParam(id, key, value) {
  const nd = editor.getNodeFromId(id);
  if (!nd) return;
  editor.updateNodeDataFromId(id, { ...nd.data, [key]: value });
  const inp = document.querySelector(`#node-${id} input[df-${key}]`);
  if (inp && document.activeElement !== inp) inp.value = value;
  computeCascade();
}

function rebuildScheme(stored) {
  const data = stored?.drawflow?.Home?.data || {};
  editor.clear();
  const map = {};
  for (const [oldId, nd] of Object.entries(data)) {
    if (!(nd.name in NODE_PORTS)) continue;
    const d = { ...NODE_DEFAULTS[nd.name], ...nd.data };
    if (nd.name === "pump") {
      if (d.Qr !== undefined) { d.qr = d.Qr; delete d.Qr; }
      if (d.Q !== undefined) { d.q = d.Q; delete d.Q; }
    }
    if (nd.name === "delay") {
      const lOld = parseFloat(d.l ?? d.L);
      const dtOld = parseFloat(d.dt);
      d.v = parseFloat(d.v) > 0 ? parseFloat(d.v) : 1;
      d.l = lOld >= 0 ? lOld : (dtOld >= 0 ? Math.round(dtOld * 60) : 3600);
      delete d.L;
      delete d.dt;
    }
    const [ni, no] = NODE_PORTS[nd.name];
    map[oldId] = editor.addNode(nd.name, ni, no, nd.pos_x, nd.pos_y, nd.name, d, NODE_HTML[nd.name]);
  }
  for (const [oldId, nd] of Object.entries(data)) {
    if (!map[oldId]) continue;
    for (const out of Object.values(nd.outputs || {})) {
      for (const conn of out.connections) {
        if (!map[conn.node]) continue;
        if (nd.name === "catch" && data[conn.node]?.name === "delay") continue;
        editor.addConnection(map[oldId], map[conn.node], "output_1", "input_1");
      }
    }
  }
}

function loadInitial() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(LS_CASCADE) || "null"); } catch { stored = null; }
  const storedN = parseFloat(localStorage.getItem(LS_N));
  if (storedN > 0 && storedN < 1) $c("globalN").value = storedN;
  if (stored && stored.drawflow) {
    rebuildScheme(stored);
  } else {
    addNodeOfType("pump", 320, 160);
  }
  computeCascade();
}

for (const item of document.querySelectorAll(".pal-node")) {
  item.addEventListener("dragstart", e => {
    e.dataTransfer.setData("node", item.dataset.node);
  });
  item.addEventListener("click", () => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const rect = $c("drawflow").getBoundingClientRect();
    const x = (rect.width / 2 - editor.canvas_x) / editor.zoom;
    const y = (rect.height / 2 - editor.canvas_y) / editor.zoom;
    addNodeOfType(item.dataset.node, x - 100, y - 60);
    computeCascade();
  });
}
$c("drawflow").addEventListener("dragover", e => e.preventDefault());
$c("drawflow").addEventListener("drop", e => {
  e.preventDefault();
  const type = e.dataTransfer.getData("node");
  if (!NODE_HTML[type]) return;
  const rect = editor.precanvas.getBoundingClientRect();
  addNodeOfType(type, (e.clientX - rect.x) / editor.zoom, (e.clientY - rect.y) / editor.zoom);
  computeCascade();
});

let mouseDownPos = null;
$c("drawflow").addEventListener("mousedown", e => { mouseDownPos = [e.clientX, e.clientY]; });
$c("drawflow").addEventListener("click", e => {
  const nodeEl = e.target.closest(".drawflow-node");
  if (!nodeEl || !mouseDownPos) return;
  if (Math.hypot(e.clientX - mouseDownPos[0], e.clientY - mouseDownPos[1]) > 5) return;
  const id = nodeEl.id.replace("node-", "");
  if (["pump", "delay", "catch"].includes(editor.getNodeFromId(id)?.name)) openSidebar(id);
});

const NODE_WHEEL_STEPS = { qr: 1, tr: 1, q: 1, idle: 5, v: 0.1, l: 100, F: 0.1, q20: 1, P: 0.1, tcon: 1 };
const SB_WHEEL_STEPS = { sbQr: 1, sbTr: 1, sbQ: 1, sbQm3h: 3.6, sbIdle: 5, sbV: 0.1, sbL: 100, sbFrom: 1, sbTo: 1, sbStep: 1, globalN: 0.01, sbCF: 0.1, sbCQ20: 1, sbCP: 0.1, sbCMr: 1, sbCGamma: 0.01, sbCPsi: 0.01, sbCZ: 0.01, sbCTcon: 1, sbCTcan: 1, sbCL1: 10, sbCV1: 0.1, sbCL2: 10, sbCV2: 0.1, sbCL3: 10, sbCV3: 0.1 };

const CASCADE_HELP = [
  { p: "Входной гидрограф станции складывается из собственного дождевого стока и выходных гидрографов вышестоящих станций, сдвинутых нодами участков сети. Все составляющие показаны на графике пунктиром." },
  { p: "Собственный дождевой сток строится по формулам (2) и (3) Приложения 8 — так же, как в одиночном расчёте:" },
  { tex: "Q(T) = Q_r\\left(\\frac{T}{t_r}\\right)^{1-n}, \\ T \\le t_r; \\qquad Q(T) = Q_r\\left[\\left(\\frac{T}{t_r}\\right)^{1-n} - \\left(\\frac{T}{t_r}-1\\right)^{1-n}\\right], \\ T > t_r" },
  { p: "Нода участка сети сдвигает гидрограф по времени на Δt = L / (60·v) минут, где L — длина участка в метрах, v — скорость протекания в м/с." },
  { p: "Выходной гидрограф станции (принятое упрощение): на интервале [Tнⁿˢ; Tкⁿˢ] станция откачивает полную производительность Qнс, в остальное время — заданный процент от Qнс (параметр «вне пика, %», по умолчанию 50%)." },
  { p: "Аналитический режим. Для одиночной станции без входов — точные формулы одиночного расчёта (формулы (1)–(3) Приложения 8). В каскаде суммарный гидрограф заменяется эквивалентным дождевым: Qr* — пик суммарного гидрографа, tr* — момент пика, n — общий климатический параметр схемы; далее применяются те же формулы. Это приближение, о чём выводится предупреждение." },
  { p: "Численный режим. Работа резервуара моделируется по шагам Δt: на каждом шаге уровень заполнения меняется на приток минус откачку, но не может стать отрицательным:" },
  { tex: "V_{i+1} = \\max\\!\\left(0,\\; V_i + 0{,}06\\,\\frac{(Q_i - Q_{нс}) + (Q_{i+1} - Q_{нс})}{2}\\,\\Delta t\\right), \\qquad W_{нс} = \\max_i V_i" },
  { p: "Поэтому «площадь под кривой» ниже Qнс не вычитается и не суммируется: в промежутках, где приток меньше Qнс, резервуар опорожняется (уровень падает до нуля), и следующее окно превышения заполняет уже частично освобождённый бак. Объём Wнс — это максимальный уровень заполнения за весь дождь, а не сумма площадей окон. Tнⁿˢ и Tкⁿˢ — первое и последнее пересечение суммарного гидрографа с линией Qнс." },
];

function dfKey(el) {
  const attr = [...el.attributes].find(a => a.name.startsWith("df-"));
  if (!attr) return null;
  const key = attr.name.slice(3);
  return { f: "F", p: "P" }[key] || key;
}

window.addEventListener("wheel", e => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement)) return;
  if (el.disabled) return;
  const inNode = el.closest(".node-box");
  let step = null;
  if (inNode) {
    step = el.type === "range" ? 1 : NODE_WHEEL_STEPS[dfKey(el)];
  } else {
    step = SB_WHEEL_STEPS[el.id];
  }
  if (!step) return;
  e.preventDefault();
  e.stopPropagation();
  const dec = (String(step).split(".")[1] || "").length;
  let v = (parseFloat(el.value) || 0) + (e.deltaY < 0 ? step : -step);
  v = +v.toFixed(dec);
  if (el.min !== "" && v < +el.min) v = +el.min;
  if (el.max !== "" && v > +el.max) v = +el.max;
  el.value = v;
  if (inNode) {
    const id = el.closest(".drawflow-node").id.replace("node-", "");
    syncNodeParam(id, el.type === "range" ? "q" : dfKey(el), v);
  } else {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}, { capture: true, passive: false });

for (const evName of ["mousedown", "touchstart", "pointerdown"]) {
  $c("drawflow").addEventListener(evName, e => {
    if (e.target.classList?.contains("q-range") ||
        e.target.classList?.contains("mode-toggle") ||
        e.target.closest(".node-lock") ||
        e.target.classList?.contains("catch-info")) e.stopPropagation();
  }, true);
}

$c("drawflow").addEventListener("click", e => {
  const mt = e.target.closest(".mode-toggle");
  if (!mt || mt.disabled) return;
  e.stopPropagation();
  const id = mt.closest(".drawflow-node").id.replace("node-", "");
  const nd = editor.getNodeFromId(id);
  if (!nd) return;
  syncNodeParam(id, "mode", nd.data?.mode === "numeric" ? "analytic" : "numeric");
}, true);

$c("drawflow").addEventListener("click", e => {
  const lb = e.target.closest(".node-lock");
  if (!lb) return;
  e.stopPropagation();
  const id = lb.closest(".drawflow-node").id.replace("node-", "");
  syncNodeParam(id, "locked", !nodeLocked(id));
}, true);

$c("drawflow").addEventListener("click", e => {
  const ci = e.target.closest(".catch-info");
  if (!ci) return;
  e.stopPropagation();
  const id = ci.closest(".drawflow-node").id.replace("node-", "");
  const r = results[id];
  if (r?.params) openHelp(catchHelp(r.params), {});
}, true);

$c("drawflow").addEventListener("input", e => {
  if (!e.target.classList?.contains("q-range")) return;
  const id = e.target.closest(".drawflow-node").id.replace("node-", "");
  syncNodeParam(id, "q", parseFloat(e.target.value));
});

editor.on("connectionCreated", conn => {
  const outNode = editor.getNodeFromId(conn.output_id);
  const inNode = editor.getNodeFromId(conn.input_id);
  if (wouldCycle(conn.output_id, conn.input_id) ||
      (outNode?.name === "catch" && inNode?.name === "delay")) {
    editor.removeSingleConnection(conn.output_id, conn.input_id, conn.output_class, conn.input_class);
    return;
  }
  computeCascade();
});
editor.on("connectionRemoved", () => computeCascade());
editor.on("nodeRemoved", id => {
  if (String(sbNodeId) === String(id)) closeSidebar();
  computeCascade();
});
editor.on("nodeDataChanged", () => computeCascade());
editor.on("nodeMoved", () => saveScheme());

$c("sbLockBtn").addEventListener("click", () => {
  if (sbNodeId !== null) syncNodeParam(sbNodeId, "locked", !nodeLocked(sbNodeId));
});
$c("sbClose").addEventListener("click", closeSidebar);
$c("sbQr").addEventListener("input", () => {
  const v = parseFloat($c("sbQr").value);
  if (v > 0 && sbNodeId !== null) syncNodeParam(sbNodeId, "qr", v);
});
$c("sbTr").addEventListener("input", () => {
  const v = parseFloat($c("sbTr").value);
  if (v > 0 && sbNodeId !== null) syncNodeParam(sbNodeId, "tr", v);
});
$c("sbQ").addEventListener("input", () => {
  const q = parseFloat($c("sbQ").value);
  if (q > 0 && sbNodeId !== null) syncNodeParam(sbNodeId, "q", q);
});
$c("sbQm3h").addEventListener("input", () => {
  const m = parseFloat($c("sbQm3h").value);
  if (m > 0 && sbNodeId !== null) syncNodeParam(sbNodeId, "q", +(m / 3.6).toFixed(2));
});
$c("sbQrange").addEventListener("input", e => {
  $c("sbQ").value = e.target.value;
  $c("sbQ").dispatchEvent(new Event("input", { bubbles: true }));
});
$c("sbIdle").addEventListener("input", () => {
  const v = parseFloat($c("sbIdle").value);
  if (v >= 0 && v <= 100 && sbNodeId !== null) syncNodeParam(sbNodeId, "idle", v);
});
$c("sbV").addEventListener("input", () => {
  const v = parseFloat($c("sbV").value);
  if (v > 0 && sbNodeId !== null) syncNodeParam(sbNodeId, "v", v);
});
$c("sbL").addEventListener("input", () => {
  const v = parseFloat($c("sbL").value);
  if (v >= 0 && sbNodeId !== null) syncNodeParam(sbNodeId, "l", v);
});
for (const rb of document.querySelectorAll('input[name="sbMode"]')) {
  rb.addEventListener("change", () => {
    if (sbNodeId !== null && rb.checked) syncNodeParam(sbNodeId, "mode", rb.value);
  });
}
for (const [elId, key] of Object.entries(SB_CATCH_MAP)) {
  $c(elId).addEventListener("input", () => {
    const v = parseFloat($c(elId).value);
    if (!Number.isNaN(v) && sbNodeId !== null) syncNodeParam(sbNodeId, key, v);
  });
}
for (const rb of document.querySelectorAll('input[name="sbCCoeff"]')) {
  rb.addEventListener("change", () => {
    if (sbNodeId !== null && rb.checked) syncNodeParam(sbNodeId, "coeffMode", rb.value);
  });
}
$c("sbCHelp").addEventListener("click", () => {
  const r = results[sbNodeId];
  if (r?.params) openHelp(catchHelp(r.params), {});
});

for (const id of ["sbFrom", "sbTo", "sbStep"]) {
  $c(id).addEventListener("input", renderSidebar);
}

$c("globalN").addEventListener("input", computeCascade);

const LS_PALETTE = "kns-palette-collapsed";
const gnField = document.querySelector(".palette .global-n");
function setPaletteCollapsed(collapsed) {
  $c("palette").classList.toggle("collapsed", collapsed);
  if (collapsed) {
    $c("nFloat").insertBefore(gnField, $c("paletteExpand").nextSibling);
    $c("nFloat").hidden = false;
  } else {
    $c("gnSlot").appendChild(gnField);
    $c("nFloat").hidden = true;
  }
  try { localStorage.setItem(LS_PALETTE, collapsed ? "1" : "0"); } catch { /* приватный режим */ }
}
$c("paletteToggle").addEventListener("click", () => setPaletteCollapsed(true));
$c("paletteExpand").addEventListener("click", () => setPaletteCollapsed(false));
try {
  if (localStorage.getItem(LS_PALETTE) === "1") setPaletteCollapsed(true);
} catch { /* приватный режим */ }
for (const ev of ["mousedown", "touchstart", "pointerdown", "click", "contextmenu"]) {
  $c("nFloat").addEventListener(ev, e => e.stopPropagation());
}

$c("exportJson").addEventListener("click", () => {
  const payload = { n: getGlobalN(), scheme: editor.export() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "kns-cascade.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
$c("importJson").addEventListener("click", () => $c("importFile").click());
$c("importFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const data = payload.scheme || payload;
    if (!data.drawflow) throw new Error("bad format");
    if (payload.n > 0 && payload.n < 1) $c("globalN").value = payload.n;
    closeSidebar();
    rebuildScheme(data);
    computeCascade();
  } catch {
    alert("Не удалось загрузить файл: неверный формат схемы");
  }
  e.target.value = "";
});
$c("clearAll").addEventListener("click", () => {
  if (!confirm("Удалить все ноды и связи?")) return;
  closeSidebar();
  editor.clear();
  computeCascade();
});

$c("sbHydroHelp").addEventListener("click", () => openHelp(CASCADE_HELP, {}));

let ctxPos = null, ctxConn = null, ctxNode = null, ctxShownAt = 0, ctxFromTouch = false;
function showCtxMenu(x, y, { nodeEl = null, connEl = null, fromTouch = false } = {}) {
  ctxPos = [x, y];
  ctxConn = null;
  ctxNode = null;
  ctxShownAt = Date.now();
  ctxFromTouch = fromTouch;
  const m = $c("ctxMenu");
  if (nodeEl) {
    ctxNode = nodeEl.id.replace("node-", "");
    m.innerHTML = `
      <button type="button" data-dupnode>Дублировать ноду</button>
      <button type="button" data-delnode>${XMARK_HTML}Удалить ноду</button>`;
  } else if (connEl) {
    const cls = [...connEl.classList];
    ctxConn = {
      outId: cls.find(c => c.startsWith("node_out_node-"))?.replace("node_out_node-", ""),
      inId: cls.find(c => c.startsWith("node_in_node-"))?.replace("node_in_node-", ""),
      outClass: cls.find(c => /^output_\d+$/.test(c)),
      inClass: cls.find(c => /^input_\d+$/.test(c)),
    };
    m.innerHTML = `<button type="button" data-delconn>${XMARK_HTML}Удалить связь</button>`;
  } else {
    m.innerHTML = `
      <button type="button" data-add="pump">Насосная станция</button>
      <button type="button" data-add="delay">Участок сети</button>
      <button type="button" data-add="catch">Водосбор</button>`;
  }
  m.hidden = false;
  m.style.left = Math.min(x, window.innerWidth - 200) + "px";
  m.style.top = Math.min(y, window.innerHeight - 120) + "px";
}
function hideCtxMenu() {
  $c("ctxMenu").hidden = true;
  ctxPos = null;
  ctxConn = null;
  ctxNode = null;
}

$c("drawflow").addEventListener("contextmenu", e => {
  e.preventDefault();
  e.stopPropagation();
  if (ctxFromTouch && Date.now() - ctxShownAt < 800) return;
  showCtxMenu(e.clientX, e.clientY, {
    nodeEl: e.target.closest(".drawflow-node"),
    connEl: e.target.closest(".connection"),
  });
}, true);

let lpTimer = null, lpStart = null;
$c("drawflow").addEventListener("touchstart", e => {
  if (e.touches.length !== 1 || e.target.closest("input, button, select")) {
    clearTimeout(lpTimer);
    lpStart = null;
    return;
  }
  const t = e.touches[0];
  lpStart = [t.clientX, t.clientY];
  const opts = {
    nodeEl: e.target.closest(".drawflow-node"),
    connEl: e.target.closest(".connection"),
    fromTouch: true,
  };
  lpTimer = setTimeout(() => showCtxMenu(t.clientX, t.clientY, opts), 550);
});
$c("drawflow").addEventListener("touchmove", e => {
  if (!lpStart) return;
  const t = e.touches[0];
  if (Math.hypot(t.clientX - lpStart[0], t.clientY - lpStart[1]) > 10) {
    clearTimeout(lpTimer);
    lpStart = null;
  }
});
$c("drawflow").addEventListener("touchend", () => {
  clearTimeout(lpTimer);
  lpStart = null;
});
$c("drawflow").addEventListener("touchcancel", () => {
  clearTimeout(lpTimer);
  lpStart = null;
});

$c("ctxMenu").addEventListener("click", e => {
  if (ctxFromTouch && Date.now() - ctxShownAt < 300) return;
  const delNodeBtn = e.target.closest("[data-delnode]");
  if (delNodeBtn && ctxNode) {
    editor.removeNodeId(`node-${ctxNode}`);
    hideCtxMenu();
    return;
  }
  const dupNodeBtn = e.target.closest("[data-dupnode]");
  if (dupNodeBtn && ctxNode) {
    const src = editor.getNodeFromId(ctxNode);
    if (src && NODE_PORTS[src.name]) {
      const [ni, no] = NODE_PORTS[src.name];
      editor.addNode(src.name, ni, no, src.pos_x + 40, src.pos_y + 40,
        src.name, { ...src.data }, NODE_HTML[src.name]);
      computeCascade();
    }
    hideCtxMenu();
    return;
  }
  const delBtn = e.target.closest("[data-delconn]");
  if (delBtn && ctxConn) {
    if (ctxConn.outId && ctxConn.inId && ctxConn.outClass && ctxConn.inClass) {
      editor.removeSingleConnection(ctxConn.outId, ctxConn.inId, ctxConn.outClass, ctxConn.inClass);
    }
    hideCtxMenu();
    return;
  }
  const btn = e.target.closest("[data-add]");
  if (!btn || !ctxPos) return;
  const rect = $c("drawflow").getBoundingClientRect();
  const x = (ctxPos[0] - rect.left - editor.canvas_x) / editor.zoom;
  const y = (ctxPos[1] - rect.top - editor.canvas_y) / editor.zoom;
  addNodeOfType(btn.dataset.add, x, y);
  computeCascade();
  hideCtxMenu();
});
document.addEventListener("click", e => {
  if (ctxFromTouch && Date.now() - ctxShownAt < 400) return;
  if (!e.target.closest("#ctxMenu")) hideCtxMenu();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") hideCtxMenu(); });

$c("menuToggle").addEventListener("click", e => {
  e.stopPropagation();
  $c("headerBtns").classList.toggle("open");
});
document.addEventListener("click", e => {
  if (!e.target.closest("#headerBtns")) $c("headerBtns").classList.remove("open");
});

document.querySelectorAll("#headerBtns .btn").forEach(b => {
  b.addEventListener("click", () => $c("headerBtns").classList.remove("open"));
});

bindModal();
loadInitial();

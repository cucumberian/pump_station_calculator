"use strict";

const $c = id => document.getElementById(id);

const LS_CASCADE = "kns-cascade";
const LS_N = "kns-cascade-n";

const NODE_HTML = {
  pump: `
    <div class="node-box node-pump">
      <div class="node-title">Насосная станция <span class="node-num"></span></div>
      <div class="nf"><label>Qr, л/с</label><input df-Qr type="number" step="any" min="1"></div>
      <div class="nf"><label>tr, мин</label><input df-tr type="number" step="any" min="1"></div>
      <div class="nf"><label>Qнс, л/с</label><input df-Q type="number" step="any" min="1"></div>
      <input class="q-range" type="range" step="0.5" min="1" title="Qнс — производительность, л/с">
      <div class="node-summary">—</div>
    </div>`,
  delay: `
    <div class="node-box node-delay">
      <div class="node-title">Задержка</div>
      <div class="nf"><label>v, м/с</label><input df-v type="number" step="any" min="0.01"></div>
      <div class="nf"><label>L, м</label><input df-l type="number" step="any" min="0"></div>
      <div class="delay-out">Δt = —</div>
    </div>`,
};

const NODE_DEFAULTS = {
  pump: { Qr: 342.3, tr: 10, Q: 100, mode: "analytic" },
  delay: { v: 1, l: 3600 },
};

const NODE_PORTS = { pump: [1, 1], delay: [1, 1] };
const NODE_LABEL = { pump: "КНС", delay: "Задержка" };
const COMP_COLORS = ["#0b7285", "#f08c00", "#7048e8", "#2f9e44", "#e8590c", "#1098ad"];

const editor = new Drawflow($c("drawflow"));
editor.start();

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
    if (nd.name === "delay") {
      const src = res[upstreamIds(id, data)[0]];
      if (!src) { res[id] = null; continue; }
      res[id] = { series: shiftSeries(src.series, delayDt(d)) };
    } else if (nd.name === "pump") {
      const Qr = parseFloat(d.Qr), tr = parseFloat(d.tr), Q = parseFloat(d.Q);
      if (!(Qr > 0 && tr > 0 && Q > 0)) { res[id] = null; continue; }
      const ownRain = sampleHydro(Qr, tr, nGlob, 4 * tr + totalDelay + 30);
      const ups = upstreamIds(id, data).map(u => ({ id: u, r: res[u] })).filter(x => x.r);
      const inflow = combineSeries([ownRain, ...ups.map(x => x.r.series)]);
      const pureRain = ups.length === 0;
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
        series: pumpOutSeries(Q, r, inflow.t[inflow.t.length - 1]),
        ownRain, inflow, r, Q, Qr, tr, mode, eq, nEff: nGlob,
        approx: mode === "analytic" && !pureRain,
      };
    }
  }
  results = res;
  updateSummaries(data);
  saveScheme();
  refreshSidebar();
}

function updateSummaries(data = graphData()) {
  for (const [id, nd] of Object.entries(data)) {
    if (nd.name === "delay") {
      const out = document.querySelector(`#node-${id} .delay-out`);
      if (out) out.textContent = `Δt = ${fmt(delayDt(nd.data || {}), 1)} мин`;
      continue;
    }
    if (nd.name !== "pump") continue;
    const num = document.querySelector(`#node-${id} .node-num`);
    if (num) num.textContent = `#${id}`;
    const r = results[id];
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

function renderSidebar() {
  if (sbNodeId === null) return;
  const node = editor.getNodeFromId(sbNodeId);
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
  if (document.activeElement !== $c("sbQ")) $c("sbQ").value = res.Q;
  if (document.activeElement !== $c("sbQm3h")) $c("sbQm3h").value = +(res.Q * 3.6).toFixed(1);
  const qMax = seriesPeak(res.inflow).q;
  const rg = $c("sbQrange");
  rg.max = Math.ceil(qMax);
  if (document.activeElement !== rg) rg.value = Math.min(res.Q, qMax);
$c("sbQrange").addEventListener("input", e => {
  $c("sbQ").value = e.target.value;
  $c("sbQ").dispatchEvent(new Event("input", { bubbles: true }));
});
for (const rb of document.querySelectorAll('input[name="sbMode"]')) {
    rb.checked = rb.value === res.mode;
  }
  $c("sbApprox").hidden = !res.approx;

  const data = graphData();
  const comps = [{ label: "Дождь (собственный)", series: res.ownRain }];
  for (const x of upstreamIds(sbNodeId, data)
    .map(u => ({ nd: data[u], r: results[u] }))
    .filter(x => x.r)) {
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
}

function refreshSidebar() {
  if (sbNodeId === null) return;
  if (!editor.getNodeFromId(sbNodeId)) { closeSidebar(); return; }
  renderSidebar();
}

function openSidebar(id) {
  sbNodeId = id;
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
        if (map[conn.node]) editor.addConnection(map[oldId], map[conn.node], "output_1", "input_1");
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
  if (editor.getNodeFromId(id)?.name === "pump") openSidebar(id);
});

const NODE_WHEEL_STEPS = { Qr: 1, tr: 1, Q: 1, v: 0.1, l: 100 };
const SB_WHEEL_STEPS = { sbQr: 1, sbTr: 1, sbQ: 1, sbQm3h: 3.6, sbFrom: 1, sbTo: 1, sbStep: 1, globalN: 0.01 };

const CASCADE_HELP = [
  { p: "Входной гидрограф станции складывается из собственного дождевого стока и выходных гидрографов вышестоящих станций, сдвинутых нодами задержки. Все составляющие показаны на графике пунктиром." },
  { p: "Собственный дождевой сток строится по формулам (2) и (3) Приложения 8 — так же, как в одиночном расчёте:" },
  { tex: "Q(T) = Q_r\\left(\\frac{T}{t_r}\\right)^{1-n}, \\ T \\le t_r; \\qquad Q(T) = Q_r\\left[\\left(\\frac{T}{t_r}\\right)^{1-n} - \\left(\\frac{T}{t_r}-1\\right)^{1-n}\\right], \\ T > t_r" },
  { p: "Нода задержки сдвигает гидрограф по времени на Δt = L / (60·v) минут, где L — длина участка в метрах, v — скорость протекания в м/с." },
  { p: "Выходной гидрограф станции (принятое упрощение): на интервале [Tнⁿˢ; Tкⁿˢ] станция откачивает полную производительность Qнс, в остальное время — половину расчётной (Qнс/2)." },
  { p: "Аналитический режим. Для одиночной станции без входов — точные формулы одиночного расчёта (формулы (1)–(3) Приложения 8). В каскаде суммарный гидрограф заменяется эквивалентным дождевым: Qr* — пик суммарного гидрографа, tr* — момент пика, n — общий климатический параметр схемы; далее применяются те же формулы. Это приближение, о чём выводится предупреждение." },
  { p: "Численный режим. Работа резервуара моделируется по шагам Δt: на каждом шаге уровень заполнения меняется на приток минус откачку, но не может стать отрицательным:" },
  { tex: "V_{i+1} = \\max\\!\\left(0,\\; V_i + 0{,}06\\,\\frac{(Q_i - Q_{нс}) + (Q_{i+1} - Q_{нс})}{2}\\,\\Delta t\\right), \\qquad W_{нс} = \\max_i V_i" },
  { p: "Поэтому «площадь под кривой» ниже Qнс не вычитается и не суммируется: в промежутках, где приток меньше Qнс, резервуар опорожняется (уровень падает до нуля), и следующее окно превышения заполняет уже частично освобождённый бак. Объём Wнс — это максимальный уровень заполнения за весь дождь, а не сумма площадей окон. Tнⁿˢ и Tкⁿˢ — первое и последнее пересечение суммарного гидрографа с линией Qнс." },
];

function dfKey(el) {
  const attr = [...el.attributes].find(a => a.name.startsWith("df-"));
  return attr ? attr.name.slice(3) : null;
}

window.addEventListener("wheel", e => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement)) return;
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
    syncNodeParam(id, el.type === "range" ? "Q" : dfKey(el), v);
  } else {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}, { capture: true, passive: false });

for (const evName of ["mousedown", "touchstart", "pointerdown"]) {
  $c("drawflow").addEventListener(evName, e => {
    if (e.target.classList?.contains("q-range")) e.stopPropagation();
  }, true);
}

$c("drawflow").addEventListener("input", e => {
  if (!e.target.classList?.contains("q-range")) return;
  const id = e.target.closest(".drawflow-node").id.replace("node-", "");
  syncNodeParam(id, "Q", parseFloat(e.target.value));
});

editor.on("connectionCreated", conn => {
  if (wouldCycle(conn.output_id, conn.input_id)) {
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

$c("sbClose").addEventListener("click", closeSidebar);
$c("sbQr").addEventListener("input", () => {
  const v = parseFloat($c("sbQr").value);
  if (v > 0 && sbNodeId !== null) syncNodeParam(sbNodeId, "Qr", v);
});
$c("sbTr").addEventListener("input", () => {
  const v = parseFloat($c("sbTr").value);
  if (v > 0 && sbNodeId !== null) syncNodeParam(sbNodeId, "tr", v);
});
$c("sbQ").addEventListener("input", () => {
  const q = parseFloat($c("sbQ").value);
  if (q > 0 && sbNodeId !== null) syncNodeParam(sbNodeId, "Q", q);
});
$c("sbQm3h").addEventListener("input", () => {
  const m = parseFloat($c("sbQm3h").value);
  if (m > 0 && sbNodeId !== null) syncNodeParam(sbNodeId, "Q", +(m / 3.6).toFixed(2));
});
for (const rb of document.querySelectorAll('input[name="sbMode"]')) {
  rb.addEventListener("change", () => {
    if (sbNodeId !== null && rb.checked) syncNodeParam(sbNodeId, "mode", rb.value);
  });
}
for (const id of ["sbFrom", "sbTo", "sbStep"]) {
  $c(id).addEventListener("input", renderSidebar);
}

$c("globalN").addEventListener("input", computeCascade);

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

bindModal();
loadInitial();

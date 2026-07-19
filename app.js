"use strict";

const $ = id => document.getElementById(id);
const fmt = (x, d = 2) => Number(x).toLocaleString("ru-RU", { maximumFractionDigits: d });

function solveTk(Q, Qr, tr, n) {
  const f = T => Qr * ((T / tr) ** (1 - n) - (T / tr - 1) ** (1 - n));
  let lo = tr, hi = tr * 2;
  while (f(hi) > Q) hi *= 2; // ponytail: скобка удвоением, бисекция ниже — точности 1e-4 мин хватает за ~40 итераций
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > Q) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function calc(Q, Qr, tr, n) {
  const tn = tr * (Q / Qr) ** (1 / (1 - n));
  const tk = solveTk(Q, Qr, tr, n);
  const W = 0.06 * Qr * tr / (2 - n) * (
    (tk / tr) ** (2 - n) - (tn / tr) ** (2 - n) - (tk / tr - 1) ** (2 - n)
    - Q / Qr * (2 - n) * (tk / tr - tn / tr)
  );
  return { tn, tk, W: Math.max(W, 0), fill: W / Q * 1000 / 60 };
}

function clampRange(Qr) {
  const lo = Math.max(1, 0.02 * Qr), hi = Qr;
  let from = parseFloat($("vFrom").value);
  let to = parseFloat($("vTo").value);
  let step = parseFloat($("vStep").value);
  if (!(from > 0) || !(to > 0) || !(step > 0)) return null;
  from = Math.min(Math.max(from, lo), hi);
  to = Math.min(Math.max(to, lo), hi);
  if (to < from) [from, to] = [to, from];
  step = Math.max(step, (to - from) / 49);
  return { from, to, step };
}

function selfCheck() {
  const cases = [[100, 15.61, 113.8], [110, 14.47, 104.9], [120, 13.58, 96.6],
                 [130, 12.87, 88.9], [150, 11.84, 74.7], [200, 10.55, 44.4]];
  const bad = cases.filter(([Q, tk, W]) => {
    const r = calc(Q, 342.3, 10, 0.71);
    return Math.abs(r.tk - tk) > 0.05 || Math.abs(r.W - W) > 0.2;
  });
  console.assert(bad.length === 0, "КНС self-check failed", bad);
  if (bad.length) {
    const el = $("selfcheck");
    el.hidden = false;
    el.textContent = "ОШИБКА: расчёт не сходится с примером из PDF: " + JSON.stringify(bad);
  }
}

function traceTk(Q, Qr, tr, n) {
  const f = T => Qr * ((T / tr) ** (1 - n) - (T / tr - 1) ** (1 - n));
  const bracket = [];
  let lo = tr, hi = tr * 2;
  while (f(hi) > Q) { bracket.push([lo, hi]); lo = hi; hi *= 2; }
  bracket.push([lo, hi]);
  const iters = [];
  for (let i = 1; hi - lo > 0.005 && i <= 100; i++) {
    const mid = (lo + hi) / 2;
    iters.push([i, lo, hi, mid, f(mid)]);
    if (f(mid) > Q) lo = mid; else hi = mid;
  }
  return { bracket, iters, tk: (lo + hi) / 2 };
}

function openHelp(blocks, ctx) {
  const body = $("modalBody");
  body.innerHTML = "";
  for (const b of blocks) {
    if (b.p) {
      const p = document.createElement("p");
      p.textContent = b.p;
      body.append(p);
    } else if (b.tex) {
      const d = document.createElement("div");
      d.className = "modal-tex";
      katex.render(b.tex, d, { displayMode: true, throwOnError: false });
      body.append(d);
    } else if (b.ol) {
      const ol = document.createElement("ol");
      for (const item of b.ol) {
        const li = document.createElement("li");
        li.textContent = item;
        ol.append(li);
      }
      body.append(ol);
    } else if (b.trace) {
      const t = traceTk(ctx.Q, ctx.Qr, ctx.tr, ctx.n);
      const det = document.createElement("details");
      const sum = document.createElement("summary");
      sum.textContent = `Итерации подбора для текущих значений (Qнс = ${fmt(ctx.Q)} л/с)`;
      det.append(sum);
      const tbl = document.createElement("table");
      tbl.className = "trace";
      tbl.innerHTML = "<thead><tr><th>#</th><th>отрезок [lo; hi], мин</th><th>T = середина, мин</th><th>f(T), л/с</th></tr></thead>";
      const tb = tbl.createTBody();
      for (const [j, [lo, hi]] of t.bracket.entries()) {
        const row = tb.insertRow();
        row.className = "bracket";
        [`г${j}`, `[${fmt(lo, 2)}; ${fmt(hi, 2)}]`, "—", "—"].forEach(x => row.insertCell().textContent = x);
      }
      for (const [i, lo, hi, mid, fm] of t.iters) {
        const row = tb.insertRow();
        [i, `[${fmt(lo, 4)}; ${fmt(hi, 4)}]`, fmt(mid, 4), fmt(fm, 2)].forEach(x => row.insertCell().textContent = x);
      }
      const res = document.createElement("p");
      res.className = "trace-res";
      res.textContent = `Итог: Tкⁿˢ = ${fmt(t.tk, 2)} мин (f = ${fmt(t.iters.at(-1)?.[4] ?? ctx.Q, 2)} л/с ≈ Qнс)`;
      det.append(tbl, res);
      body.append(det);
    }
  }
  $("modal").hidden = false;
}

function tex(formula) {
  const span = document.createElement("span");
  katex.render(formula, span, { throwOnError: false });
  return span;
}

const CARDS = [
  {
    title: "Tнⁿˢ — начало превышения, мин",
    sym: "T_{н}^{нс}", unit: "\\text{мин}",
    val: r => fmt(r.tn),
    tex: (Q, Qr, tr, n, r) =>
      `T_{н}^{нс} = t_r\\left(\\frac{Q_{нс}}{Q_r}\\right)^{\\frac{1}{1-n}} = ${fmt(tr)}\\left(\\frac{${fmt(Q)}}{${fmt(Qr)}}\\right)^{\\frac{1}{1-${fmt(n)}}} = ${fmt(r.tn)}\\ \\text{мин}`
  },
  {
    title: "Tкⁿˢ — конец превышения, мин",
    sym: "T_{к}^{нс}", unit: "\\text{мин}",
    val: r => fmt(r.tk),
    tex: (Q, Qr, tr, n, r) =>
      `Q_{нс} = Q_r\\left[\\left(\\frac{T_{к}^{нс}}{t_r}\\right)^{1-n} - \\left(\\frac{T_{к}^{нс}}{t_r}-1\\right)^{1-n}\\right] \\Rightarrow T_{к}^{нс} = ${fmt(r.tk)}\\ \\text{мин}`,
    help: [
      { p: "Tкⁿˢ не выражается прямой формулой — она находится подбором (итерационно), формула (3) Приложения 8. Решается уравнение относительно T > tr:" },
      { tex: "Q_{нс} = Q_r\\left[\\left(\\frac{T}{t_r}\\right)^{1-n} - \\left(\\frac{T}{t_r}-1\\right)^{1-n}\\right]" },
      { p: "Правая часть при T > tr монотонно убывает от Qr (при T = tr) до 0, поэтому корень единственный." },
      { p: "Численно уравнение решается методом бисекции (деления отрезка пополам):" },
      { ol: [
        "Начальный отрезок [tr; 2·tr]; верхняя граница удваивается, пока f(T) > Qнс — так корень гарантированно оказывается внутри отрезка.",
        "Итерации делят отрезок пополам: если f(середина) > Qнс — корень в правой половине, иначе в левой.",
      ] },
      { trace: true },
      { p: "Пример из методички: Qнс = 100 л/с, Qr = 342,3 л/с, tr = 10 мин, n = 0,71 → подбор даёт Tкⁿˢ = 15,61 мин." },
    ],
  },
  {
    title: "Wнс — рабочий объём резервуара, м³",
    sym: "W_{нс}", unit: "\\text{м}^3",
    wide: true,
    val: r => fmt(r.W, 1),
    tex: (Q, Qr, tr, n, r) =>
      `\\begin{aligned} W_{нс} &= \\frac{0{,}06\\,Q_r\\,t_r}{2-n}\\left[\\left(\\frac{T_{к}^{нс}}{t_r}\\right)^{2-n} - \\left(\\frac{T_{н}^{нс}}{t_r}\\right)^{2-n} - \\left(\\frac{T_{к}^{нс}}{t_r}-1\\right)^{2-n} - \\frac{Q_{нс}}{Q_r}(2-n)\\left(\\frac{T_{к}^{нс}}{t_r}-\\frac{T_{н}^{нс}}{t_r}\\right)\\right] \\\\ &= \\frac{0{,}06\\cdot ${fmt(Qr)}\\cdot ${fmt(tr)}}{2-${fmt(n)}}\\left[ ${fmt(r.tk / tr, 2)}^{${fmt(2 - n)}} - ${fmt(r.tn / tr, 3)}^{${fmt(2 - n)}} - ${fmt(r.tk / tr - 1, 2)}^{${fmt(2 - n)}} - ${fmt(Q / Qr, 3)}\\cdot ${fmt(2 - n)}\\cdot (${fmt(r.tk / tr, 2)}-${fmt(r.tn / tr, 3)}) \\right] = ${fmt(r.W, 1)}\\ \\text{м}^3 \\end{aligned}`
  },
  {
    title: "tзап — время наполнения резервуара, мин",
    sym: "t_{зап}", unit: "\\text{мин}",
    val: r => fmt(r.fill, 1),
    tex: (Q, Qr, tr, n, r) =>
      `t_{зап} = \\frac{W_{нс}}{Q_{нс}} = \\frac{${fmt(r.W, 1)}\\cdot 1000}{${fmt(Q)}\\cdot 60} = ${fmt(r.fill, 1)}\\ \\text{мин}`
  },
  {
    title: "Qнс — производительность насосной станции, м³/ч",
    sym: "Q_{нс}", unit: "\\text{м}^3/\\text{ч}",
    val: (r, Q) => fmt(Q * 3.6, 1),
    tex: (Q) => `Q_{нс} = ${fmt(Q)}\\ \\text{л/с} \\cdot 3{,}6 = ${fmt(Q * 3.6, 1)}\\ \\text{м}^3/\\text{ч}`
  },
];

let chart, chartQT;

function hydro(T, Qr, tr, n) {
  const x = T / tr;
  return Qr * (x ** (1 - n) - (x > 1 ? (x - 1) ** (1 - n) : 0));
}

function renderQT(Q, Qr, tr, n, r) {
  const tMax = Math.max(1.5 * r.tk, 2 * tr);
  const N = 120;
  const ts = [], qs = [], fill = [];
  for (let i = 0; i <= N; i++) {
    const t = tMax * i / N;
    ts.push(+t.toFixed(3));
    qs.push(+hydro(t, Qr, tr, n).toFixed(2));
    fill.push(t >= r.tn && t <= r.tk ? qs[i] : null);
  }
  const marker = (t, label) => ({
    label, data: [{ x: t, y: 0 }, { x: t, y: hydro(t, Qr, tr, n) }],
    borderColor: "#8a929c", borderWidth: 1, borderDash: [4, 4],
    pointRadius: 3, backgroundColor: "#8a929c", showLine: true,
  });
  const data = {
    labels: ts,
    datasets: [
      { label: "Q(T), л/с", data: qs, borderColor: "#1f6feb", borderWidth: 2, pointRadius: 0, tension: 0.2 },
      { label: "Wнс (площадь)", data: fill, borderWidth: 0, pointRadius: 0,
        fill: { value: Q }, backgroundColor: "rgba(31, 111, 235, 0.18)" },
      { label: "Qнс", data: ts.map(() => Q), borderColor: "#d6336c", borderWidth: 1.5,
        borderDash: [6, 4], pointRadius: 0 },
      marker(r.tn, "Tн"), marker(tr, "tr"), marker(r.tk, "Tк"),
    ],
  };
  if (chartQT) {
    chartQT.data = data;
    chartQT.update("none");
  } else {
    chartQT = new Chart($("chartQT"), {
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
          legend: { labels: { filter: i => !["Tн", "tr", "Tк"].includes(i.text) } },
          tooltip: {
            filter: c => c.datasetIndex < 3,
            callbacks: {
              title: c => c.length ? `T = ${fmt(c[0].parsed.x, 1)} мин` : "",
              label: c => c.datasetIndex === 2 ? `Qнс = ${fmt(Q)} л/с` : `Q = ${fmt(c.parsed.y, 1)} л/с`,
            },
          },
        },
      },
    });
  }
}

function render() {
  const Qr = parseFloat($("Qr").value);
  const tr = parseFloat($("tr").value);
  const n = parseFloat($("n").value);
  const Q = parseFloat($("Q").value);
  if (!(Qr > 0 && tr > 0 && n > 0 && n < 1 && Q > 0)) return;

  $("Qrange").max = Qr;
  $("Qrange").value = Math.min(Q, Qr);
  $("nrange").value = n;
  $("Qhint").textContent = Q >= Qr
    ? "Qнс ≥ Qr — резервуар не требуется (сток перекачивается без регулирования)"
    : "";

  const r = calc(Q, Qr, tr, n);
  saveToStorage();

  const cards = $("cards");
  cards.innerHTML = "";
  for (const c of CARDS) {
    const div = document.createElement("div");
    div.className = "card" + (c.wide ? " wide" : "");
    const h = document.createElement("h3");
    h.textContent = c.title;
    if (c.help) {
      const btn = document.createElement("button");
      btn.className = "help-btn";
      btn.type = "button";
      btn.textContent = "?";
      btn.title = "Как считается этот параметр";
      btn.addEventListener("click", () => openHelp(c.help, { Q, Qr, tr, n }));
      div.append(btn);
    }
    const v = document.createElement("div");
    v.className = "value";
    v.append(tex(`${c.sym} = ${c.val(r, Q)}\\ ${c.unit}`));
    div.append(h, tex(c.tex(Q, Qr, tr, n, r)), v);
    cards.append(div);
  }

  const N = 60;
  const qs = [], ws = [];
  for (let i = 0; i <= N; i++) {
    const q = Qr * (0.02 + 0.98 * i / N);
    qs.push(+q.toFixed(1));
    ws.push(+calc(q, Qr, tr, n).W.toFixed(2));
  }
  const marker = qs.map(() => null);
  let mi = 0;
  qs.forEach((q, i) => { if (Math.abs(q - Q) < Math.abs(qs[mi] - Q)) mi = i; });
  marker[mi] = +calc(qs[mi], Qr, tr, n).W.toFixed(2);
  const data = {
    labels: qs,
    datasets: [
      { label: "Wнс, м³", data: ws, borderColor: "#1f6feb", borderWidth: 2, pointRadius: 0, tension: 0.2 },
      { label: "текущий выбор", data: marker,
        borderColor: "#d6336c", backgroundColor: "#d6336c", pointRadius: 6, pointHoverRadius: 7, showLine: false },
    ],
  };
  if (chart) {
    chart.data = data;
    chart.update("none");
  } else {
    chart = new Chart($("chart"), {
      type: "line", data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: false },
        scales: {
          x: { type: "linear", title: { display: true, text: "Qнс, л/с" } },
          y: { title: { display: true, text: "Wнс, м³" }, beginAtZero: true },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: c => c.datasetIndex === 0
                ? `Wнс = ${fmt(c.parsed.y, 1)} м³, наполнение ${fmt(calc(c.parsed.x, Qr, tr, n).fill, 1)} мин`
                : `выбрано: Qнс = ${fmt(Q)} л/с`,
            },
          },
        },
      },
    });
  }

  renderQT(Q, Qr, tr, n, r);

  const tbody = $("variants").querySelector("tbody");
  tbody.innerHTML = "";
  const rc = clampRange(Qr);  if (!rc) return;
  const { from, to, step } = rc;
  for (let q = from, i = 0; q <= to + 1e-9 && i < 51; q += step, i++) {
    const v = calc(q, Qr, tr, n);
    const row = tbody.insertRow();
    if (Math.abs(q - Q) < step / 2) row.className = "active";
    [fmt(q, 0), fmt(q * 3.6, 1), fmt(v.tn), fmt(v.tk), fmt(v.W, 1), fmt(v.fill, 1)]
      .forEach(x => row.insertCell().textContent = x);
  }
}

const PARAM_IDS = ["Qr", "tr", "n", "Q", "vFrom", "vTo", "vStep"];
const LS_KEY = "kns-params";

function loadFromStorage() {
  try {
    const data = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    for (const id of PARAM_IDS) {
      if (data[id] != null && data[id] !== "") $(id).value = data[id];
    }
  } catch { /* повреждённые данные игнорируем */ }
}

function saveToStorage() {
  const data = {};
  for (const id of PARAM_IDS) data[id] = $(id).value;
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* приватный режим */ }
}

function loadFromUrl() {
  const p = new URLSearchParams(location.search);
  let hasTable = false;
  for (const id of PARAM_IDS) {
    const v = parseFloat(p.get(id));
    if (Number.isFinite(v)) {
      $(id).value = v;
      if (id.startsWith("v")) hasTable = true;
    }
  }
  return hasTable;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* ниже fallback */ }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length); // ponytail: iOS Safari требует явный selection
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* устаревший API, но единственный на старых мобильных */ }
  ta.remove();
  return ok;
}

$("share").addEventListener("click", async () => {
  const p = new URLSearchParams();
  for (const id of PARAM_IDS) p.set(id, $(id).value);
  history.replaceState(null, "", "?" + p);
  const ok = await copyText(location.href);
  if (ok) {
    $("share").textContent = "Скопировано!";
    setTimeout(() => { $("share").textContent = "Поделиться"; }, 1500);
  } else {
    prompt("Скопируйте ссылку:", location.href);
  }
});

selfCheck();
$("schemeToggle").addEventListener("click", () => $("scheme").classList.toggle("open"));
$("resultsToggle").addEventListener("click", () => $("results").classList.toggle("open"));
if (window.matchMedia("(min-width: 901px)").matches) $("results").classList.add("open");
$("modalClose").addEventListener("click", () => { $("modal").hidden = true; });
$("modal").addEventListener("click", e => { if (e.target === $("modal")) $("modal").hidden = true; });
document.addEventListener("keydown", e => { if (e.key === "Escape") $("modal").hidden = true; });
loadFromStorage();
let rangeDirty = loadFromUrl();
for (const id of ["vFrom", "vTo", "vStep"]) {
  $(id).addEventListener("input", () => { rangeDirty = true; render(); });
  $(id).addEventListener("change", () => {
    const Qr = parseFloat($("Qr").value);
    const rc = Qr > 0 && clampRange(Qr);
    if (rc) {
      $("vFrom").value = +rc.from.toFixed(2);
      $("vTo").value = +rc.to.toFixed(2);
      $("vStep").value = +rc.step.toFixed(2);
    }
    render();
  });
}
$("Qr").addEventListener("input", () => {
  if (!rangeDirty) {
    const Qr = parseFloat($("Qr").value);
    if (Qr > 0) {
      $("vFrom").value = Math.max(1, Math.round(Qr / 8));
      $("vTo").value = Math.round(Qr);
      $("vStep").value = Math.max(1, Math.round(Qr / 8));
    }
  }
});
for (const id of ["Qr", "tr", "n", "Q"]) $(id).addEventListener("input", render);
$("Qrange").addEventListener("input", e => { $("Q").value = e.target.value; render(); });
$("nrange").addEventListener("input", e => { $("n").value = e.target.value; render(); });

const shiftTr = dh => {
  const tr = parseFloat($("tr").value) || 0;
  $("tr").value = Math.max(1, tr + dh * 60);
  render();
};
$("trMinus").addEventListener("click", () => shiftTr(-1));
$("trPlus").addEventListener("click", () => shiftTr(1));

const WHEEL_STEPS = { Qr: 1, tr: 1, n: 0.01, Q: 1, vFrom: 1, vTo: 1, vStep: 1 };
for (const [id, step] of Object.entries(WHEEL_STEPS)) {
  $(id).addEventListener("wheel", e => {
    e.preventDefault();
    const el = e.currentTarget;
    const dec = (String(step).split(".")[1] || "").length;
    let v = (parseFloat(el.value) || 0) + (e.deltaY < 0 ? step : -step);
    v = +v.toFixed(dec);
    if (el.min !== "" && v < +el.min) v = +el.min;
    if (el.max !== "" && v > +el.max) v = +el.max;
    el.value = v;
    el.dispatchEvent(new Event("input"));
  }, { passive: false });
}

render();

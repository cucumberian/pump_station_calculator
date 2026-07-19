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
      `Q_{нс} = Q_r\\left[\\left(\\frac{T_{к}^{нс}}{t_r}\\right)^{1-n} - \\left(\\frac{T_{к}^{нс}}{t_r}-1\\right)^{1-n}\\right] \\Rightarrow T_{к}^{нс} = ${fmt(r.tk)}\\ \\text{мин}`
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

let chart;

function render() {
  const Qr = parseFloat($("Qr").value);
  const tr = parseFloat($("tr").value);
  const n = parseFloat($("n").value);
  const Q = parseFloat($("Q").value);
  if (!(Qr > 0 && tr > 0 && n > 0 && n < 1 && Q > 0)) return;

  $("Qrange").max = Qr;
  $("Qrange").value = Math.min(Q, Qr);
  $("Qhint").textContent = Q >= Qr
    ? "Qнс ≥ Qr — резервуар не требуется (сток перекачивается без регулирования)"
    : "";

  const r = calc(Q, Qr, tr, n);

  const cards = $("cards");
  cards.innerHTML = "";
  for (const c of CARDS) {
    const div = document.createElement("div");
    div.className = "card" + (c.wide ? " wide" : "");
    const h = document.createElement("h3");
    h.textContent = c.title;
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

  const tbody = $("variants").querySelector("tbody");
  tbody.innerHTML = "";
  const rc = clampRange(Qr);
  if (!rc) return;
  const { from, to, step } = rc;
  for (let q = from, i = 0; q <= to + 1e-9 && i < 51; q += step, i++) {
    const v = calc(q, Qr, tr, n);
    const row = tbody.insertRow();
    if (Math.abs(q - Q) < step / 2) row.className = "active";
    [fmt(q, 0), fmt(q * 3.6, 1), fmt(v.tn), fmt(v.tk), fmt(v.W, 1), fmt(v.fill, 1)]
      .forEach(x => row.insertCell().textContent = x);
  }
}

selfCheck();
$("schemeToggle").addEventListener("click", () => $("scheme").classList.toggle("open"));
let rangeDirty = false;
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

"use strict";

const $view = id => document.getElementById(id);
const fmt = (x, d = 2) => Number(x).toLocaleString("ru-RU", { maximumFractionDigits: d });

function tex(formula) {
  const span = document.createElement("span");
  katex.render(formula, span, { throwOnError: false });
  return span;
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
  const body = $view("modalBody");
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
  $view("modal").hidden = false;
}

function bindModal() {
  $view("modalClose").addEventListener("click", () => { $view("modal").hidden = true; });
  $view("modal").addEventListener("click", e => { if (e.target === $view("modal")) $view("modal").hidden = true; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") $view("modal").hidden = true; });
}

const CARDS = [
  {
    title: "Tнⁿˢ — начало превышения, мин",
    sym: "T_{н}^{\\text{нс}}", unit: "\\text{мин}",
    val: r => fmt(r.tn),
    tex: (Q, Qr, tr, n, r) =>
      `T_{н}^{\\text{нс}} = t_r\\left(\\frac{Q_{нс}}{Q_r}\\right)^{\\frac{1}{1-n}} = ${fmt(tr)}\\left(\\frac{${fmt(Q)}}{${fmt(Qr)}}\\right)^{\\frac{1}{1-${fmt(n)}}} = ${fmt(r.tn)}\\ \\text{мин}`
  },
  {
    title: "Tкⁿˢ — конец превышения, мин",
    sym: "T_{к}^{\\text{нс}}", unit: "\\text{мин}",
    val: r => fmt(r.tk),
    tex: (Q, Qr, tr, n, r) =>
      `Q_{нс} = Q_r\\left[\\left(\\frac{T_{к}^{\\text{нс}}}{t_r}\\right)^{1-n} - \\left(\\frac{T_{к}^{\\text{нс}}}{t_r}-1\\right)^{1-n}\\right] \\Rightarrow T_{к}^{\\text{нс}} = ${fmt(r.tk)}\\ \\text{мин}`,
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
      `\\begin{aligned} W_{нс} &= \\frac{0{,}06\\,Q_r\\,t_r}{2-n}\\left[\\left(\\frac{T_{к}^{\\text{нс}}}{t_r}\\right)^{2-n} - \\left(\\frac{T_{н}^{\\text{нс}}}{t_r}\\right)^{2-n} - \\left(\\frac{T_{к}^{\\text{нс}}}{t_r}-1\\right)^{2-n} - \\frac{Q_{нс}}{Q_r}(2-n)\\left(\\frac{T_{к}^{\\text{нс}}}{t_r}-\\frac{T_{н}^{\\text{нс}}}{t_r}\\right)\\right] \\\\ &= \\frac{0{,}06\\cdot ${fmt(Qr)}\\cdot ${fmt(tr)}}{2-${fmt(n)}}\\left[ ${fmt(r.tk / tr, 2)}^{${fmt(2 - n)}} - ${fmt(r.tn / tr, 3)}^{${fmt(2 - n)}} - ${fmt(r.tk / tr - 1, 2)}^{${fmt(2 - n)}} - ${fmt(Q / Qr, 3)}\\cdot ${fmt(2 - n)}\\cdot (${fmt(r.tk / tr, 2)}-${fmt(r.tn / tr, 3)}) \\right] = ${fmt(r.W, 1)}\\ \\text{м}^3 \\end{aligned}`
  },
];

const HYDRO_HELP = [
  { p: "Гидрограф Q(T) — расход дождевого стока, поступающего в насосную станцию в момент времени T от начала дождя. Строится по формулам (2) и (3) Приложения 8 рекомендаций ВОДГЕО." },
  { p: "Ветвь подъёма (T ≤ tr). По методу предельных интенсивностей интенсивность дождя убывает с его продолжительностью как t^(−n), а накопленный к моменту T объём стока пропорционален T^(1−n). Поэтому расход нарастает по степенному закону от 0 до Qr:" },
  { tex: "Q(T) = Q_r\\left(\\frac{T}{t_r}\\right)^{1-n}, \\quad T \\le t_r" },
  { p: "Это же соотношение в виде формулы (2) Приложения 8, решённой относительно времени (момент начала превышения, точка на ветви подъёма):" },
  { tex: "T_{н}^{\\text{нс}} = t_r\\left(\\frac{Q_{\\text{нс}}}{Q_r}\\right)^{\\frac{1}{1-n}}" },
  { p: "Ветвь спада (T > tr). Дождь конечной продолжительности tr представляется как разность двух бесконечных дождей, начавшихся в моменты 0 и tr (принцип суперпозиции). Поэтому из ветви подъёма вычитается такая же ветвь, сдвинутая на tr:" },
  { tex: "Q(T) = Q_r\\left[\\left(\\frac{T}{t_r}\\right)^{1-n} - \\left(\\frac{T}{t_r}-1\\right)^{1-n}\\right], \\quad T > t_r" },
  { p: "Это в точности правая часть формулы (3) Приложения 8, из которой подбором находится Tкⁿˢ (метод бисекции). График строится непосредственно по этим двум формулам." },
  { p: "Пик гидрографа — точка T = tr, Q = Qr: при T = tr ветвь подъёма даёт Qr, а вычитаемый член ветви спада равен нулю. Закрашенная площадь между кривой и линией Qнс на интервале [Tнⁿˢ; Tкⁿˢ] — рабочий объём Wнс (формула (1) Приложения 8)." },
];

function buildCards(cardsEl, Q, Qr, tr, n, r, numeric) {
  cardsEl.innerHTML = "";
  for (const c of CARDS) {
    const div = document.createElement("div");
    div.className = "card" + (c.wide ? " wide" : "");
    const h = document.createElement("h3");
    h.textContent = c.title;
    if (c.help && !numeric) {
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
    if (numeric) {
      const note = document.createElement("span");
      note.className = "num-note";
      note.textContent = "численно по суммарному гидрографу";
      div.append(h, note, v);
    } else {
      div.append(h, tex(c.tex(Q, Qr, tr, n, r)), v);
    }
    cardsEl.append(div);
  }
}

function makeWQChart(canvas) {
  let chart = null;
  return {
    update(Q, Qr, tr, n, { rangePts = [], calcFn = null } = {}) {
      const qFrom = Qr * 0.02, qTo = Qr;
      const qSet = new Set();
      const N = 120;
      for (let i = 0; i <= N; i++) qSet.add(+(qFrom + (qTo - qFrom) * i / N).toFixed(2));
      qSet.add(+Q.toFixed(2));
      const qs = [...qSet].sort((a, b) => a - b);
      const fn = calcFn || (q => calc(q, Qr, tr, n));
      const ws = qs.map(q => +fn(q).W.toFixed(2));
      const marker = qs.map(() => null);
      const mi = qs.indexOf(+Q.toFixed(2));
      if (mi >= 0) marker[mi] = ws[mi];
      const data = {
        labels: qs,
        datasets: [
          { label: "Wнс, м³", data: ws, borderColor: "#1f6feb", borderWidth: 2, pointRadius: 0, tension: 0.2 },
          { label: `Qнс = ${fmt(Q)} л/с`, data: marker,
            borderColor: "#d6336c", backgroundColor: "#d6336c", pointRadius: 6, pointHoverRadius: 7, showLine: false },
          { label: "Варианты из таблицы", data: rangePts,
            borderColor: "#f08c00", backgroundColor: "#f08c00", pointRadius: 4, pointHoverRadius: 6, showLine: false },
        ],
      };
      if (chart) {
        chart.data = data;
        chart.update("none");
      } else {
        chart = new Chart(canvas, {
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
              title: { display: true, text: "Рабочий объём резервуара Wнс от производительности Qнс" },
              tooltip: {
                callbacks: {
                  title: c => c.length ? `Qнс = ${fmt(c[0].parsed.x, 0)} л/с` : "",
                  label: c => c.datasetIndex === 0
                    ? `Wнс = ${fmt(c.parsed.y, 1)} м³, наполнение ${fmt((v => v.tk - v.tn)(fn(c.parsed.x)), 1)} мин`
                    : c.datasetIndex === 1
                      ? `выбрано: Qнс = ${fmt(Q)} л/с`
                      : `вариант: Wнс = ${fmt(c.parsed.y, 1)} м³`,
                },
              },
            },
          },
        });
      }
    },
  };
}

function makeQTChart(canvas, { onHelp = null } = {}) {
  let chart = null;
  return {
    update(Q, Qr, tr, n, r, { extra = [], hydroFn = null, title = "Гидрограф дождевого стока Q(T)" } = {}) {
      const hf = hydroFn || (t => hydro(t, Qr, tr, n));
      const tMax = Math.max(1.5 * r.tk, 2 * tr);
      const tSet = new Set();
      const N = 120;
      for (let i = 0; i <= N; i++) tSet.add(+(tMax * i / N).toFixed(3));
      const lo = Math.max(0, 0.7 * tr), hi = Math.min(tMax, 1.3 * tr);
      const M = 100;
      for (let i = 0; i <= M; i++) tSet.add(+(lo + (hi - lo) * i / M).toFixed(3));
      tSet.add(tr);
      const ts = [...tSet].sort((a, b) => a - b);
      const qs = ts.map(t => +hf(t).toFixed(2));
      const fill = ts.map((t, i) => (t >= r.tn && t <= r.tk ? qs[i] : null));
      const marker = (t, label, qv) => ({
        label, data: [{ x: t, y: 0 }, { x: t, y: qv }],
        borderColor: "#8a929c", borderWidth: 1, borderDash: [4, 4],
        pointRadius: 3, backgroundColor: "#8a929c", showLine: true,
      });
      const data = {
        labels: ts,
        datasets: [
          { label: "Q(T), л/с", data: qs, borderColor: "#1f6feb", borderWidth: 2, pointRadius: 0, tension: 0.2 },
          ...extra,
          { label: "Wнс (площадь), м³", data: fill, borderWidth: 0, pointRadius: 0,
            fill: { value: Q }, backgroundColor: "rgba(31, 111, 235, 0.18)" },
          { label: "Qнс, л/с", data: ts.map(() => Q), borderColor: "#d6336c", borderWidth: 1.5,
            borderDash: [6, 4], pointRadius: 0 },
          marker(r.tn, "Tн", hf(r.tn)), marker(tr, "tr", hf(tr)), marker(r.tk, "Tк", hf(r.tk)),
        ],
      };
      if (chart) {
        chart.data = data;
        chart.update("none");
      } else {
        chart = new Chart(canvas, {
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
              title: { display: true, text: title },
              legend: { labels: { filter: i => !["Tн", "tr", "Tк"].includes(i.text) } },
              tooltip: {
                filter: c => c.datasetIndex < 2 + extra.length,
                callbacks: {
                  title: c => c.length ? `T = ${fmt(c[0].parsed.x, 1)} мин` : "",
                  label: c => c.dataset.parsing === false
                    ? `${c.dataset.label}: Q = ${fmt(c.parsed.y, 1)} л/с`
                    : `Q = ${fmt(c.parsed.y, 1)} л/с`,
                },
              },
            },
          },
        });
      }
    },
  };
}

function fillVariants(tbody, Q, from, to, step, calcFn) {
  tbody.innerHTML = "";
  const fn = calcFn || calc;
  for (let q = from, i = 0; q <= to + 1e-9 && i < 51; q += step, i++) {
    const v = fn(q);
    const row = tbody.insertRow();
    if (Math.abs(q - Q) < step / 2) row.className = "active";
    [fmt(q, 0), fmt(q * 3.6, 1), fmt(v.tn), fmt(v.tk), fmt(v.W, 1)]
      .forEach(x => row.insertCell().textContent = x);
  }
}

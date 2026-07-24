"use strict";

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

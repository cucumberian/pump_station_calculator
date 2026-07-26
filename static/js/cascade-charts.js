"use strict";

const delayChart = (() => {
  let ec = null;
  return {
    update(dt, inSeries, outSeries) {
      if (!ec) ec = makeEChart($c("sbDelayChart"), { slider: true, legend: true, toolbox: false });
      const inEnd = inSeries.t[inSeries.t.length - 1];
      const inLast = inSeries.q[inSeries.q.length - 1];
      ec.update({
        xAxis: { type: "value", name: "T, мин", nameLocation: "middle", nameGap: 24, min: 0 },
        yAxis: { type: "value", name: "Q, л/с", min: 0 },
        tooltip: { formatter: ecAxisTip("л/с") },
        series: [
          { name: "вход, л/с", type: "line", showSymbol: false, step: "end",
            data: outSeries.t.map(t => [+t.toFixed(2), +(t <= inEnd ? interpAt(inSeries, t) : inLast).toFixed(2)]),
            lineStyle: { color: "#1f6feb", width: 2 }, itemStyle: { color: "#1f6feb" },
            markLine: {
              symbol: "none", silent: true, animation: false,
              data: [{ name: "Δt", xAxis: dt, lineStyle: { color: "#b26a00", type: "dashed" },
                label: { formatter: `Δt = ${fmt(dt, 1)} мин`, position: "insideEndTop" } }],
            },
          },
          { name: `выход (сдвиг ${fmt(dt, 1)} мин), л/с`, type: "line", showSymbol: false, step: "end",
            data: outSeries.t.map((t, i) => [+t.toFixed(2), +outSeries.q[i].toFixed(2)]),
            lineStyle: { color: "#f08c00", width: 2, type: "dashed" }, itemStyle: { color: "#f08c00" } },
        ],
      });
    },
  };
})();

const inflowChart = (() => {
  let ec = null;
  return {
    update(Q, r, combined, comps, outSeries, approx) {
      if (!ec) ec = makeEChart($c("sbInflow"), { slider: true, legend: true, toolbox: false });
      const ts = combined.t;
      const qs = combined.q;
      const compSeries = comps.map((c, i) => ({
        name: c.label, type: "line", showSymbol: false,
        data: ts.map(t => [+t.toFixed(2), +interpAt(c.series, t).toFixed(2)]),
        lineStyle: { color: COMP_COLORS[i % COMP_COLORS.length], width: 1, type: "dashed" },
        itemStyle: { color: COMP_COLORS[i % COMP_COLORS.length] },
      }));
      const series = [
        ...compSeries,
        { name: approx ? "Σ вход (эквив.), л/с" : "Σ вход, л/с", type: "line", showSymbol: false,
          data: ts.map((t, i) => [+t.toFixed(2), +qs[i].toFixed(2)]),
          lineStyle: { color: "#1f6feb", width: 2 }, itemStyle: { color: "#1f6feb" }, smooth: 0.15,
          markLine: {
            symbol: "none", silent: true, animation: false,
            data: [
              ...(!r.dry ? [
                { name: "Tн", xAxis: r.tn, lineStyle: { color: "#8a929c", type: "dashed" }, label: { formatter: "Tн", position: "insideEndTop" } },
                { name: "Tк", xAxis: r.tk, lineStyle: { color: "#8a929c", type: "dashed" }, label: { formatter: "Tк", position: "insideEndTop" } },
              ] : []),
              { name: "Qнс", yAxis: Q, lineStyle: { color: "#d6336c", type: "dashed", width: 1.5 },
                label: { formatter: `Qнс = ${fmt(Q)} л/с`, position: "insideStartTop" } },
            ],
          },
        },
        { name: "Wнс (площадь)", type: "line", showSymbol: false,
          data: ts.map((t, i) => [+t.toFixed(2), (!r.dry && t >= r.tn && t <= r.tk && qs[i] > Q ? +qs[i].toFixed(2) : null)]),
          lineStyle: { width: 0 }, areaStyle: { origin: Q, color: "rgba(31, 111, 235, 0.18)" } },
      ];
      if (outSeries) {
        series.push({
          name: "выход КНС, л/с", type: "line", showSymbol: false, step: "end",
          data: ts.map(t => [+t.toFixed(2), +interpAt(outSeries, t).toFixed(2)]),
          lineStyle: { color: "#2b8a3e", width: 1.5 }, itemStyle: { color: "#2b8a3e" },
        });
      }
      ec.update({
        xAxis: { type: "value", name: "T, мин", nameLocation: "middle", nameGap: 24, min: 0 },
        yAxis: { type: "value", name: "Q, л/с", min: 0 },
        tooltip: { formatter: ecAxisTip("л/с") },
        legend: { data: [...comps.map(c => c.label), approx ? "Σ вход (эквив.), л/с" : "Σ вход, л/с", ...(outSeries ? ["выход КНС, л/с"] : [])] },
        series,
      });
    },
  };
})();

const sbWqChart = { inner: null };
const sbQtState = {};

function sbCalcFn(res) {
  if (res.mode === "numeric") {
    const inflowDense = res.inflow || (res.inflowGF ? toDense(res.inflowGF, HYDRO_DT, globalTMax || undefined) : null);
    return q => numericCalc(q, inflowDense);
  }
  if (!res.eq) {
    return q => mixedAnalyticCalc(q, res.ownRainGF, res.flowGFs);
  }
  return q => calc(q, res.eq.Qr, res.eq.tr, res.eq.n);
}

const catchChart = (() => {
  let ec = null;
  return {
    update(series, Qr, tr) {
      if (!ec) ec = makeEChart($c("sbCatchChart"), { slider: true, legend: true, toolbox: false });
      ec.update({
        xAxis: { type: "value", name: "T, мин", nameLocation: "middle", nameGap: 24, min: 0 },
        yAxis: { type: "value", name: "Q, л/с", min: 0 },
        tooltip: { formatter: ecAxisTip("л/с") },
        series: [
          { name: "Q, л/с", type: "line", showSymbol: false, smooth: 0.15,
            data: series.t.map((t, i) => [+t.toFixed(2), +series.q[i].toFixed(2)]),
            lineStyle: { color: "#1098ad", width: 2 }, itemStyle: { color: "#1098ad" },
            areaStyle: { color: "rgba(16, 152, 173, 0.12)" },
            markLine: {
              symbol: "none", silent: true, animation: false,
              data: [
                { name: "Qr", yAxis: Qr, lineStyle: { color: "#0b7285", type: "dashed" },
                  label: { formatter: `Qr = ${fmt(Qr, 1)} л/с`, position: "insideStartTop" } },
                { name: "tr", xAxis: tr, lineStyle: { color: "#8a929c", type: "dashed" },
                  label: { formatter: `tr = ${fmt(tr, 1)} мин`, position: "insideEndTop" } },
              ],
            },
          },
        ],
        legend: { data: ["Q, л/с"] },
      });
    },
  };
})();

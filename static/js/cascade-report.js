"use strict";

function reportFmt(x, d = 2) {
  const v = Number(x);
  return (v === 0 ? 0 : v).toLocaleString("ru-RU", { maximumFractionDigits: d });
}

function reportPlural(n, one, few, many) {
  return n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
}

function helpBlocksToMD(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.p) out.push(b.p);
    else if (b.tex) out.push(`$$\n${b.tex}\n$$`);
    else if (b.ol) out.push(b.ol.map((x, i) => `${i + 1}. ${x}`).join("\n"));
  }
  return out.join("\n\n");
}

function reportUpstreams(id, connections) {
  return connections.filter(c => c.to === id).map(c => c.from);
}

function topoNodeOrder(nodes, connections) {
  const ids = nodes.map(n => n.id);
  const indeg = new Map(ids.map(id => [id, 0]));
  for (const c of connections) if (indeg.has(c.to)) indeg.set(c.to, indeg.get(c.to) + 1);
  const queue = ids.filter(id => indeg.get(id) === 0);
  const order = [];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const c of connections) {
      if (c.from !== id) continue;
      indeg.set(c.to, indeg.get(c.to) - 1);
      if (indeg.get(c.to) === 0 && !seen.has(c.to)) { seen.add(c.to); queue.push(c.to); }
    }
  }
  for (const id of ids) if (!seen.has(id)) order.push(id);
  return order;
}

function reportNodeLabel(type) {
  return { pump: "КНС", delay: "Участок сети", catch: "Водосбор" }[type] || type;
}

function reportNodeTitle(nd) {
  const name = (nd.data?.name || "").trim();
  return `${reportNodeLabel(nd.type)} #${nd.id}` + (name ? ` — ${name}` : "");
}

function reportNodeDescLine(nd) {
  const desc = (nd.data?.desc || "").trim();
  return desc ? [desc, ""] : [];
}

function gfComponentRows(gf, label) {
  const f = reportFmt;
  if (!gf) return [];
  if (gf.type === "hydrograph") {
    return [`| ${label} | гидрограф ВОДГЕО | Qr=${f(gf.Qr)} л/с, tr=${f(gf.tr)} мин, n=${f(gf.n)}, задержка=${f(gf.delay || 0)} мин |`];
  }
  if (gf.type === "piecewise") {
    const segs = gf.segments.map(s => `[${f(s.tStart)}–${f(s.tEnd)} мин: ${f(s.q)} л/с]`).join("; ");
    return [`| ${label} | кусочно-постоянная | задержка=${f(gf.delay || 0)} мин; ${segs} |`];
  }
  if (gf.t && gf.q) {
    return [`| ${label} | табличный ряд | ${gf.t.length} точек, ${f(gf.t[0])}–${f(gf.t[gf.t.length - 1])} мин |`];
  }
  return [`| ${label} | — | — |`];
}

function reportMethodCase(res) {
  const nh = res.hydroGFs?.length || 0, np = res.flowGFs?.length || 0;
  if (res.mode === "numeric") return "numeric";
  if (res.mode === "analytic" && !res.eq) return "segments";
  if (res.mode === "analytic" && np === 0 && nh <= 1) return "pure";
  return "approx";
}

function pumpResultsTable(res) {
  const f = reportFmt;
  const r = res.r;
  const rows = [
    "| Параметр | Значение |",
    "|---|---|",
  ];
  if (r.dry) {
    rows.push(`| Режим | Регулирование не требуется: приток никогда не превышает Qнс |`);
    rows.push(`| Wнс | 0 м³ |`);
  } else {
    rows.push(`| Tнⁿˢ | ${f(r.tn)} мин |`);
    rows.push(`| Tкⁿˢ | ${f(r.tk)} мин |`);
    rows.push(`| Wнс | ${f(r.W)} м³ |`);
  }
  if (r.truncated) rows.push(`| Примечание | Ряд притока обрезан до окончания откачки — результат занижен |`);
  if (res.approx) rows.push(`| Примечание | Приближение эквивалентным гидрографом (Qr*, tr* — пик суммарного входа) |`);
  return rows.join("\n");
}

function pumpIntermediateMD(res) {
  const f = reportFmt;
  const out = [];
  const method = reportMethodCase(res);
  const r = res.r;
  if (method === "pure" || method === "approx") {
    const { Qr, tr, n } = res.eq;
    if (method === "approx") {
      out.push(`Суммарный вход заменяется эквивалентным дождевым гидрографом: пик $Q_r^* = ${f(Qr)}\\ \\text{л/с}$ в момент $t_r^* = ${f(tr)}\\ \\text{мин}$, $n = ${f(n)}$.`);
    }
    if (r.dry) {
      out.push(`Так как $Q_{нс} = ${f(res.Q)} \\ge Q_r = ${f(Qr)}$ л/с, приток никогда не превышает производительность — регулирование не требуется.`);
    } else {
      for (const c of CARDS) out.push(`$$\n${c.tex(res.Q, Qr, tr, n, r)}\n$$`);
      const dly = res.ownRainGF?.delay || 0;
      if (dly > 0 && method === "pure") {
        out.push(`Гидрограф сдвинут участком сети на ${f(dly)} мин: Tнⁿˢ и Tкⁿˢ увеличены на величину задержки.`);
      }
    }
  } else if (method === "segments") {
    const trc = mixedAnalyticCalc(res.Q, res.hydroGFs, res.flowGFs, true);
    out.push("Разбиение оси времени на сегменты и накопление объёма:");
    out.push("");
    out.push("| Сегмент, мин | c, л/с | Qнс − c, л/с | Участок, мин | Приток > Qнс | ΔV, м³ | V, м³ |");
    out.push("|---|---|---|---|---|---|---|");
    for (const seg of trc.trace) {
      let first = true;
      for (const s of seg.subs) {
        const segCell = first ? `${f(seg.a)}–${f(seg.b)}` : "";
        const cCell = first ? f(seg.c) : "";
        const lCell = first ? f(seg.level) : "";
        out.push(`| ${segCell} | ${cCell} | ${lCell} | ${f(s.sa)}–${f(s.sb)} | ${s.above ? "да" : "нет"} | ${f(s.dV, 2)} | ${f(s.V, 2)} |`);
        first = false;
      }
    }
    out.push("");
    out.push(`V — накопленный объём с учётом осушения (обрезается нулём); Wнс = max V = ${f(trc.W)} м³.`);
  } else if (method === "numeric") {
    const dense = toDense(res.inflowGF, HYDRO_DT, durationGF(res.inflowGF));
    const rn = numericCalc(res.Q, dense, true);
    out.push(`Шаг моделирования Δt = ${f(HYDRO_DT)} мин, точек ряда: ${dense.t.length}. Окна заполнения резервуара:`);
    out.push("");
    if (rn.windows && rn.windows.length) {
      out.push("| Окно | Начало, мин | Конец, мин | max V, м³ |");
      out.push("|---|---|---|---|");
      rn.windows.forEach((w, i) => {
        out.push(`| ${i + 1} | ${f(w.start)} | ${f(w.end)} | ${f(w.maxV, 2)} |`);
      });
    } else {
      out.push("Окон заполнения нет — приток никогда не превышает Qнс.");
    }
  }
  return out.join("\n");
}

function pumpSectionMD(node, res, graph, results) {
  const f = reportFmt;
  const d = node.data || {};
  const out = [`## ${reportNodeTitle(node)}`, "", ...reportNodeDescLine(node)];
  if (d.disabled) {
    out.push("> **Нода отключена — в расчёте не участвует.** Расчёт для этой ноды не выполнялся; её входы и выходы игнорируются остальной схемой.", "");
    return out.join("\n");
  }
  if (!res) {
    out.push("_Расчёт не выполнен: проверьте параметры ноды (Qнс, Qr, tr должны быть > 0)._", "");
    return out.join("\n");
  }
  out.push("### Исходные данные", "");
  out.push("| Параметр | Значение |", "|---|---|");
  out.push(`| Производительность Qнс | ${f(res.Q)} л/с (${f(res.Q * 3.6)} м³/ч) |`);
  out.push(`| Откачка вне пика | ${f(res.idle)} % (${f(res.Q * res.idle / 100)} л/с) |`);
  out.push(`| Режим расчёта | ${res.mode === "numeric" ? "численный" : "аналитический"} |`);
  const srcNote = res.lockId ? ` (от ${res.lockIds?.length > 1 ? "водосборов" : "водосбора"} ${(res.lockIds || [res.lockId]).map(x => "#" + x).join(", ")})` : "";
  out.push(`| Собственный дождь | Qr=${f(res.Qr)} л/с, tr=${f(res.tr)} мин, n=${f(res.nEff)}${srcNote} |`);
  out.push("");
  const ups = reportUpstreams(node.id, graph.connections);
  const catchSrcs = ups.filter(u => results[u]?.fromCatch);
  const flowSrcs = ups.filter(u => results[u] && !results[u].fromCatch);
  const compRows = [];
  catchSrcs.forEach((u, i) => compRows.push(...gfComponentRows(results[u]?.gf || res.hydroGFs?.[i], `Водосбор/участок #${u}`)));
  flowSrcs.forEach((u, i) => compRows.push(...gfComponentRows(results[u]?.gf || res.flowGFs?.[i], `Выход КНС #${u}`)));
  if (!catchSrcs.length && res.ownRainGF) compRows.push(...gfComponentRows(res.ownRainGF, "Собственный дождь"));
  if (compRows.length) {
    out.push("### Состав входа", "");
    out.push("| Компонент | Тип | Параметры |", "|---|---|---|");
    out.push(...compRows);
    out.push("");
  }
  out.push("### Метод расчёта", "");
  const method = reportMethodCase(res);
  if (method === "pure") {
    out.push("Чистый дождь — точные формулы (1)–(3) Приложения 8 рекомендаций ВОДГЕО (как в одиночном расчёте).");
  } else if (method === "segments") {
    const nh = res.hydroGFs?.length || 0, np = res.flowGFs?.length || 0;
    const parts = [];
    if (nh) parts.push(`${nh} ${reportPlural(nh, "дождевой гидрограф", "дождевых гидрографа", "дождевых гидрографов")}`);
    if (np) parts.push(`${np} ${reportPlural(np, "кусочно-постоянный выход КНС", "кусочно-постоянных выхода КНС", "кусочно-постоянных выходов КНС")}`);
    out.push(`Точный аналитический расчёт по сегментам (${parts.join(" + ")}). На каждом сегменте кусочной функции приток — дождевой гидрограф, сдвинутый на константу c, поэтому точки пересечения находятся из формул (2)–(3) Приложения 8 с эффективным порогом Qнс − c:`);
    out.push("");
    out.push(`$$\nT_{н} = t_r\\left(\\frac{Q_{нс}-c}{Q_r}\\right)^{\\frac{1}{1-n}}, \\qquad Q_{нс}-c = Q_r\\left[\\left(\\frac{T_{к}}{t_r}\\right)^{1-n}-\\left(\\frac{T_{к}}{t_r}-1\\right)^{1-n}\\right]\n$$`);
    out.push("");
    out.push("Объёмы — точными интегралами по замкнутой первообразной гидрографа; между интервалами превышения резервуар осушается, уровень не уходит ниже нуля. Для суммы нескольких гидрографов пересечения ищутся подбором (бисекция) — тем же приёмом, что методичка предписывает для Tкⁿˢ.");
  } else if (method === "approx") {
    out.push("Вход содержит табличные ряды, для которых нет аналитических формул, поэтому суммарный приток заменяется эквивалентным дождевым гидрографом (Qr*, tr* — пик и момент пика суммы). Это приближение; для точного результата рекомендуется численный режим.");
  } else {
    out.push("Численный режим — пошаговое моделирование уровня резервуара:");
    out.push("");
    out.push(`$$\nV_{i+1} = \\max\\!\\left(0,\\; V_i + 0{,}06\\,\\frac{(Q_i - Q_{нс}) + (Q_{i+1} - Q_{нс})}{2}\\,\\Delta t\\right), \\qquad W_{нс} = \\max_i V_i\n$$`);
  }
  out.push("");
  out.push("### Промежуточные вычисления", "");
  out.push(pumpIntermediateMD(res));
  out.push("");
  out.push("### Результаты", "");
  out.push(pumpResultsTable(res));
  out.push("");
  return out.join("\n");
}

function catchSectionMD(node, res, n) {
  const f = reportFmt;
  const out = [`## ${reportNodeTitle(node)}`, "", ...reportNodeDescLine(node)];
  if (node.data?.disabled) {
    out.push("> **Нода отключена — в расчёте не участвует.** Расчёт для этой ноды не выполнялся.", "");
    return out.join("\n");
  }
  if (!res?.params) {
    out.push("_Расчёт не выполнен._", "");
    return out.join("\n");
  }
  const p = res.params;
  out.push("### Исходные данные", "");
  out.push("| Параметр | Значение |", "|---|---|");
  out.push(`| Площадь водосбора F | ${f(p.F)} га |`);
  out.push(`| q₂₀ | ${f(p.q20)} л/с·га |`);
  out.push(`| P | ${f(p.P, 1)} годы |`);
  out.push(`| mr | ${f(p.mr, 0)} |`);
  out.push(`| γ | ${f(p.gamma)} |`);
  out.push(p.variable ? `| z_mid (переменный коэфф. стока) | ${f(p.zMid, 3)} |` : `| Ψ_mid (постоянный коэфф. стока) | ${f(p.psiMid, 3)} |`);
  out.push(`| t_con | ${f(p.tcon, 0)} мин |`);
  out.push(`| t_can | ${f(p.tcan, 0)} мин |`);
  for (let i = 0; i < p.segs.length; i++) out.push(`| Участок сети ${i + 1} | l=${f(p.segs[i].l, 0)} м, v=${f(p.segs[i].v)} м/с |`);
  out.push("");
  out.push("### Расчёт", "");
  out.push(helpBlocksToMD(catchHelp(p)));
  out.push("");
  out.push("### Результат", "");
  out.push(`Qr = ${f(res.Qr)} л/с, tr = ${f(res.tr)} мин.`);
  out.push("");
  return out.join("\n");
}

function delaySectionMD(node) {
  const f = reportFmt;
  const d = node.data || {};
  const out = [`## ${reportNodeTitle(node)}`, "", ...reportNodeDescLine(node)];
  if (d.disabled) {
    out.push("> **Нода отключена — в расчёте не участвует.** Расчёт для этой ноды не выполнялся.", "");
    return out.join("\n");
  }
  const v = parseFloat(d.v), L = parseFloat(d.l ?? d.L);
  if (v > 0 && L >= 0) {
    out.push(`Задержка определяется длиной и скоростью протекания:`, "");
    out.push(`$$\n\\Delta t = \\frac{L}{60\\,v} = \\frac{${f(L, 0)}}{60\\cdot ${f(v)}} = ${f(L / v / 60)}\\ \\text{мин}\n$$`);
  } else {
    out.push(`Задержка задана вручную: Δt = ${f(parseFloat(d.dt) || 0)} мин.`);
  }
  out.push("");
  out.push("Нода сдвигает входной гидрограф по времени на Δt.");
  out.push("");
  return out.join("\n");
}

function reportHeaderMD(meta, titleSuffix = "") {
  const out = [`# Обоснование расчёта${titleSuffix}`, ""];
  const fields = [
    ["Название", meta?.title], ["Объект", meta?.object], ["Автор", meta?.author],
    ["Организация", meta?.organization], ["E-mail", meta?.email],
    ["Дата проекта", meta?.date], ["Описание", meta?.description],
  ];
  for (const [k, v] of fields) if (v) out.push(`**${k}:** ${v}`, "");
  if (Array.isArray(meta?.custom)) {
    for (const c of meta.custom) if (c.key) out.push(`**${c.key}:** ${c.value || ""}`, "");
  }
  out.push(`**Дата формирования отчёта:** ${new Date().toLocaleString("ru-RU")}`, "");
  return out.join("\n");
}

function reportMermaidMD(graph) {
  const out = ["```mermaid", "graph TD"];
  const ids = graph.nodes.map(n => n.id).sort((a, b) => a - b);
  for (const id of ids) {
    const nd = graph.nodes.find(n => n.id === id);
    let label = `${reportNodeLabel(nd.type)} #${nd.id}`;
    const name = (nd.data?.name || "").trim().replace(/"/g, "'");
    const desc = (nd.data?.desc || "").trim().replace(/"/g, "'");
    if (name) label += `<br/>${name}`;
    if (desc) label += `<br/>${desc}`;
    out.push(`  N${id}["${label}"]`);
  }
  for (const c of graph.connections) out.push(`  N${c.from} --> N${c.to}`);
  const dis = graph.nodes.filter(n => n.data?.disabled).map(n => `N${n.id}`);
  if (dis.length) {
    out.push("  classDef disabled fill:#f5f5f5,stroke:#999,stroke-dasharray:5 5,color:#777;");
    out.push(`  class ${dis.join(",")} disabled;`);
  }
  out.push("```");
  return out.join("\n");
}

function reportSchemeMD(graph, n) {
  const out = ["## Схема", ""];
  out.push(reportMermaidMD(graph), "");
  out.push("| # | Тип | Имя | Ключевые параметры |", "|---|---|---|---|");
  for (const nd of graph.nodes) {
    const d = nd.data || {};
    let params = "";
    if (nd.type === "pump") params = `Qнс=${reportFmt(d.q)} л/с, Qr=${reportFmt(d.qr)} л/с, tr=${reportFmt(d.tr)} мин, режим: ${d.mode === "numeric" ? "числ." : "аналит."}`;
    else if (nd.type === "catch") params = `F=${reportFmt(d.F)} га, q20=${reportFmt(d.q20)} л/с/га`;
    else if (nd.type === "delay") params = `L=${reportFmt(d.l ?? d.L)} м, v=${reportFmt(d.v)} м/с`;
    const disabled = d.disabled ? " **(отключена — расчёт не выполняется)**" : "";
    const title = (d.name || "").trim() + ((d.desc || "").trim() ? ` — ${(d.desc || "").trim()}` : "");
    out.push(`| ${nd.id} | ${reportNodeLabel(nd.type)} | ${title || "—"} | ${params}${disabled} |`);
  }
  out.push("");
  if (graph.connections.length) {
    out.push(`**Связи:** ${graph.connections.map(c => `#${c.from} → #${c.to}`).join(", ")}`, "");
  }
  out.push(`**Общий климатический параметр:** n = ${reportFmt(n)}; **шаг дискретизации рядов:** Δt = ${reportFmt(HYDRO_DT)} мин.`, "");
  return out.join("\n");
}

function nodeSectionMD(node, graph, results, n) {
  const res = results[node.id];
  if (node.type === "catch") return catchSectionMD(node, res, n);
  if (node.type === "delay") return delaySectionMD(node);
  if (node.type === "pump") return pumpSectionMD(node, res, graph, results);
  return "";
}

function reportSchemeJsonMD(payload) {
  return [
    "## Приложение. Код схемы (JSON)", "",
    "Экспортируемый JSON схемы — его можно сохранить в файл и загрузить обратно через кнопку «Импорт»:", "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

function nodePayload(payload, nodeId) {
  if (!payload) return null;
  const id = +nodeId;
  return {
    ...payload,
    nodes: (payload.nodes || []).filter(n => n.id === id),
    connections: (payload.connections || []).filter(c => c.from === id || c.to === id),
  };
}

function buildReportMD(graph, results, ctx = {}) {
  const out = [reportHeaderMD(ctx.meta)];
  out.push(reportSchemeMD(graph, ctx.n));
  out.push("## Методика расчёта", "");
  out.push(helpBlocksToMD(CASCADE_HELP), "");
  for (const id of topoNodeOrder(graph.nodes, graph.connections)) {
    const node = graph.nodes.find(nd => nd.id === id);
    out.push(nodeSectionMD(node, graph, results, ctx.n));
  }
  if (ctx.payload) out.push(reportSchemeJsonMD(ctx.payload));
  return out.join("\n");
}

function buildNodeReportMD(nodeId, graph, results, ctx = {}) {
  const node = graph.nodes.find(nd => nd.id === +nodeId);
  if (!node) return "";
  const out = [reportHeaderMD(ctx.meta, ` — ${reportNodeTitle(node)}`)];
  out.push(nodeSectionMD(node, graph, results, ctx.n));
  const np = nodePayload(ctx.payload, nodeId);
  if (np) out.push(reportSchemeJsonMD(np));
  return out.join("\n");
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

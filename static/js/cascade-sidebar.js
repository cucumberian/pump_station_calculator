"use strict";

function seriesFromResult(res) {
  if (!res) return null;
  return res.series || (res.gf ? toDense(res.gf, HYDRO_DT, globalTMax || undefined) : null);
}

function inflowFromResult(res) {
  if (!res) return null;
  return res.inflowGF ? toDense(res.inflowGF, HYDRO_DT, globalTMax || undefined) : seriesFromResult(res);
}

function setTitle(typeLabel) {
  const node = editor.getNodeFromId(sbNodeId);
  const name = node?.data?.name?.trim();
  $c("sbTitle").textContent = name ? `${name} · ${typeLabel}` : typeLabel;
}

const SB_CATCH_MAP = {
  sbCF: "F", sbCQ20: "q20", sbCP: "P", sbCMr: "mr", sbCGamma: "gamma",
  sbCPsi: "psiMid", sbCZ: "zMid", sbCTcon: "tcon", sbCTcan: "tcan",
  sbCL1: "l1", sbCV1: "v1", sbCL2: "l2", sbCV2: "v2", sbCL3: "l3", sbCV3: "v3",
};

const SB_LOCK_INPUTS = ["sbQr", "sbTr", "sbQ", "sbQm3h", "sbQrange", "sbIdle", "sbV", "sbL"];

function renderNodeMeta(node) {
  const d = node.data || {};
  if (document.activeElement !== $c("sbName")) {
    $c("sbName").value = d.name || "";
    $c("sbName").placeholder = NODE_TYPE_LABEL[node.name] || "";
  }
  if (document.activeElement !== $c("sbDesc")) $c("sbDesc").value = d.desc || "";
  checkNameDuplicate(node);
}

function checkNameDuplicate(node) {
  const warn = $c("sbNameWarn");
  if (node.name !== "pump") { warn.hidden = true; return; }
  const name = (node.data?.name || "").trim();
  if (!name) { warn.hidden = true; return; }
  const dup = Object.entries(graphData()).some(([id, nd]) =>
    String(id) !== String(sbNodeId) && nd.name === "pump" && (nd.data?.name || "").trim() === name);
  warn.hidden = !dup;
}

function renderCatchSidebar(node) {
  setTitle(`Водосбор · нода #${sbNodeId}`);
  $c("sbCatch").hidden = false;
  $c("sbDelay").hidden = true;
  $c("sbEmpty").hidden = true;
  $c("sbContent").hidden = true;
  hidePumpSections();
  const d = node.data || {};
  for (const [elId, key] of Object.entries(SB_CATCH_MAP)) {
    const el = $c(elId);
    if (document.activeElement !== el) el.value = d[key];
  }
  for (const rb of document.querySelectorAll('input[name="sbCCoeff"]')) {
    rb.checked = rb.value === (d.coeffMode === "const" ? "const" : "variable");
  }
  const res = results[sbNodeId];
  $c("sbCOut").innerHTML = res
    ? `Q<sub>r</sub> = ${fmt(res.Qr, 2)} л/с <br> t<sub>r</sub> = ${fmt(res.tr, 2)} мин`
    : "задайте корректные параметры";
  $c("sbCatchChartWrap").hidden = !res;
  if (res) catchChart.update(seriesFromResult(res), res.Qr, res.tr);
  applySidebarLock();
  applySidebarDisable();
}

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

function applySidebarDisable() {
  const isDisabled = sbNodeId !== null && nodeDisabled(sbNodeId);
  const btn = $c("sbDisableBtn");
  btn.classList.toggle("active", isDisabled);
  btn.innerHTML = isDisabled ? DISABLE_ON_SVG : DISABLE_OFF_SVG;
  btn.title = isDisabled ? "Включить ноду" : "Отключить ноду";
}

function showPumpSections() {
  for (const id of ["sbParams", "sbInflowSection", "sbResultsSection", "sbWqSection", "sbVariantsSection"]) {
    $c(id).hidden = false;
  }
}
function hidePumpSections() {
  for (const id of ["sbParams", "sbInflowSection", "sbResultsSection", "sbWqSection", "sbVariantsSection"]) {
    $c(id).hidden = true;
  }
}

function renderDelaySidebar(node) {
  setTitle(`Участок сети · нода #${sbNodeId}`);
  $c("sbDelay").hidden = false;
  $c("sbCatch").hidden = true;
  $c("sbEmpty").hidden = true;
  $c("sbContent").hidden = true;
  hidePumpSections();
  const d = node.data || {};
  if (document.activeElement !== $c("sbV")) $c("sbV").value = d.v;
  if (document.activeElement !== $c("sbL")) $c("sbL").value = d.l;
  const dt = delayDt(d);
  $c("sbDt").textContent = `Δt = L / (60·v) = ${fmt(dt, 1)} мин`;
  const srcs = upstreamIds(sbNodeId, graphData()).map(u => results[u]).filter(Boolean);
  const out = results[sbNodeId];
  const has = !!(srcs.length && out);
  $c("sbDelayChartWrap").hidden = !has;
  $c("sbDelayEmpty").hidden = has;
  if (has) {
    const inSeries = srcs.length === 1 ? seriesFromResult(srcs[0]) : combineSeries(srcs.map(s => seriesFromResult(s)));
    delayChart.update(dt, inSeries, seriesFromResult(out));
  }
  applySidebarLock();
  applySidebarDisable();
}

function renderSidebar() {
  if (sbNodeId === null) return;
  const node = editor.getNodeFromId(sbNodeId);
  if (!node) return;
  renderNodeMeta(node);
  if (node.name === "delay") { renderDelaySidebar(node); return; }
  if (node.name === "catch") { renderCatchSidebar(node); return; }
  $c("sbDelay").hidden = true;
  $c("sbCatch").hidden = true;
  const res = results[sbNodeId];
  setTitle(`Насосная станция · нода #${sbNodeId}`);
  if (!node || !res) {
    $c("sbEmpty").hidden = false;
    $c("sbContent").hidden = true;
    hidePumpSections();
    return;
  }
  $c("sbEmpty").hidden = true;
  $c("sbContent").hidden = false;
  showPumpSections();

  if (document.activeElement !== $c("sbQr")) $c("sbQr").value = Number(res.Qr).toFixed(2);
  if (document.activeElement !== $c("sbTr")) $c("sbTr").value = Number(res.tr).toFixed(2);
  $c("sbQr").disabled = !!res.lockId;
  $c("sbTr").disabled = !!res.lockId;
  const sbQrTrPair = $c("sbParams")?.querySelector(".sb-pair");
  if (sbQrTrPair) sbQrTrPair.classList.toggle("sb-locked", !!res.lockId);
  $c("sbLock").hidden = !res.lockId;
  if (res.lockId) {
    const ids = (res.lockIds?.length ? res.lockIds : [res.lockId]).map(x => `#${x}`).join(", ");
    $c("sbLockSrc").textContent = ids;
    $c("sbLockMulti").hidden = !(res.lockIds?.length > 1);
  }
  if (document.activeElement !== $c("sbQ")) $c("sbQ").value = res.Q;
  if (document.activeElement !== $c("sbQm3h")) $c("sbQm3h").value = +(res.Q * 3.6).toFixed(1);
  const inflowSeries = inflowFromResult(res);
  const qMax = seriesPeak(inflowSeries).q;
  const rg = $c("sbQrange");
  rg.max = Math.ceil(qMax);
  if (document.activeElement !== rg) rg.value = Math.min(res.Q, qMax);
  if (document.activeElement !== $c("sbIdle")) $c("sbIdle").value = res.idle;
  for (const rb of document.querySelectorAll('input[name="sbMode"]')) {
    rb.checked = rb.value === res.mode;
  }
  $c("sbApprox").hidden = !res.approx;
  $c("sbTrunc").hidden = !res.r.truncated;

  const data = graphData();
  const ownLabel = res.lockIds?.length > 1
    ? `Водосборы ${res.lockIds.map(x => `#${x}`).join(", ")}`
    : res.lockId ? `Водосбор #${res.lockId}` : "Дождь (собственный)";
  const ownSeries = res.ownRainGF ? toDense(res.ownRainGF, HYDRO_DT, globalTMax || undefined) : res.ownRain;
  const comps = [{ label: ownLabel, series: ownSeries }];
  for (const x of upstreamIds(sbNodeId, data)
    .map(u => ({ nd: data[u], r: results[u] }))
    .filter(x => x.r && !x.r.fromCatch)) {
    comps.push({ label: `${NODE_LABEL[x.nd.name]} #${x.nd.id}`, series: seriesFromResult(x.r) });
  }
  inflowChart.update(res.Q, res.r, inflowSeries, comps, seriesFromResult(res), false);

  const numeric = res.mode === "numeric" || !res.eq;
  if (numeric) {
    const note = res.mode === "numeric" ? undefined : "аналитически по сегментам суммарного притока";
    buildCards($c("sbCards"), res.Q, 0, 0, 0, res.r, true, note);
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
  if ($c("sbFitAxis").classList.contains("active") && from > 0 && to > from) {
    sbWqChart.inner.setXRange(Math.max(0, from), to);
  }
  fillVariants($c("sbVariants").querySelector("tbody"), res.Q, from, to, step, fn);
  applySidebarLock();
  applySidebarDisable();
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
  requestAnimationFrame(() => EC_REGISTRY.forEach(c => c.resize()));
  const res = results[id];
  const inflowRes = res?.inflowGF ? toDense(res.inflowGF, HYDRO_DT, globalTMax || undefined) : res?.inflow;
  if (inflowRes) {
    const qMax = seriesPeak(inflowRes).q;
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

$c("sbLockBtn").addEventListener("click", () => {
  if (sbNodeId !== null) syncNodeParam(sbNodeId, "locked", !nodeLocked(sbNodeId));
});
$c("sbDisableBtn").addEventListener("click", () => {
  if (sbNodeId !== null) syncNodeParam(sbNodeId, "disabled", !nodeDisabled(sbNodeId));
});
$c("sbMetaToggle").addEventListener("click", () => {
  $c("sbNodeMeta").classList.toggle("open");
});
$c("sbMetaToggle").addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $c("sbNodeMeta").classList.toggle("open"); }
});
$c("sbClose").addEventListener("click", closeSidebar);
$c("sbName").addEventListener("input", () => {
  if (sbNodeId === null) return;
  const nd = editor.getNodeFromId(sbNodeId);
  if (!nd) return;
  editor.updateNodeDataFromId(sbNodeId, { ...nd.data, name: $c("sbName").value });
  computeCascade();
});
$c("sbDesc").addEventListener("input", () => {
  if (sbNodeId === null) return;
  const nd = editor.getNodeFromId(sbNodeId);
  if (!nd) return;
  editor.updateNodeDataFromId(sbNodeId, { ...nd.data, desc: $c("sbDesc").value });
  saveScheme();
});
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
$c("sbFitAxis").addEventListener("click", () => {
  $c("sbFitAxis").classList.toggle("active");
  renderSidebar();
});

function fmtGF(gf, label) {
  const f = v => Number.isFinite(v) ? +v.toFixed(2) : v;
  let html = `<div class="gf-entry"><span class="gf-label">${label}</span> `;
  if (!gf) { html += `<span class="gf-na">нет данных</span></div>`; return html; }
  if (gf.type === "hydrograph") {
    html += `<span class="gf-type">Гидрограф</span>
      <div class="gf-params">Qr = ${f(gf.Qr)} л/с, tr = ${f(gf.tr)} мин, n = ${gf.n}</div>
      <div class="gf-dur">длительность: ${f(durationGF(gf))} мин</div>`;
    if (gf.delay) html += `<div class="gf-params">сдвиг: +${f(gf.delay)} мин</div>`;
  } else if (gf.type === "piecewise") {
    html += `<span class="gf-type">Кусочно-постоянная</span><div class="gf-segments">`;
    for (const seg of gf.segments) {
      html += `<span class="gf-seg">[${f(seg.tStart)}; ${f(seg.tEnd)}) → ${f(seg.q)} л/с</span>`;
    }
    html += `</div>`;
    const last = gf.segments[gf.segments.length - 1];
    html += `<div class="gf-dur">длительность: ${f((gf.delay||0) + last.tEnd)} мин</div>`;
    if (gf.delay) html += `<div class="gf-params">сдвиг: +${f(gf.delay)} мин</div>`;
  } else if (gf.type === "dense") {
    html += `<span class="gf-type">Набор точек</span>
      <div class="gf-params">точек: ${gf.t.length}</div>
      <div class="gf-dur">от ${f(gf.t[0])} до ${f(gf.t[gf.t.length-1])} мин</div>`;
  } else {
    html += `<span class="gf-type">Неизвестный тип</span></div>`;
    return html;
  }
  return html + "</div>";
}

function showGFInfo(nodeId) {
  const f = v => Number.isFinite(v) ? +v.toFixed(2) : v;
  const data = graphData();
  const nd = data[nodeId];
  const res = results[nodeId];
  if (!nd || !res) { $c("gfModal").hidden = false; $c("gfNodeTitle").textContent = "—"; $c("gfContent").innerHTML = '<p class="gf-na">Нода не найдена</p>'; return; }
  $c("gfNodeTitle").textContent = `${NODE_LABEL[nd.name] || nd.name} #${nodeId}`;
  let html = "";
  const upstreams = upstreamIds(nodeId, data);
  if (upstreams.length) {
    html += `<div class="gf-section gf-section-in"><h3>Входы</h3>`;
    for (const uid of upstreams) {
      const uNd = data[uid];
      const uRes = results[uid];
      const label = `${NODE_LABEL[uNd?.name] || "?"} #${uid}`;
      html += fmtGF(uRes?.gf || null, label);
    }
    html += `</div>`;
  }
  if (res.ownRainGF) {
    html += `<div class="gf-section gf-section-in"><h3>Собственный гидрограф</h3>${fmtGF(res.ownRainGF, "")}</div>`;
  }
  if (res.inflowGF) {
    html += `<div class="gf-section gf-section-in"><h3>Суммарный вход</h3>${fmtGF(res.inflowGF, upstreams.length || res.ownRainGF ? "Σ" : "")}</div>`;
  }
  if (res.gf) {
    let outLabel = "";
    if (res.mode === "analytic" && res.eq) outLabel = `Аналит. Qr=${f(res.eq.Qr)} tr=${f(res.eq.tr)}`;
    else if (res.mode === "analytic") outLabel = "Аналит. по сегментам";
    else if (res.mode === "numeric") outLabel = "Численный";
    if (outLabel) outLabel = ` (${outLabel})`;
    html += `<div class="gf-section gf-section-out"><h3>Выход${outLabel}</h3>${fmtGF(res.gf, "")}</div>`;
  }
  $c("gfContent").innerHTML = html || '<p class="gf-na">Нет данных о функциях для этой ноды</p>';
  $c("gfModal").hidden = false;
}

$c("sbGFBtn").addEventListener("click", () => {
  if (sbNodeId !== null) showGFInfo(sbNodeId);
});
$c("gfClose").addEventListener("click", () => { $c("gfModal").hidden = true; });
$c("gfModal").addEventListener("click", e => {
  if (e.target === $c("gfModal")) $c("gfModal").hidden = true;
});

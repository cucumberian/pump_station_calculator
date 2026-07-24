"use strict";

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
  $c("sbCOut").innerHTML = res
    ? `Q<sub>r</sub> = ${fmt(res.Qr, 2)} л/с <br> t<sub>r</sub> = ${fmt(res.tr, 2)} мин`
    : "задайте корректные параметры";
  applySidebarLock();
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
  const srcs = upstreamIds(sbNodeId, graphData()).map(u => results[u]).filter(Boolean);
  const out = results[sbNodeId];
  const has = !!(srcs.length && out);
  $c("sbDelayChartWrap").hidden = !has;
  $c("sbDelayEmpty").hidden = has;
  if (has) {
    const inSeries = srcs.length === 1 ? srcs[0].series : combineSeries(srcs.map(s => s.series));
    delayChart.update(dt, inSeries, out.series);
  }
  applySidebarLock();
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
  $c("sbTitle").textContent = `Насосная станция · нода #${sbNodeId}`;
  if (!node || !res) {
    $c("sbEmpty").hidden = false;
    $c("sbContent").hidden = true;
    return;
  }
  $c("sbEmpty").hidden = true;
  $c("sbContent").hidden = false;

  if (document.activeElement !== $c("sbQr")) $c("sbQr").value = Number(res.Qr).toFixed(2);
  if (document.activeElement !== $c("sbTr")) $c("sbTr").value = Number(res.tr).toFixed(2);
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

$c("sbLockBtn").addEventListener("click", () => {
  if (sbNodeId !== null) syncNodeParam(sbNodeId, "locked", !nodeLocked(sbNodeId));
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

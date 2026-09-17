"use strict";

function plural(n, one, few, many) {
  return n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
}

function renderAnchors(res) {
  // Опорные точки ресемплинга: точные вершины в tn/tk, иначе ломаная
  // пересекает уровень Qнс визуально сдвинутой от расчётных маркеров.
  const r = res?.r;
  return !r || r.dry ? [] : [r.tn, r.tk].filter(t => Number.isFinite(t));
}

function seriesFromResult(res) {
  if (!res) return null;
  // только для графиков — ряды в десятки тысяч точек ресемплим с сохранением пиков
  const anchored = res?.r != null;
  return resampleForDisplay(res.series || (res.gf ? toDense(res.gf, HYDRO_DT, globalTMax || undefined) : null),
    CHART_MAX_POINTS, anchored ? renderAnchors(res) : []);
}

function inflowFromResult(res) {
  if (!res) return null;
  const dense = res.inflowGF ? toDense(res.inflowGF, HYDRO_DT, globalTMax || undefined) : seriesFromResult(res);
  return resampleForDisplay(dense, CHART_MAX_POINTS, renderAnchors(res));
}

function setTitle(typeLabel) {
  const node = editor.getNodeFromId(sbNodeId);
  const name = node?.data?.name?.trim();
  $c("sbTitle").textContent = name ? `${name} · ${typeLabel}` : typeLabel;
}

// Значения в полях ввода форматирует padNum (calc-view.js): не менее двух
// знаков после запятой, точность исходного числа не режем.
const SB_CATCH_MAP = {
  sbCF: "F", sbCQ20: "q20", sbCP: "P", sbCMr: "mr", sbCGamma: "gamma",
  sbCPsi: "psiMid", sbCZ: "zMid", sbCTcon: "tcon", sbCTcan: "tcan", sbCTp: "tp",
};

// t1 и t2 намеренно вне карты: пустые поля — легальные значения «с начала» и
// «до конца события», привязка у них отдельная (см. ниже).
const SB_FLOW_MAP = { sbFQ: "q" };

const SB_LOCK_INPUTS = ["sbQr", "sbTr", "sbQ", "sbQm3h", "sbQrange", "sbIdle", "sbV", "sbL", "sbD", "sbFQ", "sbFT1", "sbFT2"];

// Поле параметра для отображения: на заблокированной ноде показываем СВОИ
// значения инженера (персистентные data ноды), а не переписанные расчётом.
// Работает для любых параметров — сейчас расчёт переписывает только qr/tr насоса.
function displayParam(node, res, key) {
  return node?.data?.locked && node.data[key] != null ? node.data[key] : res[key === "qr" ? "Qr" : "tr"];
}

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
  $c("sbFlow").hidden = true;
  $c("sbEmpty").hidden = true;
  $c("sbContent").hidden = true;
  hidePumpSections();
  const d = node.data || {};
  const table = d.coeffSource === "table";
  for (const [elId, key] of Object.entries(SB_CATCH_MAP)) {
    const el = $c(elId);
    if (document.activeElement === el) continue;
    // F/z_mid/ψ_mid в режиме «по составу» — производные, их заполним ниже.
    if (table && (elId === "sbCF" || elId === "sbCZ" || elId === "sbCPsi")) continue;
    el.value = padNum(d[key]);
  }
  for (const rb of document.querySelectorAll('input[name="sbCCoeff"]')) {
    rb.checked = rb.value === (d.coeffMode === "const" ? "const" : "variable");
  }
  for (const rb of document.querySelectorAll('input[name="sbCSource"]')) {
    rb.checked = rb.value === (table ? "table" : "manual");
  }
  $c("sbSurfBlock").hidden = !table;
  $c("sbCF").readOnly = table;
  $c("sbCZ").readOnly = table;
  $c("sbCPsi").readOnly = table;
  renderSegList("sbSegList", "segs", d.segs);
  renderSegList("sbTrayList", "trays", d.trays);
  renderSurfList(table ? d.zRows : []);
  const res = results[sbNodeId];
  const p = res?.params;
  if (table && p) {
    const rd = (v, d) => Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v;
    if (document.activeElement !== $c("sbCF")) $c("sbCF").value = padNum(rd(p.F, 3));
    if (document.activeElement !== $c("sbCZ")) $c("sbCZ").value = padNum(rd(p.zMid, 4));
    if (document.activeElement !== $c("sbCPsi")) $c("sbCPsi").value = padNum(rd(p.psiMid, 4));
  }
  const note = $c("sbSurfNote");
  if (table && p) {
    const parts = [`ΣF = ${fmt(p.areaSum, 2)} га`];
    if (p.surfaces.some(s => s.type === "imp")) parts.push(`z водонепроницаемых по Ж.7 = ${fmt(p.zImpAuto.z, 3)}`);
    if (p.areaOver) parts.push(`<span class="warn">площадь > 150 га</span>`);
    note.innerHTML = parts.join(" · ");
    note.hidden = false;
  } else {
    note.hidden = true;
  }
  $c("sbCOut").innerHTML = res
    ? `Q<sub>r</sub> = ${fmt(res.Qr, 2)} л/с <br> t<sub>r</sub> = ${fmt(res.tr, 2)} мин`
    : "задайте корректные параметры";
  $c("sbCatchChartWrap").hidden = !res;
  if (res) catchChart.update(seriesFromResult(res), res.Qr, res.tr);
  applySidebarLock();
  applySidebarDisable();
}

// Две строки-списка участков (сеть/лоток) в панели водосбора. DOM
// перестраиваем только при смене ноды или числа строк: иначе перерисовка
// панели после каждого ввода сбрасывала бы фокус и каретку.
const segListState = {};
function segSub(i) {
  const subs = "₁₂₃₄₅₆₇₈₉";
  return i < subs.length ? subs[i] : String(i + 1);
}
function renderSegList(containerId, key, arr) {
  const box = $c(containerId);
  if (!box) return;
  const list = Array.isArray(arr) ? arr : [];
  const st = segListState[containerId];
  if (!st || st.nodeId !== sbNodeId || st.len !== list.length) {
    box.innerHTML = "";
    list.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "seg-row";
      row.dataset.list = key;
      row.dataset.idx = String(i);
      row.innerHTML =
        `<input type="number" step="any" min="0" data-field="l" data-step="10" placeholder="l${segSub(i)}" title="длина участка ${i + 1}, м">` +
        `<input type="number" step="any" min="0" data-field="v" data-step="0.1" placeholder="v${segSub(i)}" title="скорость на участке ${i + 1}, м/с">` +
        `<button class="seg-del" type="button" title="Удалить участок">×</button>`;
      box.appendChild(row);
    });
    segListState[containerId] = { nodeId: sbNodeId, len: list.length };
  }
  box.querySelectorAll(".seg-row").forEach((row, i) => {
    const s = list[i] || {};
    for (const field of ["l", "v"]) {
      const inp = row.querySelector(`input[data-field="${field}"]`);
      if (inp && document.activeElement !== inp) {
        const v = parseFloat(s[field]);
        inp.value = Number.isFinite(v) ? padNum(v) : "";
      }
    }
  });
}

function segListContext(el) {
  const row = el?.closest?.(".seg-row");
  if (!row) return null;
  return { idx: parseInt(row.dataset.idx, 10), key: row.dataset.list, containerId: row.parentElement?.id };
}
function updateSegList(key, mut) {
  if (sbNodeId === null) return;
  const d = editor.getNodeFromId(sbNodeId)?.data || {};
  const list = Array.isArray(d[key]) ? d[key].map(s => ({ ...s })) : [];
  mut(list);
  syncNodeParam(sbNodeId, key, list);
}

for (const containerId of ["sbSegList", "sbTrayList"]) {
  const box = $c(containerId);
  if (!box) continue;
  box.addEventListener("input", e => {
    const inp = e.target.closest("input[data-field]");
    if (!inp) return;
    const ctx = segListContext(inp);
    if (!ctx || ctx.idx < 0) return;
    const raw = inp.value.trim();
    const v = raw === "" ? "" : parseFloat(raw);
    updateSegList(ctx.key, list => {
      if (!list[ctx.idx]) return;
      list[ctx.idx][inp.dataset.field] = Number.isFinite(v) ? v : "";
    });
  });
  box.addEventListener("click", e => {
    const del = e.target.closest(".seg-del");
    if (!del) return;
    e.stopPropagation();
    const ctx = segListContext(del);
    if (!ctx || ctx.idx < 0) return;
    updateSegList(ctx.key, list => { list.splice(ctx.idx, 1); });
    if (segListState[ctx.containerId]) segListState[ctx.containerId].len = -1;
  });
}
for (const [btnId, key] of [["sbSegAdd", "segs"], ["sbTrayAdd", "trays"]]) {
  $c(btnId).addEventListener("click", e => {
    e.stopPropagation();
    if (sbNodeId === null) return;
    updateSegList(key, list => { list.push({ l: "", v: "" }); });
    const containerId = key === "segs" ? "sbSegList" : "sbTrayList";
    if (segListState[containerId]) segListState[containerId].len = -1;
  });
}

// Список поверхностей стока (режим «по составу»): вид + площадь Fᵢ, для
// водонепроницаемых — необязательное поле z (пусто = авто по Ж.7).
function surfSig(list) {
  return list.map(s => s?.type || "").join("|");
}
function renderSurfList(arr) {
  const box = $c("sbSurfList");
  if (!box) return;
  const list = Array.isArray(arr) ? arr : [];
  const st = segListState["sbSurfList"];
  const sig = surfSig(list);
  if (!st || st.nodeId !== sbNodeId || st.len !== list.length || st.sig !== sig) {
    box.innerHTML = "";
    list.forEach((s, i) => {
      const type = SURFACE_BY_KEY[s?.type] ? s.type : "imp";
      const opts = SURFACE_TYPES.map(t => `<option value="${t.key}"${t.key === type ? " selected" : ""}>${t.label}</option>`).join("");
      const row = document.createElement("div");
      row.className = "seg-row surf-row";
      row.dataset.list = "zRows";
      row.dataset.idx = String(i);
      row.innerHTML =
        `<select data-field="type" title="вид поверхности стока">${opts}</select>` +
        `<input type="number" step="any" min="0" data-field="F" data-step="0.1" placeholder="F${segSub(i)}" title="площадь поверхности ${i + 1}, га">` +
        (type === "imp"
          ? `<input type="number" step="any" min="0" data-field="z" data-step="0.01" placeholder="z авто" title="z водонепроницаемых; пусто — авто по Ж.7">`
          : "") +
        `<button class="seg-del" type="button" title="Удалить поверхность">×</button>`;
      box.appendChild(row);
    });
    segListState["sbSurfList"] = { nodeId: sbNodeId, len: list.length, sig };
  }
  box.querySelectorAll(".surf-row").forEach((row, i) => {
    const s = list[i] || {};
    const fEl = row.querySelector('input[data-field="F"]');
    if (fEl && document.activeElement !== fEl) {
      const v = parseFloat(s.F);
      fEl.value = Number.isFinite(v) ? padNum(v) : "";
    }
    const zEl = row.querySelector('input[data-field="z"]');
    if (zEl && document.activeElement !== zEl) {
      const v = parseFloat(s.z);
      zEl.value = Number.isFinite(v) ? padNum(v) : "";
    }
  });
}
function forceSurfRebuild() {
  if (segListState["sbSurfList"]) segListState["sbSurfList"].len = -1;
}
{
  const box = $c("sbSurfList");
  box.addEventListener("input", e => {
    const inp = e.target.closest('input[data-field]');
    if (!inp) return;
    const ctx = segListContext(inp);
    if (!ctx || ctx.idx < 0) return;
    const raw = inp.value.trim();
    const v = raw === "" ? "" : parseFloat(raw);
    updateSegList("zRows", list => {
      if (!list[ctx.idx]) return;
      list[ctx.idx][inp.dataset.field] = Number.isFinite(v) ? v : "";
    });
  });
  box.addEventListener("change", e => {
    const sel = e.target.closest('select[data-field="type"]');
    if (!sel) return;
    const ctx = segListContext(sel);
    if (!ctx || ctx.idx < 0) return;
    updateSegList("zRows", list => {
      if (!list[ctx.idx]) return;
      list[ctx.idx].type = sel.value;
      if (sel.value !== "imp") list[ctx.idx].z = "";
    });
    forceSurfRebuild();
    if (typeof flushCascade === "function") flushCascade();
  });
  box.addEventListener("click", e => {
    const del = e.target.closest(".seg-del");
    if (!del) return;
    e.stopPropagation();
    const ctx = segListContext(del);
    if (!ctx || ctx.idx < 0) return;
    updateSegList("zRows", list => { list.splice(ctx.idx, 1); });
    forceSurfRebuild();
  });
}
$c("sbSurfAdd").addEventListener("click", e => {
  e.stopPropagation();
  if (sbNodeId === null) return;
  updateSegList("zRows", list => { list.push({ type: "imp", F: "", z: "" }); });
  forceSurfRebuild();
});
for (const rb of document.querySelectorAll('input[name="sbCSource"]')) {
  rb.addEventListener("change", () => {
    if (sbNodeId === null || !rb.checked) return;
    syncNodeParam(sbNodeId, "coeffSource", rb.value);
  });
}

function applySidebarLock() {
  const isLocked = sbNodeId !== null && nodeLocked(sbNodeId);
  const btn = $c("sbLockBtn");
  btn.classList.toggle("active", isLocked);
  btn.innerHTML = isLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
  btn.title = isLocked ? "Разблокировать параметры" : "Заблокировать параметры";
  for (const id of [...SB_LOCK_INPUTS, ...Object.keys(SB_CATCH_MAP), ...Object.keys(SB_FLOW_MAP)]) {
    const el = $c(id);
    if (el) el.disabled = isLocked;
  }
  for (const rb of document.querySelectorAll('input[name="sbMode"], input[name="sbCCoeff"], input[name="sbCSource"]')) {
    rb.disabled = isLocked;
  }
  for (const box of document.querySelectorAll("#sbSegList, #sbTrayList, #sbSurfList")) {
    for (const el of box.querySelectorAll("input, select, button")) el.disabled = isLocked;
  }
  $c("sbSegAdd").disabled = isLocked;
  $c("sbTrayAdd").disabled = isLocked;
  $c("sbSurfAdd").disabled = isLocked;
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
  $c("sbFlow").hidden = true;
  $c("sbEmpty").hidden = true;
  $c("sbContent").hidden = true;
  hidePumpSections();
  const d = node.data || {};
  if (document.activeElement !== $c("sbV")) $c("sbV").value = Number(d.v).toFixed(2);
  if (document.activeElement !== $c("sbL")) $c("sbL").value = Number(d.l).toFixed(2);
  // D — справочное поле (задел под Шевелёва), в расчёт не входит; пустое = не задано.
  const dEl = $c("sbD");
  if (document.activeElement !== dEl) {
    const dv = parseFloat(d.d);
    dEl.value = Number.isFinite(dv) ? padNum(dv) : "";
  }
  const dt = delayDt(d);
  $c("sbDt").textContent = `Δt = L / (60·v) = ${fmt(dt, 1)} мин`;
  const srcs = upstreamIds(sbNodeId, graphData()).map(u => results[u]).filter(Boolean);
  const out = results[sbNodeId];
  const has = !!(srcs.length && out);
  $c("sbDelayChartWrap").hidden = !has;
  $c("sbDelayEmpty").hidden = has;
  if (has) {
    const inSeries = srcs.length === 1 ? seriesFromResult(srcs[0]) : resampleForDisplay(combineSeries(srcs.map(s => seriesFromResult(s))));
    delayChart.update(dt, inSeries, seriesFromResult(out));
  }
  applySidebarLock();
  applySidebarDisable();
}

function renderFlowSidebar(node) {
  setTitle(`Дополнительный приток · нода #${sbNodeId}`);
  $c("sbFlow").hidden = false;
  $c("sbDelay").hidden = true;
  $c("sbCatch").hidden = true;
  $c("sbEmpty").hidden = true;
  $c("sbContent").hidden = true;
  hidePumpSections();
  const d = node.data || {};
  if (document.activeElement !== $c("sbFQ")) $c("sbFQ").value = padNum(parseFloat(d.q));
  const t1El = $c("sbFT1");
  if (document.activeElement !== t1El) {
    const t1v = parseFloat(d.t1);
    t1El.value = Number.isFinite(t1v) ? padNum(t1v) : "";
  }
  const t2El = $c("sbFT2");
  if (document.activeElement !== t2El) {
    const t2v = parseFloat(d.t2);
    t2El.value = Number.isFinite(t2v) ? padNum(t2v) : "";
  }
  const res = results[sbNodeId];
  $c("sbFOut").innerHTML = res?.gf
    ? flowSummaryHTML(d, res)
    : "задайте расход и границы притока";
  const has = !!res?.gf;
  $c("sbFlowChartWrap").hidden = !has;
  $c("sbFlowEmpty").hidden = has;
  if (has) flowChart.update(seriesFromResult(res));
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
  if (node.name === "flow") { renderFlowSidebar(node); return; }
  $c("sbDelay").hidden = true;
  $c("sbCatch").hidden = true;
  $c("sbFlow").hidden = true;
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

  const manualLock = !!node?.data?.locked;
  if (document.activeElement !== $c("sbQr")) $c("sbQr").value = Number(displayParam(node, res, "qr")).toFixed(2);
  if (document.activeElement !== $c("sbTr")) $c("sbTr").value = Number(displayParam(node, res, "tr")).toFixed(2);
  $c("sbQr").disabled = manualLock || !!res.lockId;
  $c("sbTr").disabled = manualLock || !!res.lockId;
  const sbQrTrPair = $c("sbParams")?.querySelector(".sb-pair");
  if (sbQrTrPair) sbQrTrPair.classList.toggle("sb-locked", !!res.lockId);
  $c("sbLock").hidden = !res.lockId;
  if (res.lockId) {
    const ids = (res.lockIds?.length ? res.lockIds : [res.lockId]).map(x => `#${x}`).join(", ");
    $c("sbLockSrc").textContent = ids;
    $c("sbLockMulti").hidden = !(res.lockIds?.length > 1);
  }
  if (document.activeElement !== $c("sbQ")) $c("sbQ").value = Number(res.Q).toFixed(2);
  if (document.activeElement !== $c("sbQm3h")) $c("sbQm3h").value = (res.Q * 3.6).toFixed(2);
  const inflowSeries = inflowFromResult(res);
  const qMax = seriesPeak(inflowSeries).q;
  const rg = $c("sbQrange");
  rg.max = Math.ceil(qMax);
  if (document.activeElement !== rg) rg.value = Math.min(res.Q, qMax);
  if (document.activeElement !== $c("sbIdle")) $c("sbIdle").value = Number(res.idle).toFixed(2);
  for (const rb of document.querySelectorAll('input[name="sbMode"]')) {
    rb.checked = rb.value === res.mode;
  }
  $c("sbApprox").hidden = !res.approx;
  $c("sbTrunc").hidden = !res.r.truncated;

  const data = graphData();
  const ownLabel = res.lockIds?.length > 1
    ? `Водосборы ${res.lockIds.map(x => `#${x}`).join(", ")}`
    : res.lockId ? `Водосбор #${res.lockId}` : "Дождь (собственный)";
  const ownSeries = res.ownRainGF ? resampleForDisplay(toDense(res.ownRainGF, HYDRO_DT, globalTMax || undefined), CHART_MAX_POINTS, renderAnchors(res)) : res.ownRain;
  const comps = [{ label: ownLabel, series: ownSeries }];
  for (const x of upstreamIds(sbNodeId, data)
    .map(u => ({ nd: data[u], r: results[u] }))
    .filter(x => x.r && !x.r.fromCatch)) {
    comps.push({ label: `${NODE_LABEL[x.nd.name]} #${x.nd.id}`, series: seriesFromResult(x.r) });
  }
  inflowChart.update(res.Q, res.r, inflowSeries, comps, seriesFromResult(res), false);

  const numeric = res.mode === "numeric" || !res.eq;
  const nh = res.hydroGFs?.length || 0, np = res.flowGFs?.length || 0;
  if (numeric) {
    let note;
    if (res.mode === "analytic") {
      const parts = [];
      if (nh) parts.push(`${nh} ${plural(nh, "гидрограф", "гидрографа", "гидрографов")}`);
      if (np) parts.push(`${np} ${plural(np, "кусочной выход КНС", "кусочных выхода КНС", "кусочных выходов КНС")}`);
      note = `аналитически точно по сегментам: ${parts.join(" + ")}`;
    }
    buildCards($c("sbCards"), res.Q, 0, 0, 0, res.r, true, note);
  } else {
    const pure = np === 0 && nh <= 1;
    const note = pure
      ? "аналитически точно: формулы (1)–(3) Приложения 8"
      : "приближение: эквивалентный гидрограф (Qr*, tr* — пик суммарного входа)";
    buildCards($c("sbCards"), res.Q, res.eq.Qr, res.eq.tr, res.eq.n, res.r, false, note);
  }

  if (!sbWqChart.inner) sbWqChart.inner = makeWQChart($c("sbChart"));
  const fn = sbCalcFn(res);
  const rangePts = [];
  const from = parseFloat($c("sbFrom").value), to = parseFloat($c("sbTo").value), step = parseFloat($c("sbStep").value);
  if (from > 0 && to > from && step > 0) {
    for (let q = from, i = 0; q <= to + 1e-9 && i < 51; q += step, i++) {
      rangePts.push({ x: +q.toFixed(2), y: smartRound(fn(q).W) });
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
  if (computeTimer !== null) flushCascade(); // панель должна показывать свежие итоги
  requestAnimationFrame(() => EC_REGISTRY.forEach(c => c.resize()));
  const res = results[id];
  const inflowRes = res?.inflowGF ? toDense(res.inflowGF, HYDRO_DT, globalTMax || undefined) : res?.inflow;
  if (inflowRes) {
    const qMax = seriesPeak(inflowRes).q;
    if (!$c("sbFrom").value) {
      $c("sbFrom").value = Math.max(1, Math.round(qMax / 8)).toFixed(2);
      $c("sbTo").value = Math.round(qMax).toFixed(2);
      $c("sbStep").value = Math.max(1, Math.round(qMax / 8)).toFixed(2);
    }
  }
  renderSidebar();
}

function closeSidebar() {
  sbNodeId = null;
  markSidebarNode();
  $c("sidebar").hidden = true;
}

// Дисковые (дискретные) переключения ждём мгновенной реакции, а ввод чисел
// и протягивание слайдера пересчитываются пачкой — см. computeCascade.
const IMMEDIATE_KEYS = new Set(["locked", "disabled", "mode", "coeffMode"]);

function syncNodeParam(id, key, value) {
  const nd = editor.getNodeFromId(id);
  if (!nd) return;
  const data = { ...nd.data, [key]: value };
  // DOM всегда отдает имя атрибута в нижнем регистре, поэтому Drawflow заводит
  // у узла-водосбора призрачных близнецов f/p рядом с каноническими F/P —
  // вычищаем близнеца, иначе расчёт и поле разойдутся.
  if (key === "F") delete data.f;
  if (key === "P") delete data.p;
  editor.updateNodeDataFromId(id, data);
  const inp = document.querySelector(`#node-${id} input[df-${key}]`);
  if (inp && document.activeElement !== inp && inp.type === "number") {
    inp.value = padNum(value);
  }
  if (IMMEDIATE_KEYS.has(key)) flushCascade();
  else computeCascade();
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
  const v = parseFloat(e.target.value);
  $c("sbQ").value = Number.isFinite(v) ? padNum(v) : e.target.value;
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
// D — справочное: пустое поле = не задано, в расчёт не входит (задел под Шевелёва).
$c("sbD").addEventListener("input", () => {
  if (sbNodeId === null) return;
  const raw = $c("sbD").value.trim();
  if (raw === "") { syncNodeParam(sbNodeId, "d", ""); return; }
  const v = parseFloat(raw);
  if (v > 0) syncNodeParam(sbNodeId, "d", v);
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
for (const [elId, key] of Object.entries(SB_FLOW_MAP)) {
  $c(elId).addEventListener("input", () => {
    const v = parseFloat($c(elId).value);
    if (!Number.isNaN(v) && sbNodeId !== null) syncNodeParam(sbNodeId, key, v);
  });
}
// t₁ — особое: пустое поле легально и означает «с начала события»
$c("sbFT1").addEventListener("input", () => {
  if (sbNodeId === null) return;
  const raw = $c("sbFT1").value.trim();
  if (raw === "") { syncNodeParam(sbNodeId, "t1", ""); return; }
  const v = parseFloat(raw);
  if (Number.isFinite(v)) syncNodeParam(sbNodeId, "t1", v);
});
// t₂ — особое: пустое поле легально и означает «до конца события»
$c("sbFT2").addEventListener("input", () => {
  if (sbNodeId === null) return;
  const raw = $c("sbFT2").value.trim();
  if (raw === "") { syncNodeParam(sbNodeId, "t2", ""); return; }
  const v = parseFloat(raw);
  if (Number.isFinite(v)) syncNodeParam(sbNodeId, "t2", v);
});
for (const rb of document.querySelectorAll('input[name="sbCCoeff"]')) {
  rb.addEventListener("change", () => {
    if (sbNodeId !== null && rb.checked) syncNodeParam(sbNodeId, "coeffMode", rb.value);
  });
}
$c("sbCHelp").addEventListener("click", () => {
  const r = results[sbNodeId];
  if (r?.params) openHelp(catchHelp(r.params), {});
});
// «?» у заголовка t_r: подсказка работает и до расчёта — параметры берём из
// данных ноды, а не из results (там их может ещё не быть).
$c("sbTrHelp").addEventListener("click", e => {
  e.stopPropagation();
  const nd = sbNodeId !== null ? editor.getNodeFromId(sbNodeId) : null;
  const p = results[sbNodeId]?.params || (nd ? catchParams(nd.data || {}, getGlobalN()) : null);
  if (p) openHelp([...catchTrHelp(p), ...catchSources()], {});
});
// «?» у заголовка коэффициентов: формулы z_mid/ψ_mid с подстановкой по составу
// поверхностей (и пояснение в ручном режиме), тоже работает до расчёта.
$c("sbCoeffHelp").addEventListener("click", e => {
  e.stopPropagation();
  const nd = sbNodeId !== null ? editor.getNodeFromId(sbNodeId) : null;
  const p = results[sbNodeId]?.params || (nd ? catchParams(nd.data || {}, getGlobalN()) : null);
  if (p) openHelp([...catchCoeffHelp(p), ...catchSources()], {});
});

// Эти поля не меняют граф — перерисовываем только панель, но тоже пачкой
// по кадру: прокрутка колесом не должна дёргать KaTeX и ECharts по тикам.
let sidebarRenderQueued = false;
function scheduleSidebarRender() {
  if (sidebarRenderQueued) return;
  sidebarRenderQueued = true;
  requestAnimationFrame(() => {
    sidebarRenderQueued = false;
    renderSidebar();
  });
}
for (const id of ["sbFrom", "sbTo", "sbStep"]) {
  $c(id).addEventListener("input", scheduleSidebarRender);
}
$c("sbFitAxis").addEventListener("click", () => {
  $c("sbFitAxis").classList.toggle("active");
  renderSidebar();
});

function fmtSumParts(gfs, labels) {
  const f = v => Number.isFinite(v) ? fmt(v) : v;
  let html = `<div class="gf-segments">`;
  gfs.forEach((gf, i) => {
    if (!gf) return;
    const label = labels[i] ? `${labels[i]}: ` : "";
    if (gf.type === "hydrograph") {
      html += `<span class="gf-seg">+ ${label}гидрограф Qr = ${f(gf.Qr)} л/с, tr = ${f(gf.tr)} мин, n = ${fmt(gf.n)}${gf.delay ? `, сдвиг +${f(gf.delay)} мин` : ""}</span>`;
    } else if (gf.type === "piecewise") {
      const segs = gf.segments.map(s => `[${f(s.tStart)}; ${f(s.tEnd)}) → ${f(s.q)} л/с`).join("; ");
      html += `<span class="gf-seg">+ ${label}кусочно-постоянная ${segs}${gf.delay ? `, сдвиг +${f(gf.delay)} мин` : ""}</span>`;
    } else if (gf.t && gf.q) {
      html += `<span class="gf-seg">+ ${label}табличный ряд (${gf.t.length} точек)</span>`;
    }
  });
  return html + `</div>`;
}

function fmtGF(gf, label) {
  const f = v => Number.isFinite(v) ? fmt(v) : v;
  let html = `<div class="gf-entry"><span class="gf-label">${label}</span> `;
  if (!gf) { html += `<span class="gf-na">нет данных</span></div>`; return html; }
  if (gf.type === "hydrograph") {
    html += `<span class="gf-type">Гидрограф</span>
      <div class="gf-params">Qr = ${f(gf.Qr)} л/с, tr = ${f(gf.tr)} мин, n = ${fmt(gf.n)}</div>
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
  if (computeTimer !== null) flushCascade(); // в модалке должны быть свежие ряды
  const f = v => Number.isFinite(v) ? fmt(v) : v;
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
  const catchSrcs = upstreams.filter(u => results[u]?.fromCatch);
  const flowSrcs = upstreams.filter(u => results[u] && !results[u].fromCatch);
  const hydroLabels = (res.hydroGFs || []).map((_, i) =>
    catchSrcs[i] ? `${NODE_LABEL[data[catchSrcs[i]]?.name] || "?"} #${catchSrcs[i]}` : "Собственный дождь");
  const flowLabels = (res.flowGFs || []).map((_, i) =>
    flowSrcs[i] ? `Выход ${NODE_LABEL[data[flowSrcs[i]]?.name] || "?"} #${flowSrcs[i]}` : "");
  const hydroGfs = (res.hydroGFs || []).map((gf, i) => (catchSrcs[i] && results[catchSrcs[i]]?.gf) || gf);
  const flowGfs = (res.flowGFs || []).map((gf, i) => (flowSrcs[i] && results[flowSrcs[i]]?.gf) || gf);
  if (res.ownRainGF) {
    let ownHtml;
    if (res.ownRainGF.type === "dense" && (res.hydroGFs?.length || 0) > 1) {
      ownHtml = `<div class="gf-entry"><span class="gf-type">Сумма (аналитическая)</span>${fmtSumParts(hydroGfs, hydroLabels)}<div class="gf-dur">для графика свёрнута в ряд: ${res.ownRainGF.t.length} точек, шаг ${fmt(HYDRO_DT)} мин</div></div>`;
    } else {
      ownHtml = fmtGF(res.ownRainGF, "");
    }
    html += `<div class="gf-section gf-section-in"><h3>Собственный гидрограф</h3>${ownHtml}</div>`;
  }
  if (res.inflowGF) {
    let inHtml;
    if ((res.flowGFs?.length || 0) > 0 || (res.hydroGFs?.length || 0) > 1) {
      const denseNote = res.inflowGF.t
        ? `<div class="gf-dur">для графика и численного режима свёрнута в ряд: ${res.inflowGF.t.length} точек, шаг ${fmt(HYDRO_DT)} мин</div>` : "";
      inHtml = `<div class="gf-entry"><span class="gf-label">Σ</span> <span class="gf-type">Сумма (аналитическая)</span>${fmtSumParts([...hydroGfs, ...flowGfs], [...hydroLabels, ...flowLabels])}${denseNote}</div>`;
    } else {
      inHtml = fmtGF(res.inflowGF, upstreams.length || res.ownRainGF ? "Σ" : "");
    }
    html += `<div class="gf-section gf-section-in"><h3>Суммарный вход</h3>${inHtml}</div>`;
  }
  if (res.gf) {
    let outLabel = "";
    if (res.mode === "analytic" && res.eq) outLabel = `Аналит. Qr=${f(res.eq.Qr)} tr=${f(res.eq.tr)}`;
    else if (res.mode === "analytic") outLabel = "Аналит. по сегментам";
    else if (res.mode === "numeric") outLabel = "Численный";
    if (outLabel) outLabel = ` (${outLabel})`;
    let methodNote = "";
    const nh = res.hydroGFs?.length || 0, np = res.flowGFs?.length || 0;
    if (res.mode === "numeric") {
      methodNote = "Метод: численный — пошаговое моделирование уровня резервуара по суммарному ряду (Δt = 0,20 мин).";
    } else if (res.mode === "analytic" && !res.eq) {
      const parts = [];
      if (nh) parts.push(`${nh} ${plural(nh, "дождевой гидрограф", "дождевых гидрографа", "дождевых гидрографов")}`);
      if (np) parts.push(`${np} ${plural(np, "кусочно-постоянный выход КНС", "кусочно-постоянных выхода КНС", "кусочно-постоянных выходов КНС")}`);
      methodNote = `Метод: точный аналитический по сегментам (${parts.join(" + ")}) — формулы Приложения 8 с эффективным порогом Qнс − c на каждом сегменте, объёмы точными интегралами, пересечения бисекцией.`;
    } else if (res.mode === "analytic" && np === 0 && nh <= 1) {
      methodNote = "Метод: точные формулы (1)–(3) Приложения 8 (чистый дождь).";
    } else if (res.mode === "analytic") {
      methodNote = "Метод: приближение эквивалентным дождевым гидрографом (Qr*, tr* — пик суммарного притока). Для точного результата включите численный режим.";
    }
    if (methodNote) methodNote = `<div class="gf-method">${methodNote} <button class="help-btn gf-method-help" type="button" title="Методика расчёта">?</button></div>`;
    html += `<div class="gf-section gf-section-out"><h3>Выход${outLabel}</h3>${methodNote}${fmtGF(res.gf, "")}</div>`;
  }
  $c("gfContent").innerHTML = html || '<p class="gf-na">Нет данных о функциях для этой ноды</p>';
  $c("gfModal").hidden = false;
}

$c("sbGFBtn").addEventListener("click", () => {
  if (sbNodeId !== null) showGFInfo(sbNodeId);
});
$c("sbReportBtn").addEventListener("click", () => {
  if (sbNodeId === null) return;
  const payload = serializeScheme();
  const md = buildNodeReportMD(sbNodeId, { nodes: payload.nodes, connections: payload.connections }, results, { meta: cascadeMeta, n: getGlobalN(), payload });
  if (md) downloadTextFile(`kns-node-${sbNodeId}.md`, md);
});
$c("gfClose").addEventListener("click", () => { $c("gfModal").hidden = true; });
$c("gfHelp").addEventListener("click", () => openHelp(CASCADE_HELP, {}));
$c("gfContent").addEventListener("click", e => {
  if (e.target.closest(".gf-method-help")) openHelp(CASCADE_HELP, {});
});
$c("gfModal").addEventListener("click", e => {
  if (e.target === $c("gfModal")) $c("gfModal").hidden = true;
});

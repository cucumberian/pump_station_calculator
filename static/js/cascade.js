"use strict";

const editor = new Drawflow($c("drawflow"));
editor.force_first_input = true;
editor.zoom_max = 5.0;
editor.zoom_min = 0.1;
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
    if (nd.name === "catch") {
      const p = catchParams(d, nGlob);
      if (!(p.Qr > 0 && p.tr > 0)) { res[id] = null; continue; }
      res[id] = {
        series: sampleHydro(p.Qr, p.tr, nGlob, 4 * p.tr + totalDelay + 30),
        Qr: p.Qr, tr: p.tr, params: p, fromCatch: true,
      };
    } else if (nd.name === "delay") {
      const srcs = upstreamIds(id, data).map(u => res[u]).filter(Boolean);
      if (!srcs.length) { res[id] = null; continue; }
      const combined = srcs.length === 1 ? srcs[0].series : combineSeries(srcs.map(s => s.series));
      res[id] = {
        series: shiftSeries(combined, delayDt(d)),
        fromCatch: srcs.every(s => s.fromCatch), Qr: srcs[0].Qr, tr: srcs[0].tr,
      };
    } else if (nd.name === "pump") {
      const Q = parseFloat(d.q);
      const ups = upstreamIds(id, data).map(u => ({ id: u, r: res[u] })).filter(x => x.r);
      const catchUps = ups.filter(x => x.r.fromCatch);
      const flowUps = ups.filter(x => !x.r.fromCatch);
      let Qr = parseFloat(d.qr), tr = parseFloat(d.tr), lockId = null, ownRain = null;
      if (catchUps.length) {
        const c = catchUps[0].r;
        Qr = c.Qr;
        tr = c.tr;
        lockId = catchUps[0].id;
        ownRain = c.series;
        flowUps.push(...catchUps.slice(1));
        editor.updateNodeDataFromId(id, { ...editor.getNodeFromId(id).data, qr: Qr, tr });
      }
      if (!(Qr > 0 && tr > 0 && Q > 0)) { res[id] = null; continue; }
      let idle = parseFloat(d.idle);
      if (!(idle >= 0)) idle = 50;
      idle = Math.min(idle, 100);
      ownRain = ownRain || sampleHydro(Qr, tr, nGlob, 4 * tr + totalDelay + 30);
      const inflow = combineSeries([ownRain, ...flowUps.map(x => x.r.series)]);
      const pureRain = flowUps.length === 0;
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
        series: pumpOutSeries(Q, r, inflow.t[inflow.t.length - 1] + totalDelay, HYDRO_DT, idle),
        ownRain, inflow, r, Q, Qr, tr, idle, mode, eq, nEff: nGlob, lockId,
        approx: mode === "analytic" && !pureRain,
      };
    }
  }
  results = res;
  updateSummaries(data);
  saveScheme();
  refreshSidebar();
}

function nodeLocked(id) {
  return !!editor.getNodeFromId(id)?.data?.locked;
}

function updateSummaries(data = graphData()) {
  for (const [id, nd] of Object.entries(data)) {
    const numEl = document.querySelector(`#node-${id} .node-num`);
    if (numEl) numEl.textContent = `#${id}`;
    const nameEl = document.querySelector(`#node-${id} .node-name`);
    if (nameEl) nameEl.textContent = (nd.data?.name || "").trim() || NODE_TYPE_LABEL[nd.name];
    const isLocked = !!nd.data?.locked;
    const lockBtn = document.querySelector(`#node-${id} .node-lock`);
    if (lockBtn) {
      lockBtn.classList.toggle("active", isLocked);
      lockBtn.innerHTML = isLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
      lockBtn.title = isLocked ? "Разблокировать параметры" : "Заблокировать параметры";
    }
    for (const inp of document.querySelectorAll(`#node-${id} input`)) {
      inp.disabled = isLocked;
    }
    if (nd.name === "delay") {
      const out = document.querySelector(`#node-${id} .delay-out`);
      if (out) out.textContent = `Δt = ${fmt(delayDt(nd.data || {}), 1)} мин`;
      continue;
    }
    if (nd.name === "catch") {
      const out = document.querySelector(`#node-${id} .catch-out`);
      if (!out) continue;
      const r = results[id];
      out.innerHTML = r
        ? `Q<sub>r</sub> = <b>${fmt(r.Qr, 2)} л/с</b> <br> t<sub>r</sub> = <b>${fmt(r.tr, 2)} мин</b>`
        : "Q<sub>r</sub> = — <br> t<sub>r</sub> = —";
      continue;
    }
    if (nd.name !== "pump") continue;
    const mt = document.querySelector(`#node-${id} .mode-toggle`);
    if (mt) {
      mt.classList.toggle("active", (nd.data?.mode ?? "analytic") === "numeric");
      mt.disabled = isLocked;
    }
    const r = results[id];
    const locked = !!(r && r.lockId);
    const ln = document.querySelector(`#node-${id} .lock-note`);
    if (ln) {
      ln.classList.toggle("on", locked);
      if (locked) ln.innerHTML = `Q<sub>r</sub>, t<sub>r</sub> ← Водосбор #${r.lockId}`;
    }
    for (const k of ["qr", "tr"]) {
      const inp = document.querySelector(`#node-${id} input[df-${k}]`);
      if (!inp) continue;
      inp.disabled = isLocked || locked;
      if (locked && document.activeElement !== inp) {
        inp.value = String(Math.round((k === "qr" ? r.Qr : r.tr) * 100) / 100);
      }
    }
    const slider = document.querySelector(`#node-${id} .q-range`);
    if (slider && r) {
      slider.max = Math.ceil(r.Qr);
      if (document.activeElement !== slider) slider.value = Math.min(r.Q, r.Qr);
    }
    const el = document.querySelector(`#node-${id} .node-summary`);
    if (!el) continue;
    if (!r) {
      el.innerHTML = `<span class="warn">задайте Q<sub>r</sub>, t<sub>r</sub>, Q<sub>нс</sub></span>`;
    } else if (r.r.dry) {
      el.innerHTML = `<span class="warn">Q<sub>нс</sub> ≥ притока — регулирование не требуется</span>`;
    } else {
      el.innerHTML =
        `T<sub>н</sub> = ${fmt(r.r.tn)} мин, T<sub>к</sub> = ${fmt(r.r.tk)} мин<br>` +
        `W<sub>нс</sub> = <b>${fmt(r.r.W, 1)} м³</b>`;
    }
  }
}

for (const item of document.querySelectorAll(".pal-node")) {
  item.addEventListener("dragstart", e => {
    e.dataTransfer.setData("node", item.dataset.node);
  });
  item.addEventListener("click", () => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const rect = $c("drawflow").getBoundingClientRect();
    const x = (rect.width / 2 - editor.canvas_x) / editor.zoom;
    const y = (rect.height / 2 - editor.canvas_y) / editor.zoom;
    addNodeOfType(item.dataset.node, x - 100, y - 60);
    computeCascade();
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

$c("drawflow").addEventListener("mouseup", scheduleSaveView);
$c("drawflow").addEventListener("touchend", scheduleSaveView);

let mouseDownPos = null;
$c("drawflow").addEventListener("mousedown", e => { mouseDownPos = [e.clientX, e.clientY]; });
$c("drawflow").addEventListener("click", e => {
  const nodeEl = e.target.closest(".drawflow-node");
  if (!nodeEl || !mouseDownPos) return;
  if (Math.hypot(e.clientX - mouseDownPos[0], e.clientY - mouseDownPos[1]) > 5) return;
  const id = nodeEl.id.replace("node-", "");
  if (["pump", "delay", "catch"].includes(editor.getNodeFromId(id)?.name)) openSidebar(id);
});

function dfKey(el) {
  const attr = [...el.attributes].find(a => a.name.startsWith("df-"));
  if (!attr) return null;
  const key = attr.name.slice(3);
  return { f: "F", p: "P" }[key] || key;
}

window.addEventListener("wheel", e => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement)) return;
  if (el.disabled) return;
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
    syncNodeParam(id, el.type === "range" ? "q" : dfKey(el), v);
  } else {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}, { capture: true, passive: false });

for (const evName of ["mousedown", "touchstart", "pointerdown"]) {
  $c("drawflow").addEventListener(evName, e => {
    if (e.target.classList?.contains("q-range") ||
        e.target.classList?.contains("mode-toggle") ||
        e.target.closest(".node-lock") ||
        e.target.classList?.contains("catch-info")) e.stopPropagation();
  }, true);
}

$c("drawflow").addEventListener("click", e => {
  const mt = e.target.closest(".mode-toggle");
  if (!mt || mt.disabled) return;
  e.stopPropagation();
  const id = mt.closest(".drawflow-node").id.replace("node-", "");
  const nd = editor.getNodeFromId(id);
  if (!nd) return;
  syncNodeParam(id, "mode", nd.data?.mode === "numeric" ? "analytic" : "numeric");
}, true);

$c("drawflow").addEventListener("click", e => {
  const lb = e.target.closest(".node-lock");
  if (!lb) return;
  e.stopPropagation();
  const id = lb.closest(".drawflow-node").id.replace("node-", "");
  syncNodeParam(id, "locked", !nodeLocked(id));
}, true);

$c("drawflow").addEventListener("click", e => {
  const ci = e.target.closest(".catch-info");
  if (!ci) return;
  e.stopPropagation();
  const id = ci.closest(".drawflow-node").id.replace("node-", "");
  const r = results[id];
  if (r?.params) openHelp(catchHelp(r.params), {});
}, true);

$c("drawflow").addEventListener("input", e => {
  if (!e.target.classList?.contains("q-range")) return;
  const id = e.target.closest(".drawflow-node").id.replace("node-", "");
  syncNodeParam(id, "q", parseFloat(e.target.value));
});

editor.on("connectionCreated", conn => {
  const outNode = editor.getNodeFromId(conn.output_id);
  const inNode = editor.getNodeFromId(conn.input_id);
  const outConns = outNode?.outputs?.[conn.output_class]?.connections || [];
  if (outConns.length > 1 ||
      wouldCycle(conn.output_id, conn.input_id) ||
      (outNode?.name === "catch" && inNode?.name === "delay")) {
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

$c("globalN").addEventListener("input", computeCascade);
$c("sbHydroHelp").addEventListener("click", () => openHelp(CASCADE_HELP, {}));

const LS_PALETTE = "kns-palette-collapsed";
const gnField = document.querySelector(".palette .global-n");
function setPaletteCollapsed(collapsed) {
  $c("palette").classList.toggle("collapsed", collapsed);
  if (collapsed) {
    $c("nFloat").insertBefore(gnField, $c("paletteExpand").nextSibling);
    $c("nFloat").hidden = false;
  } else {
    $c("gnSlot").appendChild(gnField);
    $c("nFloat").hidden = true;
  }
  try { localStorage.setItem(LS_PALETTE, collapsed ? "1" : "0"); } catch { /* приватный режим */ }
}
$c("paletteToggle").addEventListener("click", () => setPaletteCollapsed(true));
$c("paletteExpand").addEventListener("click", () => setPaletteCollapsed(false));
try {
  if (localStorage.getItem(LS_PALETTE) === "1") setPaletteCollapsed(true);
} catch { /* приватный режим */ }
for (const ev of ["mousedown", "touchstart", "pointerdown", "click", "contextmenu"]) {
  $c("nFloat").addEventListener(ev, e => e.stopPropagation());
}

let ctxPos = null, ctxConn = null, ctxNode = null, ctxShownAt = 0, ctxFromTouch = false;
function showCtxMenu(x, y, { nodeEl = null, connEl = null, fromTouch = false } = {}) {
  ctxPos = [x, y];
  ctxConn = null;
  ctxNode = null;
  ctxShownAt = Date.now();
  ctxFromTouch = fromTouch;
  const m = $c("ctxMenu");
  if (nodeEl) {
    ctxNode = nodeEl.id.replace("node-", "");
    m.innerHTML = `
      <button type="button" data-dupnode>Дублировать ноду</button>
      <button type="button" data-delnode>${XMARK_HTML}Удалить ноду</button>`;
  } else if (connEl) {
    const cls = [...connEl.classList];
    ctxConn = {
      outId: cls.find(c => c.startsWith("node_out_node-"))?.replace("node_out_node-", ""),
      inId: cls.find(c => c.startsWith("node_in_node-"))?.replace("node_in_node-", ""),
      outClass: cls.find(c => /^output_\d+$/.test(c)),
      inClass: cls.find(c => /^input_\d+$/.test(c)),
    };
    m.innerHTML = `<button type="button" data-delconn>${XMARK_HTML}Удалить связь</button>`;
  } else {
    m.innerHTML = `
      <button type="button" data-add="pump">Насосная станция</button>
      <button type="button" data-add="delay">Участок сети</button>
      <button type="button" data-add="catch">Водосбор</button>`;
  }
  m.hidden = false;
  m.style.left = Math.min(x, window.innerWidth - 200) + "px";
  m.style.top = Math.min(y, window.innerHeight - 120) + "px";
}
function hideCtxMenu() {
  $c("ctxMenu").hidden = true;
  ctxPos = null;
  ctxConn = null;
  ctxNode = null;
}

$c("drawflow").addEventListener("contextmenu", e => {
  e.preventDefault();
  e.stopPropagation();
  if (ctxFromTouch && Date.now() - ctxShownAt < 800) return;
  showCtxMenu(e.clientX, e.clientY, {
    nodeEl: e.target.closest(".drawflow-node"),
    connEl: e.target.closest(".connection"),
  });
}, true);

let lpTimer = null, lpStart = null;
$c("drawflow").addEventListener("touchstart", e => {
  if (e.touches.length !== 1 || e.target.closest("input, button, select")) {
    clearTimeout(lpTimer);
    lpStart = null;
    return;
  }
  const t = e.touches[0];
  lpStart = [t.clientX, t.clientY];
  const opts = {
    nodeEl: e.target.closest(".drawflow-node"),
    connEl: e.target.closest(".connection"),
    fromTouch: true,
  };
  lpTimer = setTimeout(() => showCtxMenu(t.clientX, t.clientY, opts), 550);
});
$c("drawflow").addEventListener("touchmove", e => {
  if (!lpStart) return;
  const t = e.touches[0];
  if (Math.hypot(t.clientX - lpStart[0], t.clientY - lpStart[1]) > 10) {
    clearTimeout(lpTimer);
    lpStart = null;
  }
});
$c("drawflow").addEventListener("touchend", () => {
  clearTimeout(lpTimer);
  lpStart = null;
});
$c("drawflow").addEventListener("touchcancel", () => {
  clearTimeout(lpTimer);
  lpStart = null;
});

$c("ctxMenu").addEventListener("click", e => {
  if (ctxFromTouch && Date.now() - ctxShownAt < 300) return;
  const delNodeBtn = e.target.closest("[data-delnode]");
  if (delNodeBtn && ctxNode) {
    editor.removeNodeId(`node-${ctxNode}`);
    hideCtxMenu();
    return;
  }
  const dupNodeBtn = e.target.closest("[data-dupnode]");
  if (dupNodeBtn && ctxNode) {
    const src = editor.getNodeFromId(ctxNode);
    if (src && NODE_PORTS[src.name]) {
      const [ni, no] = NODE_PORTS[src.name];
      editor.addNode(src.name, ni, no, src.pos_x + 40, src.pos_y + 40,
        src.name, { ...src.data }, NODE_HTML[src.name]);
      computeCascade();
    }
    hideCtxMenu();
    return;
  }
  const delBtn = e.target.closest("[data-delconn]");
  if (delBtn && ctxConn) {
    if (ctxConn.outId && ctxConn.inId && ctxConn.outClass && ctxConn.inClass) {
      editor.removeSingleConnection(ctxConn.outId, ctxConn.inId, ctxConn.outClass, ctxConn.inClass);
    }
    hideCtxMenu();
    return;
  }
  const btn = e.target.closest("[data-add]");
  if (!btn || !ctxPos) return;
  const rect = $c("drawflow").getBoundingClientRect();
  const x = (ctxPos[0] - rect.left - editor.canvas_x) / editor.zoom;
  const y = (ctxPos[1] - rect.top - editor.canvas_y) / editor.zoom;
  addNodeOfType(btn.dataset.add, x, y);
  computeCascade();
  hideCtxMenu();
});
document.addEventListener("click", e => {
  if (ctxFromTouch && Date.now() - ctxShownAt < 400) return;
  if (!e.target.closest("#ctxMenu")) hideCtxMenu();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") hideCtxMenu(); });

$c("menuToggle").addEventListener("click", e => {
  e.stopPropagation();
  $c("headerBtns").classList.toggle("open");
});
document.addEventListener("click", e => {
  if (!e.target.closest("#headerBtns")) $c("headerBtns").classList.remove("open");
});

document.querySelectorAll("#headerBtns .btn").forEach(b => {
  b.addEventListener("click", () => $c("headerBtns").classList.remove("open"));
});

const fsBtn = $c("fullscreen");
const fsRequest = document.documentElement.requestFullscreen
  ? () => document.documentElement.requestFullscreen()
  : document.documentElement.webkitRequestFullscreen
    ? () => document.documentElement.webkitRequestFullscreen()
    : null;
if (!fsRequest) {
  fsBtn.hidden = true;
} else {
  fsBtn.addEventListener("click", () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      fsRequest();
    }
  });
  const fsSync = () => {
    const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fsBtn.textContent = on ? "Свернуть экран" : "Во весь экран";
  };
  document.addEventListener("fullscreenchange", fsSync);
  document.addEventListener("webkitfullscreenchange", fsSync);
}

bindModal();
bindMetaModal();
loadInitial();

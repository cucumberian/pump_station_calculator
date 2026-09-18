"use strict";

let saveViewTimer = null;
function scheduleSaveView() {
  clearTimeout(saveViewTimer);
  saveViewTimer = setTimeout(saveScheme, 300);
}

function applyTransform() {
  editor.zoom_last_value = editor.zoom;
  editor.precanvas.style.transform =
    `translate(${editor.canvas_x}px, ${editor.canvas_y}px) scale(${editor.zoom})`;
  editor.dispatch("zoom", editor.zoom);
  scheduleSaveView();
}

function setZoomAt(zNew, mx, my) {
  const zOld = editor.zoom;
  zNew = Math.min(editor.zoom_max, Math.max(editor.zoom_min, zNew));
  const cx = mx - (zNew / zOld) * (mx - editor.canvas_x);
  const cy = my - (zNew / zOld) * (my - editor.canvas_y);
  editor.zoom = zNew;
  editor.canvas_x = cx;
  editor.canvas_y = cy;
  applyTransform();
}

function fitView() {
  const nodes = [...document.querySelectorAll("#drawflow .drawflow-node")];
  if (!nodes.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const nd of nodes) {
    const data = editor.getNodeFromId(nd.id.replace("node-", ""));
    minX = Math.min(minX, data.pos_x);
    minY = Math.min(minY, data.pos_y);
    maxX = Math.max(maxX, data.pos_x + nd.offsetWidth);
    maxY = Math.max(maxY, data.pos_y + nd.offsetHeight);
  }
  const rect = $c("drawflow").getBoundingClientRect();
  const pad = 60;
  const zNew = Math.min(
    (rect.width - pad * 2) / Math.max(maxX - minX, 1),
    (rect.height - pad * 2) / Math.max(maxY - minY, 1),
    1.2
  );
  editor.zoom = Math.min(editor.zoom_max, Math.max(editor.zoom_min, zNew));
  editor.canvas_x = (rect.width - editor.zoom * (maxX + minX)) / 2;
  editor.canvas_y = (rect.height - editor.zoom * (maxY + minY)) / 2;
  applyTransform();
}

function zoomStep(dir) {
  const rect = $c("drawflow").getBoundingClientRect();
  setZoomAt(editor.zoom + dir * editor.zoom_value, rect.width / 2, rect.height / 2);
}

$c("zoomIn").addEventListener("click", () => zoomStep(1));
$c("zoomOut").addEventListener("click", () => zoomStep(-1));
$c("zoomFit").addEventListener("click", fitView);
window.addEventListener("wheel", e => {
  if (!(e.target instanceof Element) || !e.target.closest("#drawflow")) return;
  if (e.target.closest("input")) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const rect = $c("drawflow").getBoundingClientRect();
  const step = e.deltaY > 0 ? -editor.zoom_value : editor.zoom_value;
  setZoomAt(editor.zoom + step, e.clientX - rect.left, e.clientY - rect.top);
}, { capture: true, passive: false });
for (const id of ["zoomIn", "zoomOut", "zoomFit"]) {
  for (const ev of ["mousedown", "touchstart", "pointerdown", "click"]) {
    $c(id).addEventListener(ev, e => e.stopPropagation());
  }
}

// Pinch-зум. Встроенный мобильный зум Drawflow отключён в cascade.js, здесь —
// единственная реализация жеста: абсолютная привязка к мировой точке под
// серединой пальцев (без накопления дрожания).
let pinch = null;
let pinchRaf = 0;

function syncEditorFromTransform() {
  const tf = getComputedStyle(editor.precanvas).transform;
  if (!tf || tf === "none") return;
  const m = new DOMMatrixReadOnly(tf);
  if (m.a) {
    editor.zoom = m.a;
    editor.canvas_x = m.e;
    editor.canvas_y = m.f;
  }
}

function applyPinch() {
  pinchRaf = 0;
  if (!pinch) return;
  const [a, b] = pinch.touches;
  const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const midX = (a.clientX + b.clientX) / 2 - pinch.rect.left;
  const midY = (a.clientY + b.clientY) / 2 - pinch.rect.top;
  const zNew = Math.min(editor.zoom_max,
    Math.max(editor.zoom_min, pinch.startZoom * (dist / pinch.startDist)));
  editor.zoom = zNew;
  editor.canvas_x = midX - zNew * pinch.wx;
  editor.canvas_y = midY - zNew * pinch.wy;
  applyTransform();
}

function startPinch(e) {
  e.preventDefault();
  e.stopPropagation();
  if (window.cancelLongPress) window.cancelLongPress();
  // Drawflow двигает холст одним пальцем, но пишет canvas_x/y только в dragEnd;
  // берём актуальное состояние из transform, иначе будет рывок.
  syncEditorFromTransform();
  editor.editor_selected = false;
  editor.drag = false;
  editor.connection = false;
  editor.drag_point = false;
  const rect = $c("drawflow").getBoundingClientRect();
  const [a, b] = e.touches;
  const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
  const midX = (a.clientX + b.clientX) / 2 - rect.left;
  const midY = (a.clientY + b.clientY) / 2 - rect.top;
  pinch = {
    rect,
    startZoom: editor.zoom,
    startDist: dist,
    wx: (midX - editor.canvas_x) / editor.zoom,
    wy: (midY - editor.canvas_y) / editor.zoom,
    touches: [a, b],
  };
}

function movePinch(e) {
  if (!pinch || e.touches.length < 2) return;
  e.preventDefault();
  e.stopPropagation();
  pinch.touches = [e.touches[0], e.touches[1]];
  if (!pinchRaf) pinchRaf = requestAnimationFrame(applyPinch);
}

function endPinch(e) {
  if (e.touches.length < 2) {
    pinch = null;
    if (pinchRaf) { cancelAnimationFrame(pinchRaf); pinchRaf = 0; }
  }
  // Пока палец остался, не даём Drawflow подхватить жест со stale-координатами.
  if (e.touches.length > 0) e.stopPropagation();
}

$c("drawflow").addEventListener("touchstart", e => {
  if (e.touches.length === 2) startPinch(e);
}, { capture: true, passive: false });
$c("drawflow").addEventListener("touchmove", movePinch, { capture: true, passive: false });
$c("drawflow").addEventListener("touchend", endPinch, true);
$c("drawflow").addEventListener("touchcancel", endPinch, true);

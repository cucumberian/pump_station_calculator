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

let pinch = null;
$c("drawflow").addEventListener("touchstart", e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const [a, b] = e.touches;
    pinch = {
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      cx: (a.clientX + b.clientX) / 2,
      cy: (a.clientY + b.clientY) / 2,
    };
  }
}, { capture: true, passive: false });
$c("drawflow").addEventListener("touchmove", e => {
  if (e.touches.length === 2 && pinch) {
    e.preventDefault();
    e.stopPropagation();
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const cx = (a.clientX + b.clientX) / 2;
    const cy = (a.clientY + b.clientY) / 2;
    editor.canvas_x += cx - pinch.cx;
    editor.canvas_y += cy - pinch.cy;
    if (pinch.dist > 0) {
      const rect = $c("drawflow").getBoundingClientRect();
      setZoomAt(editor.zoom * dist / pinch.dist, cx - rect.left, cy - rect.top);
    } else {
      applyTransform();
    }
    pinch.dist = dist;
    pinch.cx = cx;
    pinch.cy = cy;
  }
}, { capture: true, passive: false });
$c("drawflow").addEventListener("touchend", e => {
  if (e.touches.length < 2) pinch = null;
}, true);

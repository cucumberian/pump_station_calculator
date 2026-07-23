"use strict";

const $ = id => document.getElementById(id);

function clampRange(Qr) {
  const lo = Math.max(1, 0.02 * Qr), hi = Qr;
  let from = parseFloat($("vFrom").value);
  let to = parseFloat($("vTo").value);
  let step = parseFloat($("vStep").value);
  if (!(from > 0) || !(to > 0) || !(step > 0)) return null;
  from = Math.min(Math.max(from, lo), hi);
  to = Math.min(Math.max(to, lo), hi);
  if (to < from) [from, to] = [to, from];
  step = Math.max(step, (to - from) / 49);
  return { from, to, step };
}

function selfCheck() {
  const cases = [[100, 15.61, 113.8], [110, 14.47, 104.9], [120, 13.58, 96.6],
                 [130, 12.87, 88.9], [150, 11.84, 74.7], [200, 10.55, 44.4]];
  const bad = cases.filter(([Q, tk, W]) => {
    const r = calc(Q, 342.3, 10, 0.71);
    return Math.abs(r.tk - tk) > 0.05 || Math.abs(r.W - W) > 0.2;
  });
  const badNum = cases.filter(([Q, tk, W]) => {
    const rA = calc(Q, 342.3, 10, 0.71);
    const s = sampleHydro(342.3, 10, 0.71, Math.max(2 * rA.tk, 30));
    const r = numericCalc(Q, s);
    return Math.abs(r.tk - tk) > 0.2 || Math.abs(r.W - W) > 1.5;
  });
  console.assert(bad.length === 0, "КНС self-check failed", bad);
  console.assert(badNum.length === 0, "КНС numeric self-check failed", badNum);
  if (bad.length || badNum.length) {
    const el = $("selfcheck");
    el.hidden = false;
    el.textContent = "ОШИБКА: расчёт не сходится с примером из PDF: " + JSON.stringify([...bad, ...badNum]);
  }
}

const wqChart = makeWQChart($("chart"));
const qtChart = makeQTChart($("chartQT"));

function render() {
  const Qr = parseFloat($("Qr").value);
  const tr = parseFloat($("tr").value);
  const n = parseFloat($("n").value);
  const Q = parseFloat($("Q").value);
  if (!(Qr > 0 && tr > 0 && n > 0 && n < 1 && Q > 0)) return;

  $("Qrange").max = Qr;
  $("Qrange").value = Math.min(Q, Qr);
  $("nrange").value = n;
  $("Qhint").textContent = Q >= Qr
    ? "Qнс ≥ Qr — резервуар не требуется (сток перекачивается без регулирования)"
    : "";

  const r = calc(Q, Qr, tr, n);
  saveToStorage();

  buildCards($("cards"), Q, Qr, tr, n, r, false);

  let rangePts = [];
  if ($("chartRangeFromTable").checked) {
    const rc = clampRange(Qr);
    if (rc) {
      for (let q = rc.from, i = 0; q <= rc.to + 1e-9 && i < 51; q += rc.step) {
        rangePts.push({ x: +q.toFixed(2), y: +calc(q, Qr, tr, n).W.toFixed(2) });
      }
    }
  }
  wqChart.update(Q, Qr, tr, n, { rangePts });
  qtChart.update(Q, Qr, tr, n, r);

  const rc = clampRange(Qr);
  if (!rc) return;
  fillVariants($("variants").querySelector("tbody"), Q, rc.from, rc.to, rc.step,
    q => calc(q, Qr, tr, n));
}

const PARAM_IDS = ["Qr", "tr", "n", "Q", "vFrom", "vTo", "vStep"];
const LS_KEY = "kns-params";

function loadFromStorage() {
  try {
    const data = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    for (const id of PARAM_IDS) {
      if (data[id] != null && data[id] !== "") $(id).value = data[id];
    }
  } catch { /* повреждённые данные игнорируем */ }
}

function saveToStorage() {
  const data = {};
  for (const id of PARAM_IDS) data[id] = $(id).value;
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* приватный режим */ }
  const p = new URLSearchParams();
  for (const id of PARAM_IDS) p.set(id, data[id]);
  history.replaceState(null, "", "?" + p);
}

function loadFromUrl() {
  const p = new URLSearchParams(location.search);
  let hasTable = false;
  for (const id of PARAM_IDS) {
    const v = parseFloat(p.get(id));
    if (Number.isFinite(v)) {
      $(id).value = v;
      if (id.startsWith("v")) hasTable = true;
    }
  }
  return hasTable;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* ниже fallback */ }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length); // ponytail: iOS Safari требует явный selection
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* устаревший API, но единственный на старых мобильных */ }
  ta.remove();
  return ok;
}

$("share").addEventListener("click", async () => {
  const p = new URLSearchParams();
  for (const id of PARAM_IDS) p.set(id, $(id).value);
  history.replaceState(null, "", "?" + p);
  const ok = await copyText(location.href);
  if (ok) {
    $("share").textContent = "Скопировано!";
    setTimeout(() => { $("share").textContent = "Поделиться"; }, 1500);
  } else {
    prompt("Скопируйте ссылку:", location.href);
  }
});

selfCheck();
bindModal();
$("schemeToggle").addEventListener("click", () => $("scheme").classList.toggle("open"));
$("resultsToggle").addEventListener("click", () => $("results").classList.toggle("open"));
$("chartsToggle").addEventListener("click", () => $("charts").classList.toggle("open"));
if (window.matchMedia("(min-width: 901px)").matches) {
  $("results").classList.add("open");
  $("charts").classList.add("open");
}
$("chartRangeFromTable").addEventListener("change", render);
$("hydroHelp").addEventListener("click", () => {
  openHelp(HYDRO_HELP, {
    Q: parseFloat($("Q").value), Qr: parseFloat($("Qr").value),
    tr: parseFloat($("tr").value), n: parseFloat($("n").value),
  });
});
loadFromStorage();
let rangeDirty = loadFromUrl();
{ const q = parseFloat($("Q").value); if (q > 0) $("Qm3h").value = +(q * 3.6).toFixed(1); }
for (const id of ["vFrom", "vTo", "vStep"]) {
  $(id).addEventListener("input", () => { rangeDirty = true; render(); });
  $(id).addEventListener("change", () => {
    const Qr = parseFloat($("Qr").value);
    const rc = Qr > 0 && clampRange(Qr);
    if (rc) {
      $("vFrom").value = +rc.from.toFixed(2);
      $("vTo").value = +rc.to.toFixed(2);
      $("vStep").value = +rc.step.toFixed(2);
    }
    render();
  });
}
$("Qr").addEventListener("input", () => {
  if (!rangeDirty) {
    const Qr = parseFloat($("Qr").value);
    if (Qr > 0) {
      $("vFrom").value = Math.max(1, Math.round(Qr / 8));
      $("vTo").value = Math.round(Qr);
      $("vStep").value = Math.max(1, Math.round(Qr / 8));
    }
  }
});
for (const id of ["Qr", "tr", "n"]) $(id).addEventListener("input", render);
$("Q").addEventListener("input", () => {
  const q = parseFloat($("Q").value);
  if (q > 0) $("Qm3h").value = +(q * 3.6).toFixed(1);
  render();
});
$("Qm3h").addEventListener("input", () => {
  const m = parseFloat($("Qm3h").value);
  if (m > 0) $("Q").value = +(m / 3.6).toFixed(2);
  render();
});
$("Qrange").addEventListener("input", e => {
  $("Q").value = e.target.value;
  $("Q").dispatchEvent(new Event("input"));
});
$("nrange").addEventListener("input", e => { $("n").value = e.target.value; render(); });

const shiftTr = dh => {
  const tr = parseFloat($("tr").value) || 0;
  $("tr").value = Math.max(1, tr + dh * 60);
  render();
};
$("trMinus").addEventListener("click", () => shiftTr(-1));
$("trPlus").addEventListener("click", () => shiftTr(1));

const WHEEL_STEPS = { Qr: 1, tr: 1, n: 0.01, Q: 1, Qm3h: 3.6, vFrom: 1, vTo: 1, vStep: 1 };
for (const [id, step] of Object.entries(WHEEL_STEPS)) {
  $(id).addEventListener("wheel", e => {
    e.preventDefault();
    const el = e.currentTarget;
    const dec = (String(step).split(".")[1] || "").length;
    let v = (parseFloat(el.value) || 0) + (e.deltaY < 0 ? step : -step);
    v = +v.toFixed(dec);
    if (el.min !== "" && v < +el.min) v = +el.min;
    if (el.max !== "" && v > +el.max) v = +el.max;
    el.value = v;
    el.dispatchEvent(new Event("input"));
  }, { passive: false });
}

render();

"use strict";

const $c = id => document.getElementById(id);

const LOCK_OPEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 .5" stroke="currentColor" stroke-width="1.5"/></svg>`;
const LOCK_CLOSED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.5"/></svg>`;

const XMARK_HTML = `<svg class="ic ic-xmark" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M3.47 3.47a.75.75 0 0 1 1.06 0L8 6.94l3.47-3.47a.75.75 0 1 1 1.06 1.06L9.06 8l3.47 3.47a.75.75 0 1 1-1.06 1.06L8 9.06l-3.47 3.47a.75.75 0 0 1-1.06-1.06L6.94 8 3.47 4.53a.75.75 0 0 1 0-1.06" clip-rule="evenodd"/></svg>`;

const NODE_HTML = {
  pump: `
    <div class="node-box node-pump">
      <div class="node-title"><span class="node-num"></span> <span class="node-name">Насосная станция</span></div>
      <button class="node-lock" type="button" title="Заблокировать параметры"></button>
      <div class="nf"><label>Q<sub>r</sub>, л/с</label><input df-qr type="number" step="any" min="1"></div>
      <div class="nf"><label>t<sub>r</sub>, мин</label><input df-tr type="number" step="any" min="1"></div>
      <div class="nf"><label>Q<sub>нс</sub>, л/с</label><input df-q type="number" step="any" min="1"></div>
      <input class="q-range" type="range" step="0.5" min="1" title="Qнс — производительность, л/с">
      <div class="nf"><label>вне пика, %</label><input df-idle type="number" step="any" min="0" max="100"></div>
      <div class="lock-note"></div>
      <div class="node-summary">—</div>
      <button class="mode-toggle" type="button" title="Численный режим расчёта">Σ</button>
    </div>`,
  catch: `
    <div class="node-box node-catch">
      <div class="node-title"><span class="node-num"></span> <span class="node-name">Водосбор</span></div>
      <button class="node-lock" type="button" title="Заблокировать параметры"></button>
      <div class="nf"><label>F, га</label><input df-F type="number" step="any" min="0.01"></div>
      <div class="nf"><label>q₂₀, л/с·га</label><input df-q20 type="number" step="any" min="1"></div>
      <div class="nf"><label>P, лет</label><input df-P type="number" step="any" min="0.1"></div>
      <div class="nf"><label>t<sub>con</sub>, мин</label><input df-tcon type="number" step="any" min="0"></div>
      <div class="catch-out">Q<sub>r</sub> = — <br> t<sub>r</sub> = —</div>
      <button class="catch-info" type="button" title="Формулы расчёта Qr и tr (п. 2.3.1)">?</button>
    </div>`,
  delay: `
    <div class="node-box node-delay">
      <div class="node-title"><span class="node-num"></span> <span class="node-name">Участок сети</span></div>
      <button class="node-lock" type="button" title="Заблокировать параметры"></button>
      <div class="nf"><label>v, м/с</label><input df-v type="number" step="any" min="0.01"></div>
      <div class="nf"><label>L, м</label><input df-l type="number" step="any" min="0"></div>
      <div class="delay-out">Δt = —</div>
    </div>`,
};

const NODE_TYPE_LABEL = { pump: "Насосная станция", delay: "Участок сети", catch: "Водосбор" };

const NODE_DEFAULTS = {
  pump: { name: "", desc: "", qr: 342.3, tr: 10, q: 100, idle: 50, mode: "analytic" },
  delay: { name: "", desc: "", v: 1, l: 3600 },
  catch: {
    name: "", desc: "",
    F: 3.9, q20: 80, P: 1.0, mr: 150, gamma: 1.54,
    psiMid: 0.634, zMid: 0.201, tcon: 3, tcan: 0,
    l1: 68, v1: 0.7, l2: 133, v2: 1.0, l3: 277, v3: 1.5,
    coeffMode: "variable",
  },
};

const NODE_PORTS = { pump: [1, 1], delay: [1, 1], catch: [0, 1] };
const NODE_LABEL = { pump: "КНС", delay: "Участок", catch: "Водосбор" };
const COMP_COLORS = ["#0b7285", "#f08c00", "#7048e8", "#2f9e44", "#e8590c", "#1098ad"];

const NODE_WHEEL_STEPS = { qr: 1, tr: 1, q: 1, idle: 5, v: 0.1, l: 100, F: 0.1, q20: 1, P: 0.1, tcon: 1 };
const SB_WHEEL_STEPS = { sbQr: 1, sbTr: 1, sbQ: 1, sbQm3h: 3.6, sbIdle: 5, sbV: 0.1, sbL: 100, sbFrom: 1, sbTo: 1, sbStep: 1, globalN: 0.01, sbCF: 0.1, sbCQ20: 1, sbCP: 0.1, sbCMr: 1, sbCGamma: 0.01, sbCPsi: 0.01, sbCZ: 0.01, sbCTcon: 1, sbCTcan: 1, sbCL1: 10, sbCV1: 0.1, sbCL2: 10, sbCV2: 0.1, sbCL3: 10, sbCV3: 0.1 };

const CASCADE_HELP = [
  { p: "Входной гидрограф станции складывается из собственного дождевого стока и выходных гидрографов вышестоящих станций, сдвинутых нодами участков сети. Все составляющие показаны на графике пунктиром." },
  { p: "Собственный дождевой сток строится по формулам (2) и (3) Приложения 8 — так же, как в одиночном расчёте:" },
  { tex: "Q(T) = Q_r\\left(\\frac{T}{t_r}\\right)^{1-n}, \\ T \\le t_r; \\qquad Q(T) = Q_r\\left[\\left(\\frac{T}{t_r}\\right)^{1-n} - \\left(\\frac{T}{t_r}-1\\right)^{1-n}\\right], \\ T > t_r" },
  { p: "Нода участка сети сдвигает гидрограф по времени на Δt = L / (60·v) минут, где L — длина участка в метрах, v — скорость протекания в м/с." },
  { p: "Выходной гидрограф станции (принятое упрощение): на интервале [Tнⁿˢ; Tкⁿˢ] станция откачивает полную производительность Qнс, в остальное время — заданный процент от Qнс (параметр «вне пика, %», по умолчанию 50%)." },
  { p: "Аналитический режим. Для одиночной станции без входов — точные формулы одиночного расчёта (формулы (1)–(3) Приложения 8). В каскаде суммарный гидрограф заменяется эквивалентным дождевым: Qr* — пик суммарного гидрографа, tr* — момент пика, n — общий климатический параметр схемы; далее применяются те же формулы. Это приближение, о чём выводится предупреждение." },
  { p: "Численный режим. Работа резервуара моделируется по шагам Δt: на каждом шаге уровень заполнения меняется на приток минус откачку, но не может стать отрицательным:" },
  { tex: "V_{i+1} = \\max\\!\\left(0,\\; V_i + 0{,}06\\,\\frac{(Q_i - Q_{нс}) + (Q_{i+1} - Q_{нс})}{2}\\,\\Delta t\\right), \\qquad W_{нс} = \\max_i V_i" },
  { p: "Поэтому «площадь под кривой» ниже Qнс не вычитается и не суммируется: в промежутках, где приток меньше Qнс, резервуар опорожняется (уровень падает до нуля), и следующее окно превышения заполняет уже частично освобождённый бак. Объём Wнс — это максимальный уровень заполнения за весь дождь, а не сумма площадей окон. Tнⁿˢ и Tкⁿˢ — первое и последнее пересечение суммарного гидрографа с линией Qнс." },
];

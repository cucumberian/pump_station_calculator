"use strict";

const fs = require("fs");
const path = require("path");

// ---- shared mocks ----
const NODE_PORTS = { pump: [1, 1], delay: [1, 1], catch: [0, 1] };
const NODE_DEFAULTS = {
  pump: { name: "", desc: "", qr: 342.3, tr: 10, q: 100, idle: 50, mode: "analytic" },
  delay: { name: "", desc: "", v: 1, l: 3600 },
  catch: { name: "", desc: "", F: 3.9, q20: 80, P: 1.0, mr: 150, gamma: 1.54,
    psiMid: 0.634, zMid: 0.201, tcon: 3, tcan: 0,
    l1: 68, v1: 0.7, l2: 133, v2: 1.0, l3: 277, v3: 1.5, coeffMode: "variable" },
};

// ---- load cascade-nodes (for NODE_HTML) ----
const nodesSrc = fs.readFileSync(path.join(__dirname, "..", "static/js/cascade-nodes.js"), "utf8");
const nodesMod = new Function(
  nodesSrc + `
return { NODE_HTML, NODE_PORTS, NODE_DEFAULTS };
`,
)();

// ---- DOM mocks for cascade-io top-level code ----
global.$c = () => ({
  value: "0.71",
  hidden: false,
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  classList: { add: () => {}, remove: () => {}, toggle: () => {} },
  style: {},
  textContent: "",
  innerHTML: "",
  appendChild: () => {},
  append: () => {},
  focus: () => {},
  click: () => {},
});
global.document = {
  getElementById: global.$c,
  createElement: () => ({
    addEventListener: () => {}, setAttribute: () => {},
    style: {}, click: () => {},
  }),
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
};
global.window = {
  addEventListener: () => {},
  innerWidth: 1024,
  innerHeight: 768,
  matchMedia: () => ({ matches: false }),
};
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
};

// ---- load cascade-io with mocks ----
const ioPath = path.join(__dirname, "..", "static/js/cascade-io.js");
const cascadeSrc = fs.readFileSync(ioPath, "utf8");

const ioPrelude = `
const NODE_PORTS = ${JSON.stringify(NODE_PORTS)};
const NODE_DEFAULTS = ${JSON.stringify(NODE_DEFAULTS)};
const NODE_HTML = ${JSON.stringify(nodesMod.NODE_HTML)};

function getGlobalN() { return 0.71; }
`;

const ioMod = new Function(
  ioPrelude + cascadeSrc + `
return {
  validatePayload, migrateNodeData,
  serializeScheme, saveScheme,
  FORMAT, FORMAT_VERSION,
};
`,
)();

// ---- test helpers ----
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`\u2716 ${name}\n  ${e.message}`); }
}

// ============================================================
// validatePayload
// ============================================================

const MINIMAL_VALID = {
  format: "kns-cascade",
  version: 2,
  nodes: [{ id: 1, type: "pump", x: 100, y: 200 }],
  connections: [],
  n: 0.71,
};

test("validatePayload: valid minimal payload", () => {
  const errs = ioMod.validatePayload(MINIMAL_VALID);
  if (errs.length) throw new Error(`expected no errors, got: ${errs.join("; ")}`);
});

test("validatePayload: extra fields (nextId) ignored", () => {
  const p = { ...MINIMAL_VALID, nextId: 42 };
  const errs = ioMod.validatePayload(p);
  if (errs.length) throw new Error(`expected no errors, got: ${errs.join("; ")}`);
});

test("validatePayload: old format without nextId is valid", () => {
  const errs = ioMod.validatePayload(MINIMAL_VALID);
  if (errs.length) throw new Error(`old format should be valid, got: ${errs.join("; ")}`);
});

test("validatePayload: duplicate node IDs — not validated", () => {
  const p = {
    ...MINIMAL_VALID,
    nodes: [
      { id: 1, type: "pump", x: 100, y: 200 },
      { id: 1, type: "delay", x: 300, y: 400 },
    ],
  };
  const errs = ioMod.validatePayload(p);
  if (errs.length) throw new Error(`duplicate IDs not validated, but got error: ${errs.join("; ")}`);
});

test("validatePayload: missing nodes array", () => {
  const p = { format: "kns-cascade", version: 2, n: 0.71 };
  const errs = ioMod.validatePayload(p);
  if (!errs.some(e => e.includes("nodes"))) throw new Error(`expected 'nodes' error, got: ${errs.join("; ")}`);
});

test("validatePayload: invalid node type", () => {
  const p = {
    ...MINIMAL_VALID,
    nodes: [{ id: 1, type: "invalid", x: 100, y: 200 }],
  };
  const errs = ioMod.validatePayload(p);
  if (!errs.some(e => e.includes("неизвестный"))) throw new Error(`expected unknown type error, got: ${errs.join("; ")}`);
});

test("validatePayload: connection to non-existing node", () => {
  const p = {
    ...MINIMAL_VALID,
    connections: [{ from: 1, to: 999 }],
  };
  const errs = ioMod.validatePayload(p);
  if (!errs.some(e => e.includes("999"))) throw new Error(`expected connection error, got: ${errs.join("; ")}`);
});

test("validatePayload: null data field", () => {
  const p = {
    ...MINIMAL_VALID,
    nodes: [{ id: 1, type: "pump", x: 100, y: 200, data: null }],
  };
  const errs = ioMod.validatePayload(p);
  if (!errs.some(e => e.includes("data"))) throw new Error(`expected data error, got: ${errs.join("; ")}`);
});

test("validatePayload: n out of range", () => {
  const p = { ...MINIMAL_VALID, n: 2.5 };
  const errs = ioMod.validatePayload(p);
  if (!errs.some(e => e.includes("n"))) throw new Error(`expected n error, got: ${errs.join("; ")}`);
});

test("validatePayload: version too new", () => {
  const p = { ...MINIMAL_VALID, version: 99 };
  const errs = ioMod.validatePayload(p);
  if (!errs.some(e => e.includes("нов"))) throw new Error(`expected version error, got: ${errs.join("; ")}`);
});

test("validatePayload: non-JSON input", () => {
  const errs = ioMod.validatePayload("not an object");
  if (!errs.some(e => e.includes("JSON"))) throw new Error(`expected JSON error, got: ${errs.join("; ")}`);
});

test("validatePayload: null input", () => {
  const errs = ioMod.validatePayload(null);
  if (!errs.some(e => e.includes("JSON"))) throw new Error(`expected JSON error, got: ${errs.join("; ")}`);
});

// ============================================================
// migrateNodeData
// ============================================================

test("migrateNodeData: pump — keeps modern qr, tr", () => {
  const d = ioMod.migrateNodeData("pump", { qr: 300, tr: 12, q: 150 });
  if (d.qr !== 300) throw new Error(`expected qr=300, got ${d.qr}`);
  if (d.tr !== 12) throw new Error(`expected tr=12, got ${d.tr}`);
  if (d.q !== 150) throw new Error(`expected q=150, got ${d.q}`);
});

test("migrateNodeData: pump — migrates old Qr to qr", () => {
  const d = ioMod.migrateNodeData("pump", { Qr: 500, tr: 15, Q: 200 });
  if (d.qr !== 500) throw new Error(`expected qr=500, got ${d.qr}`);
  if (d.Qr !== undefined) throw new Error("Qr should be deleted");
  if (d.Q !== undefined) throw new Error("Q should be deleted");
  if (d.q !== 200) throw new Error(`expected q=200, got ${d.q}`);
});

test("migrateNodeData: pump — old Q migrates to q", () => {
  const d = ioMod.migrateNodeData("pump", { Qr: 500, tr: 15, Q: 200 });
  if (d.q !== 200) throw new Error(`expected q=200, got ${d.q}`);
  if (d.Q !== undefined) throw new Error("Q should be deleted");
});

test("migrateNodeData: delay — computes l from dt when l not in raw", () => {
  const d = ioMod.migrateNodeData("delay", { dt: 30, v: 1.5, l: undefined });
  // l = Math.round(dt * 60) = 1800
  if (d.l !== 1800) throw new Error(`expected l=1800, got ${d.l}`);
  if (d.v !== 1.5) throw new Error(`expected v=1.5, got ${d.v}`);
  if (d.dt !== undefined) throw new Error("dt should be deleted");
});

test("migrateNodeData: delay — default l kept when dt absent", () => {
  const d = ioMod.migrateNodeData("delay", { dt: 30, v: 1.5 });
  // NODE_DEFAULTS.delay has l=3600, so lOld=3600, dt ignored
  if (d.l !== 3600) throw new Error(`expected l=3600 (default kept), got ${d.l}`);
  if (d.dt !== undefined) throw new Error("dt should be deleted");
});

test("migrateNodeData: delay — explicit l wins over dt", () => {
  const d = ioMod.migrateNodeData("delay", { l: 500, dt: 30, v: 1 });
  if (d.l !== 500) throw new Error(`expected l=500 (preserved), got ${d.l}`);
  if (d.dt !== undefined) throw new Error("dt should be deleted");
});

test("migrateNodeData: delay — old L migrates to l", () => {
  const d = ioMod.migrateNodeData("delay", { L: "2500", v: 1, l: undefined });
  if (d.l !== 2500) throw new Error(`expected l=2500, got ${d.l}`);
  if (d.L !== undefined) throw new Error("L should be deleted");
});

test("migrateNodeData: catch — fills defaults for missing fields", () => {
  const d = ioMod.migrateNodeData("catch", {});
  if (d.F !== 3.9) throw new Error(`expected default F=3.9, got ${d.F}`);
  if (d.q20 !== 80) throw new Error(`expected default q20=80, got ${d.q20}`);
  if (d.coeffMode !== "variable") throw new Error(`expected coeffMode=variable, got ${d.coeffMode}`);
});

test("migrateNodeData: catch — keeps supplied fields", () => {
  const d = ioMod.migrateNodeData("catch", { F: 10, q20: 120, P: 5 });
  if (d.F !== 10) throw new Error(`expected F=10, got ${d.F}`);
  if (d.q20 !== 120) throw new Error(`expected q20=120, got ${d.q20}`);
  if (d.P !== 5) throw new Error(`expected P=5, got ${d.P}`);
  if (d.mr !== 150) throw new Error(`expected default mr=150, got ${d.mr}`);
});

// ============================================================
// serializeScheme — export format
// ============================================================

test("serializeScheme: correct format and version", () => {
  const savedGraphData = global.graphData;
  global.graphData = () => ({
    "1": { name: "pump", pos_x: 100, pos_y: 200, data: {},
      outputs: { output_1: { connections: [] } } },
  });
  const out = ioMod.serializeScheme();
  global.graphData = savedGraphData;
  if (out.format !== "kns-cascade") throw new Error(`format should be kns-cascade, got ${out.format}`);
  if (out.version !== 2) throw new Error(`version should be 2, got ${out.version}`);
  if (!Array.isArray(out.nodes)) throw new Error("nodes should be array");
});

test("serializeScheme: nodes include id, type, x, y, data", () => {
  const savedGraphData = global.graphData;
  global.graphData = () => ({
    "5": { name: "pump", pos_x: 320, pos_y: 160,
      data: { qr: 342.3, tr: 10, q: 100, idle: 50, mode: "analytic" },
      outputs: { output_1: { connections: [] } } },
  });
  const out = ioMod.serializeScheme();
  global.graphData = savedGraphData;
  const node = out.nodes[0];
  if (node.id !== 5) throw new Error(`expected id=5, got ${node.id}`);
  if (node.type !== "pump") throw new Error(`expected type=pump, got ${node.type}`);
  if (node.x !== 320) throw new Error(`expected x=320, got ${node.x}`);
  if (node.y !== 160) throw new Error(`expected y=160, got ${node.y}`);
  if (!node.data || node.data.qr !== 342.3) throw new Error("data should include qr");
});

test("serializeScheme: connections serialized", () => {
  const savedGraphData = global.graphData;
  global.graphData = () => ({
    "1": { name: "pump", pos_x: 100, pos_y: 100, data: {},
      outputs: { output_1: { connections: [{ node: "2" }] } } },
    "2": { name: "pump", pos_x: 300, pos_y: 100, data: {},
      outputs: { output_1: { connections: [] } } },
  });
  const out = ioMod.serializeScheme();
  global.graphData = savedGraphData;
  if (!out.connections.some(c => c.from === 1 && c.to === 2)) {
    throw new Error("connection 1→2 not found");
  }
});

// ============================================================
// round-trip: serializeScheme → validatePayload
// ============================================================

test("full round-trip: serializeScheme output passes validatePayload", () => {
  const savedGraphData = global.graphData;
  global.graphData = () => ({
    "1": { name: "catch", pos_x: 50, pos_y: 100, data: { F: 3.9, q20: 80, P: 1 },
      outputs: { output_1: { connections: [{ node: "2" }] } } },
    "2": { name: "pump", pos_x: 300, pos_y: 150,
      data: { qr: 342.3, tr: 10, q: 150, idle: 50, mode: "analytic" },
      outputs: { output_1: { connections: [] } } },
  });
  const out = ioMod.serializeScheme();
  global.graphData = savedGraphData;
  const errs = ioMod.validatePayload(out);
  if (errs.length) throw new Error(`round-trip validate failed: ${errs.join("; ")}`);
  if (out.nodes.length !== 2) throw new Error("expected 2 nodes");
  const catchNode = out.nodes.find(n => n.type === "catch");
  if (!catchNode) throw new Error("catch node missing");
  if (catchNode.id !== 1) throw new Error("catch id mismatch");
});

// ============================================================
// Итог
// ============================================================

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
process.exit(failed ? 1 : 0);

// 方案快照：整页状态的读取、规范化、本地保存，以及已存方案的快照存取。
// 快照包含声部混音设置，载入时整体恢复。

const storageKey = "wxyy-4-luogujing-grid";

function normalizePattern(source) {
  return instruments.map((instrument, rowIndex) => {
    const row = Array.isArray(source?.[rowIndex]) ? source[rowIndex] : [];
    return Array.from({ length: steps }, (_, step) =>
      instruments.some((candidate) => candidate.token === row[step]) ? row[step] : ""
    );
  });
}

function initialPattern() {
  return instruments.map((instrument) =>
    Array.from({ length: steps }, (_, index) => index % beatsPerMeasure === 0 ? instrument.token : "")
  );
}

function normalizeSnapshot(source) {
  const s = source && typeof source === "object" ? source : {};
  return {
    id: typeof s.id === "string" ? s.id : crypto.randomUUID(),
    name: typeof s.name === "string" ? s.name : "未命名片段",
    bpm: toFiniteNumber(s.bpm) && Number(s.bpm) >= 40 && Number(s.bpm) <= 220 ? Number(s.bpm) : 96,
    loop: ["", ...Array.from({ length: measureCount }, (_, i) => String(i))].includes(s.loop)
      ? s.loop
      : "",
    notes: Array.isArray(s.notes) ? s.notes.filter((n) => typeof n === "string") : [],
    pattern: normalizePattern(s.pattern),
    mix: normalizeMix(s.mix),
    createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString()
  };
}

// 兼容旧存档（没有 mix / saved 字段时补默认值）
function normalizeState(source) {
  const s = source && typeof source === "object" ? source : {};
  return {
    pieceName: typeof s.pieceName === "string" ? s.pieceName : "",
    bpm: toFiniteNumber(s.bpm) && Number(s.bpm) >= 40 && Number(s.bpm) <= 220 ? Number(s.bpm) : 96,
    loop: ["", ...Array.from({ length: measureCount }, (_, i) => String(i))].includes(s.loop)
      ? s.loop
      : "",
    notes: Array.isArray(s.notes) ? s.notes.filter((n) => typeof n === "string") : [],
    pattern: Array.isArray(s.pattern) ? normalizePattern(s.pattern) : initialPattern(),
    mix: normalizeMix(s.mix),
    saved: Array.isArray(s.saved) ? s.saved.map(normalizeSnapshot) : []
  };
}

function loadState() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(storageKey) || "null");
  } catch {
    stored = null;
  }
  return normalizeState(stored);
}

function persistState(state) {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

// 已存方案是当前编辑内容的完整快照（含声部设置）
function snapshotFromState(state) {
  return {
    id: crypto.randomUUID(),
    name: state.pieceName || "未命名片段",
    bpm: state.bpm,
    loop: state.loop,
    notes: [...state.notes],
    pattern: state.pattern.map((row) => [...row]),
    mix: cloneMix(state.mix),
    createdAt: new Date().toISOString()
  };
}

function applySnapshot(state, snapshot) {
  state.pieceName = snapshot.name;
  state.bpm = snapshot.bpm;
  state.loop = snapshot.loop;
  state.notes = [...snapshot.notes];
  state.pattern = snapshot.pattern.map((row) => [...row]);
  state.mix = cloneMix(snapshot.mix);
  return state;
}

function findSnapshot(state, id) {
  return state.saved.find((entry) => entry.id === id) || null;
}

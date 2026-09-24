// 方案快照：把段落、批注与声部设置一起保存、载入，并负责本地持久化。
window.Luogujing = window.Luogujing || {};

window.Luogujing.Schemes = (() => {
  const storageKey = "wxyy-4-luogujing-grid";
  const Mixer = window.Luogujing.Mixer;

  function snapshotFromState(state) {
    return {
      id: crypto.randomUUID(),
      name: state.pieceName || "未命名片段",
      bpm: state.bpm,
      loop: state.loop,
      notes: [...state.notes],
      pattern: state.pattern.map((row) => [...row]),
      mixer: Mixer.clone(state.mixer),
      createdAt: new Date().toISOString()
    };
  }

  function saveSnapshot(state) {
    state.saved.unshift(snapshotFromState(state));
  }

  function findSnapshot(state, id) {
    return state.saved.find((entry) => entry.id === id);
  }

  // 载入快照；早期方案没有声部设置时保留当前声部
  function applySnapshot(state, snapshot) {
    state.pieceName = snapshot.name;
    state.bpm = snapshot.bpm;
    state.loop = snapshot.loop;
    state.notes = [...(snapshot.notes || [])];
    state.pattern = snapshot.pattern.map((row) => [...row]);
    if (snapshot.mixer) state.mixer = Mixer.normalize(snapshot.mixer);
  }

  function persist(state) {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function restore() {
    const raw = JSON.parse(localStorage.getItem(storageKey) || "null");
    const state = raw || {
      pieceName: "出场锣鼓-慢起",
      bpm: 96,
      loop: "",
      notes: [],
      pattern: Mixer.instruments.map((instrument) =>
        Array.from({ length: Mixer.steps }, (_, index) => (index % 4 === 0 ? instrument.token : ""))
      ),
      saved: []
    };
    state.mixer = Mixer.normalize(state.mixer);
    state.saved = Array.isArray(state.saved) ? state.saved : [];
    return state;
  }

  return { snapshotFromState, saveSnapshot, findSnapshot, applySnapshot, persist, restore };
})();

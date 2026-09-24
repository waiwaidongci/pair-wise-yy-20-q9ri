// 页面控件：排练网格、声部面板、播放与方案列表的渲染和交互。
const { Mixer, Schemes } = window.Luogujing;
const { instruments, steps, beatsPerMeasure } = Mixer;

const state = Schemes.restore();

let timer = null;
let playhead = 0;
let audioContext = null;
let mixerTarget = ""; // "" 为全段，否则是要覆盖的小节序号（0 起）

const grid = document.querySelector("#grid");
const savedList = document.querySelector("#savedList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const pieceName = document.querySelector("#pieceName");
const bpmInput = document.querySelector("#bpmInput");
const loopSelect = document.querySelector("#loopSelect");
const noteInput = document.querySelector("#noteInput");
const mixerGrid = document.querySelector("#mixerGrid");
const mixerTargetSelect = document.querySelector("#mixerTarget");
const resetMeasureBtn = document.querySelector("#resetMeasureBtn");
const mixerMsg = document.querySelector("#mixerMsg");

function save() {
  Schemes.persist(state);
}

function syncFields() {
  pieceName.value = state.pieceName;
  bpmInput.value = state.bpm;
  loopSelect.value = state.loop;
  mixerTargetSelect.value = mixerTarget;
}

function beatLabel(index) {
  const measure = Math.floor(index / beatsPerMeasure) + 1;
  const beat = (index % beatsPerMeasure) + 1;
  return `${measure}-${beat}`;
}

function renderGrid() {
  const header = ['<div class="label-cell">乐器</div>'];
  for (let i = 0; i < steps; i += 1) {
    header.push(`<div class="beat-cell">${beatLabel(i)}</div>`);
  }

  const rows = instruments.flatMap((instrument, rowIndex) => {
    const row = [`<div class="label-cell">${instrument.name}</div>`];
    for (let step = 0; step < steps; step += 1) {
      const value = state.pattern[rowIndex][step];
      row.push(`<button class="cell ${value ? "filled" : ""}" type="button" data-row="${rowIndex}" data-step="${step}">${value}</button>`);
    }
    return row;
  });

  grid.innerHTML = [...header, ...rows].join("");
}

function renderMixer() {
  const measure = mixerTarget === "" ? null : Number(mixerTarget);
  const overrides = measure === null ? null : state.mixer.measures[measure];
  resetMeasureBtn.hidden = measure === null || !overrides;

  mixerGrid.innerHTML = instruments.map((instrument) => {
    const part = Mixer.effectiveFor(state.mixer, measure, instrument.name);
    const overridden = Boolean(overrides && overrides[instrument.name]);
    const badge = measure === null
      ? ""
      : `<span class="part-badge ${overridden ? "on" : ""}">${overridden ? "已覆盖全段" : "沿用全段"}</span>`;
    return `
      <article class="part-card" data-name="${instrument.name}">
        <header><strong>${instrument.name}</strong>${badge}</header>
        <label>音量（0-100）
          <input type="number" min="0" max="100" step="1" value="${part.volume}" data-field="volume">
        </label>
        <label>左右声道（-50 至 50）
          <input type="number" min="-50" max="50" step="1" value="${part.pan}" data-field="pan">
        </label>
        <label class="mute-row">
          <input type="checkbox" data-field="muted" ${part.muted ? "checked" : ""}> 静音
        </label>
      </article>
    `;
  }).join("");
}

function renderSidebars() {
  const filledByMeasure = Array.from({ length: Mixer.measureCount }, (_, measure) => {
    const start = measure * beatsPerMeasure;
    const count = state.pattern.flatMap((row) => row.slice(start, start + beatsPerMeasure)).filter(Boolean).length;
    return { measure: measure + 1, count };
  });
  structure.innerHTML = filledByMeasure.map((item) => `
    <div class="structure-row"><span>第${item.measure}小节</span><strong>${item.count}个口令</strong></div>
  `).join("");

  notesList.innerHTML = state.notes.length ? state.notes.map((note) => `
    <article class="note"><p>${note}</p></article>
  `).join("") : "<p>暂无批注。</p>";

  savedList.innerHTML = state.saved.length ? state.saved.map((item) => `
    <button class="saved-item" type="button" data-load="${item.id}">
      <strong>${item.name}</strong><br><span>${item.bpm}BPM · ${item.notes.length}条批注${item.mixer ? " · 含声部设置" : ""}</span>
    </button>
  `).join("") : "<p>还没有保存方案。</p>";
}

function render() {
  syncFields();
  renderGrid();
  renderMixer();
  renderSidebars();
}

function showMixerError(result) {
  mixerMsg.classList.add("error");
  if (result.reason === "volume") {
    mixerMsg.textContent = `${result.name}的音量需在 0 到 100 之间，已保留原设置。`;
  } else if (result.reason === "pan") {
    mixerMsg.textContent = `${result.name}的左右声道需在 -50 到 50 之间，已保留原设置。`;
  } else if (result.reason === "silence") {
    const detail = result.violations
      .map((item) => `第${item.measure}小节（${item.instruments.join("、")}）`)
      .join("；");
    mixerMsg.textContent = `修改未采用：${detail}已有口令，不能把发声的乐器全部静音。`;
  }
}

function clearMixerMsg() {
  mixerMsg.textContent = "";
  mixerMsg.classList.remove("error");
}

function playSound(instrument, part) {
  if (part.muted || part.volume <= 0) return;
  audioContext ||= new AudioContext();
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.frequency.value = instrument.freq;
  osc.type = instrument.name === "鼓" ? "sine" : "square";
  gain.gain.setValueAtTime(0.1 * (part.volume / 100), audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
  if (audioContext.createStereoPanner) {
    const panner = audioContext.createStereoPanner();
    panner.pan.value = part.pan / 50;
    osc.connect(gain).connect(panner).connect(audioContext.destination);
  } else {
    osc.connect(gain).connect(audioContext.destination);
  }
  osc.start();
  osc.stop(audioContext.currentTime + 0.09);
}

function highlight(step) {
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
  document.querySelectorAll(`[data-step="${step}"]`).forEach((cell) => cell.classList.add("playing"));
}

function currentRange() {
  if (state.loop === "") return [0, steps - 1];
  const start = Number(state.loop) * beatsPerMeasure;
  return [start, start + beatsPerMeasure - 1];
}

function tick() {
  const [start, end] = currentRange();
  if (playhead < start || playhead > end) playhead = start;
  highlight(playhead);
  const measure = Math.floor(playhead / beatsPerMeasure);
  instruments.forEach((instrument, rowIndex) => {
    if (!state.pattern[rowIndex][playhead]) return;
    playSound(instrument, Mixer.effectiveFor(state.mixer, measure, instrument.name));
  });
  playhead = playhead >= end ? start : playhead + 1;
}

grid.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);
  state.pattern[row][step] = state.pattern[row][step] ? "" : instruments[row].token;
  save();
  render();
});

pieceName.addEventListener("input", () => {
  state.pieceName = pieceName.value;
  save();
});

bpmInput.addEventListener("input", () => {
  state.bpm = Number(bpmInput.value || 96);
  save();
  if (timer) {
    clearInterval(timer);
    timer = setInterval(tick, 60000 / state.bpm);
  }
});

loopSelect.addEventListener("change", () => {
  state.loop = loopSelect.value;
  playhead = currentRange()[0];
  save();
});

noteInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !noteInput.value.trim()) return;
  state.notes.unshift(noteInput.value.trim());
  noteInput.value = "";
  save();
  renderSidebars();
});

mixerTargetSelect.addEventListener("change", () => {
  mixerTarget = mixerTargetSelect.value;
  clearMixerMsg();
  renderMixer();
});

mixerGrid.addEventListener("change", (event) => {
  const card = event.target.closest(".part-card");
  const field = event.target.dataset.field;
  if (!card || !field) return;
  const patch = field === "muted"
    ? { muted: event.target.checked }
    : { [field]: event.target.valueAsNumber };
  const result = Mixer.applyChange(state.mixer, state.pattern, mixerTarget, card.dataset.name, patch);
  if (result.ok) {
    state.mixer = result.mixer;
    clearMixerMsg();
    save();
  } else {
    showMixerError(result);
  }
  renderMixer();
});

resetMeasureBtn.addEventListener("click", () => {
  if (mixerTarget === "") return;
  const result = Mixer.clearMeasure(state.mixer, state.pattern, Number(mixerTarget));
  if (result.ok) {
    state.mixer = result.mixer;
    clearMixerMsg();
    save();
    renderMixer();
  } else {
    showMixerError(result);
  }
});

document.querySelector("#playBtn").addEventListener("click", () => {
  if (timer) clearInterval(timer);
  playhead = currentRange()[0];
  tick();
  timer = setInterval(tick, 60000 / state.bpm);
});

document.querySelector("#stopBtn").addEventListener("click", () => {
  clearInterval(timer);
  timer = null;
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  Schemes.saveSnapshot(state);
  save();
  renderSidebars();
});

savedList.addEventListener("click", (event) => {
  const id = event.target.closest("[data-load]")?.dataset.load;
  const item = Schemes.findSnapshot(state, id);
  if (!item) return;
  Schemes.applySnapshot(state, item);
  clearMixerMsg();
  save();
  render();
});

render();

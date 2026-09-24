// 页面控件：网格、声部控制台、侧栏、播放与所有交互事件的绑定。
// 依赖 parts.js（声部逻辑）与 snapshot.js（存档/快照）。

const state = loadState();

let timer = null;
let playhead = 0;
let audioContext = null;

const grid = document.querySelector("#grid");
const mixConsole = document.querySelector("#mixConsole");
const savedList = document.querySelector("#savedList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const pieceName = document.querySelector("#pieceName");
const bpmInput = document.querySelector("#bpmInput");
const loopSelect = document.querySelector("#loopSelect");
const noteInput = document.querySelector("#noteInput");

function save() {
  persistState(state);
}

function valueOrDash(value) {
  return value == null || value === "" ? "—" : value;
}

function syncFields() {
  pieceName.value = state.pieceName;
  bpmInput.value = state.bpm;
  loopSelect.value = state.loop;
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

// 声部控制台：上半为全段声部设置，下半为逐小节覆盖
function renderMixConsole() {
  const globalRows = instruments.map((instrument, i) => {
    const part = state.mix.global[i];
    return `
      <div class="mix-row">
        <span class="part-name">${instrument.name}</span>
        <label class="mute"><input type="checkbox" data-global="${i}" data-field="muted" ${part.muted ? "checked" : ""}>静音</label>
        <label>音量
          <input type="number" min="${volumeRange.min}" max="${volumeRange.max}" value="${part.volume}" data-global="${i}" data-field="volume">
        </label>
        <label>声道<span class="hint">左${panRange.min}~右${panRange.max}</span>
          <input type="number" min="${panRange.min}" max="${panRange.max}" value="${part.pan}" data-global="${i}" data-field="pan">
        </label>
      </div>`;
  }).join("");

  const measureCards = Array.from({ length: measureCount }, (_, measure) => {
    const override = state.mix.measures[measure];
    const enabled = Array.isArray(override);
    const partRows = instruments.map((instrument, i) => {
      const base = state.mix.global[i];
      const slot = override?.[i] || createEmptyOverride();
      const mutedValue = slot.muted == null ? "" : slot.muted ? "1" : "0";
      return `
        <div class="measure-row">
          <label class="mute">${instrument.name}
            <select data-measure="${measure}" data-part="${i}" data-field="muted" ${enabled ? "" : "disabled"}>
              <option value=""${mutedValue === "" ? " selected" : ""}>跟随全段</option>
              <option value="1"${mutedValue === "1" ? " selected" : ""}>静音</option>
              <option value="0"${mutedValue === "0" ? " selected" : ""}>发声</option>
            </select>
          </label>
          <label>音量
            <input type="number" min="${volumeRange.min}" max="${volumeRange.max}"
              value="${valueOrDash(slot.volume)}" placeholder="跟随(${base.volume})"
              data-measure="${measure}" data-part="${i}" data-field="volume" ${enabled ? "" : "disabled"}>
          </label>
          <label>声道
            <input type="number" min="${panRange.min}" max="${panRange.max}"
              value="${valueOrDash(slot.pan)}" placeholder="跟随(${base.pan})"
              data-measure="${measure}" data-part="${i}" data-field="pan" ${enabled ? "" : "disabled"}>
          </label>
        </div>`;
    }).join("");

    return `
      <article class="measure-card${enabled ? " active" : ""}">
        <div class="measure-head">
          <strong>第${measure + 1}小节</strong>
          <label class="override-toggle">
            <input type="checkbox" data-override-measure="${measure}" ${enabled ? "checked" : ""}>覆盖全段
          </label>
        </div>
        ${partRows}
      </article>`;
  }).join("");

  mixConsole.innerHTML = `
    <div class="mix-panel">
      <h2>全段声部</h2>
      <div class="mix-global">${globalRows}</div>
    </div>
    <div class="mix-panel">
      <h2>小节覆盖<small class="panel-hint">空值即跟随全段；播放按当前小节合并</small></h2>
      <div class="measure-grid">${measureCards}</div>
      <p id="mixStatus" class="mix-status" role="status" aria-live="polite"></p>
    </div>`;
}

function showMixStatus(message, isError = false) {
  const status = document.querySelector("#mixStatus");
  if (!status) return;
  status.textContent = message || "";
  status.classList.toggle("error", Boolean(isError));
}

function renderSidebars() {
  const filledByMeasure = Array.from({ length: measureCount }, (_, measure) => {
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

  savedList.innerHTML = state.saved.length ? state.saved.map((item) => {
    const overrideCount = item.mix.measures.filter(Boolean).length;
    return `
    <button class="saved-item" type="button" data-load="${item.id}">
      <strong>${item.name}</strong><br><span>${item.bpm}BPM · ${item.notes.length}条批注 · 声部覆盖${overrideCount}小节</span>
    </button>`;
  }).join("") : "<p>还没有保存方案。</p>";
}

function render() {
  syncFields();
  renderGrid();
  renderMixConsole();
  renderSidebars();
}

function playSound(instrument, part) {
  if (part.muted || part.volume <= 0) return;
  audioContext ||= new AudioContext();
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const panner = audioContext.createStereoPanner();
  osc.frequency.value = instrument.freq;
  osc.type = instrument.name === "鼓" ? "sine" : "square";
  gain.gain.setValueAtTime(0.08 * part.volume / 100, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
  panner.pan.value = part.pan / 50; // 声道 -50~50 映射到全左~全右
  osc.connect(gain).connect(panner).connect(audioContext.destination);
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
    playSound(instrument, effectivePart(state.mix, measure, rowIndex)); // 当前小节覆盖发声
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

// 全段声部控件：音量/声道超范围（如 120、-60）时驳回并保留原设置
mixConsole.addEventListener("change", (event) => {
  const control = event.target.closest("input, select");
  if (!control) return;
  showMixStatus("");

  if (control.dataset.overrideMeasure !== undefined) {
    setMeasureOverrideEnabled(state, Number(control.dataset.overrideMeasure), control.checked);
    save();
    renderMixConsole();
    return;
  }

  if (control.dataset.global !== undefined) {
    const partIndex = Number(control.dataset.global);
    const field = control.dataset.field;
    const raw = field === "muted" ? control.checked : control.value;
    const result = applyGlobalPart(state, partIndex, field, raw);
    if (!result.ok) {
      showMixStatus(`全段·${instruments[partIndex].name}${field === "volume" ? "音量" : "声道"}超出范围，已保留原值 ${result.retained}。`, true);
    }
    save();
    renderMixConsole();
    return;
  }

  if (control.dataset.measure !== undefined) {
    const measure = Number(control.dataset.measure);
    const partIndex = Number(control.dataset.part);
    const field = control.dataset.field;
    const result = applyMeasurePart(state, measure, partIndex, field, control.value);
    if (!result.ok) {
      if (result.reason === "range") {
        showMixStatus(`第${measure + 1}小节·${instruments[partIndex].name}${field === "volume" ? "音量" : "声道"}超出范围，已保留原值 ${valueOrDash(result.retained) || "跟随全段"}。`, true);
      } else {
        // 有口令的乐器被全部静音：修改不采用
        showMixStatus(`第${result.measure + 1}小节已有口令，${result.instruments.join("、")}全部静音会导致该小节无声，修改未采用。`, true);
      }
    }
    save();
    renderMixConsole();
  }
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
  state.saved.unshift(snapshotFromState(state)); // 声部设置随方案一同保存
  save();
  renderSidebars();
});

savedList.addEventListener("click", (event) => {
  const id = event.target.closest("[data-load]")?.dataset.load;
  const item = findSnapshot(state, id);
  if (!item) return;
  applySnapshot(state, normalizeSnapshot(item));
  save();
  render();
});

render();

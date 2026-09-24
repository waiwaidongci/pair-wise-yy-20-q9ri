// 声部控制：管理大锣、鼓、钹、小锣的音量、左右声道与静音。
// 全段设置可被任意小节覆盖（覆盖项为 null 时跟随全段），播放时合并生效。

const instruments = [
  { name: "大锣", token: "仓", freq: 180 },
  { name: "鼓", token: "冬", freq: 120 },
  { name: "钹", token: "才", freq: 360 },
  { name: "小锣", token: "台", freq: 520 }
];

const steps = 16;
const beatsPerMeasure = 4;
const measureCount = steps / beatsPerMeasure;

const volumeRange = { min: 0, max: 100 };
const panRange = { min: -50, max: 50 };

function createDefaultPart() {
  return { volume: 80, pan: 0, muted: false };
}

// 小节覆盖槽位：null 表示该属性跟随全段设置
function createEmptyOverride() {
  return { volume: null, pan: null, muted: null };
}

function createDefaultMix() {
  return {
    global: instruments.map(createDefaultPart),
    measures: Array.from({ length: measureCount }, () => null)
  };
}

function inRange(value, { min, max }) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function normalizePart(source, fallback = createDefaultPart()) {
  const src = source && typeof source === "object" ? source : {};
  const volume = toFiniteNumber(src.volume);
  const pan = toFiniteNumber(src.pan);
  return {
    volume: inRange(volume, volumeRange) ? volume : fallback.volume,
    pan: inRange(pan, panRange) ? pan : fallback.pan,
    muted: Boolean(src.muted)
  };
}

function normalizeOverrideSlot(source) {
  const src = source && typeof source === "object" ? source : {};
  const slot = createEmptyOverride();
  const volume = toFiniteNumber(src.volume);
  const pan = toFiniteNumber(src.pan);
  if (inRange(volume, volumeRange)) slot.volume = volume;
  if (inRange(pan, panRange)) slot.pan = pan;
  if (typeof src.muted === "boolean") slot.muted = src.muted;
  return slot;
}

// 读取存档时校验并补全声部数据，非法值直接回落到默认/跟随
function normalizeMix(source) {
  const mix = createDefaultMix();
  if (!source || typeof source !== "object") return mix;
  if (Array.isArray(source.global)) {
    mix.global = mix.global.map((fallback, i) => normalizePart(source.global[i], fallback));
  }
  if (Array.isArray(source.measures)) {
    mix.measures = mix.measures.map((_, measure) => {
      const override = source.measures[measure];
      return Array.isArray(override)
        ? instruments.map((_, i) => normalizeOverrideSlot(override[i]))
        : null;
    });
  }
  return mix;
}

function cloneMix(mix) {
  return {
    global: mix.global.map((part) => ({ ...part })),
    measures: mix.measures.map((override) =>
      Array.isArray(override) ? override.map((slot) => ({ ...slot })) : null
    )
  };
}

// 合并全段设置与指定小节覆盖，得到播放用的最终声部参数
function effectivePart(mix, measure, partIndex) {
  const base = mix.global[partIndex];
  const slot = mix.measures[measure]?.[partIndex] || createEmptyOverride();
  return {
    volume: slot.volume == null ? base.volume : slot.volume,
    pan: slot.pan == null ? base.pan : slot.pan,
    muted: slot.muted == null ? base.muted : slot.muted
  };
}

// 找出某小节里真正有口令（占了步格）的乐器序号
function partIndexesHitting(pattern, measure) {
  const start = measure * beatsPerMeasure;
  return instruments
    .map((_, i) => i)
    .filter((i) => (pattern[i] || []).slice(start, start + beatsPerMeasure).some(Boolean));
}

function ensureMeasureOverride(mix, measure) {
  if (!mix.measures[measure]) {
    mix.measures[measure] = instruments.map(createEmptyOverride);
  }
  return mix.measures[measure];
}

// 解析控件输入：空串表示小节覆盖里的“跟随全段”；超范围返回 { ok: false }
function readControlValue(field, raw) {
  if (raw === null || raw === undefined || raw === "") return { ok: true, inherit: true };
  if (field === "muted") return { ok: true, value: raw === true || raw === "1" };
  const value = toFiniteNumber(raw);
  const range = field === "volume" ? volumeRange : panRange;
  return inRange(value, range) ? { ok: true, value } : { ok: false };
}

// 修改全段声部设置；音量/声道超范围时驳回并保留原值
function applyGlobalPart(state, partIndex, field, raw) {
  const part = state.mix.global[partIndex];
  if (field === "muted") {
    part.muted = Boolean(raw);
    return { ok: true };
  }
  const parsed = readControlValue(field, raw);
  if (!parsed.ok || parsed.inherit) {
    return { ok: false, reason: "range", field, retained: part[field] };
  }
  part[field] = parsed.value;
  return { ok: true };
}

// 修改某小节的覆盖设置。
// 若该小节已有口令、而所有有口令的乐器修改后都处于静音，则驳回并指出小节与乐器。
function applyMeasurePart(state, measure, partIndex, field, raw) {
  const override = ensureMeasureOverride(state.mix, measure);
  const slot = override[partIndex];
  const previous = slot[field];
  const parsed = readControlValue(field, raw);
  if (!parsed.ok) {
    return { ok: false, reason: "range", field, retained: previous == null ? "" : previous };
  }

  slot[field] = parsed.inherit ? null : parsed.value;

  const hitting = partIndexesHitting(state.pattern, measure);
  const allMuted = hitting.length > 0
    && hitting.every((i) => effectivePart(state.mix, measure, i).muted);
  if (allMuted) {
    slot[field] = previous; // 回滚，修改不采用
    return {
      ok: false,
      reason: "all-muted",
      measure,
      instruments: hitting.map((i) => instruments[i].name)
    };
  }
  return { ok: true };
}

function setMeasureOverrideEnabled(state, measure, enabled) {
  state.mix.measures[measure] = enabled
    ? ensureMeasureOverride(state.mix, measure)
    : null;
}

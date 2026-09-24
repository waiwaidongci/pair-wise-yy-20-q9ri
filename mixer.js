// 声部控制：大锣、鼓、钹、小锣的音量 / 左右声道 / 静音，
// 支持全段设置与逐小节覆盖，并负责数值范围与静音校验。
window.Luogujing = window.Luogujing || {};

window.Luogujing.Mixer = (() => {
  const instruments = [
    { name: "大锣", token: "仓", freq: 180 },
    { name: "鼓", token: "冬", freq: 120 },
    { name: "钹", token: "才", freq: 360 },
    { name: "小锣", token: "台", freq: 520 }
  ];
  const steps = 16;
  const beatsPerMeasure = 4;
  const measureCount = steps / beatsPerMeasure;
  const names = instruments.map((instrument) => instrument.name);

  const VOLUME_MIN = 0;
  const VOLUME_MAX = 100;
  const PAN_MIN = -50;
  const PAN_MAX = 50;

  function defaultPart() {
    return { volume: 80, pan: 0, muted: false };
  }

  function createDefault() {
    const global = {};
    names.forEach((name) => {
      global[name] = defaultPart();
    });
    return { global, measures: {} };
  }

  function clone(mixer) {
    return JSON.parse(JSON.stringify(mixer));
  }

  function clamp(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  function sanitizePart(raw, fallback) {
    const base = fallback || defaultPart();
    if (!raw || typeof raw !== "object") return { ...base };
    return {
      volume: clamp(raw.volume, VOLUME_MIN, VOLUME_MAX, base.volume),
      pan: clamp(raw.pan, PAN_MIN, PAN_MAX, base.pan),
      muted: Boolean(raw.muted)
    };
  }

  // 兼容旧数据：缺什么补什么
  function normalize(raw) {
    const mixer = createDefault();
    if (!raw || typeof raw !== "object") return mixer;
    names.forEach((name) => {
      mixer.global[name] = sanitizePart(raw.global ? raw.global[name] : null, mixer.global[name]);
    });
    Object.entries(raw.measures || {}).forEach(([key, parts]) => {
      const measure = Number(key);
      if (!Number.isInteger(measure) || measure < 0 || measure >= measureCount || !parts) return;
      names.forEach((name) => {
        if (!parts[name]) return;
        const overrides = mixer.measures[measure] || (mixer.measures[measure] = {});
        overrides[name] = sanitizePart(parts[name], mixer.global[name]);
      });
    });
    return mixer;
  }

  // 生效设置：小节覆盖优先，缺省跟随全段
  function effectiveFor(mixer, measure, name) {
    const overrides = mixer.measures ? mixer.measures[measure] : null;
    return (overrides && overrides[name]) || mixer.global[name] || defaultPart();
  }

  function inRange(value, min, max) {
    return Number.isFinite(value) && value >= min && value <= max;
  }

  // 已有口令、但发声乐器全部被静音的小节
  function silencedMeasures(mixer, pattern) {
    const result = [];
    for (let measure = 0; measure < measureCount; measure += 1) {
      const start = measure * beatsPerMeasure;
      const active = names.filter((name, row) =>
        pattern[row] && pattern[row].slice(start, start + beatsPerMeasure).some(Boolean)
      );
      if (active.length && active.every((name) => effectiveFor(mixer, measure, name).muted)) {
        result.push({ measure: measure + 1, instruments: active });
      }
    }
    return result;
  }

  // 只拦“本次修改新造成”的静音小节，避免旧状态锁死后续修正
  function freshViolations(before, after, pattern) {
    const existing = silencedMeasures(before, pattern).map((item) => item.measure);
    return silencedMeasures(after, pattern).filter((item) => !existing.includes(item.measure));
  }

  // 修改某件乐器的声部设置；target 为 "" 表示全段，否则为小节序号（0 起）
  function applyChange(mixer, pattern, target, name, patch) {
    if (!names.includes(name)) return { ok: false, reason: "unknown", name };
    if (patch.volume !== undefined && !inRange(patch.volume, VOLUME_MIN, VOLUME_MAX)) {
      return { ok: false, reason: "volume", name };
    }
    if (patch.pan !== undefined && !inRange(patch.pan, PAN_MIN, PAN_MAX)) {
      return { ok: false, reason: "pan", name };
    }
    const next = clone(mixer);
    if (target === "" || target === null || target === undefined) {
      next.global[name] = { ...next.global[name], ...patch };
    } else {
      const measure = Number(target);
      const overrides = next.measures[measure] || (next.measures[measure] = {});
      overrides[name] = { ...effectiveFor(next, measure, name), ...patch };
    }
    const violations = freshViolations(mixer, next, pattern);
    if (violations.length) return { ok: false, reason: "silence", violations };
    return { ok: true, mixer: next };
  }

  // 清除某小节的全部覆盖，恢复跟随全段
  function clearMeasure(mixer, pattern, measure) {
    const next = clone(mixer);
    delete next.measures[measure];
    const violations = freshViolations(mixer, next, pattern);
    if (violations.length) return { ok: false, reason: "silence", violations };
    return { ok: true, mixer: next };
  }

  return {
    instruments,
    steps,
    beatsPerMeasure,
    measureCount,
    names,
    VOLUME_MIN,
    VOLUME_MAX,
    PAN_MIN,
    PAN_MAX,
    createDefault,
    normalize,
    clone,
    effectiveFor,
    silencedMeasures,
    applyChange,
    clearMeasure
  };
})();

// Badge Press — local templates, fill-in, and 300 DPI export.

const PRINT_DPI = 300;
const PREVIEW_DPI = 200;
const FONTS = ["Arial", "Arial Narrow", "Bahnschrift", "Calibri", "Cambria", "Candara", "Century Gothic", "Consolas", "Corbel", "Georgia", "Impact", "Segoe UI", "Tahoma", "Trebuchet MS", "Verdana"];
const PRESETS = [
  { id: "2x3", name: "2 × 3 in portrait", w: 2, h: 3 },
  { id: "3x2", name: "3 × 2 in landscape", w: 3, h: 2 },
  { id: "cr80p", name: "CR80 portrait (2.125 × 3.375)", w: 2.125, h: 3.375 },
  { id: "cr80l", name: "CR80 landscape (3.375 × 2.125)", w: 3.375, h: 2.125 },
];

const nodes = {};
function $(id) {
  if (!nodes[id]) {
    const node = document.getElementById(id);
    if (!node) throw new Error("Missing #" + id);
    nodes[id] = node;
  }
  return nodes[id];
}

const state = {
  mode: "design",
  templates: [],
  activeId: null,
  people: [],
  checked: new Set(),
  selectedField: "photo",
  grid: true,
  safe: false,
  showSample: true,
  form: blankForm(),
};

const images = { bg: new Map(), photo: new Map() };
const rowUrls = new Map();
let dbPromise = null;
let saveTimer = 0;
let saveToken = 0;
let personTimer = 0;
let cameraStream = null;

function blankForm() {
  return {
    id: null,
    name: "",
    subtitle: "",
    photoBlob: null,
    photoImage: null,
    photoUrl: "",
    focusX: 0.5,
    focusY: 0.35,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundIn(value) {
  return Math.round(value * 1000) / 1000;
}

function formatIn(value) {
  return (Math.round(value * 1000) / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function numberOr(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeHex(value, fallback) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback;
}

function safeName(value) {
  const cleaned = String(value || "badge").replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return cleaned || "badge";
}

function setStatus(text) {
  $("status").textContent = text;
}

function getTemplate() {
  return state.templates.find((template) => template.id === state.activeId) || null;
}

function matchPreset(width, height) {
  const found = PRESETS.find((preset) => Math.abs(preset.w - width) < 0.001 && Math.abs(preset.h - height) < 0.001);
  return found ? found.id : "custom";
}

function textDefaults(partial) {
  return Object.assign({
    x: 0.15,
    y: 2,
    w: 1.7,
    h: 0.45,
    font: "Arial",
    sizePt: 26,
    color: "#1c1915",
    align: "center",
    bold: true,
    italic: false,
    upper: false,
    tracking: 0,
    autoFit: true,
    enabled: true,
  }, partial);
}

function defaultFields(width, height) {
  return {
    photo: {
      x: roundIn(width * 0.18),
      y: roundIn(height * 0.08),
      w: roundIn(width * 0.64),
      h: roundIn(height * 0.5),
      shape: "rounded",
      radius: roundIn(Math.min(width, height) * 0.03),
      borderPt: 0,
      borderColor: "#ffffff",
    },
    name: textDefaults({
      x: roundIn(width * 0.06),
      y: roundIn(height * 0.64),
      w: roundIn(width * 0.88),
      h: roundIn(height * 0.16),
      sizePt: clamp(Math.round(height * 9), 14, 64),
      bold: true,
    }),
    subtitle: textDefaults({
      x: roundIn(width * 0.08),
      y: roundIn(height * 0.82),
      w: roundIn(width * 0.84),
      h: roundIn(height * 0.1),
      sizePt: clamp(Math.round(height * 4.5), 8, 36),
      bold: false,
      enabled: false,
    }),
  };
}

function normalizeTemplate(raw) {
  const widthIn = clamp(numberOr(raw.widthIn, 2), 0.5, 12);
  const heightIn = clamp(numberOr(raw.heightIn, 3), 0.5, 12);
  const base = defaultFields(widthIn, heightIn);
  const fields = raw.fields || {};
  return {
    id: raw.id || crypto.randomUUID(),
    name: String(raw.name || "Untitled badge").slice(0, 80),
    preset: raw.preset || matchPreset(widthIn, heightIn),
    widthIn,
    heightIn,
    backgroundColor: normalizeHex(raw.backgroundColor, "#f4efe6"),
    backgroundFit: ["cover", "contain", "stretch"].includes(raw.backgroundFit) ? raw.backgroundFit : "cover",
    backgroundBlob: raw.backgroundBlob || null,
    backgroundType: raw.backgroundType || "",
    fields: {
      photo: Object.assign({}, base.photo, fields.photo || {}),
      name: Object.assign({}, base.name, fields.name || {}),
      subtitle: Object.assign({}, base.subtitle, fields.subtitle || {}),
    },
    sampleName: raw.sampleName || "Alex Morgan",
    sampleSubtitle: raw.sampleSubtitle || "Guest",
    updated: raw.updated || Date.now(),
  };
}

function createTemplate(name, presetId) {
  const preset = PRESETS.find((item) => item.id === presetId) || PRESETS[0];
  return normalizeTemplate({
    id: crypto.randomUUID(),
    name: name || "Untitled badge",
    preset: preset.id,
    widthIn: preset.w,
    heightIn: preset.h,
    backgroundColor: "#f4efe6",
    backgroundFit: "cover",
    fields: defaultFields(preset.w, preset.h),
    sampleName: "Alex Morgan",
    sampleSubtitle: "Guest",
  });
}

function clampField(field, template) {
  field.w = clamp(roundIn(field.w), 0.12, template.widthIn);
  field.h = clamp(roundIn(field.h), 0.12, template.heightIn);
  field.x = clamp(roundIn(field.x), 0, roundIn(template.widthIn - field.w));
  field.y = clamp(roundIn(field.y), 0, roundIn(template.heightIn - field.h));
  if (field.radius != null) field.radius = clamp(roundIn(field.radius), 0, Math.min(field.w, field.h) / 2);
}

function resizeTemplate(template, width, height) {
  const nextW = clamp(width, 0.5, 12);
  const nextH = clamp(height, 0.5, 12);
  const sx = nextW / template.widthIn;
  const sy = nextH / template.heightIn;
  for (const field of Object.values(template.fields)) {
    field.x *= sx;
    field.y *= sy;
    field.w *= sx;
    field.h *= sy;
    if (field.radius) field.radius *= (sx + sy) / 2;
    clampField(field, { widthIn: nextW, heightIn: nextH });
  }
  template.widthIn = nextW;
  template.heightIn = nextH;
  template.preset = matchPreset(nextW, nextH);
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Storage failed"));
    tx.onabort = () => reject(tx.error || new Error("Storage was aborted"));
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("badgepress", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("templates")) db.createObjectStore("templates", { keyPath: "id" });
      if (!db.objectStoreNames.contains("people")) {
        const store = db.createObjectStore("people", { keyPath: "id" });
        store.createIndex("templateId", "templateId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error("Could not open storage"));
    };
  });
  return dbPromise;
}

async function idbPut(storeName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(value);
  await txDone(tx);
}

async function idbDelete(storeName, id) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).delete(id);
  await txDone(tx);
}

async function idbAll(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  const request = tx.objectStore(storeName).getAll();
  const rows = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  await txDone(tx);
  return rows;
}

async function loadPeople(templateId) {
  const db = await openDb();
  const tx = db.transaction("people", "readonly");
  const request = tx.objectStore("people").index("templateId").getAll(templateId);
  const rows = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  await txDone(tx);
  rows.sort((a, b) => (a.created || 0) - (b.created || 0));
  return rows;
}

function templateRecord(template) {
  return {
    id: template.id,
    name: template.name,
    preset: template.preset,
    widthIn: template.widthIn,
    heightIn: template.heightIn,
    backgroundColor: template.backgroundColor,
    backgroundFit: template.backgroundFit,
    backgroundBlob: template.backgroundBlob || null,
    backgroundType: template.backgroundType || "",
    fields: template.fields,
    sampleName: template.sampleName,
    sampleSubtitle: template.sampleSubtitle,
    updated: Date.now(),
  };
}

async function saveTemplate(template) {
  template.updated = Date.now();
  await idbPut("templates", templateRecord(template));
}

function touchTemplate() {
  const template = getTemplate();
  if (!template) return;
  const token = ++saveToken;
  const id = template.id;
  renderDesign();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (token !== saveToken) return;
    const current = getTemplate();
    if (!current || current.id !== id) return;
    try {
      await saveTemplate(current);
      setStatus("Template saved");
    } catch (err) {
      console.error(err);
      setStatus("Could not save the template.");
    }
  }, 400);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Could not encode the image."));
      else resolve(blob);
    }, type, quality);
  });
}

function loadImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    image.src = url;
  });
}

async function loadBitmap(blob) {
  const type = blob.type || "";
  if (type.includes("svg")) return loadImageElement(blob);
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch (err) {
    return loadImageElement(blob);
  }
}

function isSvgFile(file) {
  return /svg/i.test(file.type || "") || /\.svg$/i.test(file.name || "");
}

function ensureSvgSize(text) {
  if (/<svg\b[^>]*\swidth=/i.test(text)) return text;
  const viewBox = text.match(/viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  const width = viewBox ? Math.abs(parseFloat(viewBox[1])) : 600;
  const height = viewBox ? Math.abs(parseFloat(viewBox[2])) : 900;
  return text.replace(/<svg\b/i, `<svg width="${width}" height="${height}"`);
}

async function prepareBackground(file) {
  if (isSvgFile(file)) {
    const text = ensureSvgSize(await file.text());
    const blob = new Blob([text], { type: "image/svg+xml" });
    return { blob, type: "svg", image: await loadImageElement(blob) };
  }
  const image = await loadBitmap(file);
  const edge = Math.max(image.width, image.height);
  if (edge <= 2400 && /png/i.test(file.type || "")) return { blob: file, type: "png", image };
  const scale = Math.min(1, 2400 / edge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, "image/png");
  return { blob, type: "png", image: await loadBitmap(blob) };
}

async function downscalePhoto(blob) {
  const image = await loadBitmap(blob);
  const edge = Math.max(image.width, image.height);
  if (edge <= 1600 && /jpeg|jpg/i.test(blob.type || "") && blob.size < 1500000) return { blob, image };
  const scale = Math.min(1, 1600 / edge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const out = await canvasToBlob(canvas, "image/jpeg", 0.92);
  return { blob: out, image: await loadBitmap(out) };
}

function drawFit(ctx, img, x, y, w, h, fit, fx, fy) {
  if (!img || !img.width || !img.height) return;
  if (fit === "stretch") {
    ctx.drawImage(img, x, y, w, h);
    return;
  }
  const imageRatio = img.width / img.height;
  const boxRatio = w / h;
  if (fit === "contain") {
    const dw = imageRatio > boxRatio ? w : h * imageRatio;
    const dh = imageRatio > boxRatio ? w / imageRatio : h;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return;
  }
  if (imageRatio > boxRatio) {
    const dw = h * imageRatio;
    ctx.drawImage(img, x + (w - dw) * fx, y, dw, h);
  } else {
    const dh = w / imageRatio;
    ctx.drawImage(img, x, y + (h - dh) * fy, w, dh);
  }
}

function roundRectPath(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function tracePhotoPath(ctx, x, y, w, h, field, dpi) {
  ctx.beginPath();
  if (field.shape === "circle") {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    return;
  }
  if (field.shape === "rounded") {
    roundRectPath(ctx, x, y, w, h, (field.radius || 0) * dpi);
    return;
  }
  ctx.rect(x, y, w, h);
}

function drawSamplePerson(ctx, x, y, w, h) {
  const gradient = ctx.createLinearGradient(x, y, x, y + h);
  gradient.addColorStop(0, "#d9d2c6");
  gradient.addColorStop(1, "#b7aea2");
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#f7f3ec";
  const cx = x + w / 2;
  ctx.beginPath();
  ctx.arc(cx, y + h * 0.34, Math.min(w, h) * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.78, w * 0.34, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPhoto(ctx, template, model, dpi) {
  const field = template.fields.photo;
  const x = field.x * dpi;
  const y = field.y * dpi;
  const w = field.w * dpi;
  const h = field.h * dpi;
  ctx.save();
  tracePhotoPath(ctx, x, y, w, h, field, dpi);
  ctx.clip();
  if (model.photoImage) drawFit(ctx, model.photoImage, x, y, w, h, "cover", model.focusX ?? 0.5, model.focusY ?? 0.35);
  else if (model.samplePhoto) drawSamplePerson(ctx, x, y, w, h);
  ctx.restore();
  if (field.borderPt > 0) {
    tracePhotoPath(ctx, x, y, w, h, field, dpi);
    ctx.strokeStyle = field.borderColor || "#ffffff";
    ctx.lineWidth = (field.borderPt * dpi) / 72;
    ctx.stroke();
  }
}

function drawTextField(ctx, field, value, dpi) {
  const raw = String(value || "");
  const text = field.upper ? raw.toUpperCase() : raw;
  if (!text.trim()) return;
  const x = field.x * dpi;
  const y = field.y * dpi;
  const w = field.w * dpi;
  const h = field.h * dpi;
  const pad = Math.max(2, w * 0.04);
  const family = `"${String(field.font || "Arial").replace(/"/g, "")}"`;
  let sizePt = numberOr(field.sizePt, 24);
  const minPt = 7;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const applyFont = (pt) => {
    const px = (pt * dpi) / 72;
    ctx.font = `${field.italic ? "italic" : "normal"} ${field.bold ? "700" : "400"} ${px}px ${family}`;
    try { ctx.letterSpacing = `${(numberOr(field.tracking, 0) * dpi) / 72}px`; } catch (err) { /* optional */ }
  };
  applyFont(sizePt);
  if (field.autoFit !== false) {
    while (sizePt > minPt && ctx.measureText(text).width > w - pad * 2) {
      sizePt -= 0.25;
      applyFont(sizePt);
    }
  }
  ctx.fillStyle = field.color || "#1c1915";
  ctx.textBaseline = "middle";
  const align = field.align || "center";
  ctx.textAlign = align;
  let tx = x + w / 2;
  if (align === "left") tx = x + pad;
  if (align === "right") tx = x + w - pad;
  ctx.fillText(text, tx, y + h / 2);
  try { ctx.letterSpacing = "0px"; } catch (err) { /* optional */ }
  ctx.restore();
}

function renderBadge(template, model, dpi) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(template.widthIn * dpi));
  canvas.height = Math.max(1, Math.round(template.heightIn * dpi));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = template.backgroundColor || "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const background = images.bg.get(template.id);
  if (background) drawFit(ctx, background, 0, 0, canvas.width, canvas.height, template.backgroundFit || "cover", 0.5, 0.5);
  drawPhoto(ctx, template, model, dpi);
  if (template.fields.subtitle.enabled) drawTextField(ctx, template.fields.subtitle, model.subtitle || "", dpi);
  drawTextField(ctx, template.fields.name, model.name || "", dpi);
  return canvas;
}

function showOn(visible, rendered) {
  if (visible.width !== rendered.width || visible.height !== rendered.height) {
    visible.width = rendered.width;
    visible.height = rendered.height;
  }
  visible.getContext("2d").drawImage(rendered, 0, 0);
}

function designModel(template) {
  return {
    name: template.sampleName || "Name",
    subtitle: template.sampleSubtitle || "Second line",
    photoImage: null,
    focusX: 0.5,
    focusY: 0.35,
    samplePhoto: state.showSample,
  };
}

function formModel() {
  return {
    name: state.form.name,
    subtitle: state.form.subtitle,
    photoImage: state.form.photoImage,
    focusX: state.form.focusX,
    focusY: state.form.focusY,
    samplePhoto: false,
  };
}

async function modelForPerson(person) {
  if (person.photoBlob && !images.photo.has(person.id)) {
    images.photo.set(person.id, await loadBitmap(person.photoBlob));
  }
  return {
    name: person.name || "",
    subtitle: person.subtitle || "",
    photoImage: images.photo.get(person.id) || null,
    focusX: person.focusX ?? 0.5,
    focusY: person.focusY ?? 0.35,
    samplePhoto: false,
  };
}

function fitFrame(center, frame, template) {
  const availW = center.clientWidth - 8;
  const availH = center.clientHeight - 8;
  if (availW < 40 || availH < 40) return;
  const aspect = template.widthIn / template.heightIn;
  let width = availW;
  let height = width / aspect;
  if (height > availH) {
    height = availH;
    width = height * aspect;
  }
  frame.style.width = Math.floor(width) + "px";
  frame.style.height = Math.floor(height) + "px";
}

function updateBrand(template) {
  $("brandSub").textContent = `${template.name} · ${formatIn(template.widthIn)} × ${formatIn(template.heightIn)} in`;
}

function setNum(input, value) {
  if (document.activeElement === input) return;
  const next = formatIn(value);
  if (input.value !== next) input.value = next;
}

function selectedTextField() {
  const template = getTemplate();
  if (!template || state.selectedField === "photo") return null;
  return template.fields[state.selectedField] || null;
}

function syncPropInputs() {
  const template = getTemplate();
  if (!template) return;
  setNum($("badgeWidth"), template.widthIn);
  setNum($("badgeHeight"), template.heightIn);
  const preset = $("presetSelect");
  if (document.activeElement !== preset) preset.value = matchPreset(template.widthIn, template.heightIn);
  if (document.activeElement !== $("templateName")) $("templateName").value = template.name;
  if (document.activeElement !== $("bgColor")) $("bgColor").value = template.backgroundColor;
  if (document.activeElement !== $("bgFit")) $("bgFit").value = template.backgroundFit;
  if (document.activeElement !== $("sampleName")) $("sampleName").value = template.sampleName;
  if (document.activeElement !== $("sampleSubtitle")) $("sampleSubtitle").value = template.sampleSubtitle;
  $("bgName").textContent = template.backgroundBlob
    ? (template.backgroundType === "svg" ? "SVG background" : "PNG background")
    : "No background yet. Drop one on the badge.";
  $("showSample").checked = state.showSample;
  $("showGrid").checked = state.grid;
  $("showSafe").checked = state.safe;
  $("subtitleEnabled").checked = !!template.fields.subtitle.enabled;
  $("sampleSubtitleRow").hidden = !template.fields.subtitle.enabled;
  for (const button of $("fieldList").querySelectorAll("[data-select]")) {
    button.classList.toggle("active", button.dataset.select === state.selectedField);
  }
  const field = template.fields[state.selectedField];
  setNum($("propX"), field.x);
  setNum($("propY"), field.y);
  setNum($("propW"), field.w);
  setNum($("propH"), field.h);
  const photo = state.selectedField === "photo";
  $("photoProps").hidden = !photo;
  $("textProps").hidden = photo;
  if (photo) {
    const box = template.fields.photo;
    if (document.activeElement !== $("photoShape")) $("photoShape").value = box.shape || "rect";
    setNum($("photoRadius"), box.radius || 0);
    setNum($("photoBorder"), box.borderPt || 0);
    if (document.activeElement !== $("photoBorderColor")) $("photoBorderColor").value = normalizeHex(box.borderColor, "#ffffff");
    $("radiusRow").hidden = box.shape !== "rounded";
  } else if (field) {
    if (document.activeElement !== $("textFont")) $("textFont").value = FONTS.includes(field.font) ? field.font : "Arial";
    setNum($("textSize"), field.sizePt);
    if (document.activeElement !== $("textColor")) $("textColor").value = normalizeHex(field.color, "#1c1915");
    $("textBold").checked = !!field.bold;
    $("textItalic").checked = !!field.italic;
    $("textUpper").checked = !!field.upper;
    $("textAuto").checked = field.autoFit !== false;
    setNum($("textTracking"), field.tracking || 0);
    for (const [id, align] of [["alignLeft", "left"], ["alignCenter", "center"], ["alignRight", "right"]]) {
      $(id).classList.toggle("active", (field.align || "center") === align);
    }
  }
}

function ensureOverlay() {
  const overlay = $("designOverlay");
  for (const key of ["photo", "name", "subtitle"]) {
    if (overlay.querySelector(`[data-field="${key}"]`)) continue;
    const node = document.createElement("div");
    node.className = "field";
    node.dataset.field = key;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = key === "photo" ? "Photo" : key === "name" ? "Name" : "Line 2";
    node.append(tag);
    for (const handle of ["nw", "ne", "sw", "se"]) {
      const knob = document.createElement("span");
      knob.className = "handle " + handle;
      knob.dataset.handle = handle;
      node.append(knob);
    }
    overlay.append(node);
  }
}

function layoutOverlay(template) {
  ensureOverlay();
  for (const key of ["photo", "name", "subtitle"]) {
    const node = $("designOverlay").querySelector(`[data-field="${key}"]`);
    const field = template.fields[key];
    node.hidden = key === "subtitle" && !field.enabled;
    node.classList.toggle("selected", state.selectedField === key);
    node.style.left = (field.x / template.widthIn) * 100 + "%";
    node.style.top = (field.y / template.heightIn) * 100 + "%";
    node.style.width = (field.w / template.widthIn) * 100 + "%";
    node.style.height = (field.h / template.heightIn) * 100 + "%";
  }
}

function layoutGrid(template) {
  const svg = $("designGrid");
  svg.hidden = !state.grid;
  svg.setAttribute("viewBox", `0 0 ${template.widthIn} ${template.heightIn}`);
  const lines = [];
  for (let x = 0; x <= template.widthIn + 0.001; x += 0.25) {
    const px = roundIn(x);
    lines.push(`<line x1="${px}" y1="0" x2="${px}" y2="${template.heightIn}"></line>`);
  }
  for (let y = 0; y <= template.heightIn + 0.001; y += 0.25) {
    const py = roundIn(y);
    lines.push(`<line x1="0" y1="${py}" x2="${template.widthIn}" y2="${py}"></line>`);
  }
  svg.innerHTML = lines.join("");
}

function layoutSafe(template) {
  const node = $("designSafe");
  node.hidden = !state.safe;
  const x = (0.06 / template.widthIn) * 100;
  const y = (0.06 / template.heightIn) * 100;
  node.style.left = x + "%";
  node.style.top = y + "%";
  node.style.right = x + "%";
  node.style.bottom = y + "%";
}

function renderDesign() {
  const template = getTemplate();
  if (!template || $("viewDesign").hidden) return;
  updateBrand(template);
  fitFrame($("designCenter"), $("designFrame"), template);
  showOn($("designCanvas"), renderBadge(template, designModel(template), PREVIEW_DPI));
  layoutOverlay(template);
  layoutGrid(template);
  layoutSafe(template);
  syncPropInputs();
  $("designMeta").textContent = `${formatIn(template.widthIn)} × ${formatIn(template.heightIn)} in · prints at 300 DPI`;
}

function renderPreview() {
  const template = getTemplate();
  if (!template || $("viewMake").hidden) return;
  fitFrame($("makeCenter"), $("makeFrame"), template);
  showOn($("makeCanvas"), renderBadge(template, formModel(), PREVIEW_DPI));
  const who = state.form.name.trim() || (state.form.id ? "Untitled" : "New badge");
  $("makeMeta").textContent = `${who} · ${formatIn(template.widthIn)} × ${formatIn(template.heightIn)} in · 300 DPI`;
}

function renderMake() {
  const template = getTemplate();
  if (!template) return;
  updateBrand(template);
  $("subtitleRow").hidden = !template.fields.subtitle.enabled;
  renderPreview();
  updateSelectionMeta();
}

function templatesInOrder() {
  return [...state.templates].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function renderTemplateList() {
  const list = $("templateList");
  list.replaceChildren();
  for (const template of templatesInOrder()) {
    const row = document.createElement("div");
    row.className = "tpl" + (template.id === state.activeId ? " active" : "");
    const main = document.createElement("button");
    main.type = "button";
    main.className = "tpl-main";
    const title = document.createElement("strong");
    title.textContent = template.name;
    const size = document.createElement("span");
    size.textContent = `${formatIn(template.widthIn)} × ${formatIn(template.heightIn)} in`;
    main.title = template.name;
    main.append(title, size);
    main.addEventListener("click", () => setActiveTemplate(template.id));
    const duplicate = document.createElement("button");
    duplicate.type = "button";
    duplicate.className = "icon-btn";
    duplicate.textContent = "Copy";
    duplicate.addEventListener("click", () => duplicateTemplate(template.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteTemplate(template.id));
    const actions = document.createElement("div");
    actions.className = "tpl-actions";
    actions.append(duplicate, remove);
    row.append(main, actions);
    list.append(row);
  }
}

function fillTemplateSelect() {
  const select = $("makeTemplate");
  const current = state.activeId;
  select.replaceChildren();
  for (const template of templatesInOrder()) {
    select.append(new Option(template.name, template.id, false, template.id === current));
  }
}

function personThumbUrl(person) {
  if (!person.photoBlob) return "";
  if (!rowUrls.has(person.id)) rowUrls.set(person.id, URL.createObjectURL(person.photoBlob));
  return rowUrls.get(person.id);
}

function refreshThumb(id) {
  const url = rowUrls.get(id);
  if (!url) return;
  URL.revokeObjectURL(url);
  rowUrls.delete(id);
}

function renderPeopleList() {
  const list = $("personList");
  list.replaceChildren();
  if (!state.people.length) {
    const empty = document.createElement("p");
    empty.className = "empty note";
    empty.textContent = "No badges yet. Add a name and a photo.";
    list.append(empty);
    return;
  }
  for (const person of state.people) {
    const row = document.createElement("div");
    row.className = "person" + (person.id === state.form.id ? " active" : "");
    row.dataset.person = person.id;
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = state.checked.has(person.id);
    check.addEventListener("change", () => {
      if (check.checked) state.checked.add(person.id);
      else state.checked.delete(person.id);
      syncSelectAll();
      updateSelectionMeta();
    });
    const thumb = person.photoBlob ? document.createElement("img") : document.createElement("div");
    thumb.className = person.photoBlob ? "thumb" : "thumb-empty";
    if (person.photoBlob) {
      thumb.src = personThumbUrl(person);
      thumb.alt = "";
    }
    const who = document.createElement("div");
    who.className = "who";
    const open = document.createElement("button");
    open.type = "button";
    const title = document.createElement("strong");
    title.textContent = person.name || "Untitled";
    open.append(title);
    if (person.subtitle) {
      const sub = document.createElement("em");
      sub.textContent = person.subtitle;
      open.append(sub);
    }
    open.addEventListener("click", () => {
      loadForm(person);
      renderPeopleList();
      renderPreview();
    });
    who.append(open);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removePerson(person.id));
    row.append(check, thumb, who, remove);
    list.append(row);
  }
}

function syncSelectAll() {
  const box = $("selectAll");
  const total = state.people.length;
  const picked = state.people.filter((person) => state.checked.has(person.id)).length;
  box.checked = total > 0 && picked === total;
  box.indeterminate = picked > 0 && picked < total;
  box.disabled = total === 0;
}

function selectedPeople() {
  return state.people.filter((person) => state.checked.has(person.id));
}

function updateSelectionMeta() {
  const picked = selectedPeople();
  const hint = picked.length
    ? `${picked.length} selected`
    : (state.people.length ? "Select at least one badge." : "Add a badge to export it.");
  $("selectionMeta").textContent = state.people.length ? `${picked.length} of ${state.people.length}` : "";
  $("exportHint").textContent = hint;
  const enabled = picked.length > 0;
  $("btnPng").disabled = !enabled;
  $("btnPdf").disabled = !enabled;
  $("btnPrint").disabled = !enabled;
  $("btnPng").textContent = picked.length > 1 ? "PNG zip" : "PNG";
  syncSelectAll();
}

function snap(value) {
  if (!state.grid) return roundIn(value);
  return roundIn(Math.round(value / 0.05) * 0.05);
}

function pointerInches(event) {
  const template = getTemplate();
  const rect = $("designFrame").getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * template.widthIn,
    y: ((event.clientY - rect.top) / rect.height) * template.heightIn,
  };
}

function applyResize(field, orig, dx, dy, mode) {
  let x = orig.x;
  let y = orig.y;
  let w = orig.w;
  let h = orig.h;
  if (mode.includes("e")) w = orig.w + dx;
  if (mode.includes("s")) h = orig.h + dy;
  if (mode.includes("w")) {
    x = orig.x + dx;
    w = orig.w - dx;
  }
  if (mode.includes("n")) {
    y = orig.y + dy;
    h = orig.h - dy;
  }
  field.x = snap(x);
  field.y = snap(y);
  field.w = snap(Math.max(0.12, w));
  field.h = snap(Math.max(0.12, h));
}

function startDrag(event, key, mode) {
  const template = getTemplate();
  const orig = Object.assign({}, template.fields[key]);
  const start = pointerInches(event);
  state.selectedField = key;
  document.body.classList.add("dragging");
  const move = (ev) => {
    const point = pointerInches(ev);
    const field = template.fields[key];
    if (mode === "move") {
      field.x = snap(orig.x + point.x - start.x);
      field.y = snap(orig.y + point.y - start.y);
    } else {
      applyResize(field, orig, point.x - start.x, point.y - start.y, mode);
    }
    clampField(field, template);
    renderDesign();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove("dragging");
    touchTemplate();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  renderDesign();
}

function applyPositionFromInputs() {
  const template = getTemplate();
  const field = template.fields[state.selectedField];
  for (const [input, key] of [["propX", "x"], ["propY", "y"], ["propW", "w"], ["propH", "h"]]) {
    const value = parseFloat($(input).value);
    if (Number.isFinite(value)) field[key] = value;
  }
  clampField(field, template);
  touchTemplate();
}

function readPhotoProps() {
  const field = getTemplate().fields.photo;
  field.shape = $("photoShape").value;
  const radius = parseFloat($("photoRadius").value);
  const border = parseFloat($("photoBorder").value);
  if (Number.isFinite(radius)) field.radius = radius;
  if (Number.isFinite(border)) field.borderPt = clamp(border, 0, 20);
  field.borderColor = $("photoBorderColor").value;
  clampField(field, getTemplate());
  touchTemplate();
}

function readTextProps() {
  const field = selectedTextField();
  if (!field) return;
  field.font = $("textFont").value;
  const size = parseFloat($("textSize").value);
  const tracking = parseFloat($("textTracking").value);
  if (Number.isFinite(size)) field.sizePt = clamp(size, 6, 120);
  if (Number.isFinite(tracking)) field.tracking = tracking;
  field.color = $("textColor").value;
  field.bold = $("textBold").checked;
  field.italic = $("textItalic").checked;
  field.upper = $("textUpper").checked;
  field.autoFit = $("textAuto").checked;
  touchTemplate();
}

function commitSize() {
  const template = getTemplate();
  const width = parseFloat($("badgeWidth").value);
  const height = parseFloat($("badgeHeight").value);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  if (Math.abs(width - template.widthIn) < 0.0005 && Math.abs(height - template.heightIn) < 0.0005) return;
  resizeTemplate(template, width, height);
  touchTemplate();
}

async function setActiveTemplate(id) {
  if (!state.templates.some((template) => template.id === id)) return;
  state.activeId = id;
  localStorage.setItem("bp-template", id);
  clearTimeout(saveTimer);
  const template = getTemplate();
  if (template.backgroundBlob && !images.bg.has(template.id)) {
    try {
      images.bg.set(template.id, await loadBitmap(template.backgroundBlob));
    } catch (err) {
      console.error(err);
      setStatus("Could not read the saved background.");
    }
  }
  state.people = await loadPeople(id);
  state.checked = new Set(state.people.map((person) => person.id));
  for (const person of state.people) {
    if (person.photoBlob && !images.photo.has(person.id)) {
      try {
        images.photo.set(person.id, await loadBitmap(person.photoBlob));
      } catch (err) {
        console.error(err);
      }
    }
  }
  clearForm();
  renderTemplateList();
  fillTemplateSelect();
  renderPeopleList();
  if (state.mode === "design") renderDesign();
  else renderMake();
}

async function duplicateTemplate(id) {
  const source = state.templates.find((template) => template.id === id);
  if (!source) return;
  const copy = normalizeTemplate(structuredClone(templateRecord(source)));
  copy.id = crypto.randomUUID();
  copy.name = ("Copy of " + source.name).slice(0, 80);
  if (images.bg.has(source.id)) images.bg.set(copy.id, images.bg.get(source.id));
  await saveTemplate(copy);
  state.templates.push(copy);
  await setActiveTemplate(copy.id);
  setStatus("Template copied.");
}

async function deleteTemplate(id) {
  const template = state.templates.find((item) => item.id === id);
  if (!template) return;
  if (!confirm(`Delete “${template.name}”? Badges made with it will be removed too.`)) return;
  const people = await loadPeople(id);
  for (const person of people) {
    refreshThumb(person.id);
    images.photo.delete(person.id);
    await idbDelete("people", person.id);
  }
  images.bg.delete(id);
  await idbDelete("templates", id);
  state.templates = state.templates.filter((item) => item.id !== id);
  if (!state.templates.length) {
    const fresh = createTemplate("2 × 3 badge", "2x3");
    await saveTemplate(fresh);
    state.templates.push(fresh);
  }
  await setActiveTemplate(state.templates[0].id);
  setStatus("Template deleted.");
}

function clearForm() {
  if (state.form.photoUrl) URL.revokeObjectURL(state.form.photoUrl);
  state.form = blankForm();
  $("personName").value = "";
  $("personSubtitle").value = "";
  $("photoPreview").hidden = true;
  $("photoPreview").removeAttribute("src");
  $("photoClear").hidden = true;
  $("focusRow").hidden = true;
  $("focusX").value = "0.5";
  $("focusY").value = "0.35";
  $("savePersonBtn").hidden = false;
  $("savePersonBtn").disabled = true;
  $("anotherBtn").hidden = true;
}

function loadForm(person) {
  if (state.form.photoUrl) URL.revokeObjectURL(state.form.photoUrl);
  state.form = {
    id: person.id,
    name: person.name || "",
    subtitle: person.subtitle || "",
    photoBlob: person.photoBlob || null,
    photoImage: images.photo.get(person.id) || null,
    photoUrl: person.photoBlob ? URL.createObjectURL(person.photoBlob) : "",
    focusX: person.focusX ?? 0.5,
    focusY: person.focusY ?? 0.35,
  };
  $("personName").value = state.form.name;
  $("personSubtitle").value = state.form.subtitle;
  $("photoPreview").hidden = !state.form.photoUrl;
  if (state.form.photoUrl) $("photoPreview").src = state.form.photoUrl;
  $("photoClear").hidden = !state.form.photoBlob;
  $("focusRow").hidden = !state.form.photoBlob;
  $("focusX").value = String(state.form.focusX);
  $("focusY").value = String(state.form.focusY);
  $("savePersonBtn").hidden = true;
  $("anotherBtn").hidden = false;
}

function schedulePersonSave() {
  clearTimeout(personTimer);
  personTimer = setTimeout(() => {
    persistForm().catch((err) => {
      console.error(err);
      setStatus("Could not save that badge.");
    });
  }, 350);
}

async function persistForm() {
  if (!state.form.id) return;
  const name = state.form.name.trim();
  if (!name) {
    setStatus("Enter a name.");
    return;
  }
  const person = state.people.find((item) => item.id === state.form.id);
  if (!person) return;
  person.name = name;
  person.subtitle = state.form.subtitle.trim();
  person.photoBlob = state.form.photoBlob;
  person.focusX = state.form.focusX;
  person.focusY = state.form.focusY;
  if (state.form.photoImage) images.photo.set(person.id, state.form.photoImage);
  await idbPut("people", person);
  refreshThumb(person.id);
  renderPeopleList();
  setStatus("Saved");
}

async function assignFormPhoto(blob, image) {
  if (state.form.photoUrl) URL.revokeObjectURL(state.form.photoUrl);
  state.form.photoBlob = blob;
  state.form.photoImage = image;
  state.form.photoUrl = URL.createObjectURL(blob);
  $("photoPreview").src = state.form.photoUrl;
  $("photoPreview").hidden = false;
  $("photoClear").hidden = false;
  $("focusRow").hidden = false;
  renderPreview();
  if (state.form.id) {
    refreshThumb(state.form.id);
    schedulePersonSave();
    renderPeopleList();
  }
}

async function addPerson() {
  const name = state.form.name.trim();
  if (!name) {
    setStatus("Enter a name.");
    return;
  }
  const person = {
    id: crypto.randomUUID(),
    templateId: getTemplate().id,
    name,
    subtitle: state.form.subtitle.trim(),
    photoBlob: state.form.photoBlob,
    focusX: state.form.focusX,
    focusY: state.form.focusY,
    created: Date.now(),
  };
  if (state.form.photoImage) images.photo.set(person.id, state.form.photoImage);
  await idbPut("people", person);
  state.people.push(person);
  state.checked.add(person.id);
  loadForm(person);
  renderPeopleList();
  renderPreview();
  updateSelectionMeta();
  setStatus("Badge added.");
}

async function removePerson(id) {
  const person = state.people.find((item) => item.id === id);
  if (!person || !confirm(`Remove ${person.name || "this badge"}?`)) return;
  await idbDelete("people", id);
  state.people = state.people.filter((item) => item.id !== id);
  state.checked.delete(id);
  images.photo.delete(id);
  refreshThumb(id);
  if (state.form.id === id) clearForm();
  renderPeopleList();
  renderPreview();
  updateSelectionMeta();
}

async function addManyNames() {
  const names = $("manyNames").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!names.length) {
    setStatus("Enter at least one name.");
    return;
  }
  const templateId = getTemplate().id;
  for (const name of names) {
    const person = {
      id: crypto.randomUUID(),
      templateId,
      name: name.slice(0, 80),
      subtitle: "",
      photoBlob: null,
      focusX: 0.5,
      focusY: 0.35,
      created: Date.now(),
    };
    await idbPut("people", person);
    state.people.push(person);
    state.checked.add(person.id);
  }
  $("manyNames").value = "";
  renderPeopleList();
  updateSelectionMeta();
  setStatus(`Added ${names.length}.`);
}

async function addManyPhotos(files) {
  const templateId = getTemplate().id;
  let count = 0;
  for (const file of files) {
    setStatus(`Reading photo ${count + 1} of ${files.length}…`);
    const prepared = await downscalePhoto(file);
    const name = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 80) || "Guest";
    const person = {
      id: crypto.randomUUID(),
      templateId,
      name,
      subtitle: "",
      photoBlob: prepared.blob,
      focusX: 0.5,
      focusY: 0.35,
      created: Date.now(),
    };
    images.photo.set(person.id, prepared.image);
    await idbPut("people", person);
    state.people.push(person);
    state.checked.add(person.id);
    count += 1;
  }
  renderPeopleList();
  updateSelectionMeta();
  setStatus(`Added ${count} from photos.`);
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function exportTemplateFile() {
  const template = getTemplate();
  const payload = {
    version: 1,
    kind: "badgepress-template",
    name: template.name,
    preset: template.preset,
    widthIn: template.widthIn,
    heightIn: template.heightIn,
    backgroundColor: template.backgroundColor,
    backgroundFit: template.backgroundFit,
    backgroundType: template.backgroundType || "",
    backgroundDataUrl: template.backgroundBlob ? await blobToDataUrl(template.backgroundBlob) : "",
    fields: template.fields,
    sampleName: template.sampleName,
    sampleSubtitle: template.sampleSubtitle,
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), safeName(template.name) + ".badge.json");
  setStatus("Template file downloaded.");
}

async function importTemplateFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    throw new Error("That file is not a Badge Press template.");
  }
  if (!data || !data.widthIn || !data.fields) throw new Error("That file is not a Badge Press template.");
  let blob = null;
  if (data.backgroundDataUrl) blob = await (await fetch(data.backgroundDataUrl)).blob();
  const template = normalizeTemplate({
    ...data,
    id: crypto.randomUUID(),
    backgroundBlob: blob,
    backgroundType: data.backgroundType || (blob ? blob.type : ""),
  });
  if (blob) images.bg.set(template.id, await loadBitmap(blob));
  await saveTemplate(template);
  state.templates.push(template);
  await setActiveTemplate(template.id);
  setStatus("Template imported.");
}

async function renderPeopleCanvases(people) {
  const template = getTemplate();
  const canvases = [];
  for (let i = 0; i < people.length; i++) {
    setStatus(`Rendering ${i + 1} of ${people.length}…`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    canvases.push(renderBadge(template, await modelForPerson(people[i]), PRINT_DPI));
  }
  return canvases;
}

function openPrint(canvases, widthIn, heightIn) {
  const imagesHtml = canvases.map((canvas) => `<img alt="" src="${canvas.toDataURL("image/png")}">`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print badges</title><style>
    @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    img { width: ${widthIn}in; height: ${heightIn}in; display: block; break-after: page; page-break-after: always; }
    img:last-child { break-after: auto; page-break-after: auto; }
  </style></head><body>${imagesHtml}<script>addEventListener("load", function () { setTimeout(function () { print(); }, 150); });<\/script></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const popup = window.open(url, "_blank");
  if (!popup) {
    URL.revokeObjectURL(url);
    setStatus("Allow pop-ups to print.");
    return;
  }
  popup.opener = null;
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

async function exportPngs(people) {
  const template = getTemplate();
  const canvases = await renderPeopleCanvases(people);
  if (canvases.length === 1) {
    const blob = await canvasToBlob(canvases[0], "image/png");
    downloadBlob(blob, safeName(people[0].name) + ".png");
    setStatus("PNG downloaded.");
    return;
  }
  const used = new Set();
  const files = [];
  for (let i = 0; i < canvases.length; i++) {
    let name = safeName(people[i].name);
    let unique = name;
    let n = 2;
    while (used.has(unique)) unique = name + "-" + (n++);
    used.add(unique);
    files.push({ name: unique + ".png", data: new Uint8Array(await (await canvasToBlob(canvases[i], "image/png")).arrayBuffer()) });
  }
  downloadBlob(new Blob([BadgeZip.buildZip(files)], { type: "application/zip" }), safeName(template.name) + "-badges.zip");
  setStatus(`Downloaded ${files.length} PNGs.`);
}

async function exportPdf(people) {
  const template = getTemplate();
  const canvases = await renderPeopleCanvases(people);
  setStatus("Building PDF…");
  const bytes = await BadgePdf.buildPdf(canvases, template.widthIn, template.heightIn);
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), safeName(template.name) + "-badges.pdf");
  setStatus(`PDF downloaded, ${people.length} page${people.length === 1 ? "" : "s"}.`);
}

async function printPeople(people) {
  const template = getTemplate();
  const canvases = await renderPeopleCanvases(people);
  openPrint(canvases, template.widthIn, template.heightIn);
  setStatus("Print dialog opened. Use 100% scale, no margins, and no headers.");
}

async function setBackgroundFile(file) {
  const prepared = await prepareBackground(file);
  const template = getTemplate();
  template.backgroundBlob = prepared.blob;
  template.backgroundType = prepared.type;
  images.bg.set(template.id, prepared.image);
  touchTemplate();
  setStatus("Background added.");
}

function closeCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  $("cameraVideo").srcObject = null;
  if ($("cameraDialog").open) $("cameraDialog").close();
}

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("This browser has no camera access.");
    return;
  }
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  $("cameraVideo").srcObject = cameraStream;
  $("cameraDialog").showModal();
}

async function captureCamera() {
  const video = $("cameraVideo");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
  const prepared = await downscalePhoto(blob);
  closeCamera();
  await assignFormPhoto(prepared.blob, prepared.image);
  setStatus("Photo captured.");
}

function guard(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Something went wrong.");
    }
  };
}

function filesOf(event) {
  return [...(event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : [])];
}

function bind() {
  for (const font of FONTS) {
    const option = new Option(font, font);
    option.style.fontFamily = `"${font}", sans-serif`;
    $("textFont").append(option);
  }

  $("modeDesign").addEventListener("click", () => setMode("design"));
  $("modeMake").addEventListener("click", () => setMode("make"));
  $("newToggle").addEventListener("click", () => {
    $("newForm").hidden = !$("newForm").hidden;
    if (!$("newForm").hidden) $("newName").focus();
  });
  $("newForm").addEventListener("submit", guard(async (event) => {
    event.preventDefault();
    const template = createTemplate($("newName").value.trim() || "Untitled badge", $("newPreset").value);
    await saveTemplate(template);
    state.templates.push(template);
    $("newName").value = "";
    $("newForm").hidden = true;
    await setActiveTemplate(template.id);
    setStatus("Template created.");
  }));
  $("exportTemplate").addEventListener("click", guard(exportTemplateFile));
  $("importTemplate").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", guard(async () => {
    const file = $("importFile").files[0];
    $("importFile").value = "";
    if (file) await importTemplateFile(file);
  }));
  $("makeTemplate").addEventListener("change", () => setActiveTemplate($("makeTemplate").value));

  $("templateName").addEventListener("input", () => {
    getTemplate().name = $("templateName").value.slice(0, 80);
    renderTemplateList();
    fillTemplateSelect();
    touchTemplate();
  });
  $("presetSelect").addEventListener("change", () => {
    const preset = PRESETS.find((item) => item.id === $("presetSelect").value);
    if (!preset) return;
    resizeTemplate(getTemplate(), preset.w, preset.h);
    touchTemplate();
  });
  for (const id of ["badgeWidth", "badgeHeight"]) {
    $(id).addEventListener("input", (event) => {
      if (!event.inputType) commitSize();
    });
    $(id).addEventListener("change", commitSize);
  }
  $("bgColor").addEventListener("input", () => {
    getTemplate().backgroundColor = $("bgColor").value;
    touchTemplate();
  });
  $("bgFit").addEventListener("change", () => {
    getTemplate().backgroundFit = $("bgFit").value;
    touchTemplate();
  });
  $("bgPick").addEventListener("click", () => $("bgFile").click());
  $("bgFile").addEventListener("change", guard(async () => {
    const file = $("bgFile").files[0];
    $("bgFile").value = "";
    if (file) await setBackgroundFile(file);
  }));
  $("bgClear").addEventListener("click", () => {
    const template = getTemplate();
    template.backgroundBlob = null;
    template.backgroundType = "";
    images.bg.delete(template.id);
    touchTemplate();
  });
  $("sampleName").addEventListener("input", () => {
    getTemplate().sampleName = $("sampleName").value;
    touchTemplate();
  });
  $("sampleSubtitle").addEventListener("input", () => {
    getTemplate().sampleSubtitle = $("sampleSubtitle").value;
    touchTemplate();
  });
  $("showSample").addEventListener("change", () => {
    state.showSample = $("showSample").checked;
    localStorage.setItem("bp-sample", state.showSample ? "1" : "0");
    renderDesign();
  });
  $("showGrid").addEventListener("change", () => {
    state.grid = $("showGrid").checked;
    localStorage.setItem("bp-grid", state.grid ? "1" : "0");
    renderDesign();
  });
  $("showSafe").addEventListener("change", () => {
    state.safe = $("showSafe").checked;
    localStorage.setItem("bp-safe", state.safe ? "1" : "0");
    renderDesign();
  });
  $("fieldList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-select]");
    if (!button) return;
    state.selectedField = button.dataset.select;
    if (state.selectedField === "subtitle") getTemplate().fields.subtitle.enabled = true;
    touchTemplate();
  });
  $("subtitleEnabled").addEventListener("change", () => {
    getTemplate().fields.subtitle.enabled = $("subtitleEnabled").checked;
    if (!$("subtitleEnabled").checked && state.selectedField === "subtitle") state.selectedField = "name";
    touchTemplate();
    renderMake();
  });
  for (const id of ["propX", "propY", "propW", "propH"]) {
    $(id).addEventListener("input", applyPositionFromInputs);
    $(id).addEventListener("blur", syncPropInputs);
  }
  for (const id of ["photoShape", "photoRadius", "photoBorder", "photoBorderColor"]) {
    $(id).addEventListener("input", readPhotoProps);
    $(id).addEventListener("change", readPhotoProps);
  }
  for (const id of ["textFont", "textSize", "textColor", "textTracking"]) {
    $(id).addEventListener("input", readTextProps);
    $(id).addEventListener("change", readTextProps);
  }
  for (const id of ["textBold", "textItalic", "textUpper", "textAuto"]) {
    $(id).addEventListener("change", readTextProps);
  }
  $("alignLeft").addEventListener("click", () => { const field = selectedTextField(); if (field) { field.align = "left"; touchTemplate(); } });
  $("alignCenter").addEventListener("click", () => { const field = selectedTextField(); if (field) { field.align = "center"; touchTemplate(); } });
  $("alignRight").addEventListener("click", () => { const field = selectedTextField(); if (field) { field.align = "right"; touchTemplate(); } });

  $("designOverlay").addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-handle]");
    const field = event.target.closest("[data-field]");
    if (!field) return;
    event.preventDefault();
    startDrag(event, field.dataset.field, handle ? handle.dataset.handle : "move");
  });

  $("designFrame").addEventListener("dragover", (event) => {
    if (!filesOf(event).length && ![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    $("designFrame").classList.add("dropping");
  });
  $("designFrame").addEventListener("dragleave", () => $("designFrame").classList.remove("dropping"));
  $("designFrame").addEventListener("drop", guard(async (event) => {
    event.preventDefault();
    $("designFrame").classList.remove("dropping");
    const file = event.dataTransfer.files[0];
    if (file) await setBackgroundFile(file);
  }));

  $("testPng").addEventListener("click", guard(async () => {
    const template = getTemplate();
    const canvas = renderBadge(template, designModel(template), PRINT_DPI);
    downloadBlob(await canvasToBlob(canvas, "image/png"), safeName(template.name) + "-test.png");
    setStatus("Test PNG downloaded.");
  }));
  $("testPrint").addEventListener("click", guard(async () => {
    const template = getTemplate();
    const canvas = renderBadge(template, designModel(template), PRINT_DPI);
    openPrint([canvas], template.widthIn, template.heightIn);
    setStatus("Test page opened. Use 100% scale, no margins, and no headers.");
  }));

  const onFormInput = () => {
    state.form.name = $("personName").value;
    state.form.subtitle = $("personSubtitle").value;
    $("savePersonBtn").disabled = !state.form.name.trim();
    renderPreview();
    if (state.form.id) schedulePersonSave();
  };
  $("personName").addEventListener("input", onFormInput);
  $("personSubtitle").addEventListener("input", onFormInput);
  $("personName").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !state.form.id) {
      event.preventDefault();
      guard(addPerson)();
    }
  });
  $("focusX").addEventListener("input", () => {
    state.form.focusX = parseFloat($("focusX").value);
    renderPreview();
    if (state.form.id) schedulePersonSave();
  });
  $("focusY").addEventListener("input", () => {
    state.form.focusY = parseFloat($("focusY").value);
    renderPreview();
    if (state.form.id) schedulePersonSave();
  });
  $("savePersonBtn").addEventListener("click", guard(addPerson));
  $("anotherBtn").addEventListener("click", () => {
    clearForm();
    renderPeopleList();
    renderPreview();
    $("personName").focus();
  });
  $("photoBrowse").addEventListener("click", () => $("photoFile").click());
  $("photoFile").addEventListener("change", guard(async () => {
    const file = $("photoFile").files[0];
    $("photoFile").value = "";
    if (!file) return;
    const prepared = await downscalePhoto(file);
    await assignFormPhoto(prepared.blob, prepared.image);
  }));
  $("photoClear").addEventListener("click", () => {
    if (state.form.photoUrl) URL.revokeObjectURL(state.form.photoUrl);
    state.form.photoBlob = null;
    state.form.photoImage = null;
    state.form.photoUrl = "";
    $("photoPreview").hidden = true;
    $("photoPreview").removeAttribute("src");
    $("photoClear").hidden = true;
    $("focusRow").hidden = true;
    renderPreview();
    if (state.form.id) {
      images.photo.delete(state.form.id);
      refreshThumb(state.form.id);
      schedulePersonSave();
      renderPeopleList();
    }
  });
  const drop = $("photoDrop");
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", guard(async (event) => {
    event.preventDefault();
    drop.classList.remove("over");
    const file = [...event.dataTransfer.files].find((item) => /^image\//.test(item.type) || /\.(png|jpe?g|webp|gif)$/i.test(item.name));
    if (!file) return;
    const prepared = await downscalePhoto(file);
    await assignFormPhoto(prepared.blob, prepared.image);
  }));
  $("cameraBtn").addEventListener("click", guard(openCamera));
  $("cameraCapture").addEventListener("click", guard(captureCamera));
  $("cameraCancel").addEventListener("click", closeCamera);
  $("cameraDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeCamera();
  });
  $("manyToggle").addEventListener("click", () => {
    $("manyPanel").hidden = !$("manyPanel").hidden;
  });
  $("manyAddNames").addEventListener("click", guard(addManyNames));
  $("manyPhotosBtn").addEventListener("click", () => $("manyPhotosFile").click());
  $("manyPhotosFile").addEventListener("change", guard(async () => {
    const files = [...$("manyPhotosFile").files];
    $("manyPhotosFile").value = "";
    if (files.length) await addManyPhotos(files);
  }));
  $("selectAll").addEventListener("change", () => {
    state.checked = $("selectAll").checked ? new Set(state.people.map((person) => person.id)) : new Set();
    renderPeopleList();
    updateSelectionMeta();
  });
  $("btnPng").addEventListener("click", guard(async () => {
    const people = selectedPeople();
    if (!people.length) return;
    await exportPngs(people);
  }));
  $("btnPdf").addEventListener("click", guard(async () => {
    const people = selectedPeople();
    if (!people.length) return;
    await exportPdf(people);
  }));
  $("btnPrint").addEventListener("click", guard(async () => {
    const people = selectedPeople();
    if (!people.length) return;
    await printPeople(people);
  }));

  document.addEventListener("keydown", (event) => {
    if (state.mode !== "design") return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = arrows[event.key];
    if (!step) return;
    const template = getTemplate();
    const field = template.fields[state.selectedField];
    const amount = event.shiftKey ? 0.1 : (state.grid ? 0.05 : 0.01);
    field.x += step[0] * amount;
    field.y += step[1] * amount;
    clampField(field, template);
    event.preventDefault();
    touchTemplate();
  });

  window.addEventListener("dragover", (event) => {
    if (event.dataTransfer && [...event.dataTransfer.types].includes("Files")) event.preventDefault();
  });
  window.addEventListener("drop", (event) => {
    if (event.dataTransfer && [...event.dataTransfer.types].includes("Files")) event.preventDefault();
  });
  document.querySelectorAll('input[type="number"]').forEach((input) => {
    input.addEventListener("wheel", (event) => event.preventDefault(), { passive: false });
  });

  const observer = new ResizeObserver(() => {
    if (state.mode === "design") renderDesign();
    else renderPreview();
  });
  observer.observe($("designCenter"));
  observer.observe($("makeCenter"));
}

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem("bp-mode", mode);
  $("viewDesign").hidden = mode !== "design";
  $("viewMake").hidden = mode !== "make";
  $("modeDesign").classList.toggle("active", mode === "design");
  $("modeMake").classList.toggle("active", mode === "make");
  $("modeDesign").setAttribute("aria-pressed", String(mode === "design"));
  $("modeMake").setAttribute("aria-pressed", String(mode === "make"));
  if (mode === "design") renderDesign();
  else renderMake();
}

async function boot() {
  state.grid = localStorage.getItem("bp-grid") !== "0";
  state.safe = localStorage.getItem("bp-safe") === "1";
  state.showSample = localStorage.getItem("bp-sample") !== "0";
  bind();
  await openDb();
  const stored = await idbAll("templates");
  state.templates = stored.map((row) => normalizeTemplate(row));
  if (!state.templates.length) {
    const seed = createTemplate("2 × 3 badge", "2x3");
    await saveTemplate(seed);
    state.templates.push(seed);
  }
  const savedId = localStorage.getItem("bp-template");
  const initial = state.templates.some((template) => template.id === savedId) ? savedId : state.templates[0].id;
  await setActiveTemplate(initial);
  const savedMode = localStorage.getItem("bp-mode");
  setMode(savedMode === "make" ? "make" : "design");
  setStatus("Ready");
}

function writeSelfTest(result) {
  const pre = document.createElement("pre");
  pre.id = "selftest";
  pre.textContent = JSON.stringify(result);
  document.body.appendChild(pre);
}

async function runSelfTest() {
  const checks = [];
  const assert = (name, ok, extra) => checks.push({ name, ok: !!ok, extra: extra || "" });
  const crc = BadgeZip.crc32(new TextEncoder().encode("123456789"));
  assert("crc32", crc === 0xcbf43926, crc.toString(16));
  const zip = BadgeZip.buildZip([{ name: "hi.txt", data: new TextEncoder().encode("hello") }]);
  assert("zip-magic", zip[0] === 0x50 && zip[1] === 0x4b && zip[2] === 0x03 && zip[3] === 0x04);
  assert("zip-eocd", zip[zip.length - 22] === 0x50 && zip[zip.length - 21] === 0x4b);

  const template = createTemplate("Self test", "2x3");
  template.backgroundColor = "#ff0000";
  template.fields.photo = { x: 0.5, y: 0.5, w: 1, h: 1, shape: "rect", radius: 0, borderPt: 0, borderColor: "#ffffff" };
  template.fields.name.y = 2.2;
  template.fields.name.h = 0.4;
  template.fields.subtitle.enabled = false;
  const photo = document.createElement("canvas");
  photo.width = 8;
  photo.height = 8;
  const photoCtx = photo.getContext("2d");
  photoCtx.fillStyle = "#00ff00";
  photoCtx.fillRect(0, 0, 8, 8);
  const canvas = renderBadge(template, {
    name: "Hi",
    subtitle: "",
    photoImage: photo,
    focusX: 0.5,
    focusY: 0.5,
    samplePhoto: false,
  }, 100);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const corner = ctx.getImageData(1, 1, 1, 1).data;
  const photoPx = ctx.getImageData(100, 100, 1, 1).data;
  const bottom = ctx.getImageData(1, canvas.height - 2, 1, 1).data;
  assert("corner-red", corner[0] > 250 && corner[1] < 5 && corner[2] < 5, [...corner].join(","));
  assert("photo-green", photoPx[1] > 250 && photoPx[0] < 5, [...photoPx].join(","));
  assert("bottom-red", bottom[0] > 250 && bottom[1] < 5, [...bottom].join(","));

  const pdf = await BadgePdf.buildPdf([canvas], 2, 3);
  const latin = new TextDecoder("latin1").decode(pdf);
  assert("pdf-header", latin.startsWith("%PDF-1.4"));
  assert("pdf-eof", latin.trim().endsWith("%%EOF"));
  assert("pdf-upright", latin.includes("0 0 216 0 0 cm"));
  const lengthMatch = latin.match(/\/FlateDecode \/Length (\d+)/);
  const streamAt = latin.indexOf("stream\n");
  assert("pdf-stream", !!(lengthMatch && streamAt > 0));
  if (lengthMatch && streamAt > 0) {
    const start = streamAt + "stream\n".length;
    const compressed = pdf.slice(start, start + Number(lengthMatch[1]));
    const raw = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
    assert("pdf-pixels", raw.length === canvas.width * canvas.height * 3 && raw[0] === 255 && raw[1] === 0 && raw[2] === 0, String(raw.length));
  }
  let pdfBase64 = "";
  if (pdf.length < 120000) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < pdf.length; i += chunk) binary += String.fromCharCode(...pdf.subarray(i, i + chunk));
    pdfBase64 = btoa(binary);
  }
  const failed = checks.filter((check) => !check.ok);
  return { ok: failed.length === 0, checks, pdfBase64, deflateHead: lengthMatch ? [pdf[streamAt + 7], pdf[streamAt + 8]] : [] };
}

window.BadgePress = { renderBadge, createTemplate, buildPdf: (c, w, h) => BadgePdf.buildPdf(c, w, h), runSelfTest };

const selftest = new URLSearchParams(location.search).has("selftest");
boot()
  .then(() => (selftest ? runSelfTest() : null))
  .then((result) => {
    if (result) writeSelfTest(result);
  })
  .catch((err) => {
    console.error(err);
    setStatus(err.message || "Could not start Badge Press.");
    if (selftest) writeSelfTest({ ok: false, error: String(err && err.stack || err) });
  });

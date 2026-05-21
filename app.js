import { CatPrinter } from 'https://cdn.jsdelivr.net/npm/@opuu/cat-printer@0.1.0/+esm';
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';

/* ---------- font registry ---------- */
const FONTS = {
  mono: '"JetBrains Mono", ui-monospace, monospace',
  sans: '"Geist", system-ui, sans-serif',
  serif: '"Newsreader", Georgia, serif',
  display: '"Bricolage Grotesque", "Geist", system-ui, sans-serif',
  hand: '"Caveat", "Comic Sans MS", cursive',
  typewriter: '"Special Elite", "Courier New", monospace',
  pixel: '"Press Start 2P", "JetBrains Mono", monospace',
  terminal: '"VT323", ui-monospace, monospace',
  script: '"Pacifico", "Caveat", cursive',
  chunky: '"Bungee", "Bricolage Grotesque", sans-serif',
  retro: '"Silkscreen", "Press Start 2P", monospace'
};

/* ---------- DOM helpers ---------- */
const $ = id => document.getElementById(id);

/* ---------- state ---------- */
const printer = new CatPrinter({ debug: false });
let connected = false;
let connecting = false;
let imageDataUrl = null;
let qrDataUrl = null;
let currentTab = "text";
let batteryPct = null;
let pollTimer = null;

/* ---------- BLE UUIDs (same as SDK) ---------- */
const ADV_SVC = 0xAF30;
const PRINT_SVC = 0xAE30;
const TX_CHAR = 0xAE01;
const RX_CHAR = 0xAE02;

/* ============================================================
   TOAST — transient feedback
   ============================================================ */
let toastTimer = null;
const TOAST_LIFE = { ok: 3200, err: 5500, info: 4000 };
function toast(msg, kind = "") {
  const el = $("toast");
  $("toast-text").textContent = msg;
  el.className = "toast show" + (kind ? " " + kind : "");
  clearTimeout(toastTimer);
  const life = TOAST_LIFE[kind] || TOAST_LIFE.info;
  toastTimer = setTimeout(() => el.classList.remove("show"), life);
}
$("toast").addEventListener("click", () => $("toast").classList.remove("show"));

/* ============================================================
   PRINTER PANEL (connect/disconnect + status)
   This single control replaces the old Connect button + device card.
   ============================================================ */
const panel = $("printer-panel");
function setPanel({ state, name, meta, action, battery }) {
  panel.classList.remove("ok", "busy", "err", "warn");
  if (state) panel.classList.add(state);
  if (name !== undefined) $("pp-name").textContent = name;
  if (meta !== undefined) $("pp-meta").textContent = meta;
  if (action !== undefined) $("pp-action").textContent = action;
  if (battery !== undefined) {
    const wrap = $("pp-battery");
    if (battery == null) {
      wrap.classList.add("hide");
    } else {
      wrap.classList.remove("hide");
      $("pp-pct").textContent = battery + "%";
      const fill = $("pp-bat-fill");
      fill.style.width = Math.max(8, Math.min(100, battery)) + "%";
      fill.style.background = battery <= 15 ? "#e0734a" : battery <= 40 ? "#d99836" : "#7fa84e";
    }
  }
}

function panelDisconnected() {
  setPanel({ state: null, name: "No printer", meta: "Tap to connect over Bluetooth", action: "Connect ↗", battery: null });
}
function panelConnecting() {
  setPanel({ state: "busy", name: "Scanning…", meta: "Pick your MX10 in the dialog", action: "Cancel" });
}
function panelConnected() {
  const name = printer.device?.name || printer.modelName || "MX10";
  const st = printer.printerState || {};
  let metaState = "warn";
  let metaText = "Ready to print";
  if (st.outOfPaper) { metaState = "err"; metaText = "Out of paper"; }
  else if (st.coverOpen) { metaState = "err"; metaText = "Cover open"; }
  else if (st.overheat) { metaState = "warn"; metaText = "Overheating — let it cool"; }
  else if (st.busy) { metaState = "busy"; metaText = "Printing…"; }
  else if (st.lowPower || (batteryPct != null && batteryPct <= 15)) { metaState = "warn"; metaText = "Battery low — charge soon"; }
  else { metaState = "ok"; metaText = "Ready to print"; }
  setPanel({
    state: metaState,
    name,
    meta: metaText,
    action: "Disconnect",
    battery: batteryPct
  });
}

// single click handler — does the right thing for the current state
panel.addEventListener("click", onPanelClick);
async function onPanelClick() {
  if (!navigator.bluetooth) { toast("Web Bluetooth not available in this browser.", "err"); return; }
  if (connecting) return; // ignore mid-scan clicks
  if (connected) {
    try { await printer.disconnect?.(); } catch {}
    onDisconnected();
    return;
  }
  connecting = true;
  panelConnecting();
  try {
    await requestAndAttach();
    onConnected();
  } catch (e) {
    onDisconnected();
    const msg = (e?.message || e || "").toString();
    if (!/cancel|chooser|user/i.test(msg)) toast("Couldn't connect: " + msg, "err");
  } finally {
    connecting = false;
  }
}

/* ============================================================
   BLE connection (mirrors the SDK's connect so we control it)
   ============================================================ */
async function attach(device) {
  printer.device = device;
  printer.modelName = device.name || "";
  const server = await device.gatt.connect();
  printer.server = server;
  const svc = await server.getPrimaryService(PRINT_SVC);
  printer.txCharacteristic = await svc.getCharacteristic(TX_CHAR);
  printer.rxCharacteristic = await svc.getCharacteristic(RX_CHAR);
  await printer.rxCharacteristic.startNotifications();
  printer.rxCharacteristic.addEventListener("characteristicvaluechanged", printer.handleNotification.bind(printer));
  device.addEventListener("gattserverdisconnected", onGattDisconnected, { once: true });
  await printer.getDeviceState();
  await new Promise(r => setTimeout(r, 200));
  await printer.prepare(printer.options.speed ?? 32, +$("energy").value);
  await readBattery();
}

async function requestAndAttach() {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [ADV_SVC] }],
    optionalServices: [PRINT_SVC, "battery_service", "device_information"]
  });
  await attach(device);
}

async function readBattery() {
  try {
    const svc = await printer.server.getPrimaryService("battery_service");
    const ch = await svc.getCharacteristic("battery_level");
    const v = await ch.readValue();
    batteryPct = v.getUint8(0);
  } catch {
    batteryPct = null;
  }
}

function onConnected() {
  connected = true;
  setPrintEnabled();
  panelConnected();
  startPolling();
  toast("Connected to " + (printer.device?.name || "printer"), "ok");
}
function onDisconnected() {
  connected = false;
  batteryPct = null;
  stopPolling();
  setPrintEnabled();
  panelDisconnected();
}
function onGattDisconnected() {
  if (connected) {
    onDisconnected();
    toast("Printer disconnected — connection lost", "err");
  }
}
function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!connected || !printer.isConnected()) return;
    try {
      await printer.getDeviceState();
      await new Promise(r => setTimeout(r, 200));
      await readBattery();
      panelConnected();
    } catch {}
  }, 20000);
}
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

/* ---------- BT availability ---------- */
if (!navigator.bluetooth) {
  $("warning").classList.remove("hide");
  panel.setAttribute("disabled", "true");
  panel.style.opacity = 0.55;
  panel.style.cursor = "not-allowed";
  setPanel({ state: null, name: "Bluetooth unavailable", meta: "Open in Chrome to print", action: "" });
}

function setPrintEnabled() {
  $("print-text").disabled = !connected;
  $("print-image").disabled = !connected || !imageDataUrl;
  $("print-qr").disabled = !connected || !qrDataUrl;
  $("feed").disabled = !connected;
}

/* ============================================================
   TABS
   ============================================================ */
document.querySelectorAll(".tabs button").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("active", x === b));
    currentTab = b.dataset.tab;
    ["text","image","qr"].forEach(t => $("panel-"+t).classList.toggle("hide", t !== currentTab));
    renderPreview();
  });
});

/* ============================================================
   TEXT controls (font/size + contenteditable + toolbar)
   ============================================================ */
const txt = $("txt");
let fontKey = "mono";
let fontSize = 32;
let align = "start";

$("fontFamily").addEventListener("change", e => {
  fontKey = e.target.value;
  txt.style.fontFamily = FONTS[fontKey];
  renderPreview();
});
$("fontSize").addEventListener("change", e => {
  fontSize = +e.target.value;
  renderPreview();
});
txt.style.fontFamily = FONTS[fontKey];

document.querySelectorAll(".tb-btn").forEach(b => {
  b.addEventListener("mousedown", e => e.preventDefault());
  b.addEventListener("click", () => {
    if (b.dataset.cmd) {
      document.execCommand(b.dataset.cmd, false, null);
      txt.focus();
      updateToolbarState();
      renderPreview();
    } else if (b.dataset.align) {
      align = b.dataset.align;
      updateToolbarState();
      renderPreview();
    }
  });
});
function updateToolbarState() {
  document.querySelectorAll(".tb-btn[data-cmd]").forEach(b => {
    let state = false;
    try { state = document.queryCommandState(b.dataset.cmd); } catch {}
    b.classList.toggle("active", state);
  });
  document.querySelectorAll(".tb-btn[data-align]").forEach(b => {
    b.classList.toggle("active", b.dataset.align === align);
  });
}
txt.addEventListener("input", renderPreview);
txt.addEventListener("keyup", updateToolbarState);
txt.addEventListener("mouseup", updateToolbarState);
txt.addEventListener("focus", updateToolbarState);
txt.addEventListener("paste", e => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, text);
});

/* ---------- DOM → styled run list for canvas rendering ---------- */
function getStyledLines(root) {
  const lines = [[]];
  function walk(node, ctx) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/\u00A0/g, " ");
      if (!text) return;
      const parts = text.split("\n");
      parts.forEach((p, i) => {
        if (i > 0) lines.push([]);
        if (p) lines[lines.length - 1].push({ text: p, ...ctx });
      });
      return;
    }
    if (node.nodeName === "BR") { lines.push([]); return; }
    const newCtx = { ...ctx };
    const nn = node.nodeName;
    if (nn === "B" || nn === "STRONG") newCtx.bold = true;
    if (nn === "I" || nn === "EM") newCtx.italic = true;
    if (nn === "U") newCtx.underline = true;
    const isBlock = nn === "DIV" || nn === "P";
    const isFirstChildOfRoot = (node.parentNode === root) && (node === root.firstChild);
    if (isBlock && !isFirstChildOfRoot && lines[lines.length - 1].length > 0) lines.push([]);
    for (const child of node.childNodes) walk(child, newCtx);
  }
  walk(root, { bold: false, italic: false, underline: false });
  while (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
  return lines;
}
function plainTextFromEditor() {
  return getStyledLines(txt).map(l => l.map(r => r.text).join("")).join("\n").trim();
}

/* ---------- canvas text renderer (384px wide) ---------- */
async function renderTextToCanvas() {
  try {
    const fam = FONTS[fontKey].split(',')[0];
    await document.fonts.load(`${fontSize}px ${fam}`);
    await document.fonts.load(`bold ${fontSize}px ${fam}`);
    await document.fonts.load(`italic ${fontSize}px ${fam}`);
  } catch {}
  const W = 384;
  const PAD_X = 4;
  const inner = W - PAD_X * 2;
  const lines = getStyledLines(txt);
  if (lines.length === 0 || lines.every(l => l.length === 0)) return null;
  const tmp = document.createElement("canvas");
  const ctx = tmp.getContext("2d");
  const fontStack = FONTS[fontKey];
  const setFont = run => {
    const parts = [];
    if (run.italic) parts.push("italic");
    if (run.bold) parts.push("bold");
    parts.push(`${fontSize}px`);
    parts.push(fontStack);
    ctx.font = parts.join(" ");
  };
  const wrapped = [];
  for (const inputLine of lines) {
    if (inputLine.length === 0) { wrapped.push([]); continue; }
    let cur = [];
    let curW = 0;
    const pushLine = () => { wrapped.push(cur); cur = []; curW = 0; };
    const tokens = [];
    for (const run of inputLine) {
      const re = /(\s+|\S+)/g;
      let m;
      while ((m = re.exec(run.text)) !== null) tokens.push({ ...run, text: m[0] });
    }
    for (const tok of tokens) {
      setFont(tok);
      const w = ctx.measureText(tok.text).width;
      if (curW + w > inner && cur.length > 0) {
        pushLine();
        if (/^\s+$/.test(tok.text)) continue;
      }
      if (w > inner && !(/^\s+$/.test(tok.text))) {
        let chunk = "";
        let chunkW = 0;
        for (const ch of tok.text) {
          const cw = ctx.measureText(ch).width;
          if (chunkW + cw > inner && chunk) {
            cur.push({ ...tok, text: chunk });
            pushLine();
            chunk = ch; chunkW = cw;
          } else {
            chunk += ch; chunkW += cw;
          }
        }
        if (chunk) { cur.push({ ...tok, text: chunk }); curW = chunkW; }
      } else {
        cur.push(tok);
        curW += w;
      }
    }
    pushLine();
  }
  while (wrapped.length > 1 && wrapped[wrapped.length - 1].length === 0) wrapped.pop();
  if (wrapped.length === 0) return null;
  const lineHeight = Math.round(fontSize * 1.32);
  const topPad = Math.round(fontSize * 0.25);
  const botPad = Math.round(fontSize * 0.25);
  const H = topPad + wrapped.length * lineHeight + botPad;
  tmp.width = W; tmp.height = H;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000"; ctx.textBaseline = "alphabetic";
  wrapped.forEach((line, idx) => {
    let lineWidth = 0;
    for (const run of line) { setFont(run); lineWidth += ctx.measureText(run.text).width; }
    let x = PAD_X;
    if (align === "center") x = (W - lineWidth) / 2;
    if (align === "end") x = W - PAD_X - lineWidth;
    const baseline = topPad + idx * lineHeight + Math.round(fontSize * 0.95);
    for (const run of line) {
      setFont(run);
      ctx.fillText(run.text, x, baseline);
      const w = ctx.measureText(run.text).width;
      if (run.underline) {
        const uy = baseline + Math.round(fontSize * 0.12);
        const uh = Math.max(1, Math.round(fontSize / 18));
        ctx.fillRect(x, uy, w, uh);
      }
      x += w;
    }
  });
  return tmp;
}

/* ============================================================
   IMAGE controls
   ============================================================ */
$("imgFile").addEventListener("change", e => loadImage(e.target.files[0]));
const dz = $("dropzone");
["dragenter","dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("dragover"); }));
["dragleave","drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("dragover"); }));
dz.addEventListener("drop", e => {
  const f = e.dataTransfer.files?.[0];
  if (f && f.type.startsWith("image/")) loadImage(f);
});
function loadImage(f) {
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    imageDataUrl = r.result;
    $("filename").textContent = f.name;
    $("filename").classList.remove("hide");
    setPrintEnabled();
    renderPreview();
  };
  r.readAsDataURL(f);
}
$("dither").addEventListener("change", renderPreview);

/* ============================================================
   QR controls
   ============================================================ */
const qrInput = $("qrText");
let qrDebounce = null;
qrInput.addEventListener("input", () => { clearTimeout(qrDebounce); qrDebounce = setTimeout(updateQR, 180); });
async function updateQR() {
  const v = qrInput.value.trim();
  if (!v) { qrDataUrl = null; setPrintEnabled(); renderPreview(); return; }
  try {
    qrDataUrl = await QRCode.toDataURL(v, { margin: 2, width: 384, errorCorrectionLevel: 'M', color: { dark: "#000", light: "#fff" } });
    setPrintEnabled();
    renderPreview();
  } catch {}
}

/* ============================================================
   SETTINGS (density + orientation + feed)
   ============================================================ */
const energy = $("energy");
function updateEnergyLabel() {
  const v = +energy.value;
  const labels = ["lower", "normal", "higher", "max"];
  const idx = v < 16000 ? 0 : v < 28000 ? 1 : v < 44000 ? 2 : 3;
  $("energy-val").textContent = labels[idx];
}
energy.addEventListener("input", updateEnergyLabel);
updateEnergyLabel();

let orientation = "portrait";
document.querySelectorAll("#orient-seg button").forEach(b => {
  b.addEventListener("click", () => {
    orientation = b.dataset.orient;
    document.querySelectorAll("#orient-seg button").forEach(x => x.classList.toggle("active", x === b));
    renderPreview();
  });
});
const PRINT_W = 384;   // physical print width in dots

// Rotate 90° for landscape. Crops surrounding whitespace first, then pads the
// result to at least PRINT_W wide so the printer's scale-to-384 step does NOT
// upscale a narrow rotated strip (which is what blew the height up to full).
function rotate90(srcUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;

      // 1. find the content bounding box (non-white, non-transparent pixels)
      let minX = 0, minY = 0, maxX = W - 1, maxY = H - 1;
      try {
        const o = document.createElement("canvas");
        o.width = W; o.height = H;
        const octx = o.getContext("2d");
        octx.drawImage(img, 0, 0);
        const d = octx.getImageData(0, 0, W, H).data;
        minX = W; minY = H; maxX = -1; maxY = -1;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const bg = d[i + 3] < 10 || (d[i] > 244 && d[i + 1] > 244 && d[i + 2] > 244);
            if (!bg) {
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < minX) { minX = 0; minY = 0; maxX = W - 1; maxY = H - 1; } // blank
      } catch { /* tainted canvas — fall back to no crop */ }

      const cw = maxX - minX + 1, ch = maxY - minY + 1;

      // 2. rotate the cropped region 90°; pad width to PRINT_W, centered, on white
      const c = document.createElement("canvas");
      c.width = Math.max(ch, PRINT_W);
      c.height = cw;
      const cx = c.getContext("2d");
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
      cx.save();
      cx.translate(c.width / 2, c.height / 2);
      cx.rotate(Math.PI / 2);
      cx.drawImage(img, minX, minY, cw, ch, -cw / 2, -ch / 2, cw, ch);
      cx.restore();
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(srcUrl);
    img.src = srcUrl;
  });
}
async function orient(srcUrl) {
  return orientation === "landscape" ? await rotate90(srcUrl) : srcUrl;
}

/* ============================================================
   PRINT (paced bitmap writes, see comment block in source)
   ============================================================ */
const CMD_BITMAP = 162;
const END_FEED = 40;
const FALLBACK_ROW_DELAY = 10;
let txWithResponse = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendRow(rowBytes) {
  const ch = printer.txCharacteristic;
  const pkt = printer.makeCommand(CMD_BITMAP, rowBytes);
  if (txWithResponse === null) txWithResponse = !!(ch.properties && ch.properties.write);
  if (txWithResponse) {
    await ch.writeValueWithResponse(pkt);
  } else {
    await ch.writeValueWithoutResponse(pkt);
    await sleep(FALLBACK_ROW_DELAY);
  }
}
async function printPaced(dataUrl, dither, rotate = 0) {
  const opts = { dither, rotate, flipH: false, flipV: false, brightness: 128, offset: 0 };
  const bmp = await printer.imageToBitmap(dataUrl, opts);
  await printer.prepare(printer.options.speed ?? 32, +energy.value);
  const bpr = Math.ceil(bmp.width / 8);
  for (let y = 0; y < bmp.height; y++) {
    await sendRow(bmp.data.slice(y * bpr, y * bpr + bpr));
  }
  await printer.finish(END_FEED);
}

async function safePrint(fn, okMsg = "Printed") {
  if (!connected) { toast("Connect a printer first.", "err"); return; }
  const beforeDisabled = ["print-text","print-image","print-qr","feed"].map(id => [id, $(id).disabled]);
  ["print-text","print-image","print-qr","feed"].forEach(id => $(id).disabled = true);
  $("receipt").classList.add("printing");
  try {
    printer.options.energy = +energy.value;
    await fn();
    toast(okMsg, "ok");
  } catch (e) {
    toast("Couldn't print: " + (e?.message || e), "err");
  } finally {
    $("receipt").classList.remove("printing");
    beforeDisabled.forEach(([id, d]) => $(id).disabled = d);
    setPrintEnabled();
  }
}

$("print-text").addEventListener("click", async () => {
  const plain = plainTextFromEditor();
  if (!plain) { toast("Text is empty.", "err"); return; }
  const canvas = await renderTextToCanvas();
  if (!canvas) { toast("Text is empty.", "err"); return; }
  const dataUrl = await orient(canvas.toDataURL("image/png"));
  safePrint(() => printPaced(dataUrl, "threshold"));
});
$("print-image").addEventListener("click", async () => {
  if (!imageDataUrl) { toast("Choose an image first.", "err"); return; }
  const dataUrl = await orient(imageDataUrl);
  safePrint(() => printPaced(dataUrl, $("dither").value));
});
$("print-qr").addEventListener("click", () => {
  if (!qrDataUrl) { toast("Enter some text for the QR code.", "err"); return; }
  safePrint(() => printPaced(qrDataUrl, "threshold"));
});
$("feed").addEventListener("click", () => safePrint(() => printer.feed(80), "Paper fed"));

/* ============================================================
   LIVE PREVIEW
   ============================================================ */
let previewSeq = 0;
async function renderPreview() {
  const body = $("receipt-body");
  const myTurn = ++previewSeq;
  if (currentTab === "text") {
    const plain = plainTextFromEditor();
    if (!plain) {
      body.className = "receipt-body empty";
      body.innerHTML = "<span>Type something to see it here ↑</span>";
      return;
    }
    const canvas = await renderTextToCanvas();
    if (myTurn !== previewSeq) return;
    if (!canvas) {
      body.className = "receipt-body empty";
      body.innerHTML = "<span>Type something to see it here ↑</span>";
      return;
    }
    const src = await orient(canvas.toDataURL("image/png"));
    if (myTurn !== previewSeq) return;
    body.className = "receipt-body";
    body.innerHTML = "";
    const img = document.createElement("img");
    img.className = "receipt-render";
    img.src = src;
    body.appendChild(img);
  } else if (currentTab === "image") {
    if (imageDataUrl) {
      const src = await orient(imageDataUrl);
      if (myTurn !== previewSeq) return;
      body.className = "receipt-body";
      body.innerHTML = "";
      const img = document.createElement("img");
      img.className = "receipt-img";
      img.src = src;
      body.appendChild(img);
    } else {
      body.className = "receipt-body empty";
      body.innerHTML = "<span>Choose an image ↑</span>";
    }
  } else {
    body.className = "receipt-body";
    body.innerHTML = "";
    if (qrDataUrl) {
      const img = document.createElement("img");
      img.className = "receipt-qr";
      img.src = qrDataUrl;
      body.appendChild(img);
    } else {
      body.className = "receipt-body empty";
      body.innerHTML = "<span>Type a link or text ↑</span>";
    }
  }
}

/* ============================================================
   SERVICE WORKER
   ============================================================ */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

/* ============================================================
   INIT
   ============================================================ */
renderPreview();
setPrintEnabled();
panelDisconnected();

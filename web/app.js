"use strict";
// The page's controls. The layout itself is in core.js.

const C = BookCore;
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const UNIT = { pt: 1, mm: 72 / 25.4, in: 72 };
const STORE = "booksignatures-settings";
const DETECT_SCALE = 0.75;      // pixels per point when measuring
const SIDE_NAME = { t: "top", b: "bottom", i: "inner", o: "outer" };
const TRIM_ID = { t: "trim-top", b: "trim-bottom", i: "trim-inner", o: "trim-outer" };
const KEEP = ["paper", "extend"];   // remembered besides lengths and units

const $ = (id) => document.getElementById(id);
const lenIds = [...document.querySelectorAll("[data-len]")].map((el) => el.id);

let src = null;      // { bytes, doc, name, n, w, h, meas, detectParity }
let sig = null;      // { total, padStart, padAuto, sheetsPer, reduce (sheets) }
let wantSheets = 5;  // preferred sheets per signature
let cutKeep = "tb";  // the cut last set by hand; the other follows it
let wantReduce = 0;  // sheets fewer in the first and last signature
let unit = "pt";
let detected = null;
let pdfUrl = null, outBytes = null, timer = null, runId = 0;   // outBytes: the download (no outline)
let builtSig = null;   // the signature settings the current PDF was built with
const sigKey = () => sig && JSON.stringify([sig.total, sig.padStart, sig.sheetsPer, sig.reduce]);
const sigDirty = () => !!src && sigKey() !== builtSig;

// ---------- settings ----------

const num = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : 0; };
const len = (id) => num(id) * UNIT[unit];
const fmt = (v) => String(+v.toFixed(unit === "in" ? 3 : 1));
const show = (pt) => fmt(pt / UNIT[unit]);

function save() {
  const s = { unit, wantSheets, reduceSheets: wantReduce, cutKeep };
  for (const id of lenIds) s[id] = $(id).value;
  for (const id of KEEP) s[id] = $(id).type === "checkbox" ? $(id).checked : $(id).value;
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* no storage */ }
}

function restore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE)); } catch (e) { /* ignore */ }
  if (!s) return;
  if (s.unit && UNIT[s.unit]) { unit = s.unit; $("unit").value = unit; }
  for (const id of lenIds) if (s[id] != null) $(id).value = s[id];
  for (const id of KEEP) if (s[id] != null) $(id)[$(id).type === "checkbox" ? "checked" : "value"] = s[id];
  if (s.wantSheets) wantSheets = s.wantSheets;
  if (s.reduceSheets) wantReduce = s.reduceSheets;
  if (s.cutKeep === "tb" || s.cutKeep === "outer") cutKeep = s.cutKeep;
  $("reduce").value = wantReduce;
}

function settings() {
  return {
    trim: { t: len("trim-top"), b: len("trim-bottom"), i: len("trim-inner"), o: len("trim-outer") },
    paper: $("paper").value, paperW: len("paper-w"), paperH: len("paper-h"),
    gutter: len("gutter"), outer: len("outer"), top: len("top"), bottom: len("bottom"),
    cutTop: len("cut-tb"), cutBottom: len("cut-tb"), cutOuter: len("cut-outer"),
    extend: $("extend").checked, outline: true,
    ...sig,
  };
}

// ---------- signatures ----------

function pickSheets(total) {
  const opts = C.signatureOptions(total, sig.reduce);
  return opts.reduce((a, b) => (Math.abs(b.sheetsPer - wantSheets) < Math.abs(a.sheetsPer - wantSheets) ? b : a)).sheetsPer;
}

function setTotal(total) {
  const blanks = total - src.n;
  if (sig.padAuto || sig.padStart > blanks) { sig.padStart = Math.floor(blanks / 2); sig.padAuto = true; }
  sig.total = total;
  setReduce();
}

// The largest reduction up to the one asked for that these pages allow.
function setReduce() {
  let r = wantReduce;
  while (r > 0 && !C.signatureOptions(sig.total, r).length) r--;
  sig.reduce = r;
  sig.sheetsPer = pickSheets(sig.total);
}

function showSignatures() {
  const tbody = $("sig-table").querySelector("tbody");
  if (!src) { tbody.innerHTML = ""; $("blanks").textContent = ""; $("sig-hint").hidden = true; return; }
  const blanks = sig.total - src.n;
  $("total").textContent = sig.total;
  $("minus4").disabled = sig.total - 4 < src.n;
  $("blanks").textContent = blanks
    ? `${src.n} pages + ${blanks} blank: ${sig.padStart} at the start, ${blanks - sig.padStart} at the end.`
    : `${src.n} pages, no blank pages.`;
  $("pad").max = blanks;
  $("pad").value = sig.padStart;
  const r = sig.reduce, opts = C.signatureOptions(sig.total, r), sheets = sig.total / 4;
  $("sig-hint").hidden = !(!r && opts.length === 2 && sheets > 3);
  $("sig-hint").textContent = `${sheets} sheets only split as 1 signature or ${sheets} single sheets. Try −4 or +4.`;
  $("reduce-note").hidden = r === wantReduce;
  if (r !== wantReduce) {
    const s = (k) => `${k} sheet${k === 1 ? "" : "s"}`;
    let text = `With ${sig.total} pages, the first and last signatures can't be ${s(wantReduce)} smaller than the others` +
      (r ? `, so they're ${s(r)} smaller.` : ", so they're the same size.");
    const near = nearestTotalFor(wantReduce);
    if (near) text += ` ${near} pages would allow ${wantReduce}.`;
    $("reduce-note").textContent = text;
  }
  tbody.innerHTML = opts.map((o) =>
    `<tr data-s="${o.sheetsPer}" class="${o.sheetsPer === sig.sheetsPer ? "sel" : ""}">` +
    `<td>${o.sheetsPer}</td><td>${o.endSheets}</td><td>${o.sigs}</td></tr>`).join("");
  $("update-pdf").disabled = !sigDirty();
}

// The page count closest to the current one that allows this reduction (fewer pages only down to the PDF's own).
function nearestTotalFor(reduce) {
  for (let d = 4; d <= 400; d += 4) {
    for (const t of [sig.total + d, sig.total - d]) {
      if (t >= src.n && C.signatureOptions(t, reduce).length) return t;
    }
  }
  return null;
}

// Signature changes are only listed until "Update PDF": the preview says little about them.
function sigChanged() {
  save();
  showSignatures();
}

// ---------- margin detection ----------

// Renders each page small with pdf.js and finds its ink.
async function measurePages() {
  const pdf = await pdfjsLib.getDocument({ data: src.bytes.slice() }).promise;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const meas = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    $("detect-status").textContent = `Reading page ${p} of ${pdf.numPages}…`;
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: DETECT_SCALE });
    const W = Math.ceil(vp.width), H = Math.ceil(vp.height);
    canvas.width = W; canvas.height = H;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    // "print" draws without requestAnimationFrame, which stops in background tabs
    await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
    page.cleanup();
    const px = ctx.getImageData(0, 0, W, H).data;
    const lum = new Uint8Array(W * H);
    for (let q = 0, o = 0; q < lum.length; q++, o += 4) lum[q] = (px[o] * 299 + px[o + 1] * 587 + px[o + 2] * 114) / 1000 | 0;
    meas.push(C.detectInk(lum, W, H, vp.width / DETECT_SCALE, vp.height / DETECT_SCALE, DETECT_SCALE));
  }
  pdf.destroy();
  return meas;
}

function setTrims(tr) {
  for (const s of C.SIDES) $(TRIM_ID[s]).value = show(tr[s]);
  schedule();
}

function showDetected() {
  const box = $("detect-result");
  if (!detected) { box.hidden = true; return; }
  const list = (tr) => C.SIDES.map((s) => `${SIDE_NAME[s]} ${show(tr[s])}`).join(", ") + ` ${unit}`;
  if (C.SIDES.every((s) => detected.tight[s] === detected.rec[s])) {
    box.innerHTML = `<p>Every page fits within: ${list(detected.tight)}.</p>`;
  } else {
    const byPage = {};
    for (const o of detected.outliers) (byPage[o.page] ||= []).push(`${o.lines} line${o.lines === 1 ? "" : "s"} past ${SIDE_NAME[o.side]}`);
    const pages = Object.entries(byPage).map(([pg, s]) => `<li>Page ${pg}: ${s.join(", ")}</li>`).join("");
    box.innerHTML =
      `<p><b>Recommended:</b> ${list(detected.rec)}</p><p>Lines that stick out:</p><ul>${pages}</ul>` +
      `<p><b>Nothing cut:</b> ${list(detected.tight)}</p>` +
      `<div class="btns"><button class="secondary" data-use="rec">Use recommended</button>` +
      `<button class="secondary" data-use="tight">Use nothing cut</button></div>`;
  }
  box.hidden = false;
}

async function detect() {
  if (!src) return;
  $("detect").disabled = true;
  try {
    src.meas = await measurePages();
    src.detectParity = sig.padStart % 2;
    detected = C.recommend(src.meas, sig.padStart, C.commonSize(src.doc));
    $("detect-status").textContent = detected ? "" : "Every page is blank.";
    if (detected) setTrims(detected.rec);
    showDetected();
  } catch (e) {
    $("detect-status").textContent = "Couldn't read the pages: " + e.message;
  } finally {
    $("detect").disabled = false;
  }
}

// ---------- output ----------

// sync: also re-set the cuts (anything but the cut fields can change the leftover space)
function schedule(sync = true) {
  if (sync) syncCuts();
  save();
  showSignatures();
  clearTimeout(timer);
  timer = setTimeout(update, 200);
}

async function update() {
  $("custom-size").hidden = $("paper").value !== "custom";
  showSignatures();
  if (!src) return;
  const id = ++runId, key = sigKey();
  let res;
  try { res = await C.build(src.doc, src.meas, settings()); }
  catch (e) { res = { error: "Couldn't lay out this PDF: " + e.message }; }
  if (id !== runId) return;
  if (res.error) { $("layout").textContent = res.error; $("layout").className = "warn"; return; }

  $("parity").hidden = !(src.meas && sig.padStart % 2 !== src.detectParity);
  $("parity").textContent = "Left and right pages swapped since detecting. Detect margins again.";

  const L = res.L, sheets = sig.total / 4;
  const pct = Math.round(L.scale * 100);
  const size = pct === 100 ? "Pages are printed at full size."
    : pct < 100 ? `Pages are shrunk to ${pct}% of their size to fit the sheet.`
    : `Pages are enlarged to ${pct}% of their size to fill the sheet.`;
  $("final").innerHTML = `Finished book pages: <b>${show(L.finalW)} × ${show(L.finalH)} ${unit}</b>`;
  let text = `${sheets} sheets of ${show(L.W)} × ${show(L.H)} ${unit}, printed on both sides. ${size}`;
  if (res.cut.length) text += ` Not enough room for the long lines on page${res.cut.length > 1 ? "s" : ""} ${res.cut.join(", ")}.`;
  $("layout").className = "muted";
  $("layout").textContent = text;

  builtSig = key;
  $("update-pdf").disabled = !sigDirty();
  outBytes = res.bytes;
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = URL.createObjectURL(new Blob([res.preview || res.bytes], { type: "application/pdf" }));
  $("frame").src = pdfUrl;
  $("frame").hidden = false;
  $("empty").hidden = true;
  $("download").disabled = false;
}

async function loadFile(file) {
  if (!file) return;
  $("warn").hidden = true;
  detected = null;
  showDetected();
  $("detect-status").textContent = "";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const n = doc.getPageCount();
    if (!n) throw new Error("it has no pages");
    if (doc.isEncrypted) {
      throw new Error("it's encrypted, which this page can't read (even when it opens without a password). " +
        "Remove the encryption first, for example with: qpdf --decrypt in.pdf out.pdf");
    }
    const [w, h] = C.commonSize(doc);
    src = { bytes, doc, n, w, h, name: file.name.replace(/\.pdf$/i, ""), meas: null };
    sig = { padAuto: true };
    setTotal(C.roundUp4(n));
    $("file-label").textContent = file.name;
    $("info").textContent = `${n} pages, ${show(w)} × ${show(h)} ${unit}`;
    $("detect").disabled = false;
    const warns = [];
    const sizes = new Set(doc.getPages().map((p) => C.visibleSize(p).map((v) => v.toFixed(0)).join("×")));
    if (sizes.size > 1) warns.push(`Pages come in ${sizes.size} sizes. The layout uses the most common one; larger pages are shrunk to fit.`);
    if (warns.length) { $("warn").textContent = warns.join(" "); $("warn").hidden = false; }
    syncCuts();
    builtSig = sigKey();   // the first build uses these
    update();
  } catch (e) {
    src = null;
    $("detect").disabled = true;
    $("warn").textContent = `Couldn't open ${file.name}: ${e.message}`;
    $("warn").hidden = false;
  }
}

function setUnit(next) {
  const vals = lenIds.map((id) => num(id) * UNIT[unit] / UNIT[next]);
  unit = next;
  lenIds.forEach((id, k) => { $(id).value = fmt(vals[k]); });
  if (src) $("info").textContent = `${src.n} pages, ${show(src.w)} × ${show(src.h)} ${unit}`;
  showDetected();
  schedule();
}

// ---------- − / + buttons on number fields ----------

const STEP = { pt: 1, mm: 1, in: 0.05 };
for (const input of document.querySelectorAll("#settings input[type=number]")) {
  const isLen = "len" in input.dataset;
  const box = document.createElement("div");
  box.className = "num";
  input.replaceWith(box);
  const btn = (d, text, label) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "step"; b.textContent = text; b.setAttribute("aria-label", label);
    b.addEventListener("click", () => {
      const step = isLen ? STEP[unit] : (+input.step || 1);
      let v = Math.round(((parseFloat(input.value) || 0) + d * step) / step) * step;
      if (input.min !== "") v = Math.max(+input.min, v);
      if (input.max !== "") v = Math.min(+input.max, v);
      input.value = isLen ? fmt(v) : String(v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return b;
  };
  box.append(btn(-1, "−", "Less"), input, btn(1, "+", "More"));
}

// ---------- margin buttons ----------

// ---------- cut after binding ----------

// Sets the other cut from the one in cutKeep so that the cuts remove exactly
// the leftover space. If the kept cut is too small for that, it is raised
// (raise) or a note says how far.
function syncCuts(raise = true) {
  const note = $("balance-note");
  note.hidden = true;
  if (!src || $("paper").value === "fit") return;
  const size = C.commonSize(src.doc), other = cutKeep === "tb" ? "outer" : "tb";
  const ID = { tb: "cut-tb", outer: "cut-outer" };
  const cut = (keep) => { const r = C.balanceCut(...size, settings(), keep); return r && (keep === "tb" ? r.cutOuter : r.cutTB); };
  const noRoom = () => { note.textContent = "The margins leave no room for the page."; note.hidden = false; };
  const v = cut(cutKeep);
  if (v == null) return noRoom();
  if (v >= 0) { $(ID[other]).value = show(v); return; }
  // The leftover space is in the kept cut's direction, and it doesn't cut all of it.
  $(ID[other]).value = "0";
  const min = cut(other);
  if (min == null) return noRoom();
  if (raise) { $(ID[cutKeep]).value = show(min); return; }
  note.textContent = `${cutKeep === "tb" ? "Top and bottom" : "Outer"} needs at least ${show(min)} ${unit} to cut off the leftover space.`;
  note.hidden = false;
}

for (const [id, keep] of [["cut-tb", "tb"], ["cut-outer", "outer"]]) {
  // while typing, only note a too-small cut; raise it once the field is left
  $(id).addEventListener("input", () => { cutKeep = keep; syncCuts(false); schedule(false); });
  $(id).addEventListener("change", () => { cutKeep = keep; syncCuts(); schedule(false); });
}

// ---------- events ----------

$("file").addEventListener("change", (e) => loadFile(e.target.files[0]));
$("unit").addEventListener("change", (e) => setUnit(e.target.value));
$("detect").addEventListener("click", detect);
$("plus4").addEventListener("click", () => { if (src) { setTotal(sig.total + 4); sigChanged(); } });
$("minus4").addEventListener("click", () => { if (src && sig.total - 4 >= src.n) { setTotal(sig.total - 4); sigChanged(); } });
$("pad").addEventListener("input", () => {
  if (!src) return;
  sig.padStart = Math.max(0, Math.min(sig.total - src.n, Math.round(num("pad"))));
  sig.padAuto = false;
  sigChanged();
});
$("reduce").addEventListener("input", () => {
  wantReduce = Math.max(0, Math.round(num("reduce")));
  if (src) setReduce();
  sigChanged();
});
$("reduce").addEventListener("change", () => { $("reduce").value = wantReduce; });
$("sig-table").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-s]");
  if (tr && src) { sig.sheetsPer = wantSheets = +tr.dataset.s; sigChanged(); }
});
$("detect-result").addEventListener("click", (e) => {
  const use = e.target.dataset && e.target.dataset.use;
  if (use && detected) setTrims(detected[use]);
});
document.querySelectorAll("#settings input[data-len]:not([id^=cut-]), #settings input[type=checkbox], #paper").forEach((el) =>
  el.addEventListener("input", () => schedule()));
$("update-pdf").addEventListener("click", () => { clearTimeout(timer); update(); });
$("download").addEventListener("click", async () => {
  if (sigDirty()) { clearTimeout(timer); await update(); }
  if (!outBytes || sigDirty()) return;
  const url = URL.createObjectURL(new Blob([outBytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${src.name}_signatures.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
window.addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dragging"); });
window.addEventListener("dragleave", () => document.body.classList.remove("dragging"));
window.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("dragging");
  loadFile(e.dataTransfer.files[0]);
});

restore();
update();

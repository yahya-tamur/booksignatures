// Page arrangement and margin detection, shared by the web page and Node tests.
// All lengths are in points (1/72 inch); y goes up, as in PDF.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("pdf-lib"));
  else root.BookCore = factory(root.PDFLib);
})(this, function (PDFLib) {
  "use strict";
  const { PDFDocument, degrees, rgb } = PDFLib;

  const PAPERS = {
    "letter-l": [792, 612],
    "a4-l": [841.89, 595.28],
    "legal-l": [1008, 612],
    "tabloid-l": [1224, 792],
    "a3-l": [1190.55, 841.89],
  };
  const PAD = 2;         // white kept around detected ink
  const MAX_LINES = 3;   // "a few lines" past a margin
  const SIDES = ["t", "b", "i", "o"];

  // ---------- signatures ----------

  const roundUp4 = (n) => Math.ceil(n / 4) * 4;

  // Ways to split `total` pages into equal signatures.
  function signatureOptions(total) {
    const sheets = total / 4, opts = [];
    for (let sigs = 1; sigs <= sheets; sigs++) {
      if (sheets % sigs === 0) opts.push({ sigs, sheetsPer: sheets / sigs, pagesPer: total / sigs });
    }
    return opts;
  }

  // Source page indices in print order (null = blank); 2j and 2j+1 are the
  // left and right halves of output page j.
  function signatureOrder(n, padStart, total, sheetsPer) {
    const stack = 4 * sheetsPer;
    const padded = [...Array(padStart).fill(null), ...Array.from({ length: n }, (_, i) => i),
                    ...Array(total - n - padStart).fill(null)];
    const order = [];
    for (let s = 0; s < total; s += stack) {
      const p = padded.slice(s, s + stack);
      for (let i = 0; i < sheetsPer; i++) {
        order.push(p[stack - 1 - 2 * i], p[2 * i], p[2 * i + 1], p[stack - 2 - 2 * i]);
      }
    }
    return order;
  }

  // The first page of a book is a right-hand page.
  const isRecto = (pno, padStart) => (pno + padStart) % 2 === 0;

  // ---------- geometry ----------

  const pageRotation = (page) => ((page.getRotation().angle % 360) + 360) % 360;

  // Size of the page as viewers show it (CropBox, with /Rotate).
  function visibleSize(page) {
    const cb = page.getCropBox();
    return pageRotation(page) % 180 ? [cb.height, cb.width] : [cb.width, cb.height];
  }

  // The most common visible page size (scans often add a cover page of another size).
  function commonSize(doc) {
    const count = new Map();
    let best = null;
    for (const p of doc.getPages()) {
      const [w, h] = visibleSize(p), key = `${Math.round(w)}x${Math.round(h)}`;
      const c = count.get(key) || { n: 0, w, h };
      c.n++; count.set(key, c);
      if (!best || c.n > best.n) best = c;
    }
    return [best.w, best.h];
  }
  const sameSize = (w, h, size) => Math.abs(w - size[0]) < 2 && Math.abs(h - size[1]) < 2;

  // Trims on the visible page -> trims on the unrotated page.
  function unrotateTrims(rot, t, b, l, r) {
    switch (rot) {
      case 90: return { T: r, B: l, L: t, R: b };
      case 180: return { T: b, B: t, L: r, R: l };
      case 270: return { T: l, B: r, L: b, R: t };
      default: return { T: t, B: b, L: l, R: r };
    }
  }

  // Sheet size, scale and the two page slots. st: { trim, paper, paperW,
  // paperH, gutter, outer, top, bottom, cutTop, cutBottom, cutOuter }.
  // The cuts are paper removed from the finished text block; margins are
  // measured from the cut edge.
  function layout(pw, ph, st) {
    const { t, b, i, o } = st.trim;
    const ct = st.cutTop || 0, cb = st.cutBottom || 0, co = st.cutOuter || 0;
    const outer = st.outer + co, top = st.top + ct, bottom = st.bottom + cb;
    const cw = pw - i - o, ch = ph - t - b;
    if (cw <= 0 || ch <= 0) return { error: "The trim removes the whole page." };
    let W, H, scale;
    if (st.paper === "fit") {
      scale = 1;
      W = 2 * (outer + cw + st.gutter);
      H = top + ch + bottom;
    } else {
      [W, H] = st.paper === "custom" ? [st.paperW, st.paperH] : PAPERS[st.paper];
      const aw = W / 2 - st.gutter - outer, ah = H - top - bottom;
      if (aw <= 0 || ah <= 0) return { error: "The margins leave no room on the paper." };
      scale = Math.min(aw / cw, ah / ch);
    }
    const finalW = W / 2 - co, finalH = H - ct - cb;
    if (finalW <= 0 || finalH <= 0) return { error: "The cut removes the whole page." };
    const sw = cw * scale, sh = ch * scale;
    const free = W / 2 - st.gutter - outer - sw;
    return {
      W, H, scale, sw, sh, ct, cb, co, finalW, finalH,
      leftX: outer + free / 2,
      rightX: W / 2 + st.gutter + free / 2,
      y: bottom + (H - top - bottom - sh) / 2,
    };
  }

  // ---------- building the PDF ----------

  // doc: source PDFDocument. meas: detectInk results per page, or null.
  // st: layout settings plus { total, padStart, sheetsPer, extend }.
  async function build(doc, meas, st) {
    const n = doc.getPageCount();
    const [pw, ph] = commonSize(doc);
    const L = layout(pw, ph, st);
    if (L.error) return { error: L.error };
    const order = signatureOrder(n, st.padStart, st.total, st.sheetsPer);
    const out = await PDFDocument.create();
    const { t, b, i: inner, o: outer } = st.trim;
    const extended = new Set(), cut = new Set();

    const slots = [];
    for (let j = 0; j < order.length; j += 2) {
      for (const [pno, slotX, recto] of [[order[j], L.leftX, false], [order[j + 1], L.rightX, true]]) {
        if (pno === null) continue;
        const page = doc.getPage(pno);
        if (!page.node.Contents()) continue;           // empty page
        const cb = page.getCropBox();
        const rot = pageRotation(page);
        const [vw, vh] = visibleSize(page);
        const tv = { t, b, l: recto ? inner : outer, r: recto ? outer : inner };
        const cw = vw - tv.l - tv.r, ch = vh - tv.t - tv.b;
        if (cw <= 0 || ch <= 0) continue;
        // pages larger than the common size are shrunk to fit their slot
        const ps = Math.min(L.scale, L.sw / cw, L.sh / ch);
        const bw = cw * ps, bh = ch * ps;
        let X = slotX + (L.sw - bw) / 2, Y = L.y + (L.sh - bh) / 2, dw = bw, dh = bh;

        // Ink past the trim runs into the margin, up to the cut (or paper edge) or the fold.
        const ink = st.extend && meas && meas[pno] && meas[pno].ink;
        if (ink) {
          const avail = {
            l: (recto ? X - L.W / 2 : X - L.co) / ps,
            r: (recto ? L.W - L.co - (X + bw) : L.W / 2 - (X + bw)) / ps,
            t: (L.H - L.ct - (Y + bh)) / ps,
            b: (Y - L.cb) / ps,
          };
          const ext = {};
          for (const s of ["t", "b", "l", "r"]) {
            const want = tv[s] - Math.max(0, ink[s] - PAD);
            ext[s] = want > 0 ? Math.min(want, Math.max(0, avail[s])) : 0;
            if (want > 0.5) extended.add(pno + 1);
            if (want - ext[s] > 0.5 && ink[s] < tv[s]) cut.add(pno + 1);
            tv[s] -= ext[s];
          }
          X -= ext.l * ps; Y -= ext.b * ps;
          dw += (ext.l + ext.r) * ps; dh += (ext.t + ext.b) * ps;
        }

        const u = unrotateTrims(rot, tv.t, tv.b, tv.l, tv.r);
        const clip = { left: cb.x + u.L, bottom: cb.y + u.B, right: cb.x + cb.width - u.R, top: cb.y + cb.height - u.T };
        slots.push({ j, pno, rot, clip, X, Y, dw, dh, ps });
      }
    }
    // One embedPages call, so fonts and images are shared instead of copied per page.
    const forms = await out.embedPages(slots.map((s) => doc.getPage(s.pno)), slots.map((s) => s.clip));

    let k = 0;
    for (let j = 0; j < order.length; j += 2) {
      const sheet = out.addPage([L.W, L.H]);
      for (; k < slots.length && slots[k].j === j; k++) {
        const { rot, clip, X, Y, dw, dh, ps } = slots[k];
        const fw = (clip.right - clip.left) * ps, fh = (clip.top - clip.bottom) * ps;
        const at = { 0: [X, Y, 0], 90: [X, Y + dh, -90], 180: [X + dw, Y + dh, 180], 270: [X + dw, Y, 90] }[rot] || [X, Y, 0];
        sheet.drawPage(forms[k], { x: at[0], y: at[1], width: fw, height: fh, rotate: degrees(at[2]) });
      }
    }
    const bytes = await out.save();

    // Preview only: outline in red what remains of each page after the cut.
    let preview = null;
    if (st.outline && (L.ct || L.cb || L.co)) {
      // drawn on a copy: pdf-lib ignores drawing on most pages after a save
      const copy = await PDFDocument.load(bytes);
      const box = { borderColor: rgb(0.9, 0, 0), borderWidth: 0.75, y: L.cb, width: L.finalW, height: L.finalH };
      for (const sheet of copy.getPages()) {
        sheet.drawRectangle({ ...box, x: L.co });
        sheet.drawRectangle({ ...box, x: L.W / 2 });
      }
      preview = await copy.save();
    }
    return { bytes, preview, L, extended: [...extended].sort((a, b) => a - b), cut: [...cut].sort((a, b) => a - b) };
  }

  // ---------- margin detection ----------

  // lum: grey levels (0-255) of a page rendered at `scale` pixels per point,
  // W x H pixels; wPt x hPt is the visible page size. Ink is anything clearly
  // darker than the most common (background) grey.
  function detectInk(lum, W, H, wPt, hPt, scale) {
    const hist = new Uint32Array(256);
    for (let q = 0; q < lum.length; q++) hist[lum[q]]++;
    let bg = 255;
    for (let v = 0; v < 256; v++) if (hist[v] > hist[bg]) bg = v;
    const thr = bg - 60;
    const rowMin = new Int16Array(H).fill(-1), rowMax = new Int16Array(H).fill(-1);
    let top = -1, bottom = -1, left = W, right = -1;
    for (let y = 0; y < H; y++) {
      let mn = -1, mx = -1;
      for (let x = 0, q = y * W; x < W; x++, q++) if (lum[q] < thr) { if (mn < 0) mn = x; mx = x; }
      if (mn >= 0) {
        rowMin[y] = mn; rowMax[y] = mx;
        if (top < 0) top = y;
        bottom = y;
        if (mn < left) left = mn;
        if (mx > right) right = mx;
      }
    }
    const ink = top < 0 ? null : {
      t: top / scale, b: Math.max(0, hPt - (bottom + 1) / scale),
      l: left / scale, r: Math.max(0, wPt - (right + 1) / scale),
    };
    return { wPt, hPt, scale, rowMin, rowMax, ink };
  }

  function sideDist(m, side, recto) {
    if (side === "t" || side === "b") return m.ink[side];
    return (side === "i") === recto ? m.ink.l : m.ink.r;
  }

  // Number of separate lines of ink within T points of a side.
  function linesWithin(m, side, recto, T) {
    const s = m.scale, Tp = T * s, Wp = m.wPt * s, Hp = m.hPt * s;
    const phys = side === "t" || side === "b" ? side : ((side === "i") === recto ? "l" : "r");
    let lines = 0, gap = 2;
    for (let y = 0; y < m.rowMin.length; y++) {
      let hit = false;
      if (m.rowMin[y] >= 0) {
        if (phys === "t") hit = y < Tp;
        else if (phys === "b") hit = y + 1 > Hp - Tp;
        else if (phys === "l") hit = m.rowMin[y] < Tp;
        else hit = m.rowMax[y] + 1 > Wp - Tp;
      }
      if (hit) { if (gap > 1) lines++; gap = 0; } else gap++;
    }
    return lines;
  }

  // Trims that cut nothing ("tight"), and larger ones that cut only a few
  // lines on a few pages ("rec"), with those pages listed.
  function recommend(meas, padStart, size) {
    const pages = meas.map((m, pno) => ({ m, pno, recto: isRecto(pno, padStart) }))
      .filter((p) => p.m && p.m.ink && (!size || sameSize(p.m.wPt, p.m.hPt, size)));
    if (!pages.length) return null;
    const maxPages = Math.max(2, Math.round(pages.length * 0.03));
    const trim = (d) => Math.max(0, Math.floor((d - PAD) * 2) / 2);
    const tight = {}, rec = {}, outliers = [];
    for (const side of SIDES) {
      const items = pages.map((p) => ({ ...p, d: sideDist(p.m, side, p.recto) })).sort((a, b) => a.d - b.d);
      let best = 0;
      for (let k = 1; k <= Math.min(maxPages, items.length - 1); k++) {
        const T = items[k].d;
        if (T - items[0].d < 1) continue;
        if (items.slice(0, k).every((p) => p.d >= T - 1 || linesWithin(p.m, side, p.recto, T - 1) <= MAX_LINES)) best = k;
        else break;
      }
      if (items[best].d - items[0].d < 4) best = 0;
      tight[side] = trim(items[0].d);
      rec[side] = trim(items[best].d);
      for (const p of items.slice(0, best)) {
        if (p.d < items[best].d - 1) {
          outliers.push({ page: p.pno + 1, side, lines: linesWithin(p.m, side, p.recto, items[best].d - 1),
                          past: items[best].d - p.d });
        }
      }
    }
    outliers.sort((a, b) => a.page - b.page);
    return { tight, rec, outliers };
  }

  return { PAPERS, SIDES, roundUp4, commonSize, signatureOptions, signatureOrder, isRecto, visibleSize,
           layout, build, detectInk, recommend };
});

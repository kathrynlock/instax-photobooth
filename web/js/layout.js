// Compose captured frames into a single 600x800 instant-film print.
// A port of photobooth/layout.py.
//   single  one photo
//   duo     two photos stacked, rotated to be viewed with the print sideways
//   quad    a 2x2 grid of four photos
// The print fills the film's whole picture area: the white frame and chin are
// part of the physical film, not the image.

(function () {
  const cfg = Booth.config;
  const { applyFilmLook, makeCanvas } = Booth.film;

  // (x, y, w, h) of each photo cell on the print, in fill order
  function cellRects(layoutName) {
    const [rows, cols, count] = cfg.LAYOUTS[layoutName];
    const cellW = Math.floor((cfg.CANVAS_W - (cols - 1) * cfg.GUTTER) / cols);
    const cellH = Math.floor((cfg.CANVAS_H - (rows - 1) * cfg.GUTTER) / rows);
    const rects = [];
    for (let i = 0; i < count; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      rects.push([c * (cellW + cfg.GUTTER), r * (cellH + cfg.GUTTER), cellW, cellH]);
    }
    return rects;
  }

  // the source rectangle of img that center-crops it to targetW:targetH
  function centerCrop(srcW, srcH, targetW, targetH) {
    const target = targetW / targetH;
    if (srcW / srcH > target) {               // too wide, trim the sides
      const w = Math.round(srcH * target);
      return [Math.floor((srcW - w) / 2), 0, w, srcH];
    }
    const h = Math.round(srcW / target);      // too tall, trim top/bottom
    return [0, Math.floor((srcH - h) / 2), srcW, h];
  }

  // rotate 90 degrees clockwise (for sideways layouts)
  function rotateCW(src) {
    const out = makeCanvas(src.height, src.width);
    const ctx = out.getContext("2d");
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, 0, 0);
    return out;
  }

  function orientForLayout(frame, layoutName) {
    return cfg.SIDEWAYS_LAYOUTS.includes(layoutName) ? rotateCW(frame) : frame;
  }

  // crop a frame to a cell's aspect, resize, and apply the film look
  function renderCell(frame, cellW, cellH) {
    const [sx, sy, sw, sh] = centerCrop(frame.width, frame.height, cellW, cellH);
    const cell = makeCanvas(cellW, cellH);
    const ctx = cell.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, cellW, cellH);
    return applyFilmLook(cell);
  }

  // frames: canvases (unmirrored), at least the layout's photo count
  function composePrint(frames, layoutName) {
    if (!cfg.LAYOUTS[layoutName]) throw new Error(`unknown layout ${layoutName}`);
    const count = cfg.LAYOUTS[layoutName][2];
    if (frames.length < count) throw new Error(`layout ${layoutName} needs ${count} frames`);

    const canvas = makeCanvas(cfg.CANVAS_W, cfg.CANVAS_H);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = `rgb(${cfg.BORDER_COLOR.join(",")})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    cellRects(layoutName).forEach(([x, y, w, h], i) => {
      ctx.drawImage(renderCell(orientForLayout(frames[i], layoutName), w, h), x, y);
    });
    return canvas;
  }

  // The print as a JPEG small enough for the Mini Link 3. Tries the configured
  // quality first and only steps down when the file is over the limit.
  async function encodeForPrinter(canvas) {
    const toBlob = (q) => new Promise((res) => canvas.toBlob(res, "image/jpeg", q));
    let best = null;
    let q = cfg.JPEG_QUALITY;
    let blob = await toBlob(q);
    if (blob.size <= cfg.MAX_PRINT_BYTES) {
      best = { blob, q };
    } else {
      // binary search for the highest quality that still fits (film grain makes
      // JPEGs big, so this usually lands around 0.6-0.75)
      let lo = cfg.MIN_JPEG_QUALITY, hi = q;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        const b = await toBlob(mid);
        if (b.size <= cfg.MAX_PRINT_BYTES) { best = { blob: b, q: mid }; lo = mid; } else { hi = mid; }
      }
      if (!best) {
        const b = await toBlob(cfg.MIN_JPEG_QUALITY);
        if (b.size <= cfg.MAX_PRINT_BYTES) best = { blob: b, q: cfg.MIN_JPEG_QUALITY };
      }
    }
    if (!best) throw new Error("Print image is too large for the printer");
    return { bytes: new Uint8Array(await best.blob.arrayBuffer()), quality: best.q, blob: best.blob };
  }

  Booth.layout = { cellRects, centerCrop, composePrint, encodeForPrinter, rotateCW };
})();

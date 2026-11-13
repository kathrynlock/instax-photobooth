// Compose captured frames into a single 600x800 instant-film print.
// A port of photobooth/layout.py, plus an orientation:
//   vertical    print held upright: single, duo (2 stacked), quad (2x2)
//   horizontal  print held sideways, chin on the right: the layout is built on
//               an 800x600 canvas and rotated 90 degrees clockwise onto the print
// The print fills the film's whole picture area: the white frame and chin are
// part of the physical film, not the image.

(function () {
  const cfg = Booth.config;
  const { applyFilmLook, makeCanvas } = Booth.film;

  // canvas size the layout is drawn on, before any rotation
  function viewSize(orientation) {
    return orientation === "horizontal" ? [cfg.CANVAS_H, cfg.CANVAS_W] : [cfg.CANVAS_W, cfg.CANVAS_H];
  }

  // (x, y, w, h) of each photo cell, in fill order, on the unrotated canvas
  function cellRects(layoutName, orientation = "vertical") {
    const [rows, cols, count] = cfg.LAYOUTS[orientation][layoutName];
    const [W, H] = viewSize(orientation);
    const cellW = Math.floor((W - (cols - 1) * cfg.GUTTER) / cols);
    const cellH = Math.floor((H - (rows - 1) * cfg.GUTTER) / rows);
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

  // rotate 90 degrees clockwise (landscape layout -> portrait print)
  function rotateCW(src) {
    const out = makeCanvas(src.height, src.width);
    const ctx = out.getContext("2d");
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, 0, 0);
    return out;
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

  // frames: canvases (unmirrored), at least the layout's photo count.
  // Returns { view, print }: `view` is the layout the way the guest will hold
  // it (800x600 when horizontal), `print` is the 600x800 image sent to the printer.
  function composePrint(frames, layoutName, orientation = "vertical") {
    const spec = cfg.LAYOUTS[orientation] && cfg.LAYOUTS[orientation][layoutName];
    if (!spec) throw new Error(`unknown layout ${orientation}/${layoutName}`);
    if (frames.length < spec[2]) throw new Error(`layout ${layoutName} needs ${spec[2]} frames`);

    const [W, H] = viewSize(orientation);
    const view = makeCanvas(W, H);
    const ctx = view.getContext("2d");
    ctx.fillStyle = `rgb(${cfg.BORDER_COLOR.join(",")})`;
    ctx.fillRect(0, 0, W, H);
    cellRects(layoutName, orientation).forEach(([x, y, w, h], i) => {
      ctx.drawImage(renderCell(frames[i], w, h), x, y);
    });
    return { view, print: orientation === "horizontal" ? rotateCW(view) : view };
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

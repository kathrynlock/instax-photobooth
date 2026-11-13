// The film look: warm, faded, desaturated, with glow, vignette and grain.
// A port of photobooth/film.py. applyFilmLook takes and returns a canvas of any
// size, so it works on a full single photo or on one cell of a 4-up grid.

(function () {
  const cfg = Booth.config;

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  // standard normal samples (Box-Muller), two per call
  function gaussianPair() {
    let u = 0;
    while (u === 0) u = Math.random();
    const v = Math.random();
    const m = Math.sqrt(-2 * Math.log(u));
    return [m * Math.cos(2 * Math.PI * v), m * Math.sin(2 * Math.PI * v)];
  }

  function applyFilmLook(src) {
    const w = src.width, h = src.height;
    const out = makeCanvas(w, h);
    const ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    const image = ctx.getImageData(0, 0, w, h);
    const d = image.data;
    const n = w * h;

    // work in floats, 0-1
    const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
    const clip = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const fade = cfg.FADE, contrast = cfg.CONTRAST, sat = cfg.SATURATION;
    const warmR = 1 + cfg.WARMTH, warmB = 1 - cfg.WARMTH * 0.6;

    for (let i = 0, p = 0; i < n; i++, p += 4) {
      // white balance toward warm: lift red, pull down blue
      let R = clip((d[p] / 255) * warmR);
      let G = d[p + 1] / 255;
      let B = clip((d[p + 2] / 255) * warmB);

      // faded film: lift the blacks, then a gentle contrast curve
      R = clip((fade + (1 - fade) * R - 0.5) * contrast + 0.5);
      G = clip((fade + (1 - fade) * G - 0.5) * contrast + 0.5);
      B = clip((fade + (1 - fade) * B - 0.5) * contrast + 0.5);

      // slight desaturation toward a muted, vintage palette
      const luma = B * 0.114 + G * 0.587 + R * 0.299;
      r[i] = clip(luma + (R - luma) * sat);
      g[i] = clip(luma + (G - luma) * sat);
      b[i] = clip(luma + (B - luma) * sat);
    }

    // soft highlight bloom: screen a blurred copy of the bright areas back in
    if (cfg.GLOW > 0) {
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        d[p] = r[i] * 255; d[p + 1] = g[i] * 255; d[p + 2] = b[i] * 255; d[p + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      const blurC = makeCanvas(w, h);
      const bctx = blurC.getContext("2d", { willReadFrequently: true });
      // pad with the edge so the blur doesn't darken the borders
      bctx.filter = "blur(8px)";
      bctx.drawImage(out, 0, 0);
      bctx.filter = "none";
      const blur = bctx.getImageData(0, 0, w, h).data;
      const glow = cfg.GLOW;
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const br = clip(blur[p] / 255 - 0.5) * glow;
        const bg = clip(blur[p + 1] / 255 - 0.5) * glow;
        const bb = clip(blur[p + 2] / 255 - 0.5) * glow;
        r[i] = clip(1 - (1 - r[i]) * (1 - br));
        g[i] = clip(1 - (1 - g[i]) * (1 - bg));
        b[i] = clip(1 - (1 - b[i]) * (1 - bb));
      }
    }

    // vignette: darken toward the corners
    const hw = w / 2, hh = h / 2;
    const rMax = Math.SQRT2;
    const vig = cfg.VIGNETTE_STRENGTH;
    const grain = cfg.GRAIN_STRENGTH / 255;
    let spare = null;

    for (let y = 0, i = 0; y < h; y++) {
      const dy = (y - hh) / hh;
      for (let x = 0; x < w; x++, i++) {
        const dx = (x - hw) / hw;
        const rr = Math.sqrt(dx * dx + dy * dy) / rMax;
        const mask = clip(1 - vig * Math.pow(rr, 2.2));

        // monochrome film grain
        let noise = 0;
        if (grain > 0) {
          if (spare === null) {
            const pair = gaussianPair();
            noise = pair[0];
            spare = pair[1];
          } else {
            noise = spare;
            spare = null;
          }
          noise *= grain;
        }
        const p = i * 4;
        d[p] = clip(r[i] * mask + noise) * 255;
        d[p + 1] = clip(g[i] * mask + noise) * 255;
        d[p + 2] = clip(b[i] * mask + noise) * 255;
        d[p + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return out;
  }

  Booth.film = { applyFilmLook, makeCanvas };
})();

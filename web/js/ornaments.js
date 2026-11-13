// Decorative clover ovals: soft, grainy pastel ovals (like colored pencil or a
// spray stencil on paper) with a clover cut out of each. A port of
// photobooth/ornaments.py. Each oval is drawn once onto a transparent canvas.

(function () {
  const C = Booth.config.COLORS;
  const PAIRS = [
    [C.charlock, C.sage],
    [C.cornflower, C.glassGreen],
    [C.sage, C.cornflower],
    [C.glassGreen, C.sage],
    [C.countryAir, C.sage],
    [C.sage, C.charlock],
  ];

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  // small seeded RNG so each variant looks the same every time
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.normal = () => {
      const u = next() || 1e-9, v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    next.uniform = (lo, hi) => lo + (hi - lo) * next();
    return next;
  }

  function heartPath(ctx, size) {
    // tip at the origin, lobes pointing up (negative y)
    ctx.beginPath();
    for (let k = 0; k <= 120; k++) {
      const t = (k / 120) * 2 * Math.PI;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      const px = x * (size / 17), py = -(y + 17) * (size / 17);
      k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function maskCanvas(w, h, draw, blurPx) {
    const c = Booth.film.makeCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (blurPx) ctx.filter = `blur(${blurPx}px)`;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    draw(ctx);
    const d = ctx.getImageData(0, 0, w, h).data;
    const m = new Float32Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] / 255;
    return m;
  }

  const cache = new Map();

  function cloverOval(w, h, variant = 0) {
    const key = `${w}x${h}:${variant}`;
    if (cache.has(key)) return cache.get(key);
    const r = rng(1000 + variant);
    const [top, bottom] = PAIRS[variant % PAIRS.length].map(hex);
    const cream = hex(C.cream);

    const oval = maskCanvas(w, h, (ctx) => {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w * 0.46, h * 0.47, 0, 0, 2 * Math.PI);
      ctx.fill();
    }, Math.max(1, w / 60));

    const leaves = r() < 0.7 ? 4 : 3;
    const angle = [0, 45, 15, -10, 30][Math.floor(r() * 5)];
    const hasStem = r() < 0.75;
    const stemLen = h * r.uniform(0.30, 0.38), bend = w * r.uniform(-0.06, 0.06);
    const clover = maskCanvas(w, h, (ctx) => {
      const cx = w / 2, cy = h * 0.44, leaf = w * 0.155;
      for (let k = 0; k < leaves; k++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(((angle + (k * 360) / leaves) * Math.PI) / 180);
        heartPath(ctx, leaf);
        ctx.fill();
        ctx.restore();
      }
      if (hasStem) {
        ctx.lineCap = "round";
        const n = 24;
        for (let i = 0; i < n; i++) {
          const t0 = i / n, t1 = (i + 1) / n;
          ctx.lineWidth = Math.max(1, w * 0.028 * (1 - 0.6 * t1));
          ctx.beginPath();
          ctx.moveTo(cx + bend * t0 * t0, cy + stemLen * t0);
          ctx.lineTo(cx + bend * t1 * t1, cy + stemLen * t1);
          ctx.stroke();
        }
      }
    }, Math.max(0.6, w / 120));

    const out = Booth.film.makeCanvas(w, h);
    const ctx = out.getContext("2d");
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const jitter = r.uniform(-0.1, 0.1);
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        const t = Math.min(1, Math.max(0, (y / h) * 0.8 + (x / w) * 0.2 + jitter));
        const soft = oval[i];
        const edge = 1 - Math.abs(soft * 2 - 1);
        let a = (soft - 0.5) * 2.2 + 0.5 + r.normal() * 0.22 * edge;
        a = Math.min(1, Math.max(0, a)) * (0.82 + 0.18 * soft);
        const cl = clover[i];
        a *= 1 - Math.min(1, cl * 1.15) * 0.94;
        const grain = r.normal() * 9;
        const p = i * 4;
        for (let ch = 0; ch < 3; ch++) {
          const base = top[ch] * (1 - t) + bottom[ch] * t;
          d[p + ch] = base * 0.82 + cream[ch] * 0.18 + grain;
        }
        d[p + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    cache.set(key, out);
    return out;
  }

  // a fresh <canvas> element showing one oval (cached pixels are copied in)
  function ovalElement(w, h, variant, className = "oval") {
    const src = cloverOval(w, h, variant);
    const el = Booth.film.makeCanvas(w, h);
    el.className = className;
    el.getContext("2d").drawImage(src, 0, 0);
    return el;
  }

  Booth.ornaments = { cloverOval, ovalElement };
})();

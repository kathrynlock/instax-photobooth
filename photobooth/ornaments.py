"""Decorative clover ovals: soft, grainy pastel ovals (like colored pencil or
spray stencil on paper) with a cream clover cut out of each. Generated
procedurally once and cached, so they cost nothing per frame.

The booth uses them to fill the cream bands beside the camera view and as
small accents on the other screens."""

from functools import lru_cache

import cv2
import numpy as np

from . import config as cfg

# Gradient color pairs (BGR, top -> bottom), drawn from the booth palette.
OVAL_COLORS = [
    (cfg.CHARLOCK, cfg.SAGE),
    (cfg.CORNFLOWER_BLUE, cfg.GLASS_GREEN),
    (cfg.SAGE, cfg.CORNFLOWER_BLUE),
    (cfg.GLASS_GREEN, cfg.SAGE),
    (cfg.COUNTRY_AIR, cfg.SAGE),
    (cfg.SAGE, cfg.CHARLOCK),
]


def _heart(size):
    """Heart outline (tip at the origin, lobes pointing up), as float points."""
    t = np.linspace(0, 2 * np.pi, 120)
    x = 16 * np.sin(t) ** 3
    y = 13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t)
    # y is up in the formula; the tip sits at y = -17. Flip to image coords
    # with the tip at the origin and the lobes going "up" (negative y).
    pts = np.stack([x, -(y + 17)], axis=1) * (size / 17.0)
    return pts


def _clover_mask(w, h, leaves, angle_deg, rng):
    """Anti-aliased mask of a clover centered a little above the middle."""
    ss = 4                                   # supersample for smooth edges
    mask = np.zeros((h * ss, w * ss), np.uint8)
    cx, cy = w * ss / 2, h * ss * 0.44
    leaf = w * ss * 0.155
    heart = _heart(leaf)
    for k in range(leaves):
        a = np.deg2rad(angle_deg + k * 360 / leaves)
        rot = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
        pts = heart @ rot.T + [cx, cy]
        cv2.fillPoly(mask, [pts.astype(np.int32)], 255, cv2.LINE_AA)
    # a gently curving, tapering stem below the leaves (some clovers have none)
    if rng.random() < 0.75:
        length = h * ss * rng.uniform(0.30, 0.38)
        bend = w * ss * rng.uniform(-0.06, 0.06)
        n = 24
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            p0 = (cx + bend * t0 ** 2, cy + length * t0)
            p1 = (cx + bend * t1 ** 2, cy + length * t1)
            thick = max(2, int(w * ss * 0.028 * (1 - 0.6 * t1)))
            cv2.line(mask, tuple(map(int, p0)), tuple(map(int, p1)), 255, thick, cv2.LINE_AA)
    return cv2.resize(mask, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0


def _grain(shape, rng, sigma):
    return rng.normal(0, 1, shape).astype(np.float32) * sigma


@lru_cache(maxsize=None)
def clover_oval(w, h, variant=0, bg=cfg.UI_BG):
    """A w x h BGR tile: one grainy pastel oval with a clover cut out, on `bg`.
    `variant` picks the colors and clover style deterministically."""
    rng = np.random.default_rng(1000 + variant)
    top, bottom = (np.float32(c) for c in OVAL_COLORS[variant % len(OVAL_COLORS)])

    # color: diagonal gradient plus soft mottling, like uneven pencil pressure
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = np.clip((yy / h) * 0.8 + (xx / w) * 0.2 + rng.uniform(-0.1, 0.1), 0, 1)[..., None]
    color = top * (1 - t) + bottom * t
    blotch = cv2.GaussianBlur(_grain((h, w), rng, 1.0), (0, 0), sigmaX=w / 10)
    blotch /= max(1e-6, np.abs(blotch).max())
    color += blotch[..., None] * 14

    # oval coverage with a soft, speckled edge
    oval = np.zeros((h, w), np.uint8)
    cv2.ellipse(oval, (w // 2, h // 2), (int(w * 0.46), int(h * 0.47)), 0, 0, 360, 255, -1, cv2.LINE_AA)
    soft = cv2.GaussianBlur(oval.astype(np.float32) / 255.0, (0, 0), sigmaX=w / 60)
    speckle = _grain((h, w), rng, 0.22)
    alpha = np.clip((soft - 0.5) * 2.2 + 0.5 + speckle * (1 - np.abs(soft * 2 - 1)), 0, 1)
    # slightly lighter toward the edge, like the pigment thinning out
    alpha *= 0.82 + 0.18 * np.clip(soft, 0, 1)

    # clover cut-out, with a slightly blurry stencil edge and a little grain
    leaves = 4 if rng.random() < 0.7 else 3
    angle = rng.choice([0, 45, 15, -10, 30])
    clover = _clover_mask(w, h, leaves, float(angle), rng)
    clover = cv2.GaussianBlur(clover, (0, 0), sigmaX=max(1.0, w / 120))
    clover = np.clip(clover * 1.15 + _grain((h, w), rng, 0.08) * clover * (1 - clover) * 4, 0, 1)
    alpha *= 1 - clover * 0.94

    # mute toward cream for the dusty, pencil-on-paper look
    color = color * 0.82 + np.float32(cfg.CREAM) * 0.18

    # pencil grain over the pigment
    color += _grain((h, w), rng, 9)[..., None]

    bgf = np.float32(bg)
    out = bgf * (1 - alpha[..., None]) + color * alpha[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


def paste(canvas, tile, x, y):
    """Paste a tile onto canvas at (x, y), clipped to the canvas."""
    h, w = tile.shape[:2]
    H, W = canvas.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if x1 > x0 and y1 > y0:
        canvas[y0:y1, x0:x1] = tile[y0 - y:y1 - y, x0 - x:x1 - x]


def oval_column(canvas, x0, x1, y0, y1, count, variant_start=0):
    """Stack `count` clover ovals evenly in the box [x0, x1) x [y0, y1)."""
    box_w, box_h = x1 - x0, y1 - y0
    slot_h = box_h / count
    h = int(min(slot_h * 0.84, box_w * 0.9 / 0.68))
    w = int(h * 0.68)
    for i in range(count):
        cy = y0 + slot_h * (i + 0.5)
        tile = clover_oval(w, h, variant_start + i)
        paste(canvas, tile, int(x0 + (box_w - w) / 2), int(cy - h / 2))


def oval_row(canvas, cx, cy, count, h, variant_start=0, gap=None):
    """A centered row of small clover ovals (used as an accent)."""
    w = int(h * 0.68)
    gap = int(w * 0.35) if gap is None else gap
    total = count * w + (count - 1) * gap
    x = int(cx - total / 2)
    for i in range(count):
        paste(canvas, clover_oval(w, h, variant_start + i), x + i * (w + gap), int(cy - h / 2))

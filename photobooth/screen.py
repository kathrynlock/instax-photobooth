"""One fixed-size screen for every booth view, so the window never jumps
between the portrait camera view and the wide picker. Each view is drawn at
its natural size, then scaled to fit and centered on a cream canvas, with
clover ovals filling any wide side bands."""

from functools import lru_cache

import cv2
import numpy as np

from . import config as cfg
from .ornaments import oval_column

MIN_BAND_FOR_OVALS = 200   # side bands narrower than this stay plain


@lru_cache(maxsize=8)
def _backdrop(ox, oy):
    """Cream screen background; when the view leaves side bands at least
    MIN_BAND_FOR_OVALS wide, each band gets a column of clover ovals."""
    sw, sh = cfg.SCREEN_SIZE
    canvas = np.full((sh, sw, 3), cfg.UI_BG, np.uint8)
    if ox >= MIN_BAND_FOR_OVALS:
        pad = 24
        oval_column(canvas, 0, ox, pad, sh - pad, 3, variant_start=0)
        oval_column(canvas, sw - ox, sw, pad, sh - pad, 3, variant_start=3)
    canvas.setflags(write=False)
    return canvas


def fit(img):
    """Return (canvas, (scale, ox, oy)): img scaled to fit cfg.SCREEN_SIZE,
    centered on the UI background. A point (x, y) in img lands at
    (ox + x * scale, oy + y * scale) on the canvas."""
    sw, sh = cfg.SCREEN_SIZE
    h, w = img.shape[:2]
    scale = min(sw / w, sh / h)
    nw, nh = round(w * scale), round(h * scale)
    if (nw, nh) != (w, h):
        interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR
        img = cv2.resize(img, (nw, nh), interpolation=interp)
    ox, oy = (sw - nw) // 2, (sh - nh) // 2
    canvas = _backdrop(ox, oy).copy()
    canvas[oy:oy + nh, ox:ox + nw] = img
    return canvas, (scale, ox, oy)


def show(window, img):
    """Display img on the fixed-size screen. Returns the fit transform so
    mouse handlers can map screen points back into img (see to_view)."""
    canvas, transform = fit(img)
    cv2.imshow(window, canvas)
    return transform


def to_view(transform, x, y):
    """Map a screen point back into the coordinates of the shown image."""
    scale, ox, oy = transform
    return (x - ox) / scale, (y - oy) / scale


def open_window(name):
    """Create the booth window at the fixed screen size."""
    cv2.namedWindow(name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(name, *cfg.SCREEN_SIZE)

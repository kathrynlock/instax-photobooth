"""The film look: warm, faded, desaturated, with glow, vignette, and grain.
`apply_film_look` takes and returns a BGR uint8 image of any size, so it works
on a full single photo or on one small cell of a 4-up grid."""

import cv2
import numpy as np

from . import config as cfg


def apply_film_look(photo_bgr):
    """Warm, fade, desaturate, glow, vignette, and grain a BGR image."""
    img = photo_bgr.astype(np.float32) / 255.0

    # white balance toward warm: lift red, pull down blue
    img[..., 2] = np.clip(img[..., 2] * (1.0 + cfg.WARMTH), 0, 1)        # R
    img[..., 0] = np.clip(img[..., 0] * (1.0 - cfg.WARMTH * 0.6), 0, 1)  # B

    # faded film: lift the blacks, then a gentle contrast curve
    img = cfg.FADE + (1.0 - cfg.FADE) * img
    img = np.clip((img - 0.5) * cfg.CONTRAST + 0.5, 0, 1)

    # slight desaturation toward a muted, vintage palette
    luma = (img[..., 0] * 0.114 + img[..., 1] * 0.587 + img[..., 2] * 0.299)[..., None]
    img = np.clip(luma + (img - luma) * cfg.SATURATION, 0, 1)

    # soft highlight bloom (screen a blurred copy of the bright areas back in)
    if cfg.GLOW > 0:
        blur = cv2.GaussianBlur(img, (0, 0), sigmaX=8)
        bright = np.clip(blur - 0.5, 0, 1)
        img = np.clip(1.0 - (1.0 - img) * (1.0 - bright * cfg.GLOW), 0, 1)

    # vignette: darken toward the corners
    h, w = img.shape[:2]
    yy, xx = np.ogrid[:h, :w]
    r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    mask = np.clip(1.0 - cfg.VIGNETTE_STRENGTH * (r / r.max()) ** 2.2, 0, 1)
    img = img * mask[..., None]

    # monochrome film grain
    if cfg.GRAIN_STRENGTH > 0:
        noise = np.random.normal(0, cfg.GRAIN_STRENGTH / 255.0, (h, w, 1)).astype(np.float32)
        img = np.clip(img + noise, 0, 1)

    return (img * 255.0).astype(np.uint8)

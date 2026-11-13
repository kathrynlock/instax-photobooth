"""Webcam capture with an on-screen countdown. In the real booth the Ricoh
replaces this module; for the POC the laptop camera stands in."""

import os
import shutil
import subprocess
import time

import cv2
import numpy as np

from . import config as cfg
from .screen import show
from .text import draw_overlay, draw_text

COUNTDOWN_SECONDS = 3


def open_camera(index=0):
    cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        raise RuntimeError(f"could not open camera index {index}")
    return cap


def crop_to_portrait(frame):
    """Center-crop a landscape frame to cfg.CAPTURE_ASPECT (portrait)."""
    h, w = frame.shape[:2]
    aw, ah = cfg.CAPTURE_ASPECT
    target_w = min(w, round(h * aw / ah))
    x = (w - target_w) // 2
    return frame[:, x:x + target_w].copy()


def read_frame(cap):
    """Read one frame, already cropped to portrait. Returns None on failure."""
    ok, frame = cap.read()
    return crop_to_portrait(frame) if ok else None


def countdown_and_capture(cap, window, label="", taken=0, total=0):
    """Run a live countdown, then return one unmirrored portrait frame to keep."""
    for n in range(COUNTDOWN_SECONDS, 0, -1):
        t_end = time.time() + 1.0
        while time.time() < t_end:
            frame = read_frame(cap)
            if frame is None:
                continue
            preview = cv2.flip(frame, 1)      # mirror for display only
            h, w = preview.shape[:2]
            if label:
                draw_overlay(preview, label, (w // 2, 24), size=max(28, h // 22), anchor="mt")
            if total:
                draw_progress_dots(preview, taken, total)
            draw_overlay(preview, str(n), (w // 2, h // 2), size=h // 3, anchor="mm")
            show(window, preview)
            cv2.waitKey(1)
    return read_frame(cap)


# --- Between-shot feedback ---------------------------------------------------

def _play_shutter():
    """Fire-and-forget shutter sound (macOS afplay); silent if unavailable."""
    path = cfg.SHUTTER_SOUND
    if not path or not os.path.exists(path) or not shutil.which("afplay"):
        return
    try:
        subprocess.Popen(["afplay", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        pass


def _ease_out(t):
    return 1 - (1 - t) ** 3


def draw_progress_dots(img, taken, total):
    """Row of dots along the bottom: filled for shots taken, hollow for the rest."""
    h, w = img.shape[:2]
    r = max(7, h // 70)
    gap = r * 3
    x0 = w // 2 - (total - 1) * gap // 2
    y = h - r * 3
    for i in range(total):
        c = (x0 + i * gap, y)
        cv2.circle(img, c, r + 2, cfg.OVERLAY_OUTLINE, -1, cv2.LINE_AA)
        color = cfg.UI_ACCENT if i < taken else cfg.OVERLAY_TEXT
        cv2.circle(img, c, r, color, -1, cv2.LINE_AA)


CARD_END_SCALE = 0.5


def _card_frame(still, t):
    """The still shrinking (t: 0 -> 1) into a slightly tilted instant-print card."""
    h, w = still.shape[:2]
    e = _ease_out(t)
    # Instax Mini proportions: the photo is the 46 mm wide picture area
    side_mm, top_mm, chin_mm = cfg.FILM_BORDER_MM
    photo_mm = cfg.FILM_CARD_MM[0] - 2 * side_mm
    border, top, chin = (round(w * mm / photo_mm) for mm in (side_mm, top_mm, chin_mm))
    card = cv2.copyMakeBorder(still, top, chin, border, border, cv2.BORDER_CONSTANT,
                              value=cfg.BORDER_COLOR)
    ch, cw = card.shape[:2]
    # t=0: the photo part of the card exactly covers the screen.
    # t=1: the whole card, at CARD_END_SCALE, centered a little above middle.
    scale = 1.0 + (CARD_END_SCALE - 1.0) * e
    angle = -4.0 * e
    # card-space point that sits at screen center: photo center -> card center
    pcx = (border + w / 2) * (1 - e) + (cw / 2) * e
    pcy = (top + h / 2) * (1 - e) + (ch / 2) * e
    canvas = np.full((h, w, 3), cfg.UI_BG, np.uint8)
    # shadow, then card, both placed by the same affine transform
    M = cv2.getRotationMatrix2D((pcx, pcy), angle, scale)
    M[0, 2] += w / 2 - pcx
    M[1, 2] += h / 2 - pcy - h * 0.07 * e
    shadow = np.full_like(card, cfg.UI_UNSELECTED_WASH)
    Ms = M.copy()
    Ms[0, 2] += 10 * e
    Ms[1, 2] += 12 * e
    for img, m in ((shadow, Ms), (card, M)):
        warped = cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_LINEAR,
                                borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        mask = cv2.warpAffine(np.full((ch, cw), 255, np.uint8), m, (w, h),
                              flags=cv2.INTER_LINEAR, borderValue=0)
        a = (mask.astype(np.float32) / 255.0)[..., None]
        canvas = (canvas * (1 - a) + warped * a).astype(np.uint8)
    return canvas


def shot_feedback(window, frame, shot_number, total):
    """Play the between-shot feedback for a just-captured (unmirrored) frame:
    shutter sound, cream flash, then the shot settling into a card."""
    _play_shutter()
    still = cv2.flip(frame, 1)          # show it the way the guest saw themselves
    h, w = still.shape[:2]

    def run(duration_ms, draw):
        t0 = time.time()
        while True:
            t = min((time.time() - t0) * 1000 / duration_ms, 1.0)
            show(window, draw(t))
            cv2.waitKey(1)
            if t >= 1.0:
                return

    flash = np.full_like(still, 255)     # pure white reads as a flash against the cream UI
    run(cfg.FLASH_MS, lambda t: cv2.addWeighted(flash, 1 - _ease_out(t), still, _ease_out(t), 0))

    def card(t, label=False):
        img = _card_frame(still, t)
        if label:
            msg = "Got it!" if shot_number < total else "All done!"
            draw_text(img, msg, (w // 2, h - h // 10), max(32, h // 13), cfg.UI_TEXT, anchor="ms")
        draw_progress_dots(img, shot_number, total)
        return img

    run(cfg.CARD_ANIM_MS, card)
    show(window, card(1.0, label=True))
    cv2.waitKey(cfg.CARD_HOLD_MS)

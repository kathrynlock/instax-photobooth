"""Webcam capture with an on-screen countdown. In the real booth the Ricoh
replaces this module; for the POC the laptop camera stands in."""

import time

import cv2

COUNTDOWN_SECONDS = 3


def open_camera(index=0):
    cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        raise RuntimeError(f"could not open camera index {index}")
    return cap


def _draw_center_text(frame, text, scale, thickness):
    h, w = frame.shape[:2]
    font = cv2.FONT_HERSHEY_DUPLEX
    (tw, th), _ = cv2.getTextSize(text, font, scale, thickness)
    x, y = (w - tw) // 2, (h + th) // 2
    cv2.putText(frame, text, (x, y), font, scale, (0, 0, 0), thickness + 6, cv2.LINE_AA)
    cv2.putText(frame, text, (x, y), font, scale, (255, 255, 255), thickness, cv2.LINE_AA)


def countdown_and_capture(cap, window, label=""):
    """Run a live countdown, then return one unmirrored frame to keep."""
    for n in range(COUNTDOWN_SECONDS, 0, -1):
        t_end = time.time() + 1.0
        while time.time() < t_end:
            ok, frame = cap.read()
            if not ok:
                continue
            preview = cv2.flip(frame, 1)      # mirror for display only
            if label:
                cv2.putText(preview, label, (24, 48), cv2.FONT_HERSHEY_DUPLEX,
                            1.0, (255, 255, 255), 2, cv2.LINE_AA)
            _draw_center_text(preview, str(n), scale=6.0, thickness=8)
            cv2.imshow(window, preview)
            cv2.waitKey(1)
    ok, frame = cap.read()
    return frame if ok else None

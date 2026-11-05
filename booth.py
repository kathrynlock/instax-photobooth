#!/usr/bin/env python3
"""Instax photobooth POC entry point.

Captures from the laptop webcam, grades each shot with a vintage film look,
composes 1, 2, or 4 photos onto a single Instax Mini print, and prints it via
the InstantLink CLI.

CONTROLS (in the preview window)
  1 / 2 / 4   choose the layout (1-up, 2-up, 4-up)
  SPACE       shoot the set: runs a countdown and capture for each photo,
              then composes and prints the print
  Q           quit

Each session writes to captures/:
  raw-<stamp>-N.jpg   each untouched webcam frame
  print-<stamp>.jpg   the composed, graded print that gets sent to the printer

See photobooth/config.py to tune the film look, border, and layouts.
"""

import sys
from datetime import datetime
from pathlib import Path

import cv2

from photobooth import config as cfg
from photobooth import printer
from photobooth.capture import open_camera, countdown_and_capture
from photobooth.layout import compose_print

OUTPUT_DIR = Path("captures")

# number keys -> layout name
KEY_TO_LAYOUT = {ord("1"): "single", ord("2"): "duo", ord("4"): "quad"}


def shoot_set(cap, window, layout):
    """Capture the number of frames the layout needs, with a countdown each."""
    count = cfg.LAYOUTS[layout][2]
    frames = []
    for i in range(count):
        label = f"{layout.upper()}  -  photo {i + 1} of {count}" if count > 1 else ""
        frame = countdown_and_capture(cap, window, label=label)
        if frame is None:
            return None
        frames.append(frame)
        # brief "captured" beat between shots
        flash = cv2.flip(frame, 1).copy()
        cv2.imshow(window, flash)
        cv2.waitKey(400)
    return frames


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    ok, text = printer.status()
    print("Printer reachable:" if ok else "WARN: printer status:")
    print(text or "(no status text)")
    if not ok:
        print("Continuing anyway; the print step will report if it fails.")

    try:
        cap = open_camera(0)
    except RuntimeError as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)

    window = "Instax Booth  -  1/2/4 = layout,  SPACE = shoot,  Q = quit"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL)
    layout = cfg.DEFAULT_LAYOUT
    print(f"Ready. Layout: {layout}. Keys 1/2/4 to change, SPACE to shoot, Q to quit.")

    while True:
        ok, frame = cap.read()
        if not ok:
            print("WARN: dropped a frame.")
            continue

        preview = cv2.flip(frame, 1)
        hint = f"Layout: {layout.upper()}  ({cfg.LAYOUTS[layout][2]} photo(s))"
        cv2.putText(preview, hint, (24, 48), cv2.FONT_HERSHEY_DUPLEX,
                    1.0, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.imshow(window, preview)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        if key in KEY_TO_LAYOUT:
            layout = KEY_TO_LAYOUT[key]
            print(f"Layout set to {layout}.")
            continue
        if key == ord(" "):
            frames = shoot_set(cap, window, layout)
            if frames is None:
                print("WARN: capture failed, try again.")
                continue

            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            for i, fr in enumerate(frames):
                cv2.imwrite(str(OUTPUT_DIR / f"raw-{stamp}-{i + 1}.jpg"), fr)

            caption = datetime.now().strftime("%b %d, %Y").lower()
            print_img = compose_print(frames, layout, caption=caption)
            print_path = OUTPUT_DIR / f"print-{stamp}.jpg"
            cv2.imwrite(str(print_path), print_img)
            print(f"Saved {print_path.name}")

            cv2.imshow(window, cv2.resize(print_img, (cfg.CANVAS_W, cfg.CANVAS_H)))
            cv2.waitKey(900)

            ok, text = printer.print_image(print_path)
            print("Print job sent." if ok else f"ERROR: print failed: {text}")
            print(f"Ready. Layout: {layout}. 1/2/4 to change, SPACE to shoot, Q to quit.")

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()

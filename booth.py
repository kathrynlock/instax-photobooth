#!/usr/bin/env python3
"""Instax photobooth POC entry point.

Captures from the laptop webcam, grades each shot with a vintage film look,
composes 1, 2, or 4 photos onto a single Instax Mini print, and prints it via
the InstantLink CLI.

FLOW
  1. Live preview. Press SPACE to start.
  2. The booth shoots 4 photos, each with its own countdown.
  3. Picker: the 4 shots are shown with a live preview of the print. The
     guest selects photos in the order they should appear; selecting 1, 2
     or 4 picks the single, duo or quad layout. ENTER continues.
  4. Copies: choose how many prints (1 to MAX_COPIES). ENTER prints them,
     ESC goes back to the picker.

CONTROLS
  SPACE          start a session (preview screen)
  1-4 / click    add or remove that photo (picker)
  BACKSPACE      remove the last photo added (picker)
  ENTER          continue to copies (picker) / print (copies)
  - / + / 1-9    number of copies (copies screen)
  R / ESC        discard the shots and return to the preview (picker)
  ESC            back to the picker (copies screen)
  Q              quit (any screen)

Each session writes to captures/:
  raw-<stamp>-N.jpg   each untouched webcam frame
  print-<stamp>.jpg   the composed, graded print that gets sent to the printer

See photobooth/config.py to tune the film look, border, and layouts.
"""

import sys
import threading
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from photobooth import config as cfg
from photobooth import printer
from photobooth.capture import open_camera, countdown_and_capture, read_frame, shot_feedback
from photobooth.layout import compose_print, film_card, film_card_geometry
from photobooth.ornaments import clover_oval, oval_row, paste
from photobooth.screen import open_window, show, to_view
from photobooth.text import draw_overlay, draw_text, fit_size, text_width

OUTPUT_DIR = Path("captures")

# how many photos are selected -> layout name
COUNT_TO_LAYOUT = {spec[2]: name for name, spec in cfg.LAYOUTS.items()}

PICKER_PAD = 40           # gap around and between panels on the picker
PICKER_HEADER = 90        # space above the panels for titles
PICKER_FOOTER = 70        # space below the panels for the instructions
KEY_ENTER = (13, 10)
KEY_BACKSPACE = (8, 127)
KEY_ESC = 27

# the print is shown on screen as a true-proportioned Instax Mini film card
CARD_W, CARD_H, CARD_PHOTO = film_card_geometry(cfg.PREVIEW_CARD_H)


def shoot_session(cap, window):
    """Shoot cfg.SHOTS_PER_SESSION frames with a countdown before each."""
    count = cfg.SHOTS_PER_SESSION
    frames = []
    for i in range(count):
        frame = countdown_and_capture(cap, window, label=f"Photo {i + 1} of {count}",
                                      taken=i, total=count)
        if frame is None:
            return None
        frames.append(frame)
        shot_feedback(window, frame, i + 1, count)
    return frames


class Picker:
    """Guest picks which shots go on the print, in order. Selecting 1, 2 or
    4 shots chooses the single, duo or quad layout. Keys 1-4 or a click on a
    thumbnail toggle a shot; the order of selection is the order on the print."""

    def __init__(self, frames):
        self.frames = frames
        self.order = []          # indices into frames, in print order
        self.print_img = None    # the composed print currently previewed
        self.base = None         # cached board without the print (see render)
        self.transform = (1.0, 0, 0)  # board -> screen mapping from the last draw

        # 2x2 grid of thumbnails, sized so the grid is as tall as the film card
        th = (CARD_H - PICKER_PAD) // 2
        tw = round(th * frames[0].shape[1] / frames[0].shape[0])
        self.thumbs = [cv2.resize(f, (tw, th), interpolation=cv2.INTER_AREA) for f in frames]
        self.rects = [   # (x, y, w, h)
            (PICKER_PAD + c * (tw + PICKER_PAD), PICKER_HEADER + r * (th + PICKER_PAD), tw, th)
            for r in range(2) for c in range(2)
        ][:len(frames)]
        grid_w = 2 * tw + PICKER_PAD
        self.print_x = PICKER_PAD + grid_w + 2 * PICKER_PAD
        self.board_w = self.print_x + CARD_W + PICKER_PAD
        self.board_h = PICKER_HEADER + CARD_H + PICKER_FOOTER

    @property
    def layout(self):
        return COUNT_TO_LAYOUT.get(len(self.order))

    # --- selection ---------------------------------------------------------

    def toggle(self, i):
        if i in self.order:
            self.order.remove(i)
        elif len(self.order) < max(COUNT_TO_LAYOUT):
            self.order.append(i)
        self._recompose()

    def undo(self):
        if self.order:
            self.order.pop()
            self._recompose()

    def _recompose(self):
        self.base = None
        if self.layout:
            shots = [self.frames[i] for i in self.order]
            self.print_img = compose_print(shots, self.layout)
        else:
            self.print_img = None

    def on_mouse(self, event, x, y, _flags, _param):
        if event != cv2.EVENT_LBUTTONDOWN:
            return
        x, y = to_view(self.transform, x, y)   # screen -> board coordinates
        for i, (rx, ry, rw, rh) in enumerate(self.rects):
            if rx <= x < rx + rw and ry <= y < ry + rh:
                self.toggle(i)
                return

    # --- drawing -----------------------------------------------------------

    def _render_base(self):
        """Everything on the board except the print itself. Only changes when
        the selection does, so it's cached between frames."""
        board = np.full((self.board_h, self.board_w, 3), cfg.UI_BG, np.uint8)
        grid_cx = (PICKER_PAD + self.print_x - PICKER_PAD) // 2
        title = "Pick your photos, in order"
        draw_text(board, title, (grid_cx, 58), 38, cfg.UI_TEXT, anchor="ms")
        half = text_width(title, 38) // 2
        oval = clover_oval(42, 62, 1)
        paste(board, oval, grid_cx - half - 70, 12)
        paste(board, clover_oval(42, 62, 4), grid_cx + half + 28, 12)

        for i, (x, y, w, h) in enumerate(self.rects):
            board[y:y + h, x:x + w] = self.thumbs[i]
            draw_overlay(board, str(i + 1), (x + 14, y + h - 12), 40, anchor="ls")
            if i in self.order:
                cv2.rectangle(board, (x - 4, y - 4), (x + w + 3, y + h + 3), cfg.UI_ACCENT, 6)
                # badge with this photo's position on the print
                cx, cy = x + w - 36, y + 36
                cv2.circle(board, (cx, cy), 26, cfg.UI_ACCENT, -1, cv2.LINE_AA)
                draw_text(board, str(self.order.index(i) + 1), (cx, cy + 2), 34,
                          cfg.UI_ACCENT_TEXT, anchor="mm")
            else:
                wash = np.full((h, w, 3), cfg.UI_UNSELECTED_WASH, np.uint8)
                board[y:y + h, x:x + w] = cv2.addWeighted(board[y:y + h, x:x + w], 0.45, wash, 0.55, 0)

        px, py = self.print_x, PICKER_HEADER
        pcx = px + CARD_W // 2
        n = len(self.order)
        if self.layout:
            title = f"Your print ({n} photo{'s' if n > 1 else ''})"
        else:
            _print_card(board, None, px, py)
            cx_, cy_, cw_, ch_ = CARD_PHOTO
            msg = "Select 1, 2 or 4" if n == 0 else f"{n} selected, pick 1, 2 or 4"
            size = fit_size(msg, cw_ - 40, 32)
            draw_text(board, msg, (pcx, py + cy_ + ch_ // 2), size, cfg.UI_TEXT, anchor="mm")
            title = "Your print"
        draw_text(board, title, (pcx, 58), 38, cfg.UI_TEXT, anchor="ms")

        hint = ("1-4 or click: add/remove  ·  enter: next  ·  "
                "backspace: undo  ·  R: retake  ·  Q: quit")
        size = fit_size(hint, self.board_w - 2 * PICKER_PAD, 24)
        draw_text(board, hint, (self.board_w // 2, PICKER_HEADER + CARD_H + 52), size,
                  cfg.UI_TEXT, anchor="ms")
        return board

    def render(self):
        if self.base is None:
            self.base = self._render_base()
        board = self.base.copy()
        if self.print_img is not None:
            _print_card(board, self.print_img, self.print_x, PICKER_HEADER)
        return board

    def run(self, window):
        """Return the composed print to send, None to retake, or "quit"."""
        cv2.setMouseCallback(window, self.on_mouse)
        try:
            while True:
                self.transform = show(window, self.render())
                key = cv2.waitKey(30) & 0xFF
                if ord("1") <= key < ord("1") + len(self.frames):
                    self.toggle(key - ord("1"))
                elif key in KEY_ENTER and self.print_img is not None:
                    return self.print_img
                elif key in KEY_BACKSPACE:
                    self.undo()
                elif key in (ord("r"), KEY_ESC):
                    return None
                elif key == ord("q"):
                    return "quit"
        finally:
            cv2.setMouseCallback(window, lambda *a: None)


def _print_card(board, print_img, x, y):
    """Draw the print on its Instax Mini film card at (x, y), with the offset
    shadow used everywhere. With print_img None, the picture area is empty."""
    cv2.rectangle(board, (x + 12, y + 12), (x + CARD_W + 11, y + CARD_H + 11),
                  cfg.UI_UNSELECTED_WASH, -1)
    board[y:y + CARD_H, x:x + CARD_W] = film_card(print_img, CARD_H, empty_color=cfg.UI_PANEL)


class CopiesScreen:
    """How many copies of the finished print? The print on the left, a big
    count with - / + buttons on the right. -/+ keys or clicks change it,
    1-9 jump to a number, ENTER confirms, ESC goes back to the picker."""

    BTN_R = 54               # radius of the - / + buttons

    def __init__(self, print_img):
        self.print_img = print_img
        self.copies = 1
        self.transform = (1.0, 0, 0)
        sw, sh = cfg.SCREEN_SIZE
        self.size = (sw, sh)
        self.print_xy = (PICKER_PAD * 3, (sh - CARD_H) // 2)
        right_x0 = self.print_xy[0] + CARD_W + PICKER_PAD * 2
        self.cx = (right_x0 + sw - PICKER_PAD) // 2      # center of the right column
        self.cy = sh // 2
        self.minus = (self.cx - 190, self.cy)
        self.plus = (self.cx + 190, self.cy)

    def set(self, n):
        self.copies = min(max(n, 1), cfg.MAX_COPIES)

    def on_mouse(self, event, x, y, _flags, _param):
        if event != cv2.EVENT_LBUTTONDOWN:
            return
        x, y = to_view(self.transform, x, y)
        for (bx, by), step in ((self.minus, -1), (self.plus, 1)):
            if (x - bx) ** 2 + (y - by) ** 2 <= self.BTN_R ** 2:
                self.set(self.copies + step)

    def _button(self, board, center, label, enabled):
        fill = cfg.UI_ACCENT if enabled else cfg.UI_PANEL
        cv2.circle(board, center, self.BTN_R, fill, -1, cv2.LINE_AA)
        # draw the symbol as rounded bars: font glyphs for -/+ sit off-center
        x, y = center
        arm = self.BTN_R // 2
        cv2.line(board, (x - arm, y), (x + arm, y), cfg.UI_ACCENT_TEXT, 10, cv2.LINE_AA)
        if label == "+":
            cv2.line(board, (x, y - arm), (x, y + arm), cfg.UI_ACCENT_TEXT, 10, cv2.LINE_AA)

    def render(self):
        w, h = self.size
        board = np.full((h, w, 3), cfg.UI_BG, np.uint8)
        _print_card(board, self.print_img, *self.print_xy)

        cx, cy = self.cx, self.cy
        oval_row(board, cx, cy - 300, 3, 96, variant_start=0)
        draw_text(board, "How many copies?", (cx, cy - 190), 52, cfg.UI_TEXT, anchor="ms")
        draw_text(board, str(self.copies), (cx, cy), 190, cfg.UI_TEXT, anchor="mm")
        self._button(board, self.minus, "-", self.copies > 1)
        self._button(board, self.plus, "+", self.copies < cfg.MAX_COPIES)
        sub = "print" if self.copies == 1 else "prints"
        draw_text(board, f"{self.copies} {sub}", (cx, cy + 170), 34, cfg.UI_TEXT, anchor="ms")

        hint = f"- / + or 1-{cfg.MAX_COPIES}: change  ·  enter: print  ·  esc: back"
        draw_text(board, hint, (cx, h - 60), 24, cfg.UI_TEXT, anchor="ms")
        return board

    def run(self, window):
        """Return the number of copies, None to go back, or "quit"."""
        cv2.setMouseCallback(window, self.on_mouse)
        try:
            while True:
                self.transform = show(window, self.render())
                key = cv2.waitKey(30) & 0xFF
                if key in (ord("+"), ord("=")):
                    self.set(self.copies + 1)
                elif key in (ord("-"), ord("_")):
                    self.set(self.copies - 1)
                elif ord("1") <= key <= ord("9"):
                    self.set(key - ord("0"))
                elif key in KEY_ENTER:
                    return self.copies
                elif key in (KEY_ESC, KEY_BACKSPACE):
                    return None
                elif key == ord("q"):
                    return "quit"
        finally:
            cv2.setMouseCallback(window, lambda *a: None)


def status_screen(print_img, headline, detail=""):
    """The print with a big status line beside it (printing, done, error)."""
    sw, sh = cfg.SCREEN_SIZE
    board = np.full((sh, sw, 3), cfg.UI_BG, np.uint8)
    px, py = PICKER_PAD * 3, (sh - CARD_H) // 2
    _print_card(board, print_img, px, py)
    right_x0 = px + CARD_W + PICKER_PAD * 2
    cx = (right_x0 + sw - PICKER_PAD) // 2
    oval_row(board, cx, sh // 2 - 130, 3, 96, variant_start=3)
    draw_text(board, headline, (cx, sh // 2), fit_size(headline, sw - right_x0 - PICKER_PAD, 64),
              cfg.UI_TEXT, anchor="mm")
    if detail:
        size = fit_size(detail, sw - right_x0 - PICKER_PAD, 28)
        draw_text(board, detail, (cx, sh // 2 + 80), size, cfg.UI_TEXT, anchor="mm")
    return board


def print_copies(window, print_img, print_path, copies):
    """Send the print `copies` times, showing progress. Stops at the first
    failure. Returns how many printed."""
    for n in range(1, copies + 1):
        label = "Printing..." if copies == 1 else f"Printing {n} of {copies}..."
        show(window, status_screen(print_img, label, "keep the printer nearby"))
        cv2.waitKey(1)                  # let the window paint before blocking
        ok, text = printer.print_image(print_path)
        if not ok:
            print(f"ERROR: print {n} of {copies} failed: {text}")
            show(window, status_screen(print_img, "Couldn't print", text.splitlines()[0] if text else ""))
            cv2.waitKey(3000)
            return n - 1
        print(f"Print {n} of {copies} sent.")
    show(window, status_screen(print_img, "Enjoy!" if copies == 1 else f"All {copies} printed!"))
    cv2.waitKey(1800)
    return copies


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    # The printer check scans Bluetooth and can take up to ~30s when the
    # printer is off, so run it in the background instead of delaying the booth.
    def report_printer():
        ok, text = printer.status()
        print("Printer reachable:" if ok else "WARN: printer status:")
        print(text or "(no status text)")
        if not ok:
            print("Continuing anyway; the print step will report if it fails.")
    threading.Thread(target=report_printer, daemon=True).start()

    try:
        cap = open_camera(0)
    except RuntimeError as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)

    window = "Instax Booth"
    open_window(window)
    ready_msg = f"Ready. SPACE to shoot {cfg.SHOTS_PER_SESSION} photos, Q to quit."
    print(ready_msg)

    while True:
        frame = read_frame(cap)
        if frame is None:
            print("WARN: dropped a frame.")
            continue

        preview = cv2.flip(frame, 1)
        h, w = preview.shape[:2]
        draw_overlay(preview, "Press space to start", (w // 2, h - 32),
                     size=max(28, h // 18), anchor="ms")
        show(window, preview)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        if key != ord(" "):
            continue

        frames = shoot_session(cap, window)
        if frames is None:
            print("WARN: capture failed, try again.")
            continue

        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        for i, fr in enumerate(frames):
            cv2.imwrite(str(OUTPUT_DIR / f"raw-{stamp}-{i + 1}.jpg"), fr)

        picker = Picker(frames)
        # picker -> copies; ESC on the copies screen comes back to the picker
        copies = None
        while True:
            choice = picker.run(window)
            if choice is None or isinstance(choice, str):
                break
            copies = CopiesScreen(choice).run(window)
            if copies is not None:
                break
        if isinstance(choice, str) or isinstance(copies, str):     # "quit"
            break
        if choice is None:
            print("Discarded. " + ready_msg)
            continue

        print_path = OUTPUT_DIR / f"print-{stamp}.jpg"
        cv2.imwrite(str(print_path), choice)
        order = ", ".join(str(i + 1) for i in picker.order)
        print(f"Saved {print_path.name} ({picker.layout}, photos {order}, {copies} cop"
              f"{'y' if copies == 1 else 'ies'})")

        print_copies(window, choice, print_path, copies)
        print(ready_msg)

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()

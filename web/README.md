# Instax Booth (web version)

The whole booth in one browser page: live camera view inside a true-to-size
Instax Mini frame, a countdown and 4 shots, a picker that sets the layout
(1, 2 or 4 photos), the vintage film look, copies, and printing straight to the
Mini Link 3 over Bluetooth. Nothing to install except Chrome.

The Python version in the parent folder still works and is kept as a fallback.

## Run it

1. Turn the Mini Link 3 on (close the Instax app on your phone so it doesn't
   hold the printer).
2. Double-click `start.command`. It serves this folder on
   `http://localhost:8642` and opens it in Chrome. (Safari can't print: it has
   no Web Bluetooth.)
3. Click **Connect printer** (top right) and pick the `INSTAX-...` printer.
   You can also skip this; the booth asks the first time someone presses Print.
4. Press **F** for fullscreen.

If `start.command` won't open, run this in Terminal from this folder instead:

    python3 -m http.server 8642

then open `http://localhost:8642` in Chrome.

**Try it without film:** open `http://localhost:8642/?demo`. The printer is
simulated and each "print" downloads as a JPEG, so you can check the look and
layouts before spending a sheet.

## Using it

| Screen | Tap / click | Keys |
|---|---|---|
| Live view | Start | `space` start, `C` switch camera |
| Pick photos | tap photos in the order you want them | `1`-`4` add/remove, `backspace` undo, `enter` next, `R` retake |
| Copies | `-` / `+`, Print | `-` `+` or `1`-`9`, `enter` print, `esc` back |
| Anywhere | Fullscreen button | `F` fullscreen |

Picking 1, 2 or 4 photos picks the single, duo (sideways) or quad layout.
The pick and copies screens go back to the start after 2 minutes idle.

## Cameras

Any camera the Mac sees works: the built-in camera, a USB webcam, a Sony with
USB Streaming, or a camera through an HDMI capture card. Pick it from the
**Camera** menu (top left); the booth remembers the choice.

## Tuning

Everything that shapes the look lives in `js/config.js`, with the same names as
`photobooth/config.py`: `WARMTH`, `FADE`, `GRAIN_STRENGTH`, `VIGNETTE_STRENGTH`
and friends, plus the countdown, the screen flash (`SCREEN_FLASH`, turn it off
if you use a ring light), copies limit and the printer's 55KB JPEG limit.

## Files

    index.html            the screens
    css/booth.css         styles, palette, the Instax film card
    js/config.js          all tunable constants
    js/film.js            the vintage film look (port of photobooth/film.py)
    js/layout.js          1/2/4 composition + JPEG encoding for the printer
    js/ornaments.js       the clover ovals (port of photobooth/ornaments.py)
    js/instax.js          Mini Link 3 driver over Web Bluetooth (adapted from
                          instax-link-web, MIT; see LICENSE-instax-link-web.txt)
    js/app.js             the booth flow, camera, input
    fonts/                Grandstander (SIL OFL)
    start.command         double-click launcher

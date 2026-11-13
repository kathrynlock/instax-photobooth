# Instax Photobooth

A DIY photobooth that grades photos with a vintage film look and prints them to
a Fujifilm Instax Mini Link 3. This repo is the **proof-of-concept stage**: it
uses the laptop webcam in place of the Ricoh GR IIIx so the print path can be
proven end to end before any camera hardware is wired in.

## Web version (recommended)

`web/` is the whole booth as one browser page: live view inside an Instax
frame, 4 shots, the picker, the film look, copies, and printing to the Mini
Link 3 directly over Web Bluetooth (no InstantLink needed). Double-click
`web/start.command` and use Chrome. See `web/README.md`. The Python booth
below keeps working as a fallback.

## What it does

1. Press SPACE: shoot 4 portrait (3:4) frames from the laptop webcam, each
   with a 3-2-1 countdown. The landscape feed is center-cropped, and the live
   preview shows the same crop.
2. Pick which shots go on the print and in what order. Picking 1, 2, or 4
   shots chooses the 1-up, 2-up, or 4-up layout; a live preview shows the
   final print.
3. Grade each frame: warm white balance, lifted blacks, slight desaturation,
   highlight glow, vignette, and film grain.
4. Compose the frames onto a single 600x800 Instax Mini print in a 1-up, 2-up,
   or 4-up layout that fills the film's picture area (the white frame and
   chin come from the Instax film itself).
5. Print via the InstantLink CLI over Bluetooth.

## Setup

1. Install the InstantLink CLI (the Rust driver that supports the Mini Link 3):

       curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
       git clone https://github.com/wu-hongjun/InstantLink.git
       cd InstantLink
       cargo build --workspace --release
       cargo install --path crates/instantlink-cli
       instantlink --help      # confirm it is on PATH

2. Install the Python dependencies:

       pip install -r requirements.txt

3. Turn the Mini Link 3 on and confirm the Mac sees it:

       instantlink scan
       instantlink status

## Run

    python3 booth.py

Press `SPACE` to shoot 4 photos. On the picker, press `1`-`4` (or click a
photo) to add or remove it; the order you pick is the order on the print.
`ENTER` continues, `BACKSPACE` undoes the last pick, `R` retakes, `Q` quits.
Then choose how many copies (1-5; `-`/`+`, a number key, or click the
buttons) and press `ENTER` to print them, or `ESC` to go back.
Outputs land in `captures/`.

## Tuning the look

Everything that shapes the aesthetic lives in `photobooth/config.py`: the film
grade knobs, the print and film-card geometry, and the layout definitions. Start with
`WARMTH`, `FADE`, `GRAIN_STRENGTH`, and `VIGNETTE_STRENGTH`.

## Layout

    booth.py                 entry point and preview loop
    photobooth/
      config.py              all tunable constants (look, geometry, layouts)
      film.py                the vintage film grade
      layout.py              1/2/4 composition and the on-screen film card
      printer.py             InstantLink CLI wrapper (status, print)
      capture.py             webcam capture, portrait crop, countdown, and
                             the between-shot flash/card animation
      text.py                TrueType text drawing for the booth UI (Pillow)
      screen.py              fixed-size screen every view is drawn onto
    assets/fonts/            Grandstander (SIL OFL), the booth UI font

## Next steps (toward the real booth)

- Swap `capture.py` for the Ricoh GR IIIx over its WiFi HTTP API (shutter
  trigger plus view-size image pull). See `CLAUDE.md` for the full architecture.
- Build the booth UI (home, framing, countdown, review, layout picker).

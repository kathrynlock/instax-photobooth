# Instax Photobooth

A DIY photobooth that grades photos with a vintage film look and prints them to
a Fujifilm Instax Mini Link 3. This repo is the **proof-of-concept stage**: it
uses the laptop webcam in place of the Ricoh GR IIIx so the print path can be
proven end to end before any camera hardware is wired in.

## What it does

1. Capture one or more frames from the laptop webcam, with a 3-2-1 countdown.
2. Grade each frame: warm white balance, lifted blacks, slight desaturation,
   highlight glow, vignette, and film grain.
3. Compose the frames onto a single 600x800 Instax Mini print in a 1-up, 2-up,
   or 4-up layout, inside a cream instant-film border with a date in the chin.
4. Print via the InstantLink CLI over Bluetooth.

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

In the preview window: press `1`, `2`, or `4` to choose the layout, `SPACE` to
shoot the set, `Q` to quit. Outputs land in `captures/`.

## Tuning the look

Everything that shapes the aesthetic lives in `photobooth/config.py`: the film
grade knobs, the border geometry, and the layout definitions. Start with
`WARMTH`, `FADE`, `GRAIN_STRENGTH`, and `VIGNETTE_STRENGTH`.

## Layout

    booth.py                 entry point and preview loop
    photobooth/
      config.py              all tunable constants (look, geometry, layouts)
      film.py                the vintage film grade
      layout.py              1/2/4 composition and the instant-film border
      printer.py             InstantLink CLI wrapper (status, print)
      capture.py             webcam capture and countdown

## Next steps (toward the real booth)

- Swap `capture.py` for the Ricoh GR IIIx over its WiFi HTTP API (shutter
  trigger plus view-size image pull). See `CLAUDE.md` for the full architecture.
- Build the booth UI (home, framing, countdown, review, layout picker, copies).

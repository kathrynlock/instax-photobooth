# CLAUDE.md

Context for Claude Code working in this repo. This is a DIY photobooth project.
Read this before making architectural changes.

## Goal

A photobooth: a Mac Air drives the experience, a camera takes the photos, and a
Fujifilm Instax Mini Link 3 prints them. Guests pick how many photos go on a
print (1, 2, or 4) and how many copies. The final booth runs fullscreen on the
Mac with a vintage, retro-film aesthetic.

## Current stage: proof of concept

This repo currently proves the **print path** only, using the **laptop webcam**
as a stand-in for the real camera. That is deliberate: printing to the Mini
Link 3 was the newest, least-verified link in the chain, so it gets proven
first. The webcam capture in `photobooth/capture.py` is a placeholder for the
Ricoh.

## Hardware (final target)

- Ricoh GR IIIx (camera)
- MacBook Air (booth brain and UI)
- Fujifilm Instax Mini Link 3 (printer, 600x800, ~55KB JPEG, BLE)

## Resolved architecture decisions

**Printing: InstantLink CLI over BLE.**
- Use the `instantlink` CLI from https://github.com/wu-hongjun/InstantLink (a
  Rust driver). It explicitly supports the Mini Link 3 and auto-handles its
  55KB JPEG limit.
- Do NOT use `javl/InstaxBLE`: it is broken on the Mini Link 3 (hardcoded
  service UUID not found on the newer model; see that repo's issue #24).
- We shell out to the CLI (`instantlink print <file>`) rather than binding the
  library. `printer.py` is the only place that talks to it.

**Camera (not yet in this repo): Ricoh GR IIIx over WiFi.**
- The GR IIIx has a single USB-C port, which forced dropping the earlier
  HDMI-live-view + USB-shutter plan (they conflict on one port).
- Plan: app-controlled shutter AND image pull both over the camera's
  reverse-engineered WiFi HTTP API (same API used by GR Remote / GRsync). One
  WiFi session does both. GRsync (metalunk fork) confirms GR IIIx support.
- Pull **view-size** images, not full-res: the HTTP API exposes thumb/view/full,
  and the Instax only needs ~600x800, so view-size avoids the slow full-res
  transfer.
- Interval shooting is NOT used; the app controls shot count and timing.
- Live view is deferred: WiFi live view is bandwidth-heavy and uncertain. The
  POC and first version use countdown-then-fire, no live mirror.

**Image quality note.** Final output is a 600x800 Instax print, so quality
beyond that resolution is not needed for the print itself.

## Code conventions

- All tunable constants (film look, print geometry, layouts) live in
  `photobooth/config.py`. Keep new knobs there, not scattered in modules.
- `film.py` takes/returns BGR uint8 images of any size, so it works on a full
  photo or a single grid cell.
- Layouts are data in `config.LAYOUTS` (name -> rows, cols, count). Adding a
  layout should be a config change plus, if needed, composition logic in
  `layout.py`.
- OpenCV uses BGR channel order. Colors in config are BGR.

## Likely next tasks

1. Add a copies picker (print the same file N times).
2. Add a Ricoh capture backend implementing the WiFi HTTP shutter + view-size
   pull, behind the same interface `capture.py` exposes, selectable by config.
3. Build the fullscreen booth UI (home, framing, countdown, review, layout
   picker, copies, printing, success, error states) per the design brief.
4. Confirm `instantlink print` behavior against the real Mini Link 3 hardware
   (first physical test print).

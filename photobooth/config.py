"""Central configuration for the photobooth: canvas geometry, the film look,
and the available print layouts. Tune the aesthetic here in one place."""

# --- Print geometry (Instax Mini film is 600x800 portrait) ------------------
CANVAS_W = 600
CANVAS_H = 800
SIDE_MARGIN = 36        # cream border, left and right
TOP_MARGIN = 36         # cream border, top
BOTTOM_MARGIN = 150     # the thick instant-film "chin"
GUTTER = 16             # cream gap between photos in multi-photo layouts
BORDER_COLOR = (238, 243, 247)  # BGR, warm cream (not pure white)

# --- Layouts: name -> (rows, cols, photo_count) -----------------------------
# "single" = one photo, "duo" = two stacked, "quad" = a 2x2 grid.
LAYOUTS = {
    "single": (1, 1, 1),
    "duo": (2, 1, 2),
    "quad": (2, 2, 4),
}
DEFAULT_LAYOUT = "single"

# --- Film look (every knob that shapes the vintage aesthetic) ---------------
WARMTH = 0.12            # 0-0.3  push toward warm (more red, less blue)
FADE = 0.07             # 0-0.2  lift the blacks for a faded-film look
CONTRAST = 1.06         # gentle S-contrast after the fade
SATURATION = 0.90       # <1 desaturates slightly for a muted palette
GLOW = 0.25             # 0-0.5  soft bloom on the highlights
VIGNETTE_STRENGTH = 0.38  # 0-1   corner darkening
GRAIN_STRENGTH = 11      # 0-30  stddev of film grain noise

# --- Chin caption -----------------------------------------------------------
DATE_STAMP = True        # small date centered in the bottom chin
CHIN_TEXT_COLOR = (70, 85, 110)   # BGR, muted sepia-brown

# --- Printer ----------------------------------------------------------------
INSTANTLINK = "instantlink"   # CLI binary; assumes it is on PATH
FIT_MODE = "contain"          # image is already 600x800, so this is a no-op safety net

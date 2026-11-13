"""Central configuration for the photobooth: canvas geometry, the film look,
and the available print layouts. Tune the aesthetic here in one place."""

from pathlib import Path

# --- Print geometry ---------------------------------------------------------
# The Mini Link 3 prints a 600x800 image into the picture area of the film.
# The white frame and thick bottom chin are part of the film itself, so the
# print fills the whole canvas; only multi-photo layouts get gaps.
CANVAS_W = 600
CANVAS_H = 800
GUTTER = 12             # white gap between photos in multi-photo layouts
BORDER_COLOR = (244, 247, 249)  # BGR, the film's warm white (gaps, previews)

# Physical Instax Mini film, in mm, used to draw the print true to size on
# screen: a 54x86 card with a 46x62 picture area.
FILM_CARD_MM = (54, 86)          # width, height
FILM_BORDER_MM = (4, 6, 18)      # side, top, bottom (the chin)
PREVIEW_CARD_H = 800             # height of the on-screen film card, px

# --- Capture ---------------------------------------------------------------
# Shots are center-cropped from the landscape webcam feed to this portrait
# aspect (width, height). The live preview shows the same crop.
CAPTURE_ASPECT = (3, 4)

# --- Layouts: name -> (rows, cols, photo_count) -----------------------------
# "single" = one photo, "duo" = two stacked, "quad" = a 2x2 grid.
LAYOUTS = {
    "single": (1, 1, 1),
    "duo": (2, 1, 2),
    "quad": (2, 2, 4),
}
DEFAULT_LAYOUT = "single"

# Layouts meant to be viewed with the print turned sideways. Each photo is
# rotated 90 degrees clockwise, so holding the print with the chin on the
# right shows the photos upright, side by side, first photo on the left.
SIDEWAYS_LAYOUTS = {"duo"}

# Every session shoots this many photos; the guest then picks a layout, and
# layouts with fewer slots use the first N shots.
SHOTS_PER_SESSION = 4

# Copies of the finished print a guest can order in one go. A Mini film pack
# holds 10 sheets.
MAX_COPIES = 5

# --- Screen ----------------------------------------------------------------
# Every booth view (camera, countdown, picker) is drawn on one canvas of this
# size (width, height) so the window stays put. 3:2, close to a MacBook Air.
SCREEN_SIZE = (1440, 960)

# --- Booth UI palette (BGR) -------------------------------------------------
# Cornflower / country air / glass green / charlock / iguana, on a warm cream.
CORNFLOWER_BLUE = (234, 169, 143)   # #8FA9EA
COUNTRY_AIR = (242, 219, 215)       # #D7DBF2
GLASS_GREEN = (213, 233, 233)       # #E9E9D5
CHARLOCK = (147, 229, 229)          # #E5E593
IGUANA = (81, 130, 129)             # #818251
CREAM = (239, 244, 253)             # #FDF4EF, the palette's page background
SAGE = (150, 196, 168)              # #A8C496, soft green for the clover ovals

UI_BG = CREAM               # picker background
UI_TEXT = IGUANA            # titles and instructions
UI_ACCENT = CORNFLOWER_BLUE  # selection outline and order badges
UI_ACCENT_TEXT = CREAM      # numbers on the badges
UI_UNSELECTED_WASH = GLASS_GREEN  # tint over unpicked photos
UI_PANEL = COUNTRY_AIR      # empty print slot
OVERLAY_TEXT = CREAM        # text drawn over the live camera feed
OVERLAY_OUTLINE = IGUANA    # outline behind overlay text for legibility

# Between-shot feedback: a cream camera flash, then the shot shrinks into a
# little instant-print card with a "Got it!" and progress dots.
FLASH_MS = 220            # flash fade-out
CARD_ANIM_MS = 320        # shot shrinking into the card
CARD_HOLD_MS = 650        # card stays up before the next countdown
SHUTTER_SOUND = "/System/Library/Sounds/Pop.aiff"   # macOS; None or missing = silent

# Booth UI typeface (SIL OFL, see assets/fonts/OFL.txt)
UI_FONT = Path(__file__).resolve().parent.parent / "assets" / "fonts" / "Grandstander.ttf"
UI_FONT_WEIGHT = 700       # Grandstander is variable: 100 (thin) to 900 (black)

# --- Film look (every knob that shapes the vintage aesthetic) ---------------
WARMTH = 0.12            # 0-0.3  push toward warm (more red, less blue)
FADE = 0.07             # 0-0.2  lift the blacks for a faded-film look
CONTRAST = 1.06         # gentle S-contrast after the fade
SATURATION = 0.90       # <1 desaturates slightly for a muted palette
GLOW = 0.25             # 0-0.5  soft bloom on the highlights
VIGNETTE_STRENGTH = 0.38  # 0-1   corner darkening
GRAIN_STRENGTH = 7       # 0-30  stddev of film grain noise

# --- Printer ----------------------------------------------------------------
INSTANTLINK = "instantlink"   # CLI binary; assumes it is on PATH
FIT_MODE = "contain"          # image is already 600x800, so this is a no-op safety net

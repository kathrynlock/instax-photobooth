// Central configuration for the web booth: print geometry, the film look,
// layouts, timings and the UI palette. This mirrors photobooth/config.py so the
// Python and web versions look the same; tune the aesthetic here in one place.
// Colors are RGB here (the Python config uses OpenCV's BGR order).

window.Booth = window.Booth || {};

Booth.config = {
  // --- Print geometry -------------------------------------------------------
  // The Mini Link 3 prints a 600x800 image into the picture area of the film.
  // The white frame and thick chin are part of the film itself, so the print
  // fills the whole canvas; only multi-photo layouts get gaps.
  CANVAS_W: 600,
  CANVAS_H: 800,
  GUTTER: 12,                       // white gap between photos in multi-photo layouts
  BORDER_COLOR: [249, 247, 244],    // the film's warm white (gaps, previews)

  // Physical Instax Mini film, in mm, used to draw the print true to size on
  // screen: a 54x86 card with a 46x62 picture area.
  FILM_CARD_MM: [54, 86],           // width, height
  FILM_BORDER_MM: [4, 6, 18],       // side, top, bottom (the chin)

  // --- Capture ----------------------------------------------------------------
  // Each shot keeps the camera's full frame; the live view shows this crop of it
  // (width, height) so guests frame themselves for the print they'll get.
  // Each photo cell on the print is then center-cropped from the full frame.
  CAPTURE_ASPECT: { vertical: [3, 4], horizontal: [4, 3] },
  COUNTDOWN_SECONDS: 3,
  SHOTS_PER_SESSION: 4,

  // --- Orientation ---------------------------------------------------------------
  // vertical:   the print is held upright, chin at the bottom.
  // horizontal: the print is held sideways, chin on the right. The photos are
  //             laid out on an 800x600 landscape canvas, then the whole thing is
  //             rotated 90 degrees clockwise onto the 600x800 print.
  DEFAULT_ORIENTATION: "vertical",

  // --- Layouts: name -> [rows, cols, photoCount], per orientation --------------
  LAYOUTS: {
    vertical: {
      single: [1, 1, 1],
      duo: [2, 1, 2],     // two landscape photos stacked
      quad: [2, 2, 4],
    },
    horizontal: {
      single: [1, 1, 1],
      duo: [1, 2, 2],     // two portrait photos side by side
      quad: [2, 2, 4],
    },
  },

  // Copies of the finished print a guest can order in one go. A Mini pack holds 10.
  MAX_COPIES: 5,

  // --- Booth UI palette --------------------------------------------------------
  COLORS: {
    cornflower: "#8FA9EA",
    countryAir: "#D7DBF2",
    glassGreen: "#E9E9D5",
    charlock: "#E5E593",
    iguana: "#818251",
    cream: "#FDF4EF",
    sage: "#A8C496",
  },

  // Screen flash: the screen turns bright white just before each photo is taken
  // so it lights up faces (like a phone's selfie flash). The camera needs a
  // moment to see the light, so the shot is taken SCREEN_FLASH_LEAD_MS after the
  // screen goes white. Set SCREEN_FLASH to false with a ring light.
  SCREEN_FLASH: true,
  SCREEN_FLASH_LEAD_MS: 260,

  // Between-shot feedback: the flash fades, then the shot shrinks into a card.
  FLASH_MS: 220,
  CARD_ANIM_MS: 320,
  CARD_HOLD_MS: 650,

  // How long the "Enjoy!" screen stays before the booth resets.
  DONE_HOLD_MS: 4000,
  // With no input for this long on the picker or copies screen, go home.
  IDLE_RESET_MS: 120000,

  // --- Film look (every knob that shapes the vintage aesthetic) ---------------
  WARMTH: 0.12,            // 0-0.3  push toward warm (more red, less blue)
  FADE: 0.07,              // 0-0.2  lift the blacks for a faded-film look
  CONTRAST: 1.06,          // gentle contrast after the fade
  SATURATION: 0.90,        // <1 desaturates slightly for a muted palette
  GLOW: 0.25,              // 0-0.5  soft bloom on the highlights
  VIGNETTE_STRENGTH: 0.38, // 0-1   corner darkening
  GRAIN_STRENGTH: 7,       // 0-30  stddev of film grain noise

  // --- Printer -----------------------------------------------------------------
  // The Mini Link 3 rejects JPEGs over about 55KB (InstantLink documents this),
  // so prints are encoded at the best quality that fits under this.
  MAX_PRINT_BYTES: 55000,
  JPEG_QUALITY: 0.88,      // first quality tried; lowered only if over the limit
  MIN_JPEG_QUALITY: 0.3,
};

Booth.config.COUNT_TO_LAYOUT = Object.fromEntries(
  Object.entries(Booth.config.LAYOUTS.vertical).map(([name, spec]) => [spec[2], name])
);

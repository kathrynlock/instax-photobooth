// The booth: live view -> 4 shots -> pick photos (sets the layout) -> copies -> print.
// Everything runs in the browser. Printing goes over Web Bluetooth, so open
// this in Chrome (or Edge) on the Mac. Add ?demo to the URL to try the whole
// flow without a printer (each "print" downloads as a JPEG instead).

(function () {
  const cfg = Booth.config;
  const { makeCanvas } = Booth.film;
  const { composePrint, encodeForPrinter, centerCrop } = Booth.layout;
  const { InstaxPrinter, DemoPrinter, PrintError } = Booth.instax;

  const params = new URLSearchParams(location.search);
  const DEMO = params.has("demo");
  Booth.TEST_MODE = params.has("test");

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  const state = {
    screen: "live",
    busy: false,          // shooting or printing: ignore most input
    frames: [],           // captured canvases, unmirrored
    order: [],            // indices into frames, in print order
    printCanvas: null,
    printUrl: null,
    copies: 1,
    printedCopies: 0,
    printer: DEMO ? new DemoPrinter() : new InstaxPrinter(),
    printerInfo: null,
    stream: null,
    cameras: [],
    idleTimer: null,
  };
  Booth.state = state;   // handy from the console

  // ------------------------------------------------------------------ screens
  function show(name) {
    state.screen = name;
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${name}`));
    armIdleReset();
  }

  function armIdleReset() {
    clearTimeout(state.idleTimer);
    if (state.screen === "pick" || state.screen === "copies") {
      state.idleTimer = setTimeout(goHome, cfg.IDLE_RESET_MS);
    }
  }

  function goHome() {
    state.frames = [];
    state.order = [];
    state.printCanvas = null;
    state.busy = false;
    document.body.classList.remove("shooting");
    $("shoot-label").innerHTML = "&nbsp;";
    renderDots(0, 0);
    show("live");
  }

  // ------------------------------------------------------------ decoration
  function filmTexture() {
    // fine paper grain with tiny embossed specks, tiled behind every film card
    const s = 160, c = makeCanvas(s, s), ctx = c.getContext("2d");
    const img = ctx.createImageData(s, s);
    for (let i = 0; i < s * s; i++) {
      const v = Math.random();
      const p = i * 4;
      const dark = v < 0.5;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = dark ? 120 : 255;
      img.data[p + 3] = Math.random() < 0.35 ? (dark ? 9 : 20) : 0;
    }
    ctx.putImageData(img, 0, 0);
    document.documentElement.style.setProperty("--film-texture", `url(${c.toDataURL()})`);
  }

  function drawOrnaments() {
    document.querySelectorAll(".ovals").forEach((col) => {
      const start = Number(col.dataset.start);
      for (let i = 0; i < 3; i++) col.appendChild(Booth.ornaments.ovalElement(136, 200, start + i));
    });
    document.querySelectorAll(".oval-row").forEach((row) => {
      const start = Number(row.dataset.start);
      for (let i = 0; i < 3; i++) row.appendChild(Booth.ornaments.ovalElement(68, 100, start + i));
    });
  }

  function renderDots(taken, total) {
    $("progress-dots").innerHTML = Array.from({ length: total },
      (_, i) => `<span class="${i < taken ? "on" : ""}"></span>`).join("");
  }

  // ---------------------------------------------------------------- camera
  async function listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.cameras = devices.filter((d) => d.kind === "videoinput");
    const sel = $("camera-select");
    const current = state.stream && state.stream.getVideoTracks()[0]
      ? state.stream.getVideoTracks()[0].getSettings().deviceId : null;
    sel.innerHTML = state.cameras.map((c, i) =>
      `<option value="${c.deviceId}">${c.label || `Camera ${i + 1}`}</option>`).join("");
    if (current) sel.value = current;
  }

  async function startCamera(deviceId) {
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    const msg = $("camera-message");
    const video = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    if (deviceId) video.deviceId = { exact: deviceId };
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      if (deviceId) return startCamera(null);   // saved camera unplugged: use the default
      msg.textContent = err.name === "NotAllowedError"
        ? "Camera access is blocked. Allow the camera for this page in Chrome, then reload."
        : "No camera found. Plug one in, or pick one from the Camera menu.";
      msg.classList.remove("hidden");
      return;
    }
    msg.classList.add("hidden");
    const v = $("video");
    v.srcObject = state.stream;
    await v.play().catch(() => {});
    const id = state.stream.getVideoTracks()[0].getSettings().deviceId;
    if (id) storage.set("booth.camera", id);
    await listCameras();
  }

  function cycleCamera() {
    if (state.cameras.length < 2) return;
    const sel = $("camera-select");
    const i = state.cameras.findIndex((c) => c.deviceId === sel.value);
    startCamera(state.cameras[(i + 1) % state.cameras.length].deviceId);
  }

  // one frame from the camera, center-cropped to portrait, unmirrored
  function grabFrame() {
    const v = $("video");
    if (!v.videoWidth) return null;
    const [aw, ah] = cfg.CAPTURE_ASPECT;
    const [sx, sy, sw, sh] = centerCrop(v.videoWidth, v.videoHeight, aw, ah);
    const c = makeCanvas(sw, sh);
    c.getContext("2d").drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
    return c;
  }

  function mirrored(src) {
    const c = makeCanvas(src.width, src.height), ctx = c.getContext("2d");
    ctx.translate(src.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0);
    return c;
  }

  // --------------------------------------------------------------- shooting
  let audio = null;
  function shutterSound() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const len = Math.floor(audio.sampleRate * 0.09);
      const buf = audio.createBuffer(1, len, audio.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const env = i < len * 0.08 ? 1 : Math.exp(-(i - len * 0.08) / (len * 0.12));
        d[i] = (Math.random() * 2 - 1) * env * 0.5;
      }
      const src = audio.createBufferSource();
      src.buffer = buf;
      src.connect(audio.destination);
      src.start();
    } catch (e) { /* no sound is fine */ }
  }

  async function countdown() {
    const el = $("countdown");
    for (let n = cfg.COUNTDOWN_SECONDS; n > 0; n--) {
      el.textContent = n;
      el.classList.remove("pop");
      void el.offsetWidth;   // restart the animation
      el.classList.add("pop");
      await sleep(1000);
    }
    el.textContent = "";
    el.classList.remove("pop");
  }

  async function takeShot() {
    const flash = $("flash");
    flash.style.transition = "none";
    if (cfg.SCREEN_FLASH) {
      flash.style.opacity = "1";            // light up faces first...
      await sleep(cfg.SCREEN_FLASH_LEAD_MS);
    }
    const frame = grabFrame();              // ...then take the picture
    shutterSound();
    flash.style.opacity = "1";
    return frame;
  }

  async function shotFeedback(frame, shotNumber, total) {
    const fb = $("shot-feedback");
    const pic = fb.querySelector(".picture");
    pic.innerHTML = "";
    pic.appendChild(mirrored(frame));       // show it the way the guest saw themselves
    $("feedback-label").textContent = shotNumber < total ? "Got it!" : "All done!";
    fb.classList.remove("settle", "hidden");

    const flash = $("flash");
    void flash.offsetWidth;
    flash.style.transition = `opacity ${cfg.FLASH_MS}ms ease-out`;
    flash.style.opacity = "0";
    await sleep(cfg.FLASH_MS);

    fb.classList.add("settle");
    await sleep(cfg.CARD_ANIM_MS + cfg.CARD_HOLD_MS);
    fb.classList.add("hidden");
    fb.classList.remove("settle");
  }

  async function shootSession() {
    if (state.busy || state.screen !== "live") return;
    if (!$("video").videoWidth) return;
    state.busy = true;
    document.body.classList.add("shooting");
    const total = cfg.SHOTS_PER_SESSION;
    const frames = [];
    try {
      for (let i = 0; i < total; i++) {
        $("shoot-label").textContent = `Photo ${i + 1} of ${total}`;
        renderDots(i, total);
        await countdown();
        const frame = await takeShot();
        if (!frame) throw new Error("camera stopped");
        frames.push(frame);
        renderDots(i + 1, total);
        await shotFeedback(frame, i + 1, total);
      }
    } catch (e) {
      console.error(e);
      $("flash").style.opacity = "0";
      goHome();
      return;
    }
    document.body.classList.remove("shooting");
    $("shoot-label").innerHTML = "&nbsp;";
    renderDots(0, 0);
    state.busy = false;
    openPicker(frames);
  }

  // ----------------------------------------------------------------- picker
  function openPicker(frames) {
    state.frames = frames;
    state.order = [];
    state.printCanvas = null;
    const thumbs = $("thumbs");
    thumbs.innerHTML = "";
    frames.forEach((f, i) => {
      const b = document.createElement("button");
      b.className = "thumb";
      b.type = "button";
      b.innerHTML = `<img alt="Photo ${i + 1}" src="${f.toDataURL("image/jpeg", 0.85)}">` +
        `<span class="num">${i + 1}</span><span class="badge"></span>`;
      b.addEventListener("click", () => toggle(i));
      thumbs.appendChild(b);
    });
    renderPicker();
    show("pick");
  }

  function currentLayout() {
    return cfg.COUNT_TO_LAYOUT[state.order.length] || null;
  }

  function toggle(i) {
    const at = state.order.indexOf(i);
    if (at >= 0) state.order.splice(at, 1);
    else if (state.order.length < Math.max(...Object.keys(cfg.COUNT_TO_LAYOUT).map(Number))) state.order.push(i);
    renderPicker();
  }

  let composeToken = 0;
  function renderPicker() {
    armIdleReset();
    document.querySelectorAll(".thumb").forEach((t, i) => {
      const pos = state.order.indexOf(i);
      t.classList.toggle("selected", pos >= 0);
      t.querySelector(".badge").textContent = pos >= 0 ? pos + 1 : "";
    });
    const layout = currentLayout();
    const n = state.order.length;
    const pic = $("pick-card").querySelector(".picture");
    $("next-btn").disabled = !layout;
    $("sideways-note").classList.toggle("hidden", !(layout && cfg.SIDEWAYS_LAYOUTS.includes(layout)));
    $("print-title").textContent = layout ? `Your print (${n} photo${n > 1 ? "s" : ""})` : "Your print";

    pic.querySelectorAll("img").forEach((x) => x.remove());
    const empty = $("pick-empty");
    if (!layout) {
      state.printCanvas = null;
      empty.textContent = n === 0 ? "Select 1, 2 or 4" : `${n} selected, pick 1, 2 or 4`;
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    // compose on the next frame so the tap feels instant
    const token = ++composeToken;
    requestAnimationFrame(() => setTimeout(() => {
      if (token !== composeToken) return;
      state.printCanvas = composePrint(state.order.map((i) => state.frames[i]), layout);
      state.printUrl = state.printCanvas.toDataURL("image/jpeg", 0.92);
      setPrintImage(pic, state.printUrl);
    }, 0));
  }

  function setPrintImage(picture, url) {
    picture.querySelectorAll("img").forEach((x) => x.remove());
    const img = new Image();
    img.alt = "Your print";
    img.src = url;
    picture.appendChild(img);
  }

  function undo() {
    if (state.order.length) { state.order.pop(); renderPicker(); }
  }

  async function toCopies() {
    if (!currentLayout()) return;
    // wait for a compose still in flight
    for (let i = 0; i < 50 && !state.printCanvas; i++) await sleep(20);
    if (!state.printCanvas) return;
    setPrintImage($("copies-card").querySelector(".picture"), state.printUrl);
    setCopies(state.copies || 1);
    show("copies");
  }

  // ----------------------------------------------------------------- copies
  function maxCopies() {
    const left = state.printerInfo && state.printerInfo.photosLeft;
    return left ? Math.min(cfg.MAX_COPIES, left) : cfg.MAX_COPIES;
  }

  function setCopies(n) {
    state.copies = Math.min(Math.max(n, 1), maxCopies());
    $("copies-count").textContent = state.copies;
    $("copies-sub").textContent = `${state.copies} ${state.copies === 1 ? "print" : "prints"}`;
    $("minus-btn").disabled = state.copies <= 1;
    $("plus-btn").disabled = state.copies >= maxCopies();
    const info = state.printerInfo;
    let note = "";
    if (!state.printer.connected) note = InstaxPrinter.isSupported() || DEMO
      ? "the printer connects when you press print" : "printing needs Chrome or Edge";
    else if (info && info.photosLeft != null) note = `${info.photosLeft} shot${info.photosLeft === 1 ? "" : "s"} left in the pack`;
    $("film-note").textContent = note;
    armIdleReset();
  }

  // --------------------------------------------------------------- printer
  function renderPrinterPill() {
    const pill = $("printer-pill");
    pill.classList.remove("connected", "warn");
    if (!DEMO && !InstaxPrinter.isSupported()) {
      pill.textContent = "Printing needs Chrome";
      pill.classList.add("warn");
      return;
    }
    if (!state.printer.connected) { pill.textContent = "Connect printer"; return; }
    const info = state.printerInfo;
    const parts = [DEMO ? "Demo printer" : "Printer connected"];
    if (info) {
      if (info.battery != null) parts.push(`battery ${info.battery}%${info.charging ? " (charging)" : ""}`);
      if (info.photosLeft != null) parts.push(`${info.photosLeft} left`);
    }
    pill.textContent = parts.join(" · ");
    pill.classList.add(info && info.photosLeft === 0 ? "warn" : "connected");
  }

  async function refreshPrinterStatus() {
    if (!state.printer.connected || state.screen === "status") return;
    try {
      state.printerInfo = await state.printer.getStatus();
    } catch (e) { console.warn("status read failed", e); }
    renderPrinterPill();
    if (state.screen === "copies") setCopies(state.copies);
  }

  // must run from a click/keypress: Chrome shows its Bluetooth picker
  async function connectPrinter() {
    if (!DEMO && !InstaxPrinter.isSupported()) throw new PrintError("refused", "Printing needs Chrome or Edge (Safari has no Web Bluetooth)");
    await state.printer.connect();
    state.printer.onDisconnect = () => { state.printerInfo = null; renderPrinterPill(); };
    renderPrinterPill();
    await refreshPrinterStatus();
  }

  async function onPrinterPill() {
    if (state.busy) return;
    if (state.printer.connected) return refreshPrinterStatus();
    try { await connectPrinter(); } catch (e) { console.warn("printer not connected", e); renderPrinterPill(); }
  }

  // ------------------------------------------------------------------ print
  function setStatus(headline, detail = "", progress = null, transitionMs = 250) {
    $("status-headline").textContent = headline;
    $("status-detail").textContent = detail;
    const bar = $("status-bar");
    bar.classList.toggle("hidden", progress === null);
    if (progress !== null) {
      const fill = bar.firstElementChild;
      fill.style.transition = `width ${transitionMs}ms linear`;
      fill.style.width = `${Math.round(progress * 100)}%`;
    }
  }

  async function startPrint() {
    if (state.busy || !state.printCanvas) return;
    // connect first, while the click still counts as a user gesture
    if (!state.printer.connected) {
      try {
        await connectPrinter();
      } catch (e) {
        $("film-note").textContent = e instanceof PrintError ? e.message
          : "No printer picked. Turn the printer on and press print again.";
        return;
      }
    }
    state.printedCopies = 0;
    await runPrint(state.copies);
  }

  async function runPrint(copies) {
    state.busy = true;
    clearTimeout(state.idleTimer);
    setPrintImage($("status-card").querySelector(".picture"), state.printUrl);
    $("status-actions").classList.add("hidden");
    show("status");
    setStatus("Getting it ready...", "", 0);

    try {
      const { bytes } = await encodeForPrinter(state.printCanvas);

      // a fresh film pack takes a moment to set up; wait it out quietly
      for (let attempt = 0; ; attempt++) {
        try {
          setStatus("Sending to the printer...", "keep the printer nearby", 0);
          await state.printer.sendImage(bytes, (p) => setStatus("Sending to the printer...", "keep the printer nearby", p));
          break;
        } catch (e) {
          if (e instanceof PrintError && e.reason === "busy" && attempt < 10) {
            setStatus("Getting the film ready...", "one moment", null);
            await sleep(3000);
            continue;
          }
          throw e;
        }
      }

      const label = (n) => (copies === 1 ? "Printing..." : `Printing ${n} of ${copies}...`);
      setStatus(label(1), "your photo is coming out", 0, 0);
      requestAnimationFrame(() => setStatus(label(1), "your photo is coming out", 1 / copies, 15000));
      await state.printer.printCopies(copies, (n) => {
        state.printedCopies += 1;
        if (n < copies) {
          setStatus(label(n + 1), "your photo is coming out", n / copies, 0);
          requestAnimationFrame(() => setStatus(label(n + 1), "your photo is coming out", (n + 1) / copies, 15000));
        }
      });

      const total = state.printedCopies;
      setStatus(total === 1 ? "Enjoy!" : `All ${total} printed!`, "it develops in about 90 seconds", null);
      state.busy = false;
      refreshPrinterStatus();
      await sleep(cfg.DONE_HOLD_MS);
      if (state.screen === "status") goHome();
    } catch (e) {
      console.error("print failed", e);
      state.busy = false;
      setStatus("Couldn't print", friendlyError(e), null);
      $("status-actions").classList.remove("hidden");
      // only the copies that didn't come out are retried
      $("retry-btn").dataset.copies = String(Math.max(1, state.copies - state.printedCopies));
      renderPrinterPill();
    }
  }

  function friendlyError(e) {
    if (!state.printer.connected) return "The printer disconnected. Turn it on, keep it close, and try again.";
    if (e instanceof PrintError) {
      if (e.reason === "not-printed") return `${e.message}.`;
      if (e.reason === "busy") return "The printer is still getting the film ready. Try again in a moment.";
      return `${e.message}.`;
    }
    return e && e.message ? e.message : "Something went wrong.";
  }

  async function retryPrint() {
    if (state.busy) return;
    const remaining = Number($("retry-btn").dataset.copies) || 1;
    if (!state.printer.connected) {
      try { await connectPrinter(); } catch (e) { return; }
    }
    await runPrint(remaining);
  }

  // ------------------------------------------------------------------ input
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  function onKey(e) {
    if (e.target && e.target.tagName === "SELECT") return;
    const k = e.key;
    if (k === "f" || k === "F") return toggleFullscreen();
    if (state.busy) return;
    armIdleReset();
    switch (state.screen) {
      case "live":
        if (k === " " || k === "Enter") { e.preventDefault(); shootSession(); }
        else if (k === "c" || k === "C") cycleCamera();
        break;
      case "pick":
        if (k >= "1" && k <= String(state.frames.length)) toggle(Number(k) - 1);
        else if (k === "Backspace") undo();
        else if (k === "Enter") toCopies();
        else if (k === "r" || k === "R" || k === "Escape") goHome();
        break;
      case "copies":
        if (k === "+" || k === "=") setCopies(state.copies + 1);
        else if (k === "-" || k === "_") setCopies(state.copies - 1);
        else if (k >= "1" && k <= "9") setCopies(Number(k));
        else if (k === "Enter") startPrint();
        else if (k === "Escape" || k === "Backspace") show("pick");
        break;
      case "status":
        if (k === "Escape") goHome();
        else if (k === "Enter" && !$("status-actions").classList.contains("hidden")) retryPrint();
        break;
    }
  }

  function wire() {
    $("start-btn").addEventListener("click", shootSession);
    $("retake-btn").addEventListener("click", goHome);
    $("next-btn").addEventListener("click", toCopies);
    $("minus-btn").addEventListener("click", () => setCopies(state.copies - 1));
    $("plus-btn").addEventListener("click", () => setCopies(state.copies + 1));
    $("back-btn").addEventListener("click", () => show("pick"));
    $("print-btn").addEventListener("click", startPrint);
    $("retry-btn").addEventListener("click", retryPrint);
    $("home-btn").addEventListener("click", goHome);
    $("printer-pill").addEventListener("click", onPrinterPill);
    $("fullscreen-btn").addEventListener("click", toggleFullscreen);
    $("camera-select").addEventListener("change", (e) => startCamera(e.target.value));
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", armIdleReset);
    if (navigator.mediaDevices) navigator.mediaDevices.addEventListener("devicechange", listCameras);
    setInterval(() => { if (!state.busy) refreshPrinterStatus(); }, 30000);
  }

  async function init() {
    filmTexture();
    try { await document.fonts.load("700 20px Grandstander"); } catch (e) { /* fallback font */ }
    drawOrnaments();
    wire();
    renderPrinterPill();
    if (DEMO) {
      await state.printer.connect();
      await refreshPrinterStatus();
    }
    await startCamera(storage.get("booth.camera"));
  }

  init();
})();

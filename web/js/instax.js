// Instax Link printer driver over Web Bluetooth (Chrome / Edge only).
//
// Ported to plain JavaScript from instax-link-web by linssenste
// (https://github.com/linssenste/instax-link-web, MIT License; see
// LICENSE-instax-link-web.txt). Proven on a Mini Link 3 on 2026-11-12.
// Trimmed to what the booth needs: connect, status, send an image, print copies.
//
// Packets: 0x41 0x62 <len hi> <len lo> <opcode hi> <opcode lo> <payload...> <checksum>
// Replies start 0x61 0x42 and are matched to the request by opcode.

(function () {
  const SERVICES = [
    "70954782-2d83-473d-9e5f-81e1d02d5273",   // primary
    "0000180a-0000-1000-8000-00805f9b34fb",
    "00001800-0000-1000-8000-00805f9b34fb",
    "0000e0ff-3c17-d293-8e48-14fe2e4da212",
  ];
  const NAME_PREFIX = "INSTAX";

  const OP = {
    SUPPORT_FUNCTION_INFO: 0x0002,
    PRINT_IMAGE_DOWNLOAD_START: 0x1000,
    PRINT_IMAGE_DOWNLOAD_DATA: 0x1001,
    PRINT_IMAGE_DOWNLOAD_END: 0x1002,
    PRINT_IMAGE_DOWNLOAD_CANCEL: 0x1003,
    PRINT_IMAGE: 0x1080,
  };
  const PRINT_FAULT_OPS = new Set([
    OP.PRINT_IMAGE, OP.PRINT_IMAGE_DOWNLOAD_START, OP.PRINT_IMAGE_DOWNLOAD_DATA,
    OP.PRINT_IMAGE_DOWNLOAD_END, OP.SUPPORT_FUNCTION_INFO,
  ]);

  const RESPONSE_TIMEOUT = 2000;   // ms a reply may take before a command fails
  const PRINT_DURATION = 15000;    // ms a sheet takes to come out
  const CHUNK_SIZE_MINI = 900;     // image packet size the firmware expects
  const PRINTER_NOT_READY = 0x01;  // transfer-start status: a fresh pack is still setting up
  const MAX_TRANSFER_BYTES = 65535;

  // Web Bluetooth exposes no MTU. 182 bytes was measured to work on Link printers;
  // smaller writes and longer pauses are fallbacks if the link stops keeping up.
  const WRITE_SIZES = [182, 128, 20];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class PrintError extends Error {
    // reason: busy | refused | reported | not-printed | silent
    constructor(reason, message, status = null) {
      super(message);
      this.name = "PrintError";
      this.reason = reason;
      this.status = status;
    }
  }

  // the pause between writes and the write size, tuned across transfers
  class TransferTuning {
    constructor() { this.sizeIndex = 0; this.delay = 15; this.cleanRuns = 0; }
    get writeSize() { return WRITE_SIZES[this.sizeIndex]; }
    succeeded() {
      this.delay = Math.max(4, Math.round(this.delay * 0.8));
      if (this.sizeIndex > 0 && ++this.cleanRuns >= 3) { this.cleanRuns = 0; this.sizeIndex--; }
    }
    backOff() {
      this.cleanRuns = 0;
      if (this.sizeIndex < WRITE_SIZES.length - 1) { this.sizeIndex++; return true; }
      this.delay += 25;
      return this.delay <= 200;
    }
  }

  // split a packet into equal writes rather than a fixed stride with a tiny tail
  function writeStride(total, maxWrite) {
    const writes = Math.ceil(total / maxWrite);
    return Math.ceil(total / writes);
  }

  function encode(opcode, payload) {
    const length = payload.length + 7;
    const packet = [0x41, 0x62, (length >> 8) & 0xff, length & 0xff, opcode >> 8, opcode & 0xff, ...payload];
    const checksum = packet.reduce((a, v) => a + v, 0) & 0xff;
    return new Uint8Array([...packet, checksum ^ 0xff]);
  }

  function decode(dataView) {
    if (!dataView) return null;
    const p = Array.from(new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength));
    const length = (p[2] << 8) | p[3];
    const sum = p.reduce((a, v) => a + v, 0) & 0xff;
    if (length !== p.length || sum !== 0xff) throw new Error("Invalid packet");
    if (p[0] !== 0x61 || p[1] !== 0x42) throw new Error("Unrecognised packet header");
    const opcode = (p[4] << 8) | p[5];
    const status = p[6];
    const command = p[7];
    const payload = p.slice(8, p.length - 1);
    const out = { opcode, status, command, payload };
    if (opcode === OP.SUPPORT_FUNCTION_INFO) {
      const two = (o) => (payload.length < o + 2 ? 0 : (payload[o] << 8) | payload[o + 1]);
      if (command === 0) Object.assign(out, { width: two(0), height: two(2) });
      if (command === 1) Object.assign(out, { isCharging: payload[0] ?? 0, battery: payload[1] ?? null });
      if (command === 2 && payload.length > 0) {
        Object.assign(out, { photosLeft: payload[0] & 15, isCharging: (payload[0] & 0x80) ? 1 : 0 });
      }
    }
    return out;
  }

  // split image bytes into index-prefixed chunks, zero-padding the last one
  function imageToChunks(bytes, chunkSize = CHUNK_SIZE_MINI) {
    const chunks = [];
    for (let i = 0, idx = 0; i < bytes.length; i += chunkSize, idx++) {
      const chunk = new Uint8Array(4 + chunkSize);   // zero-filled = padding
      new DataView(chunk.buffer).setUint32(0, idx, false);
      chunk.set(bytes.slice(i, i + chunkSize), 4);
      chunks.push(chunk);
    }
    return chunks;
  }

  class InstaxPrinter {
    constructor() {
      this.device = null;
      this.write = null;
      this.notify = null;
      this.waiting = null;        // whoever is waiting for the next reply
      this.onUnsolicited = null;  // where replies go when nobody asked
      this.listening = null;
      this.chain = Promise.resolve();
      this.tuning = new TransferTuning();
      this.onDisconnect = null;
      this._onNotification = (event) => {
        const w = this.waiting;
        this.waiting = null;
        if (w) w(event);
        else if (this.onUnsolicited) this.onUnsolicited(event);
      };
    }

    static isSupported() {
      return typeof navigator !== "undefined" && !!navigator.bluetooth;
    }

    get connected() {
      return !!(this.device && this.device.gatt && this.device.gatt.connected && this.write);
    }

    get name() {
      return this.device ? this.device.name : null;
    }

    // Must be called from a click or key press: Chrome shows its device picker.
    async connect() {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: NAME_PREFIX }],
        optionalServices: SERVICES,
      });
      device.addEventListener("gattserverdisconnected", () => {
        this._reset();
        if (this.onDisconnect) this.onDisconnect();
      });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICES[0]);
      const chars = await service.getCharacteristics();
      const write = chars.find((c) => c.properties.write && c.properties.writeWithoutResponse)
        || chars.find((c) => c.properties.write);
      const notify = chars.find((c) => c.properties.notify);
      if (!write || !notify) throw new Error("This printer is missing the expected Bluetooth characteristics");
      this.device = device;
      this.write = write;
      this.notify = notify;
      await sleep(150);   // let the connection settle
      return device;
    }

    async disconnect() {
      try {
        if (this.notify) await this.notify.stopNotifications();
        if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
      } catch (e) { /* already gone */ }
      this._reset();
    }

    _reset() {
      if (this.notify) this.notify.removeEventListener("characteristicvaluechanged", this._onNotification);
      this.listening = null;
      this.waiting = null;
      this.onUnsolicited = null;
      this.write = null;
      this.notify = null;
    }

    _listen() {
      if (this.listening) return this.listening;
      if (!this.notify) throw new Error("Not connected");
      this.listening = this.notify.startNotifications().then((h) => {
        h.addEventListener("characteristicvaluechanged", this._onNotification);
      }).catch((e) => { this.listening = null; throw e; });
      return this.listening;
    }

    // writes go out one at a time, in order: a reply is matched to a request
    // only by being the next notification (with the right opcode) to arrive
    send(bytes, expectReply = true, expectOp = null) {
      const run = this.chain.then(() => this._sendNow(bytes, expectReply, expectOp));
      this.chain = run.then(() => undefined, () => undefined);
      return run;
    }

    async _sendNow(bytes, expectReply, expectOp) {
      const write = this.write;
      if (!write) throw new Error("Not connected to a printer");
      if (!expectReply) {
        await write.writeValueWithoutResponse(bytes);
        return null;
      }
      await this._listen();
      let timer, waiter;
      const answer = new Promise((resolve, reject) => {
        waiter = (event) => {
          const v = event.target && event.target.value;
          const op = v && v.byteLength >= 6 ? v.getUint16(4, false) : null;
          if (expectOp != null && op != null && op !== expectOp) {
            this.waiting = waiter;   // a reply for something else; keep waiting
            return;
          }
          resolve(v);
        };
        this.waiting = waiter;
        timer = setTimeout(() => reject(new Error(`No reply after ${RESPONSE_TIMEOUT}ms`)), RESPONSE_TIMEOUT);
      });
      answer.catch(() => {});
      try {
        await write.writeValueWithoutResponse(bytes);
        return await answer;
      } finally {
        clearTimeout(timer);
        if (this.waiting === waiter) this.waiting = null;
      }
    }

    async command(opcode, payload = [], expectReply = true) {
      const reply = await this.send(encode(opcode, payload), expectReply, opcode);
      return reply ? decode(reply) : null;
    }

    // { battery, charging, photosLeft, isMini }
    async getStatus() {
      const info = { battery: null, charging: false, photosLeft: null, isMini: null };
      try {
        const size = await this.command(OP.SUPPORT_FUNCTION_INFO, [0]);
        if (size && size.width) info.isMini = size.width === 600;
      } catch (e) { /* optional */ }
      const power = await this.command(OP.SUPPORT_FUNCTION_INFO, [1]);
      if (power) { info.battery = power.battery; info.charging = (power.isCharging || 0) > 5; }
      const film = await this.command(OP.SUPPORT_FUNCTION_INFO, [2]);
      if (film && film.photosLeft != null) info.photosLeft = film.photosLeft;
      return info;
    }

    async _filmCount() {
      try {
        const r = await this.command(OP.SUPPORT_FUNCTION_INFO, [2]);
        return r && r.photosLeft != null ? r.photosLeft : null;
      } catch (e) { return null; }
    }

    async _cancelTransfer() {
      for (let i = 0; i < 2; i++) {
        try {
          const r = await this.command(OP.PRINT_IMAGE_DOWNLOAD_CANCEL);
          if (r && r.status === 0) return;
        } catch (e) { /* best effort */ }
      }
    }

    // Push one JPEG (Uint8Array) to the printer. onProgress gets 0..1.
    async sendImage(bytes, onProgress = () => {}) {
      if (bytes.length === 0) throw new PrintError("refused", "The image is empty");
      if (bytes.length > MAX_TRANSFER_BYTES) throw new Error("Image is too large to send");
      const chunks = imageToChunks(bytes);
      const totalBytes = chunks.reduce((s, c) => s + c.length + 7, 0);

      for (;;) {
        let sent = 0;
        try {
          const len = [(bytes.length >> 8) & 0xff, bytes.length & 0xff];
          const start = await this.command(OP.PRINT_IMAGE_DOWNLOAD_START, [0x02, 0, 0, 0, 0, 0, ...len]);
          if (!start) throw new Error("The printer did not answer the transfer start");
          if (start.status !== 0) {
            const busy = start.status === PRINTER_NOT_READY;
            throw new PrintError(busy ? "busy" : "refused",
              busy ? "The printer is still getting the film pack ready" : "The printer would not accept the image",
              start.status);
          }
          for (const chunk of chunks) {
            const packet = encode(OP.PRINT_IMAGE_DOWNLOAD_DATA, Array.from(chunk));
            const stride = writeStride(packet.length, this.tuning.writeSize);
            for (let i = 0; i < packet.length; i += stride) {
              const isEnd = i + stride >= packet.length;
              const slice = packet.slice(i, i + stride);
              const ack = await this.send(slice, isEnd);
              if (isEnd && !ack) throw new Error("Printer did not acknowledge the packet");
              sent += slice.length;
              onProgress(sent / totalBytes);
              if (!isEnd) await sleep(this.tuning.delay);
            }
          }
          await this.command(OP.PRINT_IMAGE_DOWNLOAD_END);
          this.tuning.succeeded();
          onProgress(1);
          return;
        } catch (error) {
          await this._cancelTransfer();
          if (error instanceof PrintError) throw error;
          console.warn("image transfer failed, retrying slower", error);
          if (!this.tuning.backOff()) {
            throw new PrintError("silent", "The printer stopped responding while the photo was being sent");
          }
        }
      }
    }

    // Print the image the printer is holding, `copies` times. onCopy(n) after each.
    async printCopies(copies, onCopy = () => {}) {
      await sleep(500);
      for (let n = 1; n <= copies; n++) {
        const before = await this._filmCount();
        if (before === 0) throw new PrintError("not-printed", "The printer is out of film");
        const r = await this.command(OP.PRINT_IMAGE);
        if (!r) throw new PrintError("silent", "The printer did not answer the print command");
        if (r.status !== 0) throw new PrintError("refused", "The printer turned the print down", r.status);

        const fault = await this._watchPrint(PRINT_DURATION);
        if (fault) throw new PrintError("reported", "The printer reported a problem while printing", fault.status);

        const after = await this._filmCount();
        if (before != null && after != null && after >= before) {
          throw new PrintError("not-printed", "Nothing came out. Check the film pack");
        }
        onCopy(n);
      }
    }

    _watchPrint(duration) {
      return new Promise((resolve) => {
        const finish = (v) => { clearTimeout(timer); this.onUnsolicited = null; resolve(v); };
        const timer = setTimeout(() => finish(null), duration);
        this.onUnsolicited = (event) => {
          let parsed;
          try { parsed = decode(event.target.value); } catch (e) { return; }
          if (!parsed || !parsed.status) return;
          if (!PRINT_FAULT_OPS.has(parsed.opcode)) return;
          finish(parsed);
        };
      });
    }
  }

  // A stand-in printer for trying the booth without film (open with ?demo).
  // It pretends to transfer and print, and downloads each print as a JPEG.
  class DemoPrinter {
    constructor() { this.connected = false; this.name = "Demo printer"; this.photosLeft = 10; this.lastBlob = null; }
    static isSupported() { return true; }
    async connect() { this.connected = true; }
    async disconnect() { this.connected = false; }
    async getStatus() { return { battery: 80, charging: false, photosLeft: this.photosLeft, isMini: true }; }
    async sendImage(bytes, onProgress = () => {}) {
      for (let i = 1; i <= 20; i++) { await sleep(60); onProgress(i / 20); }
      this.lastBytes = bytes;
    }
    async printCopies(copies, onCopy = () => {}) {
      for (let n = 1; n <= copies; n++) {
        await sleep(1500);
        this.photosLeft = Math.max(0, this.photosLeft - 1);
        if (this.lastBytes && !Booth.TEST_MODE) {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([this.lastBytes], { type: "image/jpeg" }));
          a.download = `print-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
          a.click();
        }
        onCopy(n);
      }
    }
  }

  Booth.instax = { InstaxPrinter, DemoPrinter, PrintError, encode, decode, imageToChunks };
})();

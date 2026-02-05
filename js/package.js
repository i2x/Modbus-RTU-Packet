// -------------------------------------------------
// Helpers
// -------------------------------------------------
const hex8  = n => (n & 0xFF).toString(16).padStart(2,"0").toUpperCase();
const hex16 = n => (n & 0xFFFF).toString(16).padStart(4,"0").toUpperCase();
const fmtHex8  = n => "0x" + hex8(n);
const fmtHex16 = n => "0x" + hex16(n);

const bin8 = n => (n & 0xFF).toString(2).padStart(8, "0");

function bin16g(n) {
  return (n & 0xFFFF)
    .toString(2)
    .padStart(16, "0")
    .match(/.{1,4}/g)
    .join(" ");
}

function byteTo16g(b) {
  const as16 = (b & 0xFF).toString(2).padStart(16, "0");
  return as16.match(/.{1,4}/g).join(" ");
}

const POLY = 0xA001;
const POLY_BIN = bin16g(POLY);

// escape html
function esc(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

// Build a 2-column step: text + aligned binary block
function stepBlock(title, subtitle, linesHtml) {
  return `
    <div class="step-wrap">
      <div class="step-text">
        ${esc(title)}
        ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ``}
      </div>
      <pre class="bin-block">${linesHtml}</pre>
    </div>
  `;
}

// Binary line helper: fixed label width so values align
function binLine(label, value) {
  return `<span class="bin-label">${esc(label)}</span><span class="bin-val">${esc(value)}</span>\n`;
}

// -------------------------------------------------
// CRC16 trace (binary aligned) — LSB only in step-text
// -------------------------------------------------
function modbusCRC16_trace(buf) {
  let crc = 0xFFFF;
  const steps = [];

  for (let i = 0; i < buf.length; i++) {
    const input = buf[i] & 0xFF;

    // A) XOR input into CRC
    const beforeXor = crc & 0xFFFF;
    const input16 = input; // low byte
    const afterXor = (beforeXor ^ input16) & 0xFFFF;

    let aLines = "";
    aLines += binLine("crc (before)    ", bin16g(beforeXor));
    aLines += binLine("input (16b)     ", byteTo16g(input));
    aLines += binLine("crc XOR in      ", bin16g(afterXor));

    steps.push({
      byte: i,
      input,
      stepHTML: stepBlock(
        "A) XOR input byte into CRC",
        "input byte placed in low 8 bits",
        aLines
      ),
      crc: afterXor
    });

    crc = afterXor;

    // B) 8 bit cycles
    for (let bit = 0; bit < 8; bit++) {
      const before = crc & 0xFFFF;
      const lsb = before & 1;

      if (lsb) {
        const afterShift = (before >> 1) & 0xFFFF;
        const afterPoly  = (afterShift ^ POLY) & 0xFFFF;

        let bLines = "";
        bLines += binLine("before:         ", bin16g(before));
        bLines += binLine("shift:          ", bin16g(afterShift));
        bLines += binLine("poly:           ", POLY_BIN);
        bLines += binLine("shift XOR poly: ", bin16g(afterPoly));

        steps.push({
          byte: i,
          input,
          stepHTML: stepBlock(
            `B) bit ${bit}: LSB=1`,
            "shift right then XOR polynomial",
            bLines
          ),
          crc: afterPoly
        });

        crc = afterPoly;
      } else {
        const afterShift = (before >> 1) & 0xFFFF;

        let bLines = "";
        bLines += binLine("before:         ", bin16g(before));
        bLines += binLine("shift:          ", bin16g(afterShift));

        steps.push({
          byte: i,
          input,
          stepHTML: stepBlock(
            `B) bit ${bit}: LSB=0`,
            "shift right only",
            bLines
          ),
          crc: afterShift
        });

        crc = afterShift;
      }
    }
  }

  return { crc: crc & 0xFFFF, steps };
}

// -------------------------------------------------
// Input parsing (Quantity = 1 byte / 2 hex digits)
// -------------------------------------------------
function parseHex8OrFallback(raw, fallback) {
  const s = String(raw ?? "").trim().replace(/^0x/i, "");
  const n = parseInt(s, 16);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(0xFF, n));
}

// -------------------------------------------------
// Build packet
// -------------------------------------------------
const slaveEl = document.getElementById("slave");
const addrEl  = document.getElementById("addr");
const qtyEl   = document.getElementById("qty");

function buildPacket() {
  const slave = parseInt(slaveEl.value, 16);
  const addr  = parseInt(addrEl.value, 16);

  // ✅ Quantity is editable as 1 byte (LSB). MSB fixed 0x00
  const qty8 = parseHex8OrFallback(qtyEl.value, 0x02);
  qtyEl.value = hex8(qty8); // normalize UI to 2-hex

  const packet = new Uint8Array(8);
  packet.set([
    slave & 0xFF,
    0x03,
    (addr >> 8) & 0xFF,
    addr & 0xFF,
    0x00,    // Qty MSB fixed
    qty8     // Qty LSB editable
  ]);

  const result = modbusCRC16_trace(packet.slice(0, 6));
  packet[6] = result.crc & 0xFF;        // CRC LSB
  packet[7] = (result.crc >> 8) & 0xFF; // CRC MSB

  renderPacket(packet);
  renderCRCSteps(result.steps);
}

// auto rebuild when input changes
[slaveEl, addrEl, qtyEl].forEach(el => el.addEventListener("input", buildPacket));

// -------------------------------------------------
// Render packet visualization
// -------------------------------------------------
function renderPacket(packet) {
  const labels = ["Slave","Function","Addr MSB","Addr LSB","Qty MSB","Qty LSB","CRC LSB","CRC MSB"];
  const view = document.getElementById("packetView");
  const rawOutput = document.getElementById("rawOutput");

  view.innerHTML = "";
  let raw = "";

  packet.forEach((b, i) => {
    raw += hex8(b) + " ";
    view.insertAdjacentHTML("beforeend", `
      <div class="byte-box">
        <div class="byte-value">${hex8(b)}</div>
        <div class="byte-label">${labels[i]}</div>
      </div>
    `);
  });

  rawOutput.textContent = raw.trim();
}

// -------------------------------------------------
// Render CRC step table
// -------------------------------------------------
function renderCRCSteps(steps) {
  const tbody = document.getElementById("crcSteps");
  tbody.innerHTML = "";

  steps.forEach(s => {
    tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td class="col-byte">${s.byte}</td>
        <td class="col-input-hex">${fmtHex8(s.input)}</td>
        <td class="col-input-bin">${bin8(s.input)}</td>
        <td class="col-step">${s.stepHTML}</td>
        <td class="col-crc-hex">${fmtHex16(s.crc)}</td>
      </tr>
    `);
  });
}

// init
buildPacket();

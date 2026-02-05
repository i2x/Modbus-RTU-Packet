        // ---------- helpers ----------
        const hex8 = n => (n & 0xFF).toString(16).padStart(2, "0").toUpperCase();
        const hex16 = n => (n & 0xFFFF).toString(16).padStart(4, "0").toUpperCase();
        const bin8 = n => (n & 0xFF).toString(2).padStart(8, "0");

        function bin32(n) {
            const s = (n >>> 0).toString(2).padStart(32, "0");
            // group by 4 for readability
            return s.match(/.{1,4}/g).join(" ");
        }
        function group8(bits32_group4) {
            // convert "xxxx xxxx ..." (4-bit groups) -> 8-bit groups
            const raw = bits32_group4.replaceAll(" ", "");
            return raw.match(/.{1,8}/g).join(" ");
        }

        function parseHex8(v, d) {
            const n = parseInt(String(v).trim(), 16);
            return Number.isFinite(n) ? n & 0xFF : d;
        }
        function rawHex(arr) { return arr.map(b => hex8(b)).join(" "); }

        function renderBoxes(el, bytes, labels) {
            el.innerHTML = "";
            bytes.forEach((b, i) => {
                el.insertAdjacentHTML("beforeend", `
      <div class="byte-box">
        <div class="byte-value">${hex8(b)}</div>
        <div class="byte-label">${labels[i] || ""}</div>
      </div>
    `);
            });
        }

        function randFloat(min, max) {
            return min + Math.random() * (max - min);
        }

        // ---------- CRC16 ----------
        function modbusCRC16(buf) {
            let crc = 0xFFFF;
            for (const b of buf) {
                crc ^= b;
                for (let i = 0; i < 8; i++) {
                    const lsb = crc & 1;
                    crc >>= 1;
                    if (lsb) crc ^= 0xA001;
                }
            }
            return crc & 0xFFFF;
        }

        // ---------- binary -> decimal explanation (byte-weighted) ----------
        function explainBinToDec(d0, d1, d2, d3) {
            const p0 = d0 * (2 ** 24);
            const p1 = d1 * (2 ** 16);
            const p2 = d2 * (2 ** 8);
            const p3 = d3;

            return {
                value: p0 + p1 + p2 + p3,
                text:
                    `${d0}×2^24 + ${d1}×2^16 + ${d2}×2^8 + ${d3}
= ${p0} + ${p1} + ${p2} + ${p3}
= ${p0 + p1 + p2 + p3}`
            };
        }

        // ---------- main ----------
        const COEFF = 0.001;

        function buildRequest() {
            const slave = parseHex8(slaveEl.value, 0x01);
            const addr2 = parseHex8(addrEl.value, 0x00); // only 00 or 32
            const qty = parseHex8(qtyEl.value, 0x02);

            // normalize UI to 2 digits
            slaveEl.value = hex8(slave);
            addrEl.value = hex8(addr2);
            qtyEl.value = hex8(qty);

            // map 2-digit address to 16-bit address (only 00 or 32)
            const addr = (addr2 === 0x32) ? 0x0032 : 0x0000;

            // ---------- REQUEST ----------
            const req = [slave, 0x03, (addr >> 8) & 0xFF, addr & 0xFF, 0x00, qty];
            const crcReq = modbusCRC16(req);
            req.push(crcReq & 0xFF, (crcReq >> 8) & 0xFF);

            renderBoxes(reqView, req,
                ["Slave", "Func", "Addr MSB", "Addr LSB", "Qty MSB", "Qty LSB", "CRC LSB", "CRC MSB"]
            );
            reqRaw.textContent = rawHex(req);

            simulateResponse(slave, addr2);
        }

        function simulateResponse(slave, addr2) {
            let title = "", unit = "", value = 0;

            if (addr2 === 0x00) {
                title = "Voltage";
                unit = "V";
                value = randFloat(224.838, 225.438);
            } else { // 0x32
                title = "Frequency";
                unit = "Hz";
                value = 50.000;
            }

            // create raw32 from engineering value
            const raw32 = Math.round(value / COEFF) >>> 0;

            // bytes d0..d3 (big-endian)
            const d0 = (raw32 >>> 24) & 0xFF;
            const d1 = (raw32 >>> 16) & 0xFF;
            const d2 = (raw32 >>> 8) & 0xFF;
            const d3 = (raw32) & 0xFF;

            // ---------- RESPONSE ----------
            const res = [slave, 0x03, 0x04, d0, d1, d2, d3];
            const crc = modbusCRC16(res);
            res.push(crc & 0xFF, (crc >> 8) & 0xFF);

            renderBoxes(resView, res,
                ["Slave", "Func", "ByteCnt", "D0", "D1", "D2", "D3", "CRC LSB", "CRC MSB"]
            );
            resRaw.textContent = rawHex(res);

            // ---------- HUMAN FRIENDLY EXPLAIN ----------
            const b0 = bin8(d0), b1 = bin8(d1), b2 = bin8(d2), b3 = bin8(d3);

            const part0 = (d0 << 24) >>> 0;
            const part1 = (d1 << 16) >>> 0;
            const part2 = (d2 << 8) >>> 0;
            const part3 = (d3) >>> 0;
            const rawByOps = (part0 | part1 | part2 | part3) >>> 0;

            const rawBinGrouped = group8(bin32(rawByOps)); // 32-bit -> 8-bit groups
            const binExplain = explainBinToDec(d0, d1, d2, d3);

            resultTitle.textContent = `${title} decode (Hex → Binary )`;

            explainOut.textContent =
                `DATA bytes (d0 d1 d2 d3)
- d0 = 0x${hex8(d0)} = ${b0}
- d1 = 0x${hex8(d1)} = ${b1}
- d2 = 0x${hex8(d2)} = ${b2}
- d3 = 0x${hex8(d3)} = ${b3}

Combine (Big-endian u32):
raw32 = (d0<<24) | (d1<<16) | (d2<<8) | d3

Binary with shifts:
(d0<<24) = ${group8(bin32(part0))}
(d1<<16) = ${group8(bin32(part1))}
(d2<< 8) = ${group8(bin32(part2))}
(d3    ) = ${group8(bin32(part3))}
-------------------------------- OR
raw32(bin) = ${rawBinGrouped}

Binary → Decimal (byte-weighted):
${binExplain.text}

Apply coefficient:
value = raw32 × ${COEFF}
value = ${(binExplain.value * COEFF).toFixed(3)} ${unit}`;
        }

        // ---------- init ----------
        const slaveEl = document.getElementById("slave");
        const addrEl = document.getElementById("addr");
        const qtyEl = document.getElementById("qty");

        const reqView = document.getElementById("reqView");
        const reqRaw = document.getElementById("reqRaw");
        const resView = document.getElementById("resView");
        const resRaw = document.getElementById("resRaw");

        const resultTitle = document.getElementById("resultTitle");
        const explainOut = document.getElementById("explainOut");

        buildRequest();

/**
 * Minimaler, abhängigkeitsfreier QR-Code-Generator.
 * Byte-Modus, Fehlerkorrektur-Level L, Versionen 1–5 (ein Datenblock).
 * Reicht für kurze URLs wie http://192.168.x.x:4173 und läuft komplett offline.
 *
 * QR.build(text) -> { size, modules } wobei modules[row][col] 0 oder 1 ist.
 */
(function (global) {
  "use strict";

  // --- Galois-Feld GF(256), primitives Polynom 0x11D ---
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGf() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGenerator(degree) {
    let poly = [1];
    for (let d = 0; d < degree; d++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[d]);
      }
      poly = next;
    }
    return poly; // Länge degree+1, führender Koeffizient 1
  }

  function rsEncode(data, ecLen) {
    const gen = rsGenerator(ecLen);
    const res = new Array(ecLen).fill(0);
    for (const byte of data) {
      const factor = byte ^ res[0];
      res.shift();
      res.push(0);
      if (factor !== 0) {
        for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
      }
    }
    return res;
  }

  // --- Versionstabelle (Level L, ein Block) ---
  const VERSIONS = {
    1: { size: 21, ec: 7, dataCw: 19, align: null },
    2: { size: 25, ec: 10, dataCw: 34, align: 18 },
    3: { size: 29, ec: 15, dataCw: 55, align: 22 },
    4: { size: 33, ec: 20, dataCw: 80, align: 26 },
    5: { size: 37, ec: 26, dataCw: 108, align: 30 },
  };

  function chooseVersion(byteLength) {
    for (const v of [1, 2, 3, 4, 5]) {
      const capacityBits = VERSIONS[v].dataCw * 8 - (4 + 8);
      if (byteLength * 8 <= capacityBits) return v;
    }
    throw new Error("Text zu lang für diesen QR-Code.");
  }

  function encodeData(bytes, version) {
    const info = VERSIONS[version];
    const totalBits = info.dataCw * 8;
    const bits = [];
    const push = (value, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
    };
    push(0b0100, 4); // Byte-Modus
    push(bytes.length, 8); // Zeichenzähler (Version 1–9: 8 Bit)
    for (const b of bytes) push(b, 8);
    push(0, Math.min(4, totalBits - bits.length)); // Abschluss
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      codewords.push(v);
    }
    const pad = [0xec, 0x11];
    let p = 0;
    while (codewords.length < info.dataCw) codewords.push(pad[p++ % 2]);
    return codewords;
  }

  // --- Funktionsmuster ---
  function placeFinder(mod, res, size, row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        res[rr][cc] = true;
        const border = (r === 0 || r === 6) && c >= 0 && c <= 6;
        const side = (c === 0 || c === 6) && r >= 0 && r <= 6;
        const center = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        mod[rr][cc] = border || side || center ? 1 : 0;
      }
    }
  }

  function placeAlignment(mod, res, size, center) {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const rr = center + r;
        const cc = center + c;
        res[rr][cc] = true;
        const ring = Math.max(Math.abs(r), Math.abs(c));
        mod[rr][cc] = ring === 1 ? 0 : 1;
      }
    }
  }

  function formatPositions(size) {
    const copy1 = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    ];
    const copy2 = [
      [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
      [size - 5, 8], [size - 6, 8], [size - 7, 8],
      [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5],
      [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
    ];
    return { copy1, copy2 };
  }

  function formatInfoBits(mask) {
    const data = (0b01 << 3) | mask; // Level L = 01
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function placeFormat(mod, size, mask) {
    const bits = formatInfoBits(mask);
    const { copy1, copy2 } = formatPositions(size);
    for (let i = 0; i < 15; i++) {
      const b = (bits >> (14 - i)) & 1; // Zellen tragen die Bits MSB zuerst
      mod[copy1[i][0]][copy1[i][1]] = b;
      mod[copy2[i][0]][copy2[i][1]] = b;
    }
  }

  function placeData(mod, res, size, codewords) {
    const totalBits = codewords.length * 8;
    let idx = 0;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // Timing-Spalte überspringen
      for (let i = 0; i < size; i++) {
        const row = upward ? size - 1 - i : i;
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (res[row][cc]) continue;
          let bit = 0;
          if (idx < totalBits) {
            bit = (codewords[idx >> 3] >> (7 - (idx & 7))) & 1;
            idx++;
          }
          mod[row][cc] = bit;
        }
      }
      upward = !upward;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function penalty(mod, size) {
    let score = 0;
    // Regel 1: Läufe gleicher Farbe
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (mod[r][c] === mod[r][c - 1]) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (let c = 0; c < size; c++) {
      let run = 1;
      for (let r = 1; r < size; r++) {
        if (mod[r][c] === mod[r - 1][c]) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    // Regel 2: 2x2-Blöcke
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = mod[r][c];
        if (v === mod[r][c + 1] && v === mod[r + 1][c] && v === mod[r + 1][c + 1]) {
          score += 3;
        }
      }
    }
    // Regel 3: Finder-ähnliche Muster
    const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c <= size - 11; c++) {
        let m1 = true;
        let m2 = true;
        for (let k = 0; k < 11; k++) {
          if (mod[r][c + k] !== p1[k]) m1 = false;
          if (mod[r][c + k] !== p2[k]) m2 = false;
        }
        if (m1 || m2) score += 40;
      }
    }
    for (let c = 0; c < size; c++) {
      for (let r = 0; r <= size - 11; r++) {
        let m1 = true;
        let m2 = true;
        for (let k = 0; k < 11; k++) {
          if (mod[r + k][c] !== p1[k]) m1 = false;
          if (mod[r + k][c] !== p2[k]) m2 = false;
        }
        if (m1 || m2) score += 40;
      }
    }
    // Regel 4: Dunkelanteil
    let dark = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) if (mod[r][c]) dark++;
    }
    const ratio = (dark / (size * size)) * 100;
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return score;
  }

  function build(text) {
    const bytes = new TextEncoder().encode(text);
    const version = chooseVersion(bytes.length);
    const info = VERSIONS[version];
    const size = info.size;
    const dataCw = encodeData(bytes, version);
    const codewords = dataCw.concat(rsEncode(dataCw, info.ec));

    const mod = Array.from({ length: size }, () => new Array(size).fill(null));
    const res = Array.from({ length: size }, () => new Array(size).fill(false));

    placeFinder(mod, res, size, 0, 0);
    placeFinder(mod, res, size, 0, size - 7);
    placeFinder(mod, res, size, size - 7, 0);
    for (let i = 0; i < size; i++) {
      if (mod[6][i] === null) {
        mod[6][i] = i % 2 === 0 ? 1 : 0;
        res[6][i] = true;
      }
      if (mod[i][6] === null) {
        mod[i][6] = i % 2 === 0 ? 1 : 0;
        res[i][6] = true;
      }
    }
    if (info.align !== null) placeAlignment(mod, res, size, info.align);
    mod[size - 8][8] = 1;
    res[size - 8][8] = true;
    const { copy1, copy2 } = formatPositions(size);
    for (const [r, c] of copy1.concat(copy2)) res[r][c] = true;

    placeData(mod, res, size, codewords);

    let best = null;
    let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      const test = mod.map((row) => row.slice());
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (!res[r][c] && MASKS[m](r, c)) test[r][c] ^= 1;
        }
      }
      placeFormat(test, size, m);
      const sc = penalty(test, size);
      if (sc < bestScore) {
        bestScore = sc;
        best = test;
      }
    }
    return { size, modules: best };
  }

  global.QR = { build };
})(window);

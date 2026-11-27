// png-squeeze-01-run-20261127 — squeeze screenshots into the smallest lossless PNG.
// One program, Node 22 stdlib only (node:fs, node:path, node:zlib). It reads each
// /input/<id>/image.png (1280x720 RGBA, stored PNG), re-encodes it losslessly with
// colour-type reduction (palette / grey / RGB / RGBA), adaptive per-row filters and
// the smallest of several zlib level-9 deflate variants, and writes
// /output/<id>/image.png. Outside the grader, MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR
// stand in for /input /output. Deterministic: no clock, no randomness, no network.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync, constants as zlibConstants } from 'node:zlib';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// --- CRC32 (PNG chunk checksums), table-driven, IEEE polynomial.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- PNG decoder: 8-bit, non-interlaced, colour types 0/2/3/4/6. Returns RGBA pixels.
function decodePng(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error('not a PNG');
  }
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colourType = 0, interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(pos);
    const type = bytes.toString('ascii', pos + 4, pos + 8);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error('unsupported PNG (bit depth / interlace)');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error('unsupported colour type ' + colourType);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) throw new Error('unexpected inflated size');
  const rgba = new Uint8Array(width * height * 4);
  let src = 0;
  const prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = raw.subarray(src, src + stride);
    src += stride;
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const v = row[i];
      if (filter === 0) cur[i] = v;
      else if (filter === 1) cur[i] = (v + a) & 0xff;
      else if (filter === 2) cur[i] = (v + b) & 0xff;
      else if (filter === 3) cur[i] = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        cur[i] = (v + pr) & 0xff;
      } else throw new Error('bad filter ' + filter);
    }
    let dst = y * width * 4;
    if (colourType === 6) {
      rgba.set(cur, dst);
    } else if (colourType === 2) {
      for (let x = 0; x < width; x++) {
        const s = x * 3;
        rgba[dst++] = cur[s]; rgba[dst++] = cur[s + 1]; rgba[dst++] = cur[s + 2]; rgba[dst++] = 255;
      }
    } else if (colourType === 0) {
      for (let x = 0; x < width; x++) {
        const g = cur[x];
        rgba[dst++] = g; rgba[dst++] = g; rgba[dst++] = g; rgba[dst++] = 255;
      }
    } else if (colourType === 4) {
      for (let x = 0; x < width; x++) {
        const s = x * 2;
        rgba[dst++] = cur[s]; rgba[dst++] = cur[s]; rgba[dst++] = cur[s]; rgba[dst++] = cur[s + 1];
      }
    } else {
      for (let x = 0; x < width; x++) {
        const pi = cur[x];
        rgba[dst++] = palette[pi * 3];
        rgba[dst++] = palette[pi * 3 + 1];
        rgba[dst++] = palette[pi * 3 + 2];
        rgba[dst++] = trns && pi < trns.length ? trns[pi] : 255;
      }
    }
    prev.set(cur);
  }
  return { width, height, rgba };
}

// --- Colour analysis: pick the smallest lossless representation for these pixels.
function analyze(rgba) {
  let allOpaque = true, allGrey = true;
  const colours = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
    if (a !== 255) allOpaque = false;
    if (r !== g || g !== b) allGrey = false;
    if (colours.size <= 256) {
      const key = (r << 24) | (g << 16) | (b << 8) | a;
      if (!colours.has(key)) colours.set(key, colours.size);
    }
  }
  return { allOpaque, allGrey, colours };
}

// Convert RGBA pixels to the chosen representation's raw scanlines (no filter bytes).
// Returns { colourType, bpp, palette, trns, rows }.
function convert(rgba, width, height) {
  const { allOpaque, allGrey, colours } = analyze(rgba);
  const px = width * height;
  if (allGrey && allOpaque) {
    const rows = new Uint8Array(px);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) rows[p] = rgba[i];
    return { colourType: 0, bpp: 1, palette: null, trns: null, rows };
  }
  if (allGrey) {
    const rows = new Uint8Array(px * 2);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 2) { rows[p] = rgba[i]; rows[p + 1] = rgba[i + 3]; }
    return { colourType: 4, bpp: 2, palette: null, trns: null, rows };
  }
  if (colours.size <= 256) {
    const palette = new Uint8Array(colours.size * 3);
    const alpha = new Uint8Array(colours.size);
    for (const [key, idx] of colours) {
      palette[idx * 3] = (key >>> 24) & 0xff;
      palette[idx * 3 + 1] = (key >>> 16) & 0xff;
      palette[idx * 3 + 2] = (key >>> 8) & 0xff;
      alpha[idx] = key & 0xff;
    }
    let trns = null;
    if (!allOpaque) {
      let last = colours.size - 1;
      while (last > 0 && alpha[last] === 255) last--;
      trns = alpha.subarray(0, last + 1);
    }
    const rows = new Uint8Array(px);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      rows[p] = colours.get((rgba[i] << 24) | (rgba[i + 1] << 16) | (rgba[i + 2] << 8) | rgba[i + 3]);
    }
    return { colourType: 3, bpp: 1, palette, trns, rows };
  }
  if (allOpaque) {
    const rows = new Uint8Array(px * 3);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 3) {
      rows[p] = rgba[i]; rows[p + 1] = rgba[i + 1]; rows[p + 2] = rgba[i + 2];
    }
    return { colourType: 2, bpp: 3, palette: null, trns: null, rows };
  }
  return { colourType: 6, bpp: 4, palette: null, trns: null, rows: rgba.slice() };
}

// --- PNG row filters. Cost of a filtered row is the sum of |byte as signed|;
// the cheapest filter wins each row (mode 'adaptive'), or Paeth everywhere ('paeth').
function filterRow(row, prev, bpp, type) {
  const out = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = (i >= bpp && prev) ? prev[i - bpp] : 0;
    let pred = 0;
    if (type === 1) pred = a;
    else if (type === 2) pred = b;
    else if (type === 3) pred = (a + b) >> 1;
    else if (type === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
    }
    out[i] = (row[i] - pred) & 0xff;
  }
  return out;
}

function filteredStream(rows, width, height, bpp, mode) {
  const stride = width * bpp;
  const out = new Uint8Array(height * (stride + 1));
  let prev = null;
  let o = 0;
  // 'adaptive' picks the cheapest filter per row; a named mode forces one
  // filter everywhere (a uniform filter can beat the per-row greedy choice
  // after deflate, because matches then line up across rows).
  const types = mode === 'none' ? [0] : mode === 'paeth' ? [4] : mode === 'sub' ? [1] : mode === 'up' ? [2] : mode === 'avg' ? [3] : [0, 1, 2, 3, 4];
  // 'pairs' mode costs a filtered row by how many distinct neighbouring byte
  // pairs it holds — fewer distinct pairs means more LZ77 matchable runs.
  const seen = new Uint32Array(65536);
  let stamp = 0;
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    let bestType = 0, bestBytes = null, bestCost = Infinity;
    for (const t of types) {
      const f = filterRow(row, prev, bpp, t);
      let c;
      if (mode === 'pairs') {
        c = 0;
        stamp++;
        for (let i = 1; i < f.length; i++) {
          const pair = (f[i - 1] << 8) | f[i];
          if (seen[pair] !== stamp) { seen[pair] = stamp; c++; }
        }
      } else {
        c = 0;
        for (let i = 0; i < f.length; i++) { const v = f[i]; c += v < 128 ? v : 256 - v; }
      }
      if (c < bestCost) { bestCost = c; bestType = t; bestBytes = f; }
    }
    out[o++] = bestType;
    out.set(bestBytes, o);
    o += stride;
    prev = row;
  }
  return out;
}

// --- Deflate: the smallest of a few zlib level-9 variants (all deterministic).
// Note: memLevel 9 is NOT always smaller than the default memLevel 8 — on the
// practice alpha instance it cost +1,729 bytes — so both are tried and the
// smallest wins, as is Z_FILTERED and Z_RLE for flat runs.
function bestDeflate(data) {
  const variants = [
    { level: 9 },
    { level: 9, strategy: zlibConstants.Z_FILTERED },
    { level: 9, memLevel: 9 },
    { level: 9, strategy: zlibConstants.Z_RLE },
  ];
  let best = null;
  for (const opts of variants) {
    const out = deflateSync(data, opts);
    if (best === null || out.length < best.length) best = out;
  }
  return best;
}

// --- PNG encoder: only IHDR, PLTE, tRNS, IDAT (one zlib stream), IEND.
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  out.writeUInt32BE(crc32(crcInput), 8 + data.length);
  return out;
}

function encodePng(image) {
  const rep = convert(image.rgba, image.width, image.height);
  // First pass: one level-9 deflate per filter strategy; the winning stream
  // then gets the extra deflate variants. Keeps the smallest output overall.
  let bestStream = null, bestBytes = null;
  for (const mode of ['adaptive', 'paeth', 'sub', 'up', 'avg', 'pairs', 'none']) {
    const stream = filteredStream(rep.rows, image.width, image.height, rep.bpp, mode);
    const out = deflateSync(stream, { level: 9 });
    if (bestBytes === null || out.length < bestBytes.length) { bestBytes = out; bestStream = stream; }
  }
  const extra = bestDeflate(bestStream);
  const idat = extra.length <= bestBytes.length ? extra : bestBytes;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = rep.colourType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  parts.push(chunk('IHDR', ihdr));
  if (rep.palette) parts.push(chunk('PLTE', rep.palette));
  if (rep.trns) parts.push(chunk('tRNS', rep.trns));
  parts.push(chunk('IDAT', idat));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// --- Main: answer every instance in /input, one run, no clock, no network.
const ids = readdirSync(INPUT_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
for (const id of ids) {
  const image = decodePng(readFileSync(join(INPUT_DIR, id, 'image.png')));
  const png = encodePng(image);
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'image.png'), png);
}

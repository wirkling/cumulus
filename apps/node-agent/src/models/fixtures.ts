/**
 * Deterministic, dependency-free test fixtures so QA runs are reproducible:
 *  - a PNG of known text rendered from a built-in 5x7 font (real glyphs → real,
 *    verifiable OCR output)
 *  - synthesized 16 kHz mono audio for transcription latency (the metric we
 *    care about is RTF; transcript accuracy on a synth tone is not the point)
 */
import { deflateSync } from 'node:zlib';

// 5x7 glyphs (top→bottom rows, bit4..bit0 left→right). Enough for the phrase.
const FONT: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  C: [14, 17, 16, 16, 16, 17, 14],
  U: [17, 17, 17, 17, 17, 17, 14],
  M: [17, 27, 21, 17, 17, 17, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  S: [15, 16, 16, 14, 1, 1, 30],
  Q: [14, 17, 17, 17, 21, 18, 13],
  A: [14, 17, 17, 31, 17, 17, 17],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '6': [6, 8, 16, 30, 17, 17, 14],
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Render `text` to a greyscale 8-bit PNG (black text on white). */
export function renderTextPng(text: string, scale = 8): Buffer {
  const chars = [...text.toUpperCase()].filter((ch) => ch in FONT);
  const margin = 16;
  const charW = 5 * scale;
  const charH = 7 * scale;
  const gap = scale;
  const width = margin * 2 + chars.length * charW + Math.max(0, chars.length - 1) * gap;
  const height = margin * 2 + charH;

  // Greyscale pixel buffer (white background).
  const px = Buffer.alloc(width * height, 255);
  let x0 = margin;
  for (const ch of chars) {
    const glyph = FONT[ch]!;
    for (let gy = 0; gy < 7; gy++) {
      const rowBits = glyph[gy]!;
      for (let gx = 0; gx < 5; gx++) {
        if (rowBits & (1 << (4 - gx))) {
          for (let sy = 0; sy < scale; sy++)
            for (let sx = 0; sx < scale; sx++) {
              const px_x = x0 + gx * scale + sx;
              const px_y = margin + gy * scale + sy;
              px[px_y * width + px_x] = 0;
            }
        }
      }
    }
    x0 += charW + gap;
  }

  // PNG scanlines: filter byte 0 + row bytes.
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    px.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const OCR_PHRASE = 'CUMULUS QA 2026';

let _png: Buffer | undefined;
export function ocrFixturePng(): Buffer {
  // Render large + well-spaced so tesseract reads the blocky font cleanly.
  return (_png ??= renderTextPng(OCR_PHRASE, 16));
}

/** Synthesize `seconds` of 16 kHz mono audio (sweep + light noise). */
export function synthAudio(seconds = 4, sampleRate = 16000): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f = 220 + 110 * Math.sin(t * 1.5); // slow sweep
    out[i] = 0.25 * Math.sin(2 * Math.PI * f * t) + 0.02 * (((i * 2654435761) % 1000) / 1000 - 0.5);
  }
  return out;
}

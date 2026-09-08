// Minimal ZIP reader that understands the compression methods CAD tools use:
// 0 (stored), 8 (deflate) and 93 (Zstandard). Fusion 360 .f3d archives use
// zstd, which jszip can't open; Node 22.15+/24 has zlib.zstdDecompressSync.
const zlib = require("node:zlib");

const EOCD = Buffer.from("PK\x05\x06", "binary");

function entries(buf) {
  const e = buf.lastIndexOf(EOCD);
  if (e < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28);
    const el = buf.readUInt16LE(p + 30);
    const cl = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString("utf8");
    out.push({ name, method, csize, usize, local });
    p += 46 + nl + el + cl;
  }
  return out;
}

function read(buf, entry) {
  const p = entry.local;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error("bad local header");
  const nl = buf.readUInt16LE(p + 26);
  const el = buf.readUInt16LE(p + 28);
  const start = p + 30 + nl + el;
  const data = buf.subarray(start, start + entry.csize);
  switch (entry.method) {
    case 0:
      return Buffer.from(data);
    case 8:
      return zlib.inflateRawSync(data);
    case 93:
      if (!zlib.zstdDecompressSync) throw new Error("zstd unsupported by this Node");
      return zlib.zstdDecompressSync(data);
    default:
      throw new Error("unsupported zip method " + entry.method);
  }
}

function find(buf, pred) {
  const list = entries(buf);
  const hit = list.find(pred);
  return hit ? read(buf, hit) : null;
}

module.exports = { entries, read, find };

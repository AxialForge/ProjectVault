// The extension point: one entry per file type. Each extractor returns
//   { image?: Buffer (PNG/JPEG), meta?: object, text?: string, pending?: string }
// `pending` names work the renderer must finish (it has WebGL and pdf.js):
//   "mesh"  -> render STL/OBJ/3MF to a thumbnail
//   "pdf"   -> first page thumbnail + text
//   "video" -> grab a frame
// Anything not listed here is catalogued with a generic icon and file stats.
const fs = require("node:fs/promises");
const ole = require("./ole");
const mesh = require("./mesh");
const containers = require("./containers");
const text = require("./text");
const image = require("./image");

const KINDS = {
  "cad-part": ["sldprt", "ipt", "f3d", "fcstd", "prt", "x_t", "x_b", "sat", "par", "catpart"],
  "cad-assembly": ["sldasm", "iam", "f3z", "asm", "catproduct"],
  drawing: ["slddrw", "idw", "dwg", "dxf"],
  exchange: ["step", "stp", "iges", "igs"],
  mesh: ["stl", "obj", "3mf", "ply", "amf", "glb", "gltf"],
  ecad: ["kicad_pcb", "kicad_sch", "kicad_pro", "kicad_sym", "kicad_mod", "sch", "brd", "gbr", "gerber", "drl"],
  gcode: ["gcode", "gco", "nc", "bgcode", "tap", "ngc"],
  photo: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "tif", "tiff", "svg", "ico"],
  video: ["mp4", "mov", "mkv", "webm", "avi", "m4v"],
  doc: ["pdf", "docx", "xlsx", "pptx", "doc", "xls", "ppt", "txt", "md", "csv", "rtf", "odt", "ods"],
  archive: ["zip", "7z", "rar"],
};
const EXT_KIND = {};
for (const [kind, exts] of Object.entries(KINDS)) for (const e of exts) EXT_KIND[e] = kind;

function extOf(name) {
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}
function kindOf(name) {
  return EXT_KIND[extOf(name)] || "other";
}

const HANDLERS = {
  sldprt: (b, e) => ole.extract(b, e),
  sldasm: (b, e) => ole.extract(b, e),
  slddrw: (b, e) => ole.extract(b, e),
  ipt: (b, e) => ole.extract(b, e),
  iam: (b, e) => ole.extract(b, e),
  idw: (b, e) => ole.extract(b, e),
  f3d: (b) => containers.f3d(b),
  f3z: (b) => containers.f3d(b),
  fcstd: (b) => containers.fcstd(b),
  "3mf": (b) => ({ ...containers.threeMf(b), pending: "mesh" }),
  stl: (b) => ({ meta: mesh.stl(b), pending: "mesh" }),
  obj: (b) => ({ meta: mesh.obj(b), pending: "mesh" }),
  step: (b) => text.step(b),
  stp: (b) => text.step(b),
  dxf: (b) => text.dxf(b),
  gcode: (b) => text.gcode(b),
  gco: (b) => text.gcode(b),
  nc: (b) => text.gcode(b),
  kicad_pcb: (b) => text.kicadPcb(b),
  kicad_sch: (b) => text.kicadSch(b),
  txt: (b) => text.plain(b),
  md: (b) => text.plain(b),
  csv: (b) => text.plain(b),
  docx: (b, e) => containers.office(b, e),
  xlsx: (b, e) => containers.office(b, e),
  pptx: (b, e) => containers.office(b, e),
  pdf: () => ({ pending: "pdf" }),
  mp4: () => ({ pending: "video" }),
  webm: () => ({ pending: "video" }),
  mov: () => ({ pending: "video" }),
  m4v: () => ({ pending: "video" }),
  mkv: () => ({ pending: "video" }),
};

async function extract(filePath) {
  const ext = extOf(filePath);
  const kind = kindOf(filePath);
  const result = { kind, meta: {}, text: "", image: null, pending: "" };
  try {
    if (kind === "photo" && ext !== "svg") {
      const buf = await fs.readFile(filePath);
      Object.assign(result, await image.extract(buf, ext));
    } else if (HANDLERS[ext]) {
      const buf = await fs.readFile(filePath);
      const r = await HANDLERS[ext](buf, ext);
      Object.assign(result, r);
      if (r.image) {
        const t = image.toThumb(r.image);
        result.image = t || null;
      }
    }
  } catch (err) {
    result.meta = { ...result.meta, "Extraction error": String(err.message || err) };
  }
  // 3MF with an embedded thumbnail doesn't need a render.
  if (result.image && result.pending === "mesh") result.pending = "";
  return result;
}

module.exports = { extract, kindOf, extOf, KINDS };

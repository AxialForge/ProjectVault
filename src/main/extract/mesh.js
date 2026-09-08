// STL (binary + ASCII) and OBJ geometry stats. 3MF is a zip; handled in
// containers.js but its mesh stats come from here.
function bbox() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}
function grow(b, x, y, z) {
  if (x < b.min[0]) b.min[0] = x;
  if (y < b.min[1]) b.min[1] = y;
  if (z < b.min[2]) b.min[2] = z;
  if (x > b.max[0]) b.max[0] = x;
  if (y > b.max[1]) b.max[1] = y;
  if (z > b.max[2]) b.max[2] = z;
}
function dims(b) {
  if (!isFinite(b.min[0])) return null;
  const r = (v) => Math.round(v * 100) / 100;
  return {
    "Size X": r(b.max[0] - b.min[0]),
    "Size Y": r(b.max[1] - b.min[1]),
    "Size Z": r(b.max[2] - b.min[2]),
  };
}

function stl(buf) {
  const b = bbox();
  let tris = 0;
  let volume = 0;
  const isAscii =
    buf.subarray(0, 5).toString("latin1") === "solid" &&
    !(buf.length >= 84 && 84 + buf.readUInt32LE(80) * 50 === buf.length);
  if (isAscii) {
    const text = buf.toString("latin1");
    const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    const v = [];
    let m;
    while ((m = re.exec(text))) {
      const p = [+m[1], +m[2], +m[3]];
      grow(b, p[0], p[1], p[2]);
      v.push(p);
      if (v.length === 3) {
        tris++;
        volume += signedVolume(v[0], v[1], v[2]);
        v.length = 0;
      }
    }
  } else {
    tris = buf.readUInt32LE(80);
    let p = 84;
    for (let i = 0; i < tris && p + 50 <= buf.length; i++, p += 50) {
      const v = [];
      for (let k = 0; k < 3; k++) {
        const o = p + 12 + k * 12;
        const x = buf.readFloatLE(o), y = buf.readFloatLE(o + 4), z = buf.readFloatLE(o + 8);
        grow(b, x, y, z);
        v.push([x, y, z]);
      }
      volume += signedVolume(v[0], v[1], v[2]);
    }
  }
  const meta = { Format: isAscii ? "ASCII STL" : "Binary STL", Triangles: tris, ...dims(b) };
  const vol = Math.abs(volume);
  if (vol > 0) {
    meta["Volume (mm³)"] = Math.round(vol);
    meta["Volume (cm³)"] = Math.round(vol / 10) / 100;
  }
  return meta;
}

function signedVolume(a, b, c) {
  return (
    (a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])) /
    6
  );
}

function obj(buf) {
  const text = buf.toString("latin1");
  const b = bbox();
  let verts = 0, faces = 0, objects = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      const p = line.slice(2).trim().split(/\s+/).map(Number);
      grow(b, p[0], p[1], p[2]);
      verts++;
    } else if (line.startsWith("f ")) faces++;
    else if (line.startsWith("o ") || line.startsWith("g ")) objects++;
  }
  return { Format: "Wavefront OBJ", Vertices: verts, Faces: faces, Objects: objects, ...dims(b) };
}

// 3MF model XML: count objects, vertices, triangles; bounding box from vertices.
function threeMfModel(xml) {
  const b = bbox();
  let verts = 0, tris = 0;
  const objects = (xml.match(/<object\b/g) || []).length;
  const vre = /<vertex\s+x="([-\d.eE+]+)"\s+y="([-\d.eE+]+)"\s+z="([-\d.eE+]+)"/g;
  let m;
  while ((m = vre.exec(xml))) {
    grow(b, +m[1], +m[2], +m[3]);
    verts++;
  }
  tris = (xml.match(/<triangle\b/g) || []).length;
  const unit = (xml.match(/\bunit="(\w+)"/) || [])[1];
  return { Format: "3MF", Objects: objects, Vertices: verts, Triangles: tris, Unit: unit || "millimeter", ...dims(b) };
}

module.exports = { stl, obj, threeMfModel };

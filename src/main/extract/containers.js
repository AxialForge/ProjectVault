// Zip-based CAD/maker containers: Fusion 360 .f3d/.f3z, FreeCAD .FCStd, 3MF,
// and Office .docx/.xlsx/.pptx (text for search + embedded thumbnail).
const zip = require("./zipfile");
const mesh = require("./mesh");

function stripXml(xml) {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function f3d(buf) {
  const list = zip.entries(buf);
  const preview =
    list.find((e) => /Previews\/.*\.png$/i.test(e.name)) ||
    list.find((e) => /\.png$/i.test(e.name));
  const image = preview ? zip.read(buf, preview) : null;
  const meta = { Format: "Fusion 360 archive" };
  meta.Bodies = list.filter((e) => /Breps\.BlobParts\/.*\.smb$/i.test(e.name)).length;
  meta.Designs = new Set(list.map((e) => e.name.split("/")[0]).filter((n) => n && !n.endsWith(".dat"))).size;
  const props = list.find((e) => e.name === "Properties.dat");
  if (props) {
    try {
      const t = zip.read(buf, props).toString("utf8");
      const m = t.match(/\{[\s\S]*\}/);
      const ds = m ? JSON.parse(m[0]).docstruct : null;
      if (ds?.type) meta["Design type"] = [ds.type, ds.subtype].filter(Boolean).join(" / ");
    } catch {
      /* ignore */
    }
  }
  return { image, meta };
}

function fcstd(buf) {
  const list = zip.entries(buf);
  const th = list.find((e) => /thumbnails\/Thumbnail\.png$/i.test(e.name));
  const image = th ? zip.read(buf, th) : null;
  const meta = { Format: "FreeCAD" };
  const doc = list.find((e) => e.name === "Document.xml");
  if (doc) {
    const xml = zip.read(buf, doc).toString("utf8");
    meta.Objects = (xml.match(/<Object\s+type=/g) || []).length;
    const types = {};
    for (const m of xml.matchAll(/<Object\s+type="([^"]+)"/g)) types[m[1]] = (types[m[1]] || 0) + 1;
    const top = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (top.length) meta["Object types"] = Object.fromEntries(top);
    const label = xml.match(/<Property name="Label"[^>]*>\s*<String value="([^"]*)"/);
    if (label) meta.Label = label[1];
    const ver = xml.match(/ProgramVersion="([^"]+)"/);
    if (ver) meta["FreeCAD version"] = ver[1];
  }
  return { image, meta };
}

function threeMf(buf) {
  const list = zip.entries(buf);
  const th =
    list.find((e) => /^Metadata\/thumbnail\.png$/i.test(e.name)) ||
    list.find((e) => /plate_1\.png$/i.test(e.name)) ||
    list.find((e) => /thumbnail.*\.png$/i.test(e.name));
  const image = th ? zip.read(buf, th) : null;
  let meta = { Format: "3MF" };
  const models = list.filter((e) => /\.model$/i.test(e.name));
  if (models.length) {
    let agg = null;
    for (const e of models) {
      const xml = zip.read(buf, e).toString("utf8");
      const m = mesh.threeMfModel(xml);
      if (!agg) {
        agg = m;
        for (const mm of xml.matchAll(/<metadata\s+name="([^"]+)"[^>]*>([^<]*)<\/metadata>/g)) if (mm[2].trim()) agg[mm[1].replace(/^.*:/, "")] = mm[2];
      } else {
        agg.Vertices += m.Vertices;
        agg.Triangles += m.Triangles;
        for (const k of ["Size X", "Size Y", "Size Z"]) if (m[k] != null) agg[k] = Math.max(agg[k] || 0, m[k]);
      }
    }
    meta = agg;
    if (models.length > 1) meta["Model files"] = models.length;
  }
  // Slicer project files (Bambu/Prusa) carry print settings.
  const cfg = list.find((e) => /(Metadata\/(slice_info|project_settings)\.config|Metadata\/Slic3r_PE\.config)$/i.test(e.name));
  if (cfg) meta["Slicer project"] = true;
  return { image, meta };
}

function office(buf, ext) {
  const list = zip.entries(buf);
  const th = list.find((e) => /^docProps\/thumbnail\.(jpe?g|png|emf|wmf)$/i.test(e.name));
  const image = th && /jpe?g|png/i.test(th.name) ? zip.read(buf, th) : null;
  const meta = {};
  const core = list.find((e) => e.name === "docProps/core.xml");
  if (core) {
    const xml = zip.read(buf, core).toString("utf8");
    const pick = (tag, label) => {
      const m = xml.match(new RegExp("<" + tag + "[^>]*>([^<]*)<"));
      if (m && m[1]) meta[label] = m[1];
    };
    pick("dc:title", "Title");
    pick("dc:creator", "Author");
    pick("cp:lastModifiedBy", "Last modified by");
    pick("dcterms:modified", "Modified");
  }
  const app = list.find((e) => e.name === "docProps/app.xml");
  if (app) {
    const xml = zip.read(buf, app).toString("utf8");
    for (const [tag, label] of [["Pages", "Pages"], ["Words", "Words"], ["Slides", "Slides"], ["Application", "Application"]]) {
      const m = xml.match(new RegExp("<" + tag + ">([^<]*)<"));
      if (m) meta[label] = isNaN(+m[1]) ? m[1] : +m[1];
    }
  }
  let text = "";
  const parts = list.filter((e) => {
    if (ext === "docx") return /^word\/document\.xml$/.test(e.name);
    if (ext === "xlsx") return /^xl\/sharedStrings\.xml$/.test(e.name);
    if (ext === "pptx") return /^ppt\/slides\/slide\d+\.xml$/.test(e.name);
    return false;
  });
  for (const p of parts) text += stripXml(zip.read(buf, p).toString("utf8")) + "\n";
  if (ext === "xlsx") {
    const sheets = list.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).length;
    meta.Sheets = sheets;
    const wb = list.find((e) => e.name === "xl/workbook.xml");
    if (wb) {
      const names = [...zip.read(buf, wb).toString("utf8").matchAll(/<sheet\s[^>]*name="([^"]+)"/g)].map((m) => m[1]);
      if (names.length) meta["Sheet names"] = names;
    }
  }
  return { image, meta, text: text.slice(0, 200000) };
}

module.exports = { f3d, fcstd, threeMf, office };

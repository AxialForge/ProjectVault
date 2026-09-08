// Photos: EXIF via exifr, thumbnail via Electron's nativeImage (PNG/JPEG/GIF/
// BMP/WEBP). HEIC and TIFF get metadata only; their preview is the file icon.
const { nativeImage } = require("electron");
const exifr = require("exifr");

const NATIVE = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "ico"]);

async function extract(buf, ext) {
  const meta = {};
  try {
    const x = await exifr.parse(buf, {
      pick: ["Make", "Model", "LensModel", "DateTimeOriginal", "ExposureTime", "FNumber", "ISO", "FocalLength", "ImageWidth", "ImageHeight", "ExifImageWidth", "ExifImageHeight", "Orientation", "GPSLatitude", "GPSLongitude", "Software"],
    });
    if (x) {
      if (x.Make || x.Model) meta.Camera = [x.Make, x.Model].filter(Boolean).join(" ");
      if (x.LensModel) meta.Lens = x.LensModel;
      if (x.DateTimeOriginal) meta["Date taken"] = new Date(x.DateTimeOriginal).toISOString();
      if (x.ExposureTime) meta.Exposure = x.ExposureTime >= 1 ? `${x.ExposureTime}s` : `1/${Math.round(1 / x.ExposureTime)}s`;
      if (x.FNumber) meta.Aperture = `f/${x.FNumber}`;
      if (x.ISO) meta.ISO = x.ISO;
      if (x.FocalLength) meta["Focal length"] = `${x.FocalLength}mm`;
      if (x.Software) meta.Software = x.Software;
      const w = x.ExifImageWidth || x.ImageWidth, h = x.ExifImageHeight || x.ImageHeight;
      if (w && h) meta.Dimensions = `${w} × ${h}`;
      if (x.GPSLatitude && x.GPSLongitude) meta.GPS = `${x.GPSLatitude.toFixed(5)}, ${x.GPSLongitude.toFixed(5)}`;
    }
  } catch {
    /* no exif */
  }
  let image = null;
  if (NATIVE.has(ext)) {
    const img = nativeImage.createFromBuffer(buf);
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      if (!meta.Dimensions) meta.Dimensions = `${width} × ${height}`;
      const scale = Math.min(1, 512 / Math.max(width, height));
      image = (scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: "good" }) : img).toPNG();
    }
  }
  return { image, meta };
}

// Shrink any PNG/JPEG buffer (e.g. a CAD preview) to a cached thumbnail.
function toThumb(buf, max = 512) {
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const scale = Math.min(1, max / Math.max(width, height));
  return (scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: "good" }) : img).toPNG();
}

module.exports = { extract, toThumb, NATIVE };

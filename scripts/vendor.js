// Copy the renderer's third-party ES modules out of node_modules into
// src/renderer/vendor so the page can import them with plain relative URLs
// (the renderer has no Node access and no bundler).
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const nm = path.join(root, "node_modules");
const out = path.join(root, "src", "renderer", "vendor");

const files = [
  ["three/build/three.module.js", "three.module.js"],
  ["three/examples/jsm/controls/OrbitControls.js", "addons/controls/OrbitControls.js"],
  ["three/examples/jsm/loaders/STLLoader.js", "addons/loaders/STLLoader.js"],
  ["three/examples/jsm/loaders/OBJLoader.js", "addons/loaders/OBJLoader.js"],
  ["three/examples/jsm/libs/fflate.module.js", "addons/libs/fflate.module.js"],
  ["pdfjs-dist/build/pdf.mjs", "pdfjs/pdf.mjs"],
  ["pdfjs-dist/build/pdf.worker.mjs", "pdfjs/pdf.worker.mjs"],
];

for (const [src, dst] of files) {
  const s = path.join(nm, src);
  const d = path.join(out, dst);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  let text = fs.readFileSync(s, "utf8");
  // Bare "three" specifiers would need an import map, which is an inline
  // script the page CSP forbids; rewrite them to a relative path instead.
  if (dst.startsWith("addons/")) text = text.replace(/from\s+(["'])three\1/g, "from '../../three.module.js'");
  fs.writeFileSync(d, text);
  console.log("vendored", dst);
}

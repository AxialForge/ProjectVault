// Renderer-side preview work: interactive 3D viewer for meshes, plus the
// thumbnail/text jobs the main process can't do itself (WebGL render of a
// mesh, pdf.js first page + text, a video frame).
import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/addons/controls/OrbitControls.js";
import { STLLoader } from "./vendor/addons/loaders/STLLoader.js";
import { OBJLoader } from "./vendor/addons/loaders/OBJLoader.js";
import * as fflate from "./vendor/addons/libs/fflate.module.js";

const MESH_EXT = new Set(["stl", "obj", "3mf"]);
export const canView3D = (ext) => MESH_EXT.has(ext);

async function loadMesh(url, ext) {
  if (ext === "stl") {
    const geo = await new STLLoader().loadAsync(url);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, material());
  }
  if (ext === "obj") {
    const grp = await new OBJLoader().loadAsync(url);
    grp.traverse((o) => {
      if (o.isMesh) {
        o.material = material();
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      }
    });
    return grp;
  }
  if (ext === "3mf") return load3mf(url);
  throw new Error("unsupported mesh " + ext);
}

// 3MF reader that handles the Production Extension (objects split across
// 3D/Objects/*.model, as Bambu Studio and PrusaSlicer write) which three's
// stock 3MFLoader ignores. Transforms are 3MF's 12-number row-major 3x4.
async function load3mf(url) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const zip = fflate.unzipSync(buf);
  const dec = new TextDecoder();
  const parts = {};
  for (const name of Object.keys(zip)) if (/\.model$/i.test(name)) parts["/" + name.replace(/^\/+/, "")] = parse3mfModel(dec.decode(zip[name]));
  const mainName = Object.keys(parts).find((n) => /\/3D\/3dmodel\.model$/i.test(n)) || Object.keys(parts)[0];
  if (!mainName) throw new Error("no 3D model in 3MF");
  const root = new THREE.Group();
  const unitScale = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[parts[mainName].unit] || 1;
  const place = (partName, objectId, matrix, depth) => {
    const part = parts[partName];
    const obj = part?.objects[objectId];
    if (!obj || depth > 16) return;
    if (obj.geometry) {
      const m = new THREE.Mesh(obj.geometry, material());
      m.applyMatrix4(matrix);
      root.add(m);
    }
    for (const c of obj.components) place(c.path || partName, c.objectid, matrix.clone().multiply(c.matrix), depth + 1);
  };
  const main = parts[mainName];
  const items = main.build.length ? main.build : Object.keys(main.objects).map((id) => ({ objectid: id, matrix: new THREE.Matrix4() }));
  for (const it of items) place(it.path || mainName, it.objectid, it.matrix, 0);
  if (!root.children.length) throw new Error("3MF contains no mesh data");
  root.scale.setScalar(unitScale);
  return root;
}

function matrix3mf(s) {
  const m = new THREE.Matrix4();
  if (!s) return m;
  const v = s.trim().split(/\s+/).map(Number);
  if (v.length !== 12) return m;
  // 3MF: [m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz], row vectors
  m.set(v[0], v[3], v[6], v[9], v[1], v[4], v[7], v[10], v[2], v[5], v[8], v[11], 0, 0, 0, 1);
  return m;
}

function parse3mfModel(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const unit = doc.documentElement.getAttribute("unit") || "millimeter";
  const objects = {};
  for (const o of doc.getElementsByTagName("object")) {
    const id = o.getAttribute("id");
    const entry = { geometry: null, components: [] };
    const mesh = o.getElementsByTagName("mesh")[0];
    if (mesh) {
      const vs = mesh.getElementsByTagName("vertex");
      const pos = new Float32Array(vs.length * 3);
      for (let i = 0; i < vs.length; i++) {
        pos[i * 3] = +vs[i].getAttribute("x");
        pos[i * 3 + 1] = +vs[i].getAttribute("y");
        pos[i * 3 + 2] = +vs[i].getAttribute("z");
      }
      const ts = mesh.getElementsByTagName("triangle");
      const idx = new Uint32Array(ts.length * 3);
      for (let i = 0; i < ts.length; i++) {
        idx[i * 3] = +ts[i].getAttribute("v1");
        idx[i * 3 + 1] = +ts[i].getAttribute("v2");
        idx[i * 3 + 2] = +ts[i].getAttribute("v3");
      }
      if (vs.length && ts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.computeVertexNormals();
        entry.geometry = g;
      }
    }
    for (const c of o.getElementsByTagName("component")) {
      const path = c.getAttribute("p:path") || c.getAttributeNS("*", "path") || [...c.attributes].find((a) => a.localName === "path")?.value || null;
      entry.components.push({ path, objectid: c.getAttribute("objectid"), matrix: matrix3mf(c.getAttribute("transform")) });
    }
    objects[id] = entry;
  }
  const build = [];
  for (const it of doc.getElementsByTagName("item")) {
    const path = [...it.attributes].find((a) => a.localName === "path")?.value || null;
    build.push({ objectid: it.getAttribute("objectid"), path, matrix: matrix3mf(it.getAttribute("transform")) });
  }
  return { unit, objects, build };
}

function material(color) {
  return new THREE.MeshStandardMaterial({ color: color || 0x8fa3ff, metalness: 0.1, roughness: 0.55, side: THREE.DoubleSide });
}

function buildScene(object, dark) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(dark ? 0x1c222e : 0xeef1f6);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  // CAD is Z-up; three is Y-up.
  const pivot = new THREE.Group();
  pivot.rotation.x = -Math.PI / 2;
  pivot.add(object);
  scene.add(pivot);
  const radius = Math.max(size.x, size.y, size.z, 1e-3);
  const camera = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 100);
  camera.position.set(radius * 1.4, radius * 1.1, radius * 1.6);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(radius * 2, radius * 3, radius * 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x99aaff, 0.5);
  fill.position.set(-radius * 2, radius, -radius);
  scene.add(fill);
  const grid = new THREE.GridHelper(radius * 3, 12, 0x556, 0x334);
  grid.position.y = -size.z / 2;
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);
  return { scene, camera, radius };
}

// Interactive viewer inside `container`. Returns a dispose() function.
export async function mount(container, url, ext, dark) {
  const object = await loadMesh(url, ext);
  const { scene, camera } = buildScene(object, dark);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.innerHTML = "";
  container.appendChild(renderer.domElement);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  let alive = true;
  const resize = () => {
    const w = container.clientWidth || 300, h = container.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  const loop = () => {
    if (!alive) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();
  return () => {
    alive = false;
    ro.disconnect();
    controls.dispose();
    renderer.dispose();
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  };
}

// Offscreen thumbnail render -> PNG bytes.
export async function renderThumb(url, ext, size = 512) {
  const object = await loadMesh(url, ext);
  const { scene, camera } = buildScene(object, true);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size, false);
  renderer.render(scene, camera);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  renderer.dispose();
  return new Uint8Array(await blob.arrayBuffer());
}

// ── PDF ────────────────────────────────────────────────────────
let pdfjs = null;
async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("./vendor/pdfjs/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.mjs", import.meta.url).toString();
  }
  return pdfjs;
}

export async function pdfThumbAndText(url, size = 512, maxPages = 40) {
  const lib = await getPdfjs();
  const doc = await lib.getDocument({ url }).promise;
  const page = await doc.getPage(1);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = size / Math.max(vp0.width, vp0.height);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  let text = "";
  const n = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    text += tc.items.map((it) => it.str).join(" ") + "\n";
  }
  const info = (await doc.getMetadata().catch(() => null))?.info || {};
  const meta = { Pages: doc.numPages };
  if (info.Title) meta.Title = info.Title;
  if (info.Author) meta.Author = info.Author;
  if (info.Producer) meta.Producer = info.Producer;
  if (info.CreationDate) meta.Created = String(info.CreationDate);
  await doc.destroy();
  return { image: new Uint8Array(await blob.arrayBuffer()), text: text.slice(0, 200000), meta };
}

export async function renderPdfPage(canvas, url, pageNo, width) {
  const lib = await getPdfjs();
  const doc = await lib.getDocument({ url }).promise;
  const page = await doc.getPage(pageNo);
  const vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / vp0.width });
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  const pages = doc.numPages;
  await doc.destroy();
  return pages;
}

// ── Video frame ────────────────────────────────────────────────
export function videoThumb(url, size = 512) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = url;
    const fail = () => reject(new Error("video decode failed"));
    v.onerror = fail;
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
    };
    v.onseeked = async () => {
      const scale = Math.min(1, size / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, "image/png"));
      const d = v.duration;
      const meta = { Duration: `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, "0")}`, Dimensions: `${v.videoWidth} × ${v.videoHeight}` };
      v.src = "";
      resolve({ image: new Uint8Array(await blob.arrayBuffer()), meta });
    };
    setTimeout(fail, 20000);
  });
}

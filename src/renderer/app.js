import * as viewer from "./viewer.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtBytes = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB");
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const extOf = (n) => ((/\.([^.]+)$/.exec(n) || [])[1] || "").toLowerCase();
const thumbUrl = (t) => "lib://thumb/" + encodeURIComponent(t);
const fileUrl = (rel) => "lib://file/" + encodeURIComponent(rel);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const STATUS = {
  idea: ["Idea", "#8791a6"],
  planning: ["Planning", "#7c8cff"],
  "in-progress": ["In progress", "#2fd6c8"],
  "on-hold": ["On hold", "#ffd166"],
  done: ["Done", "#4ade80"],
  archived: ["Archived", "#5b6478"],
};
const KIND_LABEL = { "cad-part": ["PART", "CAD part"], "cad-assembly": ["ASM", "CAD assembly"], drawing: ["DRW", "Drawing"], exchange: ["STEP", "Exchange (STEP/IGES)"], mesh: ["MESH", "Mesh"], ecad: ["PCB", "Electronics"], gcode: ["GCODE", "G-code"], photo: ["IMG", "Photo"], video: ["VID", "Video"], doc: ["DOC", "Document"], archive: ["ZIP", "Archive"], other: ["FILE", "Other"] };

const S = {
  settings: {},
  info: null,
  projects: [],
  projectId: null,
  project: null,
  items: [],
  itemId: null,
  tab: "files",
  view: "grid",
  sort: "name",
  kindFilter: "",
  fieldDefs: [],
  collapsed: new Set(),
  dispose3d: null,
};

// ── toasts / progress / modals ─────────────────────────────────
function toast(msg, cls = "") {
  const el = document.createElement("div");
  el.className = "toast " + cls;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), cls === "err" ? 7000 : 3500);
}
function progress(p) {
  const box = $("#progress");
  if (!p) return box.classList.add("hidden");
  box.classList.remove("hidden");
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  $("#progress-fill").style.width = pct + "%";
  $("#progress-label").textContent = `${p.label || "Working"} ${p.done ?? ""}${p.total ? "/" + p.total : ""} ${p.current ? "· " + p.current : ""}`;
}
function modal(html, { wide = false } = {}) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal ${wide ? "wide" : ""}">${html}</div>`;
  root.classList.remove("hidden");
  const close = () => { root.classList.add("hidden"); root.innerHTML = ""; };
  root.onclick = (e) => { if (e.target === root) close(); };
  $$("[data-close]", root).forEach((b) => (b.onclick = close));
  const first = $("input, textarea, select", root);
  if (first) setTimeout(() => first.focus(), 30);
  return { root, close, el: $(".modal", root) };
}
function confirmReason(title, what) {
  return new Promise((resolve) => {
    const m = modal(`<h2>${esc(title)}</h2><p class="muted">${esc(what)}<br>The file goes to the library's trash folder now and is moved to <b>_Deleted</b> on the NAS at the next backup. Nothing is destroyed. The reason is recorded in the history and in the NAS deletion log.</p>
      <div class="field"><label>Reason (required)</label><textarea id="reason" placeholder="e.g. superseded by v3, wrong tolerance, duplicate export…"></textarea></div>
      <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn danger" id="ok">Delete</button></div>`);
    $("#ok", m.el).onclick = () => {
      const r = $("#reason", m.el).value.trim();
      if (!r) return $("#reason", m.el).focus();
      m.close();
      resolve(r);
    };
    m.root.addEventListener("click", (e) => { if (e.target === m.root) resolve(null); });
    $("[data-close]", m.el).addEventListener("click", () => resolve(null));
  });
}

// ── navigation ─────────────────────────────────────────────────
function showPage(name) {
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + name));
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.nav === name));
  $("#top-actions").innerHTML = "";
  if (name !== "project") {
    S.projectId = null;
    renderTree();
  }
}

async function goHome() {
  showPage("home");
  $("#title").textContent = "Home";
  selectItem(null);
  if (!S.info?.open) return;
  const st = await api.stats();
  const total = Object.values(st.byStatus).reduce((a, b) => a + b, 0) || 1;
  const bar = Object.entries(STATUS).map(([k, [label, color]]) => `<div style="width:${((st.byStatus[k] || 0) / total) * 100}%;background:${color}" title="${label}: ${st.byStatus[k] || 0}"></div>`).join("");
  const legend = Object.entries(STATUS).map(([k, [label, color]]) => `<span><span class="dot" style="background:${color}"></span>${label} ${st.byStatus[k] || 0}</span>`).join("");
  const kinds = Object.entries(st.byKind).map(([k, n]) => `<span class="pill"><span class="kind">${KIND_LABEL[k]?.[0] || k}</span>${n}</span>`).join(" ");
  const recent = st.recent.map((it) => `<div class="card" data-open="${it.project_id}:${it.id}">
      <div class="thumb">${it.thumb ? `<img src="${thumbUrl(it.thumb)}" loading="lazy">` : kindBadge(it.kind)}</div>
      <div class="body"><div class="nm" title="${esc(it.name)}">${esc(it.name)}</div><div class="sub">${esc(it.project_name)} · ${fmtDate(it.updated)}</div></div></div>`).join("");
  const hist = (await api.history(null, 25)).map(histRow).join("");
  $("#page-home").innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="v">${st.projects}</div><div class="k">projects</div></div>
      <div class="tile"><div class="v">${st.items}</div><div class="k">files</div></div>
      <div class="tile"><div class="v">${st.versions}</div><div class="k">versions</div></div>
      <div class="tile"><div class="v">${fmtBytes(st.bytes)}</div><div class="k">in library</div></div>
      <div class="tile"><div class="v small" style="font-size:14px;margin-top:6px">${S.settings.lastBackup ? fmtDate(S.settings.lastBackup) : "never"}</div><div class="k">last NAS backup</div></div>
    </div>
    <h3>Projects by status</h3><div class="status-bar">${bar}</div><div class="legend">${legend}</div>
    <h3>File types</h3><div class="tags">${kinds || '<span class="dim">none yet</span>'}</div>
    <h3>Recently updated</h3><div class="grid">${recent || '<div class="empty">Nothing yet. Create a project and drop some files in.</div>'}</div>
    <h3>Recent activity</h3><div class="hist">${hist}</div>`;
  $$("[data-open]", $("#page-home")).forEach((c) => (c.onclick = () => { const [p, i] = c.dataset.open.split(":"); openProject(+p, +i); }));
}

function histRow(h) {
  return `<div class="ev"><span class="ts">${fmtDate(h.ts)}</span><span class="ac">${esc(h.action)}</span><span>${h.project_name ? "<b>" + esc(h.project_name) + "</b> · " : ""}${esc(h.detail)}</span></div>`;
}

function kindBadge(kind) {
  return `<div class="kind-badge k-${kind}">${KIND_LABEL[kind]?.[0] || "FILE"}</div>`;
}

// ── sidebar tree ───────────────────────────────────────────────
async function loadProjects() {
  S.projects = await api.listProjects();
  renderTree();
}
function renderTree() {
  const groups = {};
  for (const p of S.projects) (groups[p.category || ""] ||= []).push(p);
  const keys = Object.keys(groups).sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  $("#tree").innerHTML = keys.map((cat) => `<div class="tree-group ${S.collapsed.has(cat) ? "collapsed" : ""}" data-cat="${esc(cat)}">
      ${cat ? `<div class="tree-group-head"><span class="car">▼</span>${esc(cat)}</div>` : ""}
      <div class="tree-items">${groups[cat].map((p) => `<div class="tree-item ${p.id === S.projectId ? "active" : ""}" data-id="${p.id}" title="${esc(p.name)}">
        <span class="dot" style="background:${STATUS[p.status]?.[1] || "#888"}"></span><span class="nm">${esc(p.name)}</span><span class="cnt">${p.item_count}</span></div>`).join("")}</div></div>`).join("") || '<div class="empty small">No projects yet</div>';
  $$(".tree-group-head").forEach((h) => (h.onclick = () => { const c = h.parentElement.dataset.cat; S.collapsed.has(c) ? S.collapsed.delete(c) : S.collapsed.add(c); h.parentElement.classList.toggle("collapsed"); }));
  $$(".tree-item").forEach((el) => {
    el.onclick = () => openProject(+el.dataset.id);
    el.ondragover = (e) => { e.preventDefault(); el.classList.add("drop-target"); };
    el.ondragleave = () => el.classList.remove("drop-target");
    el.ondrop = (e) => { e.preventDefault(); el.classList.remove("drop-target"); dropFiles(e, +el.dataset.id); };
  });
}

// ── project page ───────────────────────────────────────────────
async function openProject(id, itemId = null) {
  S.projectId = id;
  S.project = await api.getProject(id);
  if (!S.project) return goHome();
  showPage("project");
  S.projectId = id;
  renderTree();
  $("#title").textContent = S.project.name;
  $("#top-actions").innerHTML = `<button class="btn small" id="btn-open-folder">Open folder</button><button class="btn small danger" id="btn-del-project">Delete project</button>`;
  $("#btn-open-folder").onclick = () => api.openPath(S.project.folder);
  $("#btn-del-project").onclick = async () => {
    const r = await confirmReason("Delete project", `Delete "${S.project.name}" and all ${S.items.length} files in it?`);
    if (!r) return;
    await api.deleteProject(S.project.id, r);
    toast("Project moved to trash");
    await loadProjects();
    goHome();
  };
  renderProjectHead();
  await loadItems();
  setTab(S.tab);
  if (itemId) selectItem(itemId);
  else selectItem(null);
}

function renderProjectHead() {
  const p = S.project;
  $("#proj-head").innerHTML = `
    <div class="col">
      <input class="name" id="p-name" value="${esc(p.name)}" />
      <textarea class="desc" id="p-desc" rows="1" placeholder="One-line description…">${esc(p.description)}</textarea>
      <div class="tags" id="p-tags"></div>
    </div>
    <div class="col" style="align-items:flex-end">
      <div class="meta">
        <span class="dim small">Category</span><input type="text" id="p-cat" value="${esc(p.category)}" style="width:150px" placeholder="(none)" />
        <select id="p-status">${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      <div class="progress-wrap"><span class="dim small">Progress</span><input type="range" id="p-progress" min="0" max="100" value="${p.progress}" /><b id="p-progress-v">${p.progress}%</b></div>
      <div class="dim small">Created ${fmtDate(p.created)} · Updated ${fmtDate(p.updated)}</div>
    </div>`;
  const save = debounce(async (patch) => { S.project = await api.updateProject(p.id, patch); $("#title").textContent = S.project.name; loadProjects(); }, 400);
  $("#p-name").oninput = (e) => save({ name: e.target.value });
  $("#p-desc").oninput = (e) => save({ description: e.target.value });
  $("#p-cat").onchange = (e) => save({ category: e.target.value });
  $("#p-status").onchange = (e) => save({ status: e.target.value });
  $("#p-progress").oninput = (e) => { $("#p-progress-v").textContent = e.target.value + "%"; save({ progress: +e.target.value }); };
  tagEditor($("#p-tags"), p.tags, (tags) => save({ tags }));
  $("#proj-notes").value = p.notes;
  $("#proj-notes").oninput = debounce(() => api.updateProject(p.id, { notes: $("#proj-notes").value }), 500);
}

function tagEditor(el, tags, onChange) {
  const render = () => {
    el.innerHTML = tags.map((t, i) => `<span class="tag">${esc(t)}<button data-i="${i}" title="Remove">×</button></span>`).join("") + `<input type="text" placeholder="+ tag" />`;
    $$("button", el).forEach((b) => (b.onclick = () => { tags.splice(+b.dataset.i, 1); onChange([...tags]); render(); }));
    const inp = $("input", el);
    inp.onkeydown = (e) => {
      if ((e.key === "Enter" || e.key === ",") && inp.value.trim()) {
        e.preventDefault();
        const v = inp.value.trim().replace(/,$/, "");
        if (v && !tags.includes(v)) { tags.push(v); onChange([...tags]); }
        render();
        $("input", el).focus();
      } else if (e.key === "Backspace" && !inp.value && tags.length) { tags.pop(); onChange([...tags]); render(); $("input", el).focus(); }
    };
  };
  render();
}

function setTab(name) {
  S.tab = name;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tab-body").forEach((b) => b.classList.toggle("hidden", b.id !== "tab-" + name));
  if (name === "fields") renderProjectFields();
  if (name === "history") renderHistory();
}

async function renderHistory() {
  const rows = await api.history(S.projectId, 300);
  $("#tab-history").innerHTML = `<div class="hist">${rows.map(histRow).join("") || '<div class="empty">No history yet</div>'}</div>`;
}

// ── custom fields ──────────────────────────────────────────────
function fieldInput(def, value) {
  const v = value ?? "";
  switch (def.type) {
    case "number": return `<input type="number" data-f="${def.id}" value="${esc(v)}" />`;
    case "date": return `<input type="date" data-f="${def.id}" value="${esc(v)}" />`;
    case "checkbox": return `<input type="checkbox" data-f="${def.id}" ${v ? "checked" : ""} />`;
    case "dropdown": return `<select data-f="${def.id}"><option value="">—</option>${(def.options || []).map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    case "project": return `<select data-f="${def.id}"><option value="">—</option>${S.projects.map((p) => `<option value="${p.id}" ${String(v) === String(p.id) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`;
    case "link": return `<input type="text" data-f="${def.id}" value="${esc(v)}" placeholder="https://…" />`;
    case "multiline": return `<textarea data-f="${def.id}" rows="2">${esc(v)}</textarea>`;
    default: return `<input type="text" data-f="${def.id}" value="${esc(v)}" />`;
  }
}
function bindFields(container, defs, values, onChange) {
  $$("[data-f]", container).forEach((inp) => {
    const def = defs.find((d) => String(d.id) === inp.dataset.f);
    const handler = () => { values[def.name] = def.type === "checkbox" ? inp.checked : inp.value; onChange({ ...values }); };
    inp.addEventListener(def.type === "text" || def.type === "multiline" || def.type === "link" || def.type === "number" ? "input" : "change", debounce(handler, 300));
  });
}
function renderProjectFields() {
  const defs = S.fieldDefs.filter((d) => d.scope === "project");
  const values = { ...S.project.fields };
  $("#tab-fields").innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted small">Custom fields apply to every project. Values are saved as you type.</span><span class="spacer"></span><button class="btn small" id="btn-manage-fields">Manage fields…</button></div>
    ${defs.length ? defs.map((d) => `<div class="field-row"><label>${esc(d.name)}</label>${fieldInput(d, values[d.name])}</div>`).join("") : '<div class="empty">No project fields yet. Click <b>Manage fields</b> to add some (cost, material, vendor, deadline…).</div>'}`;
  bindFields($("#tab-fields"), defs, values, (f) => api.updateProject(S.project.id, { fields: f }).then((p) => (S.project = p)));
  $("#btn-manage-fields").onclick = manageFields;
}
async function manageFields() {
  const TYPES = ["text", "multiline", "number", "date", "checkbox", "dropdown", "link", "project"];
  const render = () => {
    const rows = (scope) => S.fieldDefs.filter((d) => d.scope === scope).map((d) => `<div class="def" data-id="${d.id}">
        <input type="text" value="${esc(d.name)}" data-k="name" />
        <select data-k="type">${TYPES.map((t) => `<option ${d.type === t ? "selected" : ""}>${t}</option>`).join("")}</select>
        <input type="text" value="${esc((d.options || []).join(", "))}" data-k="options" placeholder="dropdown options, comma separated" ${d.type === "dropdown" ? "" : "disabled"} />
        <button class="icon-btn" data-del title="Remove field">✕</button></div>`).join("");
    return `<h2>Custom fields</h2>
      <h3>Project fields</h3><div class="deflist" id="defs-project">${rows("project")}</div><button class="btn small" data-add="project">＋ Add project field</button>
      <h3>File fields</h3><div class="deflist" id="defs-item">${rows("item")}</div><button class="btn small" data-add="item">＋ Add file field</button>
      <p class="dim small">Types: text, multiline, number, date, checkbox, dropdown (comma-separated options), link (URL), project (link to another project). Removing a field hides its values; they aren't erased.</p>
      <div class="foot"><button class="btn primary" data-close>Done</button></div>`;
  };
  const m = modal(render(), { wide: true });
  const wire = () => {
    $$("[data-add]", m.el).forEach((b) => (b.onclick = async () => { await api.saveFieldDef({ scope: b.dataset.add, name: "New field", type: "text", sort: S.fieldDefs.length }); S.fieldDefs = await api.fieldDefs(); m.el.innerHTML = render(); wire(); }));
    $$(".def", m.el).forEach((row) => {
      const id = +row.dataset.id;
      const save = debounce(async () => {
        const d = S.fieldDefs.find((x) => x.id === id);
        d.name = $("[data-k=name]", row).value.trim() || d.name;
        d.type = $("[data-k=type]", row).value;
        d.options = $("[data-k=options]", row).value.split(",").map((s) => s.trim()).filter(Boolean);
        $("[data-k=options]", row).disabled = d.type !== "dropdown";
        await api.saveFieldDef(d);
      }, 300);
      $$("input, select", row).forEach((i) => i.addEventListener("input", save));
      $("[data-del]", row).onclick = async () => { await api.deleteFieldDef(id); S.fieldDefs = await api.fieldDefs(); m.el.innerHTML = render(); wire(); };
    });
    $$("[data-close]", m.el).forEach((b) => (b.onclick = () => { m.close(); if (S.tab === "fields") renderProjectFields(); if (S.itemId) renderInspector(); }));
  };
  wire();
}

// ── items ──────────────────────────────────────────────────────
async function loadItems() {
  S.items = await api.listItems(S.projectId);
  const kinds = [...new Set(S.items.map((i) => i.kind))].sort();
  const kf = $("#kind-filter");
  kf.innerHTML = `<option value="">All types</option>` + kinds.map((k) => `<option value="${k}" ${S.kindFilter === k ? "selected" : ""}>${KIND_LABEL[k]?.[1] || k}</option>`).join("");
  renderItems();
  runPending();
}
function visibleItems() {
  let list = S.items.filter((i) => !S.kindFilter || i.kind === S.kindFilter);
  const size = (i) => i.versions[0]?.size || 0;
  const sorters = { name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }), updated: (a, b) => b.updated.localeCompare(a.updated), kind: (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name), size: (a, b) => size(b) - size(a) };
  return list.sort(sorters[S.sort] || sorters.name);
}
function renderItems() {
  const list = visibleItems();
  const grid = $("#items");
  grid.className = "grid " + (S.view === "list" ? "list" : "");
  $("#items-empty").classList.toggle("hidden", S.items.length > 0);
  $("#file-count").textContent = `${list.length} of ${S.items.length} files`;
  grid.innerHTML = list.map((it) => {
    const v = it.versions[0];
    const missing = Array.isArray(v?.meta?.["Missing components"]) && v.meta["Missing components"].length;
    return `<div class="card ${it.id === S.itemId ? "active" : ""}" data-id="${it.id}" draggable="false">
      <div class="thumb">${v?.thumb ? `<img src="${thumbUrl(v.thumb)}?${encodeURIComponent(v.added)}" loading="lazy">` : kindBadge(it.kind)}
        ${it.versions.length > 1 ? `<span class="ver">v${v.version_no}</span>` : ""}${missing ? `<span class="warn" title="Missing referenced components">⚠</span>` : ""}</div>
      <div class="body"><div class="nm" title="${esc(it.name)}">${esc(it.name)}</div>
        <div class="sub"><span class="kind">${KIND_LABEL[it.kind]?.[0] || "FILE"}</span><span>${v ? fmtBytes(v.size) : ""}</span>${S.view === "list" ? `<span>${fmtDate(it.updated)}</span><span>${it.versions.length} version${it.versions.length === 1 ? "" : "s"}</span>` : ""}</div></div></div>`;
  }).join("");
  $$(".card", grid).forEach((c) => {
    c.onclick = () => selectItem(+c.dataset.id);
    c.ondblclick = () => { const it = S.items.find((i) => i.id === +c.dataset.id); if (it?.versions[0]) api.openPath(it.versions[0].relpath); };
  });
}

// ── inspector ──────────────────────────────────────────────────
function selectItem(id) {
  S.itemId = id;
  $$("#items .card").forEach((c) => c.classList.toggle("active", +c.dataset.id === id));
  renderInspector();
}
function metaRows(meta, depth = 0) {
  return Object.entries(meta || {}).map(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v)) return `<details ${depth === 0 ? "" : "open"}><summary>${esc(k)} (${Object.keys(v).length})</summary><div class="kv nested">${metaRows(v, depth + 1)}</div></details>`;
    if (Array.isArray(v)) v = v.length > 12 ? v.slice(0, 12).join(", ") + ` … (+${v.length - 12})` : v.join(", ");
    if (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v)) v = fmtDate(v);
    if (typeof v === "boolean") v = v ? "yes" : "no";
    return `<div class="k" title="${esc(k)}">${esc(k)}</div><div class="v ${/\d/.test(String(v)) && String(v).length < 24 ? "mono" : ""}">${esc(v)}</div>`;
  }).join("");
}
async function renderInspector() {
  if (S.dispose3d) { S.dispose3d(); S.dispose3d = null; }
  const box = $("#inspector");
  const it = S.items.find((i) => i.id === S.itemId);
  if (!it) { box.innerHTML = `<div class="empty">Select a file to see its preview, details and versions.</div>`; return; }
  const v = it.versions[0];
  const ext = extOf(v.filename);
  const defs = S.fieldDefs.filter((d) => d.scope === "item");
  const missing = Array.isArray(v.meta?.["Missing components"]) ? v.meta["Missing components"] : [];
  box.innerHTML = `
    <div class="preview" id="preview">${v.thumb ? `<img src="${thumbUrl(v.thumb)}?${encodeURIComponent(v.added)}">` : kindBadge(it.kind)}</div>
    <input class="insp-name" id="i-name" value="${esc(it.name)}" />
    <div class="row small muted"><span class="kind">${KIND_LABEL[it.kind]?.[0]}</span><select id="i-kind" style="width:auto;padding:3px 24px 3px 8px;font-size:12px">${Object.entries(KIND_LABEL).map(([k, [, l]]) => `<option value="${k}" ${it.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select><span class="spacer"></span><span>${fmtBytes(v.size)}</span></div>
    <div class="actions">
      <button class="btn small" id="i-open">Open</button>
      <button class="btn small" id="i-reveal">Show in Explorer</button>
      <button class="btn small" id="i-addver">＋ New version</button>
      <button class="btn small ghost" id="i-reextract" title="Re-read the file's metadata and preview">↻</button>
      <span class="spacer"></span>
      <button class="btn small danger" id="i-delete">Delete</button>
    </div>
    ${missing.length ? `<div class="warnbox">⚠ Assembly references ${missing.length} component${missing.length === 1 ? "" : "s"} not found in its folder: ${esc(missing.slice(0, 6).join(", "))}${missing.length > 6 ? "…" : ""}</div>` : ""}
    <h3>Tags</h3><div class="tags" id="i-tags"></div>
    ${defs.length ? `<h3>Fields</h3>${defs.map((d) => `<div class="field-row"><label>${esc(d.name)}</label>${fieldInput(d, it.fields[d.name])}</div>`).join("")}` : ""}
    <h3>Notes</h3><textarea id="i-notes" rows="3" placeholder="Notes about this file…">${esc(it.notes)}</textarea>
    <h3>Extracted data <span class="dim">(read-only)</span></h3>
    <div class="kv">
      <div class="k">File</div><div class="v mono">${esc(v.filename)}</div>
      <div class="k">Modified</div><div class="v">${fmtDate(v.mtime)}</div>
      <div class="k">Added</div><div class="v">${fmtDate(v.added)}</div>
      <div class="k">SHA-1</div><div class="v mono" title="${v.hash}">${v.hash.slice(0, 12)}…</div>
      ${metaRows(v.meta)}
    </div>
    <h3>Versions (${it.versions.length})</h3>
    <div id="i-versions">${it.versions.map((x) => `<div class="version ${x.id === v.id ? "latest" : ""}" data-id="${x.id}">
        <div class="hd"><span class="vn">v${x.version_no}</span><span class="fn" title="${esc(x.relpath)}">${esc(x.filename)}</span><span class="dim small">${fmtBytes(x.size)}</span></div>
        <div class="dim small">${fmtDate(x.added)}</div>
        <input class="note" placeholder="What changed in this version?" value="${esc(x.note)}" />
        <div class="mini"><button data-act="open">Open</button><button data-act="reveal">Explorer</button>${x.thumb ? `<button data-act="thumb">Preview</button>` : ""}<span class="spacer"></span><button data-act="del" style="color:var(--danger)">Delete</button></div>
      </div>`).join("")}</div>`;

  // preview
  const prev = $("#preview");
  const dark = S.settings.theme !== "light";
  const url = fileUrl(v.relpath);
  if (it.kind === "photo" && ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) prev.innerHTML = `<img src="${url}">`;
  else if (it.kind === "video" && ["mp4", "webm", "mov", "m4v"].includes(ext)) prev.innerHTML = `<video src="${url}" controls preload="metadata"></video>`;
  else if (viewer.canView3D(ext)) {
    prev.innerHTML = `<div class="viewer"></div><span class="hint">drag to orbit · wheel to zoom</span>`;
    viewer.mount($(".viewer", prev), url, ext, dark).then((d) => (S.dispose3d = d)).catch((e) => { console.error("3D preview failed", e); prev.innerHTML = v.thumb ? `<img src="${thumbUrl(v.thumb)}">` : kindBadge(it.kind); toast("3D preview failed: " + e.message, "err"); });
  } else if (ext === "pdf") {
    prev.innerHTML = `<canvas></canvas><span class="hint">page 1</span>`;
    viewer.renderPdfPage($("canvas", prev), url, 1, 700).catch(() => {});
  }
  prev.ondblclick = () => api.openPath(v.relpath);

  // bindings
  const saveItem = debounce(async (patch) => { const upd = await api.updateItem(it.id, patch); Object.assign(it, upd, { versions: it.versions }); renderItems(); }, 300);
  $("#i-name").oninput = (e) => saveItem({ name: e.target.value });
  $("#i-kind").onchange = (e) => { saveItem({ kind: e.target.value }); };
  $("#i-notes").oninput = (e) => saveItem({ notes: e.target.value });
  tagEditor($("#i-tags"), it.tags, (tags) => saveItem({ tags }));
  bindFields(box, defs, { ...it.fields }, (f) => saveItem({ fields: f }));
  $("#i-open").onclick = () => api.openPath(v.relpath).then((err) => err && toast(err, "err"));
  $("#i-reveal").onclick = () => api.revealPath(v.relpath);
  $("#i-addver").onclick = async () => {
    const files = await api.pickFiles({ title: "Choose the new version of " + it.name });
    if (!files.length) return;
    await addVersion(it.id, files[0]);
  };
  $("#i-reextract").onclick = async () => { await api.reextract(v.id); await loadItems(); renderInspector(); toast("Re-read " + v.filename); };
  $("#i-delete").onclick = async () => {
    const r = await confirmReason("Delete file", `Delete "${it.name}" and all ${it.versions.length} version${it.versions.length === 1 ? "" : "s"}?`);
    if (!r) return;
    await api.deleteItem(it.id, r);
    S.itemId = null;
    await loadItems();
    renderInspector();
    loadProjects();
  };
  $$(".version", box).forEach((row) => {
    const x = it.versions.find((y) => y.id === +row.dataset.id);
    $(".note", row).onchange = (e) => api.updateVersionNote(x.id, e.target.value);
    $$("[data-act]", row).forEach((b) => (b.onclick = async () => {
      if (b.dataset.act === "open") api.openPath(x.relpath);
      if (b.dataset.act === "reveal") api.revealPath(x.relpath);
      if (b.dataset.act === "thumb") prev.innerHTML = `<img src="${thumbUrl(x.thumb)}">`;
      if (b.dataset.act === "del") {
        const r = await confirmReason("Delete version", `Delete v${x.version_no} of "${it.name}" (${x.filename})?`);
        if (!r) return;
        await api.deleteVersion(x.id, r);
        await loadItems();
        if (!S.items.find((i) => i.id === it.id)) S.itemId = null;
        renderInspector();
      }
    }));
  });
}

// ── adding files ───────────────────────────────────────────────
async function addPaths(projectId, paths) {
  if (!paths.length) return;
  const r = await api.addFiles(projectId, paths);
  progress(null);
  for (const e of r.errors) toast(e, "err");
  if (r.items.length) toast(`Added ${r.items.length} file${r.items.length === 1 ? "" : "s"}`, "ok");
  if (projectId === S.projectId) await loadItems();
  else if (S.projectId === null && $("#page-home").classList.contains("active")) goHome();
  loadProjects();
  runPending();
}
async function addVersion(itemId, filePath) {
  const it = await api.addVersion(itemId, filePath, "");
  toast(`Added v${it.versions[0].version_no} of ${it.name}`, "ok");
  await loadItems();
  selectItem(itemId);
  runPending();
}
function dropFiles(e, projectId) {
  const paths = [...e.dataTransfer.files].map((f) => api.pathFor(f)).filter(Boolean);
  if (!paths.length) return;
  // Dropping a single file onto the selected item = new version of it.
  if (projectId === S.projectId && S.itemId && paths.length === 1 && e.target.closest?.(".card")?.dataset.id === String(S.itemId)) return addVersion(S.itemId, paths[0]);
  addPaths(projectId, paths);
}

// Renderer-side extraction queue (WebGL mesh renders, pdf.js, video frames).
let pendingBusy = false;
async function runPending() {
  if (pendingBusy || !S.info?.open) return;
  pendingBusy = true;
  try {
    const list = await api.listPending();
    let n = 0;
    for (const p of list) {
      n++;
      progress({ label: "Generating previews", done: n, total: list.length, current: p.relpath.split(/[\\/]/).pop() });
      const ext = extOf(p.relpath);
      const url = fileUrl(p.relpath);
      try {
        let result = null;
        if (p.pending === "mesh") result = { image: await viewer.renderThumb(url, ext) };
        else if (p.pending === "pdf") result = await viewer.pdfThumbAndText(url);
        else if (p.pending === "video") result = await viewer.videoThumb(url);
        await api.completePending(p.id, result || { meta: { "Preview": "unavailable" } });
      } catch (err) {
        await api.completePending(p.id, { meta: { "Preview error": String(err.message || err) } });
      }
    }
    if (list.length) {
      progress(null);
      if (S.projectId) { S.items = await api.listItems(S.projectId); renderItems(); if (S.itemId) renderInspector(); }
      loadProjects();
    }
  } finally {
    pendingBusy = false;
  }
}

// ── search ─────────────────────────────────────────────────────
const doSearch = debounce(async (q) => {
  if (!q.trim()) { if ($("#page-search").classList.contains("active")) goHome(); return; }
  const r = await api.search(q);
  showPage("search");
  $("#title").textContent = `Search: ${q}`;
  $("#page-search").innerHTML = `
    <div class="result-group"><h3>Projects (${r.projects.length})</h3>${r.projects.map((p) => `<div class="result" data-p="${p.id}"><div class="thumb"><span class="dot" style="width:10px;height:10px;border-radius:50%;background:${STATUS[p.status]?.[1]}"></span></div><div><b>${esc(p.name)}</b><div class="dim small">${esc(p.category || "no category")} · ${STATUS[p.status]?.[0]} · ${esc(p.description)}</div></div></div>`).join("") || '<div class="dim small">none</div>'}</div>
    <div class="result-group"><h3>Files (${r.items.length})</h3>${r.items.map((i) => `<div class="result" data-p="${i.project_id}" data-i="${i.id}"><div class="thumb">${i.thumb ? `<img src="${thumbUrl(i.thumb)}">` : kindBadge(i.kind)}</div><div><b>${esc(i.name)}</b><div class="dim small">${esc(i.project_name)} · ${KIND_LABEL[i.kind]?.[1] || i.kind}${i.tags.length ? " · " + esc(i.tags.join(", ")) : ""}</div></div></div>`).join("") || '<div class="dim small">none</div>'}</div>`;
  $$(".result", $("#page-search")).forEach((el) => (el.onclick = () => openProject(+el.dataset.p, el.dataset.i ? +el.dataset.i : null)));
}, 250);

// ── settings / backup ──────────────────────────────────────────
async function openSettings() {
  const s = S.settings;
  const m = modal(`<h2>Settings</h2>
    <div class="field"><label>Library folder (local, the master copy)</label><div class="row"><input type="text" id="s-lib" value="${esc(s.libraryPath)}" /><button class="btn" id="s-lib-browse">Browse…</button></div></div>
    <div class="field"><label>NAS mirror folder (backup target)</label><div class="row"><input type="text" id="s-nas" value="${esc(s.nasPath)}" /><button class="btn" id="s-nas-browse">Browse…</button></div><span class="dim small">A UNC path like \\\\192.168.1.204\\share\\folder. Created if missing.</span></div>
    <div class="row"><div class="field" style="flex:1"><label>Theme</label><select id="s-theme"><option value="dark" ${s.theme !== "light" ? "selected" : ""}>Dark</option><option value="light" ${s.theme === "light" ? "selected" : ""}>Light</option></select></div>
      <div class="field" style="flex:1"><label>&nbsp;</label><label class="row" style="margin:0"><input type="checkbox" id="s-boq" ${s.backupOnQuit ? "checked" : ""} style="width:auto" /> Run backup when the app closes</label></div></div>
    <h3>Maintenance</h3>
    <div class="row"><button class="btn small" id="s-reextract">Re-read all files</button><button class="btn small" id="s-openlib">Open library folder</button><button class="btn small" id="s-deletions">Deletion log</button><span class="spacer"></span><span class="dim small" id="s-version"></span></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="s-save">Save</button></div>`);
  api.version().then((v) => ($("#s-version", m.el).textContent = "ProjectVault v" + v));
  $("#s-lib-browse", m.el).onclick = async () => { const p = await api.pickFolder({ title: "Choose the library folder", defaultPath: s.libraryPath }); if (p) $("#s-lib", m.el).value = p; };
  $("#s-nas-browse", m.el).onclick = async () => { const p = await api.pickFolder({ title: "Choose the NAS mirror folder", defaultPath: s.nasPath }); if (p) $("#s-nas", m.el).value = p; };
  $("#s-reextract", m.el).onclick = async () => { m.close(); await api.reextractAll(); progress(null); toast("Re-read every file", "ok"); if (S.projectId) await loadItems(); runPending(); };
  $("#s-openlib", m.el).onclick = () => api.openPath("");
  $("#s-deletions", m.el).onclick = async () => {
    const rows = await api.deletions();
    const mm = modal(`<h2>Deletion log</h2><div class="report">${rows.map((d) => `${fmtDate(d.ts)}  [${d.nas_state}]  ${esc(d.project_name)} / ${esc(d.item_name)}\n    ${esc(d.relpath)}\n    reason: ${esc(d.reason)}`).join("\n\n") || "No deletions recorded."}</div><div class="foot"><button class="btn" data-close>Close</button></div>`, { wide: true });
    void mm;
  };
  $("#s-save", m.el).onclick = async () => {
    const libraryPath = $("#s-lib", m.el).value.trim();
    const patch = { nasPath: $("#s-nas", m.el).value.trim(), theme: $("#s-theme", m.el).value, backupOnQuit: $("#s-boq", m.el).checked };
    S.settings = await api.setSettings(patch);
    applyTheme();
    m.close();
    if (libraryPath && libraryPath !== S.settings.libraryPath) await openLibrary(libraryPath);
  };
}

async function openBackup() {
  const chk = await api.backupCheck();
  const m = modal(`<h2>Backup to NAS</h2>
    <div class="kv"><div class="k">Target</div><div class="v mono">${esc(S.settings.nasPath || "(not set)")}</div>
      <div class="k">Status</div><div class="v" style="color:${chk.ok ? "var(--ok)" : "var(--danger)"}">${chk.ok ? "reachable" : esc(chk.reason)}</div>
      <div class="k">Pending deletions</div><div class="v">${chk.pending ?? 0}</div>
      <div class="k">Last backup</div><div class="v">${S.settings.lastBackup ? fmtDate(S.settings.lastBackup) : "never"}</div></div>
    <p class="muted small">Copies new and changed files from the library to the NAS. Files you deleted (with a reason) are moved into <b>_Deleted</b> on the NAS and logged. Nothing on the NAS is ever overwritten with a deletion or purged.</p>
    <div class="hidden" id="b-prog"><div class="progress-bar"><div class="fill" id="b-fill"></div></div><div class="row small muted"><span id="b-count"></span><span class="spacer"></span><span id="b-pct"></span></div><div class="mono small dim" id="b-cur"></div></div>
    <div class="report hidden" id="b-report"></div>
    <div class="foot"><button class="btn" data-close>Close</button><button class="btn primary" id="b-run" ${chk.ok ? "" : "disabled"}>Run backup</button></div>`);
  $("#b-run", m.el).onclick = async () => {
    $("#b-run", m.el).disabled = true;
    const rep = $("#b-report", m.el);
    const prog = $("#b-prog", m.el);
    prog.classList.remove("hidden");
    $("#b-count", m.el).textContent = "Scanning library…";
    const off = api.on("backup:progress", (p) => {
      if (!p) return;
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      $("#b-fill", m.el).style.width = pct + "%";
      $("#b-pct", m.el).textContent = pct + "%";
      $("#b-count", m.el).textContent = `${p.done} of ${p.total} files checked`;
      $("#b-cur", m.el).textContent = p.current || "";
    });
    try {
      const r = await api.backupRun();
      S.settings = await api.settings();
      $("#b-fill", m.el).style.width = "100%";
      $("#b-pct", m.el).textContent = "100%";
      $("#b-count", m.el).textContent = "Finished";
      $("#b-cur", m.el).textContent = "";
      rep.classList.remove("hidden");
      rep.textContent = `Done.\n${r.copied} copied (${fmtBytes(r.bytes)})\n${r.skipped} unchanged\n${r.deleted} moved to _Deleted\n${r.errors.length ? "\nErrors:\n" + r.errors.join("\n") : ""}`;
      toast("Backup complete", "ok");
    } catch (err) {
      rep.classList.remove("hidden");
      rep.textContent = "Backup failed: " + err.message;
      toast("Backup failed: " + err.message, "err");
    } finally {
      off();
      $("#b-run", m.el).disabled = false;
    }
  };
}

function newProject() {
  const cats = [...new Set(S.projects.map((p) => p.category).filter(Boolean))];
  const m = modal(`<h2>New project</h2>
    <div class="field"><label>Name</label><input type="text" id="np-name" placeholder="e.g. Shop vacuum cyclone" /></div>
    <div class="field"><label>Category (optional, becomes a folder)</label><input type="text" id="np-cat" list="np-cats" placeholder="e.g. Furniture, 3D Printing, Electronics" /><datalist id="np-cats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
    <div class="field"><label>Status</label><select id="np-status">${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
    <div class="field"><label>Description</label><input type="text" id="np-desc" /></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="np-ok">Create</button></div>`);
  const ok = async () => {
    const name = $("#np-name", m.el).value.trim();
    if (!name) return $("#np-name", m.el).focus();
    const p = await api.createProject({ name, category: $("#np-cat", m.el).value.trim(), status: $("#np-status", m.el).value, description: $("#np-desc", m.el).value.trim() });
    m.close();
    await loadProjects();
    openProject(p.id);
  };
  $("#np-ok", m.el).onclick = ok;
  m.el.onkeydown = (e) => { if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") ok(); };
}

// ── library / boot ─────────────────────────────────────────────
function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme === "light" ? "light" : "dark";
}
async function openLibrary(path) {
  try {
    S.info = await api.openLibrary(path);
    S.settings = await api.settings();
    S.fieldDefs = await api.fieldDefs();
    await loadProjects();
    goHome();
    runPending();
  } catch (err) {
    toast("Could not open library: " + err.message, "err");
  }
}

async function boot() {
  S.settings = await api.settings();
  applyTheme();
  S.info = await api.libraryInfo();
  $("#setup-path").value = S.settings.libraryPath || "";
  $("#setup-browse").onclick = async () => { const p = await api.pickFolder({ title: "Choose where the library lives" }); if (p) $("#setup-path").value = p; };
  $("#setup-open").onclick = () => { const p = $("#setup-path").value.trim(); if (p) openLibrary(p); };
  $("[data-nav=home]").onclick = goHome;
  $("#btn-new-project").onclick = newProject;
  $("#btn-settings").onclick = openSettings;
  $("#btn-backup").onclick = openBackup;
  $$(".tab").forEach((t) => (t.onclick = () => setTab(t.dataset.tab)));
  $("#btn-add-files").onclick = async () => addPaths(S.projectId, await api.pickFiles());
  $("#btn-add-folder").onclick = async () => { const f = await api.pickFolder({ title: "Add a folder (its files are copied in, subfolders kept)" }); if (f) addPaths(S.projectId, [f]); };
  $("#kind-filter").onchange = (e) => { S.kindFilter = e.target.value; renderItems(); };
  $("#sort").onchange = (e) => { S.sort = e.target.value; renderItems(); };
  $$(".seg button").forEach((b) => (b.onclick = () => { S.view = b.dataset.view; $$(".seg button").forEach((x) => x.classList.toggle("active", x === b)); api.setSettings({ view: S.view }); renderItems(); }));
  S.view = S.settings.view || "grid";
  $$(".seg button").forEach((x) => x.classList.toggle("active", x.dataset.view === S.view));
  const dz = $("#dropzone");
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = (e) => { if (!dz.contains(e.relatedTarget)) dz.classList.remove("over"); };
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); if (S.projectId) dropFiles(e, S.projectId); };
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());
  $("#search").oninput = (e) => doSearch(e.target.value);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#search").focus(); $("#search").select(); }
    if (e.key === "Escape") { if (!$("#modal-root").classList.contains("hidden")) { $("#modal-root").classList.add("hidden"); $("#modal-root").innerHTML = ""; } else if (document.activeElement === $("#search")) { $("#search").value = ""; goHome(); } }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); newProject(); }
  });
  api.on("progress", progress);
  api.on("update:status", (s) => { if (s?.state === "ready") toast("Update downloaded; it installs when you close ProjectVault", "ok"); });
  if (S.info.open) {
    S.fieldDefs = await api.fieldDefs();
    await loadProjects();
    const devItem = new URLSearchParams(location.search).get("item");
    if (S.settings.lastProjectId && S.projects.find((p) => p.id === S.settings.lastProjectId)) openProject(S.settings.lastProjectId, devItem ? +devItem : null);
    else goHome();
    runPending();
  } else showPage("setup");
}
window.addEventListener("beforeunload", () => { if (S.projectId) api.setSettings({ lastProjectId: S.projectId }); });
boot();

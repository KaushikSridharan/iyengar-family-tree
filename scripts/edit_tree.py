#!/usr/bin/env python3
"""Local web-based editor for tree.json and portraits in photos/.

Usage:
  python3 scripts/edit_tree.py
  python3 scripts/edit_tree.py --port 3030

Uses only the Python 3 standard library (plus system ffmpeg or ImageMagick if
uploading new photos from the browser).
"""

import argparse
import datetime
import http.server
import json
import os
import re
import shutil
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import unicodedata
import urllib.parse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
TREE_PATH = os.path.join(REPO_ROOT, "tree.json")
PHOTOS_DIR = os.path.join(REPO_ROOT, "photos")

if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from format_tree import PERSON_KEY_ORDER, UNION_KEY_ORDER, sort_dict  # noqa: E402
from validate import validate_tree  # noqa: E402

ID_RE = re.compile(r"^[a-z0-9-]+$")
LOCK = threading.Lock()


def make_next_id(people: dict, name: str = "") -> str:
    existing = set(people.keys())
    max_num = 0
    for pid in existing:
        m = re.match(r"^p(\d+)", pid)
        if m:
            max_num = max(max_num, int(m.group(1)))

    slug = ""
    if name:
        norm = unicodedata.normalize("NFD", name.strip())
        ascii_only = "".join(ch for ch in norm if unicodedata.category(ch) != "Mn").lower()
        cleaned = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")
        slug = cleaned.split("-")[0] if cleaned else ""

    next_num = max_num + 1
    candidate = f"p{next_num}-{slug}" if slug else f"p{next_num}"
    while candidate in existing:
        next_num += 1
        candidate = f"p{next_num}-{slug}" if slug else f"p{next_num}"
    return candidate


def format_tree_payload(data: dict) -> dict:
    formatted = {}
    for top_key in ("title", "defaultStartId", "lastUpdated"):
        val = data.get(top_key)
        if val is not None and val != "":
            formatted[top_key] = val

    for k in sorted(data.keys()):
        if k not in ("title", "defaultStartId", "lastUpdated", "people", "unions"):
            formatted[k] = data[k]

    people = data.get("people", {})
    formatted["people"] = {
        pid: sort_dict(people[pid], PERSON_KEY_ORDER) for pid in sorted(people.keys())
    }
    formatted["unions"] = [
        sort_dict(u, UNION_KEY_ORDER) for u in data.get("unions", [])
    ]
    return formatted


def empty_tree() -> dict:
    return {"title": "Iyengar Family Tree", "people": {}, "unions": []}


def read_tree() -> dict:
    if not os.path.isfile(TREE_PATH):
        return empty_tree()
    with open(TREE_PATH, "r", encoding="utf-8") as f:
        raw = f.read().strip()
    if not raw:
        return empty_tree()
    return json.loads(raw)


def write_tree_atomic(data: dict) -> None:
    content = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    fd, tmp_path = tempfile.mkstemp(prefix=".tree-", suffix=".json", dir=REPO_ROOT)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_path, TREE_PATH)
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def normalize_slug(text: str) -> str:
    if not text:
        return ""
    norm = unicodedata.normalize("NFD", text.strip())
    ascii_only = "".join(ch for ch in norm if unicodedata.category(ch) != "Mn").lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")
    return cleaned[:48].strip("-")


def make_photo_stem(person_id: str, person_name: str = "") -> str:
    if not ID_RE.match(person_id):
        raise ValueError("Invalid person ID for photo filename.")
    name_slug = normalize_slug(person_name)
    if not name_slug or person_id == name_slug or person_id.endswith(f"-{name_slug}"):
        return person_id
    return f"{person_id}-{name_slug}"


def convert_photo_bytes(
    raw_bytes: bytes, ext: str, person_id: str, person_name: str = ""
) -> tuple[str, str]:
    stem = make_photo_stem(person_id, person_name)

    os.makedirs(PHOTOS_DIR, exist_ok=True)
    detail_file = f"{stem}.webp"
    thumb_file = f"{stem}.thumb.webp"
    detail_out = os.path.join(PHOTOS_DIR, detail_file)
    thumb_out = os.path.join(PHOTOS_DIR, thumb_file)

    magick_cmd = shutil.which("magick") or shutil.which("convert")
    ffmpeg_cmd = shutil.which("ffmpeg")
    if not magick_cmd and not ffmpeg_cmd:
        raise RuntimeError("Install ImageMagick (magick/convert) or ffmpeg to process photos.")

    safe_ext = ext if re.match(r"^\.[a-z0-9]{1,6}$", ext.lower()) else ".img"
    fd, tmp_src = tempfile.mkstemp(prefix="upload-", suffix=safe_ext)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw_bytes)

        if magick_cmd:
            for size, out_path in ((400, detail_out), (96, thumb_out)):
                src_in = tmp_src if size == 400 else detail_out
                subprocess.run(
                    [
                        magick_cmd,
                        src_in,
                        "-auto-orient",
                        "-resize",
                        f"{size}x{size}^",
                        "-gravity",
                        "center",
                        "-extent",
                        f"{size}x{size}",
                        "-quality",
                        "84",
                        out_path,
                    ],
                    check=True,
                )
        else:
            subprocess.run(
                [
                    ffmpeg_cmd,
                    "-y",
                    "-loglevel",
                    "error",
                    "-i",
                    tmp_src,
                    "-vf",
                    "crop=min(iw\\,ih):min(iw\\,ih),scale=400:400:flags=lanczos",
                    "-c:v",
                    "libwebp",
                    "-quality",
                    "84",
                    detail_out,
                ],
                check=True,
            )
            subprocess.run(
                [
                    ffmpeg_cmd,
                    "-y",
                    "-loglevel",
                    "error",
                    "-i",
                    detail_out,
                    "-vf",
                    "scale=96:96:flags=lanczos",
                    "-c:v",
                    "libwebp",
                    "-quality",
                    "84",
                    thumb_out,
                ],
                check=True,
            )
    finally:
        if os.path.exists(tmp_src):
            os.unlink(tmp_src)

    return detail_file, thumb_file


EDITOR_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Family Tree JSON Editor</title>
  <style>
    :root {
      --bg: #F6F4EF;
      --surface: #FFFFFF;
      --muted: #EFECE6;
      --ink: #1C1917;
      --sec: #6E665C;
      --border: #E2DDD3;
      --accent: #1F4E3D;
      --accent-hover: #173B2E;
      --accent-soft: #E9F0EC;
      --danger: #B42318;
      --danger-soft: #FEF3F2;
      --warn: #B54708;
      --warn-soft: #FFFAEB;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    button, input, select, textarea { font: inherit; color: inherit; }
    button { cursor: pointer; }
    header {
      position: sticky;
      top: 0;
      z-index: 20;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 12px 20px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .brand { display: flex; align-items: baseline; gap: 10px; }
    .brand h1 { margin: 0; font-size: 18px; font-weight: 650; }
    .brand span { font-size: 13px; color: var(--sec); }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .tabs { display: flex; gap: 4px; background: var(--muted); padding: 3px; border-radius: 10px; }
    .tab-btn {
      border: 0;
      background: transparent;
      padding: 6px 12px;
      border-radius: 7px;
      font-size: 13px;
      font-weight: 500;
      color: var(--sec);
    }
    .tab-btn.active { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 7px 13px;
      border-radius: 9px;
      border: 1px solid var(--border);
      background: var(--surface);
      font-size: 13px;
      font-weight: 500;
    }
    .btn:hover { background: var(--muted); }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-danger { color: var(--danger); border-color: #FECDCA; background: var(--danger-soft); }
    .btn-danger:hover { background: #FEE4E2; }
    .layout {
      flex: 1;
      display: grid;
      grid-template-columns: 300px 1fr;
      max-width: 1380px;
      width: 100%;
      margin: 0 auto;
      min-height: 0;
    }
    @media (max-width: 820px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { max-height: 300px; border-right: 0; border-bottom: 1px solid var(--border); }
    }
    .sidebar {
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .sidebar-top {
      padding: 12px;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .input, select, textarea {
      width: 100%;
      border: 1px solid #D6D0C4;
      border-radius: 9px;
      background: var(--bg);
      padding: 8px 10px;
      font-size: 14px;
    }
    .input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--accent);
      background: var(--surface);
    }
    .people-list {
      flex: 1;
      overflow-y: auto;
      padding: 6px;
    }
    .person-item {
      width: 100%;
      border: 0;
      background: transparent;
      text-align: left;
      padding: 8px 10px;
      border-radius: 9px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .person-item:hover { background: var(--bg); }
    .person-item.selected { background: var(--accent-soft); }
    .thumb {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: var(--muted);
      object-fit: cover;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--sec);
      font-size: 12px;
      overflow: hidden;
    }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .person-item-meta { min-width: 0; flex: 1; }
    .person-item-name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .person-item-sub { font-size: 12px; color: var(--sec); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    main {
      padding: 20px 24px 48px;
      overflow-y: auto;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 20px;
      max-width: 820px;
      margin-bottom: 18px;
    }
    .card-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--muted);
    }
    .card-header h2 { margin: 0; font-size: 18px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
    .full { grid-column: 1 / -1; }
    .field label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--sec);
      margin-bottom: 5px;
    }
    .hint { font-size: 12px; color: var(--sec); margin-top: 4px; }
    .photo-box {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 14px;
      padding: 12px;
      border: 1px dashed #CFC9BC;
      border-radius: 12px;
      background: var(--bg);
    }
    .photo-preview {
      width: 72px;
      height: 72px;
      border-radius: 12px;
      background: var(--muted);
      object-fit: cover;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex-shrink: 0;
    }
    .photo-preview img { width: 100%; height: 100%; object-fit: cover; }
    .alert {
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 13px;
      margin-bottom: 14px;
      max-width: 820px;
    }
    .alert-err { background: var(--danger-soft); color: var(--danger); border: 1px solid #FECDCA; }
    .alert-warn { background: var(--warn-soft); color: var(--warn); border: 1px solid #FEDF89; }
    .alert-ok { background: var(--accent-soft); color: var(--accent); border: 1px solid #B7D4C5; }
    .row-card {
      border: 1px solid var(--border);
      border-radius: 11px;
      padding: 12px 14px;
      margin-bottom: 10px;
      background: var(--bg);
    }
    .pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: var(--muted);
      color: var(--sec);
    }
    .status-dirty { color: var(--warn); font-weight: 600; font-size: 13px; }
    .status-clean { color: var(--accent); font-weight: 500; font-size: 13px; }
    .link-btn {
      border: 0;
      background: transparent;
      color: var(--accent);
      text-decoration: underline;
      padding: 0;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>Family Tree Editor</h1>
      <span id="summary-text">Loading…</span>
    </div>
    <div class="toolbar">
      <div class="tabs" role="tablist">
        <button type="button" class="tab-btn active" data-tab="people">People</button>
        <button type="button" class="tab-btn" data-tab="unions">Unions</button>
        <button type="button" class="tab-btn" data-tab="settings">Tree &amp; Validation</button>
      </div>
      <span id="dirty-indicator" class="status-clean">Saved</span>
      <button type="button" class="btn" id="reload-btn">Reload</button>
      <button type="button" class="btn btn-primary" id="save-btn" disabled>Save tree.json</button>
    </div>
  </header>

  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <div style="display:flex; gap:6px;">
          <input type="search" id="search-box" class="input" placeholder="Search name or ID…" />
          <button type="button" class="btn btn-primary" id="add-person-btn" title="Add person">+ New</button>
        </div>
      </div>
      <div class="people-list" id="people-list"></div>
    </aside>
    <main id="main-pane"></main>
  </div>

  <script>
    const state = {
      tree: null,
      selectedId: null,
      tab: 'people',
      search: '',
      dirty: false,
      errors: [],
      warnings: [],
      flash: null,
      autoUpdateDate: true,
    };

    function el(tag, attrs = {}, children = []) {
      const n = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'className') n.className = v;
        else if (k === 'textContent') n.textContent = v;
        else if (k === 'value') n.value = v;
        else if (k === 'checked') n.checked = Boolean(v);
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) n.setAttribute(k, '');
        else n.setAttribute(k, String(v));
      }
      for (const c of Array.isArray(children) ? children : [children]) {
        if (c === null || c === undefined || c === false) continue;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
      return n;
    }

    async function api(path, opts = {}) {
      const res = await fetch(path, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    }

    function markDirty() {
      state.dirty = true;
      state.flash = null;
      updateHeaderStatus();
      runLiveValidation();
    }

    let validateTimer = null;
    function runLiveValidation() {
      clearTimeout(validateTimer);
      validateTimer = setTimeout(async () => {
        try {
          const res = await api('/api/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.tree),
          });
          state.errors = res.errors || [];
          state.warnings = res.warnings || [];
          renderMainAlertsOnly();
        } catch {}
      }, 180);
    }

    function updateHeaderStatus() {
      const peopleCount = state.tree ? Object.keys(state.tree.people || {}).length : 0;
      const unionCount = state.tree ? (state.tree.unions || []).length : 0;
      document.getElementById('summary-text').textContent = `${peopleCount} people · ${unionCount} unions`;
      const ind = document.getElementById('dirty-indicator');
      ind.textContent = state.dirty ? 'Unsaved changes' : 'Saved';
      ind.className = state.dirty ? 'status-dirty' : 'status-clean';
      document.getElementById('save-btn').disabled = !state.dirty;
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === state.tab);
      });
    }

    function sortedPeopleEntries() {
      const people = state.tree?.people || {};
      return Object.entries(people).sort((a, b) => {
        const na = (a[1].name || a[0]).toLowerCase();
        const nb = (b[1].name || b[0]).toLowerCase();
        return na.localeCompare(nb);
      });
    }

    function renderSidebar() {
      const list = document.getElementById('people-list');
      list.textContent = '';
      const q = state.search.trim().toLowerCase();
      for (const [pid, p] of sortedPeopleEntries()) {
        const hay = `${pid} ${p.name || ''} ${p.fullName || ''} ${p.altName || ''}`.toLowerCase();
        if (q && !hay.includes(q)) continue;

        const thumbSrc = p.photo ? `/photos/${p.photo.replace(/\.webp$/i, '.thumb.webp')}` : '';
        const thumbEl = el('div', { className: 'thumb' }, thumbSrc
          ? [el('img', { src: thumbSrc, alt: p.name || pid, onerror: (e) => { e.target.remove(); } })]
          : [(p.name || '?').slice(0, 1).toUpperCase()]);

        const years = p.born ? (p.died ? `${p.born.slice(0,4)}–${p.died.slice(0,4)}` : `b. ${p.born.slice(0,4)}`) : '';
        list.appendChild(
          el('button', {
            type: 'button',
            className: `person-item ${pid === state.selectedId ? 'selected' : ''}`,
            onclick: () => {
              state.selectedId = pid;
              state.tab = 'people';
              updateHeaderStatus();
              renderSidebar();
              renderMain();
            },
          }, [
            thumbEl,
            el('div', { className: 'person-item-meta' }, [
              el('div', { className: 'person-item-name', textContent: p.name || '(Unnamed)' }),
              el('div', { className: 'person-item-sub', textContent: [pid, years].filter(Boolean).join(' · ') }),
            ]),
          ])
        );
      }
    }

    function renderAlertsBlock() {
      const wrap = el('div', { id: 'alerts-wrap' });
      if (state.flash) {
        wrap.appendChild(el('div', { className: `alert ${state.flash.kind === 'err' ? 'alert-err' : 'alert-ok'}`, textContent: state.flash.text }));
      }
      if (state.errors.length > 0) {
        wrap.appendChild(el('div', { className: 'alert alert-err' }, [
          el('strong', { textContent: `${state.errors.length} validation error(s):` }),
          el('ul', { style: { margin: '6px 0 0 18px', padding: 0 } }, state.errors.map(e => el('li', { textContent: e }))),
        ]));
      }
      if (state.warnings.length > 0) {
        wrap.appendChild(el('div', { className: 'alert alert-warn' }, [
          el('strong', { textContent: `${state.warnings.length} warning(s):` }),
          el('ul', { style: { margin: '6px 0 0 18px', padding: 0 } }, state.warnings.map(w => el('li', { textContent: w }))),
        ]));
      }
      return wrap;
    }

    function renderMainAlertsOnly() {
      const existing = document.getElementById('alerts-wrap');
      if (existing && existing.parentNode) {
        existing.parentNode.replaceChild(renderAlertsBlock(), existing);
      }
    }

    function buildPersonSelect(currentVal, excludeIds, allowEmptyLabel, onChange) {
      const sel = el('select', {
        onchange: (e) => onChange(e.target.value),
      });
      if (allowEmptyLabel !== null) {
        sel.appendChild(el('option', { value: '', textContent: allowEmptyLabel }));
      }
      for (const [pid, p] of sortedPeopleEntries()) {
        if (excludeIds && excludeIds.has(pid)) continue;
        const opt = el('option', { value: pid, textContent: `${p.name || pid} (${pid})` });
        if (pid === currentVal) opt.selected = true;
        sel.appendChild(opt);
      }
      if (currentVal && !sel.value) {
        const missing = el('option', { value: currentVal, textContent: `${currentVal} (missing)` });
        missing.selected = true;
        sel.appendChild(missing);
      }
      return sel;
    }

    function addPerson(prefill = {}) {
      const baseName = prefill.name || 'New Person';
      const used = new Set(Object.keys(state.tree.people || {}));
      let maxNum = 0;
      for (const pid of used) {
        const m = pid.match(/^p(\d+)/);
        if (m) maxNum = Math.max(maxNum, Number(m[1]));
      }
      let nextId = `p${maxNum + 1}`;
      while (used.has(nextId)) {
        maxNum += 1;
        nextId = `p${maxNum + 1}`;
      }
      state.tree.people[nextId] = {
        name: prefill.name || '',
        ...prefill,
      };
      state.selectedId = nextId;
      state.tab = 'people';
      markDirty();
      renderSidebar();
      renderMain();
    }

    function renamePersonId(oldId, newId) {
      newId = newId.trim().toLowerCase();
      if (!/^[a-z0-9-]+$/.test(newId)) {
        state.flash = { kind: 'err', text: 'ID must contain only lowercase letters, digits, and hyphens.' };
        renderMainAlertsOnly();
        return;
      }
      if (newId === oldId) return;
      if (state.tree.people[newId]) {
        state.flash = { kind: 'err', text: `ID "${newId}" already exists.` };
        renderMainAlertsOnly();
        return;
      }
      const record = state.tree.people[oldId];
      delete state.tree.people[oldId];
      state.tree.people[newId] = record;
      if (state.tree.defaultStartId === oldId) state.tree.defaultStartId = newId;
      for (const p of Object.values(state.tree.people)) {
        if (Array.isArray(p.parents)) {
          p.parents = p.parents.map(id => (id === oldId ? newId : id));
        }
      }
      for (const u of state.tree.unions || []) {
        if (Array.isArray(u.partners)) {
          u.partners = u.partners.map(id => (id === oldId ? newId : id));
        }
      }
      state.selectedId = newId;
      markDirty();
      renderSidebar();
      renderMain();
    }

    function deletePerson(pid) {
      const p = state.tree.people[pid];
      if (!p) return;
      if (!confirm(`Delete "${p.name || pid}" (${pid}) and remove their parent/union links?`)) return;
      delete state.tree.people[pid];
      for (const other of Object.values(state.tree.people)) {
        if (Array.isArray(other.parents)) {
          other.parents = other.parents.filter(id => id !== pid);
          if (other.parents.length === 0) delete other.parents;
        }
      }
      state.tree.unions = (state.tree.unions || []).filter(u => !(u.partners || []).includes(pid));
      if (state.tree.defaultStartId === pid) {
        const first = Object.keys(state.tree.people)[0];
        if (first) state.tree.defaultStartId = first;
        else delete state.tree.defaultStartId;
      }
      state.selectedId = sortedPeopleEntries()[0]?.[0] || null;
      markDirty();
      renderSidebar();
      renderMain();
    }

    function renderPersonEditor(main) {
      const pid = state.selectedId;
      const p = pid ? state.tree.people[pid] : null;
      if (!p) {
        main.appendChild(el('div', { className: 'card' }, [
          el('p', { textContent: 'Select a person on the left or click "+ New" to create one.' }),
        ]));
        return;
      }

      const setField = (key, val) => {
        if (val === '' || val === null || val === undefined || (Array.isArray(val) && val.length === 0)) {
          delete p[key];
        } else {
          p[key] = val;
        }
        markDirty();
        renderSidebar();
      };

      const idInput = el('input', { className: 'input', value: pid });
      const renameBtn = el('button', {
        type: 'button',
        className: 'btn',
        textContent: 'Rename ID',
        onclick: () => renamePersonId(pid, idInput.value),
      });

      const parents = Array.isArray(p.parents) ? p.parents : [];
      const setParentAt = (idx, val) => {
        const next = [...parents];
        if (val) next[idx] = val;
        else next.splice(idx, 1);
        const deduped = [...new Set(next.filter(Boolean))];
        setField('parents', deduped);
        renderMain();
      };

      const fileInput = el('input', {
        type: 'file',
        accept: 'image/*',
        style: { display: 'none' },
        onchange: async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const buf = await file.arrayBuffer();
            const labelName = p.fullName || p.name || '';
            const res = await api(`/api/upload-photo?id=${encodeURIComponent(pid)}&name=${encodeURIComponent(labelName)}&filename=${encodeURIComponent(file.name)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: buf,
            });
            setField('photo', res.photo);
            state.flash = { kind: 'ok', text: `Converted and saved ${res.photo} & ${res.thumb} in photos/.` };
            renderMain();
          } catch (err) {
            state.flash = { kind: 'err', text: err.message };
            renderMainAlertsOnly();
          }
        },
      });

      const photoPreviewEl = el('div', { className: 'photo-preview' }, p.photo
        ? [el('img', { src: `/photos/${p.photo}?t=${Date.now()}`, alt: p.name || pid })]
        : [el('span', { style: { fontSize: '12px', color: 'var(--sec)' }, textContent: 'No photo' })]);

      const card = el('div', { className: 'card' }, [
        el('div', { className: 'card-header' }, [
          el('div', {}, [
            el('h2', { textContent: p.name || '(Unnamed person)' }),
            el('span', { className: 'pill', textContent: pid }),
          ]),
          el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
            el('button', {
              type: 'button',
              className: 'btn',
              textContent: '+ Add child',
              onclick: () => addPerson({ parents: [pid] }),
            }),
            el('button', {
              type: 'button',
              className: 'btn btn-danger',
              textContent: 'Delete person',
              onclick: () => deletePerson(pid),
            }),
          ]),
        ]),
        el('div', { className: 'grid' }, [
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Short display name *' }),
            el('input', {
              className: 'input',
              value: p.name || '',
              placeholder: 'e.g. Maya',
              oninput: (e) => setField('name', e.target.value),
            }),
          ]),
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Full name' }),
            el('input', {
              className: 'input',
              value: p.fullName || '',
              placeholder: 'e.g. Maya Arvind Kulkarni',
              oninput: (e) => setField('fullName', e.target.value),
            }),
          ]),
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Alternate script name' }),
            el('input', {
              className: 'input',
              value: p.altName || '',
              placeholder: 'e.g. माया कुलकर्णी',
              oninput: (e) => setField('altName', e.target.value),
            }),
          ]),
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Gender (drives Mother/Father labels)' }),
            el('select', { onchange: (e) => setField('gender', e.target.value) }, [
              el('option', { value: '', textContent: 'Unspecified', selected: !p.gender }),
              el('option', { value: 'f', textContent: 'Female (f)', selected: p.gender === 'f' }),
              el('option', { value: 'm', textContent: 'Male (m)', selected: p.gender === 'm' }),
              el('option', { value: 'x', textContent: 'Other / Non-binary (x)', selected: p.gender === 'x' }),
            ]),
          ]),
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Born (YYYY, YYYY-MM, or YYYY-MM-DD)' }),
            el('input', {
              className: 'input',
              value: p.born || '',
              placeholder: '1986-05-11',
              oninput: (e) => setField('born', e.target.value.trim()),
            }),
          ]),
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Died (leave blank if living)' }),
            el('input', {
              className: 'input',
              value: p.died || '',
              placeholder: '2011-11-04',
              oninput: (e) => setField('died', e.target.value.trim()),
            }),
          ]),
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Currently staying / Lived in (location)' }),
            el('input', {
              className: 'input',
              value: p.location || p.residence || '',
              placeholder: 'e.g. Bengaluru, India',
              oninput: (e) => {
                delete p.residence;
                setField('location', e.target.value);
              },
            }),
          ]),
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Birthplace' }),
            el('input', {
              className: 'input',
              value: p.birthplace || '',
              placeholder: 'e.g. Pune, Maharashtra',
              oninput: (e) => setField('birthplace', e.target.value),
            }),
          ]),
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Parent 1' }),
            buildPersonSelect(parents[0] || '', new Set([pid, parents[1]].filter(Boolean)), '— None —', (v) => setParentAt(0, v)),
          ]),
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Parent 2' }),
            buildPersonSelect(parents[1] || '', new Set([pid, parents[0]].filter(Boolean)), '— None —', (v) => setParentAt(1, v)),
          ]),
          el('div', { className: 'field full' }, [
            el('label', { textContent: 'Portrait photo (stored in photos/)' }),
            el('div', { className: 'photo-box' }, [
              photoPreviewEl,
              el('div', { style: { flex: '1', minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '8px' } }, [
                el('input', {
                  className: 'input',
                  value: p.photo || '',
                  placeholder: `${pid}.webp`,
                  oninput: (e) => setField('photo', e.target.value.trim()),
                }),
                el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
                  fileInput,
                  el('button', { type: 'button', className: 'btn', textContent: 'Upload & crop photo', onclick: () => fileInput.click() }),
                  p.photo ? el('button', { type: 'button', className: 'btn', textContent: 'Clear photo', onclick: () => { setField('photo', ''); renderMain(); } }) : null,
                ]),
              ]),
            ]),
          ]),
          el('div', { className: 'field full' }, [
            el('label', { textContent: 'Notes' }),
            el('textarea', {
              rows: 3,
              value: p.notes || '',
              placeholder: 'Family stories, memories, milestones…',
              oninput: (e) => setField('notes', e.target.value),
            }),
          ]),
          el('div', { className: 'field full' }, [
            el('label', { textContent: 'Person ID (advanced)' }),
            el('div', { style: { display: 'flex', gap: '8px' } }, [idInput, renameBtn]),
            el('div', { className: 'hint', textContent: 'Renaming updates all parent references, unions, and defaultStartId automatically.' }),
          ]),
        ]),
      ]);

      main.appendChild(card);

      // Unions involving this person
      const myUnions = (state.tree.unions || [])
        .map((u, idx) => ({ u, idx }))
        .filter(({ u }) => (u.partners || []).includes(pid));

      const unionCard = el('div', { className: 'card' }, [
        el('div', { className: 'card-header' }, [
          el('h2', { textContent: `Unions / Marriages (${myUnions.length})` }),
          el('button', {
            type: 'button',
            className: 'btn',
            textContent: '+ Add spouse / union',
            onclick: () => {
              const firstOther = sortedPeopleEntries().find(([id]) => id !== pid)?.[0];
              if (!firstOther) return;
              state.tree.unions.push({ partners: [pid, firstOther] });
              markDirty();
              renderMain();
            },
          }),
        ]),
      ]);

      if (myUnions.length === 0) {
        unionCard.appendChild(el('p', { className: 'hint', textContent: 'No recorded unions for this person yet.' }));
      } else {
        for (const { u, idx } of myUnions) {
          const otherIdx = u.partners[0] === pid ? 1 : 0;
          const otherId = u.partners[otherIdx];
          unionCard.appendChild(
            el('div', { className: 'row-card' }, [
              el('div', { className: 'grid' }, [
                el('div', { className: 'field' }, [
                  el('label', { textContent: 'Partner' }),
                  buildPersonSelect(otherId, new Set([pid]), null, (val) => {
                    u.partners[otherIdx] = val;
                    markDirty();
                    renderMain();
                  }),
                ]),
                el('div', { className: 'field' }, [
                  el('label', { textContent: 'Status' }),
                  el('select', {
                    onchange: (e) => {
                      if (e.target.value) u.status = e.target.value;
                      else delete u.status;
                      markDirty();
                    },
                  }, [
                    el('option', { value: '', textContent: 'Married / ongoing', selected: !u.status }),
                    el('option', { value: 'married', textContent: 'married', selected: u.status === 'married' }),
                    el('option', { value: 'divorced', textContent: 'divorced', selected: u.status === 'divorced' }),
                    el('option', { value: 'ended', textContent: 'ended', selected: u.status === 'ended' }),
                  ]),
                ]),
                el('div', { className: 'field' }, [
                  el('label', { textContent: 'Married date' }),
                  el('input', {
                    className: 'input',
                    value: u.married || '',
                    placeholder: 'YYYY or YYYY-MM-DD',
                    oninput: (e) => {
                      const v = e.target.value.trim();
                      if (v) u.married = v;
                      else delete u.married;
                      markDirty();
                    },
                  }),
                ]),
                el('div', { className: 'field' }, [
                  el('label', { textContent: 'Ended date' }),
                  el('input', {
                    className: 'input',
                    value: u.ended || '',
                    placeholder: 'Optional',
                    oninput: (e) => {
                      const v = e.target.value.trim();
                      if (v) u.ended = v;
                      else delete u.ended;
                      markDirty();
                    },
                  }),
                ]),
              ]),
              el('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '10px', alignItems: 'center' } }, [
                el('button', {
                  type: 'button',
                  className: 'link-btn',
                  textContent: `Jump to ${state.tree.people[otherId]?.name || otherId}`,
                  onclick: () => {
                    state.selectedId = otherId;
                    renderSidebar();
                    renderMain();
                  },
                }),
                el('button', {
                  type: 'button',
                  className: 'btn btn-danger',
                  textContent: 'Remove union',
                  onclick: () => {
                    state.tree.unions.splice(idx, 1);
                    markDirty();
                    renderMain();
                  },
                }),
              ]),
            ])
          );
        }
      }

      main.appendChild(unionCard);
    }

    function renderUnionsTab(main) {
      const unions = state.tree.unions || [];
      const card = el('div', { className: 'card' }, [
        el('div', { className: 'card-header' }, [
          el('h2', { textContent: `All Unions (${unions.length})` }),
          el('button', {
            type: 'button',
            className: 'btn btn-primary',
            textContent: '+ Add union',
            onclick: () => {
              const ids = sortedPeopleEntries().map(([id]) => id);
              if (ids.length < 2) return;
              state.tree.unions.push({ partners: [ids[0], ids[1]] });
              markDirty();
              renderMain();
            },
          }),
        ]),
      ]);

      unions.forEach((u, idx) => {
        card.appendChild(
          el('div', { className: 'row-card' }, [
            el('div', { className: 'grid' }, [
              el('div', { className: 'field' }, [
                el('label', { textContent: 'Partner A' }),
                buildPersonSelect(u.partners[0], new Set([u.partners[1]]), null, (val) => {
                  u.partners[0] = val;
                  markDirty();
                }),
              ]),
              el('div', { className: 'field' }, [
                el('label', { textContent: 'Partner B' }),
                buildPersonSelect(u.partners[1], new Set([u.partners[0]]), null, (val) => {
                  u.partners[1] = val;
                  markDirty();
                }),
              ]),
              el('div', { className: 'field' }, [
                el('label', { textContent: 'Married' }),
                el('input', {
                  className: 'input',
                  value: u.married || '',
                  placeholder: 'YYYY-MM-DD',
                  oninput: (e) => {
                    const v = e.target.value.trim();
                    if (v) u.married = v;
                    else delete u.married;
                    markDirty();
                  },
                }),
              ]),
              el('div', { className: 'field' }, [
                el('label', { textContent: 'Status & Order' }),
                el('div', { style: { display: 'flex', gap: '8px' } }, [
                  el('select', {
                    onchange: (e) => {
                      if (e.target.value) u.status = e.target.value;
                      else delete u.status;
                      markDirty();
                    },
                  }, [
                    el('option', { value: '', textContent: 'ongoing', selected: !u.status }),
                    el('option', { value: 'married', textContent: 'married', selected: u.status === 'married' }),
                    el('option', { value: 'divorced', textContent: 'divorced', selected: u.status === 'divorced' }),
                    el('option', { value: 'ended', textContent: 'ended', selected: u.status === 'ended' }),
                  ]),
                  el('input', {
                    type: 'number',
                    className: 'input',
                    style: { width: '90px' },
                    placeholder: 'Order',
                    value: u.order ?? '',
                    oninput: (e) => {
                      const v = e.target.value.trim();
                      if (v === '') delete u.order;
                      else u.order = Number(v);
                      markDirty();
                    },
                  }),
                ]),
              ]),
            ]),
            el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '8px' } }, [
              el('button', {
                type: 'button',
                className: 'btn btn-danger',
                textContent: 'Remove',
                onclick: () => {
                  unions.splice(idx, 1);
                  markDirty();
                  renderMain();
                },
              }),
            ]),
          ])
        );
      });

      main.appendChild(card);
    }

    function renderSettingsTab(main) {
      const t = state.tree;
      const people = Object.entries(t.people || {});
      const missingParents = people.filter(([, p]) => !p.parents || p.parents.length === 0);
      const missingBorn = people.filter(([, p]) => !p.born);
      const missingLocation = people.filter(([, p]) => !p.died && !p.location && !p.residence);
      const missingPhoto = people.filter(([, p]) => !p.photo);

      main.appendChild(el('div', { className: 'card' }, [
        el('div', { className: 'card-header' }, [el('h2', { textContent: 'Tree Settings' })]),
        el('div', { className: 'grid' }, [
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Tree title' }),
            el('input', {
              className: 'input',
              value: t.title || '',
              oninput: (e) => { t.title = e.target.value; markDirty(); },
            }),
          ]),
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Default starting person' }),
            buildPersonSelect(t.defaultStartId || '', null, '— First person —', (v) => {
              if (v) t.defaultStartId = v;
              else delete t.defaultStartId;
              markDirty();
            }),
          ]),
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Last updated (YYYY-MM-DD)' }),
            el('input', {
              className: 'input',
              value: t.lastUpdated || '',
              oninput: (e) => { t.lastUpdated = e.target.value.trim(); markDirty(); },
            }),
          ]),
          el('div', { className: 'field' }, [
            el('label', { textContent: 'Auto-stamp today on save' }),
            el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '400', marginTop: '8px' } }, [
              el('input', {
                type: 'checkbox',
                checked: state.autoUpdateDate,
                onchange: (e) => { state.autoUpdateDate = e.target.checked; },
              }),
              'Set lastUpdated to today when saving',
            ]),
          ]),
        ]),
      ]));

      const renderJumpList = (title, items) => {
        return el('div', { style: { marginBottom: '12px' } }, [
          el('div', { style: { fontSize: '13px', fontWeight: '600', marginBottom: '6px' }, textContent: `${title} (${items.length})` }),
          items.length === 0
            ? el('span', { className: 'hint', textContent: 'None' })
            : el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }, items.map(([pid, p]) =>
                el('button', {
                  type: 'button',
                  className: 'btn',
                  style: { padding: '4px 9px', fontSize: '12px' },
                  textContent: p.name || pid,
                  onclick: () => {
                    state.selectedId = pid;
                    state.tab = 'people';
                    updateHeaderStatus();
                    renderSidebar();
                    renderMain();
                  },
                })
              )),
        ]);
      };

      main.appendChild(el('div', { className: 'card' }, [
        el('div', { className: 'card-header' }, [el('h2', { textContent: 'Needs Attention Report' })]),
        renderJumpList('Missing parents', missingParents),
        renderJumpList('Missing birth date', missingBorn),
        renderJumpList('Living without current location', missingLocation),
        renderJumpList('Missing photo', missingPhoto),
      ]));
    }

    function renderMain() {
      const main = document.getElementById('main-pane');
      main.textContent = '';
      main.appendChild(renderAlertsBlock());
      if (state.tab === 'people') renderPersonEditor(main);
      else if (state.tab === 'unions') renderUnionsTab(main);
      else renderSettingsTab(main);
    }

    async function loadData() {
      const res = await api('/api/tree');
      state.tree = res.tree;
      state.errors = res.errors || [];
      state.warnings = res.warnings || [];
      state.dirty = false;
      state.flash = null;
      if (!state.selectedId || !state.tree.people[state.selectedId]) {
        state.selectedId = state.tree.defaultStartId || sortedPeopleEntries()[0]?.[0] || null;
      }
      updateHeaderStatus();
      renderSidebar();
      renderMain();
    }

    async function saveData() {
      if (state.autoUpdateDate) {
        state.tree.lastUpdated = new Date().toISOString().slice(0, 10);
      }
      try {
        const res = await api('/api/tree', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.tree),
        });
        state.tree = res.tree;
        state.errors = res.errors || [];
        state.warnings = res.warnings || [];
        state.dirty = false;
        state.flash = { kind: 'ok', text: 'Saved and formatted tree.json cleanly.' };
        updateHeaderStatus();
        renderSidebar();
        renderMain();
      } catch (err) {
        state.flash = { kind: 'err', text: err.message };
        renderMainAlertsOnly();
      }
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab;
        updateHeaderStatus();
        renderMain();
      });
    });
    document.getElementById('search-box').addEventListener('input', (e) => {
      state.search = e.target.value;
      renderSidebar();
    });
    document.getElementById('add-person-btn').addEventListener('click', () => addPerson({}));
    document.getElementById('save-btn').addEventListener('click', saveData);
    document.getElementById('reload-btn').addEventListener('click', () => {
      if (!state.dirty || confirm('Discard unsaved edits and reload tree.json from disk?')) {
        loadData();
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    loadData();
  </script>
</body>
</html>
"""


class EditorHandler(http.server.BaseHTTPRequestHandler):
    def send_json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def read_body(self, max_bytes: int = 16 * 1024 * 1024) -> bytes:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > max_bytes:
            raise ValueError("Invalid request body size.")
        return self.rfile.read(length)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            raw = EDITOR_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)
            return

        if path == "/api/tree":
            with LOCK:
                data = read_tree()
            errors, warnings = validate_tree(data, photos_dir=PHOTOS_DIR)
            self.send_json(200, {"tree": data, "errors": errors, "warnings": warnings})
            return

        if path.startswith("/photos/"):
            filename = os.path.basename(urllib.parse.unquote(path[len("/photos/"):]))
            full_path = os.path.abspath(os.path.join(PHOTOS_DIR, filename))
            if not full_path.startswith(os.path.abspath(PHOTOS_DIR) + os.sep) or not os.path.isfile(full_path):
                self.send_error(404, "Photo not found")
                return
            with open(full_path, "rb") as f:
                raw = f.read()
            ctype = "image/webp" if filename.lower().endswith(".webp") else "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)
            return

        self.send_error(404, "Not found")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/api/validate":
            try:
                data = json.loads(self.read_body().decode("utf-8"))
                errors, warnings = validate_tree(data, photos_dir=PHOTOS_DIR)
                self.send_json(200, {"errors": errors, "warnings": warnings})
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})
            return

        if path == "/api/tree":
            try:
                raw_data = json.loads(self.read_body().decode("utf-8"))
                formatted = format_tree_payload(raw_data)
                errors, warnings = validate_tree(formatted, photos_dir=PHOTOS_DIR)
                if errors:
                    self.send_json(400, {"error": errors[0], "errors": errors, "warnings": warnings})
                    return
                with LOCK:
                    write_tree_atomic(formatted)
                self.send_json(200, {"tree": formatted, "errors": errors, "warnings": warnings})
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})
            return

        if path == "/api/upload-photo":
            try:
                person_id = (qs.get("id") or [""])[0].strip()
                person_name = (qs.get("name") or [""])[0].strip()
                orig_name = (qs.get("filename") or ["photo.img"])[0]
                _, ext = os.path.splitext(orig_name)
                body = self.read_body(max_bytes=25 * 1024 * 1024)
                detail_file, thumb_file = convert_photo_bytes(body, ext, person_id, person_name)
                self.send_json(200, {"photo": detail_file, "thumb": thumb_file})
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})
            return

        self.send_error(404, "Not found")

    def log_message(self, format, *args):
        sys.stdout.write("%s - %s\n" % (self.address_string(), format % args))
        sys.stdout.flush()


class ReusableLocalServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


class DualStackEditorServer(ReusableLocalServer):
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def create_editor_server(port: int):
    try:
        return DualStackEditorServer(("::", port), EditorHandler)
    except OSError:
        return ReusableLocalServer(("0.0.0.0", port), EditorHandler)


def main():
    parser = argparse.ArgumentParser(description="Run a local browser editor for tree.json.")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", "3030")),
        help="Port to listen on (default: 3030)",
    )
    args = parser.parse_args()

    with create_editor_server(args.port) as httpd:
        url = f"http://localhost:{args.port}"
        print(f"Family Tree JSON Editor running at {url} (Ctrl+C to stop)", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nEditor stopped.")


if __name__ == "__main__":
    main()

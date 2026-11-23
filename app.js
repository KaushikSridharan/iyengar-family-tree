import {
  extractYear,
  formatDateForDetails,
  formatYearsShort,
  getAvatarTone,
  getPhotoUrls,
  parentRoleLabel,
  UI_STRINGS,
} from './lib/format.js';
import {
  buildTreeGraph,
  getAncestorLevels,
  getDerivedFamily,
  getDescendantLevels,
  searchPeople,
  sortByBirthThenName,
} from './lib/graph.js';
import { findShortestConnections, getRelationshipToViewer } from './lib/relationships.js';

const WHO_AM_I_KEY = 'family-tree-whoami';
const KINSHIP_VOCAB_KEY = 'family-tree-kinship-vocab';
const CACHED_TREE_KEY = 'family-tree-cached-json';

const state = {
  treeData: null,
  graph: null,
  loadError: null,
  whoAmIId: safeGetItem(WHO_AM_I_KEY),
  kinshipVocab: safeGetItem(KINSHIP_VOCAB_KEY) === 'marathi' ? 'marathi' : 'english',
  route: null,
  missingNotice: null,
  detailsSheetOpen: false,
  phoneSearchOpen: false,
  overviewOpen: false,
  photoPreview: null,
  keyboardPrompt: null,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  updateReady: false,
  overviewScale: 0.95,
  overviewOffset: { x: 0, y: 0 },
  connectVisibleCount: 5,
};

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch {
    // Ignore storage errors
  }
}

function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
}

function getViewportInfo() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  let layoutClass = 'desktop';
  if (width < 600) layoutClass = 'phone';
  else if (width < 1024) layoutClass = 'tablet';
  const isLandscapePhone = width > height && height < 540 && width < 1024;
  return { layoutClass, isLandscapePhone, width, height };
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'className') node.className = v;
    else if (k === 'textContent') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function svgIcon(pathD, size = 18, extraClass = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (extraClass) svg.setAttribute('class', extraClass);
  for (const d of Array.isArray(pathD) ? pathD : [pathD]) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

const ICONS = {
  back: 'M19 12H5M12 19l-7-7 7-7',
  home: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm21 21-4.3-4.3'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
  user: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'm16 11 2 2 4-4'],
  compass: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'm16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  branch: ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a9 9 0 0 1-9 9'],
  connect: ['m8 6 4-4 4 4', 'M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22', 'm20 22-5-5'],
  arrowDown: ['M12 5v14', 'm19 12-7 7-7-7'],
  arrowRight: ['M5 12h14', 'm12 5 7 7-7 7'],
  swap: ['m16 3 4 4-4 4', 'M20 7H4', 'm8 21-4-4 4-4', 'M4 17h16'],
  chevronDown: 'm6 9 6 6 6-6',
  wifiOff: ['M2 2l20 20', 'M8.5 16.5a5 5 0 0 1 7 0', 'M5 13a10 10 0 0 1 5.17-2.69', 'M10.71 5.05A16 16 0 0 1 22.58 9', 'M1.42 9a16 16 0 0 1 4.7-2.88', 'M12 20h.01'],
  refresh: ['M3 12a9 9 0 0 1 15-6.7L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15 6.7L3 16', 'M8 16H3v5'],
  check: 'M20 6 9 17l-5-5',
};

function createSilhouetteSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'avatar-silhouette');
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  head.setAttribute('cx', '24');
  head.setAttribute('cy', '17.5');
  head.setAttribute('r', '8.5');
  const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  body.setAttribute('d', 'M9 44c0-8.284 6.716-14 15-14s15 5.716 15 14v4H9v-4z');
  svg.appendChild(head);
  svg.appendChild(body);
  return svg;
}

function createAvatar(person, size = 'md', variant = 'thumb', eager = false) {
  const urls = getPhotoUrls(person.photo);
  const src = variant === 'detail' ? urls.detail : urls.thumb;
  const tone = getAvatarTone(person.id);

  const box = el('div', {
    className: `avatar avatar-${size}`,
    role: 'img',
    'aria-label': person.name,
    style: { backgroundColor: tone.bg, color: tone.text },
  });

  if (src) {
    const img = el('img', {
      src,
      alt: person.name,
      loading: eager ? 'eager' : 'lazy',
      decoding: 'async',
      referrerpolicy: 'no-referrer',
    });
    img.addEventListener('error', () => {
      box.textContent = '';
      box.appendChild(createSilhouetteSvg());
    });
    box.appendChild(img);
  } else {
    box.appendChild(createSilhouetteSvg());
  }

  return box;
}

function getValidWhoAmI() {
  if (!state.graph || !state.whoAmIId) return null;
  return state.graph.peopleById.has(state.whoAmIId) ? state.whoAmIId : null;
}

function getFocusedId() {
  if (!state.graph) return '';
  if (state.route?.kind === 'focus') return state.route.personId;
  if (state.route?.kind === 'connect') return state.route.toId;
  return getValidWhoAmI() || state.graph.defaultStartId;
}

function parseHash(rawHash) {
  const cleaned = (rawHash || '').replace(/^#\/?/, '').trim();
  if (!cleaned) return { kind: 'focus' };
  const parts = cleaned.split('/').filter(Boolean);
  if (parts[0] === 'connect' && parts[1] && parts[2]) {
    return {
      kind: 'connect',
      fromId: decodeURIComponent(parts[1]),
      toId: decodeURIComponent(parts[2]),
    };
  }
  return { kind: 'focus', id: decodeURIComponent(parts[0]) };
}

function syncRouteFromHash() {
  if (!state.graph) return;
  const parsed = parseHash(window.location.hash);
  const fallback = getValidWhoAmI() || state.graph.defaultStartId;

  if (parsed.kind === 'connect') {
    if (state.graph.peopleById.has(parsed.fromId) && state.graph.peopleById.has(parsed.toId)) {
      state.missingNotice = null;
      state.route = { kind: 'connect', fromId: parsed.fromId, toId: parsed.toId };
      return;
    }
    state.missingNotice = parsed.fromId || parsed.toId;
    state.route = { kind: 'focus', personId: fallback };
    window.history.replaceState(null, '', `#/${fallback}`);
    return;
  }

  if (parsed.id) {
    if (state.graph.peopleById.has(parsed.id)) {
      state.missingNotice = null;
      state.route = { kind: 'focus', personId: parsed.id };
      return;
    }
    state.missingNotice = parsed.id;
    state.route = { kind: 'focus', personId: fallback };
    window.history.replaceState(null, '', `#/${fallback}`);
    return;
  }

  state.missingNotice = null;
  state.route = { kind: 'focus', personId: fallback };
  window.history.replaceState(null, '', `#/${fallback}`);
}

// Overlays (details sheet, phone search, overview, photo, connection finder) each own one browser
// history entry tagged `{ overlayDepth }`, so the phone back gesture closes the top overlay instead of
// leaving the app. Moving between people replaces the current entry, so history never fills with people.
const overlayClosers = [];
// Person to focus once open overlays have been unwound through history.
let pendingFocusId = null;

// Opens an overlay: applies `open`, records `close` for the back gesture, and pushes a history entry.
function openOverlay(open, close, url = window.location.href) {
  open();
  overlayClosers.push(close);
  window.history.pushState({ overlayDepth: overlayClosers.length }, '', url);
  render();
}

// Swaps the top overlay for another one, reusing its history entry.
function replaceTopOverlay(open, close, url) {
  overlayClosers[overlayClosers.length - 1]();
  overlayClosers[overlayClosers.length - 1] = close;
  open();
  window.history.replaceState({ overlayDepth: overlayClosers.length }, '', url);
  render();
}

// Closes the top overlay from a UI control. Goes through history so the overlay's entry is consumed;
// the popstate handler runs the closer.
function closeOverlay() {
  if (overlayClosers.length > 0) window.history.back();
}

// Back/forward handler: closes overlays above the entry landed on, then applies any pending focus.
function handlePopState(event) {
  const depth = event.state?.overlayDepth || 0;
  while (overlayClosers.length > depth) overlayClosers.pop()();
  if (pendingFocusId && overlayClosers.length === 0) {
    const id = pendingFocusId;
    pendingFocusId = null;
    applyFocus(id);
    return;
  }
  syncRouteFromHash();
  render();
}

// Focuses a person in place: the URL changes for sharing, but no history entry is added.
function applyFocus(personId) {
  state.route = { kind: 'focus', personId };
  window.history.replaceState(null, '', `#/${personId}`);
  render();
}

// Focuses a person. Open overlays are unwound first so their history entries do not linger.
function navigateFocus(personId) {
  if (!state.graph || !state.graph.peopleById.has(personId)) return;
  state.missingNotice = null;
  state.keyboardPrompt = null;
  if (overlayClosers.length > 0) {
    pendingFocusId = personId;
    window.history.go(-overlayClosers.length);
    return;
  }
  applyFocus(personId);
}

// Shows the connection finder. From the tree it opens as an overlay; from the details sheet it takes
// over the sheet's history entry; inside the finder (or from a shared link) it replaces the URL in place.
function navigateConnect(fromId, toId) {
  if (!state.graph || !state.graph.peopleById.has(fromId) || !state.graph.peopleById.has(toId)) return;
  state.missingNotice = null;
  state.connectVisibleCount = 5;
  const url = `#/connect/${fromId}/${toId}`;
  const open = () => {
    state.route = { kind: 'connect', fromId, toId };
  };
  // Closing the finder needs no state change: the URL reverts and popstate re-syncs the route.
  const close = () => {};
  if (state.route?.kind === 'connect') {
    open();
    window.history.replaceState(window.history.state, '', url);
    render();
  } else if (state.detailsSheetOpen && overlayClosers.length > 0) {
    replaceTopOverlay(open, close, url);
  } else {
    openOverlay(open, close, url);
  }
}

function setWhoAmI(personId) {
  if (personId) {
    state.whoAmIId = personId;
    safeSetItem(WHO_AM_I_KEY, personId);
  } else {
    state.whoAmIId = null;
    safeRemoveItem(WHO_AM_I_KEY);
  }
  render();
}

function openConnectFromDetails(targetId) {
  const viewerId = getValidWhoAmI() || state.graph.defaultStartId;
  navigateConnect(viewerId, targetId);
}

function preloadImmediateThumbs(family) {
  const urls = new Set();
  const addThumb = (p) => {
    const u = getPhotoUrls(p.photo);
    if (u.thumb) urls.add(u.thumb);
  };
  family.parents.forEach(addThumb);
  family.siblings.forEach(addThumb);
  family.unions.forEach((u) => {
    if (u.spouse) addThumb(u.spouse);
    u.children.forEach(addThumb);
  });
  for (const src of urls) {
    const img = new Image();
    img.src = src;
  }
}

function createPersonNode({
  person,
  isFocused = false,
  compact = false,
  eagerPhoto = false,
  subtitle = '',
}) {
  const whoId = getValidWhoAmI();
  const isSelf = person.id === whoId;
  const years = formatYearsShort(person);

  const metaParts = [];
  if (years) metaParts.push(years);
  if (subtitle) metaParts.push(subtitle);

  const cardBtn = el(
    'button',
    {
      type: 'button',
      className: `person-card ${compact ? 'is-compact' : ''} ${isFocused ? 'is-focused' : ''}`,
      'aria-current': isFocused ? 'page' : null,
      'aria-label': `${person.name}${years ? `, ${years}` : ''}${subtitle ? `, ${subtitle}` : ''}${isFocused ? ', currently focused' : ''}`,
      onclick: () => (isFocused ? openDetailsForFocused() : navigateFocus(person.id)),
    },
    [
      createAvatar(person, compact ? 'sm' : isFocused ? 'lg' : 'md', 'thumb', eagerPhoto || isFocused),
      el('div', { className: 'person-card-text' }, [
        el('div', { className: 'person-name-row' }, [
          el('span', { className: 'person-name', textContent: person.name }),
          isSelf ? el('span', { className: 'self-tag', textContent: '(You)' }) : null,
        ]),
        metaParts.length > 0
          ? el('div', { className: 'person-meta tabular-nums', textContent: metaParts.join(' · ') })
          : null,
      ]),
      isFocused ? el('span', { className: 'focus-info-badge', 'aria-hidden': 'true' }, [svgIcon(ICONS.info, 13)]) : null,
    ]
  );

  const wrap = el('div', { className: 'person-wrap' }, [cardBtn]);

  return wrap;
}

// Tapping the focused person opens their details: a sheet on phone and tablet. Desktop already
// shows details in the sidebar, so the tap does nothing there.
function openDetailsForFocused() {
  if (getViewportInfo().layoutClass !== 'desktop') {
    openOverlay(
      () => { state.detailsSheetOpen = true; },
      () => { state.detailsSheetOpen = false; }
    );
  }
}

// Union record between two people, or null when none is recorded.
function findUnion(aId, bId) {
  return (state.graph.unionsByPerson.get(aId) || []).find((u) => u.partners.includes(bId)) || null;
}

// Marker drawn between two partners: an infinity symbol, plus the marriage and end years unless
// `stacked` (name-only cards have no room for years). Ended unions are faded.
function createUnionMarker(union, stacked = false) {
  const ended = Boolean(union && (union.ended || union.status === 'ended' || union.status === 'divorced'));
  const married = extractYear(union?.married);
  const endedYear = extractYear(union?.ended);
  return el('div', { className: `union-marker${ended ? ' is-ended' : ''}${stacked ? ' is-stacked' : ''}`, 'aria-hidden': 'true' }, [
    el('span', { className: 'union-symbol', textContent: '∞' }),
    !stacked && married ? el('span', { textContent: married }) : null,
    !stacked && endedYear ? el('span', { textContent: endedYear }) : null,
  ]);
}

// Couple card: two tappable halves joined by a union marker. With `focusLeft`, the left half is the
// focused person (tapping it opens details) and the right half is their spouse (tapping refocuses).
// Returns the card and both halves so family lines can land on the correct partner.
function createCoupleCard({ left, right, union, focusLeft = false, compact = false, eagerPhoto = false }) {
  const whoId = getValidWhoAmI();
  const married = extractYear(union?.married);

  const makeHalf = (person, isFocus) => {
    const years = formatYearsShort(person);
    // A spouse of the focused person with recorded parents gets a branch icon: their own family is one tap away.
    const showParentsHint = focusLeft && !isFocus && person.parents?.length > 0;
    return el(
      'button',
      {
        type: 'button',
        className: `couple-half${isFocus ? ' is-focused' : ''}`,
        'aria-current': isFocus ? 'page' : null,
        'aria-label': `${person.name}${years ? `, ${years}` : ''}${isFocus ? ', currently focused' : ''}`,
        onclick: () => (isFocus ? openDetailsForFocused() : navigateFocus(person.id)),
      },
      [
        createAvatar(person, 'sm', 'thumb', eagerPhoto || isFocus),
        el('div', { className: 'person-card-text' }, [
          el('div', { className: 'person-name-row' }, [
            el('span', { className: 'person-name', textContent: person.name }),
            person.id === whoId ? el('span', { className: 'self-tag', textContent: '(You)' }) : null,
            showParentsHint
              ? el('span', { className: 'spouse-parents-icon', title: UI_STRINGS.spouseParentsHint }, [svgIcon(ICONS.branch, 12)])
              : null,
          ]),
          years ? el('div', { className: 'person-meta tabular-nums', textContent: years }) : null,
        ]),
      ]
    );
  };

  const leftHalf = makeHalf(left, focusLeft);
  const rightHalf = makeHalf(right, false);
  const card = el(
    'div',
    {
      className: `couple-card${focusLeft ? ' is-focused' : ''}${compact ? ' is-compact' : ''}`,
      role: 'group',
      'aria-label': `${left.name} and ${right.name}${married ? `, married ${married}` : ''}`,
    },
    [
      leftHalf,
      createUnionMarker(union),
      rightHalf,
      focusLeft ? el('span', { className: 'focus-info-badge', 'aria-hidden': 'true' }, [svgIcon(ICONS.info, 13)]) : null,
    ]
  );
  return { card, leftHalf, rightHalf };
}

// Name-only card for generations far from the focus. Dates move to the tooltip.
function createNameCard(person) {
  const years = formatYearsShort(person);
  const label = years ? `${person.name}, ${years}` : person.name;
  return el('button', {
    type: 'button',
    className: 'name-card',
    title: label,
    'aria-label': label,
    textContent: person.name,
    onclick: () => navigateFocus(person.id),
  });
}

// Name-only couple card for distant generations: both names stacked around the union symbol.
function createNameCoupleCard(left, right, union) {
  const nameButton = (person) => {
    const years = formatYearsShort(person);
    const label = years ? `${person.name}, ${years}` : person.name;
    return el('button', {
      type: 'button',
      className: 'name-couple-name',
      title: label,
      'aria-label': label,
      textContent: person.name,
      onclick: () => navigateFocus(person.id),
    });
  };
  return el('div', { className: 'name-couple', role: 'group', 'aria-label': `${left.name} and ${right.name}` }, [
    nameButton(left),
    createUnionMarker(union, true),
    nameButton(right),
  ]);
}

// Horizontal row holding one generation. It never wraps: when it overflows it scrolls sideways,
// with edge buttons on devices that have a pointer. `onScroll` lets family lines follow the scroll.
function createGenerationStrip(children, onScroll, extraClass = '') {
  const strip = el('div', { className: `gen-strip ${extraClass}`.trim() }, children);
  const step = (dir) => strip.scrollBy({ left: dir * strip.clientWidth * 0.7, behavior: 'smooth' });
  const leftBtn = el('button', {
    type: 'button',
    className: 'gen-strip-arrow is-left',
    'aria-label': UI_STRINGS.scrollLeft,
    hidden: true,
    onclick: () => step(-1),
  }, [svgIcon('m15 18-6-6 6-6', 16)]);
  const rightBtn = el('button', {
    type: 'button',
    className: 'gen-strip-arrow is-right',
    'aria-label': UI_STRINGS.scrollRight,
    hidden: true,
    onclick: () => step(1),
  }, [svgIcon('m9 18 6-6-6-6', 16)]);

  const updateArrows = () => {
    leftBtn.hidden = strip.scrollLeft <= 2;
    rightBtn.hidden = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
  };
  strip.addEventListener('scroll', () => {
    updateArrows();
    onScroll();
  }, { passive: true });

  return { wrap: el('div', { className: 'gen-strip-wrap' }, [strip, leftBtn, rightBtn]), strip, updateArrows };
}

// Scrolls a strip so `target` is centred, or centres the whole row when there is no target.
function centerStrip(strip, target) {
  strip.scrollLeft = target
    ? target.offsetLeft - (strip.clientWidth - target.offsetWidth) / 2
    : (strip.scrollWidth - strip.clientWidth) / 2;
}

// Draws family lines over `canvas`. Each link runs from the bottom centre of its origin to the top
// centre of each target, through a horizontal bar halfway between. Links hold functions so they can
// be resolved after every row exists and re-resolved on each redraw.
function drawFamilyLines(canvas, svg, links) {
  const cRect = canvas.getBoundingClientRect();
  if (cRect.width === 0 || cRect.height === 0) return;

  svg.setAttribute('width', String(cRect.width));
  svg.setAttribute('height', String(cRect.height));
  svg.textContent = '';

  const boxOf = (node) => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { top: r.top - cRect.top, bottom: r.bottom - cRect.top, cx: r.left - cRect.left + r.width / 2 };
  };

  const addPath = (d) => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', '#CFC8BB');
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
  };

  for (const link of links) {
    const o = boxOf(link.origin());
    if (!o) continue;
    const targets = link.targets().map(boxOf).filter(Boolean);
    if (targets.length === 0) continue;
    const minTop = Math.min(...targets.map((t) => t.top));
    const midY = o.bottom + Math.max(8, (minTop - o.bottom) / 2);
    const xs = targets.map((t) => t.cx).concat(o.cx);
    addPath(`M ${o.cx} ${o.bottom} L ${o.cx} ${midY} M ${Math.min(...xs)} ${midY} L ${Math.max(...xs)} ${midY}`);
    for (const t of targets) addPath(`M ${t.cx} ${midY} L ${t.cx} ${t.top}`);
  }
}

// Per-device tree settings. `rowBudget` counts generation rows besides the focus row.
// `nameOnlyFrom` is the generation distance at which cards drop the photo and dates.
function getTreeLayoutConfig(layoutClass) {
  return layoutClass === 'phone' ? { rowBudget: 4, nameOnlyFrom: 2 } : { rowBudget: 6, nameOnlyFrom: 3 };
}

// Splits the row budget evenly above and below the focus row. A side with fewer generations gives
// its unused rows to the other side.
function splitRowBudget(upAvailable, downAvailable, budget) {
  let up = Math.min(upAvailable, Math.floor(budget / 2));
  const down = Math.min(downAvailable, budget - up);
  up = Math.min(upAvailable, budget - down);
  return { up, down };
}

// Row label for the generation `distance` steps above ('up') or below ('down') the focus.
function generationLabel(distance, direction) {
  const names = direction === 'up'
    ? [UI_STRINGS.parents, UI_STRINGS.grandparents, UI_STRINGS.greatGrandparents]
    : [UI_STRINGS.children, UI_STRINGS.grandchildren, UI_STRINGS.greatGrandchildren];
  if (distance <= names.length) return names[distance - 1];
  return `${distance - 2}× ${names[2].toLowerCase()}`;
}

// Text for the pill that marks generations left out by the row budget.
function hiddenGenerationsText(count, direction) {
  return `${direction === 'up' ? '▲' : '▼'} ${count} more generation${count > 1 ? 's' : ''} ${direction === 'up' ? 'above' : 'below'}`;
}

// Inline prompt used by keyboard navigation when an arrow key has several possible targets.
function renderKeyboardPrompt() {
  return el('div', { className: 'kb-prompt', role: 'dialog', 'aria-label': state.keyboardPrompt.title }, [
    el('span', { style: { fontWeight: '600', color: 'var(--accent-forest)' }, textContent: `${state.keyboardPrompt.title}:` }),
    el(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' } },
      [
        ...state.keyboardPrompt.choices.map((c, idx) =>
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-outline',
              style: { minHeight: '34px', padding: '0 10px' },
              onclick: () => navigateFocus(c.id),
            },
            [
              el('span', { className: 'tabular-nums', style: { color: 'var(--text-secondary)', fontSize: '12px' }, textContent: `${idx + 1}.` }),
              el('span', { textContent: c.name }),
            ]
          )
        ),
        el('button', {
          type: 'button',
          className: 'btn btn-ghost',
          style: { minHeight: '34px' },
          textContent: 'Esc',
          onclick: () => {
            state.keyboardPrompt = null;
            render();
          },
        }),
      ]
    ),
  ]);
}

let activeConnectorObserver = null;
// Focus person whose row was last scrolled into view, so re-renders for other reasons keep the scroll.
let lastCenteredFocusId = null;
// Which partner of the focused person the couple card shows. Resets when the focus changes.
const spousePage = { personId: null, index: 0 };

// Pager on the focus unit that cycles through the focused person's partners and the children of each.
function createSpousePager(pageCount) {
  const current = (spousePage.index % pageCount) + 1;
  return el('button', {
    type: 'button',
    className: 'spouse-pager',
    'aria-label': `${UI_STRINGS.nextSpouse} (${current} of ${pageCount})`,
    onclick: () => {
      spousePage.index = (spousePage.index + 1) % pageCount;
      render();
    },
  }, [`${current}/${pageCount} ›`]);
}

// Brings the focus row to the vertical centre of the window when the tree is taller than the window.
function scrollFocusRowIntoView(row) {
  if (document.documentElement.scrollHeight <= window.innerHeight) {
    window.scrollTo(0, 0);
    return;
  }
  const r = row.getBoundingClientRect();
  window.scrollTo(0, Math.max(0, window.scrollY + r.top + r.height / 2 - window.innerHeight / 2));
}

// Focus tree. Each generation is one row that never wraps. The focus row holds the siblings around a
// couple card (focused person + spouse). Ancestor rows (direct line only) sit above and descendant rows
// below, sharing a per-device row budget. Generations far from the focus use name-only cards.
function renderFocusCanvas(family, viewport) {
  const { rowBudget, nameOnlyFrom } = getTreeLayoutConfig(viewport.layoutClass);
  const focus = family.person;

  // Each union group (spouse, or co-parent-less children) is one page of the couple card.
  if (spousePage.personId !== focus.id) {
    spousePage.personId = focus.id;
    spousePage.index = 0;
  }
  const pages = family.unions;
  const page = pages.length > 0 ? pages[spousePage.index % pages.length] : null;
  const children = page ? page.children : [];

  const ancestorLevels = getAncestorLevels(state.graph, focus.id);
  const descendantLevels = getDescendantLevels(state.graph, children);
  const { up, down } = splitRowBudget(ancestorLevels.length, descendantLevels.length, rowBudget);

  preloadImmediateThumbs(family);

  const canvas = el('div', { className: 'tree-canvas' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'connector-svg');
  canvas.appendChild(svg);

  const links = [];
  const strips = [];
  const scheduleDraw = () => requestAnimationFrame(() => drawFamilyLines(canvas, svg, links));
  const addStrip = (items, center = null, extraClass = '') => {
    const s = createGenerationStrip(items, scheduleDraw, extraClass);
    strips.push({ ...s, center });
    return s.wrap;
  };

  // Element that receives the line from each person's parents.
  const tops = new Map();

  if (state.keyboardPrompt) canvas.appendChild(renderKeyboardPrompt());

  const tiers = el('div', { className: 'tree-tiers' });
  const addRow = (label, content) => {
    const row = el('section', { className: 'tier-section', 'aria-label': label || null }, [
      label ? el('span', { className: 'tier-label', textContent: label }) : null,
      content,
    ]);
    tiers.appendChild(row);
    return row;
  };
  const addHiddenGenerations = (count, direction) =>
    tiers.appendChild(el('p', { className: 'more-generations', textContent: hiddenGenerationsText(count, direction) }));

  // Ancestor rows, furthest first. Each unit is the parents of one person in the row below.
  if (ancestorLevels.length > up) addHiddenGenerations(ancestorLevels.length - up, 'up');
  for (let distance = up; distance >= 1; distance--) {
    const nameOnly = distance >= nameOnlyFrom;
    const units = ancestorLevels[distance - 1].map((unit) => {
      const [a, b] = unit.people;
      let node;
      if (b && nameOnly) {
        node = createNameCoupleCard(a, b, findUnion(a.id, b.id));
        tops.set(a.id, node);
        tops.set(b.id, node);
      } else if (b) {
        const couple = createCoupleCard({ left: a, right: b, union: findUnion(a.id, b.id), compact: distance > 1, eagerPhoto: distance === 1 });
        node = couple.card;
        tops.set(a.id, couple.leftHalf);
        tops.set(b.id, couple.rightHalf);
      } else if (nameOnly) {
        node = createNameCard(a);
        tops.set(a.id, node);
      } else {
        node = createPersonNode({ person: a, compact: distance > 1, subtitle: distance === 1 ? parentRoleLabel(a) : '', eagerPhoto: distance === 1 });
        tops.set(a.id, node);
      }
      return { node, childId: unit.childId };
    });
    addRow(generationLabel(distance, 'up'), addStrip(units.map((u) => u.node)));
    for (const u of units) {
      // Parents connect to the focused person and every sibling; older ancestors to their one child.
      const targets = distance === 1
        ? () => [...family.siblings, focus].map((p) => tops.get(p.id))
        : () => [tops.get(u.childId)];
      links.push({ origin: () => u.node, targets });
    }
  }
  if (ancestorLevels.length === 0) {
    addRow(null, el('p', { className: 'muted-empty', textContent: UI_STRINGS.unknownParents }));
  }

  // Focus row: older siblings, the focus unit (couple card or single card, with the spouse pager), younger siblings.
  let focusUnit;
  if (page?.spouse) {
    const couple = createCoupleCard({ left: focus, right: page.spouse, union: page.union, focusLeft: true, eagerPhoto: true });
    focusUnit = couple.card;
    tops.set(focus.id, couple.leftHalf);
  } else {
    focusUnit = createPersonNode({ person: focus, isFocused: true, eagerPhoto: true });
    tops.set(focus.id, focusUnit);
  }
  const focusUnitWrap = el('div', { className: 'focus-unit' }, [focusUnit, pages.length > 1 ? createSpousePager(pages.length) : null]);

  const generation = [...family.siblings, focus].sort(sortByBirthThenName);
  const focusIndex = generation.indexOf(focus);
  const siblingNode = (person) => {
    const node = createPersonNode({ person, compact: true, eagerPhoto: true });
    tops.set(person.id, node);
    return node;
  };
  const focusRowLabel = family.siblings.length > 0
    ? `${UI_STRINGS.siblings} · ${page?.spouse ? UI_STRINGS.focusAndSpouse : UI_STRINGS.focus}`
    : page?.spouse ? UI_STRINGS.focusAndSpouseTitle : null;
  const focusRow = addRow(
    focusRowLabel,
    addStrip(
      [
        ...generation.slice(0, focusIndex).map(siblingNode),
        focusUnitWrap,
        ...generation.slice(focusIndex + 1).map(siblingNode),
      ],
      focusUnitWrap
    )
  );

  // Descendant rows, nearest first. Children hang from the focus unit, later generations from their parent's card.
  const bottoms = new Map();
  for (let distance = 1; distance <= down; distance++) {
    const nameOnly = distance >= nameOnlyFrom;
    const groups = descendantLevels[distance - 1].map((group) => {
      const cards = group.kids.map((kid) => {
        const node = nameOnly
          ? createNameCard(kid)
          : createPersonNode({ person: kid, compact: distance > 1, eagerPhoto: distance === 1 });
        bottoms.set(kid.id, node);
        return node;
      });
      links.push({ origin: () => (group.parentId ? bottoms.get(group.parentId) : focusUnit), targets: () => cards });
      return el('div', { className: 'gen-group' }, cards);
    });
    addRow(generationLabel(distance, 'down'), addStrip(groups, null, 'has-groups'));
  }
  if (children.length === 0) {
    addRow(null, el('p', { className: 'muted-empty', textContent: UI_STRINGS.noChildren }));
  }
  if (descendantLevels.length > down) addHiddenGenerations(descendantLevels.length - down, 'down');

  canvas.appendChild(tiers);

  const refreshLayout = () => {
    strips.forEach((s) => s.updateArrows());
    scheduleDraw();
  };
  if (activeConnectorObserver) activeConnectorObserver.disconnect();
  activeConnectorObserver = new ResizeObserver(refreshLayout);
  activeConnectorObserver.observe(canvas);

  // Once the canvas is in the document: centre every strip (the focus row on the focus unit), then
  // bring the focus row into view if the focus changed since the last render.
  requestAnimationFrame(() => {
    for (const s of strips) centerStrip(s.strip, s.center);
    if (lastCenteredFocusId !== focus.id) {
      lastCenteredFocusId = focus.id;
      scrollFocusRowIntoView(focusRow);
    }
    refreshLayout();
  });

  return canvas;
}

function renderRelativeRow(person, note, onPick) {
  const years = formatYearsShort(person);
  const sub = [years, note].filter(Boolean).join(' · ');
  return el(
    'button',
    {
      type: 'button',
      className: 'relative-row',
      onclick: () => onPick(person.id),
    },
    [
      createAvatar(person, 'sm', 'thumb', false),
      el('div', { className: 'person-card-text' }, [
        el('div', { style: { fontSize: '15px', fontWeight: '500' }, textContent: person.name }),
        sub ? el('div', { className: 'person-meta tabular-nums', textContent: sub }) : null,
      ]),
    ]
  );
}

function renderPersonDetailsContent(family, layoutClass, onClose) {
  const { person } = family;
  const isLiving = !person.died;
  const bornDisplay = formatDateForDetails(person.born);
  const diedDisplay = formatDateForDetails(person.died);
  const currentLocation = person.location || person.residence;
  const whoId = getValidWhoAmI();
  const relText = getRelationshipToViewer(state.graph, whoId, person.id, state.kinshipVocab);

  const body = el('div', { className: 'details-body' });

  const detailSrc = getPhotoUrls(person.photo).detail;
  const avatarNode = createAvatar(person, 'xl', 'detail', true);
  let headerAvatar = avatarNode;
  if (detailSrc) {
    const imgEl = avatarNode.querySelector('img');
    const zoomBtn = el('button', {
      type: 'button',
      className: 'avatar-zoom-btn',
      'aria-label': `View larger photo of ${person.name}`,
      onclick: () => {
        if (!imgEl || !imgEl.isConnected) return;
        openOverlay(
          () => { state.photoPreview = { src: detailSrc, name: person.fullName || person.name }; },
          () => { state.photoPreview = null; }
        );
      },
    }, [avatarNode]);
    if (imgEl) {
      imgEl.addEventListener('error', () => {
        zoomBtn.disabled = true;
        zoomBtn.style.cursor = 'default';
      });
    }
    headerAvatar = zoomBtn;
  }

  // Header
  body.appendChild(
    el('div', { className: 'details-header' }, [
      headerAvatar,
      el('div', { style: { minWidth: '0', flex: '1' } }, [
        el('h2', { className: 'details-name', textContent: person.name }),
        person.fullName && person.fullName !== person.name
          ? el('p', { className: 'details-fullname', textContent: person.fullName })
          : null,
        person.altName
          ? el('p', { style: { margin: '2px 0 0', fontSize: '15px', color: 'var(--text-secondary)' }, textContent: person.altName })
          : null,
        person.id === whoId
          ? el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginTop: '4px' } }, [
              relText ? el('p', { className: 'details-relation', style: { margin: '0' }, textContent: relText }) : null,
              el('button', {
                type: 'button',
                className: 'text-link-muted',
                textContent: UI_STRINGS.notMe,
                onclick: () => setWhoAmI(null),
              }),
            ])
          : el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', marginTop: '4px' } }, [
              relText ? el('p', { className: 'details-relation', style: { margin: '0' }, textContent: relText }) : null,
              el('button', {
                type: 'button',
                className: 'text-link',
                style: { paddingLeft: '0' },
                textContent: UI_STRINGS.thisIsMe,
                onclick: () => setWhoAmI(person.id),
              }),
            ]),
      ]),
    ])
  );

  // Actions
  const actions = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } });
  if (person.id !== whoId) {
    actions.appendChild(
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-soft btn-sm',
          onclick: () => openConnectFromDetails(person.id),
        },
        [svgIcon(ICONS.connect, 14), el('span', { textContent: UI_STRINGS.howConnected })]
      )
    );
  }
  if (onClose && layoutClass !== 'desktop') {
    actions.appendChild(
      el('button', {
        type: 'button',
        className: 'btn btn-primary btn-sm',
        textContent: UI_STRINGS.viewFamily,
        onclick: () => navigateFocus(person.id),
      })
    );
  }
  if (actions.childNodes.length > 0) body.appendChild(actions);

  // Vital metadata
  const rows = [];
  if (bornDisplay) rows.push([UI_STRINGS.bornLabel, bornDisplay, true]);
  if (diedDisplay) rows.push([UI_STRINGS.diedLabel, diedDisplay, true]);
  if (currentLocation) {
    rows.push([isLiving ? UI_STRINGS.currentlyStayingLabel : UI_STRINGS.lastLivedLabel, currentLocation, false]);
  }
  if (person.birthplace) rows.push([UI_STRINGS.birthplaceLabel, person.birthplace, false]);

  if (rows.length > 0) {
    body.appendChild(
      el(
        'dl',
        { className: 'meta-list' },
        rows.map(([label, val, tabular]) =>
          el('div', { className: 'meta-row' }, [
            el('dt', { textContent: label }),
            el('dd', { className: tabular ? 'tabular-nums' : '', textContent: val }),
          ])
        )
      )
    );
  }

  // Notes
  if (person.notes) {
    body.appendChild(
      el('section', {}, [
        el('h3', { className: 'section-heading', textContent: UI_STRINGS.notesLabel }),
        el('p', {
          style: { margin: '6px 0 0', fontSize: '15px', lineHeight: '1.6', whiteSpace: 'pre-line' },
          textContent: person.notes,
        }),
      ])
    );
  }

  const pickRelative = (id) => {
    navigateFocus(id);
  };

  if (family.parents.length > 0) {
    body.appendChild(
      el('section', {}, [
        el('h3', { className: 'section-heading', textContent: UI_STRINGS.parents }),
        ...family.parents.map((p) => renderRelativeRow(p, parentRoleLabel(p), pickRelative)),
      ])
    );
  }

  const spouses = family.unions
    .filter((u) => u.spouse)
    .map((u) => ({
      spouse: u.spouse,
      married: u.union?.married ? formatDateForDetails(u.union.married) : '',
      ended: u.union?.ended ? formatDateForDetails(u.union.ended) : '',
    }));

  if (spouses.length > 0) {
    body.appendChild(
      el('section', {}, [
        el('h3', { className: 'section-heading', textContent: spouses.length > 1 ? 'Spouses' : 'Spouse' }),
        ...spouses.map(({ spouse, married, ended }) =>
          renderRelativeRow(
            spouse,
            married ? (ended ? `m. ${married} – ${ended}` : `m. ${married}`) : '',
            pickRelative
          )
        ),
      ])
    );
  }

  if (family.siblings.length > 0) {
    body.appendChild(
      el('section', {}, [
        el('h3', { className: 'section-heading', textContent: UI_STRINGS.siblings }),
        ...family.siblings.map((s) => renderRelativeRow(s, '', pickRelative)),
      ])
    );
  }

  const allChildren = family.unions.flatMap((u) => u.children);
  if (allChildren.length > 0) {
    body.appendChild(
      el('section', {}, [
        el('h3', { className: 'section-heading', textContent: UI_STRINGS.children }),
        ...allChildren.map((c) => renderRelativeRow(c, '', pickRelative)),
      ])
    );
  }

  return body;
}

function createDesktopSearchBar() {
  const wrap = el('div', { className: 'desktop-search-wrap' });
  const input = el('input', {
    id: 'desktop-search-input',
    type: 'search',
    className: 'search-input',
    placeholder: UI_STRINGS.searchPlaceholder,
    'aria-label': UI_STRINGS.searchPlaceholder,
  });
  const clearBtn = el(
    'button',
    {
      type: 'button',
      className: 'search-clear',
      'aria-label': 'Clear search',
      style: { display: 'none' },
    },
    [svgIcon(ICONS.close, 15)]
  );
  const kbd = el('kbd', { className: 'kbd-hint', textContent: '/' });
  const dropdown = el('div', {
    className: 'search-dropdown',
    role: 'listbox',
    style: { display: 'none' },
  });

  let activeIdx = 0;
  let currentResults = [];

  const updateDropdown = () => {
    const q = input.value;
    clearBtn.style.display = q ? 'flex' : 'none';
    kbd.style.display = q ? 'none' : '';
    if (!q.trim()) {
      dropdown.style.display = 'none';
      dropdown.textContent = '';
      currentResults = [];
      return;
    }
    currentResults = searchPeople(state.graph, q).slice(0, 14);
    activeIdx = 0;
    dropdown.textContent = '';
    dropdown.style.display = 'block';

    if (currentResults.length === 0) {
      dropdown.appendChild(
        el('p', {
          style: { padding: '16px', textAlign: 'center', fontSize: '14px', color: 'var(--text-secondary)', margin: '0' },
          textContent: UI_STRINGS.searchEmpty,
        })
      );
      return;
    }

    currentResults.forEach((p, idx) => {
      const years = formatYearsShort(p);
      dropdown.appendChild(
        el(
          'button',
          {
            type: 'button',
            role: 'option',
            className: `search-result-row ${idx === activeIdx ? 'is-active' : ''}`,
            onclick: () => {
              input.value = '';
              dropdown.style.display = 'none';
              navigateFocus(p.id);
            },
          },
          [
            createAvatar(p, 'sm', 'thumb', false),
            el('div', { className: 'person-card-text' }, [
              el('div', { style: { fontSize: '14px', fontWeight: '500' }, textContent: p.name }),
              p.fullName && p.fullName !== p.name
                ? el('div', { className: 'person-meta', textContent: p.fullName })
                : null,
            ]),
            years ? el('span', { className: 'tabular-nums', style: { fontSize: '12px', color: 'var(--text-secondary)' }, textContent: years }) : null,
          ]
        )
      );
    });
  };

  input.addEventListener('input', updateDropdown);
  input.addEventListener('focus', updateDropdown);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.style.display = 'none';
      input.blur();
    } else if (e.key === 'ArrowDown' && currentResults.length > 0) {
      e.preventDefault();
      activeIdx = Math.min(currentResults.length - 1, activeIdx + 1);
      Array.from(dropdown.children).forEach((c, i) => c.classList.toggle('is-active', i === activeIdx));
    } else if (e.key === 'ArrowUp' && currentResults.length > 0) {
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
      Array.from(dropdown.children).forEach((c, i) => c.classList.toggle('is-active', i === activeIdx));
    } else if (e.key === 'Enter' && currentResults[activeIdx]) {
      e.preventDefault();
      const target = currentResults[activeIdx];
      input.value = '';
      dropdown.style.display = 'none';
      navigateFocus(target.id);
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    updateDropdown();
    input.focus();
  });

  document.addEventListener(
    'mousedown',
    (e) => {
      if (!wrap.contains(e.target)) dropdown.style.display = 'none';
    },
    { passive: true }
  );

  wrap.appendChild(
    el('div', { className: 'search-input-box' }, [
      svgIcon(ICONS.search, 16, 'search-icon'),
      input,
      clearBtn,
      kbd,
    ])
  );
  wrap.appendChild(dropdown);
  return wrap;
}

function renderPhoneSearchModal() {
  const modal = el('div', { className: 'fullscreen-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search relatives' });
  const input = el('input', {
    type: 'search',
    className: 'search-input',
    style: { height: '48px', fontSize: '16px', paddingLeft: '40px' },
    placeholder: UI_STRINGS.searchPlaceholder,
    'aria-label': UI_STRINGS.searchPlaceholder,
  });
  const list = el('div', { style: { flex: '1', overflowY: 'auto', padding: '8px 12px' } });

  const renderList = () => {
    const matches = searchPeople(state.graph, input.value);
    list.textContent = '';
    if (matches.length === 0) {
      list.appendChild(
        el('p', { style: { padding: '48px 16px', textAlign: 'center', color: 'var(--text-secondary)' }, textContent: UI_STRINGS.searchEmpty })
      );
      return;
    }
    for (const p of matches) {
      const years = formatYearsShort(p);
      list.appendChild(
        el(
          'button',
          {
            type: 'button',
            className: 'relative-row',
            style: { borderBottom: '1px solid #EFECE6', borderRadius: '0', minHeight: '56px' },
            onclick: () => {
              state.phoneSearchOpen = false;
              navigateFocus(p.id);
            },
          },
          [
            createAvatar(p, 'md', 'thumb', false),
            el('div', { className: 'person-card-text' }, [
              el('div', { style: { fontSize: '16px', fontWeight: '500' }, textContent: p.name }),
              p.fullName && p.fullName !== p.name
                ? el('div', { className: 'person-meta', style: { fontSize: '13px' }, textContent: p.fullName })
                : null,
            ]),
            years ? el('span', { className: 'tabular-nums', style: { fontSize: '13px', color: 'var(--text-secondary)' }, textContent: years }) : null,
          ]
        )
      );
    }
  };

  input.addEventListener('input', renderList);
  renderList();

  modal.appendChild(
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderBottom: '1px solid var(--border-hairline)', background: 'var(--bg-surface)' } }, [
      el('div', { className: 'search-input-box', style: { flex: '1' } }, [
        svgIcon(ICONS.search, 18, 'search-icon'),
        input,
      ]),
      el('button', {
        type: 'button',
        className: 'btn btn-ghost',
        style: { color: 'var(--accent-forest)' },
        textContent: UI_STRINGS.close,
        onclick: closeOverlay,
      }),
    ])
  );
  modal.appendChild(list);
  setTimeout(() => input.focus(), 50);
  return modal;
}


function createConnectPicker(label, selected, onPick) {
  const wrap = el('div', { style: { position: 'relative', flex: '1', minWidth: '160px' } });
  wrap.appendChild(el('span', { className: 'tier-label', style: { display: 'block', marginBottom: '4px' }, textContent: label }));

  const menu = el('div', {
    className: 'search-dropdown',
    style: { display: 'none', maxHeight: '260px' },
  });
  const filterInput = el('input', {
    type: 'search',
    className: 'search-input',
    style: { height: '36px', paddingLeft: '10px', paddingRight: '10px', marginBottom: '6px' },
    placeholder: UI_STRINGS.searchPlaceholder,
  });
  const list = el('div');

  const fillList = () => {
    list.textContent = '';
    for (const p of searchPeople(state.graph, filterInput.value).slice(0, 20)) {
      list.appendChild(
        el(
          'button',
          {
            type: 'button',
            className: 'search-result-row',
            onclick: () => {
              menu.style.display = 'none';
              onPick(p.id);
            },
          },
          [
            createAvatar(p, 'sm', 'thumb', false),
            el('div', { className: 'person-card-text' }, [
              el('div', { style: { fontSize: '14px', fontWeight: '500' }, textContent: p.name }),
              p.fullName && p.fullName !== p.name
                ? el('div', { className: 'person-meta', textContent: p.fullName })
                : null,
            ]),
            el('span', { className: 'tabular-nums', style: { fontSize: '12px', color: 'var(--text-secondary)' }, textContent: formatYearsShort(p) }),
          ]
        )
      );
    }
  };
  filterInput.addEventListener('input', fillList);

  const trigger = el(
    'button',
    {
      type: 'button',
      className: 'btn btn-outline',
      style: { width: '100%', justifyContent: 'space-between', padding: '4px 10px' },
      onclick: () => {
        const opening = menu.style.display === 'none';
        menu.style.display = opening ? 'block' : 'none';
        if (opening) {
          fillList();
          setTimeout(() => filterInput.focus(), 20);
        }
      },
    },
    [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' } }, [
        createAvatar(selected, 'sm', 'thumb', false),
        el('span', { style: { fontSize: '14px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis' }, textContent: selected.name }),
      ]),
      svgIcon(ICONS.chevronDown, 16),
    ]
  );

  menu.appendChild(filterInput);
  menu.appendChild(list);
  wrap.appendChild(trigger);
  wrap.appendChild(menu);
  return wrap;
}

function renderConnectionFinder(fromId, toId, viewport) {
  const fromPerson = state.graph.peopleById.get(fromId);
  const toPerson = state.graph.peopleById.get(toId);
  if (!fromPerson || !toPerson) return null;

  const isDesktop = viewport.layoutClass === 'desktop';
  const paths =
    fromId === toId ? [] : findShortestConnections(state.graph, fromId, toId, state.kinshipVocab);
  const shown = paths.slice(0, state.connectVisibleCount);

  const container = el('div', {
    className: isDesktop ? 'modal-backdrop' : 'fullscreen-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'connect-title',
  });

  const panel = el('div', {
    className: isDesktop ? 'modal-card is-wide' : '',
    style: isDesktop ? {} : { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-surface)' },
  });

  panel.appendChild(
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--border-hairline)' } }, [
      el('h2', { id: 'connect-title', style: { margin: '0', fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: '600' }, textContent: UI_STRINGS.connectionTitle }),
      el('button', {
        type: 'button',
        className: 'btn btn-ghost',
        'aria-label': UI_STRINGS.close,
        onclick: () => (overlayClosers.length > 0 ? closeOverlay() : navigateFocus(toId)),
      }, [svgIcon(ICONS.close, 20)]),
    ])
  );

  panel.appendChild(
    el('div', { style: { padding: '14px 20px', borderBottom: '1px solid var(--border-hairline)', background: 'var(--bg-canvas)', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' } }, [
      createConnectPicker(UI_STRINGS.connectionFromLabel, fromPerson, (id) => navigateConnect(id, toId)),
      el('button', {
        type: 'button',
        className: 'btn btn-outline',
        'aria-label': 'Swap people',
        onclick: () => navigateConnect(toId, fromId),
      }, [svgIcon(ICONS.swap, 16)]),
      createConnectPicker(UI_STRINGS.connectionToLabel, toPerson, (id) => navigateConnect(fromId, id)),
    ])
  );

  const body = el('div', { style: { flex: '1', overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' } });

  if (fromId === toId) {
    body.appendChild(el('p', { style: { textAlign: 'center', padding: '48px 0', color: 'var(--text-secondary)' }, textContent: UI_STRINGS.connectionSamePerson }));
  } else if (paths.length === 0) {
    body.appendChild(
      el('div', { style: { textAlign: 'center', padding: '48px 16px', maxWidth: '420px', margin: '0 auto' } }, [
        el('p', { style: { margin: '0', fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: '600' }, textContent: UI_STRINGS.connectionNone }),
        el('p', { style: { margin: '6px 0 0', fontSize: '14px', color: 'var(--text-secondary)' }, textContent: UI_STRINGS.connectionNoneDetail }),
      ])
    );
  } else {
    shown.forEach((path, pIdx) => {
      const chainChildren = [];
      path.nodes.forEach((node, nIdx) => {
        const years = formatYearsShort(node);
        chainChildren.push(
          el(
            'button',
            {
              type: 'button',
              className: 'connect-node-btn',
              onclick: () => navigateFocus(node.id),
            },
            [
              createAvatar(node, 'sm', 'thumb', false),
              el('div', {}, [
                el('div', { style: { fontSize: '15px', fontWeight: '500', whiteSpace: 'nowrap' }, textContent: node.name }),
                years ? el('div', { className: 'person-meta tabular-nums', textContent: years }) : null,
              ]),
            ]
          )
        );

        const step = path.steps[nIdx];
        if (step) {
          chainChildren.push(
            el('div', { className: `connect-step-label ${step.isMarriage ? 'is-marriage' : ''}` }, [
              svgIcon(isDesktop ? ICONS.arrowRight : ICONS.arrowDown, 14),
              el('span', { textContent: `${step.linkLabel}${step.isMarriage ? ' (marriage)' : ''}` }),
            ])
          );
        }
      });

      const summaryP = el('p', { style: { margin: '14px 0 0', paddingTop: '10px', borderTop: '1px solid var(--border-hairline)', fontSize: '14px' } });
      summaryP.append(
        el('strong', { textContent: toPerson.name }),
        ' is ',
        el('strong', { textContent: fromPerson.name }),
        "'s ",
        el('strong', { style: { color: 'var(--accent-forest)' }, textContent: path.summary }),
        '.'
      );

      body.appendChild(
        el('section', { className: 'connect-path-card', 'aria-label': `${UI_STRINGS.pathLabel} ${pIdx + 1}` }, [
          el('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '12px', color: 'var(--text-secondary)' } }, [
            el('span', { textContent: `${UI_STRINGS.pathLabel} ${pIdx + 1} · ${path.usesMarriage ? UI_STRINGS.connectionMarriageMarker : 'blood relative'}` }),
            el('span', { className: 'tabular-nums', textContent: `${path.steps.length} ${path.steps.length === 1 ? 'step' : 'steps'}` }),
          ]),
          el('div', { className: 'connect-chain' }, chainChildren),
          summaryP,
        ])
      );
    });

    if (paths.length > state.connectVisibleCount) {
      body.appendChild(
        el('div', { style: { display: 'flex', justifyContent: 'center' } }, [
          el('button', {
            type: 'button',
            className: 'btn btn-outline',
            textContent: `${UI_STRINGS.connectionShowMore} (${paths.length - state.connectVisibleCount} remaining)`,
            onclick: () => {
              state.connectVisibleCount += 5;
              render();
            },
          }),
        ])
      );
    }
  }

  panel.appendChild(body);
  container.appendChild(panel);
  return container;
}

function renderOverviewModal(focusedId) {
  const depthMemo = new Map();
  const getDepth = (id, visiting = new Set()) => {
    if (depthMemo.has(id)) return depthMemo.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const p = state.graph.peopleById.get(id);
    const parents = (p?.parents || []).filter((pid) => state.graph.peopleById.has(pid));
    if (parents.length === 0) {
      depthMemo.set(id, 0);
      return 0;
    }
    const d = 1 + Math.max(...parents.map((pid) => getDepth(pid, visiting)));
    depthMemo.set(id, d);
    return d;
  };
  for (const p of state.graph.peopleList) getDepth(p.id);
  for (const u of state.graph.unions) {
    const [a, b] = u.partners;
    const pa = state.graph.peopleById.get(a);
    const pb = state.graph.peopleById.get(b);
    if (pa && !pa.parents?.length && (depthMemo.get(a) ?? 0) === 0 && (depthMemo.get(b) ?? 0) > 0) {
      depthMemo.set(a, depthMemo.get(b));
    }
    if (pb && !pb.parents?.length && (depthMemo.get(b) ?? 0) === 0 && (depthMemo.get(a) ?? 0) > 0) {
      depthMemo.set(b, depthMemo.get(a));
    }
  }

  const tiers = new Map();
  for (const p of state.graph.peopleList) {
    const d = depthMemo.get(p.id) ?? 0;
    const arr = tiers.get(d) || [];
    arr.push(p);
    tiers.set(d, arr);
  }
  const generations = Array.from(tiers.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([gen, members]) => ({
      gen,
      members: members.sort((a, b) => extractYear(a.born).localeCompare(extractYear(b.born))),
    }));

  const modal = el('div', { className: 'fullscreen-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'overview-title' });
  const zoomLabel = el('span', { className: 'tabular-nums', style: { width: '48px', textAlign: 'center', fontSize: '12px', color: 'var(--text-secondary)' }, textContent: `${Math.round(state.overviewScale * 100)}%` });

  const stage = el('div', {
    style: { flex: '1', overflow: 'hidden', cursor: 'grab', position: 'relative' },
  });
  const canvas = el('div', {
    style: {
      maxWidth: '1150px',
      margin: '0 auto',
      padding: '32px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '28px',
      transformOrigin: 'top center',
      transform: `translate(${state.overviewOffset.x}px, ${state.overviewOffset.y}px) scale(${state.overviewScale})`,
    },
  });

  const applyTransform = () => {
    zoomLabel.textContent = `${Math.round(state.overviewScale * 100)}%`;
    canvas.style.transform = `translate(${state.overviewOffset.x}px, ${state.overviewOffset.y}px) scale(${state.overviewScale})`;
  };

  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = { sx: e.clientX, sy: e.clientY, ox: state.overviewOffset.x, oy: state.overviewOffset.y };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    state.overviewOffset = { x: drag.ox + (e.clientX - drag.sx), y: drag.oy + (e.clientY - drag.sy) };
    applyTransform();
  });
  stage.addEventListener('pointerup', () => { drag = null; });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.overviewScale = Math.min(1.6, Math.max(0.5, Number((state.overviewScale + (e.deltaY > 0 ? -0.08 : 0.08)).toFixed(2))));
    applyTransform();
  }, { passive: false });

  for (const { gen, members } of generations) {
    canvas.appendChild(
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
          el('span', { className: 'tier-label', textContent: `Generation ${gen + 1}` }),
          el('div', { style: { height: '1px', flex: '1', background: 'var(--border-hairline)' } }),
        ]),
        el(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: '10px' } },
          members.map((p) =>
            el(
              'button',
              {
                type: 'button',
                className: 'connect-node-btn',
                style: p.id === focusedId ? { borderWidth: '2px', borderColor: 'var(--accent-forest)', background: 'var(--accent-forest-soft)' } : {},
                onclick: () => {
                  state.overviewOpen = false;
                  navigateFocus(p.id);
                },
              },
              [
                createAvatar(p, 'sm', 'thumb', false),
                el('div', {}, [
                  el('div', { style: { fontSize: '14px', fontWeight: '500' }, textContent: p.name }),
                  el('div', { className: 'person-meta tabular-nums', textContent: formatYearsShort(p) }),
                ]),
              ]
            )
          )
        ),
      ])
    );
  }

  stage.appendChild(canvas);

  modal.appendChild(
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--border-hairline)', background: 'var(--bg-surface)' } }, [
      el('div', {}, [
        el('h2', { id: 'overview-title', style: { margin: '0', fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: '600' }, textContent: UI_STRINGS.overviewTitle }),
        el('p', { style: { margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }, textContent: `${state.graph.peopleList.length} people across ${generations.length} generations · Drag to pan, click any person to focus` }),
      ]),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
        el('button', { type: 'button', className: 'btn btn-outline', textContent: '−', 'aria-label': 'Zoom out', onclick: () => { state.overviewScale = Math.max(0.5, Number((state.overviewScale - 0.15).toFixed(2))); applyTransform(); } }),
        zoomLabel,
        el('button', { type: 'button', className: 'btn btn-outline', textContent: '+', 'aria-label': 'Zoom in', onclick: () => { state.overviewScale = Math.min(1.6, Number((state.overviewScale + 0.15).toFixed(2))); applyTransform(); } }),
        el('button', { type: 'button', className: 'btn btn-outline', textContent: 'Reset', onclick: () => { state.overviewScale = 0.95; state.overviewOffset = { x: 0, y: 0 }; applyTransform(); } }),
        el('button', { type: 'button', className: 'btn btn-ghost', 'aria-label': UI_STRINGS.close, onclick: closeOverlay }, [svgIcon(ICONS.close, 20)]),
      ]),
    ])
  );
  modal.appendChild(stage);
  return modal;
}

function render() {
  const root = document.getElementById('app');
  if (!root) return;
  root.textContent = '';

  if (!state.graph && state.loadError) {
    root.appendChild(
      el('div', { style: { minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' } }, [
        el('h1', { style: { fontFamily: 'var(--font-display)', fontSize: '24px', margin: '0' }, textContent: UI_STRINGS.loadErrorTitle }),
        el('p', { style: { color: 'var(--text-secondary)', marginTop: '8px' }, textContent: state.loadError }),
        el('button', { type: 'button', className: 'btn btn-primary', style: { marginTop: '16px' }, textContent: UI_STRINGS.loadErrorRetry, onclick: loadTree }),
      ])
    );
    return;
  }

  if (!state.graph) {
    root.appendChild(
      el('div', { style: { minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, [
        el('p', { style: { fontFamily: 'var(--font-display)', fontSize: '18px', color: 'var(--text-secondary)' }, textContent: 'Loading family tree…' }),
      ])
    );
    return;
  }

  const viewport = getViewportInfo();
  const focusedId = getFocusedId();
  const family = getDerivedFamily(state.graph, focusedId);
  if (!family) {
    root.appendChild(
      el('div', { style: { minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' } }, [
        el('h1', { style: { fontFamily: 'var(--font-display)', fontSize: '22px', margin: '0 0 8px' }, textContent: state.graph.title }),
        el('p', { style: { color: 'var(--text-secondary)', margin: '0' }, textContent: 'No people recorded in tree.json yet.' }),
      ])
    );
    return;
  }

  const validWhoId = getValidWhoAmI();
  const lastUpdatedText = state.graph.lastUpdated
    ? formatDateForDetails(state.graph.lastUpdated)
    : '';

  const shell = el('div', { className: 'app-shell' });

  // Top Bar
  const topActions = [];
  if (viewport.layoutClass !== 'phone') {
    topActions.push(
      el('button', {
        type: 'button',
        className: 'btn btn-ghost',
        onclick: () => {
          openOverlay(
            () => { state.overviewOpen = true; },
            () => { state.overviewOpen = false; }
          );
        },
      }, [svgIcon(ICONS.compass, 16), el('span', { textContent: UI_STRINGS.overviewButton })])
    );
  }

  if (viewport.layoutClass === 'tablet') {
    topActions.push(
      el('button', {
        type: 'button',
        className: 'btn btn-primary',
        onclick: () => {
          openDetailsForFocused();
        },
      }, [svgIcon(ICONS.info, 16), el('span', { textContent: UI_STRINGS.details })])
    );
  }

  shell.appendChild(
    el('header', { className: 'topbar' }, [
      el('div', { className: 'topbar-inner' }, [
        el('div', { className: 'topbar-left' }, [
          el('button', {
            type: 'button',
            className: 'btn btn-ghost',
            'aria-label': UI_STRINGS.home,
            onclick: () => navigateFocus(validWhoId || state.graph.defaultStartId),
          }, [svgIcon(ICONS.home, 17), el('span', { className: 'hidden-mobile', textContent: UI_STRINGS.home })]),
          el('h1', { className: 'app-title', textContent: state.graph.title }),
        ]),
        viewport.layoutClass !== 'phone' ? createDesktopSearchBar() : null,
        el('div', { className: 'topbar-actions' }, topActions),
      ]),
    ])
  );

  if (state.missingNotice) {
    shell.appendChild(
      el('div', { className: 'notice-banner', role: 'status' }, [
        el('span', { textContent: `${UI_STRINGS.unknownPersonPrefix} "${state.missingNotice}". ${UI_STRINGS.unknownPersonFallback}` }),
        el('button', {
          type: 'button',
          className: 'btn btn-ghost',
          style: { minHeight: '28px', minWidth: '28px', marginLeft: '8px' },
          'aria-label': UI_STRINGS.dismiss,
          onclick: () => {
            state.missingNotice = null;
            render();
          },
        }, [svgIcon(ICONS.close, 15)]),
      ])
    );
  }

  // Main Workspace
  const workspace = el('div', { className: 'workspace' });
  const mainPane = el('main', { className: 'main-pane' });
  mainPane.appendChild(renderFocusCanvas(family, viewport));

  mainPane.appendChild(
    el('footer', { className: 'app-footer' }, [
      el('span', { textContent: lastUpdatedText ? `${UI_STRINGS.lastUpdatedPrefix} ${lastUpdatedText}` : '' }),
      viewport.layoutClass === 'desktop' ? el('span', { textContent: UI_STRINGS.keyboardHelp }) : null,
    ])
  );

  workspace.appendChild(mainPane);

  if (viewport.layoutClass === 'desktop') {
    workspace.appendChild(
      el('aside', { className: 'desktop-sidebar', 'aria-label': 'Person details' }, [
        el('div', { className: 'desktop-sidebar-inner' }, [
          renderPersonDetailsContent(family, viewport.layoutClass, null),
        ]),
      ])
    );
  }

  shell.appendChild(workspace);

  // Phone Bottom Bar
  if (viewport.layoutClass === 'phone') {
    shell.appendChild(
      el('nav', { className: 'phone-bottom-bar', 'aria-label': 'Mobile navigation' }, [
        el('div', { className: 'phone-bottom-inner' }, [
          el('button', {
            type: 'button',
            className: 'phone-search-trigger',
            onclick: () => {
              openOverlay(
                () => { state.phoneSearchOpen = true; },
                () => { state.phoneSearchOpen = false; }
              );
            },
          }, [svgIcon(ICONS.search, 18), el('span', { textContent: UI_STRINGS.searchPlaceholder })]),
          el('button', {
            type: 'button',
            className: 'btn btn-primary',
            onclick: () => {
              openDetailsForFocused();
            },
          }, [svgIcon(ICONS.info, 16), el('span', { textContent: UI_STRINGS.details })]),
        ]),
      ])
    );
  }

  // Mobile full-screen Details / Tablet Side Drawer
  if (viewport.layoutClass !== 'desktop' && state.detailsSheetOpen) {
    const backdrop = el('div', {
      className: 'sheet-backdrop',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': family.person.name,
      onclick: (e) => {
        if (e.target === backdrop) {
          closeOverlay();
        }
      },
    });
    const sheet = el('div', { className: 'sheet-panel' }, [
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border-hairline)', background: 'var(--bg-surface)' } }, [
        viewport.layoutClass === 'phone'
          ? el('button', {
              type: 'button',
              className: 'btn btn-ghost',
              style: { paddingLeft: '6px' },
              onclick: () => {
                closeOverlay();
              },
            }, [svgIcon(ICONS.back, 18), el('span', { textContent: 'Tree' })])
          : el('span', { className: 'tier-label', style: { paddingLeft: '6px' }, textContent: UI_STRINGS.details }),
        el('button', {
          type: 'button',
          className: 'btn btn-ghost',
          'aria-label': UI_STRINGS.close,
          onclick: () => {
            closeOverlay();
          },
        }, [svgIcon(ICONS.close, 20)]),
      ]),
      el('div', { style: { flex: '1', overflowY: 'auto' } }, [
        renderPersonDetailsContent(family, viewport.layoutClass, closeOverlay),
      ]),
    ]);
    backdrop.appendChild(sheet);
    shell.appendChild(backdrop);
  }

  if (state.phoneSearchOpen) shell.appendChild(renderPhoneSearchModal());
  if (state.route?.kind === 'connect') {
    const conn = renderConnectionFinder(state.route.fromId, state.route.toId, viewport);
    if (conn) shell.appendChild(conn);
  }
  if (state.overviewOpen) shell.appendChild(renderOverviewModal(focusedId));
  if (state.photoPreview) {
    const lightbox = el('div', {
      className: 'photo-lightbox-backdrop',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': state.photoPreview.name,
      onclick: (e) => {
        if (e.target === lightbox) {
          closeOverlay();
        }
      },
    }, [
      el('button', {
        type: 'button',
        className: 'photo-lightbox-close',
        'aria-label': UI_STRINGS.close,
        onclick: () => {
          closeOverlay();
        },
      }, [svgIcon(ICONS.close, 20)]),
      el('img', {
        src: state.photoPreview.src,
        alt: state.photoPreview.name,
        className: 'photo-lightbox-img',
      }),
      el('p', {
        className: 'photo-lightbox-caption',
        textContent: state.photoPreview.name,
      }),
    ]);
    shell.appendChild(lightbox);
  }

  // Status Notices
  if (!state.isOnline || state.updateReady) {
    const stack = el('div', { className: 'status-stack' });
    if (state.updateReady) {
      stack.appendChild(
        el('div', { className: 'status-toast', role: 'status', style: { borderColor: 'var(--accent-forest)' } }, [
          svgIcon(ICONS.refresh, 16),
          el('span', { textContent: UI_STRINGS.updateNotice }),
          el('button', { type: 'button', className: 'btn btn-primary', style: { minHeight: '32px', padding: '0 10px', fontSize: '12px' }, textContent: UI_STRINGS.refreshNow, onclick: () => window.location.reload() }),
        ])
      );
    }
    if (!state.isOnline) {
      stack.appendChild(
        el('div', { className: 'status-toast', role: 'status', style: { background: 'var(--bg-muted)' } }, [
          svgIcon(ICONS.wifiOff, 15),
          el('span', { textContent: UI_STRINGS.offlineBanner }),
        ])
      );
    }
    shell.appendChild(stack);
  }

  root.appendChild(shell);
}

async function loadTree() {
  state.loadError = null;
  render();
  try {
    const res = await fetch('./tree.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.treeData = data;
    state.graph = buildTreeGraph(data);
    safeSetItem(CACHED_TREE_KEY, JSON.stringify(data));
  } catch {
    const cached = safeGetItem(CACHED_TREE_KEY);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        state.treeData = data;
        state.graph = buildTreeGraph(data);
      } catch {
        state.loadError = 'Check your connection and try again.';
      }
    } else {
      state.loadError = 'Check your connection and try again.';
    }
  }

  if (state.graph) {
    document.title = state.graph.title;
    syncRouteFromHash();
  }
  render();
}

function setupEvents() {
  // A reload drops the overlay stack, so an overlay entry left in history no longer means anything.
  if (window.history.state?.overlayDepth) window.history.replaceState(null, '', window.location.href);

  window.addEventListener('popstate', handlePopState);
  // Covers hash edits typed into the address bar.
  window.addEventListener('hashchange', () => {
    syncRouteFromHash();
    render();
  });

  let resizeTimer = null;
  let lastWidth = window.innerWidth;
  let lastLayout = getViewportInfo().layoutClass;
  window.addEventListener('resize', () => {
    const nextLayout = getViewportInfo().layoutClass;
    const widthDelta = Math.abs(window.innerWidth - lastWidth);
    if (nextLayout !== lastLayout || widthDelta >= 40) {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        lastLayout = getViewportInfo().layoutClass;
        lastWidth = window.innerWidth;
        render();
      }, 120);
    }
  });

  window.addEventListener('online', () => {
    state.isOnline = true;
    render();
  });
  window.addEventListener('offline', () => {
    state.isOnline = false;
    render();
  });

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (!state.graph) return;
    const tag = e.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;

    if (e.key === '/' && !typing) {
      e.preventDefault();
      if (getViewportInfo().layoutClass === 'phone') {
        openOverlay(
          () => { state.phoneSearchOpen = true; },
          () => { state.phoneSearchOpen = false; }
        );
      } else {
        document.getElementById('desktop-search-input')?.focus();
      }
      return;
    }

    if (e.key === 'Escape' && state.photoPreview) {
      e.preventDefault();
      closeOverlay();
      return;
    }

    if (typing || state.overviewOpen || state.photoPreview || state.route?.kind === 'connect') return;

    const family = getDerivedFamily(state.graph, getFocusedId());
    if (!family) return;

    if (state.keyboardPrompt) {
      if (e.key === 'Escape') {
        e.preventDefault();
        state.keyboardPrompt = null;
        render();
        return;
      }
      const num = Number(e.key);
      if (num >= 1 && num <= state.keyboardPrompt.choices.length) {
        e.preventDefault();
        navigateFocus(state.keyboardPrompt.choices[num - 1].id);
        return;
      }
    }

    if (e.key === 'ArrowUp') {
      if (family.parents.length === 1) {
        e.preventDefault();
        navigateFocus(family.parents[0].id);
      } else if (family.parents.length > 1) {
        e.preventDefault();
        state.keyboardPrompt = { title: UI_STRINGS.pickParentPrompt, choices: family.parents };
        render();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      const kids = family.unions.flatMap((u) => u.children);
      if (kids.length === 1) {
        e.preventDefault();
        navigateFocus(kids[0].id);
      } else if (kids.length > 1) {
        e.preventDefault();
        state.keyboardPrompt = { title: UI_STRINGS.pickChildPrompt, choices: kids };
        render();
      }
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const spouses = family.unions.map((u) => u.spouse).filter(Boolean);
      const lateral = e.key === 'ArrowLeft' ? [...family.siblings, ...spouses] : [...spouses, ...family.siblings];
      if (lateral.length === 1) {
        e.preventDefault();
        navigateFocus(lateral[0].id);
      } else if (lateral.length > 1) {
        e.preventDefault();
        state.keyboardPrompt = { title: UI_STRINGS.pickRelativePrompt, choices: lateral };
        render();
      }
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (sw) {
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              state.updateReady = true;
              render();
            }
          });
        }
      });
    }).catch(() => {});
  }
}

setupEvents();
loadTree();

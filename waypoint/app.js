/* Waypoint Maps — a privacy-first map app.
 * Data: OpenStreetMap (tiles via CARTO / OSM / Esri imagery), OSRM routing (FOSSGIS servers),
 * Photon + Nominatim geocoding, Overpass for places and speed limits.
 * All personal data (saved places, reports, settings) lives in localStorage only.
 */
(() => {
'use strict';

/* ================= Config ================= */
const DEFAULT_VIEW = { lat: -25.7479, lon: 28.2293, z: 13 }; // Pretoria
const OSRM = {
  car: 'https://routing.openstreetmap.de/routed-car',
  bike: 'https://routing.openstreetmap.de/routed-bike',
  foot: 'https://routing.openstreetmap.de/routed-foot',
};
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const PHOTON = 'https://photon.komoot.io';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

const CATEGORIES = [
  { key: 'fuel', label: 'Fuel', ic: 'F', q: '["amenity"="fuel"]' },
  { key: 'food', label: 'Food', ic: 'R', q: '["amenity"~"^(restaurant|fast_food)$"]' },
  { key: 'coffee', label: 'Coffee', ic: 'C', q: '["amenity"="cafe"]' },
  { key: 'grocery', label: 'Groceries', ic: 'G', q: '["shop"~"^(supermarket|convenience)$"]' },
  { key: 'pharmacy', label: 'Pharmacy', ic: '+', q: '["amenity"="pharmacy"]' },
  { key: 'hospital', label: 'Hospital', ic: 'H', q: '["amenity"~"^(hospital|clinic)$"]' },
  { key: 'atm', label: 'ATM / Bank', ic: '$', q: '["amenity"~"^(atm|bank)$"]' },
  { key: 'ev', label: 'EV charging', ic: 'E', q: '["amenity"="charging_station"]' },
  { key: 'parking', label: 'Parking', ic: 'P', q: '["amenity"="parking"]' },
  { key: 'toilets', label: 'Toilets', ic: 'T', q: '["amenity"="toilets"]' },
  { key: 'police', label: 'Police', ic: 'S', q: '["amenity"="police"]' },
  { key: 'hotel', label: 'Stay', ic: 'Z', q: '["tourism"~"^(hotel|guest_house|motel|hostel)$"]' },
];
const ALONG_CATS = ['fuel', 'food', 'coffee', 'ev', 'toilets'];

// ttl in minutes
const REPORT_TYPES = [
  { key: 'police', label: 'Police', ic: 'P', color: '#2754c5', ttl: 60, say: 'Police reported ahead' },
  { key: 'crash', label: 'Crash', ic: '!', color: '#c62f2f', ttl: 120, say: 'Crash reported ahead' },
  { key: 'jam', label: 'Traffic', ic: '≡', color: '#a3261b', ttl: 60, say: 'Heavy traffic reported ahead' },
  { key: 'hazard', label: 'Hazard', ic: '▲', color: '#d97a00', ttl: 120, say: 'Hazard on the road ahead' },
  { key: 'robot', label: 'Robot out', ic: '◍', color: '#b38600', ttl: 180, say: 'Traffic lights out ahead' },
  { key: 'pothole', label: 'Pothole', ic: '◌', color: '#7a5233', ttl: 60 * 24 * 7, say: 'Pothole ahead' },
  { key: 'closure', label: 'Closed', ic: '×', color: '#5a1a1a', ttl: 60 * 24, say: 'Road closure reported ahead' },
  { key: 'camera', label: 'Camera', ic: '◉', color: '#6a3fb5', ttl: 60 * 24 * 30, say: 'Speed camera ahead' },
];
const RT = Object.fromEntries(REPORT_TYPES.map(r => [r.key, r]));

/* ================= Storage ================= */
const store = {
  get(k, d) { try { const v = localStorage.getItem('wp.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('wp.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const settings = Object.assign({
  units: 'metric', theme: 'auto', fuelUse: 7.5, fuelPrice: 22.0, currency: 'R',
  speedTol: 5, voice: true, reportAlerts: true, layer: 'streets', showReports: true,
}, store.get('settings', {}));
const saved = Object.assign({ home: null, work: null, places: [], parking: null }, store.get('saved', {}));
let recent = store.get('recent', []);
let reports = store.get('reports', []);
const saveSettings = () => store.set('settings', settings);
const saveSaved = () => store.set('saved', saved);

/* ================= Helpers ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const uid = () => Math.random().toString(36).slice(2, 10);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const toRad = d => d * Math.PI / 180;
function hav(a, b) {
  const R = 6371000, dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// Distance from p to segment a-b in metres (local equirectangular), plus t in [0,1]
function segDist(p, a, b) {
  const k = Math.cos(toRad(p.lat)) * 111320, m = 110540;
  const ax = (a.lon - p.lon) * k, ay = (a.lat - p.lat) * m, bx = (b.lon - p.lon) * k, by = (b.lat - p.lat) * m;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx, y = ay + t * dy;
  return { d: Math.hypot(x, y), t };
}
function bearing(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const compass = b => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(b / 45) % 8];

function fmtDist(m) {
  if (settings.units === 'imperial') {
    const mi = m / 1609.344;
    if (mi < 0.1) return `${Math.round(m * 3.28084 / 10) * 10} ft`;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
function fmtDur(s) {
  const min = Math.round(s / 60);
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  const hh = Math.floor(min / 60), mm = min % 60;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}
const fmtClock = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const speedUnit = () => settings.units === 'imperial' ? 'mph' : 'km/h';
const toSpeed = ms => settings.units === 'imperial' ? ms * 2.23694 : ms * 3.6;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#1b7cf2';
const money = v => `${settings.currency}${v.toFixed(2)}`;
const ago = ts => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const safeUrl = u => (typeof u === 'string' && /^https:\/\//i.test(u)) ? u : null;

let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch { window.prompt && window.prompt('Copy this:', text); }
}
async function getJSON(url, opts = {}, timeout = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: opts.signal || ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function overpass(query) {
  let lastErr;
  for (const ep of OVERPASS) {
    try { return await getJSON(ep, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 30000); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* ================= Theme ================= */
function applyTheme() {
  const r = document.documentElement;
  if (settings.theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', settings.theme);
}
const isDark = () => settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
applyTheme();

/* ================= Map ================= */
const startView = parseHashView() || store.get('view', DEFAULT_VIEW);
const map = L.map('map', { zoomControl: false, worldCopyJump: true }).setView([startView.lat, startView.lon], startView.z);
L.control.scale({ position: 'bottomleft', imperial: settings.units === 'imperial', metric: settings.units !== 'imperial' }).addTo(map);

const CARTO_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>';
const tileDefs = {
  light: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 20, subdomains: 'abcd', attribution: CARTO_ATTR }),
  dark: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, subdomains: 'abcd', attribution: CARTO_ATTR }),
  satellite: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
  labels: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', { maxZoom: 20, subdomains: 'abcd', attribution: CARTO_ATTR, pane: 'overlayPane' }),
  osm: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }),
};
let baseLayers = [];
function setLayer(name) {
  settings.layer = name; saveSettings();
  baseLayers.forEach(l => map.removeLayer(l)); baseLayers = [];
  const add = k => { const l = tileDefs[k](); l.addTo(map); baseLayers.push(l); };
  if (name === 'streets') add(isDark() ? 'dark' : 'light');
  else if (name === 'dark') add('dark');
  else if (name === 'satellite') add('satellite');
  else if (name === 'hybrid') { add('satellite'); add('labels'); }
  else add('osm');
  $$('#layerMenu [data-layer]').forEach(b => b.classList.toggle('active', b.dataset.layer === name));
}
setLayer(settings.layer);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (settings.layer === 'streets') setLayer('streets'); });

function parseHashView() {
  const m = location.hash.match(/map=(\d+(?:\.\d+)?)\/(-?\d+\.?\d*)\/(-?\d+\.?\d*)/);
  return m ? { z: +m[1], lat: +m[2], lon: +m[3] } : null;
}
map.on('moveend', debounce(() => {
  const c = map.getCenter(), z = map.getZoom();
  const v = { lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5), z };
  store.set('view', v);
  history.replaceState(null, '', `#map=${z}/${v.lat}/${v.lon}`);
}, 400));

const pinIcon = (color, label = '') => L.divIcon({ className: '', html: `<div class="pin" style="background:${color}"><span>${label}</span></div>`, iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] });
const dotIcon = (cls, text, color) => L.divIcon({ className: '', html: `<div class="${cls}"${color ? ` style="background:${color}"` : ''}>${text}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });

const layers = {
  place: L.layerGroup().addTo(map),
  poi: L.layerGroup().addTo(map),
  route: L.layerGroup().addTo(map),
  stops: L.layerGroup().addTo(map),
  reports: L.layerGroup().addTo(map),
  saved: L.layerGroup().addTo(map),
  measure: L.layerGroup().addTo(map),
  me: L.layerGroup().addTo(map),
};

/* ================= Location ================= */
let me = null; // {lat, lon, acc, speed, heading}
let meMarker = null, meCircle = null;
function updateMe(pos) {
  const c = pos.coords;
  me = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, speed: c.speed, heading: c.heading, ts: pos.timestamp };
  if (!meMarker) {
    meMarker = L.marker([me.lat, me.lon], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000 }).addTo(layers.me);
    meCircle = L.circle([me.lat, me.lon], { radius: me.acc, color: '#1b7cf2', weight: 1, fillOpacity: 0.08 }).addTo(layers.me);
  } else { meMarker.setLatLng([me.lat, me.lon]); meCircle.setLatLng([me.lat, me.lon]).setRadius(me.acc); }
}
function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Location is not available in this browser'));
    navigator.geolocation.getCurrentPosition(p => { updateMe(p); res(me); },
      e => rej(new Error(e.code === 1 ? 'Location permission was denied' : 'Could not get your location')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  });
}
let watchId = null;
function startWatch(cb) {
  if (!navigator.geolocation) return false;
  watchId = navigator.geolocation.watchPosition(p => { updateMe(p); cb && cb(me); }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  return true;
}
function stopWatch() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }

$('#locateBtn').addEventListener('click', async () => {
  try { const p = await getPosition(); map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 16)); }
  catch (e) { toast(e.message); }
});
// Centre on the user at load only if they've already granted permission (no surprise prompt).
if (navigator.permissions?.query) {
  navigator.permissions.query({ name: 'geolocation' }).then(s => {
    if (s.state === 'granted') getPosition().then(p => { if (!parseHashView()) map.setView([p.lat, p.lon], 15); }).catch(() => {});
  }).catch(() => {});
}

/* ================= Geocoding ================= */
function parseCoords(q) {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, sub: 'Coordinates', lat, lon };
}
function photonToPlace(f) {
  const p = f.properties || {}; const [lon, lat] = f.geometry.coordinates;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const name = p.name || street || p.city || p.county || 'Unnamed place';
  const sub = [p.name ? street : '', p.district || p.locality, p.city, p.state, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  const tmap = { N: 'node', W: 'way', R: 'relation' };
  return { name, sub, lat, lon, kind: p.osm_value, osm: p.osm_type ? { type: tmap[p.osm_type], id: p.osm_id } : null };
}
async function geocode(q, signal) {
  const c = parseCoords(q); if (c) return [c];
  const ctr = map.getCenter();
  try {
    const j = await getJSON(`${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=7&lat=${ctr.lat}&lon=${ctr.lng}&lang=en`, { signal });
    if (j.features?.length) return j.features.map(photonToPlace);
  } catch (e) { if (e.name === 'AbortError') throw e; }
  const j = await getJSON(`${NOMINATIM}/search?format=jsonv2&limit=7&q=${encodeURIComponent(q)}`, { signal });
  return j.map(r => ({ name: r.name || r.display_name.split(',')[0], sub: r.display_name, lat: +r.lat, lon: +r.lon, kind: r.type, osm: { type: r.osm_type, id: r.osm_id } }));
}
async function reverse(lat, lon) {
  try {
    const r = await getJSON(`${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18`);
    const a = r.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    return { name: r.name || street || r.display_name?.split(',')[0] || 'Dropped pin', sub: r.display_name || '', lat, lon, osm: r.osm_type ? { type: r.osm_type, id: r.osm_id } : null };
  } catch { return { name: 'Dropped pin', sub: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon }; }
}

/* Autocomplete, reused for the main search and each route stop. */
function attachSuggest(input, onPick, { withMe = false } = {}) {
  const wrap = input.closest('.search-wrap');
  let list = wrap.querySelector('.suggestions');
  if (!list) { list = h('ul', { class: 'suggestions', hidden: true }); wrap.append(list); }
  let items = [], sel = -1, ctl;
  const render = () => {
    list.replaceChildren(...items.map((it, i) => h('li', { class: i === sel ? 'sel' : '', onmousedown: e => { e.preventDefault(); pick(i); } },
      h('span', { class: 's-main', text: it.name }), it.sub ? h('span', { class: 's-sub', text: it.sub }) : null)));
    list.hidden = !items.length;
  };
  const pick = i => { const it = items[i]; if (!it) return; list.hidden = true; input.value = it.me ? 'Your location' : it.name; onPick(it); };
  const extras = () => {
    const ex = [];
    if (withMe) ex.push({ me: true, name: 'Your location', sub: 'Uses GPS when you route' });
    if (saved.home) ex.push({ ...saved.home, name: 'Home', sub: saved.home.name });
    if (saved.work) ex.push({ ...saved.work, name: 'Work', sub: saved.work.name });
    return ex;
  };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { items = extras().concat(recent.slice(0, 4)); sel = -1; render(); return; }
    ctl?.abort(); ctl = new AbortController();
    try {
      const local = [...saved.places, ...recent].filter(p => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 2);
      const res = await geocode(q, ctl.signal);
      items = [...local, ...res]; sel = -1; render();
    } catch (e) { if (e.name !== 'AbortError') { items = []; render(); } }
  }, 350);
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (!input.value.trim()) run(); });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  input.addEventListener('keydown', e => {
    if (list.hidden) { if (e.key === 'Enter') run(); return; }
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(sel < 0 ? 0 : sel); e.preventDefault(); }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
}

/* ================= Tabs & sheet ================= */
function showTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $('#panel').classList.remove('collapsed');
  if (name === 'saved') renderSaved();
  if (name === 'reports') renderReports();
}
$$('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
$('#sheetHandle').addEventListener('click', () => $('#panel').classList.toggle('collapsed'));

/* ================= Opening hours (common OSM formats) ================= */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
function openNow(oh, now = new Date()) {
  if (!oh) return null;
  oh = oh.trim();
  if (oh === '24/7') return true;
  const today = DAYS[now.getDay()], mins = now.getHours() * 60 + now.getMinutes();
  let result = null;
  try {
    for (const rule of oh.split(';').map(s => s.trim()).filter(Boolean)) {
      if (/^(PH|SH)\b/.test(rule)) continue; // public/school holidays: ignore
      const m = rule.match(/^((?:[A-Z][a-z](?:-[A-Z][a-z])?,?)+)?\s*(.*)$/);
      if (!m) return null;
      const dayPart = m[1], timePart = m[2].trim();
      let applies = !dayPart;
      if (dayPart) for (const d of dayPart.split(',').filter(Boolean)) {
        const [a, b] = d.split('-');
        const ia = DAYS.indexOf(a), ib = b ? DAYS.indexOf(b) : ia, it = DAYS.indexOf(today);
        if (ia < 0 || ib < 0) return null;
        if (ia <= ib ? it >= ia && it <= ib : it >= ia || it <= ib) applies = true;
      }
      if (!applies) continue;
      if (/^(off|closed)$/i.test(timePart)) { result = false; continue; }
      let open = false;
      for (const span of timePart.split(',')) {
        const t = span.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
        if (!t) return null;
        const s = +t[1] * 60 + +t[2]; let e = +t[3] * 60 + +t[4]; if (e <= s) e += 1440;
        if ((mins >= s && mins < e) || (mins + 1440 >= s && mins + 1440 < e)) open = true;
      }
      result = open; // later rules override earlier ones, as in OSM
    }
  } catch { return null; }
  return result;
}

/* ================= Place card ================= */
let currentPlace = null;
function addRecent(p) {
  if (p.me) return;
  recent = [{ name: p.name, sub: p.sub, lat: p.lat, lon: p.lon, osm: p.osm }, ...recent.filter(r => hav(r, p) > 15 || r.name !== p.name)].slice(0, 12);
  store.set('recent', recent); renderRecent();
}
async function fetchTags(osm) {
  if (!osm?.type || !osm.id) return null;
  try { const j = await overpass(`[out:json][timeout:10];${osm.type}(${osm.id});out tags;`); return j.elements?.[0]?.tags || null; }
  catch { return null; }
}
async function showPlace(p, { fly = true, record = true } = {}) {
  currentPlace = p;
  layers.place.clearLayers();
  L.marker([p.lat, p.lon], { icon: pinIcon('var(--bad)') }).addTo(layers.place);
  if (fly) map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 16), { duration: 0.8 });
  if (record) addRecent(p);
  showTab('explore');
  renderPlaceCard(p);
  if (!p.tags && p.osm) { const tags = await fetchTags(p.osm); if (tags && currentPlace === p) { p.tags = tags; renderPlaceCard(p); } }
}
function renderPlaceCard(p) {
  const card = $('#placeCard'); card.hidden = false;
  const t = p.tags || {};
  const facts = [];
  const kind = t.amenity || t.shop || t.tourism || t.leisure || p.kind;
  if (kind) facts.push(h('span', { class: 'fact', text: kind.replace(/_/g, ' ') }));
  if (me) facts.push(h('span', { class: 'fact', text: fmtDist(hav(me, p)) + ' away' }));
  const on = openNow(t.opening_hours);
  if (on === true) facts.push(h('span', { class: 'fact open', text: 'Open now' }));
  if (on === false) facts.push(h('span', { class: 'fact closed', text: 'Closed now' }));
  if (t.opening_hours) facts.push(h('span', { class: 'fact', text: t.opening_hours }));
  if (t.wheelchair) facts.push(h('span', { class: 'fact', text: 'Wheelchair: ' + t.wheelchair }));
  if (t.fuel_diesel === 'yes') facts.push(h('span', { class: 'fact', text: 'Diesel' }));
  if (t.socket_type2 || t['socket:type2']) facts.push(h('span', { class: 'fact', text: 'Type 2 sockets' }));
  const phone = t.phone || t['contact:phone'];
  const web = safeUrl(t.website || t['contact:website']);
  const isSaved = saved.places.some(s => hav(s, p) < 10);
  card.replaceChildren(...[
    h('div', {}, h('h3', { text: t.name || p.name }), h('div', { class: 'addr', text: p.sub || `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` })),
    facts.length ? h('div', { class: 'facts' }, facts) : null,
    phone ? h('div', { class: 'addr' }, 'Phone: ', h('span', { text: phone })) : null,
    web ? h('a', { href: web, target: '_blank', rel: 'noopener', class: 'addr', text: web.replace(/^https:\/\/(www\.)?/, '') }) : null,
    h('div', { class: 'row gap' },
      h('button', { class: 'btn primary', onclick: () => directionsTo(p) }, 'Directions'),
      h('button', { class: 'btn ghost', onclick: () => addStop(p) }, 'Add stop'),
      h('button', { class: 'btn ghost', onclick: () => toggleSave(p) }, isSaved ? 'Saved ✓' : 'Save'),
      h('button', { class: 'btn ghost', onclick: () => sharePlace(p) }, 'Share'),
    ),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn ghost', onclick: () => { saved.home = slim(p); saveSaved(); toast('Home set'); renderSavedMarkers(); } }, 'Set as Home'),
      h('button', { class: 'btn ghost', onclick: () => { saved.work = slim(p); saveSaved(); toast('Work set'); renderSavedMarkers(); } }, 'Set as Work'),
      h('button', { class: 'btn ghost', onclick: () => { card.hidden = true; layers.place.clearLayers(); currentPlace = null; } }, 'Close'),
    ),
  ].filter(Boolean));
}
const slim = p => ({ id: p.id || uid(), name: p.tags?.name || p.name, sub: p.sub || '', lat: p.lat, lon: p.lon, osm: p.osm || null });
function sharePlace(p) {
  const url = `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(6)}&mlon=${p.lon.toFixed(6)}#map=17/${p.lat.toFixed(6)}/${p.lon.toFixed(6)}`;
  const text = `${p.tags?.name || p.name}\n${p.sub || ''}\n${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}\n${url}`;
  if (navigator.share) navigator.share({ title: p.name, text }).catch(() => copy(text)); else copy(text);
}
function toggleSave(p) {
  const i = saved.places.findIndex(s => hav(s, p) < 10);
  if (i >= 0) { saved.places.splice(i, 1); toast('Removed from saved'); }
  else { saved.places.unshift(slim(p)); toast('Saved'); }
  saveSaved(); renderSavedMarkers(); if (currentPlace) renderPlaceCard(currentPlace);
}

/* ================= Explore: search, categories, recent ================= */
attachSuggest($('#searchInput'), p => showPlace(p));
$('#categoryChips').replaceChildren(...CATEGORIES.map(c => h('button', { class: 'chip', 'data-cat': c.key, onclick: () => searchNearby(c) }, c.label)));

let activeCat = null;
async function searchNearby(cat) {
  if (activeCat === cat.key) { activeCat = null; layers.poi.clearLayers(); $('#nearbyResults').replaceChildren(); markChips(); return; }
  activeCat = cat.key; markChips();
  const out = $('#nearbyResults');
  out.replaceChildren(h('div', { class: 'empty', text: `Finding ${cat.label.toLowerCase()} nearby…` }));
  if (map.getZoom() < 12) map.setZoom(13);
  const b = map.getBounds();
  const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
  try {
    const j = await overpass(`[out:json][timeout:25];(node${cat.q}(${bbox});way${cat.q}(${bbox}););out tags center 120;`);
    const ref = me || { lat: map.getCenter().lat, lon: map.getCenter().lng };
    const pois = j.elements.map(e => ({
      name: e.tags?.name || e.tags?.brand || cat.label, tags: e.tags || {},
      lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, osm: { type: e.type, id: e.id },
      sub: [e.tags?.['addr:street'], e.tags?.['addr:suburb'] || e.tags?.['addr:city']].filter(Boolean).join(', '),
    })).filter(p => p.lat != null).map(p => ({ ...p, dist: hav(ref, p) })).sort((a, b) => a.dist - b.dist).slice(0, 40);
    if (activeCat !== cat.key) return;
    layers.poi.clearLayers();
    pois.forEach(p => L.marker([p.lat, p.lon], { icon: dotIcon('poi-marker', cat.ic) }).addTo(layers.poi).on('click', () => showPlace(p, { fly: false })));
    out.replaceChildren(...(pois.length ? pois.map(p => placeItem(p, cat.ic, fmtDist(p.dist), openNow(p.tags.opening_hours))) : [h('div', { class: 'empty', text: 'Nothing found in this area. Zoom out or move the map and try again.' })]));
  } catch { out.replaceChildren(h('div', { class: 'empty', text: 'The places service is busy. Try again in a moment.' })); }
}
function markChips() { $$('#categoryChips .chip').forEach(c => c.classList.toggle('active', c.dataset.cat === activeCat)); }
function placeItem(p, ic, meta, open, onX) {
  const sub = [open === true ? 'Open now' : open === false ? 'Closed' : '', p.sub].filter(Boolean).join(' · ');
  return h('div', { class: 'item', role: 'button', tabindex: 0, onclick: () => showPlace(p), onkeydown: e => { if (e.key === 'Enter') showPlace(p); } },
    h('span', { class: 'ic', text: ic }),
    h('span', { class: 'tx' }, h('div', { class: 't1', text: p.name }), sub ? h('div', { class: 't2', text: sub }) : null),
    meta ? h('span', { class: 'meta', text: meta }) : null,
    onX ? h('button', { class: 'x', title: 'Remove', 'aria-label': 'Remove', onclick: e => { e.stopPropagation(); onX(); } }, '×') : null);
}
function renderRecent() {
  const l = $('#recentList');
  l.replaceChildren(...(recent.length ? recent.slice(0, 6).map(p => placeItem(p, '↺', null, null, () => { recent = recent.filter(r => r !== p); store.set('recent', recent); renderRecent(); }))
    : [h('div', { class: 'empty', text: 'Places you search for show up here.' })]));
}

/* Quick actions */
$$('.quick-btn').forEach(b => b.addEventListener('click', () => quick(b.dataset.quick)));
function quick(k) {
  if (k === 'home' || k === 'work') {
    const p = saved[k];
    if (p) directionsTo(p);
    else toast(`Search for your ${k} address, then tap "Set as ${k === 'home' ? 'Home' : 'Work'}"`, 4000);
  } else if (k === 'park') {
    if (saved.parking) {
      const p = saved.parking;
      map.flyTo([p.lat, p.lon], 18); directionsTo({ ...p, name: 'Your car' }, 'foot');
    } else saveParking();
  } else if (k === 'measure') startMeasure();
}
async function saveParking() {
  let p;
  try { p = await getPosition(); } catch { const c = map.getCenter(); p = { lat: c.lat, lon: c.lng }; toast('No GPS, so parking saved at the map centre'); }
  saved.parking = { name: 'Parked car', sub: 'Saved ' + fmtClock(new Date()), lat: p.lat, lon: p.lon, ts: Date.now() };
  saveSaved(); renderSavedMarkers(); updateParkLabel(); toast('Parking spot saved');
}
function updateParkLabel() { $('#parkLabel').textContent = saved.parking ? 'Find my car' : 'Save parking'; }

/* ================= Saved ================= */
function renderSavedMarkers() {
  layers.saved.clearLayers();
  const add = (p, color, label) => L.marker([p.lat, p.lon], { icon: pinIcon(color, label), zIndexOffset: -100 }).addTo(layers.saved).on('click', () => showPlace({ ...p }, { fly: false, record: false }));
  if (saved.home) add(saved.home, '#0f6f6a', 'H');
  if (saved.work) add(saved.work, '#0f6f6a', 'W');
  if (saved.parking) add(saved.parking, '#2754c5', 'P');
  saved.places.forEach(p => add(p, '#d4920f', '★'));
}
function renderSaved() {
  const l = $('#savedList'); const rows = [];
  const fixed = [['home', 'H', 'Home'], ['work', 'W', 'Work'], ['parking', 'P', 'Parked car']];
  for (const [k, ic, label] of fixed) {
    const p = saved[k];
    if (p) rows.push(placeItem({ ...p, name: label, sub: p.name === label ? p.sub : p.name }, ic, me ? fmtDist(hav(me, p)) : null, null, () => { saved[k] = null; saveSaved(); renderSaved(); renderSavedMarkers(); updateParkLabel(); }));
  }
  rows.push(h('h2', { class: 'label', text: `Favourites (${saved.places.length})` }));
  if (!saved.places.length) rows.push(h('div', { class: 'empty', text: 'Tap Save on any place to keep it here.' }));
  saved.places.forEach(p => rows.push(placeItem(p, '★', me ? fmtDist(hav(me, p)) : null, null, () => { saved.places = saved.places.filter(s => s !== p); saveSaved(); renderSaved(); renderSavedMarkers(); })));
  l.replaceChildren(...rows);
}
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ saved, reports, settings, recent }, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'waypoint-backup.json' }); document.body.append(a); a.click(); a.remove();
});
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.saved) Object.assign(saved, j.saved); if (Array.isArray(j.reports)) reports = j.reports; if (Array.isArray(j.recent)) recent = j.recent;
    saveSaved(); store.set('reports', reports); store.set('recent', recent);
    renderSaved(); renderSavedMarkers(); renderReportMarkers(); renderRecent(); toast('Imported');
  } catch { toast('That file is not a Waypoint backup'); }
});

/* ================= Reports ================= */
function pruneReports() {
  const now = Date.now();
  reports = reports.filter(r => RT[r.type] && now - r.ts < RT[r.type].ttl * 60000);
  store.set('reports', reports);
}
function addReport(type, lat, lon) {
  reports.unshift({ id: uid(), type, lat, lon, ts: Date.now() });
  store.set('reports', reports); renderReportMarkers(); renderReports();
  toast(`${RT[type].label} reported. Thanks!`);
  if (state.routes.length) renderRouteUI();
}
function renderReportMarkers() {
  pruneReports(); layers.reports.clearLayers();
  if (!settings.showReports) return;
  reports.forEach(r => {
    const t = RT[r.type];
    const popup = h('div', {}, h('b', { text: t.label }), h('div', { text: ago(r.ts) }),
      h('div', { class: 'row gap', style: 'margin-top:6px' },
        h('button', { class: 'btn ghost', onclick: () => { r.ts = Date.now(); store.set('reports', reports); map.closePopup(); toast('Confirmed'); } }, 'Still there'),
        h('button', { class: 'btn ghost', onclick: () => { reports = reports.filter(x => x !== r); store.set('reports', reports); renderReportMarkers(); renderReports(); } }, 'Gone')));
    L.marker([r.lat, r.lon], { icon: dotIcon('rep-marker', t.ic, t.color) }).addTo(layers.reports).bindPopup(popup);
  });
}
function renderReports() {
  pruneReports();
  $('#reportList').replaceChildren(...(reports.length ? reports.map(r => {
    const t = RT[r.type];
    return h('div', { class: 'item', role: 'button', tabindex: 0, onclick: () => map.flyTo([r.lat, r.lon], 17) },
      h('span', { class: 'ic', style: `background:${t.color};color:#fff`, text: t.ic }),
      h('span', { class: 'tx' }, h('div', { class: 't1', text: t.label }), h('div', { class: 't2', text: `${ago(r.ts)} · expires in ${fmtDur((t.ttl * 60000 - (Date.now() - r.ts)) / 1000)}` })),
      me ? h('span', { class: 'meta', text: fmtDist(hav(me, r)) }) : null,
      h('button', { class: 'x', 'aria-label': 'Remove', onclick: e => { e.stopPropagation(); reports = reports.filter(x => x !== r); store.set('reports', reports); renderReports(); renderReportMarkers(); } }, '×'));
  }) : [h('div', { class: 'empty', text: 'No active reports.' })]));
}
$('#reportGrid').replaceChildren(...REPORT_TYPES.map(t => h('button', { class: 'rep-btn', onclick: () => beginReport(t.key) },
  h('span', { class: 'rep-ic', style: `background:${t.color}`, text: t.ic }), t.label)));

let pendingReport = null;
function beginReport(type) {
  if (nav.active && me) { addReport(type, me.lat, me.lon); return; }
  pendingReport = type; $('#reportModeBar').hidden = false;
  $('#reportModeText').textContent = `Tap the map where the ${RT[type].label.toLowerCase()} is`;
  if (innerWidth <= 720) $('#panel').classList.add('collapsed');
}
function endReportMode() { pendingReport = null; $('#reportModeBar').hidden = true; }
$('#reportCancel').addEventListener('click', endReportMode);
$('#reportHere').addEventListener('click', async () => {
  const type = pendingReport; endReportMode();
  try { const p = await getPosition(); addReport(type, p.lat, p.lon); } catch (e) { toast(e.message); }
});
$('#reportFab').addEventListener('click', () => {
  if (nav.active) { showQuickReport(); return; }
  showTab('reports');
});
function showQuickReport() {
  const menu = $('#ctxMenu');
  menu.replaceChildren(h('div', { class: 'ctx-head', text: 'Report at your location' }), ...REPORT_TYPES.map(t => h('button', { onclick: () => { menu.hidden = true; beginReport(t.key); } }, t.label)));
  menu.style.left = '50%'; menu.style.top = '30%'; menu.style.transform = 'translateX(-50%)'; menu.hidden = false;
}

/* ================= Measure ================= */
let measuring = false, measurePts = [];
function startMeasure() {
  measuring = true; measurePts = []; layers.measure.clearLayers(); $('#measureBar').hidden = false; updateMeasure();
  if (innerWidth <= 720) $('#panel').classList.add('collapsed');
}
function updateMeasure() {
  layers.measure.clearLayers();
  if (measurePts.length) {
    L.polyline(measurePts, { color: '#c77700', weight: 3, dashArray: '6 6' }).addTo(layers.measure);
    measurePts.forEach(p => L.circleMarker(p, { radius: 5, color: '#c77700', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(layers.measure));
  }
  let d = 0; for (let i = 1; i < measurePts.length; i++) d += hav({ lat: measurePts[i - 1][0], lon: measurePts[i - 1][1] }, { lat: measurePts[i][0], lon: measurePts[i][1] });
  $('#measureText').textContent = measurePts.length < 2 ? 'Tap the map to measure' : `Distance: ${fmtDist(d)}`;
}
$('#measureClear').addEventListener('click', () => { measurePts = []; updateMeasure(); });
$('#measureDone').addEventListener('click', () => { measuring = false; $('#measureBar').hidden = true; layers.measure.clearLayers(); });

/* ================= Map clicks & context menu ================= */
map.on('click', async e => {
  $('#ctxMenu').hidden = true; $('#layerMenu').hidden = true;
  if (measuring) { measurePts.push([e.latlng.lat, e.latlng.lng]); updateMeasure(); return; }
  if (pendingReport) { const t = pendingReport; endReportMode(); addReport(t, e.latlng.lat, e.latlng.lng); return; }
});
map.on('contextmenu', async e => {
  const { lat, lng } = e.latlng; const menu = $('#ctxMenu');
  const pt = e.containerPoint;
  const item = (label, fn) => h('button', { onclick: async () => { menu.hidden = true; fn(); } }, label);
  const pin = async () => reverse(lat, lng);
  menu.style.transform = '';
  menu.replaceChildren(
    h('div', { class: 'ctx-head', text: `${lat.toFixed(5)}, ${lng.toFixed(5)}` }),
    item("What's here?", async () => showPlace(await pin(), { fly: false })),
    item('Directions to here', async () => directionsTo(await pin())),
    item('Directions from here', async () => { setStop(0, await pin()); showTab('directions'); }),
    item('Add as stop', async () => addStop(await pin())),
    item('Report something here', () => { showTab('reports'); toast('Pick a report type, then tap the spot'); }),
    item('Save this spot', async () => toggleSave(await pin())),
    item('Copy coordinates', () => copy(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)),
  );
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(pt.x, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(pt.y, innerHeight - r.height - 8) + 'px';
});

/* ================= Directions ================= */
const state = { mode: 'car', stops: [{ me: true, name: 'Your location' }, null], routes: [], active: 0, legsTo: [] };

function renderStops() {
  const wrap = $('#stops'); const n = state.stops.length;
  wrap.replaceChildren(...state.stops.map((s, i) => {
    const input = h('input', { type: 'text', id: `stop-${i}`, placeholder: i === 0 ? 'Start' : i === n - 1 ? 'Destination' : `Stop ${i}`, value: s ? (s.me ? 'Your location' : s.name) : '', 'aria-label': `Stop ${i + 1}` });
    const row = h('div', { class: 'stop' },
      h('span', { class: 'dot', text: i === 0 ? 'A' : i === n - 1 ? 'B' : String(i) }),
      h('div', { class: 'search-wrap' }, input),
      i > 0 ? h('button', { class: 'mini', title: 'Move up', 'aria-label': 'Move up', onclick: () => moveStop(i, -1) }, '↑') : null,
      i < n - 1 ? h('button', { class: 'mini', title: 'Move down', 'aria-label': 'Move down', onclick: () => moveStop(i, 1) }, '↓') : null,
      n > 2 ? h('button', { class: 'mini', title: 'Remove stop', 'aria-label': 'Remove stop', onclick: () => { state.stops.splice(i, 1); renderStops(); autoRoute(); } }, '×') : null);
    attachSuggest(input, p => { state.stops[i] = p; addRecent(p); renderStopMarkers(); autoRoute(); }, { withMe: true });
    input.addEventListener('input', () => { if (!input.value.trim()) state.stops[i] = null; });
    return row;
  }));
  renderStopMarkers();
}
function moveStop(i, d) { const s = state.stops; [s[i], s[i + d]] = [s[i + d], s[i]]; renderStops(); autoRoute(); }
function setStop(i, p) { state.stops[i] = p; renderStops(); autoRoute(); }
function renderStopMarkers() {
  layers.stops.clearLayers(); const n = state.stops.length;
  state.stops.forEach((s, i) => {
    if (!s || s.me) return;
    const color = i === 0 ? '#1f8a4c' : i === n - 1 ? '#c62f2f' : '#5b6e6b';
    const m = L.marker([s.lat, s.lon], { icon: pinIcon(color, i === 0 ? 'A' : i === n - 1 ? 'B' : i), draggable: true }).addTo(layers.stops);
    m.on('dragend', async () => { const ll = m.getLatLng(); state.stops[i] = await reverse(ll.lat, ll.lng); renderStops(); autoRoute(); });
  });
}
function directionsTo(p, mode) {
  if (mode) setMode(mode);
  const n = state.stops.length;
  state.stops[n - 1] = p;
  if (!state.stops[0]) state.stops[0] = { me: true, name: 'Your location' };
  renderStops(); showTab('directions'); computeRoute();
}
function addStop(p) {
  const n = state.stops.length;
  if (!state.stops[n - 1]) { state.stops[n - 1] = p; }
  else state.stops.splice(n - 1, 0, p);
  renderStops(); showTab('directions'); toast('Stop added'); autoRoute();
}
function setMode(m) {
  state.mode = m;
  $$('.mode').forEach(b => { b.classList.toggle('active', b.dataset.mode === m); b.setAttribute('aria-checked', b.dataset.mode === m); });
}
$$('.mode').forEach(b => b.addEventListener('click', () => { setMode(b.dataset.mode); autoRoute(); }));
$('#addStopBtn').addEventListener('click', () => { state.stops.splice(state.stops.length - 1, 0, null); renderStops(); $(`#stop-${state.stops.length - 2}`).focus(); });
$('#swapBtn').addEventListener('click', () => { state.stops.reverse(); renderStops(); autoRoute(); });
$('#routeBtn').addEventListener('click', () => computeRoute());
['#avoidTolls', '#avoidMotorway', '#avoidFerry'].forEach(s => $(s).addEventListener('change', () => { if (state.routes.length) { pickPreferred(); renderRouteUI(); } }));
$('#departTime').addEventListener('change', () => { if (state.routes.length) renderRouteUI(); });
const autoRoute = debounce(() => { if (state.stops.every(Boolean)) computeRoute(); }, 200);

async function resolveStops() {
  const out = [];
  for (const s of state.stops) {
    if (!s) throw new Error('Fill in every stop first');
    if (s.me) { const p = await getPosition(); out.push({ ...p, name: 'Your location' }); }
    else out.push(s);
  }
  return out;
}
function setStatus(msg, err) { const s = $('#routeStatus'); s.hidden = !msg; s.textContent = msg || ''; s.classList.toggle('err', !!err); }

async function osrmRoute(pts, mode, alternatives) {
  const coords = pts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url = `${OSRM[mode]}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&continue_straight=default${alternatives ? '&alternatives=3' : ''}`;
  const j = await getJSON(url, {}, 25000);
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.message || 'No route found');
  return j.routes;
}

let routeSeq = 0;
async function computeRoute() {
  const seq = ++routeSeq;
  let pts;
  try { pts = await resolveStops(); } catch (e) { setStatus(e.message, true); return; }
  setStatus('Finding the best routes…');
  try {
    const routes = await osrmRoute(pts, state.mode, pts.length === 2);
    if (seq !== routeSeq) return;
    state.routes = routes.map(r => analyseRoute(r));
    state.pts = pts; state.active = 0; pickPreferred();
    setStatus('');
    renderRouteUI(true);
  } catch (e) {
    if (seq !== routeSeq) return;
    setStatus(e.name === 'AbortError' ? 'The routing service took too long. Try again.' : `Couldn't get a route: ${e.message}`, true);
  }
}
function analyseRoute(r) {
  const classes = new Set();
  r.legs.forEach(l => l.steps.forEach(s => (s.intersections || []).forEach(x => (x.classes || []).forEach(c => classes.add(c)))));
  const coords = r.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
  return { raw: r, coords, toll: classes.has('toll'), motorway: classes.has('motorway'), ferry: classes.has('ferry'), distance: r.distance, duration: r.duration };
}
function reportsOnRoute(route, radius = 60) {
  return reports.filter(rep => {
    const c = route.coords;
    for (let i = 1; i < c.length; i++) {
      if (Math.abs(c[i].lat - rep.lat) > 0.01 && Math.abs(c[i - 1].lat - rep.lat) > 0.01) continue;
      if (segDist(rep, c[i - 1], c[i]).d < radius) return true;
    }
    return false;
  });
}
function pickPreferred() {
  const av = { toll: $('#avoidTolls').checked, motorway: $('#avoidMotorway').checked, ferry: $('#avoidFerry').checked };
  const ok = r => !(av.toll && r.toll) && !(av.motorway && r.motorway) && !(av.ferry && r.ferry);
  const idx = state.routes.findIndex(ok);
  state.active = idx >= 0 ? idx : 0;
  const wanted = Object.entries(av).filter(([, v]) => v).map(([k]) => k);
  if (wanted.length && idx < 0) setStatus(`None of the available routes avoid ${wanted.map(w => w === 'toll' ? 'tolls' : w === 'motorway' ? 'highways' : 'ferries').join(' and ')}. Showing the fastest. Add a stop on a different road to force another way.`, true);
  else if (wanted.length && idx > 0) setStatus(`Picked route ${idx + 1}, which avoids what you asked. It's ${fmtDur(state.routes[idx].duration - state.routes[0].duration)} slower than the fastest.`);
}

function renderRouteUI(fit) {
  const routes = state.routes; if (!routes.length) return;
  layers.route.clearLayers();
  // alternatives first (underneath)
  routes.forEach((r, i) => {
    if (i === state.active) return;
    L.polyline(r.coords.map(c => [c.lat, c.lon]), { color: cssVar('--route-alt'), weight: 6, opacity: 0.8 }).addTo(layers.route)
      .on('click', () => { state.active = i; renderRouteUI(); });
  });
  const a = routes[state.active];
  L.polyline(a.coords.map(c => [c.lat, c.lon]), { color: '#ffffff', weight: 10, opacity: 0.9 }).addTo(layers.route);
  L.polyline(a.coords.map(c => [c.lat, c.lon]), { color: cssVar('--route'), weight: 6 }).addTo(layers.route);
  if (fit) map.fitBounds(L.latLngBounds(a.coords.map(c => [c.lat, c.lon])), { paddingTopLeft: innerWidth > 720 ? [420, 40] : [20, 20], paddingBottomRight: innerWidth > 720 ? [40, 40] : [20, innerHeight * 0.5] });

  // alternatives list
  const fastest = Math.min(...routes.map(r => r.duration)), shortest = Math.min(...routes.map(r => r.distance));
  const shortestIdx = routes.findIndex(r => r.distance === shortest);
  const depart = departDate();
  $('#routeAlts').replaceChildren(...routes.map((r, i) => {
    const reps = reportsOnRoute(r);
    const badges = [];
    if (r.duration === fastest) badges.push(h('span', { class: 'badge good', text: 'Fastest' }));
    else badges.push(h('span', { class: 'badge', text: `+${fmtDur(r.duration - fastest)}` }));
    if (i === shortestIdx && routes.length > 1 && r.duration !== fastest) badges.push(h('span', { class: 'badge good', text: 'Shortest' }));
    badges.push(h('span', { class: `badge ${r.toll ? 'warn' : 'good'}`, text: r.toll ? 'Has tolls' : 'No tolls' }));
    if (r.motorway) badges.push(h('span', { class: 'badge', text: 'Highway' }));
    if (r.ferry) badges.push(h('span', { class: 'badge warn', text: 'Ferry' }));
    if (reps.length) badges.push(h('span', { class: 'badge bad', text: `${reps.length} report${reps.length > 1 ? 's' : ''} on route` }));
    return h('button', { class: 'alt' + (i === state.active ? ' active' : ''), onclick: () => { state.active = i; renderRouteUI(); } },
      h('span', { class: 'a-time', text: fmtDur(r.duration) }), h('span', { class: 'a-dist', text: fmtDist(r.distance) }),
      h('span', { class: 'a-sub', text: `Arrive ${fmtClock(new Date(depart.getTime() + r.duration * 1000))} · via ${mainRoads(r)}` }),
      h('span', { class: 'a-badges' }, badges));
  }));

  // summary
  const km = a.distance / 1000;
  const sum = h('div', { class: 'summary' });
  const grid = h('div', { class: 'sum-grid' },
    h('div', {}, h('small', { text: 'Time' }), h('b', { text: fmtDur(a.duration) })),
    h('div', {}, h('small', { text: 'Distance' }), h('b', { text: fmtDist(a.distance) })),
    h('div', {}, h('small', { text: 'Arrive' }), h('b', { text: fmtClock(new Date(depart.getTime() + a.duration * 1000)) })));
  sum.append(grid);
  if (state.mode === 'car') {
    const litres = km * settings.fuelUse / 100;
    sum.append(h('div', { class: 'sum-grid' },
      h('div', {}, h('small', { text: 'Fuel' }), h('b', { text: `${litres.toFixed(1)} L` })),
      h('div', {}, h('small', { text: 'Fuel cost' }), h('b', { text: money(litres * settings.fuelPrice) })),
      h('div', {}, h('small', { text: 'CO₂' }), h('b', { text: `${(litres * 2.31).toFixed(1)} kg` }))));
  } else {
    const kcal = state.mode === 'foot' ? km * 55 : km * 28; // rough averages for a ~70 kg adult
    sum.append(h('div', { class: 'hint', text: `About ${Math.round(kcal)} kcal. Rough estimate for a 70 kg adult.` }));
  }
  if (a.raw.legs.length > 1) sum.append(h('div', { class: 'hint', text: a.raw.legs.map((l, i) => `Leg ${i + 1}: ${fmtDur(l.duration)}, ${fmtDist(l.distance)}`).join(' · ') }));
  sum.append(h('div', { class: 'hint', text: 'Times assume normal road speeds. Live traffic is not included, so check the Reports tab for incidents.' }));
  sum.append(h('div', { class: 'row gap' },
    h('button', { class: 'btn primary grow', onclick: () => startNav(false) }, 'Start'),
    h('button', { class: 'btn ghost', onclick: () => startNav(true), title: 'Drive the route virtually to preview it' }, 'Preview drive'),
    h('button', { class: 'btn ghost', onclick: shareRoute }, 'Share')));
  sum.append(h('h2', { class: 'label', text: 'Find along the route' }));
  sum.append(h('div', { class: 'along' }, ALONG_CATS.map(k => { const c = CATEGORIES.find(x => x.key === k); return h('button', { class: 'chip', onclick: () => alongRoute(c) }, c.label); })));
  sum.append(h('div', { id: 'alongResults', class: 'list' }));
  $('#routeSummary').replaceChildren(sum);
  renderSteps(a);
}
function departDate() {
  const v = $('#departTime').value; const d = new Date();
  if (v) { const [hh, mm] = v.split(':').map(Number); d.setHours(hh, mm, 0, 0); if (d < new Date(Date.now() - 60000)) d.setDate(d.getDate() + 1); }
  return d;
}
function mainRoads(r) {
  const byName = {};
  r.raw.legs.forEach(l => l.steps.forEach(s => { const n = s.ref || s.name; if (n) byName[n] = (byName[n] || 0) + s.distance; }));
  const top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);
  return top.length ? top.join(' and ') : 'local roads';
}

/* Turn instructions */
const ARROWS = { 'uturn': '↶', 'sharp right': '↘', 'right': '→', 'slight right': '↗', 'straight': '↑', 'slight left': '↖', 'left': '←', 'sharp left': '↙' };
function stepArrow(s) {
  const t = s.maneuver.type;
  if (t === 'arrive') return '◎';
  if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn' || t === 'exit roundabout' || t === 'exit rotary') return '⟳';
  return ARROWS[s.maneuver.modifier] || '↑';
}
const ord = n => { const t = n % 100; if (t >= 11 && t <= 13) return n + 'th'; return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th'); };
function stepText(s, legIdx, legCount) {
  const m = s.maneuver, mod = m.modifier || '', road = s.ref && s.name ? `${s.name} (${s.ref})` : (s.name || s.ref || '');
  const onto = road ? ` onto ${road}` : '';
  switch (m.type) {
    case 'depart': return `Head ${compass(m.bearing_after || 0)}${road ? ` on ${road}` : ''}`;
    case 'arrive': return legIdx < legCount - 1 ? `Arrive at stop ${legIdx + 1}` : `Arrive at your destination${mod && mod !== 'straight' ? `, on the ${mod.includes('left') ? 'left' : 'right'}` : ''}`;
    case 'roundabout': case 'rotary': return `At the ${m.type === 'rotary' && s.rotary_name ? s.rotary_name : 'roundabout'}, take the ${ord(m.exit || 1)} exit${onto}`;
    case 'exit roundabout': case 'exit rotary': return `Exit the roundabout${onto}`;
    case 'merge': return `Merge ${mod.includes('left') ? 'left' : 'right'}${onto}`;
    case 'on ramp': return `Take the ramp${s.destinations ? ` towards ${s.destinations}` : onto}`;
    case 'off ramp': return `Take the exit${s.exits ? ` ${s.exits}` : ''}${s.destinations ? ` towards ${s.destinations}` : onto}`;
    case 'fork': return `Keep ${mod.includes('left') ? 'left' : 'right'} at the fork${s.destinations ? ` towards ${s.destinations}` : onto}`;
    case 'end of road': return `At the end of the road, turn ${mod.includes('left') ? 'left' : 'right'}${onto}`;
    case 'new name': case 'continue': return mod === 'uturn' ? `Make a U-turn${onto}` : `Continue${mod && mod !== 'straight' ? ` ${mod}` : ' straight'}${onto}`;
    default: return mod === 'uturn' ? `Make a U-turn${onto}` : mod === 'straight' ? `Go straight${onto}` : `Turn ${mod}${onto}`;
  }
}
function flatSteps(route) {
  const legs = route.raw.legs, out = [];
  legs.forEach((l, li) => l.steps.forEach(s => out.push({ s, li, n: legs.length })));
  return out;
}
function renderSteps(route) {
  $('#steps').replaceChildren(...flatSteps(route).map(({ s, li, n }) => h('li', { onclick: () => map.flyTo([s.maneuver.location[1], s.maneuver.location[0]], 17) },
    h('span', { class: 'arr', text: stepArrow(s) }), h('span', { text: stepText(s, li, n) }), h('span', { class: 'sd', text: s.distance ? fmtDist(s.distance) : '' }))));
}
function shareRoute() {
  const a = state.routes[state.active]; const dest = state.stops[state.stops.length - 1];
  const eta = fmtClock(new Date(departDate().getTime() + a.duration * 1000));
  const engine = { car: 'fossgis_osrm_car', bike: 'fossgis_osrm_bike', foot: 'fossgis_osrm_foot' }[state.mode];
  const p0 = state.pts[0], p1 = state.pts[state.pts.length - 1];
  const url = `https://www.openstreetmap.org/directions?engine=${engine}&route=${p0.lat.toFixed(5)},${p0.lon.toFixed(5)};${p1.lat.toFixed(5)},${p1.lon.toFixed(5)}`;
  const text = `Heading to ${dest?.name || 'my destination'}: ${fmtDur(a.duration)}, ${fmtDist(a.distance)}. ETA ${eta}.\n${url}`;
  if (navigator.share) navigator.share({ text }).catch(() => copy(text)); else copy(text);
}

/* Optimise stop order: OSRM trip service, falling back to a local nearest-neighbour + 2-opt. */
$('#optimiseBtn').addEventListener('click', async () => {
  if (state.stops.length < 4) { toast('Add at least two stops between start and destination'); return; }
  let pts; try { pts = await resolveStops(); } catch (e) { toast(e.message); return; }
  setStatus('Working out the best order…');
  let order = null;
  try {
    const coords = pts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const j = await getJSON(`${OSRM[state.mode]}/trip/v1/driving/${coords}?source=first&destination=last&roundtrip=false&overview=false`, {}, 25000);
    if (j.code === 'Ok') order = j.waypoints.map((w, i) => ({ i, k: w.waypoint_index })).sort((a, b) => a.k - b.k).map(x => x.i);
  } catch { /* fall back */ }
  if (!order) order = localTsp(pts);
  const before = state.stops.slice();
  state.stops = order.map(i => before[i]);
  renderStops(); await computeRoute(); toast('Stops reordered for the shortest trip');
});
function localTsp(pts) {
  const n = pts.length, D = (a, b) => hav(pts[a], pts[b]);
  let route = [0], left = new Set([...Array(n).keys()].slice(1, n - 1));
  while (left.size) { const last = route[route.length - 1]; let best = null; for (const j of left) if (best == null || D(last, j) < D(last, best)) best = j; route.push(best); left.delete(best); }
  route.push(n - 1);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 2; i++) for (let k = i + 1; k < n - 1; k++) {
      const d0 = D(route[i - 1], route[i]) + D(route[k], route[k + 1]), d1 = D(route[i - 1], route[k]) + D(route[i], route[k + 1]);
      if (d1 + 1e-6 < d0) { route = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)]; improved = true; }
    }
  }
  return route;
}

/* Search along the route */
async function alongRoute(cat) {
  const out = $('#alongResults'); const a = state.routes[state.active];
  out.replaceChildren(h('div', { class: 'empty', text: `Looking for ${cat.label.toLowerCase()} along your route…` }));
  // Overpass "around" accepts a polyline, so search a 500 m corridor around a thinned copy of the route.
  const step = Math.max(1, Math.floor(a.coords.length / 120));
  const samples = a.coords.filter((_, i) => i % step === 0 || i === a.coords.length - 1);
  const line = samples.map(c => `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`).join(',');
  try {
    const j = await overpass(`[out:json][timeout:30];(node${cat.q}(around:500,${line});way${cat.q}(around:500,${line}););out tags center 300;`);
    const cum = cumulative(a.coords);
    const seen = new Set();
    const res = j.elements.filter(e => !seen.has(e.id) && seen.add(e.id)).map(e => {
      const p = { name: e.tags?.name || e.tags?.brand || cat.label, tags: e.tags || {}, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, osm: { type: e.type, id: e.id } };
      const near = nearestOnLine(p, a.coords, cum);
      return { ...p, off: near.d, along: near.along };
    }).filter(p => p.lat != null && p.off < 500).sort((x, y) => x.along - y.along).slice(0, 25);
    layers.poi.clearLayers();
    res.forEach(p => L.marker([p.lat, p.lon], { icon: dotIcon('poi-marker', cat.ic) }).addTo(layers.poi).on('click', () => showPlace(p, { fly: false })));
    out.replaceChildren(...(res.length ? res.map(p => h('div', { class: 'item' },
      h('span', { class: 'ic', text: cat.ic }),
      h('span', { class: 'tx' }, h('div', { class: 't1', text: p.name }), h('div', { class: 't2', text: `In ${fmtDist(p.along)} · ${fmtDist(p.off)} off route${openNow(p.tags.opening_hours) === false ? ' · Closed now' : ''}` })),
      h('button', { class: 'btn ghost', onclick: () => insertStopAlong(p) }, 'Add stop'))) : [h('div', { class: 'empty', text: 'Nothing close to this route.' })]));
  } catch { out.replaceChildren(h('div', { class: 'empty', text: 'The places service is busy. Try again in a moment.' })); }
}
function insertStopAlong(p) {
  // Insert before the first destination that lies beyond this point on the route.
  const legs = state.routes[state.active].raw.legs; let acc = 0, at = state.stops.length - 1;
  for (let i = 0; i < legs.length; i++) { acc += legs[i].distance; if (p.along < acc) { at = i + 1; break; } }
  state.stops.splice(at, 0, slim(p)); renderStops(); computeRoute(); toast(`Added ${p.name} as a stop`);
}
function cumulative(coords) { const c = [0]; for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + hav(coords[i - 1], coords[i])); return c; }
function nearestOnLine(p, coords, cum, from = 0, to = coords.length - 1) {
  let best = { d: Infinity, i: 0, along: 0 };
  for (let i = Math.max(1, from); i <= to; i++) {
    const r = segDist(p, coords[i - 1], coords[i]);
    if (r.d < best.d) best = { d: r.d, i, along: cum[i - 1] + r.t * (cum[i] - cum[i - 1]) };
  }
  return best;
}

/* ================= Navigation ================= */
const nav = { active: false, sim: false, simT: null, muted: !settings.voice, wake: null };
function speak(text) {
  if (nav.muted || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; speechSynthesis.speak(u); } catch { /* ignore */ }
}
function prepareNav(route) {
  const steps = flatSteps(route).map(x => x);
  const coords = route.coords, cum = cumulative(coords);
  // Where each step starts along the line: OSRM step distances, scaled to the geometry length.
  const total = cum[cum.length - 1];
  const sumD = steps.reduce((a, x) => a + x.s.distance, 0) || 1;
  let run = 0;
  const starts = steps.map(({ s }) => { const v = run * total / sumD; run += s.distance; return v; });
  const remainingAfter = []; let acc = 0;
  for (let i = steps.length - 1; i >= 0; i--) { remainingAfter[i] = acc; acc += steps[i].s.duration; }
  return { route, steps, coords, cum, starts, total, remainingAfter, lastI: 1, announced: {}, offCount: 0, warned: new Set(), limitAt: 0, limit: null };
}
async function startNav(sim) {
  const route = state.routes[state.active]; if (!route) return;
  nav.active = true; nav.sim = sim; nav.data = prepareNav(route);
  $('#nav').hidden = false; $('#panel').hidden = true; $('#reportFab').classList.add('on');
  $('#speedUnit').textContent = speedUnit();
  $('#navMute').textContent = nav.muted ? 'Voice off' : 'Voice on';
  try { nav.wake = await navigator.wakeLock?.request('screen'); } catch { /* not granted */ }
  const first = nav.data.steps[0];
  speak(stepText(first.s, first.li, first.n));
  if (sim) runSim();
  else if (!startWatch(onNavPos)) { toast('Location is not available, so starting a preview drive instead'); nav.sim = true; runSim(); }
  else if (me) onNavPos(me);
}
function endNav() {
  nav.active = false; clearInterval(nav.simT); stopWatch(); nav.wake?.release?.().catch(() => {});
  $('#nav').hidden = true; $('#panel').hidden = false; $('#reportFab').classList.remove('on'); $('#navAlert').hidden = true;
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
  if (nav.simMarker) { layers.me.removeLayer(nav.simMarker); nav.simMarker = null; }
}
$('#navEnd').addEventListener('click', endNav);
$('#navMute').addEventListener('click', () => { nav.muted = !nav.muted; $('#navMute').textContent = nav.muted ? 'Voice off' : 'Voice on'; });
$('#navReport').addEventListener('click', showQuickReport);
$('#navShare').addEventListener('click', () => {
  const d = nav.data; const dest = state.stops[state.stops.length - 1];
  copy(`I'm on my way to ${dest?.name || 'my destination'}. ETA ${$('#etaTime').textContent} (${$('#etaMeta').textContent}).`);
});

function runSim() {
  const d = nav.data; let along = 0; const SPEEDUP = 6, TICK = 500;
  if (meMarker) { layers.me.removeLayer(meMarker); layers.me.removeLayer(meCircle); meMarker = meCircle = null; }
  // per-step speed from OSRM durations so the preview follows realistic pacing
  nav.simT = setInterval(() => {
    let si = 0; while (si < d.starts.length - 1 && d.starts[si + 1] <= along) si++;
    const s = d.steps[si].s; const v = s.duration > 0 ? Math.max(3, s.distance / s.duration) : 10;
    along = Math.min(d.total, along + v * SPEEDUP * TICK / 1000);
    const pos = pointAt(d, along);
    const fake = { lat: pos.lat, lon: pos.lon, speed: v, heading: pos.brg, acc: 5 };
    if (!nav.simMarker) nav.simMarker = L.marker([pos.lat, pos.lon], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000 }).addTo(layers.me);
    nav.simMarker.setLatLng([pos.lat, pos.lon]);
    onNavPos(fake, along);
    if (along >= d.total) clearInterval(nav.simT);
  }, TICK);
}
function pointAt(d, along) {
  let i = 1; while (i < d.cum.length - 1 && d.cum[i] < along) i++;
  const a = d.coords[i - 1], b = d.coords[i], seg = d.cum[i] - d.cum[i - 1] || 1, t = Math.min(1, Math.max(0, (along - d.cum[i - 1]) / seg));
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, brg: bearing(a, b) };
}

function onNavPos(p, simAlong) {
  if (!nav.active) return;
  const d = nav.data;
  let along, off = 0;
  if (simAlong != null) { along = simAlong; let i = 1; while (i < d.cum.length - 1 && d.cum[i] < along) i++; d.lastI = i; }
  else {
    const n = nearestOnLine(p, d.coords, d.cum, Math.max(1, d.lastI - 5), Math.min(d.coords.length - 1, d.lastI + 300));
    along = n.along; off = n.d; d.lastI = n.i;
    // Off-route detection → reroute
    const limit = state.mode === 'car' ? 50 : 35;
    if (off > limit + (p.acc || 0) / 2) d.offCount++; else d.offCount = 0;
    if (d.offCount >= 3) { d.offCount = 0; reroute(p); return; }
  }
  // current step = last step whose start <= along
  let si = 0; while (si < d.starts.length - 1 && d.starts[si + 1] <= along + 5) si++;
  const next = d.steps[Math.min(si + 1, d.steps.length - 1)], cur = d.steps[si];
  const isLast = si >= d.steps.length - 1;
  const toNext = isLast ? 0 : Math.max(0, d.starts[si + 1] - along);
  const show = isLast ? cur : next;
  $('#navArrow').textContent = stepArrow(show.s);
  $('#navDist').textContent = isLast ? 'Arrived' : fmtDist(toNext);
  $('#navInstr').textContent = stepText(show.s, show.li, show.n);
  const then = d.steps[si + 2];
  $('#navThen').textContent = then && !isLast ? `Then ${stepText(then.s, then.li, then.n).toLowerCase()}` : '';

  // Remaining time: rest of current step (proportional) + all following steps
  const stepLen = (d.starts[si + 1] ?? d.total) - d.starts[si] || 1;
  const fracLeft = isLast ? 0 : Math.min(1, toNext / stepLen);
  const remain = fracLeft * cur.s.duration + d.remainingAfter[si];
  const distLeft = Math.max(0, d.total - along);
  $('#etaTime').textContent = fmtClock(new Date(Date.now() + remain * 1000));
  $('#etaMeta').textContent = `${fmtDur(remain)} · ${fmtDist(distLeft)}`;

  // Voice prompts
  if (!isLast) {
    const th = state.mode === 'car' ? [1000, 300, 40] : [200, 50, 15];
    th.forEach((t, k) => {
      const key = `${si + 1}:${k}`;
      if (toNext <= t && !d.announced[key] && (k === 2 || toNext > th[k + 1])) {
        d.announced[key] = 1;
        speak(k === 2 ? stepText(next.s, next.li, next.n) : `In ${fmtDist(t)}, ${stepText(next.s, next.li, next.n).toLowerCase()}`);
      }
    });
  } else if (!d.announced.arrived) { d.announced.arrived = 1; speak('You have arrived'); toast('You have arrived'); }

  // Speed
  const v = p.speed != null && p.speed >= 0 ? toSpeed(p.speed) : null;
  $('#speedVal').textContent = v != null ? Math.round(v) : '–';
  checkSpeedLimit(p);
  const lim = d.limit;
  const over = v != null && lim && v > lim + settings.speedTol;
  $('#speedo').classList.toggle('over', !!over);
  if (over && !d.announced['speed' + Math.floor(Date.now() / 30000)]) { d.announced['speed' + Math.floor(Date.now() / 30000)] = 1; speak('Check your speed'); }

  // Reports ahead
  if (settings.reportAlerts) {
    let alert = null;
    for (const r of reports) {
      if (d.warned.has(r.id + ':passed')) continue;
      const n = nearestOnLine(r, d.coords, d.cum, Math.max(1, d.lastI - 2), Math.min(d.coords.length - 1, d.lastI + 600));
      if (n.d > 60) continue;
      const ahead = n.along - along;
      if (ahead < -30) { d.warned.add(r.id + ':passed'); continue; }
      if (ahead >= 0 && ahead < 1200) {
        alert = `${RT[r.type].label} in ${fmtDist(ahead)}`;
        if (!d.warned.has(r.id)) { d.warned.add(r.id); speak(`${RT[r.type].say}, in ${fmtDist(ahead)}`); }
        break;
      }
    }
    $('#navAlert').hidden = !alert; if (alert) $('#navAlert').textContent = alert;
  }

  // Camera
  map.setView([p.lat, p.lon], state.mode === 'foot' ? 18 : 17, { animate: true });
}
async function reroute(p) {
  if (nav.rerouting) return; nav.rerouting = true;
  toast('Rerouting…'); speak('Rerouting');
  try {
    // Keep only stops not yet reached (stops after the current leg)
    const d = nav.data; let si = 0; const along = nearestOnLine(p, d.coords, d.cum).along;
    while (si < d.starts.length - 1 && d.starts[si + 1] <= along) si++;
    const leg = d.steps[si].li;
    const rest = state.pts.slice(leg + 1);
    const pts = [{ lat: p.lat, lon: p.lon }, ...rest];
    const routes = await osrmRoute(pts, state.mode, false);
    state.routes = [analyseRoute(routes[0])]; state.active = 0; state.pts = pts;
    renderRouteUI(false);
    nav.data = prepareNav(state.routes[0]);
  } catch { toast('Could not reroute. Keep following the road and we will try again.'); }
  finally { nav.rerouting = false; }
}
// Speed limits from OSM maxspeed tags, queried at most every 25 s.
const ZA_IMPLICIT = { 'ZA:urban': 60, 'ZA:rural': 100, 'ZA:motorway': 120 };
async function checkSpeedLimit(p) {
  const d = nav.data; if (state.mode !== 'car' || Date.now() - d.limitAt < 25000) return;
  d.limitAt = Date.now();
  try {
    const j = await overpass(`[out:json][timeout:8];way(around:25,${p.lat.toFixed(5)},${p.lon.toFixed(5)})["highway"]["maxspeed"];out tags 3;`);
    const ms = j.elements?.[0]?.tags?.maxspeed;
    let lim = null;
    if (ms) {
      if (ZA_IMPLICIT[ms]) lim = ZA_IMPLICIT[ms];
      else { const m = ms.match(/^(\d+)\s*(mph)?/); if (m) lim = m[2] ? +m[1] * (settings.units === 'imperial' ? 1 : 1.609) : +m[1] * (settings.units === 'imperial' ? 0.6214 : 1); }
    }
    d.limit = lim ? Math.round(lim) : null;
    $('#limitSign').hidden = !d.limit; if (d.limit) $('#limitVal').textContent = d.limit;
  } catch { /* keep last value */ }
}

/* ================= Layers menu ================= */
$('#layersBtn').addEventListener('click', e => { e.stopPropagation(); $('#layerMenu').hidden = !$('#layerMenu').hidden; });
$$('#layerMenu [data-layer]').forEach(b => b.addEventListener('click', () => { setLayer(b.dataset.layer); $('#layerMenu').hidden = true; }));
$('#showReports').checked = settings.showReports;
$('#showReports').addEventListener('change', e => { settings.showReports = e.target.checked; saveSettings(); renderReportMarkers(); });

/* ================= Settings ================= */
function openSettings() {
  $('#setUnits').value = settings.units; $('#setTheme').value = settings.theme;
  $('#setFuelUse').value = settings.fuelUse; $('#setFuelPrice').value = settings.fuelPrice; $('#setCurrency').value = settings.currency;
  $('#setSpeedTol').value = settings.speedTol; $('#setVoice').checked = settings.voice; $('#setReportAlerts').checked = settings.reportAlerts;
  $('#settings').showModal();
}
$('#settingsBtn').addEventListener('click', openSettings);
$('#settings').addEventListener('close', () => {
  settings.units = $('#setUnits').value; settings.theme = $('#setTheme').value;
  settings.fuelUse = Math.max(1, +$('#setFuelUse').value || 7.5); settings.fuelPrice = Math.max(0, +$('#setFuelPrice').value || 0);
  settings.currency = $('#setCurrency').value.slice(0, 4) || 'R'; settings.speedTol = Math.max(0, +$('#setSpeedTol').value || 0);
  settings.voice = $('#setVoice').checked; settings.reportAlerts = $('#setReportAlerts').checked; nav.muted = !settings.voice;
  saveSettings(); applyTheme(); setLayer(settings.layer);
  if (state.routes.length) renderRouteUI(); renderRecent();
});
$('#wipeBtn').addEventListener('click', () => {
  const b = $('#wipeBtn');
  if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to erase'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Erase all data'; }, 3000); return; }
  try { Object.keys(localStorage).filter(k => k.startsWith('wp.')).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
  location.reload();
});

/* ================= Keyboard ================= */
document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea') || $('#settings').open) return;
  if (e.key === '/') { e.preventDefault(); showTab('explore'); $('#searchInput').focus(); }
  else if (e.key === 'l') $('#locateBtn').click();
  else if (e.key === 'r') $('#reportFab').click();
  else if (e.key === 'd') showTab('directions');
  else if (e.key === ',') openSettings();
  else if (e.key === 'Escape') { $('#ctxMenu').hidden = true; $('#layerMenu').hidden = true; endReportMode(); if (measuring) $('#measureDone').click(); }
});
document.addEventListener('click', e => { if (!e.target.closest('#ctxMenu') && !e.target.closest('.leaflet-container')) $('#ctxMenu').hidden = true; });

/* ================= Init ================= */
renderStops(); renderRecent(); renderSavedMarkers(); renderReportMarkers(); updateParkLabel();
setInterval(renderReportMarkers, 60000);
// expose for debugging / tests
window.__waypoint = { openNow, localTsp, stepText, fmtDist, fmtDur, hav };
})();

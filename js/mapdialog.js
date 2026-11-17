// Scelta del luogo: mappa MapLibre (stili OpenFreeMap) con segnaposto fisso al centro,
// ricerca e indirizzi da Nominatim (OpenStreetMap).

import { coords, formatRadius } from './model.js';

const LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const DARK = 'https://tiles.openfreemap.org/styles/dark';
const LIB = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
const PRESETS = [100, 200, 500, 1000, 2000];
const EARTH = 40075016.686;
const $ = (id) => document.getElementById(id);

let map = null;
let session = null;
let geocodeTimer = null;
let wired = false;

function loadLib() {
  if (window.maplibregl) return Promise.resolve();
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = `${LIB}.css`;
  document.head.append(css);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${LIB}.js`; s.onload = resolve; s.onerror = () => reject(new Error('Mappa non disponibile'));
    document.head.append(s);
  });
}

const mpp = (lat, zoom) => (EARTH * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

function fitRadius(lat, lon, radius, animate = true) {
  const box = $('map');
  const side = Math.max(120, Math.min(box.clientWidth, box.clientHeight));
  const zoom = Math.min(19, Math.max(3, Math.log2((EARTH * Math.cos((lat * Math.PI) / 180)) / (512 * ((3.8 * radius) / side)))));
  const opts = { center: [lon, lat], zoom };
  if (animate) map.easeTo({ ...opts, duration: 600 }); else map.jumpTo(opts);
}

function updateOverlay() {
  if (!session) return;
  const c = map.getCenter();
  const d = (2 * session.radius) / mpp(c.lat, map.getZoom());
  const circle = $('map-circle');
  circle.style.width = circle.style.height = `${d}px`;
  $('map-coords').textContent = coords(c.lat, c.lng);
}

function setRadius(r, refit) {
  session.radius = r;
  $('map-radius').value = r;
  $('map-radius-label').textContent = formatRadius(r);
  for (const b of $('map-radius-chips').children) b.classList.toggle('on', Number(b.dataset.r) === r);
  updateOverlay();
  if (refit) { const c = map.getCenter(); fitRadius(c.lat, c.lng, r); }
}

function setTrigger(t) {
  session.trigger = t;
  for (const b of $('map-trigger').children) b.classList.toggle('on', b.dataset.trigger === t);
}

function formatAddress(a, fallback) {
  if (!a) return fallback ?? '';
  const street = a.road ? (a.house_number ? `${a.road} ${a.house_number}` : a.road) : (a.pedestrian ?? a.square ?? null);
  const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? null;
  const parts = [street, city].filter(Boolean);
  return parts.length ? parts.join(', ') : (fallback ?? '');
}

async function reverse(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=it`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  return formatAddress(j.address, j.name || null) || null;
}

async function search(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=6&addressdetails=1&accept-language=it`;
  const r = await fetch(url);
  return r.ok ? r.json() : [];
}

function scheduleGeocode() {
  const c = map.getCenter();
  const key = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
  if (session.skipGeocode) { session.skipGeocode = false; session.geocodedAt = key; return; }
  if (session.geocodedAt === key) return; // solo zoom: stesso punto, stesso indirizzo
  session.geocodedAt = key;
  clearTimeout(geocodeTimer);
  $('map-addr').textContent = "Cerco l'indirizzo…";
  geocodeTimer = setTimeout(async () => {
    const c = map.getCenter();
    try {
      session.place = (await reverse(c.lat, c.lng)) ?? '';
    } catch (e) { session.place = ''; }
    $('map-addr').textContent = session.place || 'Punto sulla mappa';
  }, 700);
}

function wire() {
  if (wired) return;
  wired = true;
  $('map-radius-chips').innerHTML = PRESETS.map((r) => `<button data-r="${r}">${formatRadius(r)}</button>`).join('');
  $('map-radius-chips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setRadius(Number(b.dataset.r), true); });
  $('map-radius').addEventListener('input', (e) => setRadius(Number(e.target.value), false));
  $('map-radius').addEventListener('change', () => setRadius(session.radius, true));
  $('map-trigger').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTrigger(b.dataset.trigger); });
  $('map-save').addEventListener('change', (e) => { $('map-save-name-wrap').hidden = !e.target.checked; if (e.target.checked) $('map-save-name').focus(); });

  const runSearch = async () => {
    const q = $('map-q').value.trim();
    if (!q) return;
    const box = $('map-results');
    box.hidden = false;
    box.innerHTML = '<div class="list-item muted">Cerco…</div>';
    let res = [];
    try { res = await search(q); } catch (e) { /* rete */ }
    if (!res.length) { box.innerHTML = `<div class="list-item muted">Nessun risultato per «${q.replace(/</g, '&lt;')}»</div>`; return; }
    box.innerHTML = '';
    for (const r of res) {
      const b = document.createElement('button');
      b.className = 'list-item';
      const title = formatAddress(r.address, r.name || r.display_name.split(',')[0]);
      b.innerHTML = `<span class="ms">location_on</span><span><b></b><br><span class="muted tiny"></span></span>`;
      b.querySelector('b').textContent = title;
      b.querySelector('.tiny').textContent = r.display_name;
      b.onclick = () => {
        box.hidden = true;
        session.skipGeocode = true;
        session.place = title;
        $('map-addr').textContent = title;
        fitRadius(Number(r.lat), Number(r.lon), session.radius);
      };
      box.append(b);
    }
  };
  $('map-go').onclick = runSearch;
  $('map-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
  $('map-q').addEventListener('input', () => { if (!$('map-q').value) $('map-results').hidden = true; });

  $('map-me').onclick = () => locate(true);

  $('map-confirm').onclick = () => {
    const c = map.getCenter();
    const saveName = $('map-save').checked ? $('map-save-name').value.trim() : '';
    session.result = {
      lat: c.lat, lon: c.lng, radius: session.radius, place: saveName || session.place,
      trigger: session.trigger, repeat: $('map-repeat').checked, saveName: saveName || null, address: session.place,
    };
    $('dlg-map').close();
  };
  $('dlg-map').addEventListener('close', () => {
    const s = session;
    session = null;
    s?.resolve(s.result ?? null);
  });
}

function locate(explicit) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (p) => { if (session) fitRadius(p.coords.latitude, p.coords.longitude, session.radius); },
    () => { if (explicit) $('map-addr').textContent = 'Posizione non disponibile: controlla i permessi del browser.'; },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

/** Apre la mappa; restituisce il luogo scelto oppure null se annullato. */
export async function openMapPicker({ initial = null, trigger = 'ENTER', dark = false }) {
  wire();
  const dlg = $('dlg-map');
  $('map-results').hidden = true;
  $('map-q').value = '';
  $('map-save').checked = false;
  $('map-save-name').value = '';
  $('map-save-name-wrap').hidden = true;
  $('map-repeat').checked = !!initial?.repeat;
  $('map-addr').textContent = initial?.place || 'Punto sulla mappa';
  const done = new Promise((resolve) => {
    session = { resolve, radius: initial?.radius ?? 200, trigger: initial?.trigger ?? trigger, place: initial?.place ?? '', skipGeocode: !!initial };
  });
  setTrigger(session.trigger);
  dlg.showModal();
  try {
    await loadLib();
  } catch (e) {
    $('map-addr').textContent = 'Impossibile caricare la mappa.';
    return done;
  }
  if (!map) {
    map = new window.maplibregl.Map({
      container: 'map', style: dark ? DARK : LIGHT, center: [12.5, 42.5], zoom: 5,
      attributionControl: false, dragRotate: false, pitchWithRotate: false, maxZoom: 19.5,
    });
    map.touchZoomRotate.disableRotation();
    map.on('movestart', (e) => { if (e.originalEvent) { $('map-pin').classList.add('lift'); if (session) session.skipGeocode = false; } });
    map.on('move', updateOverlay);
    map.on('moveend', () => { $('map-pin').classList.remove('lift'); updateOverlay(); if (session) scheduleGeocode(); });
  } else {
    map.resize();
  }
  setRadius(session.radius, false);
  if (initial) fitRadius(initial.lat, initial.lon, session.radius, false);
  else { map.jumpTo({ center: [12.5, 42.5], zoom: 5 }); locate(false); }
  updateOverlay();
  return done;
}

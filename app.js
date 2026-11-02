import { decodeArrivals } from './gtfsrt.js';

const STATIONS_URL = 'https://data.ny.gov/resource/39hk-dx4f.json?$limit=1000';
const FEED_BASE = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2F';
const STATIONS_CACHE_KEY = 'mta-stations-v1';
const STATIONS_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

const NEARBY_COUNT = 4;
const REFRESH_MS = 30_000;
const PER_ROUTE = 3;
const WALK_M_PER_MIN = 80;

// Which realtime feed carries each route (as listed in the stations dataset).
const FEEDS_BY_ROUTE = {
  1: ['gtfs'], 2: ['gtfs'], 3: ['gtfs'], 4: ['gtfs'], 5: ['gtfs'], 6: ['gtfs'], 7: ['gtfs'],
  A: ['gtfs-ace'], C: ['gtfs-ace'], E: ['gtfs-ace'],
  B: ['gtfs-bdfm'], D: ['gtfs-bdfm'], F: ['gtfs-bdfm'], M: ['gtfs-bdfm'],
  G: ['gtfs-g'], J: ['gtfs-jz'], Z: ['gtfs-jz'], L: ['gtfs-l'],
  N: ['gtfs-nqrw'], Q: ['gtfs-nqrw'], R: ['gtfs-nqrw'], W: ['gtfs-nqrw'],
  S: ['gtfs', 'gtfs-ace'], // 42 St shuttle lives in the 1-7 feed; Franklin and Rockaway shuttles in the ACE feed
  SIR: ['gtfs-si'],
};

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'),
  refresh: $('refresh'),
  stations: $('stations'),
  search: $('search'),
  searchInput: $('search-input'),
  searchResults: $('search-results'),
  toggleSearch: $('toggle-search'),
};

const state = {
  stations: [],   // raw rows from the dataset, one per line-level stop
  complexes: [],  // stops grouped by complex_id
  position: null, // { lat, lon }
  pinned: null,   // complex chosen manually from search
  arrivals: [],   // decoded rows from the realtime feeds
  updatedAt: null,
  loading: false,
};

// ---------- Stations ----------

async function loadStations() {
  try {
    const cached = JSON.parse(localStorage.getItem(STATIONS_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.savedAt < STATIONS_CACHE_MS) return cached.rows;
  } catch {}
  const res = await fetch(STATIONS_URL);
  if (!res.ok) throw new Error(`Station list failed (${res.status})`);
  const rows = (await res.json()).map((r) => ({
    stopId: r.gtfs_stop_id,
    complexId: r.complex_id,
    name: r.stop_name,
    routes: (r.daytime_routes || '').split(' ').filter(Boolean),
    lat: Number(r.gtfs_latitude),
    lon: Number(r.gtfs_longitude),
    north: r.north_direction_label,
    south: r.south_direction_label,
  }));
  try { localStorage.setItem(STATIONS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), rows })); } catch {}
  return rows;
}

function groupComplexes(rows) {
  const byId = new Map();
  for (const s of rows) {
    if (!byId.has(s.complexId)) byId.set(s.complexId, { id: s.complexId, stops: [] });
    byId.get(s.complexId).stops.push(s);
  }
  return [...byId.values()].map((c) => {
    const lat = c.stops.reduce((a, s) => a + s.lat, 0) / c.stops.length;
    const lon = c.stops.reduce((a, s) => a + s.lon, 0) / c.stops.length;
    const names = [...new Set(c.stops.map((s) => s.name))];
    const routes = sortRoutes([...new Set(c.stops.flatMap((s) => s.routes))]);
    return { ...c, lat, lon, name: names.join(' / '), routes };
  });
}

const ROUTE_ORDER = '1234567ACEBDFMGJZLNQRWS'.split('').concat('SIR');
function sortRoutes(routes) {
  const rank = (r) => { const i = ROUTE_ORDER.indexOf(r); return i === -1 ? 99 : i; };
  return routes.sort((a, b) => rank(a) - rank(b));
}

function distanceMeters(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function visibleComplexes() {
  if (state.pinned) return [{ ...state.pinned, distance: state.position ? distanceMeters(state.position, state.pinned) : null }];
  if (!state.position) return [];
  return state.complexes
    .map((c) => ({ ...c, distance: distanceMeters(state.position, c) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEARBY_COUNT);
}

// ---------- Realtime ----------

async function loadArrivals(complexes) {
  const feeds = new Set(complexes.flatMap((c) => c.routes.flatMap((r) => FEEDS_BY_ROUTE[r] || [])));
  const results = await Promise.allSettled([...feeds].map(async (feed) => {
    const res = await fetch(FEED_BASE + feed, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${feed} ${res.status}`);
    return decodeArrivals(await res.arrayBuffer());
  }));
  const failed = results.filter((r) => r.status === 'rejected').length;
  return {
    rows: results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
    failed,
    total: results.length,
  };
}

async function refresh() {
  const complexes = visibleComplexes();
  if (!complexes.length || state.loading) return;
  state.loading = true;
  els.refresh.classList.add('spinning');
  try {
    const { rows, failed, total } = await loadArrivals(complexes);
    state.arrivals = rows;
    state.updatedAt = new Date();
    state.feedWarning = failed ? `${failed} of ${total} feeds didn't load` : '';
  } catch (err) {
    state.feedWarning = 'Couldn’t reach the MTA feed';
  } finally {
    state.loading = false;
    els.refresh.classList.remove('spinning');
    render();
  }
}

// ---------- Rendering ----------

function displayRoute(routeId) {
  if (routeId === 'GS' || routeId === 'FS' || routeId === 'H') return { label: 'S', cls: 'S' };
  if (routeId === 'SI' || routeId === 'SS') return { label: 'SIR', cls: 'SIR' };
  const express = /^[0-9A-Z]X$/.test(routeId);
  const base = express ? routeId[0] : routeId;
  return { label: base, cls: base, express };
}

function bullet(routeId, small = false) {
  const { label, cls, express } = displayRoute(esc(routeId));
  const classes = ['bullet', `r-${cls}`];
  if (small) classes.push('small');
  if (label.length > 1) classes.push('wide');
  if (express) classes.push('express');
  return `<span class="${classes.join(' ')}" aria-label="${label} train"><span>${label}</span></span>`;
}

function directionsFor(complex, nowSec) {
  // Group by the human direction label ("Uptown & The Bronx"); stops in one complex can share a label.
  const groups = new Map();
  for (const stop of complex.stops) {
    for (const [suffix, label] of [['N', stop.north], ['S', stop.south]]) {
      const key = label || (suffix === 'N' ? 'Northbound' : 'Southbound');
      if (!groups.has(key)) groups.set(key, []);
      const id = stop.stopId + suffix;
      for (const a of state.arrivals) {
        if (a.stopId === id && a.time >= nowSec - 30) groups.get(key).push(a);
      }
    }
  }
  // Within each direction, one row per line with its next few trains, lines ordered by who comes first.
  return [...groups.entries()]
    .map(([label, list]) => {
      const seen = new Set();
      const byRoute = new Map();
      for (const a of list.sort((x, y) => x.time - y.time)) {
        if (seen.has(a.tripId)) continue;
        seen.add(a.tripId);
        if (!byRoute.has(a.routeId)) byRoute.set(a.routeId, []);
        const times = byRoute.get(a.routeId);
        // The feed sometimes lists one train under two trip IDs; skip anything within a minute of the last one.
        if (times.length < PER_ROUTE && !(times.length && a.time - times[times.length - 1] < 60)) times.push(a.time);
      }
      return { label, lines: [...byRoute.entries()].map(([routeId, times]) => ({ routeId, times })) };
    })
    .filter((g) => g.lines.length);
}

function minutes(timeSec, nowSec) {
  const m = Math.floor((timeSec - nowSec) / 60);
  return m <= 0 ? '<span class="mins now">Now</span>' : `<span class="mins">${m}<small>min</small></span>`;
}

function laterMinutes(times, nowSec) {
  const rest = times.slice(1).map((t) => Math.max(0, Math.floor((t - nowSec) / 60)));
  return rest.length ? `<span class="later">then ${rest.join(', ')} min</span>` : '';
}

function distanceText(m) {
  if (m == null) return '';
  const miles = m / 1609.34;
  const walk = Math.max(1, Math.round(m / WALK_M_PER_MIN));
  return `${miles < 0.1 ? miles.toFixed(2) : miles.toFixed(1)} mi · ${walk} min walk`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  const complexes = visibleComplexes();
  const nowSec = Date.now() / 1000;

  if (!complexes.length) return;

  if (!state.updatedAt) {
    els.stations.innerHTML = complexes.map(() => '<div class="skeleton"></div>').join('');
    return;
  }

  els.stations.innerHTML = complexes.map((c) => {
    const dirs = directionsFor(c, nowSec);
    const body = dirs.length
      ? dirs.map((d) => `
          <section class="dir">
            <p class="dir-label">${esc(d.label)}</p>
            <ul class="arrivals">
              ${d.lines.map((l) => `<li class="arrival">${bullet(l.routeId)}${minutes(l.times[0], nowSec)}${laterMinutes(l.times, nowSec)}</li>`).join('')}
            </ul>
          </section>`).join('')
      : '<p class="empty">No trains expected right now.</p>';
    return `
      <article class="card">
        <div class="card-head">
          <h2>${esc(c.name)}</h2>
          <span class="dist">${distanceText(c.distance)}</span>
        </div>
        <div class="card-routes">${c.routes.map((r) => bullet(r, true)).join('')}</div>
        ${body}
      </article>`;
  }).join('');

  const time = state.updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const where = state.pinned ? 'Showing a chosen station' : 'Closest stations to you';
  els.status.textContent = `${where} · updated ${time}${state.feedWarning ? ` · ${state.feedWarning}` : ''}`;
}

// ---------- Search fallback ----------

function showSearch(show = true) {
  els.search.hidden = !show;
  els.toggleSearch.textContent = show ? 'Use my location instead' : 'Pick a station instead';
  if (show) els.searchInput.focus();
}

function renderSearch() {
  const q = els.searchInput.value.trim().toLowerCase();
  if (!q) { els.searchResults.innerHTML = ''; return; }
  const matches = state.complexes.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  els.searchResults.innerHTML = matches.map((c) => `
    <li><button type="button" data-id="${esc(c.id)}">
      <span>${esc(c.name)}</span>
      <span class="card-routes">${c.routes.map((r) => bullet(r, true)).join('')}</span>
    </button></li>`).join('') || '<li class="empty">No matching stations</li>';
}

els.searchInput.addEventListener('input', renderSearch);
els.search.addEventListener('submit', (e) => e.preventDefault());
els.searchResults.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  state.pinned = state.complexes.find((c) => c.id === btn.dataset.id);
  state.updatedAt = null;
  els.searchInput.value = '';
  renderSearch();
  showSearch(false);
  render();
  refresh();
});
els.toggleSearch.addEventListener('click', () => {
  if (els.search.hidden) return showSearch(true);
  state.pinned = null;
  showSearch(false);
  locate();
});
els.refresh.addEventListener('click', () => (state.position || state.pinned ? refresh() : locate()));

// ---------- Location ----------

function setPosition(lat, lon) {
  const first = !state.position;
  state.position = { lat, lon };
  if (first || !state.pinned) {
    state.updatedAt = null;
    render();
    refresh();
  }
}

function locate() {
  // ?lat=40.75&lon=-73.99 overrides GPS, handy for testing from a desk.
  const params = new URLSearchParams(location.search);
  if (params.has('lat') && params.has('lon')) {
    return setPosition(Number(params.get('lat')), Number(params.get('lon')));
  }
  if (!('geolocation' in navigator)) {
    els.status.textContent = 'Location isn’t available here. Pick a station below.';
    return showSearch(true);
  }
  els.status.textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition(
    (pos) => setPosition(pos.coords.latitude, pos.coords.longitude),
    (err) => {
      els.status.textContent = err.code === err.PERMISSION_DENIED
        ? 'Location is off. Pick a station below.'
        : 'Couldn’t get your location. Pick a station below.';
      showSearch(true);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

// ---------- Boot ----------

async function start() {
  try {
    state.stations = await loadStations();
    state.complexes = groupComplexes(state.stations);
  } catch (err) {
    els.status.textContent = 'Couldn’t load the station list. Check your connection and refresh.';
    return;
  }
  locate();
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  setInterval(() => { if (!document.hidden && state.updatedAt) render(); }, 10_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

start();

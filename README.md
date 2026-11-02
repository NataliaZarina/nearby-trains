# Nearby Trains

A mobile-first web app that finds the subway stations closest to you and shows live arrival times.

No build step, no API key, no server code: the browser fetches everything directly.

## Data sources (both open, no key, CORS-enabled)

- **Real-time arrivals:** MTA GTFS-realtime feeds, e.g.
  `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace`
  (one feed per line group: `gtfs` for 1-7/S, `gtfs-ace`, `gtfs-bdfm`, `gtfs-g`, `gtfs-jz`, `gtfs-nqrw`, `gtfs-l`, `gtfs-si`).
  Protobuf, decoded by the small hand-written reader in `gtfsrt.js`.
- **Station locations:** NY Open Data "MTA Subway Stations" (`https://data.ny.gov/resource/39hk-dx4f.json`), cached in the browser for a week.

## Run locally

```bash
python3 -m http.server 5173
```

Open http://localhost:5173. Add `?lat=40.7359&lon=-73.9906` to fake a location from your desk.

## On your phone

Browsers only share your location with HTTPS pages, so to use it on your phone, host the folder on any static host (GitHub Pages, Cloudflare Pages, Netlify). Then use "Add to Home Screen" to get an app icon.

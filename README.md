# Nearby Trains

A mobile-first web app showing live subway arrivals for the 4 stations closest to two saved addresses (edit `PLACES` in `app.js` to change them). Tap a tab to switch; the app remembers your last choice.

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

Open http://localhost:5173.

## On your phone

Host the folder on any static host, then use "Add to Home Screen" for an app icon. The two addresses are in the code, so if you host it publicly (a public GitHub repo or Pages site), anyone can see them.

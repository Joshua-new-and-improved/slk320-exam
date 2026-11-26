# Waypoint Maps

A privacy-first map and navigation web app that takes the most-loved features of Google Maps, Waze and Apple Maps and fixes things people often complain about. It runs without an account, ads or tracking.

## Run it

It's a static site of three files with no build step.

- **Quickest:** open `index.html` in Chrome, Edge or Firefox.
- **Better (GPS works everywhere):** serve it over HTTP and open `http://localhost:8000`:
  ```
  cd waypoint && python3 -m http.server 8000
  ```
- **On your phone:** host the folder on GitHub Pages, Netlify or Cloudflare Pages. GPS needs HTTPS. Then use "Add to Home Screen".

## Features

| Feature | Inspired by | Notes |
|---|---|---|
| Search with autocomplete, biased to where you're looking | Google | Photon, with Nominatim as a fallback. You can also paste coordinates like `-25.7479, 28.2293` |
| Place cards showing open/closed now, hours, phone, website and wheelchair access | Google/Apple | From OpenStreetMap tags |
| Nearby categories: fuel, food, coffee, groceries, pharmacy, hospital, ATM, EV charging, parking, toilets, police, places to stay | Google | |
| Up to 4 route alternatives, each showing time, distance, arrival time, main roads and toll/highway/ferry badges | Google | |
| **Avoid tolls / highways / ferries** that tells you plainly when no alternative avoids them | Requested | Picks the best alternative that complies |
| **Multi-stop routes with "Optimise order"** | Requested (Google lacks it) | OSRM trip service, with a local fallback |
| **Find along route**: fuel, food, coffee, EV, toilets within 500 m of your route, then add one as a stop in the right place | Requested | |
| **Trip fuel cost and CO₂** from your car's L/100 km and fuel price | Requested | |
| "Leave at" time with arrival estimate | Google | |
| Turn-by-turn navigation with voice, a "then…" preview of the next turn, live ETA, auto-reroute | All | |
| **Speed limit sign plus speeding warning** (configurable tolerance) | Waze | From OSM `maxspeed`, including SA implicit limits (urban 60, rural 100, motorway 120) |
| **Road reports**: police, crash, traffic, hazard, **robot out (load-shedding)**, pothole, closure, speed camera. Each expires on its own, and you can mark it "Still there" or "Gone" | Waze | Spoken warnings when one is ahead on your route |
| Preview drive (simulated) to rehearse a route | Requested | |
| Saved Home, Work and favourites, plus **Find my parked car** | Apple | |
| Share a place or your ETA | Google/Waze | |
| Long-press / right-click menu: what's here, directions to/from, add stop, save, copy coordinates | Google | |
| Measure distance tool | Google | |
| Street, Night, Satellite, Hybrid and OSM map styles, with automatic dark mode | Apple | |
| **Export / import your data** (JSON) and "Erase all data" | Requested | |
| Keyboard shortcuts: `/` search, `L` locate, `R` report, `D` directions, `,` settings | | |

## Honest limitations

- **No live traffic.** Free open routing doesn't include live traffic. ETAs assume typical road speeds. Use reports for incidents.
- **Reports stay on your device.** There is no server, so your reports aren't shared with other drivers. Sharing them would need a small backend, which is the natural next step.
- **Open data coverage varies.** Opening hours, speed limits and POIs come from OpenStreetMap volunteers, and coverage in South African metros is good but not complete.
- **Public demo servers** (OSRM FOSSGIS, Overpass, Photon, Nominatim) have fair-use limits. For heavy or commercial use, self-host them or use a paid provider.
- Fuel price is whatever you enter. The default R22.00/L is a placeholder, so check the current official DMRE price.

## Data & credits

Map data © OpenStreetMap contributors (ODbL). Tiles © CARTO, OSM, Esri. Routing: OSRM on FOSSGIS servers. Geocoding: Photon (Komoot) and Nominatim.

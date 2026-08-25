# Platinum Showcase

A static gallery of every PS platinum trophy, newest to oldest, with a spot
for a photo or clip of each one. Published on GitHub Pages, no backend.

## Re-syncing platinums from PSN

```
python3 scripts/sync_platinums.py <npsso>
```

Get a fresh NPSSO by logging into playstation.com, then visiting
https://ca.account.sony.com/api/v1/ssocookie and copying the `npsso` value
(valid ~2 months). The token is only ever passed as a command-line argument —
it is never written to a file or committed. This overwrites `data/platinums.json`.

Older (e.g. PS3-era) platinums generally aren't returned by this API. Add
those by hand to `data/manual_platinums.json` (create it if missing) using
the same shape as an entry in `data/platinums.json` — `np_communication_id`
can be anything unique, it's only used to look up media.

## Adding media for a platinum

1. Drop the photo/video into `media/`.
2. Add an entry to `data/media_map.json` mapping that game's
   `np_communication_id` (from `data/platinums.json`) to the filename.

Supported: `.mp4` / `.webm` / `.mov` (rendered as a looping muted preview,
click to play with sound) and `.jpg` / `.jpeg` / `.png`.

## Local preview

Any static file server works, e.g. `python3 -m http.server` from this
directory, then open http://localhost:8000.

## Deploying

GitHub Pages → Settings → Pages → Deploy from branch → `main` / `/ (root)`.
No build step.

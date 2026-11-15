# Live TV FR + AR (Nuvio / Stremio addon)

Your own live-TV addon: French and Arabic channels from M3U playlists, hosted on your own Vercel.
It only returns small JSON (channel list + stream links). The video goes straight from the broadcaster to your player, so hosting stays free and light.

## 1. GitHub
1. Create a NEW repo (e.g. `livetv`), upload the contents of this folder so `api/`, `vercel.json`, `package.json` are at the TOP level of the repo (not inside a sub-folder).

## 2. Vercel
1. Add New > Project > import the repo > Deploy (no framework, no build command).
2. Optional: Settings > Environment Variables, then Redeploy:
   - `ADDON_SECRET` = any word. Your link becomes `https://APP.vercel.app/WORD/manifest.json`
   - `MY_PLAYLISTS` = your own playlist link(s) (e.g. from a subscription you pay for), comma-separated
   - `FR_PLAYLISTS` / `AR_PLAYLISTS` = replace the default public lists
   - `CHECK_STREAMS=1` = test links when a channel is opened, working ones first
3. Open `https://APP.vercel.app/debug` : it shows how many channels loaded per catalog and any playlist errors.

## 3. Nuvio
Addons > add addon > paste `https://APP.vercel.app/manifest.json`.

Settings in the link (no redeploy): `/s_mode1/manifest.json`
- `mode0` = type "tv" only, `mode1` = channels shown as "movie" (use this if your Nuvio hides live TV), `mode2` = both (default)
- `fr0`, `ar0`, `my0` = hide that catalog. Example: `/s_mode1_my0/manifest.json`

## Notes
- Default sources are the public iptv-org lists. Many public streams are geo-blocked or dead; each channel can hold several links, the highest resolution comes first, try the next one if it fails.
- Use playlists you are entitled to (free-to-air or your own subscription).

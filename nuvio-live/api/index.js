// Stremio-protocol LIVE TV addon: French and Arabic channels from M3U playlists, hosted by you.
// The addon only serves small JSON answers (channel list, details, stream links). The video itself always flows directly
// from the broadcaster's server to your player, never through this addon.
//
// Install link:  https://YOUR-APP.vercel.app/manifest.json            (or /YOUR_SECRET/manifest.json)
//
// Env vars (all optional):
//   ADDON_SECRET   puts every route under /<secret>/ (recommended, and a must if you add your own paid playlist)
//   FR_PLAYLISTS   comma-separated M3U links for the French catalog (default: iptv-org French language + France)
//   AR_PLAYLISTS   comma-separated M3U links for the Arabic catalog (default: iptv-org Arabic language)
//   MY_PLAYLISTS   comma-separated M3U links of YOUR OWN playlists (a third catalog "Mes chaines")
//   CHECK_STREAMS=1  test every link when a channel is opened and list the working ones first (never hides any)
//   CACHE_MIN (30) how long playlists are kept in memory | PAGE_SIZE (100) channels per catalog page
//
// Settings in the install link (no redeploy): /s_mode1_ar0/manifest.json
//   mode: 0 = type "tv" (Stremio's live TV), 1 = channels shown as "movie" (if your app hides live TV), 2 = both (default)
//   fr / ar / my: 0 = hide that catalog

const crypto = require("crypto");

const UA = "NuvioLiveFrAr/1.0";
const PAGE_SIZE = Math.max(1, Number(process.env.PAGE_SIZE) || 100);
const CACHE_TTL = (Number(process.env.CACHE_MIN) || 30) * 60 * 1000;
const CHECK_STREAMS = process.env.CHECK_STREAMS === "1";

const list = (v, dflt) => (v === undefined ? dflt : String(v).split(/[,\n]/).map((s) => s.trim()).filter(Boolean));

const SOURCES = [
  {
    id: "fr", name: "Chaînes FR", lang: "fr",
    urls: list(process.env.FR_PLAYLISTS, [
   //  "https://iptv-org.github.io/iptv/languages/fra.m3u",
   "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8"
    
     // "https://iptv-org.github.io/iptv/countries/fr.m3u"
    ])
  },
  { id: "ar", name: "قنوات عربية", lang: "ar", urls: list(process.env.AR_PLAYLISTS, ["https://iptv-org.github.io/iptv/languages/ara.m3u"]) },
  { id: "my", name: "Mes chaînes", lang: "fr", urls: list(process.env.MY_PLAYLISTS, []) }
].filter((s) => s.urls.length);

// category (as written in the playlists) -> label shown in the app
const GENRES = {
  News: { fr: "Actualités", ar: "أخبار" },
  Sports: { fr: "Sport", ar: "رياضة" },
  Entertainment: { fr: "Divertissement", ar: "ترفيه" },
  Movies: { fr: "Films", ar: "أفلام" },
  Series: { fr: "Séries", ar: "مسلسلات" },
  Kids: { fr: "Jeunesse", ar: "أطفال" },
  Animation: { fr: "Animation", ar: "رسوم متحركة" },
  Music: { fr: "Musique", ar: "موسيقى" },
  Documentary: { fr: "Documentaires", ar: "وثائقي" },
  General: { fr: "Généraliste", ar: "عام" },
  Religious: { fr: "Religion", ar: "ديني" },
  Culture: { fr: "Culture", ar: "ثقافة" },
  Lifestyle: { fr: "Art de vivre", ar: "نمط الحياة" },
  Education: { fr: "Éducation", ar: "تعليم" },
  Comedy: { fr: "Humour", ar: "كوميديا" },
  Cooking: { fr: "Cuisine", ar: "طبخ" },
  Family: { fr: "Famille", ar: "عائلة" },
  Science: { fr: "Sciences", ar: "علوم" },
  Business: { fr: "Économie", ar: "أعمال" },
  Weather: { fr: "Météo", ar: "طقس" },
  Travel: { fr: "Voyage", ar: "سفر" }
};
const genreLabel = (g, lang) => (GENRES[g] && GENRES[g][lang]) || g;
const NSFW = /(^|[^a-z])(xxx|porn|adult|erotic|sex)([^a-z]|$)/i;

// ===== helpers ====================================================================================

const norm = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ًͯ-ٟـ]/g, "").toLowerCase();
const slug = (s) => norm(s).replace(/[^a-z0-9؀-ۿ]+/g, "");
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
const hostOf = (u) => { try { return new URL(u).host; } catch { return "?"; } };

// ===== M3U parser =======================================================================================

// "#EXTINF:-1 tvg-id=\"X\" group-title=\"News\",Name"  ->  { attrs, title }   (commas inside quotes are respected)
function parseExtinf(line) {
  const body = line.slice(line.indexOf(":") + 1);
  let inQuote = false, cut = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '"') inQuote = !inQuote;
    else if (body[i] === "," && !inQuote) { cut = i; break; }
  }
  const head = cut < 0 ? body : body.slice(0, cut);
  const title = cut < 0 ? "" : body.slice(cut + 1).trim();
  const attrs = {};
  for (const m of head.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1].toLowerCase()] = m[2];
  return { attrs, title };
}

function parseM3u(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text).replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) { cur = { ...parseExtinf(line), headers: {} }; continue; }
    if (!cur) continue;
    if (line.startsWith("#EXTVLCOPT:")) {
      const m = line.slice(11).match(/^([^=]+)=(.*)$/);
      if (m) {
        const k = m[1].trim().toLowerCase();
        if (k === "http-referrer" || k === "http-referer") cur.headers.Referer = m[2].trim();
        else if (k === "http-user-agent") cur.headers["User-Agent"] = m[2].trim();
      }
      continue;
    }
    if (line.startsWith("#EXTGRP:")) { if (!cur.attrs["group-title"]) cur.attrs["group-title"] = line.slice(8).trim(); continue; }
    if (line.startsWith("#")) continue;

    // Kodi style: https://host/stream.m3u8|User-Agent=...&Referer=...
    const [url, hdr] = line.split("|");
    if (/^https?:\/\//i.test(url)) {
      if (hdr) {
        for (const kv of hdr.split("&")) {
          const [k, ...v] = kv.split("=");
          const key = (k || "").trim().toLowerCase();
          const val = decodeURIComponent(v.join("=") || "").trim();
          if (key === "user-agent") cur.headers["User-Agent"] = val;
          else if (key === "referer" || key === "referrer") cur.headers.Referer = val;
        }
      }
      out.push({ ...cur, url });
    }
    cur = null;
  }
  return out;
}

// "Arte (1080p) [Geo-blocked]" -> { name: "Arte", height: 1080, flags: ["Geo-blocked"] }
function cleanName(raw) {
  const flags = [];
  let height = 0;
  let name = String(raw || "")
    .replace(/\[([^\]]*)\]/g, (_, f) => { if (f.trim()) flags.push(f.trim()); return ""; })
    .replace(/\((\d{3,4})p\)/gi, (_, h) => { height = Math.max(height, Number(h)); return ""; })
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!name) name = String(raw || "").trim();
  return { name, height, flags };
}

// ===== playlists -> channels ================================================================================

const urlCache = new Map();   // url -> { at, entries }   (kept when a refresh fails)
const status = {};            // url host -> last result (for /debug)

async function fetchPlaylist(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const entries = parseM3u(await r.text());
    urlCache.set(url, { at: Date.now(), entries });
    status[hostOf(url) + " " + sha(url).slice(0, 4)] = { ok: true, entries: entries.length, at: new Date().toISOString() };
    return entries;
  } catch (e) {
    console.error(`playlist ${hostOf(url)} failed:`, e.message || e);
    status[hostOf(url) + " " + sha(url).slice(0, 4)] = { ok: false, error: String(e.message || e), at: new Date().toISOString() };
    return (urlCache.get(url) || {}).entries || [];
  }
}

function buildChannels(src, entries) {
  const byKey = new Map();
  for (const e of entries) {
    const group = e.attrs["group-title"] || "";
    if (NSFW.test(group) || NSFW.test(e.title)) continue;
    const { name, height, flags } = cleanName(e.title || e.attrs["tvg-name"]);
    if (!name) continue;
    const idKey = String(e.attrs["tvg-id"] || "").split("@")[0].toLowerCase();
    const key = idKey || slug(name);
    let ch = byKey.get(key);
    if (!ch) {
      ch = { id: "lv_" + sha(`${src.id}|${key}`), source: src.id, name, logo: e.attrs["tvg-logo"] || "", genres: new Set(), streams: [] };
      byKey.set(key, ch);
    }
    if (!ch.logo && e.attrs["tvg-logo"]) ch.logo = e.attrs["tvg-logo"];
    for (const g of group.split(";").map((x) => x.trim()).filter(Boolean)) if (g.toLowerCase() !== "undefined") ch.genres.add(g);
    if (!ch.streams.some((s) => s.url === e.url)) {
      ch.streams.push({ url: e.url, height, flags, headers: e.headers });
    }
  }
  const channels = [...byKey.values()];
  for (const ch of channels) ch.streams.sort((a, b) => b.height - a.height);
  channels.sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
  return channels;
}

let store = null;     // { at, sources: { fr: { channels, byId }, ... } }
let loading = null;

async function loadAll() {
  const sources = {};
  await Promise.all(SOURCES.map(async (src) => {
    const lists = await Promise.all(src.urls.map(fetchPlaylist));
    const channels = buildChannels(src, lists.flat());
    sources[src.id] = { channels, byId: new Map(channels.map((c) => [c.id, c])) };
  }));
  return { at: Date.now(), sources };
}

async function getStore() {
  if (store && Date.now() - store.at < CACHE_TTL) return store;
  if (!loading) loading = loadAll().then((s) => { store = s; return s; }).finally(() => { loading = null; });
  return store || loading;   // stale data is served while a refresh runs
}

function findChannel(s, id) {
  for (const src of Object.values(s.sources)) if (src.byId.has(id)) return src.byId.get(id);
  return null;
}

// ===== Stremio objects ====================================================================================

const toMeta = (ch, type, lang) => ({
  id: ch.id,
  type,
  name: ch.name,
  poster: ch.logo || undefined,
  posterShape: "square",
  logo: ch.logo || undefined,
  genres: [...ch.genres].map((g) => genreLabel(g, lang)),
  description: `${[...ch.genres].map((g) => genreLabel(g, lang)).join(" • ") || "Live"} — ${ch.streams.length} flux`,
  releaseInfo: "LIVE",
  behaviorHints: { defaultVideoId: ch.id }
});

const DEFAULT_CFG = { mode: 2, fr: 1, ar: 1, my: 1 };
const CFG_LIMITS = { mode: [0, 2], fr: [0, 1], ar: [0, 1], my: [0, 1] };
const CFG_SEG = /^s_[a-z0-9_.-]+$/i;
function parseCfgSeg(seg) {
  const cfg = { ...DEFAULT_CFG };
  for (const m of seg.slice(2).matchAll(/([a-z]+)(-?\d+)/gi)) {
    const k = m[1].toLowerCase(), v = Number(m[2]);
    if (CFG_LIMITS[k]) cfg[k] = Math.min(CFG_LIMITS[k][1], Math.max(CFG_LIMITS[k][0], v));
  }
  return cfg;
}

function manifestFor(cfg) {
  const types = cfg.mode === 0 ? ["tv"] : cfg.mode === 1 ? ["movie"] : ["tv", "movie"];
  const catalogs = [];
  for (const src of SOURCES) {
    if (cfg[src.id] === 0) continue;
    const options = Object.keys(GENRES).map((g) => genreLabel(g, src.lang));
    for (const type of types) {
      catalogs.push({
        type, id: `live-${src.id}`, name: src.name,
        extra: [{ name: "genre", options, isRequired: false }, { name: "search", isRequired: false }, { name: "skip", isRequired: false }]
      });
    }
  }
  return {
    id: "community.live.fr.ar",
    version: "1.0.0",
    name: "Live TV FR + AR",
    description: "French and Arabic live channels from public or personal M3U playlists.",
    resources: ["catalog", "meta", "stream"],
    types,
    idPrefixes: ["lv_"],
    catalogs,
    behaviorHints: { configurable: false }
  };
}

// ===== optional link check ===========================================================================================

const aliveCache = new Map();   // url -> { at, ok }
async function isAlive(s) {
  const hit = aliveCache.get(s.url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.ok;
  let ok = false;
  try {
    const r = await fetch(s.url, {
      headers: { Range: "bytes=0-0", "User-Agent": UA, ...s.headers },
      signal: AbortSignal.timeout(3500)
    });
    ok = r.status < 400;
    r.body && r.body.cancel && r.body.cancel().catch(() => {});
  } catch { ok = false; }
  aliveCache.set(s.url, { at: Date.now(), ok });
  return ok;
}

async function streamsFor(ch) {
  let items = ch.streams.map((s) => ({ s, ok: null }));
  if (CHECK_STREAMS) {
    items = await Promise.all(ch.streams.map(async (s) => ({ s, ok: await isAlive(s) })));
    items.sort((a, b) => Number(b.ok) - Number(a.ok));   // working first, nothing is hidden (a geo-block seen from the server may not apply to you)
  }
  return items.map(({ s, ok }) => {
    const hints = { notWebReady: true };
    if (Object.keys(s.headers).length) hints.proxyHeaders = { request: s.headers };
    const bits = [s.height ? `${s.height}p` : "", ...s.flags];
    return {
      name: ok === null ? "Live" : ok ? "Live ✓" : "Live ?",
      title: `${bits.filter(Boolean).join(" • ") || "Live"}\n${hostOf(s.url)}`,
      url: s.url,
      behaviorHints: hints
    };
  });
}

// ===== HTTP ========================================================================================================

function sendJson(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (cache) res.setHeader("Cache-Control", cache);
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  // On Vercel the rewrite passes the path as ?__p=... (maybe with %2F); locally it is the URL path.
  const rawUrl = req.url || "/";
  const q = rawUrl.indexOf("?");
  const rawPath = q === -1 ? rawUrl : rawUrl.slice(0, q);
  const rawQuery = q === -1 ? "" : rawUrl.slice(q + 1);
  let pathString = rawPath;
  if (rawQuery.startsWith("__p=")) pathString = "/" + rawQuery.slice(4).replace(/%2F/gi, "/");
  const parts = pathString.split("/").filter(Boolean).map((seg) => { try { return decodeURIComponent(seg); } catch { return seg; } });
  if (parts[0] === "api") parts.shift();

  const secret = process.env.ADDON_SECRET;
  if (secret) {
    if (parts[0] !== secret) { res.statusCode = 404; return res.end("Not found"); }
    parts.shift();
  }
  let cfgSeg = "";
  let cfg = DEFAULT_CFG;
  if (parts[0] && CFG_SEG.test(parts[0])) { cfgSeg = parts.shift(); cfg = parseCfgSeg(cfgSeg); }

  const proto = req.headers["x-forwarded-proto"] || "http";
  const base = `${proto}://${req.headers.host}${secret ? "/" + encodeURIComponent(secret) : ""}${cfgSeg ? "/" + cfgSeg : ""}`;

  try {
    if (!parts.length) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(`Live TV FR + AR addon is running.\nInstall link: ${base}/manifest.json\n`);
    }
    if (parts[0] === "manifest.json") return sendJson(res, 200, manifestFor(cfg), "public, max-age=600");

    if (parts[0] === "debug") {
      const s = await getStore();
      return sendJson(res, 200, {
        loadedAt: new Date(s.at).toISOString(), checkStreams: CHECK_STREAMS,
        catalogs: Object.fromEntries(Object.entries(s.sources).map(([id, v]) => [id, { channels: v.channels.length, streams: v.channels.reduce((n, c) => n + c.streams.length, 0) }])),
        playlists: status
      });
    }

    // /catalog/<type>/<catalogId>[/<extra>].json
    if (parts[0] === "catalog" && parts.length >= 3) {
      const type = parts[1];
      const srcId = parts[2].replace(/\.json$/, "").replace(/^live-/, "");
      const src = SOURCES.find((x) => x.id === srcId);
      const extra = Object.fromEntries(new URLSearchParams((parts[3] || "").replace(/\.json$/, "")));
      if (!src) return sendJson(res, 200, { metas: [] });
      const s = await getStore();
      let chans = s.sources[srcId] ? s.sources[srcId].channels : [];
      if (extra.genre) {
        const wanted = Object.keys(GENRES).find((g) => genreLabel(g, src.lang) === extra.genre) || extra.genre;
        chans = chans.filter((c) => c.genres.has(wanted));
      }
      if (extra.search) {
        const words = norm(extra.search).split(/\s+/).filter(Boolean);
        chans = chans.filter((c) => { const n = norm(c.name); return words.every((w) => n.includes(w)); });
      }
      const skip = Math.max(0, Number(extra.skip) || 0);
      const metas = chans.slice(skip, skip + PAGE_SIZE).map((c) => toMeta(c, type, src.lang));
      return sendJson(res, 200, { metas }, "public, s-maxage=600, stale-while-revalidate=3600");
    }

    // /meta/<type>/<id>.json and /stream/<type>/<id>.json
    if ((parts[0] === "meta" || parts[0] === "stream") && parts.length >= 3) {
      const type = parts[1];
      const id = parts[2].replace(/\.json$/, "");
      const s = await getStore();
      const ch = findChannel(s, id);
      if (!ch) return sendJson(res, 200, parts[0] === "meta" ? { meta: null } : { streams: [] });
      if (parts[0] === "meta") {
        const lang = (SOURCES.find((x) => x.id === ch.source) || {}).lang || "fr";
        return sendJson(res, 200, { meta: toMeta(ch, type, lang) }, "public, s-maxage=600, stale-while-revalidate=3600");
      }
      return sendJson(res, 200, { streams: await streamsFor(ch) }, CHECK_STREAMS ? "public, s-maxage=120" : "public, s-maxage=600, stale-while-revalidate=3600");
    }

    res.statusCode = 404;
    res.end(`Not found (path seen: /${parts.join("/")}, secret ${secret ? "ON" : "OFF"})`);
  } catch (err) {
    console.error(err);
    if (parts[0] === "catalog") return sendJson(res, 200, { metas: [] });
    if (parts[0] === "stream") return sendJson(res, 200, { streams: [] });
    res.statusCode = 502;
    res.end("Upstream error");
  }
};

module.exports.__test = { parseM3u, cleanName, buildChannels };

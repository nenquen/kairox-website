const fs = require('fs');
const { status, statusBedrock } = require('minecraft-server-util');
const OUT = '/var/www/status.kairox.fun/api.json';
const HIST = '/opt/mcstatus/history.json';
const DAY = 86400000;
const HOUR = 3600000;
let hist = [];
try { hist = JSON.parse(fs.readFileSync(HIST, 'utf8')); if (!Array.isArray(hist)) hist = []; } catch { hist = []; }
function save() {
  try {
    fs.writeFileSync(HIST + '.tmp', JSON.stringify(hist));
    fs.renameSync(HIST + '.tmp', HIST);
  } catch (e) { console.error('hist-save-err'); }
}
function uptimePct(field, since) {
  const cut = Date.now() - since;
  const s = hist.filter((x) => x.t >= cut && x[field] !== undefined && x[field] !== null);
  if (s.length < 5) return null;
  return s.filter((x) => x[field]).length / s.length;
}
function dayBuckets() {
  const out = [];
  const now = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const next = d.getTime() + DAY;
    const s = hist.filter((x) => x.t >= d.getTime() && x.t < next);
    let up = null;
    if (s.length) up = s.filter((x) => x.j || x.b).length / s.length;
    out.push({ d: d.toISOString().slice(0, 10), up: up === null ? null : Math.round(up * 1000) / 1000 });
  }
  return out;
}
function players24h() {
  const out = [];
  const now = Date.now();
  const curHour = Math.floor(now / HOUR) * HOUR;
  for (let i = 23; i >= 0; i--) {
    const st = curHour - i * HOUR;
    const s = hist.filter((x) => x.t >= st && x.t < st + HOUR);
    out.push({ t: st, p: s.length ? Math.max(...s.map((x) => x.p || 0)) : 0 });
  }
  return out;
}
const NOTES = '/opt/mcstatus/notes.json';
function loadNotes() {
  try {
    const n = JSON.parse(fs.readFileSync(NOTES, 'utf8'));
    const m = {};
    if (Array.isArray(n)) for (const e of n) { if (e && e.start) m[e.start] = { text: String(e.text || '').slice(0, 300), by: String(e.by || '').slice(0, 24) }; }
    return m;
  } catch { return {}; }
}
function incidents() {
  const list = [];
  let cur = null;
  const sorted = hist.slice().sort((a, b) => a.t - b.t);
  for (const s of sorted) {
    const down = !s.j && !s.b;
    const which = !s.j && !s.b ? 'both' : (!s.j ? 'java' : 'bedrock');
    if (down) {
      if (!cur) cur = { start: s.t, end: s.t, which: which };
      else { cur.end = s.t; if (cur.which !== which) cur.which = 'mixed'; }
    } else if (cur) {
      list.push(cur);
      cur = null;
    }
  }
  if (cur) list.push(cur);
  const notes = loadNotes();
  return list.slice(-15).reverse().map((x) => {
    const mins = Math.max(1, Math.round((x.end - x.start) / 60000));
    const title = x.which === 'both' ? 'Server unreachable' : (x.which === 'java' ? 'Java unreachable' : (x.which === 'bedrock' ? 'Bedrock unreachable' : 'Connectivity issues'));
    const o = { start: x.start, end: x.end, mins: mins, title: title };
    if (notes[x.start]) { o.note = notes[x.start].text; if (notes[x.start].by) o.by = notes[x.start].by; }
    return o;
  });
}
async function checkWeb() {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch('https://kairox.fun/', { signal: ctl.signal, redirect: 'follow' });
    clearTimeout(to);
    await r.arrayBuffer().then((b) => b.byteLength).catch(() => 0);
    return { online: r.ok, ms: Date.now() - t0 };
  } catch { return { online: false, ms: null }; }
}
async function check() {
  const t = Date.now();
  let j = false, b = false;
  let jms = null, bms = null;
  let info = { players: 0, max: 20, version: '', motd: '', list: [] };
  let binfo = { players: 0, max: 20, version: '' };
  try {
    const t0 = Date.now();
    const r = await status('127.0.0.1', 25565, { timeout: 8000 });
    j = true; jms = (typeof r.roundTripLatency === 'number' ? r.roundTripLatency : Date.now() - t0);
    info = { players: r.players.online, max: r.players.max, version: r.version.name, motd: String((r.motd && r.motd.clean) || '').slice(0, 120), list: ((r.players && r.players.sample) || []).map((p) => p.name) };
  } catch (e) { j = false; }
  try {
    const t0 = Date.now();
    const r = await statusBedrock('127.0.0.1', 19132, { timeout: 8000 });
    b = true; bms = (typeof r.roundTripLatency === 'number' ? r.roundTripLatency : Date.now() - t0);
    binfo = { players: r.players.online, max: r.players.max, version: r.version.name };
  } catch (e) { b = false; }
  const w = await checkWeb();
  hist.push({ t: t, j: j ? 1 : 0, b: b ? 1 : 0, w: w.online ? 1 : 0, p: info.players, jms: jms, bms: bms, wms: w.ms });
  const cut = Date.now() - 95 * DAY;
  while (hist.length && hist[0].t < cut) hist.shift();
  save();
  const allUp = j && b && w.online;
  const coreDown = !j && !b;
  const st = allUp ? 'operational' : (coreDown ? 'outage' : 'partial');
  const pct = (v) => (v === null ? null : Math.round(v * 1000) / 1000);
  const data = {
    updated: t, status: st,
    players: info.players, max: info.max, version: info.version, motd: info.motd, list: info.list,
    uptime: { d7: pct(uptimePct('j', 7 * DAY)), d30: pct(uptimePct('j', 30 * DAY)), d90: pct(uptimePct('j', 90 * DAY)) },
    components: [
      { id: 'java', name: 'Java', online: j, ms: jms, players: info.players, max: info.max, version: info.version, uptime90: pct(uptimePct('j', 90 * DAY)) },
      { id: 'bedrock', name: 'Bedrock', online: b, ms: bms, players: binfo.players, max: binfo.max, version: binfo.version, uptime90: pct(uptimePct('b', 90 * DAY)) },
      { id: 'web', name: 'Website', online: w.online, ms: w.ms, uptime90: pct(uptimePct('w', 90 * DAY)) },
    ],
    players24h: players24h(),
    days: dayBuckets(),
    incidents: incidents()
  };
  try {
    const wl = JSON.parse(fs.readFileSync('/home/nenquen/kairox/whitelist.json', 'utf8'));
    data.whitelist = Array.isArray(wl) ? wl.length : null;
  } catch { data.whitelist = null; }
  const payload = JSON.stringify(data);
  fs.writeFileSync(OUT + '.tmp', payload);
  fs.renameSync(OUT + '.tmp', OUT);
  try {
    fs.writeFileSync('/var/www/kairox.fun/api.json.tmp', payload);
    fs.renameSync('/var/www/kairox.fun/api.json.tmp', '/var/www/kairox.fun/api.json');
  } catch (e) { console.error('api-copy-err'); }
}
check();
setInterval(check, 60000);

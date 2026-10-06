/* Kairox admin panel - zero dependencies, localhost only, behind nginx+TLS */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { execFile, spawn } = require('child_process');

const DIR = '/opt/admin-panel';
const DATA = DIR + '/data';
const AUTH_FILE = DATA + '/auth.json';
const APPS_FILE = DATA + '/apps.json';
const AUDIT_FILE = DATA + '/audit.log';
const RCON_PASS_FILE = '/opt/kairox-bot/rcon.pass';
const WL_PATH = '/home/nenquen/kairox/whitelist.json';
const PORT = 8471;

function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, o) { const t = p + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 2)); fs.renameSync(t, p); }
function audit(actor, action, detail) {
  try { fs.appendFileSync(AUDIT_FILE, JSON.stringify({ t: Date.now(), actor, action, detail }) + '\n'); } catch {}
}

/* ---------- mail (builtin SMTP, no deps) ---------- */
const MAIL_FILE = DATA + '/mail.json';
function mailCfg() {
  try {
    const c = JSON.parse(fs.readFileSync(MAIL_FILE, 'utf8'));
    if (c && c.host && c.user && c.pass) return { port: 587, secure: false, from: c.user, ...c };
  } catch {}
  return null;
}
function isEmail(s) { return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(s || '').trim()); }
function mailWrap(title, head, body) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
    + '<body style="margin:0;background:#141020;color:#dcd6f0;font-family:Verdana,Geneva,sans-serif;line-height:1.7">'
    + '<div style="max-width:560px;margin:0 auto;padding:32px 20px">'
    + '<div style="text-align:center;padding:8px 0 20px"><img src="https://kairox.fun/icon-noback.png" alt="Kairox" style="height:48px">'
    + '<div style="font-size:20px;color:#fff;font-weight:bold;margin-top:8px">' + title + '</div></div>'
    + '<div style="background:#1c152e;border:1px solid #3a2d63;border-radius:14px;padding:26px 24px">'
    + '<div style="font-size:15px;color:#b388ff;font-weight:bold;margin-bottom:10px">' + head + '</div>'
    + '<div style="font-size:14px;color:#dcd6f0">' + body + '</div>'
    + '<div style="margin-top:22px;text-align:center"><span style="display:inline-block;background:#7c4dff;border-radius:8px;padding:10px 22px;color:#fff;font-size:14px;font-weight:bold">smp.kairox.fun</span></div>'
    + '</div><div style="text-align:center;font-size:12px;color:#9a90b8;margin-top:16px">&copy; 2026 Kairox SMP</div>'
    + '</div></body></html>';
}
function mailApproved(nick) {
  const safe = esc(nick || '');
  return mailWrap('Kairox SMP', 'Application approved!',
    'Hi! Your application was <b style="color:#57F287">approved</b>' + (nick ? ' for <b style="color:#fff">' + safe + '</b>' : '') + '.<br><br>'
    + 'Java: add server <b style="color:#fff">smp.kairox.fun</b> &nbsp; Bedrock: same address, port <b style="color:#fff">19132</b>.<br>'
    + 'Read the rules on Discord and have fun!');
}
function mailRejected() {
  return mailWrap('Kairox SMP', 'Application update',
    'Hi! Thanks for applying to Kairox.<br><br>'
    + 'This time your application was <b style="color:#E74C3C">not accepted</b>. You are welcome to apply again later with a bit more detail about yourself.<br><br>'
    + '<span style="color:#9a90b8">Questions? Reply to this mail or ask on Discord.</span>');
}
function smtpSend(cfg, to, subject, html) {
  return new Promise((resolve, reject) => {
    const tls = require('tls');
    let sock = net.createConnection({ host: cfg.host, port: cfg.port || 587 }, () => step('EHLO kairox.fun'));
    let buf = '';
    let stage = 0;
    const timer = setTimeout(() => { try { sock.destroy(); } catch {} reject(new Error('smtp timeout')); }, 20000);
    const done = (e, v) => { clearTimeout(timer); try { sock.destroy(); } catch {} e ? reject(e) : resolve(v); };
    function send(l) { sock.write(l + '\r\n'); }
    function step(cmd) { if (cmd) send(cmd); }
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      if (!/(^|\r\n)\d{3}[ ]/.test(buf) && !buf.endsWith('\n')) return;
      const lines = buf.trim().split('\r\n');
      const last = lines[lines.length - 1];
      const code = parseInt(last.slice(0, 3));
      buf = '';
      try {
        if (stage === 0) {
          if (code !== 250) return done(new Error('ehlo ' + code));
          if (cfg.secure) { stage = 2; step('EHLO kairox.fun'); }
          else { stage = 1; step('STARTTLS'); }
        } else if (stage === 1) {
          if (code !== 220) return done(new Error('starttls ' + code));
          const sec = tls.connect({ socket: sock, host: cfg.host, servername: cfg.host }, () => { stage = 2; send('EHLO kairox.fun'); });
          sock.removeAllListeners('data');
          sock = sec;
          sock.on('data', (dd) => {
            buf += dd.toString('utf8');
            if (!/(^|\r\n)\d{3}[ ]/.test(buf) && !buf.endsWith('\n')) return;
            const ls = buf.trim().split('\r\n');
            const cd = parseInt(ls[ls.length - 1].slice(0, 3));
            buf = '';
            onCode(cd);
          });
          sock.on('error', (e) => done(e));
        } else onCode(code);
      } catch (e) { done(e); }
    });
    function onCode(code) {
      if (stage === 2) {
        if (code !== 250) return done(new Error('ehlo2 ' + code));
        stage = 3; step('AUTH LOGIN');
      } else if (stage === 3) {
        if (code !== 334) return done(new Error('auth ' + code));
        stage = 4; send(Buffer.from(cfg.user, 'utf8').toString('base64'));
      } else if (stage === 4) {
        if (code !== 334) return done(new Error('authu ' + code));
        stage = 5; send(Buffer.from(String(cfg.pass), 'utf8').toString('base64'));
      } else if (stage === 5) {
        if (code !== 235) return done(new Error('authp ' + code));
        stage = 6; step('MAIL FROM:<' + cfg.from + '>');
      } else if (stage === 6) {
        if (code !== 250) return done(new Error('mailfrom ' + code));
        stage = 7; step('RCPT TO:<' + sendTo + '>');
      } else if (stage === 7) {
        if (code !== 250 && code !== 251) return done(new Error('rcpt ' + code));
        stage = 8; step('DATA');
      } else if (stage === 8) {
        if (code !== 354) return done(new Error('data ' + code));
        stage = 9;
        const msg = 'From: Kairox SMP <' + cfg.from + '>\r\nTo: <' + sendTo + '>\r\nSubject: ' + subject + '\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n' + html + '\r\n.';
        send(msg);
      } else if (stage === 9) {
        if (code !== 250) return done(new Error('send ' + code));
        stage = 10; step('QUIT');
      } else done(null, true);
    }
    let sendTo = to;
    sock.on('error', (e) => done(e));
  });
}
async function notifyApplicant(a, kind, nick) {
  if (!isEmail(a.from)) return 'no mail sent (applicant address is not an email).';
  const cfg = mailCfg();
  if (!cfg) return 'status saved, but no mail sent (SMTP not configured - see DATA/mail.json).';
  try {
    if (kind === 'approved') await smtpSend(cfg, a.from.trim(), 'Kairox SMP - application approved', mailApproved(nick));
    else await smtpSend(cfg, a.from.trim(), 'Kairox SMP - application update', mailRejected());
    audit('mailer', kind + '-mail', a.from);
    return 'mail sent to ' + a.from + '.';
  } catch (e) {
    audit('mailer', 'mail-fail', String((e && e.message) || e));
    return 'status saved, but mail failed (' + String((e && e.message) || e).slice(0, 80) + ').';
  }
}

/* ---------- RCON (raw protocol, no deps) ---------- */
function rconSend(cmd) {
  return new Promise((resolve, reject) => {
    const pass = fs.readFileSync(RCON_PASS_FILE, 'utf8').trim();
    const sock = net.createConnection({ host: '127.0.0.1', port: 25575 }, () => {
      sendPacket(3, pass);
    });
    let buf = Buffer.alloc(0);
    let authed = false;
    let reqId = 1;
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('rcon timeout')); }, 10000);
    function sendPacket(type, body) {
      const b = Buffer.from(body, 'utf8');
      const p = Buffer.alloc(14 + b.length);
      p.writeInt32LE(10 + b.length, 0);
      p.writeInt32LE(reqId, 4);
      p.writeInt32LE(type, 8);
      b.copy(p, 12);
      p.writeInt16LE(0, 12 + b.length);
      sock.write(p);
    }
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0);
        if (buf.length < 4 + len) break;
        const id = buf.readInt32LE(4);
        const type = buf.readInt32LE(8);
        const body = buf.slice(12, 4 + len - 2).toString('utf8');
        buf = buf.slice(4 + len);
        if (!authed) {
          if (id === -1) { clearTimeout(timer); sock.destroy(); reject(new Error('rcon auth failed')); return; }
          authed = true;
          sendPacket(2, cmd);
        } else if (type === 0) {
          clearTimeout(timer); sock.destroy(); resolve(body);
        }
      }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
function rconSendFull(cmd, quietMs) {
  return new Promise((resolve, reject) => {
    const pass = fs.readFileSync(RCON_PASS_FILE, 'utf8').trim();
    const sock = net.createConnection({ host: '127.0.0.1', port: 25575 }, () => {
      sendPacket(3, pass);
    });
    let buf = Buffer.alloc(0);
    let authed = false;
    let reqId = 1;
    let out = '';
    let gotAny = false;
    let quiet = null;
    const hard = setTimeout(() => { try { sock.destroy(); } catch {} gotAny ? resolve(out) : reject(new Error('rcon timeout')); }, 12000);
    const finish = () => { clearTimeout(hard); try { sock.destroy(); } catch {} resolve(out); };
    const hush = () => { if (quiet) clearTimeout(quiet); quiet = setTimeout(finish, quietMs || 700); };
    function sendPacket(type, body) {
      const b = Buffer.from(body, 'utf8');
      const p = Buffer.alloc(14 + b.length);
      p.writeInt32LE(10 + b.length, 0);
      p.writeInt32LE(reqId, 4);
      p.writeInt32LE(type, 8);
      b.copy(p, 12);
      p.writeInt16LE(0, 12 + b.length);
      sock.write(p);
    }
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0);
        if (buf.length < 4 + len) break;
        const id = buf.readInt32LE(4);
        const type = buf.readInt32LE(8);
        const body = buf.slice(12, 4 + len - 2).toString('utf8');
        buf = buf.slice(4 + len);
        if (!authed) {
          if (id === -1) { clearTimeout(hard); sock.destroy(); reject(new Error('rcon auth failed')); return; }
          authed = true;
          sendPacket(2, cmd);
        } else if (type === 0) {
          gotAny = true;
          out += body;
          hush();
        }
      }
    });
    sock.on('error', (e) => { clearTimeout(hard); if (quiet) clearTimeout(quiet); gotAny ? resolve(out) : reject(e); });
  });
}

/* ---------- whitelist (offline UUIDs) ---------- */
function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.toString('hex');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}
function cleanNick(n) {
  const s = String(n || '').trim();
  return /^[A-Za-z0-9_]{3,16}$/.test(s) ? s : null;
}
async function mcAdd(nick) {
  const cur = readJSON(WL_PATH, []);
  if (!cur.some((e) => String(e.name).toLowerCase() === nick.toLowerCase())) {
    cur.push({ uuid: offlineUuid(nick), name: nick });
    writeJSON(WL_PATH, cur);
    await rconSend('whitelist reload');
  }
  try { await rconSend('fwhitelist add ' + nick); } catch {}
  try { await mcSend('lp user ' + offlineUuid(nick) + ' parent add player'); } catch {}
  return 'added ' + nick;
}
async function mcRemove(nick) {
  const list = readJSON(WL_PATH, []).filter((e) => String(e.name).toLowerCase() !== nick.toLowerCase());
  writeJSON(WL_PATH, list);
  try { await rconSend('fwhitelist remove ' + nick); } catch {}
  await rconSend('whitelist reload');
  return 'removed ' + nick;
}

/* ---------- auth: scrypt + TOTP, no deps ---------- */
function b32dec(s) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '', out = [];
  for (const c of s.toUpperCase().replace(/=+$/, '')) {
    const v = abc.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function hotp(secret, counter) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(c).digest();
  const o = h[h.length - 1] & 0x0f;
  return (h.readUInt32BE(o) & 0x7fffffff) % 1000000;
}
function totpOk(secretB32, code) {
  const step = Math.floor(Date.now() / 30000);
  const want = String(code).padStart(6, '0');
  for (const s of [step - 1, step, step + 1]) {
    if (String(hotp(b32dec(secretB32), s)).padStart(6, '0') === want) return true;
  }
  return false;
}

/* ---------- sessions + rate limit ---------- */
const sessions = new Map();
const SESS_FILE = DATA + '/sessions.json';
let lastLoginAt = 0;
try {
  const saved = readJSON(SESS_FILE, []);
  if (Array.isArray(saved)) for (const s of saved) {
    if (s && s.sid && s.exp && Date.now() < s.exp) sessions.set(s.sid, s);
  }
} catch {}
function saveSessions() {
  try { writeJSON(SESS_FILE, Array.from(sessions.entries()).map(([sid, s]) => ({ sid, ...s }))); } catch {}
}
const fails = new Map();
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    const ip = xff.split(',')[0].trim();
    if (/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return ip;
  }
  return req.socket.remoteAddress || 'unknown';
}
function blocked(ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() < f.until) return true;
  fails.delete(ip);
  return false;
}
function noteFail(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) { f.until = Date.now() + 15 * 60000; f.n = 0; }
  fails.set(ip, f);
}
function newSession(user, ip, csrf) {
  const sid = crypto.randomBytes(32).toString('hex');
  if (!/^[0-9a-f]{32}$/.test(csrf || '')) csrf = crypto.randomBytes(16).toString('hex');
  sessions.set(sid, { user, csrf, ip, exp: Date.now() + 7 * 86400000 });
  saveSessions();
  return { sid, csrf };
}
function getSession(req) {
  const c = parseCookies(req)['sid'];
  if (!c) return null;
  const s = sessions.get(c);
  if (!s || Date.now() > s.exp) { sessions.delete(c); return null; }
  return { sid: c, ...s };
}
function parseCookies(req) {
  const o = {};
  const h = req.headers.cookie;
  if (!h) return o;
  for (const p of h.split(';')) {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return o;
}
setInterval(() => {
  for (const [k, s] of sessions) if (Date.now() > s.exp) sessions.delete(k);
}, 600000);

/* ---------- http helpers ---------- */
function secHeaders(res) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.cdnfonts.com https://fonts.googleapis.com; font-src https://fonts.gstatic.com https://fonts.cdnfonts.com; img-src 'self' https://kairox.fun https://minotar.net");
}
function send(res, code, type, body) {
  secHeaders(res);
  if (type === 'text/html') res.setHeader('Cache-Control', 'no-store');
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' });
  res.end(body);
}
function redirect(res, to) {
  secHeaders(res);
  res.writeHead(302, { Location: to });
  res.end();
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const parts = [];
    req.on('data', (d) => {
      n += d.length;
      if (n > max) { reject(new Error('too big')); req.destroy(); return; }
      parts.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}
function parseForm(s) {
  const o = {};
  for (const p of s.split('&')) {
    const i = p.indexOf('=');
    if (i > 0) o[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1).replace(/\+/g, ' '));
  }
  return o;
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* ---------- pages ---------- */
function meChip(me) { return me ? '<a class="me" href="/account">' + esc(me) + '</a>' : ''; }
function layout(title, inner, refresh, nav, active, me) {
  me = me || '';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + (refresh ? '<meta http-equiv="refresh" content="' + refresh + '">' : '')
    + '<link href="https://fonts.cdnfonts.com/css/gg-sans-2" rel="stylesheet">'
    + '<link rel="icon" type="image/png" href="https://kairox.fun/favicon-96x96.png">'
    + '<title>' + esc(title) + ' | Kairox admin</title><link rel="stylesheet" href="/style.css?v=26"></head>'
    + (nav ? '<body class="panel"><div class="shell"><aside class="side"><div class="brand"><img src="https://kairox.fun/icon-noback.png" alt="Kairox"><span>Kairox<small>admin panel</small></span></div><nav>'
    + '<a href="/inbox"' + (active === 'inbox' ? ' class="on"' : '') + '><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v7H2v-7z"/></svg>inbox</a>'
    + '<a href="/console"' + (active === 'console' ? ' class="on"' : '') + '><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></svg>console</a>'
    + '<a href="/whitelist"' + (active === 'whitelist' ? ' class="on"' : '') + '><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>whitelist</a>'
    + '<a href="/ops"' + (active === 'ops' ? ' class="on"' : '') + '><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/></svg>ops</a>'
    + '<a href="/banner"' + (active === 'banner' ? ' class="on"' : '') + '><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-7-7 18-2.5-7.5z"/></svg>banner</a>'
    + '<a href="/incidents"' + (active === 'incidents' ? ' class="on"' : '') + '><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>incidents</a>'
    + '</nav>' + meChip(me) + '<a class="logout" href="/logout"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>logout</a></aside><main class="main"><div class="content">' + inner + '</div></main></div></body></html>'
      : '<body class="login">' + inner + '</body></html>');
}
function loginPage(err) {
  return layout('Login', '<div class="loginbox"><img class="llogo" src="https://kairox.fun/icon-noback.png" alt="Kairox">'
    + '<h1>Kairox admin</h1>'
    + (err ? '<p class="err">' + esc(err) + '</p>' : '')
    + '<form method="POST" action="/login">'
    + '<input name="user" autocomplete="username" placeholder="user" required>'
    + '<input name="pass" type="password" autocomplete="current-password" placeholder="password" required>'
    + '<button>Login</button></form></div>');
}
function inboxPage(apps, wl, csrf, me) {
  const row = (a) => {
    const st = a.status === 'new' ? (a.seen ? '' : '<span class="badge new">new</span>') : (a.status === 'approved' ? '<span class="badge ok">approved</span>' : '<span class="badge no">rejected</span>');
    const dt = esc(new Date(a.time).toLocaleString());
    const sub = esc(a.subject || 'no subject');
    const snip = esc(String(a.text || '').slice(0, 90));
    return '<div class="mail' + (a.status === 'new' ? ' unread' : '') + '"><a class="mail-main" href="/app/' + a.id + '">'
      + '<span class="mail-top"><span class="mail-from">' + esc(a.from) + '</span><span class="mail-time">' + dt + '</span></span>'
      + '<span class="mail-sub">' + sub + '</span>'
      + '<span class="mail-snip">' + snip + '</span></a>'
      + '<div class="mail-side">' + st
      + '<form method="POST" action="/app/' + a.id + '/delete" onsubmit="return confirm(\'Delete this mail?\')">'
      + '<input type="hidden" name="csrf" value="' + csrf + '"><button class="danger small">delete</button></form></div></div>';
  };
  const rev = apps.slice().reverse();
  const gNew = rev.filter((a) => a.status === 'new');
  const gAppr = rev.filter((a) => a.status === 'approved');
  const gRej = rev.filter((a) => a.status !== 'new' && a.status !== 'approved');
  const sec = (title, list) => list.length ? '<h2 class="sech">' + title + ' (' + list.length + ')</h2><div class="maillist">' + list.map(row).join('') + '</div>' : '';
  const body = (sec('applications', gNew) + sec('approved', gAppr) + sec('rejected', gRej)) || '<div class="card"><p class="dim">No applications yet.</p></div>';
  const nNew = gNew.filter((a) => !a.seen).length;
  const nDone = gAppr.length + gRej.length;
  const head = '<div class="phead"><h1>inbox</h1><span class="dim">' + nNew + ' new / ' + apps.length + ' total</span></div>'
    + (nDone > 0 ? '<div class="toolbar"><form method="POST" action="/inbox/clear" onsubmit="return confirm(\'Delete all handled mails?\')"><input type="hidden" name="csrf" value="' + csrf + '"><button class="danger small">clear handled (' + nDone + ')</button></form></div>' : '');
  return layout('Inbox', head + body, 0, true, 'inbox', me);
}
function appPage(a, csrf, me) {
  const st = a.status === 'new' ? (a.seen ? '' : '<span class="badge new">new</span>') : (a.status === 'approved' ? '<span class="badge ok">approved</span>' : '<span class="badge no">rejected</span>');
  const head = '<p><a class="back" href="/inbox">&larr; inbox</a></p><div class="phead"><h1>application</h1>' + st + '</div>'
    + '<div class="card mailhead"><dl><dt>from</dt><dd>' + esc(a.from) + '</dd><dt>subject</dt><dd>' + esc(a.subject || '-') + '</dd>'
    + '<dt>received</dt><dd>' + esc(new Date(a.time).toLocaleString()) + '</dd><dt>status</dt><dd>' + esc(a.status) + '</dd></dl></div>'
    + '<div class="card"><div class="dim" style="margin-bottom:8px">message</div><pre>' + esc(a.text) + '</pre></div>';
  if (a.status !== 'new') return layout('Application', head
    + '<div class="card"><form method="POST" action="/app/' + a.id + '/delete" onsubmit="return confirm(\'Delete this mail?\')">'
    + '<input type="hidden" name="csrf" value="' + csrf + '">'
    + '<button class="danger">Delete mail</button></form></div>', 0, true, 'inbox', me);
  return layout('Application', head
    + '<div class="card"><h2>approve</h2><form method="POST" action="/app/' + a.id + '/approve">'
    + '<input type="hidden" name="csrf" value="' + csrf + '">'
    + '<label>minecraft name<input name="nick" maxlength="16" required></label>'
    + '<p class="dim">Tip: double-check spelling (e.g. namemc.com) - names are case-sensitive.</p>'
    + '<button>Approve + whitelist</button></form></div>'
    + '<div class="card"><h2>reject</h2><form method="POST" action="/app/' + a.id + '/deny">'
    + '<input type="hidden" name="csrf" value="' + csrf + '">'
    + '<button class="danger">Reject</button></form></div>'
    + '<div class="card"><h2>delete mail</h2><p class="dim">Removes this mail from inbox without sending anything.</p><form method="POST" action="/app/' + a.id + '/delete" onsubmit="return confirm(\'Delete this mail?\')">'
    + '<input type="hidden" name="csrf" value="' + csrf + '">'
    + '<button class="danger">Delete this mail</button></form></div>', 0, true, 'inbox', me);
}
function donePage(title, msg, me) {
  return layout(title, '<div class="phead"><h1>' + esc(title) + '</h1></div><div class="card"><p>' + esc(msg) + '</p><p><a class="back" href="/inbox">&larr; inbox</a></p></div>', 0, true, 'inbox', me);
}
function wlPage(wl, csrf, me) {
  const rows = wl.map((e) => '<form class="wlrow" method="POST" action="/whitelist/remove" onsubmit="return confirm(\'Remove ' + esc(e.name) + ' from whitelist?\')">'
    + '<input type="hidden" name="csrf" value="' + csrf + '"><input type="hidden" name="nick" value="' + esc(e.name) + '">'
    + '<img src="https://minotar.net/helm/' + esc(e.name) + '/32.png" alt="" width="28" height="28">'
    + '<span class="wlname">' + esc(e.name) + '</span><button class="danger small">remove</button></form>').join('') || '<div class="card"><p class="dim">Empty.</p></div>';
  return layout('Whitelist', '<div class="phead"><h1>whitelist</h1><span class="dim">' + wl.length + ' players</span></div><div class="card addcard">'
    + '<h2>add player</h2><p class="dim">Type a Minecraft name and press Enter. Java + Bedrock lists update together.</p>'
    + '<form class="addrow" method="POST" action="/whitelist/add">'
    + '<input type="hidden" name="csrf" value="' + csrf + '">'
    + '<input name="nick" maxlength="16" required autocomplete="off" placeholder="e.g. Notch" autofocus>'
    + '<button>Add</button></form></div><div style="height:12px"></div>' + rows, 0, true, 'whitelist', me);
}
async function lpOwnerMembers() {
  const t = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const t0 = pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());
  try { await mcSend('lp group owner listmembers'); } catch { return []; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 10; i++) {
    await sleep(600);
    try {
      const txt = fs.readFileSync('/home/nenquen/kairox/logs/latest.log', 'utf8');
      const names = [];
      let marker = false;
      for (const line of txt.split('\n')) {
        const mm = line.match(/^\[(\d{2}:\d{2}:\d{2})\].*Showing user entries:.*\(page \d+ of \d+ - (\d+) entries\)/);
        if (mm && mm[1] >= t0) marker = true;
        const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\] \[luckperms-command-executor\/INFO\]: > ([A-Za-z0-9_]{3,16})\s*$/);
        if (m && m[1] >= t0 && names.indexOf(m[2]) < 0) names.push(m[2]);
      }
      if (marker && (names.length || i >= 4)) return names;
      if (i >= 9) return names;
    } catch {}
  }
  return [];
}
function opsPage(list, csrf, running, me) {
  const rows = list.map((name) => '<form class="wlrow" method="POST" action="/ops/remove" onsubmit="return confirm(\'Deop ' + esc(name) + '?\')">'
    + '<input type="hidden" name="csrf" value="' + csrf + '"><input type="hidden" name="nick" value="' + esc(name) + '">'
    + '<img src="https://minotar.net/helm/' + esc(name) + '/32.png" alt="" width="28" height="28">'
    + '<span class="wlname">' + esc(name) + '</span><span class="badge ok">owner</span><button class="danger small">deop</button></form>').join('')
    || '<div class="card"><p class="dim">No ops yet.</p></div>';
  const warn = running ? '' : '<div class="card"><p class="dim">Server is stopped - op changes need a running server.</p></div>';
  return layout('Ops', '<div class="phead"><h1>ops</h1><span class="dim">' + list.length + ' players</span></div>'
    + '<p class="dim">LuckPerms <b>owner</b> group (vanilla OP is disabled).</p>' + warn
    + '<div class="card addcard"><h2>add op</h2><p class="dim">Server default op level applies.</p>'
    + '<form class="addrow" method="POST" action="/ops/add">'
    + '<input type="hidden" name="csrf" value="' + csrf + '">'
    + '<input name="nick" maxlength="16" required autocomplete="off" placeholder="e.g. Notch" autofocus>'
    + '<button>Op</button></form></div><div style="height:12px"></div>' + rows, 0, true, 'ops', me);
}
const BANNER_PATH = '/var/www/shared/banner.json';
function bannerPage(b, csrf, me) {
  const t = b.type === 'warn' ? 'warn' : 'info';
  return layout('Banner', '<div class="phead"><h1>banner</h1>' + (b.enabled ? '<span class="badge ok">live</span>' : '<span class="badge no">off</span>') + '</div>'
    + '<div class="card addcard"><h2>announcement strip</h2><p class="dim">Shows on kairox.fun, application and status pages.</p>'
    + '<form method="POST" action="/banner/save"><input type="hidden" name="csrf" value="' + csrf + '">'
    + '<label>message<input name="text" maxlength="140" autocomplete="off" placeholder="e.g. Maintenance tonight at 21:00" value="' + esc(b.text || '') + '"></label>'
    + '<label>link text (optional)<input name="linkText" maxlength="30" autocomplete="off" placeholder="e.g. Details" value="' + esc(b.linkText || '') + '"></label>'
    + '<label>link url (optional)<input name="linkUrl" maxlength="200" autocomplete="off" placeholder="https://..." value="' + esc(b.linkUrl || '') + '"></label>'
    + '<label>style<select name="type"><option value="info"' + (t === 'info' ? ' selected' : '') + '>info (purple)</option><option value="warn"' + (t === 'warn' ? ' selected' : '') + '>warning (yellow)</option></select></label>'
    + '<div class="btnrow"><button name="enabled" value="1">Save + show</button> '
    + '<button class="danger" name="enabled" value="0">Hide</button></div></form></div>', 0, true, 'banner', me);
}
const NOTES_PATH = '/opt/mcstatus/notes.json';
const API_PATH = '/var/www/status.kairox.fun/api.json';
function incidentsPage(incs, csrf, me) {
  const rows = incs.map((x) => {
    const dt = esc(new Date(x.start).toLocaleString());
    return '<div class="tl"><div class="tldot"></div><div class="tlbody"><div class="tlhead"><b>' + esc(x.title) + '</b>'
      + '<span class="badge no">' + x.mins + ' min</span></div>'
      + '<div class="dim">' + dt + '</div>'
      + (x.note ? '<div class="note"><div><div class="note-head">' + esc(x.by || 'staff') + '</div><div class="note-body">' + esc(x.note) + '</div></div></div>' : '')
      + '<form method="POST" action="/incidents/note"><input type="hidden" name="csrf" value="' + csrf + '">'
      + '<input type="hidden" name="start" value="' + x.start + '">'
      + '<div class="addrow"><input name="text" maxlength="300" autocomplete="off" placeholder="Add a public note..." value="' + esc(x.note || '') + '"><button>Save</button></div></form></div></div>';
  }).join('') || '<div class="card"><p class="dim">No incidents in the last 90 days.</p></div>';
  return layout('Incidents', '<div class="phead"><h1>incidents</h1><span class="dim">' + incs.length + ' in 90 days</span></div><div class="tlwrap">' + rows + '</div>', 0, true, 'incidents', me);
}
function accountPage(me, csrf, info) {
  const li = info.last ? esc(new Date(info.last).toLocaleString()) + ' (' + esc(info.ip || '') + ')' : '-';
  return layout('Account', '<div class="profile">'
    + '<div><h1>' + esc(me) + '</h1><span class="dim">' + (info.count || 0) + ' logins</span></div></div>'
    + '<div class="card"><div class="prow"><span>created</span><b>' + esc(info.created ? new Date(info.created).toLocaleString() : '-') + '</b></div>'
    + '<div class="prow"><span>last login</span><b>' + li + '</b></div></div>'
    + '<div class="card"><h2>password</h2>'
    + '<form method="POST" action="/account/password"><input type="hidden" name="csrf" value="' + csrf + '">'
    + '<label>current<input name="cur" type="password" autocomplete="current-password" required></label>'
    + '<label>new (min 8)<input name="nw" type="password" autocomplete="new-password" required></label>'
    + '<label>repeat new<input name="nw2" type="password" autocomplete="new-password" required></label>'
    + '<button>Save</button></div></form></div>', 0, true, 'account', me);
}
function consolePage(log, csrf, running, me) {
  const dot = running ? '<span class="badge ok">running</span>' : '<span class="badge no">stopped</span>';
  return layout('Console',
    '<div class="phead"><h1>console</h1>' + dot + '</div>'
    + '<div class="congrid"><div class="card"><pre class="con scrollbot">' + log + '</pre>'
    + '<form class="addrow" method="POST" action="/console/send"><input type="hidden" name="csrf" value="' + csrf + '">'
    + '<input name="cmd" maxlength="200" required autocomplete="off" placeholder="type a command, Enter to send"><button>Send</button></form>'
    + '</div>'
    + '<div class="conside"><div class="card"><h2>server</h2><div class="pwr">'
    + '<form method="POST" action="/console/power"><input type="hidden" name="csrf" value="' + csrf + '"><input type="hidden" name="action" value="start"><button>Start</button></form>'
    + '<form method="POST" action="/console/power" onsubmit="return confirm(\'Stop the server?\')"><input type="hidden" name="csrf" value="' + csrf + '"><input type="hidden" name="action" value="stop"><button class="danger">Stop</button></form>'
    + '<form method="POST" action="/console/power" onsubmit="return confirm(\'Restart the server?\')"><input type="hidden" name="csrf" value="' + csrf + '"><input type="hidden" name="action" value="restart"><button class="danger">Restart</button></form>'
    + '</div></div>'
    + '</div></div>'
    + '<script src="/console.js?v=2"></script>', 0, true, 'console', me);
}
function mcSend(cmd) {
  return new Promise((resolve, reject) => {
    execFile('tmux', ['-S', '/tmp/tmux-1000/default', 'send-keys', '-t', 'kairox', String(cmd).replace(/"/g, ''), 'Enter'], (e) => {
      if (e) reject(e);
      else resolve();
    });
  });
}
function mcLogRaw() {
  try {
    const t = fs.readFileSync('/home/nenquen/kairox/logs/latest.log', 'utf8').split('\n');
    return t.slice(-120).join('\n');
  } catch { return '(no log)'; }
}
function mcLog() {
  return esc(mcLogRaw());
}
function execOk(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, () => resolve());
  });
}
async function mcRunning() {
  try { await rconSend('list'); return true; } catch { return false; }
}
function requestStart() {
  try { fs.writeFileSync(DATA + '/start-requested', String(Date.now())); } catch {}
}
async function mcStart() {
  if (await mcRunning()) return 'already running';
  requestStart();
  return 'start requested... check back in a minute';
}
async function mcStop() {
  if (!await mcRunning()) return 'already stopped';
  await mcSend('stop');
  return 'stopping...';
}
async function mcRestart() {
  if (!await mcRunning()) return await mcStart();
  await mcSend('stop');
  requestStart();
  return 'restarting... check back in a minute';
}

/* ---------- apps store ---------- */
function loadApps() { const a = readJSON(APPS_FILE, []); return Array.isArray(a) ? a : []; }
function saveApps(a) { writeJSON(APPS_FILE, a); }

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const ip = clientIp(req);

    if (req.method === 'GET' && url.pathname === '/style.css') {
      try { send(res, 200, 'text/css', fs.readFileSync(DIR + '/public/style.css', 'utf8')); }
      catch { send(res, 404, 'text/plain', 'nope'); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/console.js') {
      try { send(res, 200, 'text/javascript', fs.readFileSync(DIR + '/public/console.js', 'utf8')); }
      catch { send(res, 404, 'text/plain', 'nope'); }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/incoming') {
      const secret = fs.existsSync(DATA + '/hook.secret') ? fs.readFileSync(DATA + '/hook.secret', 'utf8').trim() : '';
      const got = req.headers['x-hook-secret'] || '';
      if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
        send(res, 403, 'text/plain', 'nope');
        return;
      }
      const body = JSON.parse(await readBody(req, 100000));
      const apps = loadApps();
      const id = crypto.randomBytes(8).toString('hex');
      apps.push({
        id, time: Date.now(), status: 'new',
        from: String(body.from || '').slice(0, 200),
        subject: String(body.subject || '').slice(0, 200),
        text: String(body.text || '').slice(0, 8000),
      });
      saveApps(apps);
      audit('mailhook', 'incoming', body.from);
      send(res, 200, 'application/json', '{}');
      return;
    }

    const sess = getSession(req);
    if (req.method === 'GET' && url.pathname === '/login') {
      if (sess) { redirect(res, '/inbox'); return; }
      send(res, 200, 'text/html', loginPage(''));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/login') {
      if (blocked(ip)) { send(res, 429, 'text/html', loginPage('Too many tries. Wait 15 minutes.')); return; }
      const f = parseForm(await readBody(req, 12000000));
      const auth = readJSON(AUTH_FILE, null);
      const users = auth && Array.isArray(auth.users) ? auth.users : (auth && auth.user ? [auth] : []);
      let who = null;
      if (typeof f.user === 'string' && typeof f.pass === 'string') {
        const u = users.find((x) => x && x.user === f.user);
        if (u && u.salt && u.hash) {
          const h = crypto.scryptSync(f.pass, Buffer.from(u.salt, 'hex'), 64).toString('hex');
          if (h.length === u.hash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash))) who = u.user;
        }
      }
      if (!who) { noteFail(ip); audit(ip, 'login-fail', f.user); send(res, 200, 'text/html', loginPage('Wrong credentials.')); return; }
      fails.delete(ip);
      const ex = getSession(req);
      if (ex && ex.user === who) {
        redirect(res, '/inbox');
        return;
      }
      const now = Date.now();
      if (now - lastLoginAt < 3000) {
        redirect(res, '/inbox');
        return;
      }
      lastLoginAt = now;
      const prevCsrf = parseCookies(req)['csrf'];
      const s = newSession(who, ip, prevCsrf);
      audit(who, 'login', ip);
      try {
        const li = readJSON(DATA + '/logins.json', {});
        const e = li[who] || { count: 0 };
        e.count = (e.count || 0) + 1; e.last = Date.now(); e.ip = ip;
        li[who] = e; writeJSON(DATA + '/logins.json', li);
      } catch {}
      secHeaders(res);
      res.writeHead(302, {
        Location: '/inbox',
        'Set-Cookie': [
          'sid=' + s.sid + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200',
          'csrf=' + s.csrf + '; Path=/; Secure; SameSite=Strict; Max-Age=31536000',
        ],
      });
      res.end();
      return;
    }
    if (!sess) { redirect(res, '/login'); return; }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/inbox')) {
      send(res, 200, 'text/html', inboxPage(loadApps(), readJSON(WL_PATH, []), sess.csrf, sess.user));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/logout') {
      sessions.delete(sess.sid);
      saveSessions();
      audit(sess.user, 'logout', '');
      redirect(res, '/login');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/ops') {
      send(res, 200, 'text/html', opsPage(await lpOwnerMembers(), sess.csrf, await mcRunning(), sess.user));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/banner') {
      send(res, 200, 'text/html', bannerPage(readJSON(BANNER_PATH, {}), sess.csrf, sess.user));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/incidents') {
      const api = readJSON(API_PATH, {});
      send(res, 200, 'text/html', incidentsPage(Array.isArray(api.incidents) ? api.incidents : [], sess.csrf, sess.user));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/account') {
      const auth = readJSON(AUTH_FILE, { users: [] });
      const u = (auth.users || []).find((x) => x && x.user === sess.user) || {};
      const li = readJSON(DATA + '/logins.json', {})[sess.user] || {};
      send(res, 200, 'text/html', accountPage(sess.user, sess.csrf, { created: u.createdAt, last: li.last, ip: li.ip, count: li.count }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/whitelist') {
      send(res, 200, 'text/html', wlPage(readJSON(WL_PATH, []), sess.csrf, sess.user));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/console') {
      send(res, 200, 'text/html', consolePage(mcLog(), sess.csrf, await mcRunning(), sess.user));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/logtail') {
      send(res, 200, 'text/plain', mcLogRaw());
      return;
    }
    const mApp = url.pathname.match(/^\/app\/([0-9a-f]{16})$/);
    if (req.method === 'GET' && mApp) {
      const apps = loadApps();
      const a = apps.find((x) => x.id === mApp[1]);
      if (!a) { send(res, 404, 'text/plain', 'nope'); return; }
      if (a.status === 'new' && !a.seen) { a.seen = true; saveApps(apps); }
      send(res, 200, 'text/html', appPage(a, sess.csrf, sess.user));
      return;
    }
    if (req.method === 'POST') {
      const f = parseForm(await readBody(req, 12000000));
      const origin = req.headers.origin || '';
      const host = (req.headers.host || '').split(':')[0].toLowerCase();
      let originOk = true;
      if (origin && origin !== 'null') {
        try {
          const oh = new URL(origin).hostname.toLowerCase();
          originOk = oh === host || oh === 'admin.kairox.fun';
        } catch { originOk = false; }
      }
      if (f.csrf !== sess.csrf || !originOk) {
        audit(sess.user, 'csrf-fail', url.pathname);
        send(res, 200, 'text/html', donePage('Stale page', 'This tab is outdated. Go back to inbox, refresh, and try again.', sess.user));
        return;
      }
      if (url.pathname === '/inbox/clear') {
        const apps = loadApps();
        const kept = apps.filter((x) => x.status === 'new');
        const n = apps.length - kept.length;
        saveApps(kept);
        audit(sess.user, 'clear-inbox', String(n));
        redirect(res, '/inbox');
        return;
      }
      const mAp = url.pathname.match(/^\/app\/([0-9a-f]{16})\/(approve|deny|delete)$/);
      if (mAp) {
        const apps = loadApps();
        const idx = apps.findIndex((x) => x.id === mAp[1]);
        const a = apps[idx];
        if (!a) { send(res, 200, 'text/html', donePage('Done', 'Mail not found.', sess.user)); return; }
        if (mAp[2] === 'delete') {
          apps.splice(idx, 1);
          saveApps(apps);
          audit(sess.user, 'delete-mail', a.from);
          send(res, 200, 'text/html', donePage('Deleted', 'Mail deleted.', sess.user));
          return;
        }
        if (a.status !== 'new') { send(res, 200, 'text/html', donePage('Done', 'Already handled.', sess.user)); return; }
        if (mAp[2] === 'deny') {
          a.status = 'rejected';
          saveApps(apps);
          audit(sess.user, 'deny', a.from);
          const info = await notifyApplicant(a, 'rejected', null);
          const suffix = info.indexOf('mail sent') === 0 ? ' ' + info : '';
          send(res, 200, 'text/html', donePage('Rejected', 'Application rejected.' + suffix + ' You can delete the mail from inbox.', sess.user));
          return;
        }
        const nick = cleanNick(f.nick);
        if (!nick) {
          send(res, 200, 'text/html', donePage('Error', 'Bad nick.', sess.user));
          return;
        }
        try {
          const msg = await mcAdd(nick);
          a.status = 'approved';
          a.nick = nick;
          saveApps(apps);
          audit(sess.user, 'approve', nick);
          const info = await notifyApplicant(a, 'approved', nick);
          const suffix = info.indexOf('mail sent') === 0 ? ' ' + info : '';
          send(res, 200, 'text/html', donePage(nick + ' added to whitelist', msg + '.' + suffix, sess.user));
        } catch (e) {
          send(res, 200, 'text/html', donePage('Error', 'Whitelist failed. Check MC/RCON.', sess.user));
        }
        return;
      }
      if (url.pathname === '/console/send') {
        const cmd = String(f.cmd || '').trim().slice(0, 200);
        if (!cmd || !/^[A-Za-z0-9_ :\/.\-+,#@]+$/.test(cmd)) {
          send(res, 200, 'text/html', donePage('Error', 'Bad command.', sess.user));
          return;
        }
        try { await mcSend(cmd); audit(sess.user, 'cmd', cmd); } catch {}
        redirect(res, '/console');
        return;
      }
      if (url.pathname === '/console/power') {
        const act = String(f.action || '');
        let msg = '';
        try {
          if (act === 'start') msg = await mcStart();
          else if (act === 'stop') msg = await mcStop();
          else if (act === 'restart') msg = await mcRestart();
          else { send(res, 200, 'text/html', donePage('Error', 'Bad action.', sess.user)); return; }
          audit(sess.user, 'power-' + act, msg);
        } catch {}
        send(res, 200, 'text/html', donePage('Server', msg || 'done. Check back in a minute.', sess.user));
        return;
      }
      if (url.pathname === '/ops/add' || url.pathname === '/ops/remove') {
        const nick = cleanNick(f.nick);
        if (!nick) { send(res, 200, 'text/html', donePage('Error', 'Bad nick.', sess.user)); return; }
        const lp = url.pathname === '/ops/add' ? 'parent add owner' : 'parent remove owner';
        try {
          const out = await rconSend('lp user ' + nick + ' ' + lp);
          audit(sess.user, 'lp-' + (url.pathname === '/ops/add' ? 'op' : 'deop'), nick);
          send(res, 200, 'text/html', donePage(url.pathname === '/ops/add' ? 'Op added' : 'Deopped', nick + ' updated.', sess.user));
        } catch {
          send(res, 200, 'text/html', donePage('Error', 'Server RCON failed. Is the server running?', sess.user));
        }
        return;
      }
      if (url.pathname === '/banner/save') {
        const b = {
          enabled: String(f.enabled || '') === '1',
          text: String(f.text || '').slice(0, 140),
          linkText: String(f.linkText || '').slice(0, 30),
          linkUrl: String(f.linkUrl || '').slice(0, 200),
          type: String(f.type || '') === 'warn' ? 'warn' : 'info',
        };
        if (b.linkUrl && !/^https?:\/\//.test(b.linkUrl)) b.linkUrl = '';
        writeJSON(BANNER_PATH, b);
        audit(sess.user, 'banner', b.enabled ? b.text.slice(0, 60) : 'off');
        redirect(res, '/banner');
        return;
      }
      if (url.pathname === '/incidents/note') {
        const start = parseInt(String(f.start || ''), 10);
        const text = String(f.text || '').slice(0, 300);
        if (start) {
          const notes = readJSON(NOTES_PATH, []);
          const arr = Array.isArray(notes) ? notes.filter((e) => e && e.start !== start) : [];
          if (text.trim()) arr.push({ start: start, text: text.trim(), by: sess.user });
          writeJSON(NOTES_PATH, arr);
          audit(sess.user, 'incident-note', String(start));
        }
        redirect(res, '/incidents');
        return;
      }
      if (url.pathname === '/account/password') {
        const auth = readJSON(AUTH_FILE, { users: [] });
        const u = (auth.users || []).find((x) => x && x.user === sess.user);
        const cur = String(f.cur || ''), nw = String(f.nw || ''), nw2 = String(f.nw2 || '');
        let err = '';
        if (!u) err = 'Account not found.';
        else {
          const h = crypto.scryptSync(cur, Buffer.from(u.salt, 'hex'), 64).toString('hex');
          if (h.length !== u.hash.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash))) err = 'Current password is wrong.';
          else if (nw.length < 8) err = 'New password too short (min 8).';
          else if (nw !== nw2) err = 'New passwords do not match.';
        }
        if (err) { send(res, 200, 'text/html', donePage('Error', err, sess.user)); return; }
        u.salt = crypto.randomBytes(16).toString('hex');
        u.hash = crypto.scryptSync(nw, Buffer.from(u.salt, 'hex'), 64).toString('hex');
        writeJSON(AUTH_FILE, auth);
        audit(sess.user, 'passwd', 'changed');
        send(res, 200, 'text/html', donePage('Done', 'Password changed.', sess.user));
        return;
      }
      if (url.pathname === '/whitelist/remove') {
        const nick = cleanNick(f.nick);
        if (nick) {
          const list = readJSON(WL_PATH, []).filter((e) => String(e.name).toLowerCase() !== nick.toLowerCase());
          writeJSON(WL_PATH, list);
          try { await rconSend('fwhitelist remove ' + nick); } catch {}
          try { await rconSend('whitelist reload'); } catch {}
          audit(sess.user, 'remove', nick);
        }
        redirect(res, '/whitelist');
        return;
      }
      if (url.pathname === '/whitelist/add') {
        const nick = cleanNick(f.nick);
        if (nick) {
          try {
            await mcAdd(nick);
            audit(sess.user, 'approve-panel', nick);
          } catch {}
        }
        redirect(res, '/whitelist');
        return;
      }
    }
    send(res, 404, 'text/plain', 'nope');
  } catch (e) {
    try { send(res, 500, 'text/plain', 'error'); } catch {}
  }
});

server.listen(PORT, '127.0.0.1', () => console.log('admin on 127.0.0.1:' + PORT));

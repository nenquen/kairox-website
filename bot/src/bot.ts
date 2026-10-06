import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events, GatewayIntentBits, GuildMember, Message, ModalBuilder, PermissionFlagsBits, ActivityType, REST, Routes, SlashCommandBuilder, TextChannel, TextInputBuilder, TextInputStyle } from 'discord.js';
import { execFile } from 'node:child_process';
import { Rcon } from 'rcon-client';
const TOKEN: string = readFileSync('/opt/kairox-bot/token', 'utf8').trim();
const RCON_PASS: string = readFileSync('/opt/kairox-bot/rcon.pass', 'utf8').trim();
const USED_PATH = '/opt/kairox-bot/used.json';
const WL_PATH = '/home/nenquen/kairox/whitelist.json';
const GUILD_ID = '1553585585481056267';
const OWNER_ID = '1496759787822645320';
const APPROVED_ID = '1553588364379291668';
const MEDIA_ID = '1553587598008651876';
const VOICE_COUNT_ID = "1554113900088393819";
const STATUS_CH_ID = "1554128131806466089";
const STATUS_FILE = "/opt/kairox-bot/status_msg.json";
const WELCOME_ID = '1553587590865879041';
const MC_CHAT_ID = '1556109446483279902';
const MC_LOG = '/home/nenquen/kairox/logs/latest.log';
const BRIDGE_TAG = '[DC]';
const RULES_ID = '1553587592363118622';
const LINK_RE = /https?:\/\/\S+/i;
const C_OK = 0x57F287;
const C_ERR = 0xE74C3C;
const C_INFO = 0xB388FF;
const C_ACT = 0xE67E22;
let usedIds = new Set<string>();
try { usedIds = new Set(JSON.parse(readFileSync(USED_PATH, 'utf8')) as string[]); } catch { usedIds = new Set<string>(); }
function saveUsed(): void {
  try { writeFileSync(USED_PATH, JSON.stringify(Array.from(usedIds))); } catch (e) { console.error('save-used-err', e); }
}
function okBox(title: string, desc?: string): EmbedBuilder {
  const e = new EmbedBuilder().setColor(C_OK).setTitle(title);
  if (desc) e.setDescription(desc);
  return e;
}
function errBox(title: string, desc?: string): EmbedBuilder {
  const e = new EmbedBuilder().setColor(C_ERR).setTitle(title);
  if (desc) e.setDescription(desc);
  return e;
}
type WelcomeState = 'new' | 'submitted' | 'approved';
function welcomeEmbed(mention: string, mcNick?: string | null, state: WelcomeState = 'new'): EmbedBuilder {
  const mc = mcNick ? '\n**MC name:** ' + mcNick : '';
  const e = new EmbedBuilder().setColor(C_INFO).setFooter({ text: 'Kairox SMP' }).setTimestamp();
  if (state === 'approved') {
    return e.setTitle('welcome, you are approved!').setDescription(mention + ' is approved.' + mc + '\n\nJoin: `smp.kairox.fun` (Java) / port `19132` (Bedrock).');
  }
  if (state === 'submitted') {
    return e.setTitle('application received!').setDescription(mention + ' applied.' + mc + '\n\nStaff will review soon. No need to apply again.');
  }
  return e.setTitle('welcome to peace!').setDescription(mention + ' just joined Kairox.' + mc + '\n\nRead <#' + RULES_ID + '> and finish your application to get Approved and whitelisted.');
}
async function resolveWelcomeState(userId: string): Promise<{ state: WelcomeState; nick: string | null }> {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
      try {
        const m = await guild.members.fetch(userId);
        if (m && m.roles.cache.has(APPROVED_ID)) {
          const n = m.nickname ? cleanNick(m.nickname) : cleanNick(m.displayName);
          return { state: 'approved', nick: n };
        }
        const nn = m && m.nickname ? cleanNick(m.nickname) : null;
        if (nn && readWl().some((e) => e.name.toLowerCase() === nn.toLowerCase())) return { state: 'approved', nick: nn };
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try {
    const reqs = await fetchRequests();
    const sub = reqs.find((x) => x.user_id === userId && x.application_status === 'SUBMITTED');
    if (sub) return { state: 'submitted', nick: nickFromRequest(sub) };
    const appr = reqs.find((x) => x.user_id === userId && x.application_status === 'APPROVED');
    if (appr) return { state: 'approved', nick: nickFromRequest(appr) };
  } catch { /* ignore */ }
  return { state: 'new', nick: null };
}
async function mcOnline(): Promise<{ online: boolean; n: string; max: string; names: string[] }> {
  try {
    const res = await rcon('list');
    const clean = res.replace(/§./g, '');
    const m = clean.match(/There are (\d+).*?(\d+).*?:(.*)$/s);
    if (!m) {
      const m2 = clean.match(/There are (\d+).*?(\d+)/);
      return { online: true, n: m2 ? m2[1] : '?', max: m2 ? m2[2] : '?', names: [] };
    }
    const names = m[3].split(',').map((x) => x.trim()).filter((x) => x.length > 0);
    return { online: true, n: m[1], max: m[2], names: names };
  } catch {
    return { online: false, n: '0', max: '?', names: [] };
  }
}
function tmuxSend(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tmux', ['-S', '/tmp/tmux-1000/default', 'send-keys', '-t', 'kairox', cmd.replace(/"/g, ''), 'Enter'], (e) => {
      if (e) reject(e);
      else resolve();
    });
  });
}
async function rcon(cmd: string): Promise<string> {
  const r = await Rcon.connect({ host: '127.0.0.1', port: 25575, password: RCON_PASS });
  try {
    return await r.send(cmd);
  } finally {
    r.end();
  }
}
function cleanNick(name: string): string | null {
  const n = name.trim();
  if (/^[A-Za-z0-9_]{3,16}$/.test(n)) return n;
  return null;
}
function offlineUuid(name: string): string {
  const h = createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.toString('hex');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}
interface WLEntry { uuid: string; name: string; }
function readWl(): WLEntry[] {
  try {
    const j = JSON.parse(readFileSync(WL_PATH, 'utf8')) as WLEntry[];
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}
async function mcWhitelistAdd(nick: string, platform: string | null): Promise<string> {
  const out: string[] = [];
  const plat = (platform || "").toLowerCase();
  const cur = readWl();
  if (!cur.some((e) => e.name.toLowerCase() === nick.toLowerCase())) {
    cur.push({ uuid: offlineUuid(nick), name: nick });
    writeFileSync(WL_PATH, JSON.stringify(cur, null, 2));
    try { await rcon("whitelist reload"); } catch { out.push("reload failed"); }
    out.push("java list");
  } else {
    out.push("already listed");
  }
  if (!plat.startsWith("java")) {
    try { out.push(await rcon("fwhitelist add " + nick)); } catch { if (plat.startsWith("bedrock")) out.push("fw failed"); }
  }
  try { await tmuxSend("lp user " + offlineUuid(nick) + " parent add player"); out.push("rank:player"); } catch { out.push("rank failed"); }
  return "added " + nick + " (" + out.join(", ") + ")";
}
async function mcWhitelistRemove(nick: string): Promise<string> {
  const out: string[] = [];
  try {
    const list = readWl().filter((e) => e.name.toLowerCase() !== nick.toLowerCase());
    writeFileSync(WL_PATH, JSON.stringify(list, null, 2) + '\n');
    out.push('java list updated');
  } catch { out.push('java list failed'); }
  try { out.push(await rcon('fwhitelist remove ' + nick)); } catch { out.push('fw skip'); }
  try { await rcon('whitelist reload'); } catch { out.push('reload failed'); }
  return out.join(' | ');
}
interface FormResponse { field_type: string; label: string; response: unknown; choices?: string[]; }
interface JoinRequest { id: string; user_id: string; application_status: string; form_responses: FormResponse[]; }
function nickFromRequest(req: JoinRequest): string | null {
  const fields = req.form_responses || [];
  let f = fields.find((x) => /user.?name|in.?game|minecraft.?name|mc.?name/i.test(String(x.label || '')));
  if (!f) f = fields.find((x) => x.field_type === 'TEXT_INPUT');
  if (!f || typeof f.response !== 'string') return null;
  return cleanNick(f.response);
}
function platformFromRequest(req: JoinRequest): string | null {
  const fields = req.form_responses || [];
  const f = fields.find((x) => /java|bedrock|platform/i.test(String(x.label || '')));
  if (!f) return null;
  if (typeof f.response === 'number' && Array.isArray(f.choices) && typeof f.choices[f.response] === 'string') {
    return f.choices[f.response] as string;
  }
  if (typeof f.response === 'string') return f.response;
  return null;
}
async function fetchRequests(): Promise<JoinRequest[]> {
  const r = await fetch('https://discord.com/api/v10/guilds/' + GUILD_ID + '/requests', {
    headers: { Authorization: 'Bot ' + TOKEN },
  });
  if (!r.ok) return [];
  const j = await r.json() as { guild_join_requests: JoinRequest[] };
  return j.guild_join_requests || [];
}
async function handleApproval(userId: string, req: JoinRequest | null): Promise<void> {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    let member = null;
    try { member = await guild.members.fetch(userId); } catch { return; }
    const role = guild.roles.cache.get(APPROVED_ID);
    if (role && !member.roles.cache.has(APPROVED_ID)) {
      await member.roles.add(role, 'application accepted');
      console.log('approved ' + member.user.tag);
    }
    let nick: string | null = null;
    let platform: string | null = null;
    if (req) { nick = nickFromRequest(req); platform = platformFromRequest(req); }
    if (!nick) {
      const found = (await fetchRequests()).find((x) => x.user_id === userId);
      if (found) { nick = nickFromRequest(found); platform = platformFromRequest(found); }
    }
    if (!nick) nick = cleanNick(member.displayName);
    if (nick) {
      try {
        const res = await mcWhitelistAdd(nick, platform);
        console.log('whitelisted ' + nick + ': ' + res);
      } catch (e) { console.error('rcon-err', e); }
      try {
        welcomedState.delete(userId);
        const existing = await findWelcome(userId);
        if (existing) {
          await existing.edit({ embeds: [welcomeEmbed('<@' + userId + '>', nick, 'approved')] });
        } else {
          const ch = await guild.channels.fetch(WELCOME_ID);
          if (ch && ch.isTextBased()) {
            await (ch as TextChannel).send({ embeds: [welcomeEmbed('<@' + userId + '>', nick, 'approved')] });
          }
        }
        welcomedState.set(userId, 'approved');
      } catch (e) { console.error('welcome-approved-err', e); }
      try {
        if (member.nickname !== nick) await member.setNickname(nick, 'mc name sync');
      } catch (e) { console.error('nick-err', e); }
    } else {
      console.log('skip whitelist for ' + member.user.tag);
    }
  } catch (e) {
    console.error('approve-err', e);
  }
}
let lastCount: string | null = null;
async function updateStatusMsg(): Promise<void> {
  try {
    let online = false;
    let players = 0;
    let max = 20;
    try {
      const res = await rcon("list");
      const clean = res.replace(/§./g, "");
    const m = clean.match(/There are ([0-9]+) out of maximum ([0-9]+)/);
      if (m) { online = true; players = parseInt(m[1]); max = parseInt(m[2]); }
    } catch { online = false; }
    const emb = online
      ? new EmbedBuilder().setColor(3407718).setTitle("🟢 Kairox SMP is online").setDescription("**" + players + "/" + max + "** playing")
      : new EmbedBuilder().setColor(15158332).setTitle("🔴 Kairox SMP is offline").setDescription("The server is currently down. Check back soon.");
    emb.setTimestamp();
    let mid = null;
    try { mid = JSON.parse(readFileSync(STATUS_FILE, "utf8")).id; } catch { mid = null; }
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    const ch = await guild.channels.fetch(STATUS_CH_ID);
    if (!ch || !ch.isTextBased()) return;
    const tch = ch as TextChannel;
    if (mid) {
      try { await tch.messages.edit(mid, { embeds: [emb] }); return; } catch { mid = null; }
    }
    const sent = await tch.send({ embeds: [emb] });
    writeFileSync(STATUS_FILE, JSON.stringify({ id: sent.id }));
  } catch (e) { console.error("status-msg-err", e); }
}
async function updateVoiceCount(): Promise<void> {
  try {
    const res = await rcon("list");
    const m = res.replace(/§./g, "").match(/There are (\d+) out of maximum/);
    const n = m ? m[1] : "0";
    try { await client.user?.setActivity("👥 " + n + " online", { type: ActivityType.Watching }); } catch {
    }
    if (n === lastCount) return;
    lastCount = n;
    const pr = await fetch("https://discord.com/api/v10/channels/" + VOICE_COUNT_ID, { method: "PATCH", headers: { Authorization: "Bot " + TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ name: "👥 " + n + " online" }) });
    if (!pr.ok) { console.error("voice-patch", pr.status); lastCount = null; } else { console.log("voice updated", n); }
  } catch (e) {
    console.error("voice-count-err", e);
    if (lastCount !== "offline") {
      lastCount = "offline";
      try {
        await fetch("https://discord.com/api/v10/channels/" + VOICE_COUNT_ID, { method: "PATCH", headers: { Authorization: "Bot " + TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ name: "🔴 Offline" }) });
      } catch {
      }
    }
  }
}
async function reconcileApproved(): Promise<void> {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    const members = await guild.members.fetch();
    for (const m of members.values()) {
      if (m.user.bot) continue;
      if (!m.roles.cache.has(APPROVED_ID)) continue;
      const nick = m.nickname ? cleanNick(m.nickname) : null;
      if (!nick) { console.log('needs nick: ' + m.user.tag); continue; }
      try {
        const res = await mcWhitelistAdd(nick, null);
        console.log('reconcile whitelisted ' + nick + ': ' + res);
      } catch (e) { console.error('reconcile rcon-err', e); }
    }
  } catch (e) {
    console.error('reconcile-err', e);
  }
}
const seenApproved = new Set<string>();
const welcomedState = new Map<string, WelcomeState>();
async function findWelcome(userId: string): Promise<Message | null> {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return null;
    const ch = await guild.channels.fetch(WELCOME_ID);
    if (!ch || !ch.isTextBased()) return null;
    const msgs = await (ch as TextChannel).messages.fetch({ limit: 100 });
    const mine = client.user ? client.user.id : '';
    for (const m of msgs.values()) {
      if (m.author.id !== mine) continue;
      const d = m.embeds.length > 0 ? m.embeds[0].description : null;
      if (d && d.includes('<@' + userId + '>')) return m as Message;
    }
    return null;
  } catch {
    return null;
  }
}
async function refreshWelcomeFor(userId: string, forceState?: WelcomeState): Promise<void> {
  try {
    const resolved = forceState ? { state: forceState, nick: null as string | null } : await resolveWelcomeState(userId);
    if (!forceState && resolved.state === 'new') return;
    let nick = resolved.nick;
    if (!nick && !forceState) {
      const reqs = await fetchRequests();
      const req = reqs.find((x) => x.user_id === userId && (x.application_status === 'SUBMITTED' || x.application_status === 'APPROVED'));
      if (req) nick = nickFromRequest(req);
    }
    if (!nick && resolved.state !== 'approved') return;
    if (welcomedState.get(userId) === resolved.state) {
      const ex0 = await findWelcome(userId);
      if (ex0) return;
    }
    const mention = '<@' + userId + '>';
    const existing = await findWelcome(userId);
    if (existing) {
      await existing.edit({ embeds: [welcomeEmbed(mention, nick, resolved.state)] });
    } else {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return;
      const ch = await guild.channels.fetch(WELCOME_ID);
      if (ch && ch.isTextBased()) {
        await (ch as TextChannel).send({ embeds: [welcomeEmbed(mention, nick, resolved.state)] });
      }
    }
    welcomedState.set(userId, resolved.state);
    console.log('welcome updated for ' + userId + ' state=' + resolved.state + ' nick=' + nick);
  } catch (e) {
    console.error('welcome-refresh-err', e);
  }
}
async function sweepSubmitted(): Promise<void> {
  try {
    const reqs = await fetchRequests();
    for (const req of reqs) {
      if (req.application_status !== 'SUBMITTED' && req.application_status !== 'APPROVED') continue;
      const want: WelcomeState = req.application_status === 'APPROVED' ? 'approved' : 'submitted';
      if (welcomedState.get(req.user_id) === want) {
        const ex = await findWelcome(req.user_id);
        if (ex) continue;
      }
      await refreshWelcomeFor(req.user_id);
    }
  } catch (e) {
    console.error('sweep-err', e);
  }
}
async function pollApprovals(): Promise<void> {
  try {
    const reqs = await fetchRequests();
    for (const req of reqs) {
      if (req.application_status !== 'APPROVED') continue;
      if (seenApproved.has(req.id)) continue;
      seenApproved.add(req.id);
      await handleApproval(req.user_id, req);
    }
  } catch (e) {
    console.error('poll-err', e);
  }
}
async function ensureWhitelistButton(): Promise<void> {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    const found = guild.channels.cache.find((c) => c.name === 'whitelist' && c.isTextBased());
    if (!found || !found.isTextBased()) return;
    const ch = found as TextChannel;
    const msgs = await ch.messages.fetch({ limit: 10 });
    const mine = client.user ? client.user.id : '';
    for (const m of msgs.values()) {
      if (m.author.id === mine && m.components.length > 0) return;
    }
    const btn = new ButtonBuilder().setCustomId('whitelist-self').setLabel('Add yourself into whitelist').setStyle(ButtonStyle.Primary);
    await ch.send({
      embeds: [new EmbedBuilder().setColor(C_INFO).setTitle('Get whitelisted').setDescription('Click the button below and enter your Minecraft username.\n\nYou can only do this once, so type it carefully.')],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(btn)],
    });
    console.log('whitelist button posted');
  } catch (e) {
    console.error('btn-err', e);
  }
}
let chatOff = 0;
try {
  chatOff = Buffer.byteLength(readFileSync(MC_LOG, 'utf8'), 'utf8');
} catch { chatOff = 0; }
function parseMcChat(line: string) {
  line = line.replace(/\uFFFD/g, '\u00bb');
  if (line.indexOf('Async Chat Thread') < 0) return null;
  if (line.indexOf(BRIDGE_TAG) >= 0) return null;
  const after = line.split('INFO]:').pop() || '';
  const stripped = after.replace(/<[^>]*>/g, '');
  const m2 = stripped.match(/([A-Za-z0-9_]{3,16})\s*»\s*(.+)$/);
  if (m2 && m2[2].trim()) return { nick: m2[1], msg: m2[2].trim().slice(0, 300) };
  const tags = after.match(/<([A-Za-z0-9_]{3,16})>/g);
  if (tags && tags.length) {
    const last = tags[tags.length - 1];
    const nick = last.slice(1, -1);
    const msg = after.slice(after.lastIndexOf(last) + last.length).replace(/^[\s:>-]+/, '').trim();
    if (msg) return { nick: nick, msg: msg.slice(0, 300) };
  }
  return null;
}
async function pollMcChat() {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    const ch = await guild.channels.fetch(MC_CHAT_ID).catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    let txt = '';
    try { txt = readFileSync(MC_LOG, 'utf8'); } catch { return; }
    const buf = Buffer.from(txt, 'utf8');
    if (buf.length < chatOff) chatOff = 0;
    const chunk = buf.slice(chatOff).toString('utf8');
    chatOff = buf.length;
    for (const ln of chunk.split('\n')) {
      const p = parseMcChat(ln);
      if (!p) continue;
      try { await (ch as TextChannel).send('**' + p.nick + ':** ' + p.msg); } catch (e) { console.error('mc2dc-err', e); }
    }
  } catch (e) {
    console.error('pollchat-err', e);
  }
}
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
client.once(Events.ClientReady, async (c) => {
  console.log('kairox-bot online ' + c.user.tag);
  const rest = new REST().setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(c.user.id, GUILD_ID), {
    body: [
      new SlashCommandBuilder().setName('welcometest').setDescription('Preview the welcome message').toJSON(),
      new SlashCommandBuilder().setName('whitelist').setDescription('Whitelist a player by nickname')
        .addStringOption((o) => o.setName('nick').setDescription('Minecraft username').setRequired(true)).toJSON(),
      new SlashCommandBuilder().setName('kick').setDescription('Kick from Discord and remove MC whitelist')
        .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
        .addStringOption((o) => o.setName('nick').setDescription('Minecraft username').setRequired(false)).toJSON(),
      new SlashCommandBuilder().setName("unwhitelist").setDescription("Remove a player from the whitelist")
        .addStringOption((o) => o.setName("nick").setDescription("Minecraft username").setRequired(true)).toJSON(),
      new SlashCommandBuilder().setName('whitelist-reset').setDescription('Allow a Discord user to use self-whitelist again')
        .addUserOption((o) => o.setName('user').setDescription('Member to reset').setRequired(true)).toJSON(),
      new SlashCommandBuilder().setName('status').setDescription('Kairox server status').toJSON(),
      new SlashCommandBuilder().setName('players').setDescription('Who is online right now').toJSON(),
    ],
  });
  console.log('slash commands registered');
  await ensureWhitelistButton();
  await sweepSubmitted();
  await pollApprovals();
  await reconcileApproved();
  await updateStatusMsg();
});
setInterval(() => { void pollApprovals(); }, 60000);
setInterval(() => { void sweepSubmitted(); }, 60000);
setInterval(() => { void reconcileApproved(); }, 1800000);
setInterval(() => { void updateStatusMsg(); }, 60000);
setInterval(() => { void pollMcChat(); }, 2500);
client.on('raw', async (packet: { t?: string | null; d?: { guild_id?: string; user_id?: string } | null }) => {
  try {
    if (!packet.t) return;
    if (packet.t !== 'GUILD_JOIN_REQUEST_CREATE' && packet.t !== 'GUILD_JOIN_REQUEST_UPDATE') return;
    const d = packet.d;
    if (!d || d.guild_id !== GUILD_ID || !d.user_id) return;
    await refreshWelcomeFor(d.user_id);
  } catch (e) {
    console.error('raw-jr-err', e);
  }
});
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const existing = await findWelcome(member.id);
    if (existing) {
      await refreshWelcomeFor(member.id);
      return;
    }
    const resolved = await resolveWelcomeState(member.id);
    if (resolved.state !== 'new') {
      await refreshWelcomeFor(member.id);
      return;
    }
    const ch = await member.guild.channels.fetch(WELCOME_ID);
    if (ch && ch.isTextBased()) {
      await (ch as TextChannel).send({ embeds: [welcomeEmbed(member.toString(), null, 'new')] });
      welcomedState.set(member.id, 'new');
    }
  } catch (e) {
    console.error('welcome-err', e);
  }
});
client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isButton() && i.customId === 'whitelist-self') {
      const modal = new ModalBuilder().setCustomId('whitelist-modal').setTitle('Whitelist yourself');
      const input = new TextInputBuilder().setCustomId('nick').setLabel('Minecraft username').setStyle(TextInputStyle.Short).setMinLength(3).setMaxLength(16).setRequired(true);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
      await i.showModal(modal);
      return;
    }
    if (i.isModalSubmit() && i.customId === 'whitelist-modal') {
      const userId = i.user.id;
      if (usedIds.has(userId)) {
        await i.reply({ embeds: [errBox('Already done', 'You already did this once. Ask staff to reset if you made a typo.')], ephemeral: true });
        return;
      }
      const nick = cleanNick(i.fields.getTextInputValue('nick'));
      if (!nick) {
        await i.reply({ embeds: [errBox('Invalid nickname', 'Use 3-16 chars: a-z, 0-9, underscore.')], ephemeral: true });
        return;
      }
      if (readWl().some((e) => e.name.toLowerCase() === nick.toLowerCase())) {
        await i.reply({ embeds: [errBox('Name taken', nick + ' is already whitelisted. If this is yours, ask staff.')], ephemeral: true });
        return;
      }
      const platform = null;
      usedIds.add(userId);
      saveUsed();
      await i.deferReply({ ephemeral: true });
      try {
        const res = await mcWhitelistAdd(nick, platform);
        try {
          const m = await i.guild?.members.fetch(userId);
          if (m && m.nickname !== nick) await m.setNickname(nick, 'self whitelist');
        } catch (e) { console.error('self-nick-err', e); }
        await i.editReply({ embeds: [okBox(nick + ' added to whitelist')] });
      } catch {
        usedIds.delete(userId);
        saveUsed();
        await i.editReply({ embeds: [errBox('Failed', 'Tell staff.')] });
      }
      return;
    }
    if (!i.isChatInputCommand()) return;
    if (i.commandName === 'status') {
      await i.deferReply();
      const st = await mcOnline();
      if (!st.online) {
        await i.editReply({ embeds: [errBox('Kairox SMP is offline', 'The server is currently down. Check back soon.')] });
      } else {
        await i.editReply({ embeds: [okBox('Kairox SMP is online', '**' + st.n + '/' + st.max + '** playing' + (st.names.length ? '\n' + st.names.join(', ') : ''))] });
      }
      return;
    }
    if (i.commandName === 'players') {
      await i.deferReply();
      const st = await mcOnline();
      if (!st.online) {
        await i.editReply({ embeds: [errBox('Offline', 'The server is currently down.')] });
      } else if (!st.names.length) {
        await i.editReply({ embeds: [okBox('No one online', st.n + '/' + st.max + ' playing.')] });
      } else {
        await i.editReply({ embeds: [okBox(st.n + '/' + st.max + ' online', st.names.join('\n'))] });
      }
      return;
    }
    if (i.user.id !== OWNER_ID) {
      await i.reply({ embeds: [errBox('Only the owner can use this.')], ephemeral: true });
      return;
    }
    if (i.commandName === 'welcometest') {
      const m = i.member as GuildMember | null;
      const mention = m ? m.toString() : i.user.toString();
      await i.reply({ embeds: [welcomeEmbed(mention)], ephemeral: true });
    }
    if (i.commandName === 'whitelist') {
      const nick = cleanNick(i.options.getString('nick', true));
      if (!nick) {
        await i.reply({ embeds: [errBox('Invalid nickname', 'Use 3-16 chars: a-z, 0-9, underscore.')], ephemeral: true });
        return;
      }
      const plat = i.options.getString('platform', false);
      const res = await mcWhitelistAdd(nick, plat);
      await i.reply({ embeds: [okBox(nick + ' added to whitelist', res + ' | ' + (plat || 'auto'))] });
    }
    if (i.commandName === 'whitelist-reset') {
      const target = i.options.getUser('user', true);
      if (usedIds.has(target.id)) {
        usedIds.delete(target.id);
        saveUsed();
        await i.reply({ embeds: [okBox('Reset done', target.tag + ' can use self-whitelist again.')] });
      } else {
        await i.reply({ embeds: [okBox('Nothing to reset', target.tag + ' was not locked.')] });
      }
      return;
    }
    if (i.commandName === 'unwhitelist') {
      const nick2 = cleanNick(i.options.getString("nick", true));
      if (!nick2) {
        await i.reply({ embeds: [errBox("Invalid nickname", "Use 3-16 chars.")], ephemeral: true });
        return;
      }
      const res2 = await mcWhitelistRemove(nick2);
      await i.reply({ embeds: [okBox(nick2 + " removed from whitelist", res2)], ephemeral: true });
    }
    if (i.commandName === 'kick') {
      if (!i.guild) {
        await i.reply({ embeds: [errBox('Use this inside the server.')], ephemeral: true });
        return;
      }
      const target = i.options.getUser('user', true);
      const given = i.options.getString('nick', false);
      let nick = given ? cleanNick(given) : null;
      let member = null;
      try { member = await i.guild.members.fetch(target.id); } catch { member = null; }
      if (!nick && member) nick = cleanNick(member.displayName);
      const parts: string[] = [];
      if (nick) {
        try {
          parts.push('MC: ' + await mcWhitelistRemove(nick));
        } catch { parts.push('MC failed'); }
      } else {
        parts.push('no valid nick, whitelist skipped');
      }
      if (member) {
        try {
          await member.kick('kicked by owner');
          parts.push('Discord: kicked');
        } catch { parts.push('Discord kick failed'); }
      } else {
        parts.push('Discord: already gone');
      }
      const kb = new EmbedBuilder().setColor(C_ACT).setTitle('Kick: ' + target.tag).setDescription(parts.join('\n'));
      await i.reply({ embeds: [kb], ephemeral: true });
    }
  } catch (e) {
    console.error('interaction-err', e);
  }
});
client.on(Events.GuildMemberRemove, async (member) => {
  try {
    const cands: (string | null)[] = [
      member.nickname ? cleanNick(member.nickname) : null,
      cleanNick(member.displayName),
    ];
    let freed = false;
    if (usedIds.has(member.id)) { usedIds.delete(member.id); saveUsed(); freed = true; }
    const wl = readWl();
    for (const n of cands) {
      if (!n) continue;
      if (wl.some((e) => e.name.toLowerCase() === n.toLowerCase())) {
        try {
          const res = await mcWhitelistRemove(n);
          console.log('leave-removal ' + member.user.tag + ' -> ' + n + ': ' + res);
        } catch (e) { console.error('leave-removal-err', e); }
      }
    }
    if (freed) console.log('self-whitelist lock released for ' + member.user.tag);
  } catch (e) {
    console.error('leave-err', e);
  }
});
client.on(Events.GuildMemberUpdate, async (before, after) => {
  try {
    if (before.pending !== false && !after.pending) {
      await handleApproval(after.id, null);
    }
  } catch (e) {
    console.error('err', e);
  }
});
client.on(Events.MessageCreate, async (msg) => {
  try {
    if (!msg.guild || msg.author.bot) return;
    if (msg.channelId === MC_CHAT_ID) {
      let text = String(msg.content || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      text = text.replace(/@everyone|@here/gi, '@-');
      if (text) {
        try { await rcon('say ' + BRIDGE_TAG + ' ' + msg.author.username.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) + ': ' + text); } catch (e) { console.error('dc2mc-err', e); }
      }
      return;
    }
    const staff = msg.member ? msg.member.permissions.has(PermissionFlagsBits.Administrator) : false;
    if (msg.channelId === MEDIA_ID) {
      if (staff) return;
      const visual =
        msg.attachments.some((a) => (a.contentType || '').startsWith('image/') || (a.contentType || '').startsWith('video/')) ||
        msg.embeds.some((e) => e.data.type === 'image' || e.data.type === 'gifv' || e.data.type === 'video') ||
        msg.stickers.size > 0;
      if (!visual) await msg.delete();
      return;
    }
    if (staff) return;
    const hasLink = LINK_RE.test(msg.content);
    const hasGif = msg.embeds.some((e) => e.data.type === 'gifv');
    if (hasLink || hasGif) {
      try { await msg.delete(); } catch (e) { console.error('del-err', e); }
      try {
        const warn = await (msg.channel as TextChannel).send({
          embeds: [new EmbedBuilder().setColor(C_ERR).setTitle('uh oh!').setDescription('Links and GIFs are not allowed in this channel!')],
        });
        setTimeout(() => { warn.delete().catch(() => undefined); }, 8000);
      } catch (e) { console.error('warn-err', e); }
    }
  } catch (e) {
    console.error('media-err', e);
  }
});
void client.login(TOKEN);

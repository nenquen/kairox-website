# Kairox sites

Everything except the Minecraft server itself. Static sites, admin panel,
Discord bot, status checker, and the infra around them.

## What's here

- `sites/kairox.fun` — main site + `/application` page (plain HTML/CSS/JS, no build step)
- `sites/status.kairox.fun` — status page (reads `api.json`, also plain HTML/JS)
- `sites/banner.json.example` — announcement strip content (copy to `banner.json` to use)
- `admin-panel/` — tiny Node panel, zero dependencies. Login, inbox, whitelist,
  ops, console, banner, incidents, account. Talks to the MC server over RCON.
- `mcstatus/` — checks Java + Bedrock + website every 60s, writes `api.json`
  and keeps the uptime history. Serves nothing itself.
- `bot/` — Discord bot (TypeScript). Whitelist button, application approvals,
  welcome messages, live MC<->Discord chat bridge, `/status` and `/players`.
- `infra/` — docker-compose, Dockerfiles, nginx vhosts, starter units, scripts.

## How it's wired

```
visitors → Cloudflare (DNS + TLS) → nginx on this box
  ├── kairox.fun            → static files
  ├── status.kairox.fun     → static files (+ api.json from mcstatus)
  └── admin.kairox.fun      → proxy to admin-panel on 127.0.0.1:8471
```

The panel reaches the game two ways: RCON on `127.0.0.1:25575` for commands,
and the tmux socket for anything that needs a real console. `whitelist.json`,
`latest.log` and `banner.json` are shared into the containers as files, so both
sides always see the same thing.

mcstatus polls the game (`25565` Java, `19132` Bedrock) plus the website, and
rewrites `api.json` + `history.json` every minute. The status page just renders
whatever `api.json` says.

The bot reads Discord events, writes to `whitelist.json`, and runs RCON for
everything else. Approving someone also puts them in the LuckPerms `player`
group, so whitelist + rank never drift apart.

The `start-requested` file is the poor man's process manager: the panel drops
it when you press Start, a tiny host watcher sees it and boots the server.

## Bring-up on a fresh box

1. Install the basics: `node 22`, `docker`, `nginx`, `tmux`, Java 25.
2. Copy the sites to `/var/www/`, the vhosts to nginx, and get certs with certbot.
3. Create the secret files (see below). Nothing works without them.
4. Put the MC server at `/home/nenquen/kairox` with RCON on, matching `server.properties`.
5. `docker compose up -d` from `infra/`. Done.

## Secrets (create by hand, never commit)

- `/opt/admin-panel/data/auth.json` — run `setup.js` once, it prints the password.
  Format: `{ "users": [{ "user", "salt", "hash", "createdAt" }] }` (scrypt).
- `/opt/admin-panel/data/hook.secret` — random hex, for the mail webhook.
- `/opt/kairox-bot/token` — Discord bot token, one line.
- `/opt/kairox-bot/rcon.pass` — must match `rcon.password` in `server.properties`.
- `/opt/kairox-bot/used.json` — starts as `[]`, tracks one-time self-whitelists.
- `/opt/kairox-bot/status_msg.json` — starts as `{}`, bot fills it in.
- `/opt/mcstatus/history.json` — starts as `[]`, grows on its own.
- `/var/www/shared/banner.json` — `{"enabled":false,"text":"","linkText":"","linkUrl":"","type":"info"}`.
- `/opt/mcstatus/notes.json` — starts as `[]`, incident notes live here.

## DNS you need

`kairox.fun`, `www`, `status`, `admin` (and `smp` for the game) as A records.
TLS via certbot, same as any nginx box.

## Notes from running it

- Paper and friends move fast; when the game updates, check the plugin list
  before touching anything. Essentials will complain about unsupported versions
  and still work fine. Ignore it until a release says otherwise.
- Gamerule IDs went `snake_case` (`minecraft:keep_inventory`) at some point.
  Old `camelCase` commands just error out. Don't ask why.
- Floodgate + Geyser versions must match each other or Bedrock does weird things.
- If the panel ever says "stale page", hard-refresh. Old tabs carry old tokens.

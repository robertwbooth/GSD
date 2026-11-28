# GSD

A personal, self-hosted task app modelled on TickTick, with Notion-style notes and Goblin.Tools-style task breakdown on the way. See [docs/SPEC.md](docs/SPEC.md) for the full plan.

## What works today (milestone 1)

- Smart lists: Today, Tomorrow, Next 7 Days, Inbox, All, Completed, Won't Do, Trash
- Lists with list and board (Kanban) views, sections, drag between columns
- Quick add with natural language: `Call mum tomorrow 5pm !high #family ~Personal every week`
- Tasks with due date and time, priority, tags (nested with `/`), repeats, checklist, subtasks, notes
- Undo for complete and delete, search, tags in the sidebar
- Works offline and syncs between devices through your server
- Installable as an app from the browser (PWA), phone-friendly layout
- Feedback button (or press `F`) that files a GitHub issue in this repo
- Nightly database backups, kept for 30 days

**Shortcuts:** `N` add a task · `F` send feedback · `Esc` close · `Ctrl/Cmd+Z` undo

## Run it on your home server

You need Docker.

```sh
git clone https://github.com/robertwbooth/gsd.git
cd gsd
cp .env.example .env      # then set GSD_PASSWORD
docker compose up -d --build
```

Open `http://<server-ip>:8080` and sign in with your password. Data lives in the `gsd-data` Docker volume (database plus `backups/`).

To update: `git pull && docker compose up -d --build`.

### Feedback to GitHub (optional)

1. On GitHub, go to Settings → Developer settings → Fine-grained tokens → Generate new token.
2. Repository access: only `robertwbooth/gsd`. Permissions: Issues → Read and write.
3. Put the token in `.env` as `GSD_GITHUB_TOKEN` and restart.

Without a token, feedback is saved on the server and shown on the Feedback page.

### Live sync with TickTick (optional)

While you move over, GSD can check TickTick every 15 minutes. New tasks and edits in TickTick come into GSD, tasks no longer open in TickTick are marked done, and ticking a synced task in GSD completes it in TickTick. Tags and completed history come from the backup import, because TickTick's API doesn't offer them.

1. Sign in at https://developer.ticktick.com/manage and create an app (any name).
2. Set its redirect URL to `<your GSD address>/api/ticktick/callback`, for example `https://ghost-sbp.tailec0705.ts.net/api/ticktick/callback`.
3. Add to `.env`: `GSD_PUBLIC_URL` (your GSD address), `GSD_TICKTICK_CLIENT_ID` and `GSD_TICKTICK_CLIENT_SECRET`, then restart.
4. In GSD, open Import and press **Connect TickTick**.

### Use it away from home (Tailscale)

No router ports need opening.

1. Install Tailscale on the server and on your Mac and Android phone, signed in to the same account.
2. On the server: `sudo tailscale serve --bg 8080`. This gives the app an HTTPS address like `https://<server-name>.<tailnet>.ts.net` that only your devices can reach.
3. Open that address on each device and install it: in Chrome or Edge use "Install app"; on Android use "Add to Home screen"; in Safari on Mac use File → Add to Dock.

HTTPS is needed for installing the app and for offline mode, so use the Tailscale address on every device, even at home.

## Develop

```sh
npm install
npm run dev          # server on :8080 (password "dev"), web on :5173
npm test             # unit tests
npm run test:e2e     # browser tests (builds and starts its own server)
npm run typecheck
```

Layout: `packages/core` (task model, quick-add parser, repeats, smart lists, sync merge), `apps/server` (Fastify + SQLite), `apps/web` (React + Vite).

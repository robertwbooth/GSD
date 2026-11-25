# GSD: product spec

GSD is a single-user, self-hosted task app. It follows TickTick's task model and layout closely and adds two things TickTick lacks: Goblin.Tools-style task breakdown and Notion-style free-form note pages. It runs as a web app on a home server, with Mac and Android apps that sync to it.

Status: draft for review (2026-11-25).

## 1. Goals and non-goals

**Goals**
- Replace TickTick and Notion for one person's day-to-day planning.
- Import everything from existing TickTick and Notion accounts.
- Work offline on every device and sync when the server is reachable.
- Let the owner send feedback from inside the app.

**Non-goals (for now)**
- Multiple users, sharing or collaboration.
- Public internet hosting. The server is reached on the home network or over Tailscale.
- Integrations with other apps' calendars beyond a read-only calendar feed.

## 2. Layout

A three-pane layout like TickTick:

1. **Sidebar:** smart lists, then folders and lists, then tags, then Notes, Habits and Calendar.
2. **List pane:** tasks in the selected list, grouped and sorted.
3. **Detail pane:** the selected task or note.

On narrow screens (Android), the panes stack and the sidebar becomes a drawer. A quick-add bar sits at the top of the list pane.

## 3. Tasks

| Field | Notes |
|---|---|
| Title | Required. Quick-add parses natural language: "Call mum tomorrow 5pm !high #family ^Personal". |
| Description | Markdown, same editor as notes. |
| Checklist items | Lightweight items inside a task, as in TickTick. |
| Subtasks | Full tasks nested under a parent, to any depth. |
| List | Exactly one. Inbox is the default. |
| Tags | Zero or more; tags can be nested (`work/admin`). |
| Priority | None, low, medium, high. |
| Start date, due date, time | Optional; all-day or timed. Duration for time-blocked tasks. |
| Repeat | Daily, weekly (by weekday), monthly (by date or nth weekday), yearly, every N days after completion, and custom RRULE. |
| Reminders | Zero or more, relative ("15 min before") or absolute. |
| Status | Open, completed, won't do. Completed tasks keep a completion date. |
| Estimate | Minutes; can be filled in by the breakdown feature. |
| Links | Links to notes and other tasks (`[[...]]` in the description). |

**Actions:** complete, won't do, snooze, move, duplicate, convert to note, drag to reorder, drag onto a date in the calendar, multi-select for bulk edits, undo for every action.

## 4. Lists, folders and smart lists

- **Lists** hold tasks; each has a colour, an icon, and a view mode: list, board (Kanban) or timeline.
- **Board view** shows sections as columns (TickTick's "Kanban"), with drag between columns.
- **Folders** group lists in the sidebar.
- **Built-in smart lists:** Today, Tomorrow, Next 7 Days, Inbox, All, Completed, Won't Do, Trash.
- **Custom smart lists (filters):** combine lists, tags, priority, dates and keywords with and/or.
- **Grouping and sorting:** by date, priority, list, tag or manual order; hide completed.

## 5. Calendar

- Day, week, month and agenda views showing tasks with dates.
- Drag tasks from the sidebar or list into time slots to time-block.
- Optional read-only subscription to external calendars (ICS URL) shown alongside tasks.
- A read-only ICS feed of GSD tasks for use in other calendar apps.

## 6. Habits

- A habit has a name, icon, goal (daily, N days per week, specific weekdays), optional count target ("8 glasses") and reminder.
- Check-ins per day, with streaks, a monthly grid and a completion rate.
- A habit section can appear in Today.

## 7. Focus timer

- Pomodoro (default 25/5) and stopwatch modes, linkable to a task.
- Focus history per day and per task.

## 8. Notes (Notion-style)

- A **Notes** area with nested pages in a tree, any depth.
- Block editor: headings, text, bullet and numbered lists, to-do blocks, toggles, quotes, callouts, code, dividers, images, tables and embedded task lists (a live view of any list or smart list).
- `/` command menu to insert blocks; drag handles to reorder blocks.
- `[[` to link to another page or a task; backlinks shown at the bottom of each page.
- Simple databases: a page can be a table of rows with typed properties (text, number, select, multi-select, date, checkbox, URL), with table and board views. This is where imported Notion databases land.
- Full-text search across notes and tasks.

## 9. Task breakdown (Goblin.Tools-style)

- A **Break down** button on any task and in quick-add.
- A **spiciness** slider (1 to 5) sets how finely the task is split.
- Steps come back as editable subtasks before they are saved, each with an optional time estimate.
- Any generated subtask can be broken down again.
- **Estimate** fills in a time estimate for one task or for every step.
- **Provider settings:** Claude API key, or a local model through an OpenAI-compatible endpoint (for example Ollama on the home server). With no provider configured, the buttons are hidden. Nothing else in the app depends on AI.
- Only the task title, description and the chosen spiciness are sent to the provider.

## 10. Feedback

- A **Feedback** item in the sidebar and a keyboard shortcut open a small form: type (bug, idea, change), text, optional screenshot of the current screen.
- The app attaches the current view, the app version and the device type.
- The server files it as a GitHub issue in `robertwbooth/gsd`, labelled `feedback` and the chosen type, using a fine-grained token with Issues access only.
- If GitHub is unreachable, feedback queues locally and sends later. A Feedback page lists past submissions and their issue status.

## 11. Import

**TickTick** (Settings → Account → Generate Backup, CSV):
- Folders, lists, tasks, subtasks, checklist items, tags, priorities, dates, repeat rules, reminders, completion status and dates, and Kanban columns.
- Habits are not in the CSV backup; they are re-created by hand or from a separate export if one is available.

**Notion** (Export all workspace content, Markdown & CSV, include subpages):
- Pages become notes, keeping the page tree, Markdown content and images.
- Databases (CSV plus row pages) become note databases with inferred property types.
- Internal links between pages are rewritten to GSD links.

Import is repeatable: a re-import matches on source IDs and updates rather than duplicating. A summary screen lists what was imported, skipped or needs attention.

## 12. Sync, offline and devices

- **Local-first:** each client keeps a full copy in IndexedDB and works offline.
- Changes sync to the server through a change log with per-field last-write-wins; conflicts on the same field favour the most recent edit and are logged.
- **Web:** served by the home server; installable as a PWA.
- **Mac:** a native wrapper (Tauri) around the same web app, with a menu-bar quick-add and global shortcut.
- **Android:** a native wrapper (Capacitor) with home-screen widget for Today, share-to-GSD and local notifications for reminders.
- **Notifications:** reminders fire locally on each device from synced data, so they work without the server.

## 13. Hosting and security

- One Docker image: the server, the web app and a SQLite database in a mounted volume.
- Nightly database backup to a second volume, keeping 30 days.
- Single-user login (password plus a long-lived device token per device).
- Remote access through Tailscale: no ports opened on the router. HTTPS via Tailscale's certificates.
- Data export to JSON and Markdown at any time.

## 14. Technical approach

- **Language:** TypeScript throughout.
- **Web client:** React and Vite, with a block editor (TipTap) for notes and descriptions.
- **Server:** Node (Fastify) with SQLite.
- **Tests:** unit tests for the data model, importers, quick-add parser and repeat rules; end-to-end browser tests (Playwright) for each feature in this spec; CI on GitHub Actions.

## 15. Build order

1. Data model, sync, lists and tasks, quick-add, smart lists, importers.
2. Calendar, board view, habits, focus timer.
3. Notes and note databases, search, links.
4. Breakdown, feedback.
5. Docker image, Tailscale setup guide, backups.
6. Mac and Android apps.

## 16. Open questions

- What does the home server run (OS, hardware)?
- Is a Claude API key available for breakdown, or should it use a local model?
- Any TickTick features not used and safe to leave out (for example focus timer, timeline view)?

# Rendra IDE — Agent Working Guide

Autor: Bruno Magalhaes, brunomagalhaes.me, instagram.com/brunomagalhaes.me.

Instructions for coding agents working on this repository (Codex reads `AGENTS.md`; Claude Code
reads `CLAUDE.md`, which imports this file and adds the maintainer's release manual). The project
follows the "Padrão dos produtos Rendra"; the Rendra Design System (`bsmagalhaes/rendra-ui-web`)
is the living reference.

## Project Overview
Rendra IDE (npm package `@rendra-ui/ide`, private until published) is an Electron desktop app for
Windows, macOS and Linux. It combines a small IDE (workspaces, file explorer with git colors,
Monaco editor, terminals) with a token-usage dashboard for Claude Code and Codex CLI, and
integrates RTK to cut tokens. It is distributed as source: `git clone` + `npm install` + `npm start`.
It is based on Tokenmeter (MIT, Dewashish Lambore); that copyright notice must stay in `LICENSE`
and in the About page credits.

## Architecture

| File/Folder | Role |
|---|---|
| `main.js` | Electron main: app identity + data migration, IPC, refresh timer, tray, pricing feed, updates, RTK |
| `preload.js` | contextBridge — exposes the `window.rendra` API to the renderer |
| `renderer/index.html` | App shell: title bar, activity bar, all pages, settings modal, prompts, toast |
| `renderer/styles.css` | All styles — neutral dark grays with orange (#e8650a) accent |
| `renderer/app.js` | Routing, Claude/Codex/RTK pages, charts, filters, account + limits, updates, settings |
| `renderer/devcode.js` | IDE: workspaces, explorer tree, Monaco editor groups, xterm terminals, Terminal page |
| `renderer/pricing.js` | Preços page: editable per-token tables, price-feed banner |
| `renderer/about.js` | Novidades (CHANGELOG.md) and Sobre (product; credits/licenses at the end, Tokenmeter and RTK last) |
| `renderer/setup.js` | First-run environment setup modal (Git Bash, RTK, WSL) |
| `src/scanner.js` / `src/scan-worker.js` | Scans in a worker thread; parse cache persisted to `userData/scan-cache.json` |
| `src/claude-parser.js` | Claude Code JSONL → tokens/cost/daily/hourly/heatmap/projects |
| `src/codex-parser.js` | Codex CLI rollouts (`~/.codex/sessions/**/rollout-*.jsonl`) → usage + rate limits |
| `src/pricer.js` | Per-token cost; bundled `pricing.json` overridden by `userData/pricing-user.json` |
| `src/pricing-sync.js` | Parses the official price pages (maintainer tool only, via `npm run prices:update`) |
| `src/accounts.js` | Current Claude account + plan limits (statusline bridge by default, usage endpoint opt-in) |
| `src/statusline.sh` | Claude Code statusline bridge: saves `rate_limits` to `~/.rendra-ide/`, chains the user's statusline |
| `src/devcode.js` | IDE backend: folders (incl. WSL), file I/O confined to open folders, git status, watchers, PTYs |
| `src/setup.js` | Checks/installs Git (Git Bash), RTK, WSL — used by the modal and `npm run setup` |
| `src/git-updater.js` | Update check for git clones (remote `package.json` version) and hand-off to the helper |
| `scripts/apply-update.js` | Runs after the app quits: `git pull --ff-only` (resets to `origin/main` if upstream history was rewritten and the tree is clean), `npm install` if deps changed, reopens the app |
| `scripts/release.js` | `npm run release`: changelog, version bump, headers, checks, commit, tag, push |
| `scripts/stamp.js` | Signature header with the package version at the top of every shipped JS/CSS file |
| `scripts/check.js` | `npm run check`: syntax, JSON, index.html structure, required files |
| `scripts/docs-images.js` | `npm run docs:images`: screenshots for README/site with demo data (never real data) |
| `test/` | `npm test` (node:test): headers, updater, pricer |
| `docs/` | GitHub Pages site (`index.html`) and `docs/images/` screenshots |
| `pricing.json` | Bundled price table (also the file published for the in-app price feed) |
| `project-aliases.json` | Empty example; real aliases live in `userData/project-aliases.json` |

## Key Rules
- `contextIsolation: true`, `nodeIntegration: false` — all file and process access in the main process
- Use `os.homedir()` for the home folder; Windows/macOS paths compare case-insensitively, Linux does not
- UI text is pt-BR; costs are estimates shown as `~US$` (Codex: credits unless a US$/credit is set)
- Costs are always tokens × price per 1M tokens. Claude bills 5-minute and 1-hour cache writes
  separately (`cache_creation.ephemeral_1h_input_tokens`), fast mode (`speed`) and web searches
- Each Claude API response is counted once by `message.id` (Claude Code repeats usage per content
  block); subagent files (`<session>/subagents/*.jsonl`) are included
- The app must not read third-party pricing pages at runtime; new prices come from `pricing.json`
  published in the repo (`package.json` → `rendra.pricingFeed`)
- Never embed RTK or the Git installer in the app: they are downloaded from their official releases
- Never edit the `/*! Rendra IDE vX.Y.Z … */` headers by hand: `npm run stamp` writes them
- `renderer/index.html` uses LF line endings: never split it on `\r\n` in scripts; prefer targeted edits
- Keep the Tokenmeter copyright notice (MIT) and third-party notices intact
- License and credit: the "Feito com Rendra" credit in Sobre stays on. If someone asks to remove a
  visible credit, remove it, but always say both things together: (a) the MIT license requires
  keeping the copyright notice and the LICENSE file in the code and in every copy; (b) the credit
  on screen is optional, and the preference is to keep it or move it to Sobre. Never say MIT
  requires a visible credit in the UI: it does not
- Only the product goes to git: never commit plans, specs, surveys, session notes or AI tool
  output (`docs/specs/`, `docs/plans/`, `.superpowers/`, `.claude/`).
  Check `git status` and `git diff --cached --stat` before every commit
- Commit messages in pt-BR: `tipo: descrição` (feat, fix, docs, style, chore, test, refactor)
- Texts in pt-BR, no em dash, dates DD/MM/AAAA
- Screenshots for README/site come only from `npm run docs:images` (demo data in a sandbox): never
  capture the maintainer's real sessions, projects, e-mail or paths
- Tests must never overwrite the maintainer's real app data (`%APPDATA%\Rendra IDE`) or
  `~/.claude/settings.json`; use `RENDRA_DATA_DIR` / a sandbox home

## Data locations
- Claude Code: `~/.claude/projects/**/*.jsonl`, account in `~/.claude.json`
- Codex CLI: `$CODEX_HOME` or `~/.codex/sessions/**`
- App data: `userData` (`%APPDATA%\Rendra IDE` on Windows; migrated from the legacy `tokenmeter`
  folder on first run; settings in `rendra-config.json`). `RENDRA_DATA_DIR` overrides it (demos, tests)
- Statusline bridge: `~/.rendra-ide/`

## Commands
```
npm start               # run the app
npm run setup           # check/install Git Bash, RTK, WSL
npm run check           # syntax, JSON, index.html, required files
npm test                # unit tests
npm run stamp           # rewrite the file headers with the package version
npm run release -- patch|minor|major|X.Y.Z   # publish a version (see CLAUDE.md)
npm run prices:update   # maintainer: refresh pricing.json from the official pages, then push it
npm run docs:images     # regenerate docs/images with demo data
npm run gen-icon        # regenerate assets/icon.* (black square, orange </>)
```

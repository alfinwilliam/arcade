# Arcade

Small browser games about packets, pods and planets. Plain HTML, CSS and JavaScript: no build step, no packages, no backend.

Live site: https://alfinwilliam.github.io/arcade/

This README is the runbook. Everything needed to run, change, check and publish the site is here.

## Run it locally

```
python3 scripts/arcade.py preview
```

Then open http://127.0.0.1:8000/site/ . Stop it with Ctrl+C.

You need Python 3 and Google Chrome (or Chromium). Nothing else is installed or downloaded.

Opening the HTML files directly from disk does not work, because browsers refuse to load JavaScript modules from `file://` addresses. Always go through `preview`.

## Commands

Everything goes through one script. Run it from the repo root.

| Command | What it does |
|---|---|
| `python3 scripts/arcade.py preview` | Serves the repo on `127.0.0.1:8000` with caching off |
| `python3 scripts/arcade.py test [game ...]` | Runs the logic tests in headless Chrome |
| `python3 scripts/arcade.py smoke [game ...]` | Loads each page and fails on a JavaScript error |
| `python3 scripts/arcade.py shots [game ...]` | Saves screenshots at 1280 and 390 px wide in `.out/shots/` (add `--light` for the light theme) |
| `python3 scripts/arcade.py run FILE.js` | Runs one JavaScript file headless and prints what it logs |
| `python3 scripts/arcade.py lint [game ...]` | Checks structure, code rules and that only example values appear |
| `python3 scripts/arcade.py check` | `lint` + `test` + `smoke`. Run this before every push |

A game name is its folder name under `site/games/`, for example `pod-packer`. With no name, a command covers everything.

## Layout

```
site/                     the only folder that is published
  index.html, hub.js      the hub page
  games.js                the list of games shown on the hub
  404.html
  shared/                 base.css, shell.js, storage.js, canvas.js
  games/_template/        a tiny complete game: the pattern to copy
  games/<name>/           one folder per game
tests/                    one <name>.test.js per game, plus the small test harness
scripts/arcade.py         the one tool
.github/workflows/pages.yml   check, then publish
```

Locally the site is served under `/site/`, and on GitHub Pages under `/arcade/`. Both are subfolders, so a link that starts with `/` breaks in both places the same way. That is why every link to the site's own files is relative. The one exception is `404.html`, which GitHub shows for a missing address at any depth; its comments explain how it finds its way home.

## How a game is put together

Each game is five files in its own folder:

| File | Job |
|---|---|
| `levels.js` (or `presets.js`) | The content, as plain data. Its header comment describes every field |
| `logic.js` | The rules. No page, no clock, no storage, no randomness, so the same inputs always give the same result |
| `main.js` | The page: drawing and input. It never decides who wins; it calls `logic.js` |
| `index.html` | Loads the shared styles, `shared/shell.js`, then `main.js` |
| `style.css` | Styles for this game only, using the colour tokens from `shared/base.css` |

The rules every game follows:

1. A game touches only its own folder and its own test file.
2. Every level carries a `solution`: a list of inputs that wins it.
3. `logic.js` exports `replay(level, solution)`, which plays those inputs and returns a state whose `status` is `won`, `lost` or `playing`.
4. The page changes state only through the same function `replay` uses. So what the tests check is what the player gets.
5. Imports come only from `./` and `../../shared/`. Links are relative. The page is built with `el()` from `shared/shell.js`, never from HTML strings.
6. Every action works by pointer and by keyboard. The page works at 360 px wide.
7. The page calls `ready()` once the first frame is drawn. `smoke` waits for that.

`site/games/_template/` shows all of this in about 250 lines.

## Add a level

1. Open the game's `levels.js` and read the header comment. It lists every field.
2. Copy an existing entry, give it a new `id`, and change the values.
3. Run `python3 scripts/arcade.py preview` and open the game with `?dev` on the end of the address, for example `http://127.0.0.1:8000/site/games/_template/?dev`.
4. Win the level. With `?dev`, the win screen shows the inputs you used. Paste them into the entry's `solution`.
5. Run `python3 scripts/arcade.py check`.
6. Commit and push. The site updates when the run on the Actions tab turns green.

If you save a level that cannot be won as written, `test` fails and names the level. If you make a typing mistake in a data file, the page shows a red banner with the error instead of going blank.

## Add a new game

1. Copy `site/games/_template/` to `site/games/<name>/`.
2. Copy `tests/_template.test.js` to `tests/<name>.test.js` and change its two import paths.
3. Change the rules in `logic.js`, the content in `levels.js` and the page in `main.js`.
4. Run `python3 scripts/arcade.py check`.
5. Add one line to `site/games.js` so the hub shows a card for it.

A game folder with no line in `site/games.js` is still published, but nothing links to it.

## What the checks cover

| Check | Runs | Catches |
|---|---|---|
| `lint` | Locally and on GitHub | A missing file, a link starting with `/`, impure rules in `logic.js`, anything that is not an example value |
| `test` | Locally in Chrome, on GitHub under Node | A level whose `solution` no longer wins, a broken rule |
| `smoke` | Locally only | A page that throws an error or never finishes loading |

The test files are the same in both places. Locally they run in Chrome so nothing has to be installed. On GitHub they run under Node, which the workflow sets up, through `tests/run-node.mjs`.

`smoke` does not run on GitHub. A mistake in a `main.js` can therefore pass the GitHub checks, so run `check` locally before pushing.

This repo is public, so `lint` looks for things that are not example values: IP addresses outside the private and documentation ranges, 12-digit numbers other than `123456789012`, hostnames ending in `.com`, `.net`, `.org`, `.io`, `.ai` or `.cloud` that are not `example.com` or a documentation site, email addresses, AWS-style resource ids and common key formats. The exact lists are at the top of the lint section in `scripts/arcade.py`.

It is a safety net, not a guarantee. It cannot tell a real private range such as `10.42.0.0/16` from an example, and it cannot recognise a company, product, person or ticket name at all. Read new content once with that in mind before pushing. The example values to use are `10.0.0.0/16`, `123456789012`, `example.com` and `sample-app`.

## Deploy

Pushing to `main` publishes the site. The file that does it is `.github/workflows/pages.yml`. Here is what each part means.

**When it runs.** A workflow is a list of things GitHub does for you when something happens. `on:` names the something: a push to `main`, or you pressing "Run workflow" on the Actions tab (`workflow_dispatch`).

**One deploy at a time.** If you push twice in a row, two runs could try to publish at once. `concurrency:` puts runs with the same `group` in a queue. `cancel-in-progress: false` lets a deploy that has started finish.

**Two jobs.** A job is a set of steps that runs on one fresh machine. There are two, so that the one that publishes can only start if the one that checks has passed.

- `check` gets the code (`actions/checkout`), installs Node (`actions/setup-node`), runs `lint` and the tests, then packs the `site/` folder into a file (`actions/upload-pages-artifact`). That file is called an artifact: it is how one job hands something to another.
- `deploy` has `needs: check`, which means "wait for `check`, and do not run if it failed". It has one step, `actions/deploy-pages`, which publishes the artifact.

**Permissions.** Each job gets a short-lived token. `permissions:` says what that token may do. `check` may only read the code. `deploy` may write to Pages (`pages: write`) and may ask GitHub for proof of its own identity (`id-token: write`), which Pages requires before it accepts a deploy. Neither job can change the code.

**Environment.** `environment: github-pages` is the name GitHub gives to "the live site". It shows the address of the last deploy on the repo page. Rules about which branches may deploy to it live under Settings → Environments → github-pages.

**The `@v7` and `@v5` after each action.** An action is someone else's reusable step. The part after `@` pins which major version you use, so an update does not change your pipeline by surprise.

## Roll back

| Situation | What to do |
|---|---|
| The last push broke the site | `git revert <commit>` then `git push`. The workflow publishes the previous content |
| You want an older version live again without changing history | Actions tab → pick the last good run → "Re-run all jobs". GitHub allows this only for a limited time after the run; after that, use `git revert` |
| The checks fail on GitHub | Nothing was published. Open the failed run, read the step that failed, fix, push again |
| Take the site down, keep the repo | Settings → Pages → Unpublish site, or `gh api -X DELETE repos/alfinwilliam/arcade/pages` |
| Remove everything | Settings → General → Delete this repository |

After a deploy, browsers may keep the old files for up to ten minutes. A hard refresh (Ctrl+Shift+R) shows the new version at once.

## Upkeep

**Action versions.** GitHub announces when a version of an action is going away, and the run shows a warning on the Actions tab first. To update, open the action's page (for example `github.com/actions/checkout`), read the release notes for the next major version, and change the number after `@` in `pages.yml`. The versions here were current on 2026-11-15.

**Node version.** `node-version: 24` in `pages.yml` picks the Node used for the tests on GitHub. The tests use nothing version-specific, so moving to a newer long-term-support version is a one-number change.

**Chrome.** The local checks start Chrome with `--headless`. If a future Chrome changes its flags, the symptom is `the page never reported back`. Run `preview`, open `http://127.0.0.1:8000/tests/` in a normal browser window, and you will see the same tests run with the error on screen. The flags are in `browser_command` in `scripts/arcade.py`, plus the screenshot flags in `cmd_shots`. To use a different browser binary, set `ARCADE_BROWSER` to its path.

**How this repo was set up.** Done once, recorded here in case it is ever needed again:

```
gh repo create arcade --public --source . --remote origin
gh api -X POST repos/alfinwilliam/arcade/pages -f build_type=workflow
git push -u origin main
```

The second line turns on Pages with "GitHub Actions" as the source. The same setting is under Settings → Pages → Build and deployment → Source.

## About the content

A game that teaches networking or Kubernetes ideas is added to the hub only after its lessons have been checked against the official AWS and Kubernetes documentation by automated review (in November 2026, when the games were built). Treat them as learning aids, not as a reference, and trust the official documentation where they differ.

Built with AI assistance (Claude Code). Kept up by hand.

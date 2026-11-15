#!/usr/bin/env python3
"""arcade.py: the one tool for this repo. Python standard library only.

  python3 scripts/arcade.py preview            serve the repo; open http://127.0.0.1:8000/site/
  python3 scripts/arcade.py test [slug ...]    run logic tests in headless Chrome
  python3 scripts/arcade.py smoke [slug ...]   load pages; fail on a JS error or a missing ready flag
  python3 scripts/arcade.py shots [slug ...]   screenshots at 1280 and 390 px wide, into .out/shots/
  python3 scripts/arcade.py run FILE.js        run one JS module headless and print what it logs
  python3 scripts/arcade.py lint [slug ...]    structure, purity and example-values checks
  python3 scripts/arcade.py check              lint + test + smoke: run this before every push

How the browser commands work: this script starts a small web server on a free
local port, opens a page in headless Chrome, and the page POSTs its result back
to /__report. Nothing here needs Node or any installed package.
"""

import argparse
import http.server
import ipaddress
import json
import os
import queue
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
TESTS = ROOT / "tests"
OUT = ROOT / ".out"

REPORTS = queue.Queue()   # results POSTed back by pages
NOT_FOUND = []            # every path the server could not find during a run
SCRATCH = {}              # name -> a file outside the repo, served for `run`


# ---------------------------------------------------------------- web server

class Handler(http.server.SimpleHTTPRequestHandler):
    """Serves the repo root, never caches, and accepts reports from test pages."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        name = self.path.split("?", 1)[0]
        if name == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if name.startswith("/__scratch/") and name[len("/__scratch/"):] in SCRATCH:
            body = SCRATCH[name[len("/__scratch/"):]].read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/__report":
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            REPORTS.put(json.loads(body))
        except ValueError:
            REPORTS.put({"kind": "bad-report", "failed": 1, "passed": 0})
        self.send_response(204)
        self.end_headers()

    def log_request(self, code="-", size="-"):
        try:
            if int(code) == 404:
                NOT_FOUND.append(self.path)
        except (TypeError, ValueError):
            pass

    def log_message(self, *args):
        pass   # stay quiet; missing files are collected in NOT_FOUND instead


def start_server(port=0):
    """Start serving on 127.0.0.1. Port 0 means: pick any free port."""
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# ------------------------------------------------------------------- browser

def find_browser():
    wanted = os.environ.get("ARCADE_BROWSER")
    names = [wanted] if wanted else ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    sys.exit("No Chrome or Chromium found. Install one, or set ARCADE_BROWSER to its path.")


def browser_command(profile, width, height):
    command = [
        find_browser(), "--headless", f"--user-data-dir={profile}", f"--window-size={width},{height}",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
        "--disable-background-networking", "--disable-component-update", "--mute-audio", "--hide-scrollbars",
    ]
    if os.environ.get("ARCADE_NO_SANDBOX"):
        command.append("--no-sandbox")   # only needed inside some containers
    return command


def stop(process):
    """Stop the browser and every helper process it started."""
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except (ProcessLookupError, PermissionError):
        pass
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)


def open_page(path, timeout, size=(1280, 800)):
    """Open one page headless and wait for it to POST a report. Returns the report, or None."""
    while not REPORTS.empty():
        REPORTS.get()
    del NOT_FOUND[:]

    server = start_server()
    profile = tempfile.mkdtemp(prefix="arcade-browser-")
    url = f"http://127.0.0.1:{server.server_port}{path}"
    process = subprocess.Popen(
        browser_command(profile, *size) + [url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
    )
    report = None
    deadline = time.monotonic() + timeout
    try:
        while time.monotonic() < deadline:
            try:
                report = REPORTS.get(timeout=0.2)
                break
            except queue.Empty:
                if process.poll() is not None:   # the browser quit before reporting
                    try:
                        report = REPORTS.get(timeout=1)
                    except queue.Empty:
                        pass
                    break
    finally:
        stop(process)
        server.shutdown()
        server.server_close()
        shutil.rmtree(profile, ignore_errors=True)
    return report


def print_report(report, what):
    """Print a page's report. Returns the exit code: 0 good, 1 failures, 2 no report."""
    if report is None:
        print(f"{what}: the page never reported back.")
        print("Run `python3 scripts/arcade.py preview` and open the page in a browser to see why.")
        return 2
    for line in report.get("lines", []):
        print(line)
    if report.get("kind") == "page-error":
        print(f"{what}: the page itself failed to load: {report.get('message')}")
    missing = sorted(set(NOT_FOUND))
    if missing:
        print("Requested but not found (a wrong path somewhere):")
        for path in missing:
            print("  " + path)
    good = report.get("failed") == 0 and report.get("passed", 0) > 0 and not missing
    return 0 if good else 1


# ------------------------------------------------------------------ commands

def cmd_preview(args):
    start_server(args.port)
    print(f"Serving {ROOT}")
    print(f"  site:   http://127.0.0.1:{args.port}/site/")
    print(f"  tests:  http://127.0.0.1:{args.port}/tests/")
    print("Ctrl+C to stop.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print()
    return 0


def cmd_test(args):
    names = args.slugs or sorted(p.name[: -len(".test.js")] for p in TESTS.glob("*.test.js"))
    absent = [name for name in names if not (TESTS / f"{name}.test.js").is_file()]
    if absent:
        print("No test file for: " + ", ".join(absent) + "  (expected tests/<name>.test.js)")
        return 2
    report = open_page("/tests/index.html?report=1&only=" + ",".join(names), args.timeout)
    return print_report(report, "test")


def pages_for(slugs):
    """Site-relative pages to look at: the hub and 404 page plus every game, or just the named games."""
    if slugs:
        pages = [f"games/{slug}/index.html" for slug in slugs]
    else:
        games = sorted(p.parent.name for p in (SITE / "games").glob("*/index.html"))
        pages = ["index.html", "404.html"] + [f"games/{game}/index.html" for game in games]
    absent = [page for page in pages if not (SITE / page).is_file()]
    if slugs and absent:
        sys.exit("No such page: " + ", ".join("site/" + page for page in absent))
    return [page for page in pages if page not in absent]


def cmd_smoke(args):
    pages = pages_for(args.slugs)
    if not pages:
        print("smoke: no pages to load yet")
        return 2
    report = open_page("/tests/smoke.html?report=1&pages=" + ",".join(pages), args.timeout)
    return print_report(report, "smoke")


def shot_name(page):
    if page == "index.html":
        return "hub"
    return page.replace("games/", "").replace("/index.html", "").replace(".html", "")


def cmd_shots(args):
    pages = pages_for(args.slugs)
    folder = OUT / "shots"
    folder.mkdir(parents=True, exist_ok=True)
    # Headless Chrome reports a light colour scheme unless told otherwise. The site is
    # dark first, so shots are dark by default; --light takes the light theme instead.
    theme_flag = [] if args.light else ["--force-dark-mode"]
    suffix = "-light" if args.light else ""
    server = start_server()
    failed = 0
    try:
        for page in pages:
            for width, height in ((1280, 800), (390, 844)):
                target = folder / f"{shot_name(page)}-{width}{suffix}.png"
                target.unlink(missing_ok=True)
                profile = tempfile.mkdtemp(prefix="arcade-browser-")
                url = f"http://127.0.0.1:{server.server_port}/site/{page}"
                command = browser_command(profile, width, height) + theme_flag + [
                    f"--screenshot={target}", "--virtual-time-budget=4000", url]
                try:
                    subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
                except subprocess.TimeoutExpired:
                    pass
                finally:
                    shutil.rmtree(profile, ignore_errors=True)
                if target.is_file():
                    print(target)
                else:
                    failed += 1
                    print(f"FAILED  {target}")
    finally:
        server.shutdown()
        server.server_close()
    return 1 if failed else 0


def cmd_run(args):
    file = Path(args.file).resolve()
    if not file.is_file():
        print(f"run: no such file: {file}")
        return 2
    try:
        module = "/" + file.relative_to(ROOT).as_posix()   # inside the repo: relative imports work
    except ValueError:
        SCRATCH["module.js"] = file                        # outside: import game code as /site/games/...
        module = "/__scratch/module.js"
    report = open_page("/tests/run.html?report=1&module=" + urllib.parse.quote(module), args.timeout)
    return print_report(report, "run")


# ---------------------------------------------------------------------- lint
#
# Three kinds of check, all plain text matching:
#   structure   every game has the files the contract asks for
#   code rules  relative URLs only, no HTML parsing, pure logic.js, imports stay in bounds
#   public      this repo is public, so only example values may appear: example IPs,
#               the example account id, example.com hostnames. It is an allow-list:
#               anything that looks like a real address, id, host, key or email fails.

GAME_FILES = ("index.html", "style.css", "logic.js", "main.js")
DATA_FILES = ("levels.js", "presets.js")
TEXT_SUFFIXES = {".html", ".css", ".js", ".mjs", ".py", ".md", ".yml", ".yaml", ".json", ".txt", ".svg", ""}
SKIP_DIRS = {".git", ".out", "__pycache__", "node_modules"}

ALLOWED_NETWORKS = [ipaddress.ip_network(net) for net in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",        # private ranges
    "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24",    # reserved for documentation
    "127.0.0.0/8", "169.254.0.0/16", "0.0.0.0/32", "255.255.255.255/32",
    "8.8.8.8/32", "8.8.4.4/32", "1.1.1.1/32",               # well-known public DNS resolvers
)]
EXAMPLE_HOSTS = ("example.com", "example.org", "example.net")
# Hostnames that may be mentioned anywhere (documentation and tool names, never infrastructure).
DOC_HOSTS = ("github.com", "github.io", "amazon.com", "kubernetes.io", "mozilla.org",
             "nodejs.org", "python.org", "w3.org", "chromium.org", "rfc-editor.org", "ietf.org")
# Hosts that pages under site/ may actually link to.
SITE_LINK_HOSTS = EXAMPLE_HOSTS + ("www.w3.org", "github.com", "localhost", "127.0.0.1")
ALLOWED_EMAIL_DOMAINS = EXAMPLE_HOSTS + ("users.noreply.github.com",)
EXAMPLE_ACCOUNT_ID = "123456789012"

RE_IPV4 = re.compile(r"(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w]|\.\d)")
RE_12_DIGITS = re.compile(r"(?<![\w.#-])\d{12}(?!\w)")
RE_HOST = re.compile(r"(?<![\w@-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|ai|cloud))(?![\w-])", re.I)
RE_EMAIL = re.compile(r"[\w.+-]+@((?:[\w-]+\.)+[A-Za-z]{2,})")
RE_AWS_ID = re.compile(r"\b(?:vpc|subnet|sg|igw|nat|rtb|eni|ami|vol|snap|pcx|tgw|acl|eipalloc|i)-[0-9a-f]{8,17}\b")
RE_SECRET = re.compile(r"A[KS]IA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}")
RE_URL = re.compile(r"https?://([^/\s\"'`)<>\\]+)", re.I)
RE_ROOT_URL = re.compile(r"""(?:\b(?:src|href|action)\s*=\s*["']/(?!/)|url\(\s*["']?/(?!/)|\bfrom\s+["']/|\bimport\s*\(?\s*["']/)""")
RE_HTML_SINK = re.compile(r"\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write")
RE_IMPORT = re.compile(r"""(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']""")
RE_IMPURE = re.compile(r"\b(?:document|window|localStorage|sessionStorage|navigator|setTimeout|setInterval|"
                       r"requestAnimationFrame|fetch|Date|performance)\b|Math\.random")
RE_COMMENT = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)


def ends_with_host(host, allowed):
    host = host.lower().split(":")[0]
    return any(host == name or host.endswith("." + name) for name in allowed)


def public_problems(line):
    """Things on one line that do not look like example values."""
    found = []
    for match in RE_IPV4.finditer(line):
        octets = [int(part) for part in match.groups()]
        if max(octets) > 255:
            continue                                   # a version number, not an address
        address = ipaddress.ip_address(match.group(0))
        if not any(address in net for net in ALLOWED_NETWORKS):
            found.append(f"{match.group(0)} is not an example address (use 10.x, 192.0.2.x, 198.51.100.x or 203.0.113.x)")
    for match in RE_12_DIGITS.finditer(line):
        if match.group(0) != EXAMPLE_ACCOUNT_ID:
            found.append(f"{match.group(0)} looks like an account id (use {EXAMPLE_ACCOUNT_ID})")
    for match in RE_HOST.finditer(line):
        if not ends_with_host(match.group(1), EXAMPLE_HOSTS + DOC_HOSTS):
            found.append(f"{match.group(1)} looks like a real hostname (use example.com)")
    for match in RE_EMAIL.finditer(line):
        if not ends_with_host(match.group(1), ALLOWED_EMAIL_DOMAINS):
            found.append(f"{match.group(0)} looks like a real email address")
    for match in RE_AWS_ID.finditer(line):
        found.append(f"{match.group(0)} looks like a real resource id (use a readable one such as sg-web)")
    if RE_SECRET.search(line):
        found.append("this looks like a secret or key")
    return found


def code_problems(path, text, in_game):
    """Rules for files under site/: (line number, message) pairs."""
    found = []
    is_js = path.suffix == ".js"
    for number, line in enumerate(text.splitlines(), 1):
        if RE_ROOT_URL.search(line):
            found.append((number, "a URL starts with / (use a relative path: the site is served from a subfolder)"))
        for match in RE_URL.finditer(line):
            if not ends_with_host(match.group(1), SITE_LINK_HOSTS):
                found.append((number, f"link to {match.group(1)} (pages must not load or link outside files)"))
        if is_js and RE_HTML_SINK.search(line):
            found.append((number, "builds the page from an HTML string (use el() from shared/shell.js instead)"))
        if is_js and in_game:
            for match in RE_IMPORT.finditer(line):
                target = match.group(1)
                if not (target.startswith("./") or target.startswith("../../shared/")):
                    found.append((number, f'import "{target}" (a game may import only from ./ and ../../shared/)'))
    if path.name == "logic.js":
        bare = RE_COMMENT.sub(lambda m: "\n" * m.group(0).count("\n"), text)   # keep line numbers
        for number, line in enumerate(bare.splitlines(), 1):
            match = RE_IMPURE.search(line)
            if match:
                found.append((number, f"logic.js uses {match.group(0)} (rules must be pure: no page, clock, storage or randomness)"))
    return found


def text_files(folder):
    for path in sorted(folder.rglob("*")):
        if path.is_file() and path.suffix in TEXT_SUFFIXES and not (set(path.relative_to(ROOT).parts) & SKIP_DIRS):
            yield path


def listed_games():
    """Ids listed in site/games.js, read with a plain text match."""
    text = (SITE / "games.js").read_text(encoding="utf-8") if (SITE / "games.js").is_file() else ""
    return re.findall(r"""\bid:\s*["']([^"']+)["']""", RE_COMMENT.sub("", text))


def cmd_lint(args):
    problems = []
    folders = sorted(p.name for p in (SITE / "games").iterdir() if p.is_dir())
    slugs = args.slugs or folders
    unknown = [slug for slug in slugs if slug not in folders]
    if unknown:
        print("lint: no such game folder: " + ", ".join(unknown))
        return 2

    # 1. structure
    for slug in slugs:
        game = SITE / "games" / slug
        for name in GAME_FILES:
            if not (game / name).is_file():
                problems.append(f"site/games/{slug}/{name}: missing")
        if sum((game / name).is_file() for name in DATA_FILES) != 1:
            problems.append(f"site/games/{slug}/: needs exactly one of {' or '.join(DATA_FILES)}")
        if not (TESTS / f"{slug}.test.js").is_file():
            problems.append(f"tests/{slug}.test.js: missing")
    listed = listed_games()
    if not args.slugs:
        for game_id in listed:
            if game_id not in folders:
                problems.append(f"site/games.js: lists '{game_id}' but site/games/{game_id}/ does not exist")
        if len(listed) != len(set(listed)):
            problems.append("site/games.js: the same id is listed twice")
        hidden = [slug for slug in folders if slug not in listed and not slug.startswith("_")]
        if hidden:
            print("note: not on the hub (no line in site/games.js): " + ", ".join(hidden))

    # 2. code rules, and 3. example values only
    if args.slugs:
        files = [path for slug in slugs for path in text_files(SITE / "games" / slug)]
        files += [TESTS / f"{slug}.test.js" for slug in slugs if (TESTS / f"{slug}.test.js").is_file()]
    else:
        files = list(text_files(ROOT))
    for path in files:
        where = path.relative_to(ROOT).as_posix()
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            problems.append(f"{where}: not valid UTF-8 text")
            continue
        if where.startswith("site/"):
            in_game = where.startswith("site/games/")
            problems += [f"{where}:{number}: {message}" for number, message in code_problems(path, text, in_game)]
        for number, line in enumerate(text.splitlines(), 1):
            problems += [f"{where}:{number}: {message}" for message in public_problems(line)]

    for problem in problems:
        print(problem)
    print(f"lint: {len(files)} files checked, {len(problems)} problem{'' if len(problems) == 1 else 's'}")
    return 1 if problems else 0


def cmd_check(args):
    for name, command in (("lint", cmd_lint), ("test", cmd_test), ("smoke", cmd_smoke)):
        print(f"== {name}")
        code = command(args)
        if code != 0:
            print(f"check: {name} failed")
            return code
    print("check: all good")
    return 0


def main():
    parser = argparse.ArgumentParser(description="The one tool for the arcade repo.")
    commands = parser.add_subparsers(dest="command", required=True)

    preview = commands.add_parser("preview", help="serve the repo locally")
    preview.add_argument("--port", type=int, default=8000)
    preview.set_defaults(run=cmd_preview)

    for name, function, text in (
        ("test", cmd_test, "run logic tests in headless Chrome"),
        ("smoke", cmd_smoke, "load pages and fail on errors"),
        ("shots", cmd_shots, "take screenshots"),
        ("lint", cmd_lint, "structure and example-values checks"),
        ("check", cmd_check, "lint + test + smoke"),
    ):
        sub = commands.add_parser(name, help=text)
        sub.add_argument("slugs", nargs="*", help="game folder names; default is everything")
        sub.add_argument("--timeout", type=int, default=120, help="seconds to wait for the browser")
        if name == "shots":
            sub.add_argument("--light", action="store_true", help="take the light theme instead of the dark one")
        sub.set_defaults(run=function)

    run = commands.add_parser("run", help="run one JS module headless and print what it logs")
    run.add_argument("file")
    run.add_argument("--timeout", type=int, default=120)
    run.set_defaults(run=cmd_run)

    args = parser.parse_args()
    sys.exit(args.run(args))


if __name__ == "__main__":
    main()

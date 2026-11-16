// RULES for Escape Shell: a small pretend Linux host that you fix by typing commands.
// Pure: no page, no storage, no timers, no randomness. The tests run these rules directly.
//
// The page calls start(level) once, then apply(state, line) for every line typed.
// replay(level, lines) does the same from a list, so tests and the page follow one set of rules.
//
// Sections, in order:
//    1. Numbers and names you can tune
//    2. start, apply, replay, prompt        (what the page and the tests call)
//    3. Reading a command line              (quotes, pipes, > redirects, * wildcards)
//    4. Running a command line
//    5. Files and permissions
//    6. Disk space
//    7. Services, processes and the journal
//    8. Needs and goals                     (the vocabulary levels.js uses)
//    9. Small text helpers
//   10. The commands, one function each     (ls, cat, grep ... curl)
//   11. The command table, help and nudges
//   12. Tab completion
//
// To add a command: write a function in section 10 and add one line to COMMANDS in section 11.

// ============================================================================
// 1. Numbers and names you can tune
// ============================================================================

export const HOST = 'sample-host';
export const USER = 'ops';
const HOME = '/home/ops';
const HOST_IP = '10.0.0.5';                // the address of sample-host itself
const CLIENT_IP = '198.51.100.7';          // where your SSH session comes from
const USER_GROUPS = ['ops', 'adm', 'sudo'];   // adm lets ops read the journal without sudo

// The pretend day. Everything in a scenario happens on this one morning.
const SIM_DAY = { stamp: 'Nov 16', iso: '2026-11-16', weekday: 'Mon', zone: 'UTC' };
const OLD_MTIME = 'Nov 12 08:30';          // "last changed" time of files that were already there
const OLD_START = 'Nov12';                 // START column in ps for long-running processes
const BOOT_CLOCK = 9 * 3600 + 10 * 60 + 41;   // 09:10:41, when the services tried to start
const LOGIN_DELAY = 200;                   // seconds between that and your first prompt
const SECONDS_PER_COMMAND = 8;             // the clock moves on this much for every line you run

const BOOT_FIRST_PID = 1180;               // process ids handed out while the host boots
const BOOT_PID_STEP = 23;
const FIRST_PID = 2290;                    // process ids handed out once you are logged in
const MEMORY_KB = 4017292;                 // RAM of the host, for the %MEM column in ps
const STATUS_LOG_LINES = 10;               // journal lines shown under systemctl status
const DEFAULT_LINES = 10;                  // head, tail and journalctl -n with no number

// Folders every scenario has: [path, owner, mode].
const BASE_DIRS = [
  ['/', 'root', '755'], ['/dev', 'root', '755'], ['/etc', 'root', '755'],
  ['/etc/systemd', 'root', '755'], ['/etc/systemd/system', 'root', '755'],
  ['/home', 'root', '755'], [HOME, USER, '750'], ['/opt', 'root', '755'],
  ['/run', 'root', '755'], ['/tmp', 'root', '1777'], ['/usr', 'root', '755'],
  ['/var', 'root', '755'], ['/var/lib', 'root', '755'], ['/var/log', 'root', '755'],
];

// Processes every scenario has.
const BASE_PROCS = [
  { pid: 1, user: 'root', cmd: '/sbin/init', comm: 'systemd', vsz: 167744, rss: 11520, stat: 'Ss', time: '0:04', locked: true },
  { pid: 2, user: 'root', cmd: '[kthreadd]', comm: 'kthreadd', vsz: 0, rss: 0, stat: 'S', locked: true },
  { pid: 312, user: 'root', cmd: '/usr/lib/systemd/systemd-journald', comm: 'systemd-journal', vsz: 66820, rss: 16384, stat: 'Ss', time: '0:01', locked: true },
  { pid: 842, user: 'root', cmd: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', comm: 'sshd', vsz: 12020, rss: 7936, stat: 'Ss', port: 22, bind: '0.0.0.0', banner: true, locked: true },
  { pid: 2101, user: 'root', cmd: 'sshd: ops [priv]', comm: 'sshd', vsz: 14996, rss: 10240, stat: 'Ss', start: 'login', ppid: 842, locked: true },
  { pid: 2117, user: USER, cmd: 'sshd: ops@pts/0', comm: 'sshd', vsz: 15156, rss: 6912, stat: 'S', start: 'login', ppid: 2101, locked: true },
  { pid: 2118, user: USER, cmd: '-bash', comm: 'bash', vsz: 8660, rss: 5376, stat: 'Ss', tty: 'pts/0', start: 'login', ppid: 2117, locked: true },
];

// Memory-backed filesystems that df always lists: [device, size KB, used KB, mount point].
const TMPFS_BEFORE = [['tmpfs', 401732, 1100, '/run']];
const TMPFS_AFTER = [
  ['tmpfs', 2008644, 0, '/dev/shm'],
  ['tmpfs', 5120, 0, '/run/lock'],
  ['tmpfs', 401728, 4, '/run/user/1000'],
];

// Port names that ss prints when you leave out -n.
const PORT_NAMES = { 22: 'ssh', 80: 'http', 443: 'https', 5432: 'postgresql', 8080: 'http-alt' };

const NO_FILE = 'No such file or directory';
const NO_ENTRY = 'Permission denied';

// ============================================================================
// 2. start, apply, replay, prompt
// ============================================================================

// The state at the start of a scenario: the files, the processes, and services that
// have already tried to start (so the journal holds the clue before you type anything).
export function start(level) {
  const state = {
    level,
    status: 'playing',
    cwd: HOME,
    oldCwd: HOME,
    clock: BOOT_CLOCK,          // seconds since midnight of the pretend day
    nextPid: BOOT_FIRST_PID,
    nodes: {},                  // path -> file or folder
    procs: [],                  // running processes
    units: {},                  // service name -> its current state
    journal: [],                // every log line, oldest first
    count: 0,                   // how many commands have been run
    output: [],                 // what the last command printed: [{ text, kind: 'out' | 'err' }]
    code: 0,                    // exit code of the last command
    clear: false,               // true when the last command was `clear`
    answered: null,             // the service that answered the last curl, if any
  };
  buildFiles(state);
  buildProcesses(state);
  bootServices(state);
  state.clock += LOGIN_DELAY;
  state.nextPid = FIRST_PID;
  addLog(state, '', 'sshd[2101]', `Accepted publickey for ${USER} from ${CLIENT_IP} port 51234 ssh2`);
  return state;
}

// The one way state changes: run one typed line. Returns a new state; the old one is untouched.
export function apply(state, line) {
  if (state.status !== 'playing') return state;
  const next = copyState(state);
  next.output = [];
  next.clear = false;
  next.answered = null;
  if (String(line).trim() === '') return next;

  next.count += 1;
  next.clock += SECONDS_PER_COMMAND;
  try {
    next.code = runLine(next, String(line));
  } catch (error) {
    if (!(error instanceof ShellError)) throw error;
    show(next, error.message + '\n', 'err');
    next.code = error.code;
  }
  for (const entry of next.output) delete entry.open;
  if (goalHolds(next)) next.status = 'won';
  return next;
}

// Run a whole list of lines from the start. Returns the final state.
export function replay(level, lines) {
  let state = start(level);
  for (const line of lines) state = apply(state, line);
  return state;
}

// Stars for a finished scenario: three, minus one for each hint read, but a win always
// earns at least one. Hints are not commands, so the page counts them and passes the number.
export function stars(state, hintsUsed) {
  if (state.status !== 'won') return 0;
  return Math.max(1, 3 - hintsUsed);
}

// The text in front of the cursor, e.g. "ops@sample-host:~$ ".
export function prompt(state) {
  let where = state.cwd;
  if (where === HOME) where = '~';
  else if (where.startsWith(HOME + '/')) where = '~' + where.slice(HOME.length);
  return `${USER}@${HOST}:${where}$ `;
}

function copyState(state) {
  const deep = (value) => JSON.parse(JSON.stringify(value));
  return {
    ...state,
    nodes: deep(state.nodes),
    procs: deep(state.procs),
    units: deep(state.units),
    journal: deep(state.journal),
  };
}

// An error the shell itself reports, such as a syntax error.
class ShellError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// ============================================================================
// 3. Reading a command line
// ============================================================================

// An unquoted * or ? is stored as one of these marks, so that a quoted '*' stays a plain star.
const STAR = '\u0001';
const ANY_ONE = '\u0002';
const OPERATORS = ['2>&1', '2>>', '2>', '>>', '>', '&&', '||', '|', ';'];
const CONTROL = ['|', '&&', '||', ';'];

// Cut a line into words and operators.  echo "a b" | wc -l  ->  echo, "a b", |, wc, -l
function tokenize(line, vars) {
  const tokens = [];
  let word = null;       // the word being built, or null between words
  let i = 0;
  const endWord = () => {
    if (word !== null) tokens.push({ word });
    word = null;
  };

  while (i < line.length) {
    const ch = line[i];
    const rest = line.slice(i);
    if (ch === ' ' || ch === '\t') { endWord(); i += 1; continue; }
    if (ch === '#' && word === null) break;                       // a comment
    const op = OPERATORS.find((o) => rest.startsWith(o) && (o[0] !== '2' || word === null));
    if (op) { endWord(); tokens.push({ op }); i += op.length; continue; }
    if ('<&()`'.includes(ch) || rest.startsWith('$(')) {
      throw new ShellError(`bash: the simulator's shell does not do "${ch}". It has pipes (|), > and >>, && and ;`, 2);
    }

    if (word === null) word = '';
    if (ch === '\\') {
      word += line[i + 1] || '';
      i += 2;
    } else if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) throw new ShellError("bash: unexpected EOF while looking for matching `''", 2);
      word += line.slice(i + 1, end);
      i = end + 1;
    } else if (ch === '"') {
      const read = readDoubleQuoted(line, i + 1, vars);
      word += read.text;
      i = read.next;
    } else if (ch === '$') {
      const read = readVariable(line, i, vars);
      word += read.text;
      i = read.next;
    } else if (ch === '~' && word === '' && (i + 1 === line.length || ' /'.includes(line[i + 1]))) {
      word += HOME;
      i += 1;
    } else {
      word += ch === '*' ? STAR : ch === '?' ? ANY_ONE : ch;
      i += 1;
    }
  }
  endWord();
  return tokens;
}

// Reads up to the closing double quote. Inside, only \" \\ \$ and $NAME are special.
function readDoubleQuoted(line, from, vars) {
  let text = '';
  let i = from;
  while (i < line.length && line[i] !== '"') {
    if (line[i] === '\\' && '"\\$`'.includes(line[i + 1] || ' ')) {
      text += line[i + 1];
      i += 2;
    } else if (line[i] === '$') {
      const read = readVariable(line, i, vars);
      text += read.text;
      i = read.next;
    } else {
      text += line[i];
      i += 1;
    }
  }
  if (i >= line.length) throw new ShellError('bash: unexpected EOF while looking for matching `"\'', 2);
  return { text, next: i + 1 };
}

// Reads $? or $NAME starting at the dollar sign. An unknown name becomes nothing, as in bash.
function readVariable(line, at, vars) {
  if (line[at + 1] === '?') return { text: vars['?'], next: at + 2 };
  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(at + 1));
  if (!name) return { text: '$', next: at + 1 };
  return { text: vars[name[0]] || '', next: at + 1 + name[0].length };
}

// Group the tokens.  a | b > f && c   ->   [ { joiner: ';', stages: [a, b > f] }, { joiner: '&&', stages: [c] } ]
// A stage is one command: { words: [...], redirects: [{ op, target }] }.
function parseLine(tokens) {
  const newStage = () => ({ words: [], redirects: [] });
  const steps = [];
  let step = { joiner: ';', stages: [newStage()] };
  let waiting = null;          // a > or >> that still needs its file name

  for (const token of tokens) {
    const stage = step.stages[step.stages.length - 1];
    if (waiting) {
      if (token.op) throw syntaxError(token.op);
      stage.redirects.push({ op: waiting, target: plainWord(token.word) });
      waiting = null;
    } else if (token.op === '2>&1') {
      stage.redirects.push({ op: token.op, target: '' });
    } else if (CONTROL.includes(token.op)) {
      if (stage.words.length === 0) throw syntaxError(token.op);
      if (token.op === '|') {
        step.stages.push(newStage());
      } else {
        steps.push(step);
        step = { joiner: token.op, stages: [newStage()] };
      }
    } else if (token.op) {
      waiting = token.op;
    } else {
      stage.words.push(token.word);
    }
  }

  if (waiting) throw syntaxError('newline');
  const last = step.stages[step.stages.length - 1];
  const emptyTail = step.stages.length === 1 && last.words.length === 0 && last.redirects.length === 0;
  if (emptyTail && step.joiner === ';') return steps;            // "ls;" is fine
  if (last.words.length === 0) throw new ShellError('bash: syntax error: unexpected end of file', 2);
  steps.push(step);
  return steps;
}

function syntaxError(token) {
  return new ShellError(`bash: syntax error near unexpected token \`${token}'`, 2);
}

function hasWildcard(word) {
  return word.includes(STAR) || word.includes(ANY_ONE);
}

// Turn the marks back into the characters that were typed.
function plainWord(word) {
  return word.split(STAR).join('*').split(ANY_ONE).join('?');
}

// /var/log/*  ->  every matching path, sorted. A pattern that matches nothing stays as typed.
// The shell expands wildcards as you (ops), before sudo runs, so a folder that ops
// cannot list matches nothing even under sudo. Real shells behave the same way.
function expandWord(state, word) {
  if (!hasWildcard(word)) return [word];
  let found = [{ real: word.startsWith('/') ? '/' : state.cwd, typed: word.startsWith('/') ? '/' : '' }];
  for (const part of word.split('/').filter(Boolean)) {
    found = found.flatMap((at) => matchPart(state, at, part));
  }
  return found.length > 0 ? found.map((at) => at.typed) : [plainWord(word)];
}

// One step of a wildcard match: which entries of folder `at` fit this part of the pattern?
function matchPart(state, at, part) {
  const typed = (name) => (at.typed === '' || at.typed.endsWith('/') ? at.typed + name : `${at.typed}/${name}`);
  if (!hasWildcard(part)) {
    const real = normalize(`${at.real}/${part}`);
    return state.nodes[real] ? [{ real, typed: typed(part) }] : [];
  }
  const folder = state.nodes[at.real];
  if (!folder || !folder.dir || !allowed(folder, USER, 'r')) return [];
  const pattern = new RegExp('^' + part.split('').map(wildcardToRegExp).join('') + '$');
  return childNames(state, at.real)
    .filter((name) => pattern.test(name) && (!name.startsWith('.') || part.startsWith('.')))
    .map((name) => ({ real: normalize(`${at.real}/${name}`), typed: typed(name) }));
}

function wildcardToRegExp(ch) {
  if (ch === STAR) return '.*';
  if (ch === ANY_ONE) return '.';
  return escapeRegExp(ch);
}

// ============================================================================
// 4. Running a command line
// ============================================================================

function runLine(state, line) {
  const vars = { '?': String(state.code), HOME, USER, PWD: state.cwd, HOSTNAME: HOST };
  let code = state.code;
  for (const step of parseLine(tokenize(line, vars))) {
    if (step.joiner === '&&' && code !== 0) continue;
    if (step.joiner === '||' && code === 0) continue;
    code = runPipeline(state, step.stages);
  }
  return code;
}

// Run  a | b | c : each command's output becomes the next one's input.
// The exit code is the last command's, as in bash.
function runPipeline(state, rawStages) {
  const stages = rawStages.map((stage) => ({
    ...stage,
    words: stage.words.flatMap((word) => expandWord(state, word)),
    pid: state.nextPid++,
  }));
  let stdin = null;        // null means "the keyboard": nothing was piped in
  let code = 0;
  stages.forEach((stage, index) => {
    const last = index === stages.length - 1;
    const ctx = {
      state,
      user: USER,                       // sudo changes this to root
      stdin,
      chunks: [],                       // what the command prints, in order
      pid: stage.pid,
      tty: last && !stage.redirects.some((r) => r.op === '>' || r.op === '>>'),
      peers: stages.filter((other) => other !== stage),
    };
    code = runStage(ctx, stage);
    stdin = deliver(state, ctx, stage, last);
  });
  return code;
}

// The shell opens > files before the command starts, and it opens them as you, not as root.
// That is why `sudo echo x > /etc/file` fails on a real host too.
function runStage(ctx, stage) {
  for (const redirect of stage.redirects) {
    if (redirect.op === '2>&1') continue;
    const problem = writeFile(ctx.state, redirect.target, USER, '', redirect.op.endsWith('>>'));
    if (problem) {
      printErr(ctx, `bash: ${redirect.target}: ${problem}`);
      return 1;
    }
  }
  return runCommand(ctx, stage.words);
}

// Send what a command printed to the right place: a file, the next command, or the screen.
function deliver(state, ctx, stage, last) {
  const target = (ops) => (stage.redirects.find((r) => ops.includes(r.op)) || {}).target;
  const outFile = target(['>', '>>']);
  const errFile = target(['2>', '2>>']);
  const merge = stage.redirects.some((r) => r.op === '2>&1');
  let piped = '';
  for (const chunk of ctx.chunks) {
    const isErr = chunk.kind === 'err' && !merge;
    const file = isErr ? errFile : outFile;
    if (file) writeFile(state, file, USER, chunk.text, true);
    else if (isErr || last) show(state, chunk.text, isErr ? 'err' : 'out');
    else piped += chunk.text;
  }
  return last ? null : piped;
}

// Add text to the screen output, one entry per line.
function show(state, text, kind) {
  const lines = text.split('\n');
  const endsWithNewline = lines[lines.length - 1] === '';
  if (endsWithNewline) lines.pop();
  lines.forEach((line, index) => {
    const previous = state.output[state.output.length - 1];
    if (index === 0 && previous && previous.open && previous.kind === kind) previous.text += line;
    else state.output.push({ text: line, kind });
  });
  const lastEntry = state.output[state.output.length - 1];
  if (lastEntry) lastEntry.open = !endsWithNewline;     // an unfinished line: more text may follow
}

// Commands call these two to print. `text` for print() carries its own newlines.
function print(ctx, text) {
  if (text !== '') ctx.chunks.push({ kind: 'out', text });
}
function printErr(ctx, line) {
  ctx.chunks.push({ kind: 'err', text: line + '\n' });
}

// Look the first word up in the command table, handling sudo on the way.
function runCommand(ctx, words) {
  let [name, ...args] = words;
  let viaSudo = false;
  while (name === 'sudo') {
    const after = readSudo(ctx, args);
    if (!after) return 1;
    [name, ...args] = after;
    viaSudo = true;
  }
  const command = COMMANDS[name];
  if (!command || (viaSudo && SHELL_BUILTINS.includes(name))) return notFound(ctx, name, viaSudo);
  if (args.includes('--help')) {
    print(ctx, `Usage in this simulator: ${COMMANDS[name].usage}\n`);
    return 0;
  }
  return command.run(ctx, args);
}

// sudo [-u USER] COMMAND...   Sets ctx.user and returns the command words, or null after an error.
function readSudo(ctx, args) {
  let words = args;
  ctx.user = 'root';
  if (words[0] === '-u' && words.length > 1) {
    if (!knownUsers(ctx.state).includes(words[1])) {
      printErr(ctx, `sudo: unknown user ${words[1]}`);
      return null;
    }
    ctx.user = words[1];
    words = words.slice(2);
  }
  if (words.length === 0) {
    printErr(ctx, 'usage: sudo [-u user] command');
    return null;
  }
  if (['-i', '-s', 'su', 'bash', 'sh'].includes(words[0])) {
    printErr(ctx, 'sudo: there is no root shell in this simulator. Put sudo in front of the one command that needs it.');
    return null;
  }
  return words;
}

function knownUsers(state) {
  const users = new Set(['root', USER]);
  for (const node of Object.values(state.nodes)) users.add(node.owner);
  for (const proc of state.procs) users.add(proc.user);
  for (const def of Object.values(state.level.services || {})) users.add(def.user);
  return [...users];
}

// ============================================================================
// 5. Files and permissions
// ============================================================================
//
// state.nodes maps a full path to a node:
//   a folder  { dir: true, mode, owner, group, mtime }
//   a file    { text, mode, owner, group, mtime, sizeMb }
// mode is the octal text you would give chmod, e.g. '644'. sizeMb is optional: it makes a
// file count as that many megabytes for ls, du and df while `text` stays a short sample.

function buildFiles(state) {
  for (const [path, owner, mode] of BASE_DIRS) {
    state.nodes[path] = { dir: true, mode, owner, group: owner, mtime: OLD_MTIME };
  }
  state.nodes['/dev/null'] = { text: '', mode: '666', owner: 'root', group: 'root', mtime: OLD_MTIME, device: true };
  addFile(state, '/etc/hostname', `${HOST}\n`);
  for (const [name, def] of Object.entries(state.level.services || {})) addServiceFiles(state, name, def);
  for (const [path, entry] of Object.entries(state.level.files || {})) addFile(state, path, entry);
}

// One entry from a level's `files`. A path ending in / is a folder.
function addFile(state, rawPath, entry) {
  const given = typeof entry === 'string' ? { text: entry } : entry;
  const isDir = rawPath.endsWith('/') && rawPath !== '/';
  const path = normalize(rawPath);
  addParents(state, path);
  const owner = given.owner || 'root';
  const node = { mode: given.mode || (isDir ? '755' : '644'), owner, group: given.group || owner, mtime: given.mtime || OLD_MTIME };
  if (isDir) node.dir = true;
  else node.text = given.text || '';
  if (given.sizeMb) node.sizeMb = given.sizeMb;
  state.nodes[path] = node;
}

function addParents(state, path) {
  const parent = parentOf(path);
  if (state.nodes[parent]) return;
  addParents(state, parent);
  state.nodes[parent] = { dir: true, mode: '755', owner: 'root', group: 'root', mtime: OLD_MTIME };
}

// Every service gets a unit file and a program file, so ls and cat find what systemctl talks about.
function addServiceFiles(state, name, def) {
  addFile(state, `/etc/systemd/system/${name}.service`, unitFileText(def));
  addFile(state, def.exec.split(' ')[0], { text: '', mode: '755', sizeMb: 12 });
}

function unitFileText(def) {
  return [
    '[Unit]', `Description=${def.description}`, 'After=network.target', '',
    '[Service]', 'Type=notify', `User=${def.user}`, `ExecStart=${def.exec}`, '',
    '[Install]', 'WantedBy=multi-user.target', '',
  ].join('\n');
}

// "/var/log/../log/./x/" -> "/var/log/x"
function normalize(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/');
}

// A path as typed (maybe relative to the current folder) -> the full path.
function fullPath(state, path) {
  return normalize(path.startsWith('/') ? path : `${state.cwd}/${path}`);
}

function parentOf(path) {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

function baseName(path) {
  return path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1);
}

function joinPath(folder, name) {
  return folder.endsWith('/') ? folder + name : `${folder}/${name}`;
}

// The names directly inside a folder, sorted.
function childNames(state, folder) {
  const prefix = folder === '/' ? '/' : folder + '/';
  return Object.keys(state.nodes)
    .filter((path) => path !== '/' && path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    .map((path) => path.slice(prefix.length))
    .sort();
}

// May `user` read (r), write (w) or enter/run (x) this node? The usual owner, group, other rule.
function allowed(node, user, want) {
  const bit = { r: 4, w: 2, x: 1 }[want];
  const digits = node.mode.slice(-3);
  if (user === 'root') return want !== 'x' || Boolean(node.dir) || /[1357]/.test(digits);
  const groups = user === USER ? USER_GROUPS : [user];
  const which = user === node.owner ? 0 : groups.includes(node.group) ? 1 : 2;
  return (Number(digits[which]) & bit) !== 0;
}

// Find a path for a user. Returns { path, node, error }: error is '' or the text Linux
// would give ("No such file or directory", "Not a directory", "Permission denied").
function lookup(state, typed, user) {
  const path = fullPath(state, typed);
  let at = '/';
  for (const part of path.split('/').filter(Boolean)) {
    const folder = state.nodes[at];
    if (!folder) return { path, node: null, error: NO_FILE };
    if (!folder.dir) return { path, node: null, error: 'Not a directory' };
    if (!allowed(folder, user, 'x')) return { path, node: null, error: NO_ENTRY };
    at = joinPath(at, part);
  }
  const node = state.nodes[path] || null;
  return { path, node, error: node ? '' : NO_FILE };
}

// Read a file as a user. Returns { text, node, error }.
function readFile(state, typed, user) {
  const found = lookup(state, typed, user);
  if (found.error) return found;
  if (found.node.dir) return { ...found, error: 'Is a directory' };
  if (!allowed(found.node, user, 'r')) return { ...found, error: NO_ENTRY };
  return { ...found, text: found.node.text };
}

// Write or append to a file as a user, creating it if needed. Returns '' or the error text.
function writeFile(state, typed, user, text, append) {
  const found = lookup(state, typed, user);
  if (found.error && (found.error !== NO_FILE || !state.nodes[parentOf(found.path)])) return found.error;
  const stamp = `${SIM_DAY.stamp} ${clockText(state.clock).slice(0, 5)}`;
  if (found.node) {
    if (found.node.dir) return 'Is a directory';
    if (!allowed(found.node, user, 'w')) return NO_ENTRY;
    if (found.node.device) return '';                       // /dev/null swallows everything
    if (!append) delete found.node.sizeMb;                  // > empties the file first
    found.node.text = append ? found.node.text + text : text;
    found.node.mtime = stamp;
    return '';
  }
  if (!allowed(state.nodes[parentOf(found.path)], user, 'w')) return NO_ENTRY;
  const mode = user === 'root' ? '644' : '664';             // the usual default for new files
  state.nodes[found.path] = { text, mode, owner: user, group: user, mtime: stamp };
  return '';
}

// Delete a path and everything under it.
function removeTree(state, path) {
  for (const other of Object.keys(state.nodes)) {
    if (other === path || other.startsWith(path + '/')) delete state.nodes[other];
  }
}

// "-rw-r--r--" for ls -l.
function modeText(node) {
  const digits = node.mode.slice(-3);
  let text = node.dir ? 'd' : node.device ? 'c' : '-';
  for (const digit of digits) {
    const n = Number(digit);
    text += (n & 4 ? 'r' : '-') + (n & 2 ? 'w' : '-') + (n & 1 ? 'x' : '-');
  }
  const sticky = node.mode.length === 4 && node.mode[0] === '1';
  return sticky ? text.slice(0, -1) + 't' : text;
}

// ============================================================================
// 6. Disk space
// ============================================================================

function byteSize(node) {
  if (node.dir) return 4096;
  return (node.sizeMb || 0) * 1048576 + node.text.length;
}

// Space a node takes on disk, in KB. Disks hand out space in 4 KB blocks.
function blockKb(node) {
  return Math.ceil(byteSize(node) / 4096) * 4;
}

// The disk (an entry of level.disks) that a path lives on: the longest matching mount point.
function diskFor(state, path) {
  let best = null;
  for (const disk of state.level.disks) {
    const inside = disk.mount === '/' || path === disk.mount || path.startsWith(disk.mount + '/');
    if (inside && (!best || disk.mount.length > best.mount.length)) best = disk;
  }
  return best;
}

function usedKb(state, disk) {
  let kb = disk.osUsedMb * 1024;
  for (const [path, node] of Object.entries(state.nodes)) {
    if (diskFor(state, path) === disk) kb += blockKb(node);
  }
  return kb;
}

function freeKb(state, disk) {
  return Math.max(0, disk.sizeMb * 1024 - usedKb(state, disk));
}

// 1536 -> "1.5K". Rounds up, like ls -h, du -h and df -h do.
function human(bytes) {
  if (bytes < 1024) return String(bytes);
  const letters = 'KMGT';
  let unit = 1024;
  let letter = 0;
  while (bytes >= unit * 1024 && letter < 3) {
    unit *= 1024;
    letter += 1;
  }
  const tenths = Math.ceil((bytes * 10) / unit);
  if (tenths < 100) return (tenths / 10).toFixed(1) + letters[letter];
  const whole = Math.ceil(bytes / unit);
  if (whole >= 1024 && letter < 3) return '1.0' + letters[letter + 1];
  return whole + letters[letter];
}

// ============================================================================
// 7. Services, processes and the journal
// ============================================================================
//
// state.units[name] = { state: 'active' | 'failed' | 'inactive', result, pid, lastPid, exit, since }
// A service starts only when every entry in its `needs` holds. If one does not, that
// need's `log` text goes to the journal, exactly where a real service would complain.

function buildProcesses(state) {
  for (const proc of BASE_PROCS) state.procs.push({ ...proc });
  for (const proc of state.level.processes || []) {
    state.procs.push({ comm: baseName(proc.cmd.split(' ')[0]), vsz: 26180, rss: 18944, ...proc });
  }
}

function bootServices(state) {
  addLog(state, '', 'systemd[1]', 'Reached target network.target - Network.');
  for (const [name, def] of Object.entries(state.level.services || {})) {
    state.units[name] = { state: 'inactive', result: 'success', pid: 0, lastPid: 0, exit: '', since: null };
    if (def.state !== 'inactive') startUnit(state, name);
    state.nextPid += BOOT_PID_STEP;
  }
}

function addLog(state, unit, who, text) {
  state.journal.push({ t: state.clock, unit, who, text });
}

function journalLine(entry) {
  return `${SIM_DAY.stamp} ${clockText(entry.t)} ${HOST} ${entry.who}: ${entry.text}`;
}

// The short program name, as ps and ss show it: "/opt/sample-app/bin/sample-app --x" -> "sample-app"
function commName(def) {
  return baseName(def.exec.split(' ')[0]).slice(0, 15);
}

function bindOf(thing) {
  return thing.bind || '0.0.0.0';
}

// Try to start a service. Returns true if it is now running.
function startUnit(state, name) {
  const def = state.level.services[name];
  const title = `${name}.service - ${def.description}`;
  const pid = state.nextPid++;
  const who = `${commName(def)}[${pid}]`;
  addLog(state, name, 'systemd[1]', `Starting ${title}...`);

  const need = unmetNeed(state, name);
  if (need) {
    for (const line of [].concat(need.log)) addLog(state, name, who, line);
    addLog(state, name, 'systemd[1]', `${name}.service: Main process exited, code=exited, status=1/FAILURE`);
    addLog(state, name, 'systemd[1]', `${name}.service: Failed with result 'exit-code'.`);
    addLog(state, name, 'systemd[1]', `Failed to start ${title}.`);
    state.units[name] = { state: 'failed', result: 'exit-code', pid: 0, lastPid: pid, exit: 'code=exited, status=1/FAILURE', since: state.clock };
    return false;
  }

  addLog(state, name, who, def.startLog || `listening on ${bindOf(def)}:${def.port}`);
  addLog(state, name, 'systemd[1]', `Started ${title}.`);
  state.procs.push({
    pid, user: def.user, cmd: def.exec, comm: commName(def), unit: name, stat: 'Ssl',
    port: def.port, bind: bindOf(def), response: def.response, vsz: 1238292, rss: 18432,
    start: clockText(state.clock).slice(0, 5),
  });
  if (def.lockFile) writeFile(state, def.lockFile, def.user, `${pid}\n`, false);
  state.units[name] = { state: 'active', result: 'success', pid, lastPid: pid, exit: '', since: state.clock };
  return true;
}

// Stop a running service. how: 'stop' (systemctl), 'term' (kill) or 'kill' (kill -9).
function stopUnit(state, name, how) {
  const def = state.level.services[name];
  const unit = state.units[name];
  const title = `${name}.service - ${def.description}`;
  state.procs = state.procs.filter((proc) => proc.pid !== unit.pid);

  if (how === 'kill') {
    // Killed outright: no chance to tidy up, so a lock file stays behind.
    addLog(state, name, 'systemd[1]', `${name}.service: Main process exited, code=killed, status=9/KILL`);
    addLog(state, name, 'systemd[1]', `${name}.service: Failed with result 'signal'.`);
    state.units[name] = { ...unit, state: 'failed', result: 'signal', pid: 0, exit: 'code=killed, signal=KILL', since: state.clock };
    return;
  }
  if (how === 'stop') addLog(state, name, 'systemd[1]', `Stopping ${title}...`);
  addLog(state, name, 'systemd[1]', `${name}.service: Deactivated successfully.`);
  if (how === 'stop') addLog(state, name, 'systemd[1]', `Stopped ${title}.`);
  if (def.lockFile) removeTree(state, def.lockFile);
  state.units[name] = { ...unit, state: 'inactive', result: 'success', pid: 0, exit: 'code=exited, status=0/SUCCESS', since: state.clock };
}

// Deliver a signal to a process: 'TERM' asks it to stop, 'KILL' stops it outright.
function signalProcess(state, proc, signal) {
  if (proc.unit) stopUnit(state, proc.unit, signal === 'KILL' ? 'kill' : 'term');
  else state.procs = state.procs.filter((other) => other.pid !== proc.pid);
}

// Who is listening on this port, for a client connecting to this address?
function listenerOn(state, address, port) {
  return state.procs.find((proc) => proc.port === port && (bindOf(proc) === '0.0.0.0' || bindOf(proc) === address));
}

// ============================================================================
// 8. Needs and goals
// ============================================================================
//
// A condition is an object with exactly one of the keys below (a need may also carry `log`).
// levels.js describes each one in plain words; this is where they are checked.

const CONDITIONS = {
  // [path, megabytes]: the disk holding `path` has at least that much free.
  diskFreeMb: (state, [path, mb]) => freeKb(state, diskFor(state, path)) >= mb * 1024,
  // [path, pattern]: some line of the file matches the pattern (written as for grep -E).
  fileMatches: (state, [path, pattern]) => {
    const node = state.nodes[path];
    return Boolean(node) && !node.dir && linesOf(node.text).some((line) => new RegExp(pattern).test(line));
  },
  // [path, user]: that user can open the file for reading.
  fileReadableBy: (state, [path, user]) => readFile(state, path, user).error === '',
  // path: no file or folder exists there.
  fileAbsent: (state, path) => !state.nodes[path],
  // port: nothing is listening on it.
  portFree: (state, port) => !state.procs.some((proc) => proc.port === port),
  // text: no running process has this text in its command line.
  processGone: (state, text) => !state.procs.some((proc) => proc.cmd.includes(text)),
  // name: that service is running.
  serviceActive: (state, name) => Boolean(state.units[name]) && state.units[name].state === 'active',
  // name: the command just run was a curl, and that service answered it.
  serviceAnswers: (state, name) => state.answered === name,
};

function holds(state, condition) {
  const key = Object.keys(condition).find((name) => name !== 'log');
  if (!CONDITIONS[key]) throw new Error(`level ${state.level.id}: unknown condition "${key}"`);
  return CONDITIONS[key](state, condition[key]);
}

// The first need of a service that does not hold, or undefined if it may start.
function unmetNeed(state, name) {
  return (state.level.services[name].needs || []).find((need) => !holds(state, need));
}

export function goalHolds(state) {
  return state.level.goal.every((condition) => holds(state, condition));
}

// ============================================================================
// 9. Small text helpers
// ============================================================================

const pad = (text, width) => String(text).padEnd(width);       // left-aligned
const lpad = (text, width) => String(text).padStart(width);    // right-aligned

// "a\nb\n" -> ['a', 'b']
function linesOf(text) {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ['a', 'b'] -> "a\nb\n"
function unlines(lines) {
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

// 33041 -> "09:10:41"
function clockText(seconds) {
  const two = (n) => String(n).padStart(2, '0');
  return `${two(Math.floor(seconds / 3600) % 24)}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}`;
}

// 201 -> "3min 21s", the way systemctl status writes "ago".
function agoText(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}min`;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// grep and sed patterns -> a JavaScript RegExp. Throws if the pattern is broken.
// Plain grep and sed treat + ? | ( ) { } as ordinary characters unless they have a
// backslash in front; with -E it is the other way round, which is how JavaScript works.
function toRegExp(pattern, { extended, fixed, ignoreCase, wholeWord, everyMatch }) {
  let source = pattern
    .split('[[:space:]]').join('\\s')
    .split('[[:digit:]]').join('\\d')
    .split('[[:alpha:]]').join('[A-Za-z]')
    .split('[[:alnum:]]').join('[A-Za-z0-9]');
  if (fixed) source = escapeRegExp(pattern);
  else if (!extended) source = basicToExtended(source);
  if (wholeWord) source = `\\b(?:${source})\\b`;
  return new RegExp(source, (ignoreCase ? 'i' : '') + (everyMatch ? 'g' : ''));
}

function basicToExtended(pattern) {
  const special = '+?|(){}';
  let result = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    const next = pattern[i + 1];
    if (ch === '\\' && next !== undefined) {
      result += special.includes(next) ? next : ch + next;
      i += 1;
    } else {
      result += special.includes(ch) ? '\\' + ch : ch;
    }
  }
  return result;
}

// Split ['-la', 'dir'] into { flags: { l: true, a: true }, rest: ['dir'] }.
// If a letter is not in `known`, the result has `bad` set to it.
function splitFlags(args, known) {
  const flags = {};
  const rest = [];
  let open = true;
  for (const arg of args) {
    if (open && arg === '--') {
      open = false;
    } else if (open && arg.startsWith('--')) {
      return { flags, rest, bad: arg };
    } else if (open && arg.startsWith('-') && arg.length > 1) {
      for (const letter of arg.slice(1)) {
        if (!known.includes(letter)) return { flags, rest, bad: '-' + letter };
        flags[letter] = true;
      }
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

// The reply to an option this simulator does not have. Honest rather than a fake error.
function badOption(ctx, name, option) {
  printErr(ctx, `${name}: the simulator does not have option ${option}. Here: ${COMMANDS[name].usage}`);
  return 2;
}

// Read the files a command was given, or what was piped in when there are none.
// Returns { sources: [{ name, text, node }], failed } or null when there is nothing to read.
function readInputs(ctx, name, paths) {
  if (paths.length === 0) {
    if (ctx.stdin === null) {
      printErr(ctx, `${name}: nothing to read. Give a file name, or pipe something in.`);
      return null;
    }
    return { sources: [{ name: '', text: ctx.stdin, node: null }], failed: false };
  }
  const sources = [];
  let failed = false;
  for (const path of paths) {
    const read = readFile(ctx.state, path, ctx.user);
    if (read.error) {
      printErr(ctx, `${name}: ${path}: ${read.error}`);
      failed = true;
    } else {
      sources.push({ name: path, text: read.text, node: read.node });
    }
  }
  return { sources, failed };
}

// ============================================================================
// 10. The commands
// ============================================================================
//
// Every command is  function (ctx, args) -> exit code.
//   ctx.state   the world, which the command may change
//   ctx.user    who is running it: 'ops', or 'root' under sudo
//   ctx.stdin   text piped in, or null
//   print(ctx, text) / printErr(ctx, line)   write to the screen or the pipe

// ---------------------------------------------------------------- pwd, cd, echo

function cmdPwd(ctx) {
  print(ctx, ctx.state.cwd + '\n');
  return 0;
}

function cmdCd(ctx, args) {
  if (args.length > 1) {
    printErr(ctx, 'bash: cd: too many arguments');
    return 1;
  }
  const target = args[0] === undefined ? HOME : args[0] === '-' ? ctx.state.oldCwd : args[0];
  const found = lookup(ctx.state, target, ctx.user);
  let problem = found.error;
  if (!problem && !found.node.dir) problem = 'Not a directory';
  if (!problem && !allowed(found.node, ctx.user, 'x')) problem = NO_ENTRY;
  if (problem) {
    printErr(ctx, `bash: cd: ${target}: ${problem}`);
    return 1;
  }
  ctx.state.oldCwd = ctx.state.cwd;
  ctx.state.cwd = found.path;
  if (args[0] === '-') print(ctx, found.path + '\n');
  return 0;
}

function cmdEcho(ctx, args) {
  let words = args;
  let newline = true;
  let escapes = false;
  while (words.length > 0 && /^-[ne]+$/.test(words[0])) {
    if (words[0].includes('n')) newline = false;
    if (words[0].includes('e')) escapes = true;
    words = words.slice(1);
  }
  let text = words.join(' ');
  if (escapes) text = text.split('\\n').join('\n').split('\\t').join('\t');
  print(ctx, text + (newline ? '\n' : ''));
  return 0;
}

function cmdClear(ctx) {
  ctx.state.clear = true;
  return 0;
}

// ---------------------------------------------------------------- ls

function cmdLs(ctx, args) {
  const opts = splitFlags(args, 'lahdAtrS1');
  if (opts.bad) return badOption(ctx, 'ls', opts.bad);
  const targets = opts.rest.length > 0 ? opts.rest : ['.'];
  const files = [];
  const folders = [];
  let code = 0;
  for (const target of targets) {
    const found = lookup(ctx.state, target, ctx.user);
    if (found.error) {
      printErr(ctx, `ls: cannot access '${target}': ${found.error}`);
      code = 2;
    } else if (found.node.dir && !opts.flags.d) {
      folders.push({ target, path: found.path, node: found.node });
    } else {
      files.push({ name: target, path: found.path, node: found.node });
    }
  }

  if (files.length > 0) print(ctx, lsText(ctx, sortEntries(files, opts.flags), opts.flags, false));
  folders.forEach((folder, index) => {
    if (targets.length > 1) print(ctx, `${files.length > 0 || index > 0 ? '\n' : ''}${folder.target}:\n`);
    if (!allowed(folder.node, ctx.user, 'r')) {
      printErr(ctx, `ls: cannot open directory '${folder.target}': ${NO_ENTRY}`);
      code = 2;
      return;
    }
    print(ctx, lsText(ctx, folderEntries(ctx.state, folder.path, opts.flags), opts.flags, true));
  });
  return code;
}

// The entries of one folder, as [{ name, path, node }], hidden ones only with -a or -A.
function folderEntries(state, folder, flags) {
  const names = childNames(state, folder).filter((name) => flags.a || flags.A || !name.startsWith('.'));
  const entries = sortEntries(names.map((name) => {
    const path = joinPath(folder, name);
    return { name, path, node: state.nodes[path] };
  }), flags);
  if (!flags.a) return entries;
  const parent = parentOf(folder);
  return [{ name: '.', path: folder, node: state.nodes[folder] }, { name: '..', path: parent, node: state.nodes[parent] }, ...entries];
}

// "Nov 12 08:30" -> a number that sorts in time order.
function mtimeKey(mtime) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [month, day, clock] = mtime.split(/\s+/);
  return months.indexOf(month) * 1000000 + Number(day) * 10000 + Number(clock.replace(':', ''));
}

function sortEntries(entries, flags) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (flags.S) sorted.sort((a, b) => byteSize(b.node) - byteSize(a.node));
  if (flags.t) sorted.sort((a, b) => mtimeKey(b.node.mtime) - mtimeKey(a.node.mtime));
  if (flags.r) sorted.reverse();
  return sorted;
}

function lsText(ctx, entries, flags, withTotal) {
  if (!flags.l) {
    const separator = ctx.tty && !flags['1'] ? '  ' : '\n';
    return entries.length > 0 ? entries.map((entry) => entry.name).join(separator) + '\n' : '';
  }
  const rows = entries.map((entry) => lsRow(ctx.state, entry, flags));
  const width = (column) => Math.max(0, ...rows.map((row) => row[column].length));
  const lines = rows.map((row) => [
    row[0], lpad(row[1], width(1)), pad(row[2], width(2)), pad(row[3], width(3)), lpad(row[4], width(4)), row[5], row[6],
  ].join(' '));
  if (withTotal) {
    const kb = entries.reduce((sum, entry) => sum + blockKb(entry.node), 0);
    lines.unshift(`total ${flags.h ? human(kb * 1024) : kb}`);
  }
  return unlines(lines);
}

// One line of ls -l as columns: mode, links, owner, group, size, time, name.
function lsRow(state, entry, flags) {
  const node = entry.node;
  const subfolders = node.dir ? childNames(state, entry.path).filter((name) => state.nodes[joinPath(entry.path, name)].dir).length : 0;
  const links = node.dir ? 2 + subfolders : 1;
  const size = flags.h ? human(byteSize(node)) : String(byteSize(node));
  return [modeText(node), String(links), node.owner, node.group, size, node.mtime, entry.name];
}

// ---------------------------------------------------------------- cat, head, tail, wc

function cmdCat(ctx, args) {
  const opts = splitFlags(args, 'n');
  if (opts.bad) return badOption(ctx, 'cat', opts.bad);
  const read = readInputs(ctx, 'cat', opts.rest);
  if (!read) return 1;
  let text = read.sources.map((source) => source.text).join('');
  if (opts.flags.n) text = unlines(linesOf(text).map((line, index) => `${lpad(index + 1, 6)}\t${line}`));
  print(ctx, text);
  const big = read.sources.find((source) => source.node && source.node.sizeMb);
  if (big && ctx.tty) printErr(ctx, `[simulator: ${big.name} is ${human(byteSize(big.node))}; these lines are a sample of it]`);
  return read.failed ? 1 : 0;
}

function cmdHead(ctx, args) {
  return headOrTail(ctx, args, 'head');
}

function cmdTail(ctx, args) {
  return headOrTail(ctx, args, 'tail');
}

function headOrTail(ctx, args, name) {
  const wanted = readLineCount(ctx, args, name);
  if (!wanted) return 1;
  const read = readInputs(ctx, name, wanted.files);
  if (!read) return 1;
  read.sources.forEach((source, index) => {
    if (read.sources.length > 1) print(ctx, `${index > 0 ? '\n' : ''}==> ${source.name} <==\n`);
    const lines = linesOf(source.text);
    let kept;
    if (name === 'head') kept = lines.slice(0, wanted.count);
    else if (wanted.fromLine) kept = lines.slice(wanted.count - 1);
    else kept = wanted.count === 0 ? [] : lines.slice(-wanted.count);
    print(ctx, unlines(kept));
  });
  return read.failed ? 1 : 0;
}

// Understands -n 5, -n5, -5 and (for tail) -n +5. Returns { count, fromLine, files } or null.
function readLineCount(ctx, args, name) {
  let value = String(DEFAULT_LINES);
  const files = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-f' || arg === '-F' || arg === '--follow') {
      printErr(ctx, `${name}: -f would wait forever in this simulator. Use ${name} -n 20 FILE, or journalctl -u NAME -n 20.`);
      return null;
    }
    if (arg === '-n') { value = args[i + 1] || ''; i += 1; }
    else if (arg.startsWith('--lines=')) value = arg.slice(8);
    else if (/^-n.+$/.test(arg)) value = arg.slice(2);
    else if (/^-\d+$/.test(arg)) value = arg.slice(1);
    else if (arg.startsWith('-') && arg.length > 1) { badOption(ctx, name, arg); return null; }
    else files.push(arg);
  }
  const fromLine = name === 'tail' && value.startsWith('+');
  if (!/^\+?\d+$/.test(value) || (value.startsWith('+') && !fromLine)) {
    printErr(ctx, `${name}: invalid number of lines: ‘${value}’`);
    return null;
  }
  return { count: Number(value), fromLine, files };
}

function cmdWc(ctx, args) {
  const opts = splitFlags(args, 'lwcm');
  if (opts.bad) return badOption(ctx, 'wc', opts.bad);
  const read = readInputs(ctx, 'wc', opts.rest);
  if (!read) return 1;
  const asked = ['l', 'w', 'c'].filter((key) => opts.flags[key] || (key === 'c' && opts.flags.m));
  const columns = asked.length > 0 ? asked : ['l', 'w', 'c'];
  const rows = read.sources.map((source) => ({ name: source.name, counts: wcCounts(source) }));
  if (rows.length > 1) {
    const total = { l: 0, w: 0, c: 0 };
    for (const row of rows) for (const key of columns) total[key] += row.counts[key];
    rows.push({ name: 'total', counts: total });
  }

  // Column width follows GNU wc: 1 for a single number, 7 when reading a pipe, else the digits of the largest byte count.
  let width = String(Math.max(...rows.map((row) => row.counts.c))).length;
  if (opts.rest.length === 0) width = 7;
  if (rows.length === 1 && columns.length === 1) width = 1;
  for (const row of rows) {
    const numbers = columns.map((key) => lpad(row.counts[key], width)).join(' ');
    print(ctx, `${numbers}${row.name ? ' ' + row.name : ''}\n`);
  }
  return read.failed ? 1 : 0;
}

function wcCounts(source) {
  const text = source.text;
  return {
    l: text.split('\n').length - 1,
    w: text.split(/\s+/).filter(Boolean).length,
    c: source.node ? byteSize(source.node) : text.length,
  };
}

// ---------------------------------------------------------------- grep

function cmdGrep(ctx, args) {
  const opts = splitFlags(args.filter((arg) => !arg.startsWith('--color')), 'ivncrREFqwlHhs');
  if (opts.bad) return badOption(ctx, 'grep', opts.bad);
  const flags = opts.flags;
  const [pattern, ...targets] = opts.rest;
  if (pattern === undefined) {
    printErr(ctx, 'Usage: grep [OPTION]... PATTERNS [FILE]...');
    printErr(ctx, "Try 'grep --help' for more information.");
    return 2;
  }
  let regex;
  try {
    regex = toRegExp(pattern, { extended: flags.E, fixed: flags.F, ignoreCase: flags.i, wholeWord: flags.w });
  } catch {
    printErr(ctx, 'grep: Invalid regular expression');
    return 2;
  }

  const recursive = flags.r || flags.R;
  const found = grepSources(ctx, targets, recursive, flags.s);
  if (!found) return 2;
  const showName = flags.H || (!flags.h && (recursive || found.sources.length > 1));
  let anyMatch = false;
  for (const source of found.sources) {
    const hits = grepOne(source, regex, flags, showName);
    if (hits.count > 0) anyMatch = true;
    if (!flags.q) print(ctx, hits.text);
  }
  if (found.failed && !(flags.q && anyMatch)) return 2;
  return anyMatch ? 0 : 1;
}

// The texts grep should search: [{ name, text }]. Folders are walked with -r.
function grepSources(ctx, targets, recursive, quiet) {
  if (targets.length === 0 && !recursive) {
    if (ctx.stdin === null) {
      printErr(ctx, 'grep: nothing to search. Give a file name, or pipe something in.');
      return null;
    }
    return { sources: [{ name: '(standard input)', text: ctx.stdin }], failed: false };
  }
  const sources = [];
  let failed = false;
  const complain = (line) => {
    if (!quiet) printErr(ctx, line);
    failed = true;
  };
  const visit = (shown) => {
    const found = lookup(ctx.state, shown, ctx.user);
    if (found.error) return complain(`grep: ${shown}: ${found.error}`);
    if (!found.node.dir) {
      if (!allowed(found.node, ctx.user, 'r')) return complain(`grep: ${shown}: ${NO_ENTRY}`);
      return sources.push({ name: shown, text: found.node.text });
    }
    if (!recursive) return complain(`grep: ${shown}: Is a directory`);
    if (!allowed(found.node, ctx.user, 'r')) return complain(`grep: ${shown}: ${NO_ENTRY}`);
    for (const name of childNames(ctx.state, found.path)) visit(joinPath(shown, name));
    return null;
  };
  for (const target of targets.length > 0 ? targets : ['.']) visit(target);
  return { sources, failed };
}

// Search one text. Returns { count, text } where text is what grep prints for it.
function grepOne(source, regex, flags, showName) {
  const prefix = showName ? `${source.name}:` : '';
  const lines = [];
  let count = 0;
  linesOf(source.text).forEach((line, index) => {
    if (regex.test(line) === Boolean(flags.v)) return;
    count += 1;
    lines.push(`${prefix}${flags.n ? `${index + 1}:` : ''}${line}`);
  });
  if (flags.l) return { count, text: count > 0 ? `${source.name}\n` : '' };
  if (flags.c) return { count, text: `${prefix}${count}\n` };
  return { count, text: unlines(lines) };
}

// ---------------------------------------------------------------- rm, chmod

function cmdRm(ctx, args) {
  const opts = splitFlags(args, 'rRfiv');
  if (opts.bad) return badOption(ctx, 'rm', opts.bad);
  const force = opts.flags.f;
  const recursive = opts.flags.r || opts.flags.R;
  if (opts.rest.length === 0) {
    if (force) return 0;
    printErr(ctx, 'rm: missing operand');
    printErr(ctx, "Try 'rm --help' for more information.");
    return 1;
  }
  let code = 0;
  for (const target of opts.rest) {
    const problem = removeOne(ctx, target, recursive, force);
    if (problem) {
      printErr(ctx, problem);
      code = 1;
    }
  }
  return code;
}

// Remove one path. Returns '' or the error line. Deleting needs write permission on the
// folder that holds the file, not on the file itself.
function removeOne(ctx, target, recursive, force) {
  const found = lookup(ctx.state, target, ctx.user);
  if (found.error === NO_FILE && force) return '';
  if (found.error) return `rm: cannot remove '${target}': ${found.error}`;
  if (found.path === '/') return "rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe";
  if (found.node.dir && !recursive) return `rm: cannot remove '${target}': Is a directory`;
  if (!allowed(ctx.state.nodes[parentOf(found.path)], ctx.user, 'w')) return `rm: cannot remove '${target}': ${NO_ENTRY}`;
  removeTree(ctx.state, found.path);
  return '';
}

function cmdChmod(ctx, args) {
  const recursive = args.includes('-R');
  const [mode, ...targets] = args.filter((arg) => arg !== '-R');
  if (mode === undefined || targets.length === 0) {
    printErr(ctx, mode === undefined ? 'chmod: missing operand' : `chmod: missing operand after ‘${mode}’`);
    printErr(ctx, "Try 'chmod --help' for more information.");
    return 1;
  }
  let code = 0;
  for (const target of targets) {
    const found = lookup(ctx.state, target, ctx.user);
    if (found.error) {
      printErr(ctx, `chmod: cannot access '${target}': ${found.error}`);
      code = 1;
      continue;
    }
    const paths = recursive
      ? Object.keys(ctx.state.nodes).filter((path) => path === found.path || path.startsWith(found.path + '/'))
      : [found.path];
    for (const path of paths) {
      const problem = chmodOne(ctx, path, mode);
      if (problem) {
        printErr(ctx, problem);
        if (problem.includes('invalid mode')) return 1;
        code = 1;
      }
    }
  }
  return code;
}

// Change one node's mode. Only its owner or root may. Returns '' or the error line.
function chmodOne(ctx, path, mode) {
  const node = ctx.state.nodes[path];
  const next = newMode(node, mode);
  if (next === null) return `chmod: invalid mode: ‘${mode}’`;
  if (ctx.user !== 'root' && ctx.user !== node.owner) return `chmod: changing permissions of '${path}': Operation not permitted`;
  node.mode = next;
  return '';
}

// Work out the new mode text. `mode` is what was typed: "644", "+x", "u+rw,go-w" and so on.
// Returns null if it makes no sense.
function newMode(node, mode) {
  if (/^[0-7]{1,4}$/.test(mode)) return mode.replace(/^0+(?=\d{3})/, '').padStart(3, '0');
  let bits = parseInt(node.mode.slice(-3), 8);
  for (const clause of mode.split(',')) {
    const parts = /^([ugoa]*)([-+=])([rwxX]*)$/.exec(clause);
    if (!parts) return null;
    const [, who, op, perms] = parts;
    let wanted = 0;
    if (perms.includes('r')) wanted |= 4;
    if (perms.includes('w')) wanted |= 2;
    if (perms.includes('x') || (perms.includes('X') && (node.dir || (bits & 0o111) !== 0))) wanted |= 1;
    let mask = 0;      // which of owner, group, other this clause touches
    if (who === '' || who.includes('a') || who.includes('u')) mask |= 0o700;
    if (who === '' || who.includes('a') || who.includes('g')) mask |= 0o070;
    if (who === '' || who.includes('a') || who.includes('o')) mask |= 0o007;
    let value = (wanted * 0o111) & mask;
    if (who === '') value &= ~0o022;          // plain +w gives write to the owner only (the umask)
    if (op === '+') bits |= value;
    else if (op === '-') bits &= ~value;
    else bits = (bits & ~mask) | value;
  }
  const special = node.mode.length === 4 ? node.mode[0] : '';
  return special + bits.toString(8).padStart(3, '0');
}

// ---------------------------------------------------------------- sed

function cmdSed(ctx, args) {
  const opts = { inPlace: false, quiet: false, extended: false, script: null, files: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-i' || arg === '--in-place') opts.inPlace = true;
    else if (arg === '-n') opts.quiet = true;
    else if (arg === '-E' || arg === '-r') opts.extended = true;
    else if (arg === '-e') { opts.script = args[i + 1]; i += 1; }
    else if (arg.startsWith('-') && arg.length > 1) return badOption(ctx, 'sed', arg);
    else if (opts.script === null) opts.script = arg;
    else opts.files.push(arg);
  }
  if (!opts.script) {
    printErr(ctx, 'Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...');
    return 1;
  }
  const edit = readSedScript(opts.script, opts.extended);
  if (edit.error) {
    printErr(ctx, `sed: -e expression #1, char ${edit.at}: ${edit.error}`);
    return 1;
  }
  if (opts.inPlace) return sedInPlace(ctx, edit, opts);
  const read = readInputs(ctx, 'sed', opts.files);
  if (!read) return 1;
  for (const source of read.sources) print(ctx, sedText(source.text, edit, opts.quiet));
  return read.failed ? 2 : 0;
}

// sed -i writes a temporary file next to the original and renames it over the top,
// so it needs write permission on the folder. That is why it usually wants sudo in /etc.
function sedInPlace(ctx, edit, opts) {
  if (opts.files.length === 0) {
    printErr(ctx, 'sed: no input files');
    return 1;
  }
  let code = 0;
  for (const path of opts.files) {
    const read = readFile(ctx.state, path, ctx.user);
    if (read.error) {
      printErr(ctx, `sed: can't read ${path}: ${read.error}`);
      code = 2;
    } else if (!allowed(ctx.state.nodes[parentOf(read.path)], ctx.user, 'w')) {
      printErr(ctx, `sed: couldn't open temporary file ${joinPath(parentOf(read.path), 'sedXq3kTz')}: ${NO_ENTRY}`);
      code = 4;
    } else {
      read.node.text = sedText(read.text, edit, opts.quiet);
      read.node.mtime = `${SIM_DAY.stamp} ${clockText(ctx.state.clock).slice(0, 5)}`;
    }
  }
  return code;
}

// Understand one sed script. Returns { kind: 's', regex, replacement } or
// { kind: 'p' | 'd', from, to, regex } or { error, at }.
function readSedScript(script, extended) {
  if (script[0] === 's' && script.length > 1) return readSubstitute(script, extended);
  const range = /^(\d+|\$)?(?:,(\d+|\$))?([pd])$/.exec(script);
  if (range) {
    const number = (text) => (text === '$' ? Infinity : Number(text));
    const from = range[1] === undefined ? 1 : number(range[1]);
    const to = range[2] !== undefined ? number(range[2]) : range[1] === undefined ? Infinity : from;
    return { kind: range[3], from, to, lastOnly: range[1] === '$' };
  }
  const address = /^\/(.+)\/([pd])$/.exec(script);
  if (address) {
    try {
      return { kind: address[2], regex: toRegExp(address[1], { extended }) };
    } catch {
      return { error: 'Invalid regular expression', at: script.length };
    }
  }
  return { error: `unknown command: \`${script[0]}'`, at: 1 };
}

// s/OLD/NEW/flags, with any single character as the separator.
function readSubstitute(script, extended) {
  const separator = script[1];
  const parts = [''];
  for (let i = 2; i < script.length; i += 1) {
    if (script[i] === '\\' && script[i + 1] === separator) { parts[parts.length - 1] += separator; i += 1; }
    else if (script[i] === '\\') { parts[parts.length - 1] += script[i] + (script[i + 1] || ''); i += 1; }
    else if (script[i] === separator) parts.push('');
    else parts[parts.length - 1] += script[i];
  }
  if (parts.length < 3) return { error: "unterminated `s' command", at: script.length };
  const [pattern, replacement, flags] = parts;
  if (!/^[gIi]*$/.test(flags)) return { error: "unknown option to `s'", at: script.length };
  try {
    const regex = toRegExp(pattern, { extended, ignoreCase: /[Ii]/.test(flags), everyMatch: flags.includes('g') });
    return { kind: 's', regex, replacement: sedReplacement(replacement) };
  } catch {
    return { error: 'Invalid preceding regular expression', at: script.length };
  }
}

// sed writes "the whole match" as & and groups as \1; JavaScript wants $& and $1.
function sedReplacement(text) {
  let result = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '\\' && next !== undefined) {
      if (/\d/.test(next)) result += '$' + next;
      else if (next === 'n') result += '\n';
      else result += next === '$' ? '$$' : next;
      i += 1;
    } else if (ch === '&') {
      result += '$&';
    } else {
      result += ch === '$' ? '$$' : ch;
    }
  }
  return result;
}

function sedText(text, edit, quiet) {
  const lines = linesOf(text);
  const kept = [];
  lines.forEach((line, index) => {
    const number = index + 1;
    let selected = edit.regex ? edit.regex.test(line) : number >= edit.from && number <= edit.to;
    if (edit.lastOnly) selected = number === lines.length;
    if (edit.kind === 's') {
      edit.regex.lastIndex = 0;
      if (!quiet) kept.push(line.replace(edit.regex, edit.replacement));
    } else if (edit.kind === 'd') {
      if (!selected && !quiet) kept.push(line);
    } else {
      if (!quiet) kept.push(line);
      if (selected) kept.push(line);          // p prints the line a second time unless -n is given
    }
  });
  return unlines(kept);
}

// ---------------------------------------------------------------- ps, kill

function cmdPs(ctx, args) {
  const style = args.join(' ').replace(/^-/, '');
  const everything = /^(aux|auxw|auxww|ef|e|A|ax)$/.test(style);
  if (args.length > 0 && !everything) {
    printErr(ctx, `ps: the simulator knows three forms: ps, ps aux and ps -ef`);
    return 1;
  }
  const mine = { pid: ctx.pid, user: ctx.user, cmd: ['ps', ...args].join(' '), comm: 'ps', tty: 'pts/0', stat: 'R+', start: 'now', vsz: 10884, rss: 4352, ppid: 2118 };
  const peers = ctx.peers.map((peer) => peerProcess(peer));
  const procs = [...ctx.state.procs, mine, ...peers].sort((a, b) => a.pid - b.pid);

  if (!everything) print(ctx, psShort(procs.filter((proc) => proc.tty === 'pts/0')));
  else if (style.startsWith('aux') || style === 'ax') print(ctx, psAux(ctx.state, procs));
  else print(ctx, psEf(ctx.state, procs));
  return 0;
}

// The other commands of the same pipeline are running too, so ps lists them.
// That is why `ps aux | grep name` always shows the grep itself.
function peerProcess(peer) {
  const words = peer.words[0] === 'sudo' ? peer.words.slice(1) : peer.words;
  const cmd = words[0] === 'grep' ? ['grep', '--color=auto', ...words.slice(1)].join(' ') : words.join(' ');
  return { pid: peer.pid, user: USER, cmd, comm: words[0], tty: 'pts/0', stat: 'S+', start: 'now', vsz: 9144, rss: 2304, ppid: 2118 };
}

// The START column: a clock time for today's processes, a day for older ones.
function startText(state, proc) {
  if (proc.start === 'now') return clockText(state.clock).slice(0, 5);
  if (proc.start === 'login') return clockText(BOOT_CLOCK + LOGIN_DELAY).slice(0, 5);
  return proc.start || OLD_START;
}

// ps cuts a user name longer than 8 characters to 7 and a plus sign.
function shortUser(user) {
  return user.length > 8 ? user.slice(0, 7) + '+' : user;
}

function psAux(state, procs) {
  const lines = ['USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND'];
  for (const proc of procs) {
    const rss = proc.rss || 0;
    const mem = ((rss * 100) / MEMORY_KB).toFixed(1);
    lines.push([
      pad(shortUser(proc.user), 8), lpad(proc.pid, 7), ' 0.0', lpad(mem, 4), lpad(proc.vsz || 0, 6), lpad(rss, 5),
      pad(proc.tty || '?', 8), pad(proc.stat || 'S', 4), lpad(startText(state, proc), 5), lpad(proc.time || '0:00', 6), proc.cmd,
    ].join(' '));
  }
  return unlines(lines);
}

function psEf(state, procs) {
  const lines = ['UID          PID    PPID  C STIME TTY          TIME CMD'];
  for (const proc of procs) {
    const ppid = proc.ppid !== undefined ? proc.ppid : proc.pid === 1 ? 0 : proc.pid === 2 ? 0 : 1;
    const time = '00:0' + (proc.time || '0:00');
    lines.push([
      pad(shortUser(proc.user), 8), lpad(proc.pid, 7), lpad(ppid, 7), ' 0', lpad(startText(state, proc), 5),
      pad(proc.tty || '?', 8), lpad(time, 8), proc.cmd,
    ].join(' '));
  }
  return unlines(lines);
}

function psShort(procs) {
  const lines = ['    PID TTY          TIME CMD'];
  for (const proc of procs) lines.push(`${lpad(proc.pid, 7)} ${pad(proc.tty, 8)} 00:00:00 ${proc.comm}`);
  return unlines(lines);
}

const SIGNALS = { 9: 'KILL', KILL: 'KILL', SIGKILL: 'KILL', 15: 'TERM', TERM: 'TERM', SIGTERM: 'TERM' };

function cmdKill(ctx, args) {
  let signal = 'TERM';
  let pids = args;
  if (pids[0] === '-s' && pids.length > 1) pids = ['-' + pids[1], ...pids.slice(2)];
  if (pids[0] && pids[0].startsWith('-')) {
    signal = SIGNALS[pids[0].slice(1)];
    pids = pids.slice(1);
    if (!signal) {
      printErr(ctx, 'kill: the simulator knows two signals: TERM (plain kill, or -15) and KILL (-9)');
      return 1;
    }
  }
  if (pids.length === 0) {
    printErr(ctx, 'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]');
    return 2;
  }
  let code = 0;
  for (const text of pids) {
    const problem = killOne(ctx, text, signal);
    if (problem) {
      printErr(ctx, problem);
      code = 1;
    }
  }
  return code;
}

// Signal one process. Returns '' or the error line. Plain kill is part of bash and
// sudo kill is a separate program, so the two word their errors differently.
function killOne(ctx, text, signal) {
  const viaSudo = ctx.user !== USER;
  const say = (reason) => (viaSudo ? `kill: (${text}): ${reason}` : `bash: kill: (${text}) - ${reason}`);
  if (!/^\d+$/.test(text)) {
    return viaSudo ? `kill: failed to parse argument: '${text}'` : `bash: kill: ${text}: arguments must be process or job IDs`;
  }
  const proc = ctx.state.procs.find((other) => other.pid === Number(text));
  if (!proc) return say('No such process');
  if (ctx.user !== 'root' && ctx.user !== proc.user) return say('Operation not permitted');
  if (proc.locked) return `kill: (${text}): the simulator keeps this process alive. The host needs it.`;
  signalProcess(ctx.state, proc, signal);
  return '';
}

// ---------------------------------------------------------------- ss

function cmdSs(ctx, args) {
  const opts = splitFlags(args, 'ltnpuaH46');
  if (opts.bad || opts.rest.length > 0) return badOption(ctx, 'ss', opts.bad || opts.rest[0]);
  const flags = opts.flags;
  const tcp = flags.t || !flags.u;
  const withNetid = Boolean(flags.t) === Boolean(flags.u);       // ss adds a Netid column unless you ask for one protocol
  const rows = [];
  if (tcp && (flags.l || flags.a)) {
    for (const proc of ctx.state.procs.filter((p) => p.port).sort((a, b) => a.port - b.port)) {
      rows.push(listenRow(ctx, proc, flags));
    }
  }
  if (tcp && !flags.l) {
    rows.push(['ESTAB', '0', '0', HOST_IP, flags.n ? '22' : 'ssh', CLIENT_IP, '51234', flags.p && ctx.user === 'root' ? 'users:(("sshd",pid=2117,fd=4),("sshd",pid=2101,fd=4))' : '']);
  }

  const lines = [];
  if (!flags.H) {
    rows.unshift(['State', 'Recv-Q', 'Send-Q', 'Local Address', 'Port', 'Peer Address', 'Port', flags.p ? 'Process' : '']);
  }
  for (const row of rows) {
    const [state, recvQ, sendQ, address, port, peer, peerPort, process] = row;
    const label = state === 'State' ? 'Netid ' : 'tcp   ';
    lines.push(`${withNetid ? label : ''}${pad(state, 8)} ${pad(recvQ, 8)} ${pad(sendQ, 10)} ${lpad(address, 13)}:${pad(port, 9)} ${lpad(peer, 12)}:${pad(peerPort, 5)} ${process}`.trimEnd());
  }
  print(ctx, unlines(lines));
  return 0;
}

// One LISTEN line. The process name and pid are shown only for your own processes,
// or for all of them when ss runs as root: the kernel will not tell you about other users'.
function listenRow(ctx, proc, flags) {
  const mayKnow = ctx.user === 'root' || ctx.user === proc.user;
  const process = flags.p && mayKnow ? `users:(("${proc.comm}",pid=${proc.pid},fd=3))` : '';
  const port = flags.n ? String(proc.port) : PORT_NAMES[proc.port] || String(proc.port);
  return ['LISTEN', '0', proc.port === 22 ? '128' : '4096', bindOf(proc), port, '0.0.0.0', '*', process];
}

// ---------------------------------------------------------------- df, du

function cmdDf(ctx, args) {
  const opts = splitFlags(args, 'hk');
  if (opts.bad) return badOption(ctx, 'df', opts.bad);
  const state = ctx.state;
  const real = state.level.disks.map((disk) => {
    const used = usedKb(state, disk);
    return [disk.device, disk.sizeMb * 1024, Math.min(used, disk.sizeMb * 1024), disk.mount];
  });
  let disks = [...TMPFS_BEFORE, ...real, ...TMPFS_AFTER];
  let code = 0;
  if (opts.rest.length > 0) {
    disks = [];
    for (const target of opts.rest) {
      const found = lookup(state, target, ctx.user);
      if (found.error) {
        printErr(ctx, `df: ${target}: ${found.error}`);
        code = 1;
      } else {
        disks.push(real.find((row) => row[3] === diskFor(state, found.path).mount));
      }
    }
    if (disks.length === 0) return code;
  }
  print(ctx, dfText(disks, opts.flags.h));
  return code;
}

// Lay the df table out the way GNU df does: the name column at least 14 wide, numbers right-aligned.
function dfText(disks, humanSizes) {
  const show = (kb) => (humanSizes ? human(kb * 1024) : String(kb));
  const head = humanSizes ? ['Filesystem', 'Size', 'Used', 'Avail', 'Use%'] : ['Filesystem', '1K-blocks', 'Used', 'Available', 'Use%'];
  const rows = disks.map(([device, size, used, mount]) => {
    const percent = size === 0 ? '-' : Math.ceil((used * 100) / size) + '%';
    return [device, show(size), show(used), show(size - used), percent, mount];
  });
  const least = humanSizes ? [14, 5, 5, 5, 4] : [14, 9, 5, 9, 4];
  const width = (column) => Math.max(least[column], head[column].length, ...rows.map((row) => row[column].length));
  const line = (cells, last) => [pad(cells[0], width(0)), ...[1, 2, 3, 4].map((c) => lpad(cells[c], width(c))), last].join(' ');
  return unlines([line(head, 'Mounted on'), ...rows.map((row) => line(row, row[5]))]);
}

function cmdDu(ctx, args) {
  const opts = { flags: {}, maxDepth: Infinity, paths: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-d') { opts.maxDepth = Number(args[i + 1]); i += 1; }
    else if (/^-d\d+$/.test(arg)) opts.maxDepth = Number(arg.slice(2));
    else if (arg.startsWith('--max-depth=')) opts.maxDepth = Number(arg.slice(12));
    else if (arg.startsWith('-') && arg.length > 1) {
      const part = splitFlags([arg], 'shackx');
      if (part.bad) return badOption(ctx, 'du', part.bad);
      Object.assign(opts.flags, part.flags);
    } else opts.paths.push(arg);
  }
  if (opts.flags.s) opts.maxDepth = 0;
  if (Number.isNaN(opts.maxDepth)) return badOption(ctx, 'du', '-d without a number');

  const show = (kb) => (opts.flags.h ? human(kb * 1024) : String(kb));
  let total = 0;
  ctx.failed = false;
  for (const target of opts.paths.length > 0 ? opts.paths : ['.']) {
    const found = lookup(ctx.state, target, ctx.user);
    if (found.error) {
      printErr(ctx, `du: cannot access '${target}': ${found.error}`);
      ctx.failed = true;
      continue;
    }
    const rows = [];
    total += duWalk(ctx, found.path, target, 0, opts, rows);
    for (const [kb, shown] of rows) print(ctx, `${show(kb)}\t${shown}\n`);
  }
  if (opts.flags.c) print(ctx, `${show(total)}\ttotal\n`);
  return ctx.failed ? 1 : 0;
}

// Add up a folder, deepest entries first (the order du prints them in). Returns its size in KB.
function duWalk(ctx, path, shown, depth, opts, rows) {
  const node = ctx.state.nodes[path];
  let kb = blockKb(node);
  if (node.dir && !allowed(node, ctx.user, 'r')) {
    printErr(ctx, `du: cannot read directory '${shown}': ${NO_ENTRY}`);
    ctx.failed = true;
  } else if (node.dir) {
    for (const name of childNames(ctx.state, path)) {
      kb += duWalk(ctx, joinPath(path, name), joinPath(shown, name), depth + 1, opts, rows);
    }
  }
  const listed = node.dir || opts.flags.a || depth === 0;
  if (listed && depth <= opts.maxDepth) rows.push([kb, shown]);
  return kb;
}

// ---------------------------------------------------------------- systemctl

const SYSTEMCTL_USAGE = 'systemctl: the simulator knows: status, start, stop, restart, is-active, cat NAME; --failed; list-units';

function cmdSystemctl(ctx, args) {
  const words = args.filter((arg) => !arg.startsWith('-'));
  const [verb, ...names] = words;
  const units = names.map((name) => name.replace(/\.service$/, ''));
  if (args.includes('--failed')) return systemctlList(ctx, true);
  if (verb === undefined || verb === 'list-units') return systemctlList(ctx, false);
  if (verb === 'daemon-reload') return needsRoot(ctx, 'Failed to reload daemon') ? 1 : 0;
  if (['enable', 'reset-failed'].includes(verb)) return needsRoot(ctx, `Failed to ${verb} unit`) ? 1 : 0;
  const actions = { status: unitStatus, cat: unitCat, 'is-active': unitIsActive, start: unitChange, stop: unitChange, restart: unitChange };
  if (!actions[verb]) {
    printErr(ctx, SYSTEMCTL_USAGE);
    return 1;
  }
  if (units.length === 0) {
    printErr(ctx, verb === 'status' ? 'systemctl status: name a unit, for example: systemctl status sample-app' : 'Too few arguments.');
    return 1;
  }
  let code = 0;
  units.forEach((name, index) => {
    if (index > 0 && verb === 'status') print(ctx, '\n');
    code = actions[verb](ctx, name, verb) || code;
  });
  return code;
}

// Changing the system needs root. Prints the refusal and returns true when ops tries it without sudo.
function needsRoot(ctx, what) {
  if (ctx.user === 'root') return false;
  printErr(ctx, `${what}: Interactive authentication required.`);
  return true;
}

function unitStatus(ctx, name) {
  const state = ctx.state;
  const def = (state.level.services || {})[name];
  if (!def) {
    printErr(ctx, `Unit ${name}.service could not be found.`);
    return 4;
  }
  const unit = state.units[name];
  const since = unit.since === null ? '' : ` since ${SIM_DAY.weekday} ${SIM_DAY.iso} ${clockText(unit.since)} ${SIM_DAY.zone}; ${agoText(state.clock - unit.since)} ago`;
  const dot = { active: '●', failed: '×', inactive: '○' }[unit.state];
  const lines = [
    `${dot} ${name}.service - ${def.description}`,
    `     Loaded: loaded (/etc/systemd/system/${name}.service; enabled; preset: enabled)`,
  ];
  if (unit.state === 'active') {
    lines.push(`     Active: active (running)${since}`, `   Main PID: ${unit.pid} (${commName(def)})`,
      '      Tasks: 5 (limit: 4595)', '     Memory: 18.0M (peak: 18.4M)', '        CPU: 112ms',
      `     CGroup: /system.slice/${name}.service`, `             └─${unit.pid} ${def.exec}`);
  } else {
    lines.push(`     Active: ${unit.state === 'failed' ? `failed (Result: ${unit.result})` : 'inactive (dead)'}${since}`);
    if (unit.lastPid) {
      lines.push(`    Process: ${unit.lastPid} ExecStart=${def.exec} (${unit.exit})`, `   Main PID: ${unit.lastPid} (${unit.exit})`, '        CPU: 38ms');
    }
  }
  const recent = state.journal.filter((entry) => entry.unit === name).slice(-STATUS_LOG_LINES);
  if (recent.length > 0) lines.push('', ...recent.map(journalLine));
  print(ctx, unlines(lines));
  return unit.state === 'active' ? 0 : 3;
}

function unitCat(ctx, name) {
  const path = `/etc/systemd/system/${name}.service`;
  const read = readFile(ctx.state, path, ctx.user);
  if (read.error) {
    printErr(ctx, `No files found for ${name}.service.`);
    return 1;
  }
  print(ctx, `# ${path}\n${read.text}`);
  return 0;
}

function unitIsActive(ctx, name) {
  const unit = ctx.state.units[name];
  print(ctx, `${unit ? unit.state : 'inactive'}\n`);
  return unit && unit.state === 'active' ? 0 : 3;
}

// start, stop and restart.
function unitChange(ctx, name, verb) {
  const state = ctx.state;
  if (!state.units[name]) {
    printErr(ctx, `Failed to ${verb} ${name}.service: Unit ${name}.service not found.`);
    return 5;
  }
  if (needsRoot(ctx, `Failed to ${verb} ${name}.service`)) {
    printErr(ctx, `See system logs and 'systemctl status ${name}.service' for details.`);
    return 1;
  }
  const running = state.units[name].state === 'active';
  if (running && verb !== 'start') stopUnit(state, name, 'stop');
  if (verb === 'stop') {
    if (!running) state.units[name] = { ...state.units[name], state: 'inactive' };
    return 0;
  }
  if (running && verb === 'start') return 0;
  if (startUnit(state, name)) return 0;
  printErr(ctx, `Job for ${name}.service failed because the control process exited with error code.`);
  printErr(ctx, `See "systemctl status ${name}.service" and "journalctl -xeu ${name}.service" for details.`);
  return 1;
}

// systemctl list-units, or systemctl --failed for only the units that are down.
function systemctlList(ctx, failedOnly) {
  const rows = [];
  if (!failedOnly) {
    rows.push(['ssh.service', 'active', 'running', 'OpenBSD Secure Shell server'], ['systemd-journald.service', 'active', 'running', 'Journal Service']);
  }
  for (const [name, def] of Object.entries(ctx.state.level.services || {})) {
    const unit = ctx.state.units[name];
    if (unit.state === 'failed') rows.push([`${name}.service`, 'failed', 'failed', def.description]);
    else if (unit.state === 'active' && !failedOnly) rows.push([`${name}.service`, 'active', 'running', def.description]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const width = Math.max(4, ...rows.map((row) => row[0].length));
  const lines = [`  ${pad('UNIT', width)} LOAD   ACTIVE SUB     DESCRIPTION`];
  for (const [unit, active, sub, description] of rows) {
    lines.push(`${active === 'failed' ? '●' : ' '} ${pad(unit, width)} loaded ${pad(active, 6)} ${pad(sub, 7)} ${description}`);
  }
  lines.push('', 'Legend: LOAD   → Reflects whether the unit definition was properly loaded.',
    '        ACTIVE → The high-level unit activation state, i.e. generalization of SUB.',
    '        SUB    → The low-level unit activation state, values depend on unit type.', '',
    `${rows.length} loaded units listed.`);
  print(ctx, unlines(lines));
  return 0;
}

// ---------------------------------------------------------------- journalctl

function cmdJournalctl(ctx, args) {
  const opts = readJournalOptions(ctx, args);
  if (!opts) return 1;
  let entries = ctx.state.journal;
  if (opts.units.length > 0) entries = entries.filter((entry) => opts.units.includes(entry.unit));
  if (opts.count !== null) entries = opts.count === 0 ? [] : entries.slice(-opts.count);
  if (opts.reverse) entries = [...entries].reverse();
  print(ctx, entries.length > 0 ? unlines(entries.map(journalLine)) : '-- No entries --\n');
  return 0;
}

// Understands -u NAME, -n N, -r and the harmless -x -e -b -q --no-pager, alone or run together (-xeu NAME).
function readJournalOptions(ctx, args) {
  const opts = { units: [], count: null, reverse: false };
  const unitName = (text) => opts.units.push(String(text).replace(/\.service$/, ''));
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--no-pager' || arg === '--boot' || arg === '--all') continue;
    if (arg === '--reverse') { opts.reverse = true; continue; }
    if (arg.startsWith('--unit=')) { unitName(arg.slice(7)); continue; }
    if (arg.startsWith('--lines=')) { opts.count = Number(arg.slice(8)); continue; }
    if (arg === '--unit') { unitName(args[i + 1] || ''); i += 1; continue; }
    if (arg === '-f' || arg === '--follow') {
      printErr(ctx, 'journalctl: -f would wait forever in this simulator. Use: journalctl -u NAME -n 20');
      return null;
    }
    if (!/^-[xebqarun0-9]+/.test(arg)) { badOption(ctx, 'journalctl', arg); return null; }
    for (let at = 1; at < arg.length; at += 1) {
      const letter = arg[at];
      const attached = arg.slice(at + 1);
      if (letter === 'r') opts.reverse = true;
      if (letter === 'u') { unitName(attached || args[i + 1] || ''); if (!attached) i += 1; break; }
      if (letter === 'n') {
        const next = attached || args[i + 1] || '';
        const numeric = /^\d+$/.test(next);
        opts.count = numeric ? Number(next) : DEFAULT_LINES;
        if (numeric && !attached) i += 1;
        break;
      }
    }
  }
  return opts;
}

// ---------------------------------------------------------------- curl

const CURL_FLAGS = { s: 'silent', S: 'showError', i: 'include', I: 'head', v: 'verbose', f: 'fail', L: 'follow', k: 'insecure' };
const CURL_VALUES = { o: 'output', w: 'writeOut', m: 'maxTime', X: 'method', H: 'header' };
const CURL_LONG = { '--silent': 's', '--show-error': 'S', '--include': 'i', '--head': 'I', '--verbose': 'v', '--fail': 'f', '--location': 'L', '--output': 'o', '--write-out': 'w', '--max-time': 'm' };
const LOCAL_NAMES = { localhost: '127.0.0.1', '127.0.0.1': '127.0.0.1', '0.0.0.0': '127.0.0.1', [HOST]: HOST_IP, [HOST_IP]: HOST_IP };

function cmdCurl(ctx, args) {
  const opts = readCurlOptions(ctx, args);
  if (!opts) return 2;
  if (!opts.url) {
    printErr(ctx, 'curl: (2) no URL specified');
    printErr(ctx, "curl: try 'curl --help' or 'curl --manual' for more information");
    return 2;
  }
  const url = /^(?:(https?):\/\/)?(\[[^\]]+\]|[^/:]+)(?::(\d+))?(\/.*)?$/.exec(opts.url);
  if (!url) {
    printErr(ctx, 'curl: (3) URL rejected: Malformed input to a URL function');
    return 3;
  }
  const target = { secure: url[1] === 'https', host: url[2], port: Number(url[3] || (url[1] === 'https' ? 443 : 80)), path: url[4] || '/' };
  const fail = (code, message) => {
    if (opts.verbose) printErr(ctx, `* ${message}`);
    if (opts.verbose) printErr(ctx, '* Closing connection');
    if (!opts.silent || opts.showError) printErr(ctx, `curl: (${code}) ${message}`);
    return code;
  };

  const address = LOCAL_NAMES[target.host];
  if (!address) {
    if (/^[\d.]+$/.test(target.host)) return fail(7, `Failed to connect to ${target.host} port ${target.port} after 3061 ms: Couldn't connect to server`);
    return fail(6, `Could not resolve host: ${target.host}`);
  }
  if (opts.verbose) printErr(ctx, `*   Trying ${address}:${target.port}...`);
  const proc = listenerOn(ctx.state, address, target.port);
  if (!proc) {
    if (opts.verbose) printErr(ctx, `* connect to ${address} port ${target.port} from ${address} port 51840 failed: Connection refused`);
    return fail(7, `Failed to connect to ${target.host} port ${target.port} after 0 ms: Couldn't connect to server`);
  }
  if (opts.verbose) printErr(ctx, `* Connected to ${target.host} (${address}) port ${target.port}`);
  if (target.secure) return fail(35, 'OpenSSL/3.0.13: error:0A00010B:SSL routines::wrong version number');
  if (proc.banner) return fail(1, 'Received HTTP/0.9 when not allowed');
  if (proc.response === undefined) return fail(52, 'Empty reply from server');
  return curlAnswer(ctx, opts, target, proc);
}

function readCurlOptions(ctx, args) {
  const opts = { url: '' };
  for (let i = 0; i < args.length; i += 1) {
    let arg = args[i];
    if (CURL_LONG[arg]) arg = '-' + CURL_LONG[arg];
    if (!arg.startsWith('-') || arg.length === 1) { opts.url = arg; continue; }
    for (const letter of arg.slice(1)) {
      if (CURL_FLAGS[letter]) opts[CURL_FLAGS[letter]] = true;
      else if (CURL_VALUES[letter]) { opts[CURL_VALUES[letter]] = args[i + 1] || ''; i += 1; }
      else {
        printErr(ctx, `curl: option ${args[i]}: is unknown`);
        printErr(ctx, "curl: try 'curl --help' or 'curl --manual' for more information");
        return null;
      }
    }
  }
  return opts;
}

// A listener answered. Print what curl would, and remember which service it was.
function curlAnswer(ctx, opts, target, proc) {
  const body = opts.head ? '' : proc.response;
  const headers = ['HTTP/1.1 200 OK', `Content-Type: ${proc.contentType || 'text/plain; charset=utf-8'}`, `Content-Length: ${proc.response.length}`];
  if (proc.server) headers.splice(1, 0, `Server: ${proc.server}`);   // curl -i shows who answered
  if (opts.verbose) {
    const request = [`${opts.head ? 'HEAD' : 'GET'} ${target.path} HTTP/1.1`, `Host: ${target.host}${target.port === 80 ? '' : ':' + target.port}`, 'User-Agent: curl/8.5.0', 'Accept: */*', ''];
    for (const line of request) printErr(ctx, `> ${line}`.trimEnd());
    for (const line of [...headers, '']) printErr(ctx, `< ${line}`.trimEnd());
  }
  let text = (opts.include || opts.head) && !opts.verbose ? headers.join('\n') + '\n\n' : '';
  text += body;

  let code = 0;
  if (opts.output) {
    const problem = writeFile(ctx.state, opts.output, ctx.user, text, false);
    if (problem) {
      printErr(ctx, `curl: (23) Failure writing output to destination`);
      code = 23;
    }
  } else {
    print(ctx, text);
  }
  if ((opts.output || !ctx.tty) && !opts.silent) curlMeter(ctx, text.length);
  if (opts.writeOut) print(ctx, opts.writeOut.split('%{http_code}').join('200').split('%{response_code}').join('200').split('\\n').join('\n'));
  if (opts.verbose) printErr(ctx, `* Connection #0 to host ${target.host} left intact`);
  ctx.state.answered = proc.unit || null;
  return code;
}

// The progress table curl prints whenever its output is not going to your screen.
function curlMeter(ctx, bytes) {
  const n = lpad(bytes, 5);
  printErr(ctx, '  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current');
  printErr(ctx, '                                 Dload  Upload   Total   Spent    Left  Speed');
  printErr(ctx, `100 ${n}  100 ${n}    0     0  ${lpad(bytes * 500, 5)}      0 --:--:-- --:--:-- --:--:-- ${lpad(bytes * 1000, 5)}`);
}

// ---------------------------------------------------------------- help

function cmdHelp(ctx, args) {
  if (args.length > 0) {
    const command = COMMANDS[args[0]];
    if (!command) {
      printErr(ctx, `help: no such command in this simulator: ${args[0]}`);
      return 1;
    }
    print(ctx, `${command.usage}\n    ${command.about}\n`);
    return 0;
  }
  print(ctx, HELP_TEXT);
  return 0;
}

// ============================================================================
// 11. The command table, help and nudges
// ============================================================================

const COMMANDS = {
  ls: { run: cmdLs, usage: 'ls [-lahtrSd1] [PATH...]', about: 'List a folder. -l shows mode, owner and size; -a shows hidden files; -h makes sizes readable.' },
  cd: { run: cmdCd, usage: 'cd [DIR]', about: 'Change the current folder. cd alone goes home; cd - goes back.' },
  pwd: { run: cmdPwd, usage: 'pwd', about: 'Print the current folder.' },
  cat: { run: cmdCat, usage: 'cat [-n] FILE...', about: 'Print whole files.' },
  head: { run: cmdHead, usage: 'head [-n N] [FILE...]', about: 'Print the first N lines (10 if you give no number).' },
  tail: { run: cmdTail, usage: 'tail [-n N] [FILE...]', about: 'Print the last N lines (10 if you give no number).' },
  grep: { run: cmdGrep, usage: 'grep [-ivncrEFwlq] PATTERN [FILE...]', about: 'Print the lines that match. -i ignores case, -v inverts, -n numbers, -r walks a folder.' },
  wc: { run: cmdWc, usage: 'wc [-lwc] [FILE...]', about: 'Count lines, words and bytes.' },
  echo: { run: cmdEcho, usage: 'echo [-n] [-e] TEXT...', about: 'Print text. echo $? prints the exit code of the last command.' },
  rm: { run: cmdRm, usage: 'rm [-rf] PATH...', about: 'Delete files; -r deletes folders too. There is no undo.' },
  chmod: { run: cmdChmod, usage: 'chmod [-R] MODE PATH...', about: 'Change who may read, write or run a file. MODE is 644, +x, u+rw, go-w and so on.' },
  sed: { run: cmdSed, usage: "sed [-n] [-i] [-E] 's/OLD/NEW/[g]' [FILE...]", about: "Edit text. -i changes the file itself. Also 'Np', 'N,Mp', 'Nd' and '/PATTERN/d'." },
  ps: { run: cmdPs, usage: 'ps | ps aux | ps -ef', about: 'List processes. ps aux shows all of them, with their owner and PID.' },
  kill: { run: cmdKill, usage: 'kill [-9] PID...', about: 'Ask a process to stop (TERM). -9 stops it outright (KILL).' },
  ss: { run: cmdSs, usage: 'ss -ltnp', about: 'List listening TCP ports. -p adds the process; other users\' processes show only under sudo.' },
  df: { run: cmdDf, usage: 'df [-h] [PATH...]', about: 'Show how full each filesystem is.' },
  du: { run: cmdDu, usage: 'du [-sh] [-a] [-c] [-d N] [PATH...]', about: 'Show how much space folders use. du -sh PATH/* compares the entries of one folder.' },
  systemctl: { run: cmdSystemctl, usage: 'systemctl status|start|stop|restart|is-active|cat NAME', about: 'Inspect and control services. Also: systemctl --failed, systemctl list-units.' },
  journalctl: { run: cmdJournalctl, usage: 'journalctl [-u NAME] [-n N] [-r]', about: 'Read the system log. -u picks one service, -n the last N lines, -r newest first.' },
  curl: { run: cmdCurl, usage: 'curl [-s] [-i] [-I] [-v] [-o FILE] [-w FORMAT] URL', about: 'Make an HTTP request, e.g. curl localhost:8080' },
  sudo: { run: null, usage: 'sudo [-u USER] COMMAND', about: 'Run one command as root, or as USER with -u.' },
  help: { run: cmdHelp, usage: 'help [COMMAND]', about: 'Show this list, or one command in detail.' },
  clear: { run: cmdClear, usage: 'clear', about: 'Clear the screen.' },
};

export const commandNames = Object.keys(COMMANDS);

// Commands that are part of bash itself, so `sudo cd` cannot find them. True on a real host too.
const SHELL_BUILTINS = ['cd', 'help'];

const HELP_TEXT = [
  'Commands in this simulator (help NAME says more about one):',
  '  look around    ls  cd  pwd  cat  head  tail  grep  wc  echo',
  '  change files   rm  chmod  sed',
  '  processes      ps  kill',
  '  ports, disk    ss  df  du',
  '  services       systemctl  journalctl  curl',
  '  other          sudo  help  clear',
  'The shell also does:  a | b    > file   >> file    a && b    a ; b    "quotes"    *',
  'Changing the system needs sudo in front. Tab completes names, Up recalls a command.',
  '',
].join('\n');

// Real commands this simulator does not have, and what to use instead.
const NUDGES = {
  netstat: 'ss -ltnp', lsof: 'sudo ss -ltnp', nc: 'ss -ltnp or curl', telnet: 'curl',
  top: 'ps aux', htop: 'ps aux', free: 'ps aux', pgrep: 'ps aux | grep NAME',
  pkill: 'ps aux | grep NAME, then kill PID', killall: 'ps aux | grep NAME, then kill PID',
  vi: "sed -i 's/OLD/NEW/' FILE", vim: "sed -i 's/OLD/NEW/' FILE", nano: "sed -i 's/OLD/NEW/' FILE",
  less: 'cat, head or tail', more: 'cat, head or tail', awk: 'grep or sed', cut: 'grep or sed',
  find: 'ls -l or du -sh PATH/*', tree: 'ls -l', stat: 'ls -l', file: 'ls -l',
  service: 'systemctl status NAME', dmesg: 'journalctl', wget: 'curl', man: 'help NAME',
  lsblk: 'df -h', mount: 'df -h', ncdu: 'du -sh PATH/*', truncate: 'rm, or > FILE to empty a file you own',
  chown: 'chmod', whoami: `echo $USER (you are ${USER}; sudo runs one command as root)`, id: 'echo $USER',
  su: 'sudo COMMAND', history: 'the Up arrow', hostname: 'cat /etc/hostname', tee: '> FILE or >> FILE',
};

// Other real commands people try. They get a plain "not here" instead of "command not found".
const OTHER_REAL = [
  'mkdir', 'touch', 'cp', 'mv', 'ln', 'diff', 'sort', 'uniq', 'tr', 'xargs', 'which', 'date', 'uptime', 'env',
  'export', 'exit', 'logout', 'reboot', 'shutdown', 'apt', 'apt-get', 'dpkg', 'snap', 'docker', 'kubectl', 'git',
  'ssh', 'scp', 'ping', 'dig', 'nslookup', 'ip', 'ifconfig', 'python3', 'python', 'bash', 'sh', 'watch', 'sleep',
  'printf', 'test', 'true', 'false', 'nohup', 'crontab', 'strace', 'tcpdump', 'iptables', 'ufw', 'tar', 'gzip',
  'zcat', 'base64', 'openssl', 'nginx', 'perl', 'ruby', 'node', 'make', 'gcc', 'alias', 'source', 'set', 'unset',
];

// Exit code 127 is what a shell returns for a command it cannot find.
function notFound(ctx, name, viaSudo) {
  if (NUDGES[name]) {
    printErr(ctx, `${name}: not in this simulator. Try: ${NUDGES[name]}`);
  } else if (OTHER_REAL.includes(name) || (viaSudo && SHELL_BUILTINS.includes(name))) {
    const why = viaSudo && SHELL_BUILTINS.includes(name) ? `${name} is part of the shell, so sudo cannot run it` : 'not in this simulator';
    printErr(ctx, `${name}: ${why}. Type help to see what is.`);
  } else {
    printErr(ctx, viaSudo ? `sudo: ${name}: command not found` : `bash: ${name}: command not found`);
  }
  return viaSudo ? 1 : 127;
}

// ============================================================================
// 12. Tab completion
// ============================================================================

const SYSTEMCTL_VERBS = ['status', 'start', 'stop', 'restart', 'is-active', 'cat', 'list-units'];

// Complete the last word of a half-typed line. Returns { line, options }:
// `line` is the line with as much filled in as is certain; `options` lists the
// choices when there is more than one.
export function complete(state, line) {
  const cut = line.lastIndexOf(' ') + 1;
  const before = line.slice(0, cut);
  const partial = line.slice(cut);
  const choices = completions(state, before, partial);
  if (choices.length === 0) return { line, options: [] };
  if (choices.length === 1) return { line: before + choices[0], options: [] };

  let common = choices[0];
  for (const choice of choices) {
    while (!choice.startsWith(common)) common = common.slice(0, -1);
  }
  const grown = common.length > partial.length ? before + common : line;
  return { line: grown, options: choices.map((choice) => baseName(choice.trim().replace(/\/$/, '')) + (choice.endsWith('/') ? '/' : '')) };
}

// What could the last word be? Each choice ends in a space (finished) or a / (a folder).
function completions(state, before, partial) {
  const segment = before.split(/[|;&]/).pop().trim().split(/\s+/).filter(Boolean);
  const words = segment[0] === 'sudo' ? segment.slice(1) : segment;
  const starting = (names) => names.filter((name) => name.startsWith(partial)).map((name) => name + ' ');
  const unitNames = Object.keys(state.level.services || {});

  if (words.length === 0) return starting(commandNames);
  if (words[0] === 'help') return starting(commandNames);
  if (words[0] === 'systemctl' && words.length === 1) return starting(SYSTEMCTL_VERBS);
  if (words[0] === 'systemctl') return starting(unitNames);
  if (words[0] === 'journalctl' && words[words.length - 1].endsWith('u')) return starting(unitNames);
  return pathCompletions(state, partial);
}

function pathCompletions(state, partial) {
  const slash = partial.lastIndexOf('/');
  const typedFolder = partial.slice(0, slash + 1);
  const prefix = partial.slice(slash + 1);
  const folder = fullPath(state, typedFolder.replace(/^~\//, HOME + '/') || '.');
  const node = state.nodes[folder];
  if (!node || !node.dir || !allowed(node, USER, 'r')) return [];
  return childNames(state, folder)
    .filter((name) => name.startsWith(prefix) && (prefix.startsWith('.') || !name.startsWith('.')))
    .map((name) => typedFolder + name + (state.nodes[joinPath(folder, name)].dir ? '/' : ' '));
}

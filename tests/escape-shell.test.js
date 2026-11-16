// Tests for Escape Shell.
// Three parts:
//   1. Every scenario: the data is well formed, the fault is there at the start with its
//      clue in the journal, the solution wins, and shortcuts (restart without a fix) do not.
//   2. Each scenario's own story: the evidence shows up where the hints say it does.
//   3. The shell and the commands, on a small made-up host called `lab`.

import { test, assert } from './harness.js';
import { levels } from '../site/games/escape-shell/levels.js';
import { start, apply, replay, prompt, complete, goalHolds, commandNames, stars } from '../site/games/escape-shell/logic.js';

// ------------------------------------------------------------------ helpers

// Everything the last command printed, as one text.
function printed(state) {
  return state.output.map((entry) => entry.text).join('\n');
}

// Run some lines and return the final state.
function session(level, lines) {
  return replay(level, lines);
}

// Run some lines and return what the last one printed.
function output(level, lines) {
  return printed(session(level, lines));
}

// The command word of a line, ignoring a leading sudo: "sudo rm x" -> "rm".
function commandOf(line) {
  const words = line.trim().split(/\s+/);
  return words[0] === 'sudo' ? words[1] : words[0];
}

function byId(id) {
  return levels.find((level) => level.id === id);
}

const CHANGES_THINGS = ['rm', 'chmod', 'sed', 'kill'];    // commands a fix is made of
const EXIT_NOT_FOUND = 127;

// ------------------------------------------------------- 1. every scenario

test('scenario ids are unique and start with es-', () => {
  const ids = levels.map((level) => level.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id.startsWith('es-'), id);
});

for (const level of levels) {
  const names = Object.keys(level.services);

  test(`${level.id}: has every field the page needs`, () => {
    for (const field of ['title', 'brief']) assert.ok(typeof level[field] === 'string' && level[field].length > 0, field);
    for (const field of ['disks', 'goal', 'chips', 'hints', 'solution']) assert.ok(Array.isArray(level[field]) && level[field].length > 0, field);
    assert.ok(level.hints.length >= 3, 'at least three hints');
    for (const field of ['cause', 'evidence', 'habit']) assert.ok(level.debrief[field].length > 0, `debrief.${field}`);
    assert.ok(names.length > 0, 'at least one service');
  });

  test(`${level.id}: at the start the goal is not met`, () => {
    const state = start(level);
    assert.equal(state.status, 'playing');
    assert.equal(goalHolds(state), false);
    assert.equal(replay(level, []).status, 'playing');
  });

  test(`${level.id}: every service starts in the state the level says`, () => {
    const state = start(level);
    for (const name of names) assert.equal(state.units[name].state, level.services[name].state, name);
  });

  test(`${level.id}: the clue is in the journal before anything is typed`, () => {
    for (const name of names.filter((n) => level.services[n].state === 'failed')) {
      const journal = output(level, [`journalctl -u ${name}`]);
      const told = level.services[name].needs.some((need) => [].concat(need.log).every((line) => journal.includes(line)));
      assert.ok(told, `journalctl -u ${name} shows why it failed`);
      assert.ok(journal.includes(`Failed to start ${name}.service`), 'systemd reports the failed start');
    }
  });

  test(`${level.id}: the solution wins, on its last command`, () => {
    assert.equal(replay(level, level.solution).status, 'won');
    assert.equal(replay(level, level.solution.slice(0, -1)).status, 'playing');
  });

  test(`${level.id}: no solution command is "command not found"`, () => {
    let state = start(level);
    for (const line of level.solution) {
      state = apply(state, line);
      assert.ok(state.code !== EXIT_NOT_FOUND, `"${line}" was not found`);
    }
  });

  test(`${level.id}: restarting without fixing does not win`, () => {
    const lines = [...names.map((name) => `sudo systemctl restart ${name}`), 'curl localhost:8080'];
    const state = replay(level, lines);
    assert.equal(state.status, 'playing');
  });

  test(`${level.id}: looking without fixing does not win`, () => {
    const lookOnly = level.solution.filter((line) => !CHANGES_THINGS.includes(commandOf(line)));
    assert.ok(lookOnly.length < level.solution.length, 'the solution contains a fix');
    assert.equal(replay(level, lookOnly).status, 'playing');
  });

  test(`${level.id}: every fix in the solution is needed`, () => {
    level.solution.forEach((line, index) => {
      if (!CHANGES_THINGS.includes(commandOf(line))) return;
      const without = level.solution.filter((_, i) => i !== index);
      assert.equal(replay(level, without).status, 'playing', `still wins without "${line}"`);
    });
  });

  test(`${level.id}: chips are real commands and cover the solution`, () => {
    for (const chip of level.chips) {
      assert.ok(commandNames.includes(commandOf(chip)), `chip "${chip}"`);
      assert.ok(apply(start(level), chip).code !== EXIT_NOT_FOUND, `chip "${chip}" was not found`);
    }
    const offered = level.chips.map(commandOf);
    for (const line of level.solution) assert.ok(offered.includes(commandOf(line)), `no chip for "${line}"`);
  });

  test(`${level.id}: the same commands always give the same result`, () => {
    assert.deepEqual(replay(level, level.solution).output, replay(level, level.solution).output);
  });
}

// ------------------------------------------------- 2. each scenario's story

test('es-01: df shows the full disk, du finds the folder, and only the big file frees enough', () => {
  const level = byId('es-01');
  assert.ok(output(level, ['df -h']).includes('/dev/sda1        20G   20G     0 100% /'));
  assert.ok(output(level, ['du -sh /var/log/*']).includes('14G\t/var/log/sample-app'));
  assert.ok(output(level, ['rm /var/log/sample-app/debug.log']).includes('Permission denied'));

  const small = session(level, ['sudo rm /var/log/syslog /var/log/journal/system.journal', 'sudo systemctl restart sample-app']);
  assert.equal(small.units['sample-app'].state, 'failed', 'deleting the small logs is not enough');

  const fixed = session(level, ['sudo rm /var/log/sample-app/debug.log', 'df -h']);
  assert.ok(printed(fixed).includes('/dev/sda1        20G  6.0G   14G  31% /'));
});

test('es-02: the port holder is hidden without sudo, and the stray server answers curl', () => {
  const level = byId('es-02');
  assert.ok(!output(level, ['ss -ltnp']).includes('python3'));
  assert.ok(output(level, ['sudo ss -ltnp']).includes('users:(("python3",pid=1337,fd=3))'));
  assert.ok(output(level, ['kill 1337']).includes('Operation not permitted'));

  const early = session(level, ['curl localhost:8080']);
  assert.ok(printed(early).includes('Directory listing'));
  assert.ok(output(level, ['curl -i localhost:8080']).includes('Server: SimpleHTTP/0.6 Python/3.12.3'), 'curl -i names the program');
  assert.equal(early.status, 'playing', 'an answer from the wrong program does not win');

  const freed = session(level, ['sudo kill 1337', 'curl localhost:8080']);
  assert.equal(freed.code, 7, 'nothing listens until sample-app is restarted');
});

test('es-03: the two faults show up one after the other', () => {
  const level = byId('es-03');
  assert.ok(output(level, ['cat /etc/sample-app/app.conf']).includes('Permission denied'));
  assert.ok(output(level, ['sudo -u sample-app cat /etc/sample-app/app.conf']).includes('Permission denied'));
  assert.ok(output(level, ['ls -l /etc/sample-app']).includes('-rw------- 1 root root'));
  assert.ok(output(level, ['systemctl cat sample-app']).includes('User=sample-app'));

  const readable = ['sudo chmod 644 /etc/sample-app/app.conf', 'sudo systemctl restart sample-app', 'journalctl -u sample-app -n 5'];
  assert.ok(output(level, readable).includes('log_level must be one of'));

  const valueOnly = ["sudo sed -i 's/quiet/info/' /etc/sample-app/app.conf", 'sudo systemctl restart sample-app', 'journalctl -u sample-app -n 5'];
  assert.ok(output(level, valueOnly).includes('permission denied'));
});

test('es-04: the database has to come up first, and its lock file follows the process', () => {
  const level = byId('es-04');
  assert.ok(output(level, ['ls /var/lib/sample-db']).includes('Permission denied'));
  assert.ok(output(level, ['ps aux | grep sample-db']).split('\n').length === 1, 'only the grep itself');
  assert.ok(output(level, ['sudo systemctl start sample-db']).includes('Job for sample-db.service failed'));

  const dbUp = session(level, ['sudo rm /var/lib/sample-db/db.lock', 'sudo systemctl start sample-db', 'curl localhost:8080']);
  assert.equal(dbUp.units['sample-db'].state, 'active');
  assert.equal(dbUp.code, 7, 'sample-app still has to be restarted');
  assert.equal(dbUp.nodes['/var/lib/sample-db/db.lock'].text, `${dbUp.units['sample-db'].pid}\n`);

  const pid = dbUp.units['sample-db'].pid;
  const crashed = apply(apply(dbUp, `sudo kill -9 ${pid}`), 'sudo systemctl start sample-db');
  assert.equal(crashed.units['sample-db'].state, 'failed', 'kill -9 leaves the lock behind');
  const stopped = apply(apply(dbUp, 'sudo systemctl stop sample-db'), 'sudo ls /var/lib/sample-db');
  assert.ok(!printed(stopped).includes('db.lock'), 'a clean stop removes the lock');
});

// --------------------------------------------- 3. the shell and the commands

const lab = {
  id: 'lab', title: 'lab', brief: 'a test host',
  disks: [{ device: '/dev/sda1', mount: '/', sizeMb: 1000, osUsedMb: 388 }],
  files: {
    '/home/ops/notes.txt': { owner: 'ops', text: 'alpha\nbeta gamma\nAlpha two\n' },
    '/home/ops/my file.txt': { owner: 'ops', text: 'spaced\n' },
    '/etc/sample-app/app.conf': 'port=8080\nlog_level=info\n',
    '/etc/secret.conf': { mode: '600', text: 'token=example\n' },
    '/var/log/big.log': { sizeMb: 300, text: 'x\n' },
    '/var/log/small.log': 'one\ntwo\nthree\n',
    '/srv/private/': { owner: 'sample-db', mode: '700' },
    '/srv/private/inner.txt': { owner: 'sample-db', text: 'hidden\n' },
  },
  processes: [
    { pid: 1500, user: 'deploy', cmd: 'python3 -m http.server 9000', port: 9000, response: 'hello\n' },
    { pid: 1600, user: 'ops', cmd: 'sleep 1000' },
  ],
  services: {
    'sample-app': {
      description: 'Sample App', user: 'sample-app', exec: '/opt/sample-app/bin/sample-app',
      port: 8080, response: 'ok\n', state: 'active',
      needs: [{ fileMatches: ['/etc/sample-app/app.conf', '^port=8080$'], log: 'FATAL bad port' }],
    },
  },
  goal: [{ fileAbsent: '/etc/hostname' }],
  chips: ['ls'], hints: ['x'], debrief: { cause: 'x', evidence: 'x', habit: 'x' }, solution: [],
};

test('quoting: double, single and backslash', () => {
  assert.equal(output(lab, ['echo "a  b" \'c  d\' e\\ f']), 'a  b c  d e f');
  assert.equal(output(lab, ['echo \'$HOME\' "$HOME" $USER']), '$HOME /home/ops ops');
  assert.equal(output(lab, ['cat "my file.txt"']), 'spaced');
  assert.equal(output(lab, ['echo "a | b > c"']), 'a | b > c');
  const open = session(lab, ['echo "oops']);
  assert.equal(open.code, 2);
  assert.ok(printed(open).includes('unexpected EOF'));
});

test('pipes carry output along and the last command sets the exit code', () => {
  assert.equal(output(lab, ['cat notes.txt | grep -i alpha | wc -l']), '2');
  const state = session(lab, ['cat nope.txt | wc -l']);
  assert.equal(printed(state), 'cat: nope.txt: No such file or directory\n0');
  assert.equal(state.code, 0);
  assert.equal(session(lab, ['| wc']).code, 2);
});

test('&& || ; and $?', () => {
  assert.equal(output(lab, ['ls /nope && echo yes']), "ls: cannot access '/nope': No such file or directory");
  assert.ok(output(lab, ['ls /nope || echo no']).endsWith('no'));
  assert.equal(output(lab, ['echo a; echo b']), 'a\nb');
  assert.equal(output(lab, ['ls /nope', 'echo $?']), '2');
  assert.equal(output(lab, ['pwd', 'echo $?']), '0');
});

test('paths: cd, relative paths, ~ and the prompt', () => {
  assert.equal(output(lab, ['cd /var/log', 'pwd']), '/var/log');
  assert.equal(output(lab, ['cd /var/log', 'cd ..', 'pwd']), '/var');
  assert.equal(output(lab, ['cd /var/log', 'cat ./small.log | head -n 1']), 'one');
  assert.equal(output(lab, ['cd /etc', 'cat ../var/log/small.log | tail -n 1']), 'three');
  assert.equal(output(lab, ['cd /etc', 'cd', 'pwd']), '/home/ops');
  assert.equal(output(lab, ['cd /etc', 'cd /var', 'cd -']), '/etc');
  assert.equal(output(lab, ['cat ~/notes.txt | wc -l']), '3');
  assert.equal(prompt(start(lab)), 'ops@sample-host:~$ ');
  assert.equal(prompt(session(lab, ['cd /var/log'])), 'ops@sample-host:/var/log$ ');
  assert.equal(session(lab, ['cd /nope']).code, 1);
  assert.ok(output(lab, ['cd /etc/hostname']).includes('Not a directory'));
  assert.ok(output(lab, ['cd /srv/private']).includes('Permission denied'));
});

test('redirects: > replaces, >> appends, 2> catches errors', () => {
  assert.equal(output(lab, ['echo hello > out.txt', 'cat out.txt']), 'hello');
  assert.equal(output(lab, ['echo one > out.txt', 'echo two >> out.txt', 'cat out.txt']), 'one\ntwo');
  assert.equal(output(lab, ['echo one > out.txt', 'echo two > out.txt', 'cat out.txt']), 'two');
  assert.equal(output(lab, ['ls /nope 2> err.txt']), '');
  assert.ok(output(lab, ['ls /nope 2> err.txt', 'cat err.txt']).includes('cannot access'));
  assert.equal(output(lab, ['ls /nope 2>&1 | wc -l']), '1');
  assert.equal(output(lab, ['cat notes.txt > /dev/null']), '');
  assert.equal(output(lab, ['grep alpha notes.txt > hits.txt', 'wc -l hits.txt']), '1 hits.txt');
});

test('redirects are opened as ops, even under sudo', () => {
  const plain = session(lab, ['echo x > /etc/new.conf']);
  assert.equal(printed(plain), 'bash: /etc/new.conf: Permission denied');
  assert.equal(plain.code, 1);
  assert.equal(printed(session(lab, ['sudo echo x > /etc/new.conf'])), 'bash: /etc/new.conf: Permission denied');
});

test('wildcards expand to sorted paths; quoted or unmatched ones stay as typed', () => {
  assert.equal(output(lab, ['echo /var/log/*.log']), '/var/log/big.log /var/log/small.log');
  assert.equal(output(lab, ['echo /var/log/*.txt']), '/var/log/*.txt');
  assert.equal(output(lab, ['echo "*"']), '*');
  assert.equal(output(lab, ['echo *.txt']), 'my file.txt notes.txt');
  assert.equal(output(lab, ['echo /var/log/sma??.log']), '/var/log/small.log');
  assert.ok(output(lab, ['sudo ls /srv/private/*']).includes("cannot access '/srv/private/*'"), 'the shell expands * before sudo runs');
});

test('sed: s///, -i, other separators, &, line ranges and delete', () => {
  assert.equal(output(lab, ["sed 's/a/A/' notes.txt"]), 'Alpha\nbetA gamma\nAlphA two');
  assert.equal(output(lab, ["sed 's/a/A/g' notes.txt"]), 'AlphA\nbetA gAmmA\nAlphA two');
  assert.equal(output(lab, ["sed 's/a/A/' notes.txt", 'cat notes.txt']), 'alpha\nbeta gamma\nAlpha two', 'without -i the file is untouched');
  assert.equal(output(lab, ["sed -i 's/beta/BETA/' notes.txt", 'cat notes.txt']), 'alpha\nBETA gamma\nAlpha two');
  assert.equal(output(lab, ["echo /var/log | sed 's#/var#/srv#'"]), '/srv/log');
  assert.equal(output(lab, ["echo port=80 | sed 's/[0-9]*$/<&>/'"]), 'port=<80>');
  assert.equal(output(lab, ["sed -n '2p' notes.txt"]), 'beta gamma');
  assert.equal(output(lab, ["sed -n '2,3p' notes.txt"]), 'beta gamma\nAlpha two');
  assert.equal(output(lab, ["sed '/beta/d' notes.txt"]), 'alpha\nAlpha two');
  assert.equal(output(lab, ["sed -E 's/(al)(pha)/\\2\\1/' notes.txt | head -n 1"]), 'phaal');
  assert.equal(session(lab, ["sed 's/a/b' notes.txt"]).code, 1);
});

test('sed -i in /etc needs sudo, and says so the way sed does', () => {
  const plain = session(lab, ["sed -i 's/info/warn/' /etc/sample-app/app.conf"]);
  assert.ok(printed(plain).startsWith("sed: couldn't open temporary file /etc/sample-app/sed"));
  assert.equal(plain.code, 4);
  assert.equal(output(lab, ["sudo sed -i 's/info/warn/' /etc/sample-app/app.conf", 'grep log_level /etc/sample-app/app.conf']), 'log_level=warn');
});

test('grep: flags, file names and exit codes', () => {
  assert.equal(output(lab, ['grep alpha notes.txt']), 'alpha');
  assert.equal(output(lab, ['grep -i alpha notes.txt']), 'alpha\nAlpha two');
  assert.equal(output(lab, ['grep -n gamma notes.txt']), '2:beta gamma');
  assert.equal(output(lab, ['grep -v -i alpha notes.txt']), 'beta gamma');
  assert.equal(output(lab, ['grep -c -i alpha notes.txt']), '2');
  assert.equal(output(lab, ['grep -E "one|three" /var/log/small.log']), 'one\nthree');
  assert.equal(output(lab, ['grep "one\\|three" /var/log/small.log']), 'one\nthree');
  assert.equal(output(lab, ['grep "one|three" /var/log/small.log']), '', 'a plain | is just a character without -E');
  assert.equal(output(lab, ['grep -rn two /var/log']), '/var/log/small.log:2:two');
  assert.equal(output(lab, ['grep o /var/log/small.log notes.txt']), '/var/log/small.log:one\n/var/log/small.log:two\nnotes.txt:Alpha two');
  assert.equal(session(lab, ['grep zebra notes.txt']).code, 1);
  assert.equal(session(lab, ['grep alpha nope.txt']).code, 2);
  assert.ok(output(lab, ['grep x /etc']).includes('Is a directory'));
});

test('wc, head and tail', () => {
  assert.equal(output(lab, ['wc -l /var/log/small.log']), '3 /var/log/small.log');
  assert.equal(output(lab, ['wc /var/log/small.log']), ' 3  3 14 /var/log/small.log');
  assert.equal(output(lab, ['cat /var/log/small.log | wc']), '      3       3      14');
  assert.equal(output(lab, ['head -n 1 notes.txt']), 'alpha');
  assert.equal(output(lab, ['head -2 notes.txt']), 'alpha\nbeta gamma');
  assert.equal(output(lab, ['tail -n 1 notes.txt']), 'Alpha two');
  assert.equal(output(lab, ['tail -n +2 notes.txt']), 'beta gamma\nAlpha two');
  assert.equal(output(lab, ['head -n 1 notes.txt /var/log/small.log']), '==> notes.txt <==\nalpha\n\n==> /var/log/small.log <==\none');
  assert.equal(session(lab, ['tail -f notes.txt']).code, 1);
});

test('ls: plain, long, hidden files and errors', () => {
  assert.equal(output(lab, ['ls']), 'my file.txt  notes.txt');
  assert.equal(output(lab, ['ls | wc -l']), '2', 'one name per line when piped');
  assert.equal(output(lab, ['echo x > .hidden', 'ls']), 'my file.txt  notes.txt');
  assert.ok(output(lab, ['echo x > .hidden', 'ls -a']).includes('.hidden'));
  assert.equal(output(lab, ['ls -l /var/log']), 'total 307208\n-rw-r--r-- 1 root root 314572802 Nov 12 08:30 big.log\n-rw-r--r-- 1 root root        14 Nov 12 08:30 small.log');
  assert.equal(output(lab, ['ls -lh /var/log/big.log']), '-rw-r--r-- 1 root root 301M Nov 12 08:30 /var/log/big.log');
  assert.equal(output(lab, ['ls -ld /srv/private']), 'drwx------ 2 sample-db sample-db 4096 Nov 12 08:30 /srv/private');
  assert.equal(output(lab, ['ls -ld /tmp']).slice(0, 10), 'drwxrwxrwt');
  const missing = session(lab, ['ls /nope']);
  assert.equal(missing.code, 2);
  assert.ok(output(lab, ['ls /srv/private']).includes("cannot open directory '/srv/private': Permission denied"));
  assert.equal(output(lab, ['sudo ls /srv/private']), 'inner.txt');
});

test('permissions: reading, sudo and sudo -u', () => {
  assert.equal(output(lab, ['cat /etc/secret.conf']), 'cat: /etc/secret.conf: Permission denied');
  assert.equal(output(lab, ['sudo cat /etc/secret.conf']), 'token=example');
  assert.equal(output(lab, ['sudo -u sample-app cat /etc/secret.conf']), 'cat: /etc/secret.conf: Permission denied');
  assert.equal(output(lab, ['cat /srv/private/inner.txt']), 'cat: /srv/private/inner.txt: Permission denied');
  assert.equal(output(lab, ['sudo -u sample-db cat /srv/private/inner.txt']), 'hidden');
  assert.ok(output(lab, ['sudo -u nobody-here ls']).includes('unknown user'));
  assert.ok(output(lab, ['sudo cd /etc']).includes('part of the shell'));
});

test('chmod: numbers, letters, and only the owner or root may', () => {
  assert.equal(output(lab, ['chmod 600 notes.txt', 'ls -l notes.txt']).slice(0, 10), '-rw-------');
  assert.equal(output(lab, ['chmod +x notes.txt', 'ls -l notes.txt']).slice(0, 10), '-rwxr-xr-x');
  assert.equal(output(lab, ['chmod u+x,go-r notes.txt', 'ls -l notes.txt']).slice(0, 10), '-rwx------');
  assert.equal(output(lab, ['chmod o=r,g= notes.txt', 'ls -l notes.txt']).slice(0, 10), '-rw----r--');
  assert.equal(output(lab, ['chmod 644 /etc/secret.conf']), "chmod: changing permissions of '/etc/secret.conf': Operation not permitted");
  assert.equal(output(lab, ['sudo chmod 644 /etc/secret.conf', 'cat /etc/secret.conf']), 'token=example');
  assert.ok(output(lab, ['chmod banana notes.txt']).includes('invalid mode'));
  assert.equal(session(lab, ['chmod 644']).code, 1);
});

test('rm: needs write access to the folder, -r for folders, and refuses /', () => {
  assert.equal(output(lab, ['rm notes.txt', 'ls']), 'my file.txt');
  assert.equal(output(lab, ['rm /var/log/small.log']), "rm: cannot remove '/var/log/small.log': Permission denied");
  assert.equal(output(lab, ['sudo rm /var/log/small.log', 'ls /var/log']), 'big.log');
  assert.equal(output(lab, ['sudo rm /var/log']), "rm: cannot remove '/var/log': Is a directory");
  assert.equal(output(lab, ['sudo rm -rf /var/log', 'ls /var']), 'lib');
  assert.equal(session(lab, ['rm nope.txt']).code, 1);
  assert.equal(session(lab, ['rm -f nope.txt']).code, 0);
  assert.ok(output(lab, ['sudo rm -rf /']).includes('dangerous'));
  assert.ok(output(lab, ['sudo rm -rf /', 'ls /']).includes('etc'));
});

test('unknown words: 127 for nonsense, a nudge for real tools that are not here', () => {
  const nonsense = session(lab, ['frobnicate now']);
  assert.equal(printed(nonsense), 'bash: frobnicate: command not found');
  assert.equal(nonsense.code, 127);
  const netstat = session(lab, ['netstat -tlnp']);
  assert.ok(printed(netstat).includes('ss -ltnp'));
  assert.equal(netstat.code, 127);
  assert.ok(output(lab, ['vim /etc/sample-app/app.conf']).includes('sed -i'));
  assert.ok(output(lab, ['top']).includes('ps aux'));
  assert.equal(printed(session(lab, ['sudo frobnicate'])), 'sudo: frobnicate: command not found');
});

test('help lists every command, and help NAME explains one', () => {
  const text = output(lab, ['help']);
  for (const name of commandNames) assert.ok(text.includes(name), name);
  assert.ok(output(lab, ['help grep']).includes('grep [-'));
  assert.ok(output(lab, ['ls --help']).includes('ls [-'));
  assert.equal(session(lab, ['clear']).clear, true);
});

test('df and du: sizes add up and round the way the real tools do', () => {
  // 388 MB of system + 300 MB big.log + 12 MB program + small files = just over 700 MB of 1000.
  // sizeMb counts in the same MiB as the files, so Size = Used + Avail; df -h rounds each one up.
  assert.ok(output(lab, ['df -h']).includes('/dev/sda1      1000M  701M  300M  71% /'));
  assert.ok(output(lab, ['df -h /var/log']).split('\n').length === 2, 'one disk for one path');
  assert.ok(output(lab, ['df']).includes('Filesystem     1K-blocks   Used Available Use% Mounted on'));
  assert.ok(output(lab, ['sudo rm /var/log/big.log', 'df -h']).includes('/dev/sda1      1000M  401M  600M  41% /'));
  assert.equal(output(lab, ['du -sh /var/log']), '301M\t/var/log');
  assert.equal(output(lab, ['du -sh /var/log/*']), '301M\t/var/log/big.log\n4.0K\t/var/log/small.log');
  assert.equal(output(lab, ['du -s /var/log']), '307212\t/var/log');
  assert.equal(output(lab, ['du -ah /etc/sample-app']), '4.0K\t/etc/sample-app/app.conf\n8.0K\t/etc/sample-app');
  assert.ok(output(lab, ['du -sh /srv/private']).includes("cannot read directory '/srv/private': Permission denied"));
});

test('ps: every process, the pipeline itself, and long user names cut short', () => {
  const all = output(lab, ['ps aux']);
  assert.ok(all.startsWith('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND'));
  assert.ok(all.includes('python3 -m http.server 9000'));
  assert.ok(/^sample-\+ +\d+ .*\/opt\/sample-app\/bin\/sample-app$/m.test(all));
  const grepped = output(lab, ['ps aux | grep sleep']).split('\n');
  assert.equal(grepped.length, 2);
  assert.ok(grepped[1].endsWith('grep --color=auto sleep'));
  assert.ok(output(lab, ['ps -ef']).startsWith('UID          PID    PPID  C STIME TTY          TIME CMD'));
  assert.ok(output(lab, ['ps']).includes('bash'));
});

test('kill: own processes yes, others need sudo, and the wording matches the real tools', () => {
  assert.ok(!output(lab, ['kill 1600', 'ps aux']).includes('sleep 1000'));
  assert.equal(output(lab, ['kill 1500']), 'bash: kill: (1500) - Operation not permitted');
  assert.ok(!output(lab, ['sudo kill 1500', 'ps aux']).includes('http.server'));
  assert.equal(output(lab, ['kill 99999']), 'bash: kill: (99999) - No such process');
  assert.equal(output(lab, ['sudo kill 99999']), 'kill: (99999): No such process');
  assert.equal(session(lab, ['kill']).code, 2);
  assert.ok(output(lab, ['sudo kill 1', 'ps aux']).includes('/sbin/init'), 'pid 1 survives');
});

test('killing a service: TERM stops it cleanly, KILL leaves it failed', () => {
  const pid = start(lab).units['sample-app'].pid;
  const termed = session(lab, [`sudo kill ${pid}`, 'systemctl status sample-app']);
  assert.ok(printed(termed).includes('Active: inactive (dead)'));
  assert.equal(termed.code, 3);
  const killed = output(lab, [`sudo kill -9 ${pid}`, 'systemctl status sample-app']);
  assert.ok(killed.includes('Active: failed (Result: signal)'));
  assert.ok(killed.includes('code=killed, status=9/KILL'));
});

test('ss: listeners, port names without -n, and the process column only for root', () => {
  const plain = output(lab, ['ss -ltnp']);
  assert.ok(plain.startsWith('State    Recv-Q   Send-Q     Local Address:Port      Peer Address:Port  Process'));
  assert.ok(/LISTEN .* 0\.0\.0\.0:8080 /.test(plain));
  assert.ok(!plain.includes('users:'), 'ops owns none of the listeners');
  const root = output(lab, ['sudo ss -ltnp']);
  assert.ok(root.includes('users:(("sample-app",pid='));
  assert.ok(root.includes('users:(("python3",pid=1500,fd=3))'));
  assert.ok(output(lab, ['ss -lt']).includes('0.0.0.0:ssh'));
  assert.ok(output(lab, ['ss -tulpn']).startsWith('Netid State'));
  assert.ok(!output(lab, ['ss -tn']).includes('LISTEN'), 'without -l only open connections are listed');
});

test('systemctl: status, exit codes and who may change things', () => {
  const up = session(lab, ['systemctl status sample-app']);
  assert.ok(printed(up).startsWith('● sample-app.service - Sample App'));
  assert.ok(printed(up).includes('Active: active (running) since Mon 2026-11-16 09:10:41 UTC; 3min 28s ago'));
  assert.equal(up.code, 0);
  assert.equal(output(lab, ['systemctl is-active sample-app']), 'active');

  const denied = session(lab, ['systemctl stop sample-app']);
  assert.ok(printed(denied).startsWith('Failed to stop sample-app.service: Interactive authentication required.'));
  assert.equal(denied.code, 1);
  assert.equal(denied.units['sample-app'].state, 'active');

  const down = session(lab, ['sudo systemctl stop sample-app', 'systemctl status sample-app.service']);
  assert.ok(printed(down).startsWith('○ sample-app.service'));
  assert.equal(down.code, 3);
  assert.equal(session(lab, ['sudo systemctl stop sample-app', 'systemctl is-active sample-app']).code, 3);

  const unknown = session(lab, ['systemctl status nope']);
  assert.equal(printed(unknown), 'Unit nope.service could not be found.');
  assert.equal(unknown.code, 4);
  assert.equal(session(lab, ['sudo systemctl restart nope']).code, 5);
  assert.ok(output(lab, ['systemctl --failed']).includes('0 loaded units listed.'));
});

test('a service with an unmet need fails to start and logs why', () => {
  const lines = ["sudo sed -i 's/8080/9999/' /etc/sample-app/app.conf", 'sudo systemctl restart sample-app'];
  const state = session(lab, lines);
  assert.equal(state.code, 1);
  assert.equal(printed(state), 'Job for sample-app.service failed because the control process exited with error code.\n'
    + 'See "systemctl status sample-app.service" and "journalctl -xeu sample-app.service" for details.');
  assert.equal(state.units['sample-app'].state, 'failed');
  assert.ok(output(lab, [...lines, 'journalctl -xeu sample-app.service']).includes('FATAL bad port'));
  assert.ok(output(lab, [...lines, 'systemctl status sample-app']).startsWith('× sample-app.service'));
  assert.ok(output(lab, [...lines, 'systemctl --failed']).includes('● sample-app.service loaded failed failed'));
  assert.ok(!output(lab, [...lines, 'sudo ss -ltnp']).includes('8080'), 'a failed service listens on nothing');
});

test('journalctl: one unit, the last N lines, newest first, and nothing for a stranger', () => {
  const all = output(lab, ['journalctl -u sample-app']).split('\n');
  assert.equal(all.length, 3);
  assert.ok(/^Nov 16 09:10:41 sample-host systemd\[1\]: Starting sample-app\.service - Sample App\.\.\.$/.test(all[0]));
  assert.ok(all[2].endsWith('Started sample-app.service - Sample App.'));
  assert.equal(output(lab, ['journalctl -u sample-app -n 1']), all[2]);
  assert.equal(output(lab, ['journalctl -n1 --unit=sample-app --no-pager']), all[2]);
  assert.equal(output(lab, ['journalctl -u sample-app -r']).split('\n')[0], all[2]);
  assert.equal(output(lab, ['journalctl -u nope']), '-- No entries --');
  assert.ok(output(lab, ['journalctl']).includes('sshd[2101]: Accepted publickey for ops'));
  assert.equal(session(lab, ['journalctl -f']).code, 1);
});

test('curl: an answer, a refusal, an unknown host, and the usual flags', () => {
  const ok = session(lab, ['curl localhost:8080']);
  assert.equal(printed(ok), 'ok');
  assert.equal(ok.answered, 'sample-app');
  assert.equal(output(lab, ['curl http://127.0.0.1:8080/health']), 'ok');
  assert.equal(session(lab, ['curl localhost:9000']).answered, null, 'a stray process is not a service');

  const refused = session(lab, ['curl localhost:8081']);
  assert.equal(printed(refused), "curl: (7) Failed to connect to localhost port 8081 after 0 ms: Couldn't connect to server");
  assert.equal(refused.code, 7);
  assert.equal(session(lab, ['curl app.example.com']).code, 6);
  assert.equal(output(lab, ['curl -s localhost:8081']), '');
  assert.ok(output(lab, ['curl -I localhost:8080']).startsWith('HTTP/1.1 200 OK'));
  assert.equal(output(lab, ["curl -s -o /dev/null -w '%{http_code}\\n' localhost:8080"]), '200');
  assert.ok(output(lab, ['curl -v localhost:8080']).includes('> GET / HTTP/1.1'));
  assert.equal(output(lab, ['curl -s localhost:8080 | wc -c']), '3');
});

test('Tab completion: commands, services and paths', () => {
  const state = start(lab);
  assert.equal(complete(state, 'journ').line, 'journalctl ');
  assert.deepEqual(complete(state, 'systemctl st').options, ['status', 'start', 'stop']);
  assert.equal(complete(state, 'systemctl status sa').line, 'systemctl status sample-app ');
  assert.equal(complete(state, 'sudo systemctl res').line, 'sudo systemctl restart ');
  assert.equal(complete(state, 'journalctl -u s').line, 'journalctl -u sample-app ');
  assert.equal(complete(state, 'cat /etc/sample-app/a').line, 'cat /etc/sample-app/app.conf ');
  assert.equal(complete(state, 'ls /var/lo').line, 'ls /var/log/');
  assert.equal(complete(state, 'cat no').line, 'cat notes.txt ');
  assert.deepEqual(complete(state, 'cat /var/log/').options, ['big.log', 'small.log']);
  assert.equal(complete(state, 'cat /var/log/').line, 'cat /var/log/');
  assert.equal(complete(state, 'ps aux | gr').line, 'ps aux | grep ');
  assert.deepEqual(complete(state, 'cat /nope/x'), { line: 'cat /nope/x', options: [] });
});

test('stars: three, one less per hint, at least one for a win, none before it', () => {
  const level = byId('es-01');
  const won = replay(level, level.solution);
  assert.deepEqual([0, 1, 2, 3, 4].map((hints) => stars(won, hints)), [3, 2, 1, 1, 1]);
  assert.equal(stars(start(level), 0), 0);
});

test('apply never changes the state it was given', () => {
  const before = start(lab);
  const snapshot = JSON.stringify(before);
  apply(before, 'sudo rm -rf /var/log');
  apply(before, 'sudo systemctl stop sample-app');
  apply(before, 'echo x > note.txt');
  assert.equal(JSON.stringify(before), snapshot);
});

test('an empty line costs nothing, and nothing changes once a scenario is won', () => {
  const state = start(lab);
  assert.equal(apply(state, '   ').count, 0);
  assert.equal(apply(state, 'pwd').count, 1);
  const won = session(lab, ['sudo rm /etc/hostname']);
  assert.equal(won.status, 'won');
  assert.deepEqual(apply(won, 'ls'), won);
});

test('a level with a misspelt condition is reported, not silently ignored', () => {
  const broken = { ...lab, goal: [{ diskFreeMegabytes: ['/', 1] }] };
  assert.throws(() => start(broken) && apply(start(broken), 'pwd'));
});

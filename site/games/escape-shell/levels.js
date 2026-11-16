// SCENARIOS for Escape Shell.
// This file is data only. To change the game's content you edit this file and nothing else.
//
// Each scenario describes a small Linux host that has something wrong with it, and the
// goal that proves it is fixed. The rules in logic.js do the rest: they decide whether a
// service can start, and write the reason to the journal when it cannot.
//
// Schema. Fields marked * are required.
//
//  * id        unique text, starting "es-"
//  * title     shown in the scenario picker
//  * brief     the ticket the player reads first. Text between `backticks` is shown as code.
//  * disks     the real disks df shows: [{ device, mount, sizeMb, osUsedMb }]
//                osUsedMb is space taken by things that are not listed in `files`.
//                Free space = sizeMb - osUsedMb - the files below. One disk mounted on / is enough.
//    files     path -> the file's text, or an object with any of:
//                text     the content (keep it short)
//                mode     as for chmod, e.g. '600'. Default '644' (folders '755')
//                owner    default 'root'
//                sizeMb   pretend the file is this big; `text` is then just a sample of it
//                mtime    the "last changed" time ls -l shows, e.g. 'Nov 15 22:47'
//              A path ending in / is a folder; you only need one to set its owner or mode.
//    processes extra running programs: [{ pid, user, cmd, port, response, contentType, server }]
//                port      makes it listen there (it shows up in ss, and it blocks that port)
//                response  what curl gets back; leave it out for a non-HTTP program
//                server    the Server header that curl -i shows, e.g. 'nginx/1.24.0'
//  * services  name -> { description, user, exec, port, response, state, needs, bind, lockFile }
//                exec      the command line; its first word is the program file
//                port      the port it listens on once running
//                response  what curl gets back
//                state     what you expect at the start: 'active', 'failed' or 'inactive'.
//                          The game works the real state out from `needs`; the tests fail
//                          if it does not match what you wrote here.
//                needs     conditions that must hold for it to start, checked in order.
//                          Each has one condition (see below) plus `log`: the line, or list
//                          of lines, the service writes to the journal when it does not hold.
//                bind      address it listens on. Default '0.0.0.0'; '127.0.0.1' = this host only
//                lockFile  a file it creates while running. `kill -9` leaves it behind
//              List a service before the services that depend on it.
//  * goal      conditions that must all hold to win
//  * chips     commands offered as tap buttons. End one with a space to let the player
//              finish it by typing (for example 'sudo rm ').
//  * hints     shown one at a time, from a nudge to the full answer
//  * debrief   { cause, evidence, habit }: one or two sentences each, shown on the win screen
//  * solution  commands that win. The tests replay them, so a scenario that cannot be
//              won as written fails `python3 scripts/arcade.py test escape-shell`.
//
// Conditions, for `needs` and `goal`:
//    { diskFreeMb: [path, megabytes] }   the disk holding path has at least that much free
//    { fileMatches: [path, pattern] }    a line of the file matches the pattern (as for grep -E)
//    { fileReadableBy: [path, user] }    that user may read the file
//    { fileAbsent: path }                nothing exists at that path
//    { portFree: port }                  nothing is listening on the port
//    { processGone: text }               no running process has this text in its command line
//    { serviceActive: name }             that service is running
//    { serviceAnswers: name }            the player's last command was a curl that this service answered
//
// Commands the pretend shell has (use only these in `solution` and `chips`):
//   ls cd pwd cat head tail grep wc echo rm chmod sed ps kill ss df du systemctl
//   journalctl curl sudo help clear
// There is no chown, mv, cp or text editor; change a file with sed -i or echo >.
// In the game, `help` lists them. Adding a command means changing logic.js (the COMMANDS table).
//
// Besides "the solution wins", the tests also require of every scenario:
//   - the goal is not met at the start;
//   - each failed service's `log` lines are already in the journal before anything is typed;
//   - restarting services without fixing anything does not win;
//   - every rm, chmod, sed or kill in the solution is needed: leaving any one out stops it winning;
//   - every solution command is covered by a chip (a chip ending in a space counts for any
//     command that starts with it, e.g. 'sudo rm ').
// `response` can be left out of a service that does not answer HTTP (sample-db in es-04).
//
// To add a scenario: copy an entry, change it, and give it a new id. Open the game with
// ?dev on the end of the URL, win it, and paste the commands it shows into `solution`.
// Use example values only: sample-app, example.com, 10.0.0.x addresses.

export const levels = [
  {
    id: 'es-01',
    title: 'No space left',
    brief: 'sample-app went down overnight and will not start. Get `curl localhost:8080` to answer again.',
    disks: [{ device: '/dev/sda1', mount: '/', sizeMb: 20000, osUsedMb: 5954 }],
    files: {
      '/etc/sample-app/app.conf': 'port=8080\nlog_level=debug\nlog_dir=/var/log/sample-app\n',
      '/var/log/sample-app/': { owner: 'sample-app' },
      '/var/log/sample-app/app.log': {
        owner: 'sample-app', mtime: 'Nov 15 23:41',
        text: '2026-11-13T18:02:11Z INFO  sample-app 1.4.2 starting\n'
          + '2026-11-13T18:02:11Z INFO  listening on 0.0.0.0:8080\n'
          + '2026-11-15T23:41:07Z ERROR write /var/log/sample-app/debug.log: no space left on device\n'
          + '2026-11-15T23:41:07Z FATAL cannot write logs, exiting\n',
      },
      '/var/log/sample-app/debug.log': {
        owner: 'sample-app', mtime: 'Nov 15 23:41', sizeMb: 13900,
        text: '2026-11-15T23:41:06Z DEBUG request id=58119 path=/health took=1ms\n'
          + '2026-11-15T23:41:06Z DEBUG cache lookup key=session:58119 hit=false\n'
          + '2026-11-15T23:41:07Z DEBUG request id=58120 path=/health took=1ms\n'
          + '2026-11-15T23:41:07Z DEBUG cache lookup key=session:58120 hit=false\n',
      },
      '/var/log/syslog': { sizeMb: 38, mtime: 'Nov 16 09:10', text: 'Nov 16 09:10:41 sample-host systemd[1]: Reached target network.target - Network.\n' },
      '/var/log/auth.log': { mtime: 'Nov 16 09:14', text: 'Nov 16 09:14:01 sample-host sshd[2101]: Accepted publickey for ops from 198.51.100.7 port 51234 ssh2\n' },
      '/var/log/journal/system.journal': { sizeMb: 96, mtime: 'Nov 16 09:10' },
    },
    services: {
      'sample-app': {
        description: 'Sample App HTTP service', user: 'sample-app',
        exec: '/opt/sample-app/bin/sample-app --config /etc/sample-app/app.conf',
        port: 8080, response: 'sample-app: ok\n', state: 'failed',
        needs: [{ diskFreeMb: ['/var/log/sample-app', 200], log: 'FATAL open /var/log/sample-app/app.log: no space left on device' }],
      },
    },
    goal: [{ serviceAnswers: 'sample-app' }],
    chips: [
      'systemctl status sample-app', 'journalctl -u sample-app -n 20', 'df -h', 'du -sh /var/log/*',
      'ls -lh /var/log/sample-app', 'sudo rm ', 'sudo systemctl restart sample-app', 'curl localhost:8080',
    ],
    hints: [
      'Start with the service itself: `systemctl status sample-app`, then its log: `journalctl -u sample-app -n 20`.',
      'The log says there is no space left. `df -h` shows which filesystem is full.',
      'Find what is using the space: `du -sh /var/log/*`, then `ls -lh` inside the biggest folder.',
      'Delete the runaway file: `sudo rm /var/log/sample-app/debug.log`. Then `sudo systemctl restart sample-app` and check with `curl localhost:8080`.',
    ],
    debrief: {
      cause: 'A debug log grew until the root filesystem was full, so sample-app could not open its own log file and exited.',
      evidence: 'The journal said "no space left on device". `df -h` showed / at 100%, and `du -sh /var/log/*` pointed at one folder holding a 14G file.',
      habit: 'Read the journal first, then go from wide to narrow: df for the filesystem, du for the folder, ls -lh for the file. Afterwards fix the cause as well: here, log_level=debug and no log rotation.',
    },
    solution: [
      'systemctl status sample-app', 'journalctl -u sample-app -n 20', 'df -h', 'du -sh /var/log/*',
      'ls -lh /var/log/sample-app', 'sudo rm /var/log/sample-app/debug.log',
      'sudo systemctl restart sample-app', 'curl localhost:8080',
    ],
  },

  {
    id: 'es-02',
    title: 'Address already in use',
    brief: 'A deploy restarted sample-app this morning and it never came back. Get sample-app itself answering `curl localhost:8080`.',
    disks: [{ device: '/dev/sda1', mount: '/', sizeMb: 20000, osUsedMb: 6200 }],
    files: {
      '/etc/sample-app/app.conf': 'port=8080\nlog_level=info\n',
      '/home/deploy/': { owner: 'deploy' },
      '/home/deploy/release-notes.txt': { owner: 'deploy', text: 'sample-app 1.4.2\n- faster health check\n' },
    },
    processes: [
      {
        pid: 1337, user: 'deploy', cmd: 'python3 -m http.server 8080', port: 8080, start: 'Nov13',
        contentType: 'text/html; charset=utf-8', server: 'SimpleHTTP/0.6 Python/3.12.3',
        response: '<!DOCTYPE HTML>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Directory listing for /</title>\n</head>\n'
          + '<body>\n<h1>Directory listing for /</h1>\n<hr>\n<ul>\n<li><a href="release-notes.txt">release-notes.txt</a></li>\n</ul>\n<hr>\n</body>\n</html>\n',
      },
    ],
    services: {
      'sample-app': {
        description: 'Sample App HTTP service', user: 'sample-app',
        exec: '/opt/sample-app/bin/sample-app --config /etc/sample-app/app.conf',
        port: 8080, response: 'sample-app: ok\n', state: 'failed',
        needs: [{ portFree: 8080, log: 'FATAL listen tcp 0.0.0.0:8080: bind: address already in use' }],
      },
    },
    goal: [{ serviceAnswers: 'sample-app' }],
    chips: [
      'systemctl status sample-app', 'journalctl -u sample-app -n 20', 'ss -ltnp', 'sudo ss -ltnp',
      'ps aux | grep ', 'sudo kill ', 'sudo systemctl restart sample-app', 'curl localhost:8080',
    ],
    hints: [
      'Read why it failed: `journalctl -u sample-app -n 20`.',
      '"Address already in use" means something else is listening on 8080. `ss -ltnp` lists the listening TCP ports.',
      'The Process column is empty for sockets that belong to another user. `sudo ss -ltnp` shows the program and its PID.',
      'Look before you kill: `ps aux | grep 1337`. Then `sudo kill 1337`, `sudo systemctl restart sample-app` and `curl localhost:8080`.',
    ],
    debrief: {
      cause: 'A test web server left running by another user was still listening on port 8080, so sample-app could not bind it.',
      evidence: 'The journal said "bind: address already in use", and curl got a folder listing instead of the app. `sudo ss -ltnp` named the program and PID holding the port; without sudo that column is blank for other users\' sockets.',
      habit: 'For "address already in use", find the listener with ss -ltnp, look at it with ps before touching it, and try a plain kill (TERM) before kill -9.',
    },
    solution: [
      'systemctl status sample-app', 'journalctl -u sample-app -n 20', 'curl localhost:8080', 'sudo ss -ltnp',
      'ps aux | grep 1337', 'sudo kill 1337', 'sudo systemctl restart sample-app', 'curl localhost:8080',
    ],
  },

  {
    id: 'es-03',
    title: 'Permission denied',
    brief: 'Someone edited the sample-app config late last night, and this morning\'s restart failed. Get `curl localhost:8080` answering.',
    disks: [{ device: '/dev/sda1', mount: '/', sizeMb: 20000, osUsedMb: 6200 }],
    files: {
      '/etc/sample-app/app.conf': { mode: '600', mtime: 'Nov 15 22:47', text: '# edited by hand to quieten the logs\nport=8080\nlog_level=quiet\n' },
      '/etc/sample-app/app.conf.bak': 'port=8080\nlog_level=info\n',
    },
    services: {
      'sample-app': {
        description: 'Sample App HTTP service', user: 'sample-app',
        exec: '/opt/sample-app/bin/sample-app --config /etc/sample-app/app.conf',
        port: 8080, response: 'sample-app: ok\n', state: 'failed',
        needs: [
          { fileReadableBy: ['/etc/sample-app/app.conf', 'sample-app'], log: 'FATAL open /etc/sample-app/app.conf: permission denied' },
          { fileMatches: ['/etc/sample-app/app.conf', '^log_level=(debug|info|warn|error)$'], log: 'FATAL config /etc/sample-app/app.conf: log_level must be one of debug, info, warn, error' },
        ],
      },
    },
    goal: [{ serviceAnswers: 'sample-app' }],
    chips: [
      'systemctl status sample-app', 'journalctl -u sample-app -n 20', 'systemctl cat sample-app', 'ls -l /etc/sample-app',
      'sudo chmod ', 'cat /etc/sample-app/app.conf', "sudo sed -i 's/OLD/NEW/' ", 'sudo systemctl restart sample-app', 'curl localhost:8080',
    ],
    hints: [
      'Read the journal: `journalctl -u sample-app -n 20`. Which file can the service not open?',
      '`ls -l /etc/sample-app` shows the mode and owner of that file. `systemctl cat sample-app` shows the user the service runs as: that user has to be able to read it.',
      'Let everyone read it: `sudo chmod 644 /etc/sample-app/app.conf`. Restart, then read the journal again: the error has changed.',
      'Fix the value: `sudo sed -i \'s/log_level=quiet/log_level=warn/\' /etc/sample-app/app.conf`. Then `sudo systemctl restart sample-app` and `curl localhost:8080`.',
    ],
    debrief: {
      cause: 'Two faults in one edit. The config was saved as root with mode 600, so the service user could not read it, and log_level was set to a value the app does not accept.',
      evidence: 'First the journal said "permission denied" on app.conf, and `ls -l` showed -rw------- root. After the chmod the same restart gave a new message: log_level must be one of debug, info, warn, error.',
      habit: 'Fix one error, restart, and read the journal again: a different message is progress. Check which user a service runs as (systemctl cat) before you judge a file mode.',
    },
    solution: [
      'systemctl status sample-app', 'journalctl -u sample-app -n 20', 'ls -l /etc/sample-app', 'systemctl cat sample-app',
      'sudo chmod 644 /etc/sample-app/app.conf', 'sudo systemctl restart sample-app', 'journalctl -u sample-app -n 5',
      'cat /etc/sample-app/app.conf', "sudo sed -i 's/log_level=quiet/log_level=warn/' /etc/sample-app/app.conf",
      'sudo systemctl restart sample-app', 'curl localhost:8080',
    ],
  },

  {
    id: 'es-04',
    title: 'Connection refused',
    brief: 'The host rebooted after a power cut and sample-app did not come back. Get `curl localhost:8080` answering.',
    disks: [{ device: '/dev/sda1', mount: '/', sizeMb: 20000, osUsedMb: 6200 }],
    files: {
      '/etc/sample-app/app.conf': 'port=8080\nlog_level=info\ndb=127.0.0.1:5432\n',
      '/etc/sample-db/db.conf': 'listen=127.0.0.1:5432\ndata_dir=/var/lib/sample-db\n',
      '/var/lib/sample-db/': { owner: 'sample-db', mode: '700' },
      '/var/lib/sample-db/data.db': { owner: 'sample-db', mode: '600', sizeMb: 420, mtime: 'Nov 16 03:12' },
      '/var/lib/sample-db/db.lock': { owner: 'sample-db', mode: '600', mtime: 'Nov 14 07:55', text: '1042\n' },
    },
    services: {
      'sample-db': {
        description: 'Sample DB', user: 'sample-db',
        exec: '/opt/sample-db/bin/sample-db --config /etc/sample-db/db.conf',
        port: 5432, bind: '127.0.0.1', state: 'failed', lockFile: '/var/lib/sample-db/db.lock',
        needs: [{
          fileAbsent: '/var/lib/sample-db/db.lock',
          log: ['FATAL lock file "/var/lib/sample-db/db.lock" already exists', 'HINT is another sample-db using /var/lib/sample-db? The lock file holds its PID.'],
        }],
      },
      'sample-app': {
        description: 'Sample App HTTP service', user: 'sample-app',
        exec: '/opt/sample-app/bin/sample-app --config /etc/sample-app/app.conf',
        port: 8080, response: 'sample-app: ok\n', state: 'failed',
        needs: [{ serviceActive: 'sample-db', log: 'FATAL connect to database 127.0.0.1:5432: connection refused' }],
      },
    },
    goal: [{ serviceAnswers: 'sample-app' }],
    chips: [
      'systemctl status sample-app', 'journalctl -u sample-app -n 20', 'systemctl --failed', 'journalctl -u sample-db -n 20',
      'sudo cat ', 'ps aux | grep sample-db', 'sudo rm ', 'sudo systemctl start sample-db',
      'sudo systemctl restart sample-app', 'curl localhost:8080',
    ],
    hints: [
      'The sample-app journal says what it could not reach. `systemctl --failed` lists every service that is down, not only the one in the ticket.',
      'sample-db is the real problem. Read its journal: `journalctl -u sample-db -n 20`.',
      'The lock file holds a PID: `sudo cat /var/lib/sample-db/db.lock`. Is that process alive? `ps aux | grep sample-db` (the grep line itself does not count).',
      'Nothing is running, so the lock is stale: `sudo rm /var/lib/sample-db/db.lock`, then `sudo systemctl start sample-db`, then `sudo systemctl restart sample-app` and `curl localhost:8080`.',
    ],
    debrief: {
      cause: 'The power cut killed sample-db before it could tidy up, so its lock file survived the reboot and blocked the next start. sample-app was only the victim: it exits when it cannot reach its database.',
      evidence: 'The sample-app journal said "connection refused" for 127.0.0.1:5432, which points at another service. `systemctl --failed` showed sample-db down too, its journal named the lock file, and ps showed no sample-db process, so the lock was stale.',
      habit: 'When a log says it cannot reach something, go and look at that something. Fix the root cause first, then restart what depends on it, in order. Before deleting a lock file, prove its owner is really gone.',
    },
    solution: [
      'systemctl status sample-app', 'journalctl -u sample-app -n 20', 'systemctl --failed', 'journalctl -u sample-db -n 20',
      'sudo cat /var/lib/sample-db/db.lock', 'ps aux | grep sample-db', 'sudo rm /var/lib/sample-db/db.lock',
      'sudo systemctl start sample-db', 'sudo systemctl restart sample-app', 'curl localhost:8080',
    ],
  },
];

// LEVELS for Packet Quest.
// This file is data only. To change the game's content you edit this file and nothing else.
//
// A level is one broken network. The packet visits the hops in the order they are listed.
// The simulator in logic.js decides what happens at each hop; nothing in a level says
// "this fix is the right one". The tests then prove that the `solution` works and that
// every other fix on offer does not.
//
// LEVEL FIELDS (all required)
//   id        unique text, starting "pq-"
//   title     shown above the level
//   fog       false: the page shows where the packet stopped.
//             true:  the page shows only what the client sees. After each Send the player
//                    opens hops one by one to see what each did with that packet.
//   brief     one sentence: what the person reporting the problem says
//   request   { from, host, port }  who is asking, for which name, on which port.
//             Add fromPort (the client's own port) when the level has a reply hop.
//   hops      the path, in order. The first hop is always a dns hop. See HOP KINDS.
//   fixes     the changes the player can choose from. Each is
//               { id, hop, label, set }
//             `set` replaces whole fields of that hop, so write the complete new list
//             (all the rules, all the routes), not only the added line. It may only set
//             fields the hop already has, plus `note` (the tests catch typos).
//             A fix id is plain text with no ":" in it, and is not "send" or "hint".
//   expect    { failsAt, symptom }  where the untouched level stops, and what the client
//             sees: "nxdomain", "timeout" or "refused"
//   solution  the inputs that win: the right fix id (or ids), then "send"
//   lesson    the plain idea, in everyday words
//   term      the proper name for that idea (always after the plain idea, never before)
//   command   the real command that would have found the fault
//   reveals   what to look for in that command's output
//   hints     one or two hints. Each hint used costs a star.
//
// HOP KINDS (every hop also has: id, kind, name, and optionally note = a remark shown on inspection)
//   dns       records: { "name": "address" }
//             A name with no record is NXDOMAIN and nothing is sent to the server.
//   route     routes: [{ dest: "10.0.0.0/16", target: "local" }], toward: "igw"
//             The most specific matching route wins; no match drops the packet.
//             `toward` is the target that really leads to the next hop in this level.
//             Optional deadEnds: { vgw: "what happens to a packet sent there" }.
//             Targets with a built-in name: local, igw, nat, pcx, vgw.
//   firewall  a security group. allow: [{ port: 443, from: "0.0.0.0/0" }]
//             Not on the list = dropped silently. A reply always passes (stateful).
//   nacl      a network ACL. direction: "inbound" or "outbound",
//             rules: [{ num: 100, action: "allow", ports: [443, 443], cidr: "0.0.0.0/0" }]
//             Lowest number first, first match decides, no match = denied. Replies are
//             checked like any other packet (stateless).
//   nat       a NAT gateway. publicIp: "203.0.113.9"
//             List it twice in a level with a reply: once on the way out, once on the way back.
//   service   a Kubernetes Service. ip, port, targetPort, endpoint (the pod's address)
//   listener  a host with a program listening. ip, port
//             Wrong port = the host answers "connection refused".
//   reply     turns the packet round. Hops listed after it are on the way back.
//
// PUBLIC REPO: example values only. Names under example.com; addresses from 10.x.x.x
// (private), 198.51.100.x and 203.0.113.x (reserved for documentation); sample-app.
//
// TO ADD A LEVEL: copy an entry, paste it at the end of the list with a new id, change it,
// and from the repo folder run `python3 scripts/arcade.py test packet-quest`.
// The tests tell you if the level stops somewhere other than `expect` says, if the
// solution does not win, or if a second fix would also win. To get `solution`, run
// `python3 scripts/arcade.py preview`, open http://127.0.0.1:8000/site/games/packet-quest/?dev,
// win the level, and paste the "solution:" line it shows.
// (Levels 1 to 8 teach in order: fog from 5, a reply from 6. Levels you add may be any mix.)

export const levels = [
  // ------------------------------------------------------------ 1: DNS
  {
    id: 'pq-01', title: 'No such name', fog: false,
    brief: 'A customer says https://app.example.com will not open at all.',
    request: { from: '198.51.100.7', host: 'app.example.com', port: 443 },
    hops: [
      { id: 'dns', kind: 'dns', name: 'DNS for example.com',
        records: { 'www.example.com': '203.0.113.20' } },
      { id: 'sg-web', kind: 'firewall', name: 'Security group',
        allow: [{ port: 443, from: '0.0.0.0/0' }] },
      { id: 'web', kind: 'listener', name: 'Web server', ip: '203.0.113.20', port: 443 },
    ],
    fixes: [
      { id: 'add-app-record', hop: 'dns', label: 'Add a record: app.example.com → 203.0.113.20',
        set: { records: { 'www.example.com': '203.0.113.20', 'app.example.com': '203.0.113.20' } } },
      { id: 'add-api-record', hop: 'dns', label: 'Add a record: api.example.com → 203.0.113.20',
        set: { records: { 'www.example.com': '203.0.113.20', 'api.example.com': '203.0.113.20' } } },
      { id: 'open-80', hop: 'sg-web', label: 'Add a rule: allow port 80 from 0.0.0.0/0',
        set: { allow: [{ port: 443, from: '0.0.0.0/0' }, { port: 80, from: '0.0.0.0/0' }] } },
    ],
    expect: { failsAt: 'dns', symptom: 'nxdomain' },
    solution: ['add-app-record', 'send'],
    lesson: 'A name has to be turned into an address before a connection can be made. If the name does not exist in DNS, the client never sends a single packet to the server: the only traffic is the DNS question and its answer.',
    term: 'That answer is called NXDOMAIN, short for "non-existent domain".',
    command: 'dig app.example.com',
    reveals: 'Look at the header line and the ANSWER count. "status: NXDOMAIN" means the name does not exist. "status: NOERROR" with "ANSWER: 0" also means no address came back: the name has no record of that type or, in some DNSSEC-signed zones, does not exist at all. The real example.com answers this way for app.example.com. A working name shows NOERROR and an ANSWER section with the address.',
    hints: [
      'The client never got an address. Which hop turns names into addresses?',
      'There is a record for www.example.com, but the customer typed app.example.com.',
    ],
  },

  // ------------------------------------------------------------ 2: security group
  {
    id: 'pq-02', title: 'The silent door', fog: false,
    brief: 'https://app.example.com hangs for a long time and then gives up.',
    request: { from: '198.51.100.7', host: 'app.example.com', port: 443 },
    hops: [
      { id: 'dns', kind: 'dns', name: 'DNS for example.com',
        records: { 'app.example.com': '203.0.113.20' } },
      { id: 'sg-web', kind: 'firewall', name: 'Security group',
        allow: [{ port: 80, from: '0.0.0.0/0' }] },
      { id: 'web', kind: 'listener', name: 'Web server', ip: '203.0.113.20', port: 443 },
    ],
    fixes: [
      { id: 'open-443', hop: 'sg-web', label: 'Add a rule: allow port 443 from 0.0.0.0/0',
        set: { allow: [{ port: 80, from: '0.0.0.0/0' }, { port: 443, from: '0.0.0.0/0' }] } },
      { id: 'open-443-vpc', hop: 'sg-web', label: 'Add a rule: allow port 443 from 10.0.0.0/16',
        set: { allow: [{ port: 80, from: '0.0.0.0/0' }, { port: 443, from: '10.0.0.0/16' }] } },
      { id: 'listen-80', hop: 'web', label: 'Move the web server to port 80',
        set: { port: 80 } },
    ],
    expect: { failsAt: 'sg-web', symptom: 'timeout' },
    solution: ['open-443', 'send'],
    lesson: 'A security group is a list of the traffic that is allowed in. Anything that is not on the list is thrown away without any answer, so the client keeps waiting until it gives up.',
    term: 'That wait is a timeout. A security group is an allow-list: it has no deny rules, and whatever is not allowed is dropped silently.',
    command: 'nc -vz -w 5 app.example.com 443',
    reveals: 'nc tries to open the port and gives up after 5 seconds. A hang that ends in "timed out" means something on the way dropped the packet without answering. A refusal would instead print "failed: Connection refused" at once.',
    hints: [
      'A timeout means the packet was dropped without an answer. Which hop here drops things silently?',
      'https uses port 443. Check which ports the security group lets in, and from where.',
    ],
  },

  // ------------------------------------------------------------ 3: refused versus timeout
  {
    id: 'pq-03', title: 'Nobody home', fog: false,
    brief: 'Calls to app.example.com on port 8080 fail instantly with an error.',
    request: { from: '198.51.100.7', host: 'app.example.com', port: 8080 },
    hops: [
      { id: 'dns', kind: 'dns', name: 'DNS for example.com',
        records: { 'app.example.com': '203.0.113.20' } },
      { id: 'sg-app', kind: 'firewall', name: 'Security group',
        allow: [{ port: 8080, from: '0.0.0.0/0' }] },
      { id: 'app', kind: 'listener', name: 'App server', ip: '203.0.113.20', port: 3000 },
    ],
    fixes: [
      { id: 'listen-8080', hop: 'app', label: 'Start the app on port 8080',
        set: { port: 8080 } },
      { id: 'restart-app', hop: 'app', label: 'Restart the app (it starts on port 3000 again)',
        set: { port: 3000 } },
      { id: 'open-3000', hop: 'sg-app', label: 'Add a rule: allow port 3000 from 0.0.0.0/0',
        set: { allow: [{ port: 8080, from: '0.0.0.0/0' }, { port: 3000, from: '0.0.0.0/0' }] } },
    ],
    expect: { failsAt: 'app', symptom: 'refused' },
    solution: ['listen-8080', 'send'],
    lesson: 'The packet got all the way to the server, but no program was waiting on that port. The server said so straight away, which is why the error came back instantly instead of after a long wait.',
    term: 'The client calls this "connection refused" (the server answered with a TCP reset). A fast refusal means something answered: usually the host itself, though a firewall rule set to reject (rather than drop) answers the same way. A slow timeout means the packet, or its reply, was dropped without an answer.',
    command: 'sudo ss -tlnp',
    reveals: 'Run it on the server. It lists every TCP port that has a program listening, and which program. A port that is not in the list refuses connections. Check the Local Address column too: 127.0.0.1:8080 takes connections only from the server itself; 0.0.0.0:8080 or *:8080 takes them from anywhere.',
    hints: [
      'The error came back instantly, so something answered. A security group never answers, so the packet got past it.',
      'Compare the port the client asks for with the port the app is listening on.',
    ],
  },

  // ------------------------------------------------------------ 4: longest prefix match
  {
    id: 'pq-04', title: 'The narrowest match', fog: false,
    brief: 'An app server at 10.0.1.10 cannot reach its database in the VPC next door. The connection just hangs.',
    request: { from: '10.0.1.10', host: 'db.example.com', port: 5432 },
    hops: [
      { id: 'dns', kind: 'dns', name: 'DNS (private zone)',
        records: { 'db.example.com': '10.1.2.50' } },
      { id: 'rt-app', kind: 'route', name: 'Route table (app subnet)', toward: 'pcx',
        routes: [
          { dest: '10.0.0.0/16', target: 'local' },
          { dest: '10.1.0.0/16', target: 'pcx' },
          { dest: '10.1.2.0/24', target: 'vgw' },
        ],
        deadEnds: { vgw: 'The VPN gateway sends it down the tunnel to the old data centre, where nothing has this address any more.' },
        note: 'The database VPC is 10.1.0.0/16, reached over the peering connection.' },
      { id: 'sg-db', kind: 'firewall', name: 'Security group (database)',
        allow: [{ port: 5432, from: '10.0.0.0/16' }] },
      { id: 'db', kind: 'listener', name: 'Database', ip: '10.1.2.50', port: 5432 },
    ],
    fixes: [
      { id: 'delete-vpn-route', hop: 'rt-app', label: 'Delete the route 10.1.2.0/24 → VPN gateway',
        set: { routes: [
          { dest: '10.0.0.0/16', target: 'local' },
          { dest: '10.1.0.0/16', target: 'pcx' },
        ] } },
      { id: 'add-wide-route', hop: 'rt-app', label: 'Add a route 10.0.0.0/8 → peering connection',
        set: { routes: [
          { dest: '10.0.0.0/16', target: 'local' },
          { dest: '10.1.0.0/16', target: 'pcx' },
          { dest: '10.1.2.0/24', target: 'vgw' },
          { dest: '10.0.0.0/8', target: 'pcx' },
        ] } },
      { id: 'add-23-route', hop: 'rt-app', label: 'Add a route 10.1.2.0/23 → peering connection',
        set: { routes: [
          { dest: '10.0.0.0/16', target: 'local' },
          { dest: '10.1.0.0/16', target: 'pcx' },
          { dest: '10.1.2.0/24', target: 'vgw' },
          { dest: '10.1.2.0/23', target: 'pcx' },
        ] } },
      { id: 'open-db', hop: 'sg-db', label: 'Add a rule: allow port 5432 from 0.0.0.0/0',
        set: { allow: [{ port: 5432, from: '10.0.0.0/16' }, { port: 5432, from: '0.0.0.0/0' }] } },
    ],
    expect: { failsAt: 'rt-app', symptom: 'timeout' },
    solution: ['delete-vpn-route', 'send'],
    lesson: 'When more than one route matches a destination, the route table does not use the first one in the list. It uses the most specific one: the route with the narrowest range that still contains the address. Adding a wider route changes nothing while a narrower one still matches.',
    term: 'This rule is called longest prefix match. The prefix length is the number after the slash: a /24 is narrower than a /16, so the /24 wins.',
    command: 'aws ec2 describe-route-tables --filters "Name=association.subnet-id,Values=$SUBNET_ID" --query "RouteTables[].Routes[]"',
    reveals: 'It lists every route for the subnet with its DestinationCidrBlock and its target. Pick out all the ranges that contain the address: the one with the biggest number after the slash is the one in use. (If it prints [], the subnet uses the VPC\'s main route table: run it again with --filters "Name=vpc-id,Values=$VPC_ID" "Name=association.main,Values=true".)',
    hints: [
      'Work out which routes in the table contain the address 10.1.2.50. There is more than one.',
      'Two routes match. The narrower one, the /24, wins, and it points the wrong way.',
    ],
  },

  // ------------------------------------------------------------ 5: Service targetPort
  {
    id: 'pq-05', title: 'Right house, wrong door', fog: true,
    brief: 'Inside the cluster, a pod runs "curl sample-app" and gets an error at once.',
    request: { from: '10.244.2.7', host: 'sample-app', port: 80 },
    hops: [
      { id: 'dns', kind: 'dns', name: 'Cluster DNS',
        records: { 'sample-app': '10.96.0.20' },
        note: 'A pod can find a Service in its own namespace by the short name: the search list in its /etc/resolv.conf turns sample-app into sample-app.<namespace>.svc.cluster.local. The answer is the Service\'s cluster IP, not a pod\'s (a headless Service is the exception).' },
      { id: 'svc', kind: 'service', name: 'Service sample-app',
        ip: '10.96.0.20', port: 80, targetPort: 8080, endpoint: '10.244.1.5' },
      { id: 'pod', kind: 'listener', name: 'Pod sample-app', ip: '10.244.1.5', port: 3000 },
    ],
    fixes: [
      { id: 'target-3000', hop: 'svc', label: 'Set the Service\'s targetPort to 3000',
        set: { targetPort: 3000 } },
      { id: 'target-80', hop: 'svc', label: 'Set the Service\'s targetPort to 80',
        set: { targetPort: 80 } },
      { id: 'declare-8080', hop: 'pod', label: 'Declare containerPort: 8080 in the pod spec',
        set: { note: 'The pod spec now declares containerPort 8080. That field is mostly informational: it does not change the port the app listens on, which is still 3000 (a Service can refer to it by name, which this one does not).' } },
    ],
    expect: { failsAt: 'pod', symptom: 'refused' },
    solution: ['target-3000', 'send'],
    lesson: 'A Service is a stable front door for a group of pods. Clients knock on the Service\'s own port, and it passes them on to a port on a pod. If that second port is not the one the app really listens on, the pod refuses the connection.',
    term: 'The front-door number is the Service\'s port. The number it forwards to is its targetPort, and that one must match the port the container is listening on.',
    command: 'kubectl describe service sample-app',
    reveals: 'TargetPort and Endpoints show where the Service really sends traffic: a pod address and a port. The port the app listens on is not shown here. To see it, run kubectl debug -it <pod> --image=busybox -- netstat -tln (a debug container shares the pod\'s network), or from another pod curl 10.244.1.5:8080: it is refused, while :3000 answers.',
    hints: [
      '"Refused" came back at once, so the packet reached something that answered.',
      'The Service forwards to one port and the app listens on another. Inspect both.',
    ],
  },

  // ------------------------------------------------------------ 6: the reply needs a route
  // Simplified: the internet gateway's mapping of the public address to the server's
  // private one is described in a note on the server, not simulated.
  {
    id: 'pq-06', title: 'One-way street', fog: true,
    brief: 'A new web server is running, but https://app.example.com hangs for everyone.',
    request: { from: '198.51.100.7', fromPort: 51000, host: 'app.example.com', port: 443 },
    hops: [
      { id: 'dns', kind: 'dns', name: 'DNS for example.com',
        records: { 'app.example.com': '203.0.113.20' } },
      { id: 'sg-web', kind: 'firewall', name: 'Security group',
        allow: [{ port: 443, from: '0.0.0.0/0' }] },
      { id: 'web', kind: 'listener', name: 'Web server', ip: '203.0.113.20', port: 443,
        note: 'Inside the VPC this server is 10.0.1.10, the only address it knows. The internet gateway swaps 203.0.113.20 for 10.0.1.10 on the way in, and back on the way out. Neither swap changes which route the reply needs.' },
      { id: 'turn', kind: 'reply', name: 'The web server answers' },
      { id: 'rt-web', kind: 'route', name: 'Route table (web subnet)', toward: 'igw',
        routes: [{ dest: '10.0.0.0/16', target: 'local' }] },
    ],
    fixes: [
      { id: 'add-default-igw', hop: 'rt-web', label: 'Add a route 0.0.0.0/0 → internet gateway',
        set: { routes: [{ dest: '10.0.0.0/16', target: 'local' }, { dest: '0.0.0.0/0', target: 'igw' }] } },
      { id: 'add-own-range', hop: 'rt-web', label: 'Add a route 203.0.113.0/24 → internet gateway',
        set: { routes: [{ dest: '10.0.0.0/16', target: 'local' }, { dest: '203.0.113.0/24', target: 'igw' }] } },
      { id: 'open-client', hop: 'sg-web', label: 'Add a rule: allow port 443 from 198.51.100.0/24',
        set: { allow: [{ port: 443, from: '0.0.0.0/0' }, { port: 443, from: '198.51.100.0/24' }] } },
    ],
    expect: { failsAt: 'rt-web', symptom: 'timeout' },
    solution: ['add-default-igw', 'send'],
    lesson: 'Getting there is only half the trip: the answer has to get back. A route table decides where packets leaving its subnet go, and a reply is a packet leaving the subnet. With no route that matches the client\'s address, the reply is dropped and the client sees a timeout.',
    term: 'A route for 0.0.0.0/0 matches every address and is called the default route. A subnet whose route table has a route to an internet gateway (usually this default route) is a public subnet.',
    command: 'sudo tcpdump -ni any tcp port 443',
    reveals: 'Run it on the server. You see the client\'s opening packets (flags [S]) arrive, addressed to 10.0.1.10 (the server never sees its public address), and the server\'s answers (flags [S.]) leave, again and again, and nothing after them: the request gets in, but the reply never gets back.',
    hints: [
      'A timeout does not say which direction failed. Follow the packet past the server.',
      'The reply is addressed to 198.51.100.7. Which route in the web subnet\'s table matches that address?',
    ],
  },

  // ------------------------------------------------------------ 7: stateless network ACL
  {
    id: 'pq-07', title: 'No memory', fog: true,
    brief: 'Someone tidied up the network rules, and now https://app.example.com hangs.',
    request: { from: '198.51.100.7', fromPort: 51000, host: 'app.example.com', port: 443 },
    hops: [
      { id: 'dns', kind: 'dns', name: 'DNS for example.com',
        records: { 'app.example.com': '203.0.113.20' } },
      { id: 'nacl-in', kind: 'nacl', name: 'Network ACL (inbound rules)', direction: 'inbound',
        rules: [{ num: 100, action: 'allow', ports: [443, 443], cidr: '0.0.0.0/0' }] },
      { id: 'sg-web', kind: 'firewall', name: 'Security group',
        allow: [{ port: 443, from: '0.0.0.0/0' }] },
      { id: 'web', kind: 'listener', name: 'Web server', ip: '203.0.113.20', port: 443 },
      { id: 'turn', kind: 'reply', name: 'The web server answers' },
      { id: 'sg-web-back', kind: 'firewall', name: 'Security group (reply leaving)',
        allow: [{ port: 443, from: '0.0.0.0/0' }] },
      { id: 'nacl-out', kind: 'nacl', name: 'Network ACL (outbound rules)', direction: 'outbound',
        rules: [{ num: 100, action: 'allow', ports: [443, 443], cidr: '0.0.0.0/0' }] },
    ],
    fixes: [
      { id: 'out-ephemeral', hop: 'nacl-out', label: 'Add outbound rule 110: allow ports 1024-65535 to 0.0.0.0/0',
        set: { rules: [
          { num: 100, action: 'allow', ports: [443, 443], cidr: '0.0.0.0/0' },
          { num: 110, action: 'allow', ports: [1024, 65535], cidr: '0.0.0.0/0' },
        ] } },
      { id: 'out-80', hop: 'nacl-out', label: 'Add outbound rule 110: allow port 80 to 0.0.0.0/0',
        set: { rules: [
          { num: 100, action: 'allow', ports: [443, 443], cidr: '0.0.0.0/0' },
          { num: 110, action: 'allow', ports: [80, 80], cidr: '0.0.0.0/0' },
        ] } },
      { id: 'in-ephemeral', hop: 'nacl-in', label: 'Add inbound rule 110: allow ports 1024-65535 from 0.0.0.0/0',
        set: { rules: [
          { num: 100, action: 'allow', ports: [443, 443], cidr: '0.0.0.0/0' },
          { num: 110, action: 'allow', ports: [1024, 65535], cidr: '0.0.0.0/0' },
        ] } },
    ],
    expect: { failsAt: 'nacl-out', symptom: 'timeout' },
    solution: ['out-ephemeral', 'send'],
    lesson: 'A security group remembers the requests it lets in, so their replies are let out without any rule. A network ACL remembers nothing: it checks the reply as if it were a brand-new packet. And the reply is not going to port 443. It is going back to the high-numbered temporary port the client picked for this one conversation.',
    term: 'Remembering is called stateful (the security group); not remembering is stateless (the network ACL). The client\'s temporary port is an ephemeral port, so a network ACL needs an outbound rule for the ephemeral range. Ports 1024-65535 cover every kind of client.',
    command: 'aws ec2 describe-network-acls --filters "Name=association.subnet-id,Values=$SUBNET_ID"',
    reveals: 'Entries with "Egress": true are the outbound rules, and they are checked in RuleNumber order. Look for one that allows the port range 1024-65535.',
    hints: [
      'The request reaches the server. Follow the reply: which hop treats it as a stranger?',
      'The reply goes to the client\'s port 51000, not to 443. Does any outbound rule cover 51000?',
    ],
  },

  // ------------------------------------------------------------ 8: private subnet and NAT
  {
    id: 'pq-08', title: 'A borrowed address', fog: true,
    brief: 'A server in a private subnet runs curl https://api.example.com to fetch updates, and it hangs.',
    request: { from: '10.0.2.15', fromPort: 51000, host: 'api.example.com', port: 443 },
    hops: [
      { id: 'dns', kind: 'dns', name: 'DNS for example.com',
        records: { 'api.example.com': '203.0.113.30' } },
      { id: 'rt-private', kind: 'route', name: 'Route table (private subnet)', toward: 'nat',
        routes: [{ dest: '10.0.0.0/16', target: 'local' }],
        deadEnds: { igw: 'An internet gateway only translates for servers that have a public address of their own. 10.0.2.15 has none, so the packet goes no further.' },
        note: 'This server is 10.0.2.15 and has no public address.' },
      { id: 'nat-out', kind: 'nat', name: 'NAT gateway (way out)', publicIp: '203.0.113.9',
        note: 'The NAT gateway sits in a public subnet. It swaps 10.0.2.15 for its own private address, and the internet gateway then swaps that for the NAT gateway\'s Elastic IP, 203.0.113.9. Here the two swaps are shown as one.' },
      { id: 'api', kind: 'listener', name: 'Update server', ip: '203.0.113.30', port: 443 },
      { id: 'turn', kind: 'reply', name: 'The update server answers' },
      { id: 'nat-back', kind: 'nat', name: 'NAT gateway (way back)', publicIp: '203.0.113.9' },
    ],
    fixes: [
      { id: 'default-nat', hop: 'rt-private', label: 'Add a route 0.0.0.0/0 → NAT gateway',
        set: { routes: [{ dest: '10.0.0.0/16', target: 'local' }, { dest: '0.0.0.0/0', target: 'nat' }] } },
      { id: 'default-igw', hop: 'rt-private', label: 'Add a route 0.0.0.0/0 → internet gateway',
        set: { routes: [{ dest: '10.0.0.0/16', target: 'local' }, { dest: '0.0.0.0/0', target: 'igw' }] } },
      { id: 'own-subnet-nat', hop: 'rt-private', label: 'Add a route 10.0.2.0/24 → NAT gateway',
        set: { routes: [{ dest: '10.0.0.0/16', target: 'local' }, { dest: '10.0.2.0/24', target: 'nat' }] } },
    ],
    expect: { failsAt: 'rt-private', symptom: 'timeout' },
    solution: ['default-nat', 'send'],
    lesson: 'A private address such as 10.0.2.15 means nothing on the internet, so no reply could ever find its way back to it. A NAT gateway lends its own public address: on the way out it puts itself in as the sender and remembers who really asked, and on the way back it puts the private address in again.',
    term: 'The swap is called network address translation, or NAT. A private subnet is one whose route table has no route to an internet gateway. To reach the internet, it sends 0.0.0.0/0 to a NAT gateway, which sits in a public subnet. The private subnet\'s servers can then start conversations with the outside, but the outside cannot start one with them.',
    command: 'aws ec2 describe-route-tables --filters "Name=association.subnet-id,Values=$SUBNET_ID" --query "RouteTables[].Routes[]"',
    reveals: 'A private subnet that can reach the internet has a 0.0.0.0/0 route whose NatGatewayId starts with nat-. With no 0.0.0.0/0 route at all, packets for the internet are dropped. (If it prints [], the subnet uses the VPC\'s main route table: run it again with --filters "Name=vpc-id,Values=$VPC_ID" "Name=association.main,Values=true".)',
    hints: [
      'The packet is going to 203.0.113.30. Which route in the private subnet\'s table matches that address?',
      'This server has no public address, and an internet gateway only translates for servers that have one.',
    ],
  },
];

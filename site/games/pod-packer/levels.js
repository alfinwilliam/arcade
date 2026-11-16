// LEVELS for Pod Packer.
// This file is data only. To change the game's content you edit this file and nothing else.
//
// Units: cpu is in millicores (1000 = one CPU), mem is in MiB (1024 = 1Gi),
// money is whole rupees. Use whole numbers everywhere.
//
// Schema for a level (every field is required unless it says optional):
//   id         unique text, starting "pp-"
//   title      shown above the level
//   hint       one sentence shown while playing: the new idea in this level
//   lesson     one plain sentence shown on the win screen. It must be true of real Kubernetes.
//   turns      how many turns the level lasts, 3 to 6. Surviving the last one wins.
//   maxBill    the cap in rupees. The level is lost when the bill goes over it.
//   patience   how many turn ends a pod may spend Pending. 0 means every pod must be
//              running when a turn ends.
//   nodeTypes  what the shop sells, as  name: { cpu, mem, price }  where price is rupees
//              per turn. cpu and mem are what pods may request on it (in Kubernetes terms,
//              the node's allocatable). Optional extras:
//                taint: 'gpu'   only pods with  tolerates: 'gpu'  may be placed on it
//                               (it works like a Kubernetes NoSchedule taint)
//                label: 'gpu'   pods with  needs: 'gpu'  may only be placed on a node with
//                               this label (it works like a nodeSelector)
//                spot: true     marks the type as one that can be reclaimed (see events)
//   arrivals   which pods turn up at the start of which turn:
//                { turn: 1, pods: [ { id, cpu, mem }, ... ] }
//              Pod ids are unique in the level and have no spaces. Optional pod extras:
//                tolerates: 'gpu'   may be placed on nodes with that taint (and anywhere else)
//                needs: 'gpu'       may only be placed on nodes with that label
//                runs: 2            a job: it finishes and leaves after running for 2 turn ends
//                patience: 1        this pod's own patience, instead of the level's
//   events     surprises. { turn: 3, reclaim: 'spot' } means: when turn 3 ends, every live
//              node of type "spot" is taken away and replacements for its pods are Pending.
//              The player is warned during turn 3 (the game's version of the two-minute
//              spot interruption notice). The type must have spot: true. Use [] for none.
//   solution   a list of moves that wins. Its bill is the bill to match for three stars,
//              so make it a good one. The tests replay it: a level that cannot be won as
//              written fails `python3 scripts/arcade.py test pod-packer`.
//              Moves: 'buy TYPE', 'place POD NODE', 'drain NODE', 'end'.
//              'drain' does two things at once: it evicts the node's pods (replacements for
//              them are Pending, and a job starts again from the beginning), and it removes
//              the node so that it is no longer billed.
//              Nodes are named n1, n2, ... in the order they are bought.
//
// To add a level: copy an entry, give it a new id, change the pods and prices, and set
// solution to []. Open the game with ?dev on the end of the URL, win the level, and paste
// the moves it shows into `solution`. Then pick maxBill: more than 15% above the solution's
// bill, and below what buying a separate node for every pod would cost (the tests check both).
//
// Sizes and prices are made up. They are kept the same from level to level
// (small, spot, gpu) so that a player only has to learn them once. Pod sizes are chosen so
// that the best packing fills its nodes exactly: a node with no CPU and no memory left
// gets a "packed" badge, which is the game's small reward.

export const levels = [
  {
    id: 'pp-01', title: 'Two numbers', turns: 3, maxBill: 90, patience: 0,
    hint: 'A pod fits only if its CPU and its memory both fit in what is left on the node.',
    lesson: 'The scheduler puts a pod on a node only if both its CPU request and its memory request fit in what is left after the requests of the pods already there; what those pods actually use does not count.',
    nodeTypes: {
      small: { cpu: 2000, mem: 4096, price: 10 },
    },
    arrivals: [
      { turn: 1, pods: [
        { id: 'web-1', cpu: 1500, mem: 1024 },
        { id: 'web-2', cpu: 1500, mem: 1024 } ] },
      { turn: 2, pods: [
        { id: 'cache-1', cpu: 500, mem: 3072 },
        { id: 'cache-2', cpu: 500, mem: 3072 } ] },
      { turn: 3, pods: [
        { id: 'api-1', cpu: 1000, mem: 2048 },
        { id: 'api-2', cpu: 1000, mem: 2048 } ] },
    ],
    events: [],
    solution: [
      'buy small', 'place web-1 n1', 'buy small', 'place web-2 n2', 'end',
      'place cache-1 n1', 'place cache-2 n2', 'end',
      'buy small', 'place api-1 n3', 'place api-2 n3', 'end',
    ],
  },

  {
    id: 'pp-02', title: 'Scraps do not add up', turns: 3, maxBill: 70, patience: 0,
    hint: 'Look at what arrives next turn before you choose where each pod goes.',
    lesson: 'A pod runs on exactly one node, so 0.5 CPU free on each of two nodes is not room for a pod that requests 1 CPU.',
    nodeTypes: {
      small: { cpu: 2000, mem: 4096, price: 10 },
    },
    arrivals: [
      { turn: 1, pods: [
        { id: 'web-1', cpu: 1000, mem: 2048 },
        { id: 'api-1', cpu: 500, mem: 1024 } ] },
      { turn: 2, pods: [
        { id: 'web-2', cpu: 1000, mem: 2048 },
        { id: 'api-2', cpu: 500, mem: 1024 } ] },
      { turn: 3, pods: [
        { id: 'db-1', cpu: 1000, mem: 2048 } ] },
    ],
    events: [],
    solution: [
      'buy small', 'place web-1 n1', 'place api-1 n1', 'end',
      'place api-2 n1', 'buy small', 'place web-2 n2', 'end',
      'place db-1 n2', 'end',
    ],
  },

  {
    id: 'pp-03', title: 'Keep off the GPU', turns: 3, maxBill: 190, patience: 0,
    hint: 'The gpu node has a taint: only pods that tolerate "gpu" may use it. A pod that needs a "gpu" node (a node selector) can go nowhere else.',
    lesson: 'A NoSchedule taint keeps pods that do not tolerate it from being scheduled onto the node; a toleration only allows a pod onto that node, and it takes a node selector (or node affinity) to require one.',
    nodeTypes: {
      small: { cpu: 2000, mem: 4096, price: 10 },
      gpu: { cpu: 2000, mem: 8192, price: 40, taint: 'gpu', label: 'gpu' },
    },
    arrivals: [
      { turn: 1, pods: [
        { id: 'train-1', cpu: 1000, mem: 6144, tolerates: 'gpu', needs: 'gpu' },
        { id: 'web-1', cpu: 1000, mem: 2048 },
        { id: 'web-2', cpu: 1000, mem: 2048 } ] },
      { turn: 2, pods: [
        { id: 'agent-1', cpu: 1000, mem: 2048, tolerates: 'gpu' } ] },
      { turn: 3, pods: [
        { id: 'web-3', cpu: 1000, mem: 2048 },
        { id: 'web-4', cpu: 1000, mem: 2048 } ] },
    ],
    events: [],
    solution: [
      'buy gpu', 'place train-1 n1', 'buy small', 'place web-1 n2', 'place web-2 n2', 'end',
      'place agent-1 n1', 'end',
      'buy small', 'place web-3 n3', 'place web-4 n3', 'end',
    ],
  },

  {
    id: 'pp-04', title: 'Tidy up', turns: 4, maxBill: 70, patience: 0,
    hint: 'Jobs finish and leave gaps. Drain a half-empty node, put its pods on another node, and you stop paying for it.',
    lesson: 'Draining a node marks it unschedulable and evicts its pods; a controller such as a Deployment then creates replacements, which are scheduled onto other nodes, so the empty node can be removed and stops costing money.',
    nodeTypes: {
      small: { cpu: 2000, mem: 4096, price: 10 },
    },
    arrivals: [
      { turn: 1, pods: [
        { id: 'web-1', cpu: 1000, mem: 2048 },
        { id: 'batch-1', cpu: 1000, mem: 2048, runs: 2 } ] },
      { turn: 2, pods: [
        { id: 'web-2', cpu: 1000, mem: 2048 },
        { id: 'batch-2', cpu: 1000, mem: 2048, runs: 1 } ] },
    ],
    events: [],
    solution: [
      'buy small', 'place web-1 n1', 'place batch-1 n1', 'end',
      'buy small', 'place web-2 n2', 'place batch-2 n2', 'end',
      'drain n2', 'place web-2 n1', 'end',
      'end',
    ],
  },

  {
    id: 'pp-05', title: 'Cheap, until it is gone', turns: 4, maxBill: 60, patience: 0,
    hint: 'Spot nodes are cheap, but they can be taken back. You are warned one turn before it happens.',
    lesson: 'A spot node is cheap because the cloud provider can take it back at short notice (on AWS, a two-minute interruption notice); drain it when the notice comes, so replacements for its pods are scheduled onto other nodes in time.',
    nodeTypes: {
      small: { cpu: 2000, mem: 4096, price: 10 },
      spot: { cpu: 2000, mem: 4096, price: 4, spot: true },
    },
    arrivals: [
      { turn: 1, pods: [
        { id: 'web-1', cpu: 1000, mem: 2048 },
        { id: 'web-2', cpu: 1000, mem: 2048 } ] },
      { turn: 3, pods: [
        { id: 'db-1', cpu: 1000, mem: 2048 },
        { id: 'api-1', cpu: 1000, mem: 2048 } ] },
    ],
    events: [{ turn: 2, reclaim: 'spot' }],
    solution: [
      'buy spot', 'place web-1 n1', 'place web-2 n1', 'end',
      'buy small', 'drain n1', 'place web-1 n2', 'place web-2 n2', 'end',
      'buy spot', 'place db-1 n3', 'place api-1 n3',
      'drain n2', 'buy spot', 'place web-1 n4', 'place web-2 n4', 'end',
      'end',
    ],
  },

  {
    id: 'pp-06', title: 'Release day', turns: 5, maxBill: 150, patience: 0,
    hint: 'Everything at once. One new thing: the job report-1 is patient and may wait one turn for room.',
    lesson: 'When a pod finishes, its requests are released, and a Pending pod can then be scheduled into the room it leaves.',
    nodeTypes: {
      small: { cpu: 2000, mem: 4096, price: 10 },
      spot: { cpu: 2000, mem: 4096, price: 4, spot: true },
      gpu: { cpu: 2000, mem: 8192, price: 40, taint: 'gpu', label: 'gpu' },
    },
    arrivals: [
      { turn: 1, pods: [
        { id: 'train-1', cpu: 1000, mem: 6144, tolerates: 'gpu', needs: 'gpu', runs: 2 },
        { id: 'agent-1', cpu: 1000, mem: 2048, tolerates: 'gpu' },
        { id: 'web-1', cpu: 1000, mem: 2048 },
        { id: 'batch-1', cpu: 1000, mem: 2048, runs: 2 } ] },
      { turn: 2, pods: [
        { id: 'report-1', cpu: 1000, mem: 2048, runs: 1, patience: 1 } ] },
    ],
    events: [{ turn: 5, reclaim: 'spot' }],
    solution: [
      'buy gpu', 'place train-1 n1', 'place agent-1 n1', 'buy spot', 'place web-1 n2', 'place batch-1 n2', 'end',
      'end',
      'drain n1', 'place report-1 n2', 'buy spot', 'place agent-1 n3', 'end',
      'drain n3', 'place agent-1 n2', 'end',
      'buy small', 'drain n2', 'place web-1 n4', 'place agent-1 n4', 'end',
    ],
  },
];

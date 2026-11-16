// LEVELS for Subnet Slicer, a CIDR and subnetting drill.
// This file is data only. To change the game's content you edit this file and nothing else.
//
// There are two kinds of level, set by `kind`:
//   'drill'  a round of quick questions ("How many addresses in a /26?"). The questions are
//            made by logic.js from a seed, so the same seed always gives the same questions.
//            The level is WON when the round ends with at least `pass` right answers, and LOST
//            otherwise. Stars: 3 with no wrong answer, 2 with one, 1 otherwise. The page shows
//            a clock, but time never decides anything.
//   'carve'  a puzzle: carve one subnet out of the VPC for each need. The player gives each
//            need a block (a prefix and a start address), then applies the plan. The level is
//            WON when the plan has no problem, and LOST when 'apply' finds any of these:
//              missing     a need has no block
//              range       the prefix is outside /16 to /28 (what AWS allows for a subnet)
//              misaligned  the start is not a multiple of the block size (10.0.1.0/23 is wrong).
//                          AWS would not refuse it: it rounds the block down to 10.0.0.0/23,
//                          which is not the block you planned
//              outside     the block is not wholly inside the VPC
//              small       the block holds fewer than `hosts` usable addresses, counting the
//                          5 that AWS keeps in every subnet (a /24 gives 256 - 5 = 251).
//                          AWS would accept it; it is just too small for the need
//              overlap     two blocks share an address, or a block overlaps a `taken` one
//            A won plan earns 3 stars.
//
// Schema, fields every level has:
//   id          unique text, starting "ss-"
//   kind        'drill' or 'carve'
//   title       shown above the level
//   brief       one or two sentences shown while playing
//   lesson      one plain sentence for the win screen. It must be true.
//   inRealLife  1 to 3 snippets { label, code }, each at most 12 lines: the real command or config.
//               If a snippet is a part of something bigger, say so in its label ('Terraform (excerpt)').
//               A line written as  cidrsubnet("10.0.0.0/24", 2, 2)  # "10.0.0.128/26"  is checked:
//               the quoted result after the # must be what Terraform gives.
//   docs        1 to 3 official documentation URLs (https://) that back the lesson
//   solution    a list of inputs that wins. The tests replay it. See each kind below.
//
// Fields for a 'drill':
//   asks        the kinds of question, shared out evenly over the round, from:
//                 'size'     how many addresses in a /N          answer: a number, e.g. '64'
//                 'usable'   usable addresses in an AWS /N       answer: a number, e.g. '251'
//                 'fit'      smallest AWS subnet for N hosts     answer: a prefix, e.g. '/23'
//                 'split'    how many /M fit in a /N             answer: a number, e.g. '16'
//                 'inside'   is this address inside this block   answer: 'yes' or 'no'
//                 'network'  first address of an address/N       answer: an address, e.g. '10.0.4.0'
//                 'last'     last address of a block             answer: an address, e.g. '10.0.7.255'
//                 'overlap'  which of three blocks overlaps one  answer: that block, e.g. '10.0.6.0/24'
//   prefixes    [low, high]: whole numbers, 16 <= low <= high <= 28. Questions use prefixes in this
//               range ('usable' and 'fit' also stay within /16 to /28; 'split' needs high > low).
//   questions   how many questions in a round (1 or more)
//   pass        right answers needed to win (1 to questions)
//   seed        a whole number. It picks the round's questions; the page uses seed + 1, seed + 2 ...
//               for later rounds, so practice keeps giving new questions. Round seed + 1 must differ
//               from round seed, so give the level some variety (not one question at one prefix).
//   solution    the RIGHT answer to each question of round `seed`, in order: one per question.
//               The tests want all of them right (3 stars).
//
// Fields for a 'carve':
//   vpc         the VPC's block, e.g. '10.0.0.0/16'. On a boundary, between /16 and /28.
//   needs       the subnets to make, 2 or more: [{ id, label, hosts }]. The page numbers them 1, 2, 3 ...
//                 id     short and unique in the level, no spaces, not 'apply', e.g. 'web-a'
//                 label  what it is for, e.g. 'Public, AZ a'
//                 hosts  usable addresses it needs (1 or more, and it must fit in the VPC)
//   taken       optional: blocks already in use that may not be overlapped: [{ label, cidr }].
//               Each on a boundary and inside the VPC.
//   mapRows     optional: how many rows the address map wraps into (default 1). Pick it so the
//               VPC's size divides evenly: a /16 in 8 rows makes rows of 8192 addresses.
//   solution    inputs: '<need id> <cidr>' for each need, e.g. 'web-a 10.0.0.0/26', and last 'apply'.
//
// The tests also check: ids are unique; every field above is in range; a drill's solution has one
// answer per question and wins; the same seed gives the same questions; every answer the
// question maker gives matches a second, brute-force calculation; a carve's solution wins;
// applying an empty plan loses; moving one block onto another loses with 'overlap'; nudging a
// block off its boundary loses with 'misaligned'; snippets and URLs keep to the limits above.
//
// To add a level: copy an entry, give it a new id, and set solution to []. For a drill, open the
// game with ?dev on the end of the URL, play the first round with every answer right, and paste
// the answers the win screen shows into `solution`. For a carve, win it with ?dev and paste the inputs it shows.
// Then run `python3 scripts/arcade.py test subnet-slicer`.

export const levels = [
  {
    id: 'ss-01',
    kind: 'drill',
    title: 'Block sizes',
    brief: 'How many addresses does each block hold? Take 32 minus the prefix, then 2 to that power.',
    asks: ['size'],
    prefixes: [22, 28],
    questions: 6,
    pass: 4,
    seed: 101,
    lesson: 'A block\'s size comes from the bits the prefix leaves free: a /26 leaves 32 − 26 = 6 bits, so it holds 2^6 = 64 addresses.',
    inRealLife: [
      { label: 'Python (ipaddress)', code: `$ python3 -c 'import ipaddress; print(ipaddress.ip_network("10.0.1.0/26").num_addresses)'
64` },
    ],
    docs: [
      'https://www.rfc-editor.org/rfc/rfc4632#section-3.1',
      'https://docs.python.org/3/library/ipaddress.html',
    ],
    solution: ['128', '512', '64', '32', '16', '1024'],
  },
  {
    id: 'ss-02',
    kind: 'drill',
    title: 'AWS keeps five',
    brief: 'In AWS, every subnet loses 5 addresses: the first four and the last. How many are left for instances?',
    asks: ['usable', 'size'],
    prefixes: [20, 28],
    questions: 6,
    pass: 4,
    seed: 202,
    lesson: 'AWS keeps five addresses in every subnet (the first four and the last), so a /24 gives you 256 − 5 = 251 to use.',
    inRealLife: [
      { label: 'AWS CLI', code: `aws ec2 create-subnet --vpc-id "$VPC_ID" \\
  --cidr-block 10.0.1.0/24 --availability-zone us-east-1a
aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \\
  --query 'Subnets[].[CidrBlock,AvailableIpAddressCount]' --output text
# prints, for the new and still empty subnet:
# 10.0.1.0/24    251` },
    ],
    docs: [
      'https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html',
      'https://docs.aws.amazon.com/cli/latest/reference/ec2/create-subnet.html',
      'https://docs.aws.amazon.com/cli/latest/reference/ec2/describe-subnets.html',
    ],
    solution: ['123', '128', '2048', '4091', '4096', '507'],
  },
  {
    id: 'ss-03',
    kind: 'carve',
    title: 'Split a /24',
    brief: 'A small VPC, 256 addresses. Fit an app subnet and a web subnet in each of two zones. It is tight: every address counts.',
    vpc: '10.0.0.0/24',
    needs: [
      { id: 'app', label: 'App servers, AZ a', hosts: 100 },
      { id: 'web-a', label: 'Web, AZ a', hosts: 50 },
      { id: 'web-b', label: 'Web, AZ b', hosts: 50 },
    ],
    mapRows: 1,
    lesson: 'Every block starts on a multiple of its own size, so place the biggest first and the smaller blocks pack in after it with no gaps.',
    inRealLife: [
      { label: 'Terraform (expressions)', code: `# cidrsubnet(prefix, newbits, netnum): newbits longer, block number netnum
cidrsubnet("10.0.0.0/24", 1, 0)   # "10.0.0.0/25"   app
cidrsubnet("10.0.0.0/24", 2, 2)   # "10.0.0.128/26" web-a
cidrsubnet("10.0.0.0/24", 2, 3)   # "10.0.0.192/26" web-b` },
      { label: 'Python (ipaddress, traceback shortened)', code: `>>> import ipaddress
>>> ipaddress.ip_network("10.0.0.64/25")
Traceback (most recent call last):
  ...
ValueError: 10.0.0.64/25 has host bits set` },
      { label: 'AWS CLI', code: `# AWS does not refuse a block off its boundary: it rounds it down
aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.0.64/25
# the new subnet is 10.0.0.0/25, not the block you planned` },
    ],
    docs: [
      'https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html',
      'https://developer.hashicorp.com/terraform/language/functions/cidrsubnet',
      'https://docs.aws.amazon.com/cli/latest/reference/ec2/create-subnet.html',
    ],
    solution: ['app 10.0.0.0/25', 'web-a 10.0.0.128/26', 'web-b 10.0.0.192/26', 'apply'],
  },
  {
    id: 'ss-04',
    kind: 'drill',
    title: 'Inside or not',
    brief: 'Find where a block starts and ends. A /22 moves in steps of 4 in the third octet: 10.0.0.0, 10.0.4.0, 10.0.8.0 ...',
    asks: ['inside', 'network'],
    prefixes: [19, 26],
    questions: 8,
    pass: 6,
    seed: 404,
    lesson: 'A block starts on a multiple of its size, so to find the block an address is in, round the octet where the prefix ends down to a multiple of the step and zero the octets after it.',
    inRealLife: [
      { label: 'Python (ipaddress)', code: `>>> import ipaddress
>>> ipaddress.ip_address("10.0.3.17") in ipaddress.ip_network("10.0.2.0/23")
True
>>> ipaddress.ip_interface("10.0.5.77/22").network
IPv4Network('10.0.4.0/22')` },
    ],
    docs: [
      'https://www.rfc-editor.org/rfc/rfc4632#section-3.1',
      'https://docs.python.org/3/library/ipaddress.html',
      'https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html',
    ],
    solution: ['no', 'no', 'yes', '10.12.112.0', 'no', '10.1.100.0', '10.6.224.0', '10.22.53.128'],
  },
  {
    id: 'ss-05',
    kind: 'drill',
    title: 'Right-size it',
    brief: 'Pick the smallest AWS subnet for a host count, split blocks, and find a block\'s last address. Remember the 5 that AWS keeps.',
    asks: ['fit', 'split', 'last'],
    prefixes: [18, 28],
    questions: 6,
    pass: 4,
    seed: 505,
    lesson: 'To size an AWS subnet, add the 5 reserved addresses to the hosts you need and round up to a power of two: 500 hosts need 505, so 512 addresses, a /23.',
    inRealLife: [
      { label: 'Terraform (expressions)', code: `cidrsubnet("10.0.0.0/16", 7, 1)     # "10.0.2.0/23": 512 addresses, 507 usable
cidrsubnets("10.0.0.0/16", 4, 8, 4)
# ["10.0.0.0/20", "10.0.16.0/24", "10.0.32.0/20"]
# the second /20 skips ahead to the next multiple of its own size` },
    ],
    docs: [
      'https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html',
      'https://developer.hashicorp.com/terraform/language/functions/cidrsubnets',
    ],
    solution: ['10.12.52.159', '4', '10.5.243.255', '2', '/22', '/26'],
  },
  {
    id: 'ss-06',
    kind: 'drill',
    title: 'Overlap',
    brief: 'Two CIDR blocks either nest or do not touch. Find the one that overlaps, and keep your sizing sharp.',
    asks: ['overlap', 'inside', 'fit'],
    prefixes: [18, 26],
    questions: 6,
    pass: 4,
    seed: 606,
    lesson: 'Two CIDR blocks overlap only when one contains the other, and AWS refuses a subnet whose block overlaps another subnet in the same VPC.',
    inRealLife: [
      { label: 'Python (ipaddress)', code: `>>> import ipaddress
>>> n = ipaddress.ip_network
>>> n("10.0.4.0/22").overlaps(n("10.0.6.0/24"))
True` },
      { label: 'AWS CLI', code: `# 10.0.4.0/22 is already a subnet in this VPC
aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.6.0/24
# fails with the error code InvalidSubnet.Conflict` },
    ],
    docs: [
      'https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html',
      'https://docs.aws.amazon.com/AWSEC2/latest/APIReference/errors-overview.html',
    ],
    solution: ['/23', '/20', 'yes', 'yes', '10.4.148.0/22', '10.20.65.128/25'],
  },
  {
    id: 'ss-07',
    kind: 'carve',
    title: 'Around the old ones',
    brief: 'This VPC already has two subnets you may not touch. Add the three-tier layout around them.',
    vpc: '10.0.0.0/20',
    needs: [
      { id: 'priv-a', label: 'Private, AZ a', hosts: 1000 },
      { id: 'priv-b', label: 'Private, AZ b', hosts: 1000 },
      { id: 'pub-a', label: 'Public, AZ a', hosts: 200 },
      { id: 'pub-b', label: 'Public, AZ b', hosts: 200 },
      { id: 'db', label: 'Databases', hosts: 50 },
    ],
    taken: [
      { label: 'legacy', cidr: '10.0.2.0/23' },
      { label: 'vpn', cidr: '10.0.9.0/24' },
    ],
    mapRows: 2,
    lesson: 'Subnets in one VPC may not overlap, so list the blocks already in use before you pick new ones; a big block needs a whole free slot on its own boundary.',
    inRealLife: [
      { label: 'AWS CLI', code: `aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \\
  --query 'Subnets[].CidrBlock'
aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.4.0/22 \\
  --availability-zone us-east-1a \\
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=priv-a}]'` },
    ],
    docs: [
      'https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html',
      'https://docs.aws.amazon.com/cli/latest/reference/ec2/create-subnet.html',
    ],
    solution: ['priv-a 10.0.4.0/22', 'priv-b 10.0.12.0/22', 'pub-a 10.0.0.0/24', 'pub-b 10.0.1.0/24', 'db 10.0.8.0/26', 'apply'],
  },
  {
    id: 'ss-08',
    kind: 'carve',
    title: 'A whole VPC',
    brief: 'Three zones, three tiers (the databases use two of the zones), in a /16. The top half stays free for growth. App subnets need at least 8,000 hosts each.',
    vpc: '10.0.0.0/16',
    needs: [
      { id: 'app-a', label: 'App, AZ a', hosts: 8000 },
      { id: 'app-b', label: 'App, AZ b', hosts: 8000 },
      { id: 'app-c', label: 'App, AZ c', hosts: 8000 },
      { id: 'pub-a', label: 'Public, AZ a', hosts: 250 },
      { id: 'pub-b', label: 'Public, AZ b', hosts: 250 },
      { id: 'pub-c', label: 'Public, AZ c', hosts: 250 },
      { id: 'db-a', label: 'Databases, AZ a', hosts: 100 },
      { id: 'db-b', label: 'Databases, AZ b', hosts: 100 },
    ],
    taken: [
      { label: 'kept for growth', cidr: '10.0.128.0/17' },
    ],
    mapRows: 8,
    lesson: 'A subnet lives in exactly one Availability Zone, so a common layout gives each tier one subnet per zone, sized from the hosts it needs plus the 5 that AWS keeps.',
    inRealLife: [
      { label: 'Terraform (excerpt)', code: `locals {
  azs = ["us-east-1a", "us-east-1b", "us-east-1c"]
  app = [for i in range(3) : cidrsubnet("10.0.0.0/16", 3, i)]       # 10.0.0.0/19 ...
  pub = [for i in range(3) : cidrsubnet("10.0.0.0/16", 8, 96 + i)]  # 10.0.96.0/24 ...
  db  = [for i in range(2) : cidrsubnet("10.0.0.0/16", 9, 198 + i)] # 10.0.99.0/25 ...
}
resource "aws_subnet" "app" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = local.app[count.index]
  availability_zone = local.azs[count.index]
}` },
    ],
    docs: [
      'https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html',
      'https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html',
      'https://developer.hashicorp.com/terraform/language/functions/cidrsubnet',
    ],
    solution: [
      'app-a 10.0.0.0/19', 'app-b 10.0.32.0/19', 'app-c 10.0.64.0/19',
      'pub-a 10.0.96.0/24', 'pub-b 10.0.97.0/24', 'pub-c 10.0.98.0/24',
      'db-a 10.0.99.0/25', 'db-b 10.0.99.128/25', 'apply',
    ],
  },
];

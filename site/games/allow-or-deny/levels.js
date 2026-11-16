// LEVELS for Allow or Deny, an AWS IAM policy-evaluation game.
// This file is data only. To change the game's content you edit this file and nothing else.
//
// A level is a short set of cases. Each case is one request and the policies in play. The player
// answers Allow, or Deny and then explicit or implicit. The rules engine (logic.js, see its header
// for exactly what it models) works out the true answer and explains it step by step.
// The level is WON when at least `pass` answers are right, and LOST otherwise.
// Stars: 3 with every case right, 2 with one wrong, 1 otherwise.
//
// Level fields (all required):
//   id          unique text, starting "aod-"
//   title       shown above the level
//   brief       one or two sentences shown while playing
//   cases       4 to 6 cases, below
//   pass        right answers needed to win: 1 to the number of cases, and MORE than the
//               number of times the most common answer appears in `solution`, so pressing the
//               same button every time cannot win. The shipped levels use cases minus 1: one
//               mistake still wins (2 stars), two lose. Example: 6 cases with solution
//               ['implicit', 'implicit', 'allow', 'implicit', 'allow', 'implicit'] has 4 implicit,
//               so pass must be at least 5.
//   solution    the right answer to each case, in order: 'allow', 'explicit' or 'implicit'.
//               The tests check every one against the engine, so a wrong answer here fails
//               `python3 scripts/arcade.py test allow-or-deny` and names the case.
//               With ?dev on the URL the win screen prints the answers you gave as a solution line.
//   lesson      one plain sentence for the win screen. It must be true.
//   inRealLife  1 to 3 snippets { label, code }, each at most 12 lines: the real policy or command.
//   docs        1 to 3 official documentation URLs (https://) that back the lesson
//
// Case fields:
//   principal        who calls: 'arn:aws:iam::<account>:role/<name>' or '...:user/<name>' (no path).
//                    A role calls as a session: arn:aws:sts::<account>:assumed-role/<name>/<session>.
//   session          optional session name for a role (default 'sample-session')
//   action           e.g. 's3:GetObject'. It must be listed in RESOURCE_SHAPES in
//                    tests/allow-or-deny.test.js, and the resource must have the shape AWS checks
//                    for that action (s3:ListBucket takes the bucket ARN, s3:GetObject an object ARN).
//                    Using a new action means adding it to that list.
//   resource         the ARN AWS authorizes, e.g. 'arn:aws:s3:::sample-app-logs/report.csv'
//   resourceAccount  optional: the account that owns the resource. Default: the caller's account.
//                    Set it for a cross-account S3 case (S3 ARNs carry no account). If the ARN has an
//                    account in it (kms, dynamodb, sqs), it must be the same account.
//   context          optional request context, e.g. { 'aws:SourceIp': '203.0.113.25' }. Values are
//                    text ('true', not true). Leave a key out to model a request that lacks it.
//                    Do not set aws:PrincipalArn or aws:PrincipalAccount: AWS adds them (so does logic.js).
//   note             optional one line shown on the request, e.g. how the caller signed in
//   policies         the policies in play, in the order shown. Each is
//                      { type, name, doc } and, for an SCP, attachedTo
//                    type        'identity' (any number), 'resource' (a bucket or key policy, at most
//                                one), 'boundary' (at most one), 'session' (at most one, roles only),
//                                'scp' (any number)
//                    name        what the page calls it, e.g. 'sample-app-read' or 'Bucket policy: sample-app-logs'
//                    attachedTo  SCPs only: the level it is attached at, e.g. 'Root', 'OU Workloads'.
//                                Every level listed must allow; a level not listed counts as having
//                                the default FullAWSAccess. The SCPs are the caller's account's.
//                    doc         the policy JSON as a JS object: { Version: '2012-10-17', Statement: [...] }.
//                                Statements use Effect, Action or NotAction, Resource or NotResource,
//                                Principal (resource policies only, never elsewhere), Condition, Sid.
//
// The tests also check: ids are unique; every field above is present and in range; every case
// evaluates without hitting something logic.js does not model; principals and accounts are the
// example ones (123456789012, 111122223333); no single answer is right often enough to reach
// `pass`; replaying the solution wins with 3 stars; snippets and URLs keep to the limits above.
//
// To add a case: copy one, change it, set its answer in `solution`, and run the tests. If the
// answer is wrong, the failure tells you the engine's answer; open the game with ?dev&level=N
// and answer the case to read why.

const ROLE = 'arn:aws:iam::123456789012:role/sample-app-role';
const USER = 'arn:aws:iam::123456789012:user/sample-dev';
const CI_ROLE = 'arn:aws:iam::111122223333:role/sample-ci-role';
const LOGS = 'arn:aws:s3:::sample-app-logs';
const REPORT = 'arn:aws:s3:::sample-app-logs/report.csv';
const TABLE = 'arn:aws:dynamodb:us-east-1:123456789012:table/sample-app-orders';
const KEY = 'arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab';

// Policies used by more than one case.
const READ_LOGS = {
  type: 'identity', name: 'sample-app-read',
  doc: { Version: '2012-10-17', Statement: [
    { Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::sample-app-logs/*' },
  ] },
};
const S3_ADMIN = {
  type: 'identity', name: 'sample-app-s3-admin',
  doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }] },
};
const ORDERS = {
  type: 'identity', name: 'sample-app-orders',
  doc: { Version: '2012-10-17', Statement: [
    { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:Query'], Resource: TABLE },
  ] },
};
const FULL_AWS_ACCESS = {
  type: 'scp', name: 'FullAWSAccess', attachedTo: 'Root',
  doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] },
};
const ADMIN = {
  type: 'identity', name: 'AdministratorAccess',
  doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] },
};

export const levels = [
  {
    id: 'aod-01',
    title: 'Nothing says yes',
    brief: 'Every request starts out refused. Something has to say Allow for this exact action on this exact resource.',
    cases: [
      { principal: ROLE, action: 's3:GetObject', resource: REPORT, policies: [READ_LOGS] },
      { principal: ROLE, action: 's3:PutObject', resource: REPORT, policies: [READ_LOGS] },
      { principal: ROLE, action: 's3:GetObject', resource: 'arn:aws:s3:::sample-app-data/users.csv', policies: [READ_LOGS] },
      {
        principal: 'arn:aws:iam::123456789012:role/sample-batch-role', action: 's3:GetObject', resource: REPORT,
        note: 'A new role: nobody has attached a policy to it yet.', policies: [],
      },
      { principal: ROLE, action: 'dynamodb:GetItem', resource: TABLE, policies: [READ_LOGS, ORDERS] },
    ],
    pass: 4,
    solution: ['allow', 'implicit', 'implicit', 'implicit', 'allow'],
    lesson: 'Nothing is allowed until some policy says Allow for this action on this resource; a request that no statement allows is refused by default, which AWS calls an implicit deny.',
    inRealLife: [
      {
        label: 'AWS CLI: ask IAM what it would decide',
        code: [
          'aws iam simulate-principal-policy \\',
          '  --policy-source-arn arn:aws:iam::123456789012:role/sample-app-role \\',
          '  --action-names s3:GetObject s3:PutObject \\',
          '  --resource-arns arn:aws:s3:::sample-app-logs/report.csv \\',
          "  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' \\",
          '  --output text',
          '# with only sample-app-read attached (tab-separated):',
          '# s3:GetObject    allowed',
          '# s3:PutObject    implicitDeny',
        ].join('\n'),
      },
    ],
    docs: [
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html',
      'https://docs.aws.amazon.com/cli/latest/reference/iam/simulate-principal-policy.html',
    ],
  },

  {
    id: 'aod-02',
    title: 'Deny always wins',
    brief: 'Some statements say Deny. Count how many say Allow, then remember that it does not matter.',
    cases: [
      {
        principal: ROLE, action: 's3:DeleteObject', resource: REPORT,
        policies: [S3_ADMIN, {
          type: 'identity', name: 'protect-logs',
          doc: { Version: '2012-10-17', Statement: [
            { Sid: 'NoDeletingLogs', Effect: 'Deny', Action: 's3:Delete*', Resource: [LOGS, 'arn:aws:s3:::sample-app-logs/*'] },
          ] },
        }],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: REPORT,
        policies: [S3_ADMIN, {
          type: 'identity', name: 'protect-logs',
          doc: { Version: '2012-10-17', Statement: [
            { Sid: 'NoDeletingLogs', Effect: 'Deny', Action: 's3:Delete*', Resource: [LOGS, 'arn:aws:s3:::sample-app-logs/*'] },
          ] },
        }],
      },
      {
        principal: ROLE, action: 's3:DeleteObject', resource: 'arn:aws:s3:::sample-app-data/old.csv',
        policies: [S3_ADMIN, {
          type: 'identity', name: 'protect-logs',
          doc: { Version: '2012-10-17', Statement: [
            { Sid: 'NoDeletingLogs', Effect: 'Deny', Action: 's3:Delete*', Resource: [LOGS, 'arn:aws:s3:::sample-app-logs/*'] },
          ] },
        }],
      },
      {
        principal: ROLE, action: 's3:PutObject', resource: REPORT,
        policies: [
          {
            type: 'identity', name: 'sample-app-write',
            doc: { Version: '2012-10-17', Statement: [
              { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject'], Resource: 'arn:aws:s3:::sample-app-logs/*' },
            ] },
          },
          {
            type: 'resource', name: 'Bucket policy: sample-app-logs',
            doc: { Version: '2012-10-17', Statement: [
              { Sid: 'AppMayNotWrite', Effect: 'Deny', Principal: { AWS: ROLE }, Action: 's3:PutObject', Resource: 'arn:aws:s3:::sample-app-logs/*' },
            ] },
          },
        ],
      },
      { principal: ROLE, action: 's3:DeleteObject', resource: REPORT, policies: [READ_LOGS] },
    ],
    pass: 4,
    solution: ['explicit', 'allow', 'allow', 'explicit', 'implicit'],
    lesson: 'One matching Deny statement in any policy refuses the request, however many statements allow it; that is an explicit deny, and nothing can override it.',
    inRealLife: [
      {
        label: 'IAM policy: a Deny guardrail',
        code: [
          '{',
          '  "Version": "2012-10-17",',
          '  "Statement": [{',
          '    "Sid": "NoDeletingLogs",',
          '    "Effect": "Deny",',
          '    "Action": "s3:Delete*",',
          '    "Resource": ["arn:aws:s3:::sample-app-logs", "arn:aws:s3:::sample-app-logs/*"]',
          '  }]',
          '}',
        ].join('\n'),
      },
      {
        label: 'AWS CLI: the simulator names the kind of deny',
        code: [
          'aws iam simulate-principal-policy \\',
          '  --policy-source-arn arn:aws:iam::123456789012:role/sample-app-role \\',
          '  --action-names s3:DeleteObject \\',
          '  --resource-arns arn:aws:s3:::sample-app-logs/report.csv \\',
          "  --query 'EvaluationResults[0].EvalDecision'",
          '"explicitDeny"',
        ].join('\n'),
      },
    ],
    docs: [
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html',
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-basics.html',
    ],
  },

  {
    id: 'aod-03',
    title: 'Stars and slashes',
    brief: 'Read the patterns character by character. A bucket and the objects in it are different resources.',
    cases: [
      {
        principal: ROLE, action: 's3:ListBucket', resource: LOGS,
        policies: [{
          type: 'identity', name: 'sample-app-list',
          doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:ListBucket', Resource: 'arn:aws:s3:::sample-app-logs/*' }] },
        }],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: REPORT,
        policies: [{
          type: 'identity', name: 'sample-app-read',
          doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: LOGS }] },
        }],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: REPORT,
        policies: [{
          type: 'identity', name: 'sample-app-get',
          doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:Get*', Resource: 'arn:aws:s3:::sample-app-logs/*' }] },
        }],
      },
      {
        principal: ROLE, action: 's3:GetBucketPolicy', resource: LOGS,
        policies: [{
          type: 'identity', name: 'sample-app-get',
          doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:Get*', Resource: 'arn:aws:s3:::sample-app-logs/*' }] },
        }],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: 'arn:aws:s3:::sample-app-logs/2026/11/report.csv',
        policies: [{
          type: 'identity', name: 'sample-app-buckets',
          doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::sample-app-*/*' }] },
        }],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: 'arn:aws:s3:::sample-app-logs/day-12/report.csv',
        policies: [{
          type: 'identity', name: 'sample-app-days',
          doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::sample-app-logs/day-?/*' }] },
        }],
      },
    ],
    pass: 5,
    solution: ['implicit', 'implicit', 'allow', 'implicit', 'allow', 'implicit'],
    lesson: 'A statement covers a request only when both its Action and its Resource patterns match: * stands for any run of characters (slashes included) and ? for exactly one, and an S3 bucket (arn:aws:s3:::bucket) is a different resource from its objects (arn:aws:s3:::bucket/*).',
    inRealLife: [
      {
        label: 'IAM policy: list the bucket, read its objects',
        code: [
          '{',
          '  "Version": "2012-10-17",',
          '  "Statement": [',
          '    { "Effect": "Allow", "Action": "s3:ListBucket",',
          '      "Resource": "arn:aws:s3:::sample-app-logs" },',
          '    { "Effect": "Allow", "Action": "s3:GetObject",',
          '      "Resource": "arn:aws:s3:::sample-app-logs/*" }',
          '  ]',
          '}',
        ].join('\n'),
      },
    ],
    docs: [
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_resource.html',
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_action.html',
    ],
  },

  {
    id: 'aod-04',
    title: 'Only if...',
    brief: 'A statement with a Condition counts only when the condition is true. Check the request context, and notice the keys it does not have.',
    cases: [
      {
        principal: ROLE, action: 's3:GetObject', resource: REPORT, context: { 'aws:SourceIp': '198.51.100.7' },
        policies: [{
          type: 'identity', name: 'office-only',
          doc: { Version: '2012-10-17', Statement: [{
            Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::sample-app-logs/*',
            Condition: { IpAddress: { 'aws:SourceIp': '203.0.113.0/24' } },
          }] },
        }],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: REPORT, context: { 'aws:SourceIp': '203.0.113.25' },
        policies: [{
          type: 'identity', name: 'office-only',
          doc: { Version: '2012-10-17', Statement: [{
            Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::sample-app-logs/*',
            Condition: { IpAddress: { 'aws:SourceIp': '203.0.113.0/24' } },
          }] },
        }],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: REPORT, context: { 'aws:SecureTransport': 'false' },
        note: 'The request came over plain HTTP.',
        policies: [READ_LOGS, {
          type: 'resource', name: 'Bucket policy: sample-app-logs',
          doc: { Version: '2012-10-17', Statement: [{
            Sid: 'DenyInsecureTransport', Effect: 'Deny', Principal: '*', Action: 's3:*',
            Resource: [LOGS, 'arn:aws:s3:::sample-app-logs/*'],
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }] },
        }],
      },
      {
        principal: USER, action: 's3:DeleteObject', resource: REPORT, context: { 'aws:SecureTransport': 'true' },
        note: 'The AWS CLI, signed with the user\'s long-term access keys (no MFA session).',
        policies: [
          {
            type: 'identity', name: 'sample-dev-logs',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: 'arn:aws:s3:::sample-app-logs/*' }] },
          },
          {
            type: 'identity', name: 'mfa-to-delete',
            doc: { Version: '2012-10-17', Statement: [{
              Sid: 'DenyDeleteWithoutMfa', Effect: 'Deny', Action: 's3:DeleteObject', Resource: 'arn:aws:s3:::sample-app-logs/*',
              Condition: { Bool: { 'aws:MultiFactorAuthPresent': 'false' } },
            }] },
          },
        ],
      },
      {
        principal: USER, action: 's3:DeleteObject', resource: REPORT, context: { 'aws:SecureTransport': 'true' },
        note: 'The AWS CLI, signed with the user\'s long-term access keys (no MFA session).',
        policies: [
          {
            type: 'identity', name: 'sample-dev-logs',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: 'arn:aws:s3:::sample-app-logs/*' }] },
          },
          {
            type: 'identity', name: 'mfa-to-delete',
            doc: { Version: '2012-10-17', Statement: [{
              Sid: 'DenyDeleteWithoutMfa', Effect: 'Deny', Action: 's3:DeleteObject', Resource: 'arn:aws:s3:::sample-app-logs/*',
              Condition: { BoolIfExists: { 'aws:MultiFactorAuthPresent': 'false' } },
            }] },
          },
        ],
      },
      {
        principal: ROLE, action: 'dynamodb:GetItem', resource: TABLE, context: { 'aws:PrincipalTag/team': 'Orders' },
        policies: [{
          type: 'identity', name: 'team-orders',
          doc: { Version: '2012-10-17', Statement: [{
            Effect: 'Allow', Action: 'dynamodb:GetItem', Resource: TABLE,
            Condition: { StringEquals: { 'aws:PrincipalTag/team': 'orders' } },
          }] },
        }],
      },
    ],
    pass: 5,
    solution: ['implicit', 'allow', 'explicit', 'allow', 'explicit', 'implicit'],
    lesson: 'A statement with a Condition counts only when the condition is true, and a key the request does not carry makes an ordinary condition false, so a Deny on Bool aws:MultiFactorAuthPresent "false" never fires for long-term access keys; BoolIfExists closes that gap.',
    inRealLife: [
      {
        label: 'Bucket policy: refuse plain HTTP',
        code: [
          '{',
          '  "Version": "2012-10-17",',
          '  "Statement": [{',
          '    "Sid": "DenyInsecureTransport",',
          '    "Effect": "Deny", "Principal": "*", "Action": "s3:*",',
          '    "Resource": ["arn:aws:s3:::sample-app-logs", "arn:aws:s3:::sample-app-logs/*"],',
          '    "Condition": { "Bool": { "aws:SecureTransport": "false" } }',
          '  }]',
          '}',
        ].join('\n'),
      },
      {
        label: 'IAM policy statement: deny without MFA, the reliable way',
        code: [
          '{',
          '  "Effect": "Deny",',
          '  "Action": "s3:DeleteObject",',
          '  "Resource": "arn:aws:s3:::sample-app-logs/*",',
          '  "Condition": { "BoolIfExists": { "aws:MultiFactorAuthPresent": "false" } }',
          '}',
        ].join('\n'),
      },
      {
        label: 'AWS CLI: simulate a request from another address',
        code: [
          'aws iam simulate-principal-policy \\',
          '  --policy-source-arn arn:aws:iam::123456789012:role/sample-app-role \\',
          '  --action-names s3:GetObject \\',
          '  --resource-arns arn:aws:s3:::sample-app-logs/report.csv \\',
          '  --context-entries ContextKeyName=aws:SourceIp,ContextKeyValues=198.51.100.7,ContextKeyType=ip',
        ].join('\n'),
      },
    ],
    docs: [
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition_operators.html',
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html',
    ],
  },

  {
    id: 'aod-05',
    title: 'The boundary',
    brief: 'A permissions boundary is a ceiling. Work out what the identity policies allow, then cut it down to what the boundary allows.',
    cases: [
      {
        principal: ROLE, action: 'dynamodb:GetItem', resource: TABLE,
        policies: [
          {
            type: 'identity', name: 'sample-app-wide',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*', 'dynamodb:*'], Resource: '*' }] },
          },
          {
            type: 'boundary', name: 'sample-boundary',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }] },
          },
        ],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: REPORT,
        policies: [
          {
            type: 'identity', name: 'sample-app-wide',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*', 'dynamodb:*'], Resource: '*' }] },
          },
          {
            type: 'boundary', name: 'sample-boundary',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }] },
          },
        ],
      },
      {
        principal: ROLE, action: 'dynamodb:PutItem', resource: TABLE,
        policies: [READ_LOGS, {
          type: 'boundary', name: 'sample-boundary',
          doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*', 'dynamodb:*'], Resource: '*' }] },
        }],
      },
      {
        principal: ROLE, action: 's3:DeleteBucket', resource: LOGS,
        policies: [S3_ADMIN, {
          type: 'boundary', name: 'sample-boundary',
          doc: { Version: '2012-10-17', Statement: [
            { Effect: 'Allow', Action: 's3:*', Resource: '*' },
            { Sid: 'NeverDeleteBuckets', Effect: 'Deny', Action: 's3:DeleteBucket', Resource: '*' },
          ] },
        }],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: REPORT,
        policies: [
          ORDERS,
          {
            type: 'boundary', name: 'tables-only',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'dynamodb:*', Resource: '*' }] },
          },
          {
            type: 'resource', name: 'Bucket policy: sample-app-logs',
            doc: { Version: '2012-10-17', Statement: [
              { Effect: 'Allow', Principal: { AWS: ROLE }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::sample-app-logs/*' },
            ] },
          },
        ],
      },
      {
        principal: USER, action: 's3:GetObject', resource: REPORT,
        policies: [
          {
            type: 'identity', name: 'sample-dev-orders',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'dynamodb:*', Resource: TABLE }] },
          },
          {
            type: 'boundary', name: 'tables-only',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'dynamodb:*', Resource: '*' }] },
          },
          {
            type: 'resource', name: 'Bucket policy: sample-app-logs',
            doc: { Version: '2012-10-17', Statement: [
              { Effect: 'Allow', Principal: { AWS: USER }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::sample-app-logs/*' },
            ] },
          },
        ],
      },
    ],
    pass: 5,
    solution: ['implicit', 'allow', 'implicit', 'explicit', 'implicit', 'allow'],
    lesson: 'A permissions boundary is a ceiling, not a grant: an Allow in an identity policy counts only where the boundary allows it too, and in one account the boundary also caps a resource policy that names the role ARN, but not one that names the IAM user (or the role session) directly.',
    inRealLife: [
      {
        label: 'Permissions boundary: sample-boundary',
        code: [
          '{',
          '  "Version": "2012-10-17",',
          '  "Statement": [',
          '    { "Effect": "Allow", "Action": "s3:*", "Resource": "*" },',
          '    { "Effect": "Deny", "Action": "s3:DeleteBucket", "Resource": "*" }',
          '  ]',
          '}',
        ].join('\n'),
      },
      {
        label: 'AWS CLI: set it on a role',
        code: [
          'aws iam put-role-permissions-boundary \\',
          '  --role-name sample-app-role \\',
          '  --permissions-boundary arn:aws:iam::123456789012:policy/sample-boundary',
        ].join('\n'),
      },
    ],
    docs: [
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html',
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html',
    ],
  },

  {
    id: 'aod-06',
    title: 'Guardrails from above',
    brief: 'The account is a member of an AWS Organization. SCPs set the most its users and roles may do; they never give anything.',
    cases: [
      { principal: ROLE, action: 's3:GetObject', resource: REPORT, note: 'No identity policy is attached to the role.', policies: [FULL_AWS_ACCESS] },
      {
        principal: ROLE, action: 'dynamodb:DeleteTable', resource: TABLE,
        policies: [
          {
            type: 'identity', name: 'sample-app-dynamodb',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'dynamodb:*', Resource: TABLE }] },
          },
          FULL_AWS_ACCESS,
          {
            type: 'scp', name: 'protect-tables', attachedTo: 'Root',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Deny', Action: 'dynamodb:DeleteTable', Resource: '*' }] },
          },
        ],
      },
      {
        principal: ROLE, action: 'sqs:SendMessage', resource: 'arn:aws:sqs:us-east-1:123456789012:sample-app-jobs',
        policies: [ADMIN, FULL_AWS_ACCESS, {
          type: 'scp', name: 'workloads-allow-list', attachedTo: 'OU Workloads',
          doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*', 'dynamodb:*'], Resource: '*' }] },
        }],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: REPORT,
        policies: [ADMIN, FULL_AWS_ACCESS, {
          type: 'scp', name: 'workloads-allow-list', attachedTo: 'OU Workloads',
          doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*', 'dynamodb:*'], Resource: '*' }] },
        }],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: REPORT,
        policies: [
          {
            type: 'resource', name: 'Bucket policy: sample-app-logs',
            doc: { Version: '2012-10-17', Statement: [
              { Effect: 'Allow', Principal: { AWS: ROLE }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::sample-app-logs/*' },
            ] },
          },
          FULL_AWS_ACCESS,
          {
            type: 'scp', name: 'tables-only', attachedTo: 'OU Workloads',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'dynamodb:*', Resource: '*' }] },
          },
        ],
      },
    ],
    pass: 4,
    solution: ['implicit', 'explicit', 'implicit', 'allow', 'implicit'],
    lesson: 'A service control policy (SCP) is a ceiling for the IAM users and roles in a member account and never grants anything: every level from the root down to the account must allow the action, and an identity or resource policy must still grant it.',
    inRealLife: [
      {
        label: 'SCP: allow-list for the Workloads OU (FullAWSAccess detached there)',
        code: [
          '{',
          '  "Version": "2012-10-17",',
          '  "Statement": [{',
          '    "Effect": "Allow",',
          '    "Action": ["s3:*", "dynamodb:*"],',
          '    "Resource": "*"',
          '  }]',
          '}',
        ].join('\n'),
      },
      {
        label: 'AWS CLI: attach an SCP to an OU',
        code: [
          'aws organizations attach-policy \\',
          '  --policy-id p-examplepolicyid111 \\',
          '  --target-id ou-examplerootid111-exampleouid111',
        ].join('\n'),
      },
    ],
    docs: [
      'https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html',
      'https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html',
    ],
  },

  {
    id: 'aod-07',
    title: 'Whose policy has to say yes?',
    brief: 'In one account, one Allow from either side is enough. When a role in 111122223333 reaches into 123456789012, both sides must allow. KMS keys play by their own rule.',
    cases: [
      {
        principal: ROLE, action: 's3:GetObject', resource: 'arn:aws:s3:::sample-app-artifacts/build.zip',
        policies: [ORDERS, {
          type: 'resource', name: 'Bucket policy: sample-app-artifacts',
          doc: { Version: '2012-10-17', Statement: [
            { Effect: 'Allow', Principal: { AWS: ROLE }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::sample-app-artifacts/*' },
          ] },
        }],
      },
      {
        principal: CI_ROLE, action: 's3:GetObject', resource: 'arn:aws:s3:::sample-app-artifacts/build.zip', resourceAccount: '123456789012',
        note: 'The bucket is in account 123456789012. The role has no S3 policy of its own.',
        policies: [{
          type: 'resource', name: 'Bucket policy: sample-app-artifacts',
          doc: { Version: '2012-10-17', Statement: [
            { Effect: 'Allow', Principal: { AWS: CI_ROLE }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::sample-app-artifacts/*' },
          ] },
        }],
      },
      {
        principal: CI_ROLE, action: 's3:GetObject', resource: 'arn:aws:s3:::sample-app-artifacts/build.zip', resourceAccount: '123456789012',
        note: 'The bucket is in account 123456789012.',
        policies: [
          {
            type: 'identity', name: 'sample-ci-artifacts',
            doc: { Version: '2012-10-17', Statement: [
              { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject'], Resource: 'arn:aws:s3:::sample-app-artifacts/*' },
            ] },
          },
          {
            type: 'resource', name: 'Bucket policy: sample-app-artifacts',
            doc: { Version: '2012-10-17', Statement: [
              { Effect: 'Allow', Principal: { AWS: CI_ROLE }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::sample-app-artifacts/*' },
            ] },
          },
        ],
      },
      {
        principal: CI_ROLE, action: 's3:PutObject', resource: 'arn:aws:s3:::sample-app-artifacts/build.zip', resourceAccount: '123456789012',
        note: 'The bucket is in account 123456789012.',
        policies: [
          {
            type: 'identity', name: 'sample-ci-artifacts',
            doc: { Version: '2012-10-17', Statement: [
              { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject'], Resource: 'arn:aws:s3:::sample-app-artifacts/*' },
            ] },
          },
          {
            type: 'resource', name: 'Bucket policy: sample-app-artifacts',
            doc: { Version: '2012-10-17', Statement: [
              { Effect: 'Allow', Principal: { AWS: CI_ROLE }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::sample-app-artifacts/*' },
            ] },
          },
        ],
      },
      {
        principal: ROLE, action: 'kms:Decrypt', resource: KEY,
        policies: [
          {
            type: 'identity', name: 'sample-app-decrypt',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'kms:Decrypt', Resource: KEY }] },
          },
          {
            type: 'resource', name: 'Key policy: sample-app-key',
            doc: { Version: '2012-10-17', Statement: [{
              Sid: 'KeyAdmins', Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::123456789012:role/sample-key-admin' },
              Action: 'kms:*', Resource: '*',
            }] },
          },
        ],
      },
      {
        principal: ROLE, action: 'kms:Decrypt', resource: KEY,
        policies: [
          {
            type: 'identity', name: 'sample-app-decrypt',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'kms:Decrypt', Resource: KEY }] },
          },
          {
            type: 'resource', name: 'Key policy: sample-app-key',
            doc: { Version: '2012-10-17', Statement: [{
              Sid: 'Enable IAM User Permissions', Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::123456789012:root' },
              Action: 'kms:*', Resource: '*',
            }] },
          },
        ],
      },
    ],
    pass: 5,
    solution: ['allow', 'implicit', 'allow', 'implicit', 'implicit', 'allow'],
    lesson: 'For most resources in one account an Allow in either the identity policy or the resource policy is enough, but a KMS key policy must always allow (its "...:root" statement hands the decision to IAM policies), and across accounts both the caller\'s identity policy and the resource\'s policy must allow.',
    inRealLife: [
      {
        label: 'Bucket policy in 123456789012',
        code: [
          '{',
          '  "Version": "2012-10-17",',
          '  "Statement": [{',
          '    "Effect": "Allow",',
          '    "Principal": { "AWS": "arn:aws:iam::111122223333:role/sample-ci-role" },',
          '    "Action": "s3:GetObject",',
          '    "Resource": "arn:aws:s3:::sample-app-artifacts/*"',
          '  }]',
          '}',
        ].join('\n'),
      },
      {
        label: 'Identity policy on sample-ci-role in 111122223333',
        code: [
          '{',
          '  "Version": "2012-10-17",',
          '  "Statement": [{',
          '    "Effect": "Allow",',
          '    "Action": "s3:GetObject",',
          '    "Resource": "arn:aws:s3:::sample-app-artifacts/*"',
          '  }]',
          '}',
        ].join('\n'),
      },
    ],
    docs: [
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic-cross-account.html',
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html',
      'https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html',
    ],
  },

  {
    id: 'aod-08',
    title: 'Not what it seems',
    brief: 'NotAction and NotResource mean "everything except". Read them as a list of what is left out, not what is covered.',
    cases: [
      {
        principal: ROLE, action: 'dynamodb:DeleteTable', resource: TABLE,
        policies: [{
          type: 'identity', name: 'everything-but-iam',
          doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', NotAction: 'iam:*', Resource: '*' }] },
        }],
      },
      {
        principal: ROLE, action: 'iam:CreateUser', resource: 'arn:aws:iam::123456789012:user/sample-intern',
        policies: [{
          type: 'identity', name: 'everything-but-iam',
          doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', NotAction: 'iam:*', Resource: '*' }] },
        }],
      },
      {
        principal: ROLE, action: 'dynamodb:GetItem', resource: 'arn:aws:dynamodb:eu-west-1:123456789012:table/sample-app-orders',
        context: { 'aws:RequestedRegion': 'eu-west-1' },
        policies: [
          {
            type: 'identity', name: 'sample-app-dynamodb',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'dynamodb:*', Resource: '*' }] },
          },
          FULL_AWS_ACCESS,
          {
            type: 'scp', name: 'us-east-1-only', attachedTo: 'Root',
            doc: { Version: '2012-10-17', Statement: [{
              Sid: 'DenyOtherRegions', Effect: 'Deny',
              NotAction: ['cloudfront:*', 'iam:*', 'organizations:*', 'route53:*', 'support:*'], Resource: '*',
              Condition: { StringNotEquals: { 'aws:RequestedRegion': 'us-east-1' } },
            }] },
          },
        ],
      },
      {
        principal: ROLE, action: 'dynamodb:GetItem', resource: TABLE, context: { 'aws:RequestedRegion': 'us-east-1' },
        policies: [
          {
            type: 'identity', name: 'sample-app-dynamodb',
            doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'dynamodb:*', Resource: '*' }] },
          },
          FULL_AWS_ACCESS,
          {
            type: 'scp', name: 'us-east-1-only', attachedTo: 'Root',
            doc: { Version: '2012-10-17', Statement: [{
              Sid: 'DenyOtherRegions', Effect: 'Deny',
              NotAction: ['cloudfront:*', 'iam:*', 'organizations:*', 'route53:*', 'support:*'], Resource: '*',
              Condition: { StringNotEquals: { 'aws:RequestedRegion': 'us-east-1' } },
            }] },
          },
        ],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: 'arn:aws:s3:::sample-app-secrets/db-password.txt',
        policies: [{
          type: 'identity', name: 's3-but-not-secrets',
          doc: { Version: '2012-10-17', Statement: [{
            Effect: 'Allow', Action: 's3:*',
            NotResource: ['arn:aws:s3:::sample-app-secrets', 'arn:aws:s3:::sample-app-secrets/*'],
          }] },
        }],
      },
      {
        principal: ROLE, action: 's3:GetObject', resource: 'arn:aws:s3:::sample-app-data/users.csv',
        policies: [S3_ADMIN, {
          type: 'identity', name: 'only-the-log-bucket',
          doc: { Version: '2012-10-17', Statement: [{
            Sid: 'NothingButLogs', Effect: 'Deny', Action: 's3:*',
            NotResource: [LOGS, 'arn:aws:s3:::sample-app-logs/*'],
          }] },
        }],
      },
    ],
    pass: 5,
    solution: ['allow', 'implicit', 'explicit', 'allow', 'implicit', 'explicit'],
    lesson: 'NotAction and NotResource mean "everything except": an Allow with NotAction and Resource "*" quietly grants every other action in every service, while a Deny with NotAction is a common guardrail that blocks everything except the actions it lists.',
    inRealLife: [
      {
        label: 'Statement (SCP or IAM policy): deny outside us-east-1, as in AWS\'s example',
        code: [
          '{',
          '  "Sid": "DenyOtherRegions",',
          '  "Effect": "Deny",',
          '  "NotAction": ["cloudfront:*", "iam:*", "organizations:*",',
          '                "route53:*", "support:*"],',
          '  "Resource": "*",',
          '  "Condition": {',
          '    "StringNotEquals": { "aws:RequestedRegion": ["us-east-1"] }',
          '  }',
          '}',
        ].join('\n'),
      },
    ],
    docs: [
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notaction.html',
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notresource.html',
      'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_examples_aws_deny-requested-region.html',
    ],
  },
];

// Tests for Allow or Deny.
//
// Three groups:
//   1. the level data keeps to the rules in the header of levels.js, and every stored answer
//      (each level's `solution`) is the engine's verdict for that case
//   2. one or more small tests per evaluation rule, each built from scratch, so a change to
//      logic.js that breaks AWS's logic fails here with the rule's name
//   3. the game itself: replaying a solution wins, wrong answers lose, inputs are checked

import { test, assert } from './harness.js';
import { levels } from '../site/games/allow-or-deny/levels.js';
import {
  ANSWERS, POLICY_TYPES, start, apply, replay, stars, evaluate, contextOf, contextShown,
  actionMatches, arnMatches, inCidr, conditionHolds, principalOf, resourceAccountOf,
} from '../site/games/allow-or-deny/logic.js';

// The resource ARN AWS authorizes for each action the levels use. A new action in levels.js
// must be added here, with the shape of resource AWS checks for it.
const RESOURCE_SHAPES = {
  's3:GetObject': /^arn:aws:s3:::[a-z0-9.-]+\/.+$/,
  's3:PutObject': /^arn:aws:s3:::[a-z0-9.-]+\/.+$/,
  's3:DeleteObject': /^arn:aws:s3:::[a-z0-9.-]+\/.+$/,
  's3:ListBucket': /^arn:aws:s3:::[a-z0-9.-]+$/,
  's3:GetBucketPolicy': /^arn:aws:s3:::[a-z0-9.-]+$/,
  's3:DeleteBucket': /^arn:aws:s3:::[a-z0-9.-]+$/,
  'dynamodb:GetItem': /^arn:aws:dynamodb:[a-z0-9-]+:\d{12}:table\/[\w.-]+$/,
  'dynamodb:PutItem': /^arn:aws:dynamodb:[a-z0-9-]+:\d{12}:table\/[\w.-]+$/,
  'dynamodb:DeleteTable': /^arn:aws:dynamodb:[a-z0-9-]+:\d{12}:table\/[\w.-]+$/,
  'sqs:SendMessage': /^arn:aws:sqs:[a-z0-9-]+:\d{12}:[\w-]+$/,
  'kms:Decrypt': /^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[\w-]+$/,
  'iam:CreateUser': /^arn:aws:iam::\d{12}:user\/[\w+=,.@-]+$/,
};
const EXAMPLE_ACCOUNTS = ['123456789012', '111122223333'];

// ------------------------------------------------------------ 1. the level data

test('level ids are unique and start with aod-', () => {
  const ids = levels.map((level) => level.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id.startsWith('aod-'), id);
});

for (const level of levels) {
  test(`${level.id}: fields keep to the header's limits`, () => {
    for (const field of ['title', 'brief', 'lesson']) assert.ok(typeof level[field] === 'string' && level[field].length > 0, field);
    assert.ok(Array.isArray(level.cases) && level.cases.length >= 4 && level.cases.length <= 6, 'cases: 4 to 6');
    assert.ok(Number.isInteger(level.pass) && level.pass >= 1 && level.pass <= level.cases.length, 'pass: 1 to the number of cases');
    assert.equal(level.solution.length, level.cases.length, 'solution: one answer per case');
    for (const answer of level.solution) assert.ok(ANSWERS.includes(answer), `answer "${answer}"`);
    for (const answer of ANSWERS) {
      const count = level.solution.filter((given) => given === answer).length;
      assert.ok(count < level.pass, `pressing "${answer}" every time gets ${count} right; pass must be more than ${count}`);
    }
    assert.ok(level.inRealLife.length >= 1 && level.inRealLife.length <= 3, 'inRealLife: 1 to 3 snippets');
    for (const snippet of level.inRealLife) {
      assert.ok(typeof snippet.label === 'string' && snippet.label.length > 0, 'snippet label');
      assert.ok(snippet.code.split('\n').length <= 12, `snippet "${snippet.label}" is at most 12 lines`);
    }
    assert.ok(level.docs.length >= 1 && level.docs.length <= 3, 'docs: 1 to 3 URLs');
    for (const url of level.docs) assert.ok(url.startsWith('https://'), url);
  });

  level.cases.forEach((kase, i) => {
    const name = `${level.id} case ${i + 1}`;

    test(`${name}: request and policies are well formed`, () => {
      const who = principalOf(kase);
      assert.ok(EXAMPLE_ACCOUNTS.includes(who.account), `principal account ${who.account}`);
      assert.ok(EXAMPLE_ACCOUNTS.includes(resourceAccountOf(kase)), 'resourceAccount');
      const shape = RESOURCE_SHAPES[kase.action];
      assert.ok(shape, `${kase.action} is listed in RESOURCE_SHAPES`);
      assert.ok(shape.test(kase.resource), `${kase.resource} is the resource ${kase.action} takes`);
      const arnAccount = kase.resource.split(':')[4];
      if (arnAccount) assert.equal(arnAccount, resourceAccountOf(kase), 'the account in the ARN is the resource account');
      for (const [key, value] of Object.entries(kase.context || {})) {
        assert.ok(typeof value === 'string', `${key} is text`);
        assert.ok(!['aws:principalarn', 'aws:principalaccount'].includes(key.toLowerCase()), `${key} is added by AWS, not the case`);
      }
      for (const policy of kase.policies) {
        assert.ok(POLICY_TYPES.includes(policy.type), policy.type);
        assert.ok(typeof policy.name === 'string' && policy.name.length > 0, 'policy name');
        assert.equal(policy.doc.Version, '2012-10-17', `${policy.name} Version`);
      }
    });

    test(`${name}: the stored answer is the engine's verdict`, () => {
      assert.equal(level.solution[i], evaluate(kase).answer);
    });
  });

  test(`${level.id}: the solution wins with 3 stars`, () => {
    const state = replay(level, level.solution);
    assert.equal(state.status, 'won');
    assert.equal(stars(state), 3);
  });
}

// ------------------------------------------------------------ 2. one test per rule

const ROLE = 'arn:aws:iam::123456789012:role/sample-app-role';
const SESSION = 'arn:aws:sts::123456789012:assumed-role/sample-app-role/sample-session';
const USER = 'arn:aws:iam::123456789012:user/sample-dev';
const CI_ROLE = 'arn:aws:iam::111122223333:role/sample-ci-role';
const BUCKET = 'arn:aws:s3:::sample-app-logs';
const OBJECT = 'arn:aws:s3:::sample-app-logs/report.csv';
const KEY = 'arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab';

const doc = (...Statement) => ({ Version: '2012-10-17', Statement });
const allow = (Action, Resource = '*', extra = {}) => ({ Effect: 'Allow', Action, Resource, ...extra });
const deny = (Action, Resource = '*', extra = {}) => ({ Effect: 'Deny', Action, Resource, ...extra });
const identity = (...statements) => ({ type: 'identity', name: 'id', doc: doc(...statements) });
const boundary = (...statements) => ({ type: 'boundary', name: 'boundary', doc: doc(...statements) });
const session = (...statements) => ({ type: 'session', name: 'session', doc: doc(...statements) });
const resource = (...statements) => ({ type: 'resource', name: 'resource', doc: doc(...statements) });
const scp = (attachedTo, ...statements) => ({ type: 'scp', name: `scp-${attachedTo}`, attachedTo, doc: doc(...statements) });
const grant = (principal, Action = 's3:GetObject', Resource = `${BUCKET}/*`) => ({ Effect: 'Allow', Principal: principal, Action, Resource });

// A request by the role for one S3 object unless a field says otherwise.
function verdict(fields) {
  return evaluate({ principal: ROLE, action: 's3:GetObject', resource: OBJECT, policies: [], ...fields }).answer;
}

test('rule: with no policy at all, the answer is an implicit deny', () => {
  assert.equal(verdict({}), 'implicit');
});

test('rule: an explicit deny wins over any number of allows, in any policy type', () => {
  const allows = [identity(allow('s3:*')), resource(grant({ AWS: ROLE }))];
  assert.equal(verdict({ policies: [...allows, identity(deny('s3:GetObject'))] }), 'explicit');
  assert.equal(verdict({ policies: [...allows, boundary(allow('*'), deny('s3:GetObject'))] }), 'explicit');
  assert.equal(verdict({ policies: [...allows, scp('Root', allow('*'), deny('s3:*'))] }), 'explicit');
  assert.equal(verdict({ policies: [...allows, session(allow('*'), deny('s3:GetObject'))] }), 'explicit');
  assert.equal(verdict({ policies: [identity(allow('s3:*')), resource({ Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: `${BUCKET}/*` })] }), 'explicit');
});

test('rule: an SCP never grants', () => {
  assert.equal(verdict({ policies: [scp('Root', allow('*'))] }), 'implicit');
  assert.equal(verdict({ policies: [scp('Root', allow('*')), identity(allow('s3:GetObject'))] }), 'allow');
});

test('rule: every SCP level listed must allow', () => {
  const id = identity(allow('*'));
  assert.equal(verdict({ policies: [id, scp('Root', allow('*')), scp('OU Workloads', allow('dynamodb:*'))] }), 'implicit');
  assert.equal(verdict({ policies: [id, scp('Root', allow('*')), scp('OU Workloads', allow('s3:*'))] }), 'allow');
  // a Deny-only SCP at a level leaves that level with no Allow
  assert.equal(verdict({ policies: [id, scp('Root', allow('*')), scp('OU Workloads', deny('ec2:*'))] }), 'implicit');
});

test('rule: an SCP limits a same-account resource policy grant too', () => {
  const policies = [resource(grant({ AWS: SESSION })), scp('Root', allow('dynamodb:*'))];
  assert.equal(verdict({ policies }), 'implicit');
});

test('rule: effective permissions are identity policy AND boundary', () => {
  assert.equal(verdict({ policies: [identity(allow('s3:*')), boundary(allow('dynamodb:*'))] }), 'implicit');
  assert.equal(verdict({ policies: [identity(allow('dynamodb:*')), boundary(allow('s3:*'))] }), 'implicit');
  assert.equal(verdict({ policies: [identity(allow('s3:*')), boundary(allow('s3:Get*'))] }), 'allow');
});

test('rule: a session policy limits but never grants', () => {
  assert.equal(verdict({ policies: [session(allow('s3:*'))] }), 'implicit');
  assert.equal(verdict({ policies: [identity(allow('s3:*')), session(allow('dynamodb:*'))] }), 'implicit');
  assert.equal(verdict({ policies: [identity(allow('s3:*')), session(allow('s3:GetObject'))] }), 'allow');
});

test('rule: in one account, a resource policy alone can allow', () => {
  assert.equal(verdict({ policies: [resource(grant({ AWS: ROLE }))] }), 'allow');
  assert.equal(verdict({ policies: [resource(grant('*'))] }), 'allow');
  assert.equal(verdict({ principal: USER, policies: [resource(grant({ AWS: USER }))] }), 'allow');
});

test('rule: a resource policy naming the role ARN is limited by a boundary and a session policy', () => {
  const bucket = resource(grant({ AWS: ROLE }));
  assert.equal(verdict({ policies: [bucket, boundary(allow('dynamodb:*'))] }), 'implicit');
  assert.equal(verdict({ policies: [bucket, session(allow('dynamodb:*'))] }), 'implicit');
  assert.equal(verdict({ policies: [bucket, boundary(allow('s3:*'))] }), 'allow');
});

test('rule: a resource policy naming the session ARN or the user ARN is not limited by an implicit deny', () => {
  assert.equal(verdict({ policies: [resource(grant({ AWS: SESSION })), boundary(allow('dynamodb:*')), session(allow('dynamodb:*'))] }), 'allow');
  assert.equal(verdict({ principal: USER, policies: [resource(grant({ AWS: USER })), boundary(allow('dynamodb:*'))] }), 'allow');
  // ...but an explicit deny still wins
  assert.equal(verdict({ policies: [resource(grant({ AWS: SESSION })), boundary(allow('*'), deny('s3:*'))] }), 'explicit');
});

test('rule: a session name must match for a session ARN principal', () => {
  assert.equal(verdict({ session: 'other', policies: [resource(grant({ AWS: SESSION }))] }), 'implicit');
});

test('rule: cross-account needs the identity policy AND the resource policy', () => {
  const base = { principal: CI_ROLE, resourceAccount: '123456789012' };
  const id = identity(allow('s3:GetObject', `${BUCKET}/*`));
  const bucket = resource(grant({ AWS: CI_ROLE }));
  assert.equal(verdict({ ...base, policies: [id] }), 'implicit');
  assert.equal(verdict({ ...base, policies: [bucket] }), 'implicit');
  assert.equal(verdict({ ...base, policies: [id, bucket] }), 'allow');
  // the bucket policy naming the caller's whole account hands the decision to that account's IAM
  assert.equal(verdict({ ...base, policies: [id, resource(grant({ AWS: 'arn:aws:iam::111122223333:root' }))] }), 'allow');
  assert.equal(verdict({ ...base, policies: [id, resource(grant({ AWS: '111122223333' }))] }), 'allow');
  // a grant to a different account does not count
  assert.equal(verdict({ ...base, policies: [id, resource(grant({ AWS: 'arn:aws:iam::123456789012:root' }))] }), 'implicit');
  // even a session ARN grant does not skip the caller's identity policy across accounts
  const ciSession = 'arn:aws:sts::111122223333:assumed-role/sample-ci-role/sample-session';
  assert.equal(verdict({ ...base, policies: [resource(grant({ AWS: ciSession }))] }), 'implicit');
  // the caller's boundary still applies
  assert.equal(verdict({ ...base, policies: [id, bucket, boundary(allow('dynamodb:*'))] }), 'implicit');
});

test('rule: a KMS key policy must allow', () => {
  const base = { action: 'kms:Decrypt', resource: KEY };
  const id = identity(allow('kms:Decrypt', KEY));
  const admins = resource(grant({ AWS: 'arn:aws:iam::123456789012:role/sample-key-admin' }, 'kms:*', '*'));
  const rootStatement = resource(grant({ AWS: 'arn:aws:iam::123456789012:root' }, 'kms:*', '*'));
  assert.equal(verdict({ ...base, policies: [id, admins] }), 'implicit');
  assert.equal(verdict({ ...base, policies: [id, rootStatement] }), 'allow');
  assert.equal(verdict({ ...base, policies: [rootStatement] }), 'implicit');
  assert.equal(verdict({ ...base, policies: [resource(grant({ AWS: ROLE }, 'kms:Decrypt', '*'))] }), 'allow');
  assert.throws(() => verdict({ ...base, policies: [id] }), 'a KMS case without its key policy');
});

test('rule: Allow with NotAction covers every other action, in every service', () => {
  const id = identity({ Effect: 'Allow', NotAction: 'iam:*', Resource: '*' });
  assert.equal(verdict({ policies: [id] }), 'allow');
  assert.equal(verdict({ action: 'dynamodb:DeleteTable', resource: 'arn:aws:dynamodb:us-east-1:123456789012:table/t', policies: [id] }), 'allow');
  assert.equal(verdict({ action: 'iam:CreateUser', resource: 'arn:aws:iam::123456789012:user/u', policies: [id] }), 'implicit');
});

test('rule: Deny with NotAction denies everything except what it lists', () => {
  const guard = identity(allow('*'), { Effect: 'Deny', NotAction: ['iam:*', 'sts:*'], Resource: '*' });
  assert.equal(verdict({ policies: [guard] }), 'explicit');
  assert.equal(verdict({ action: 'iam:CreateUser', resource: 'arn:aws:iam::123456789012:user/u', policies: [guard] }), 'allow');
});

test('rule: NotResource covers every resource except the ones listed', () => {
  const id = identity({ Effect: 'Allow', Action: 's3:*', NotResource: `${BUCKET}/*` });
  assert.equal(verdict({ policies: [id] }), 'implicit');
  assert.equal(verdict({ resource: 'arn:aws:s3:::sample-app-data/a.csv', policies: [id] }), 'allow');
  const guard = identity(allow('s3:*'), { Effect: 'Deny', Action: 's3:*', NotResource: [BUCKET, `${BUCKET}/*`] });
  assert.equal(verdict({ resource: 'arn:aws:s3:::sample-app-data/a.csv', policies: [guard] }), 'explicit');
  assert.equal(verdict({ policies: [guard] }), 'allow');
});

test('wildcards: an S3 bucket ARN and its object ARNs are different resources', () => {
  assert.ok(!arnMatches(BUCKET, OBJECT));
  assert.ok(!arnMatches(`${BUCKET}/*`, BUCKET));
  assert.ok(arnMatches(`${BUCKET}/*`, OBJECT));
  assert.ok(arnMatches(`${BUCKET}/*`, `${BUCKET}/2026/11/deep/report.csv`), '* crosses slashes');
  assert.ok(arnMatches('arn:aws:s3:::*', BUCKET));
  assert.ok(arnMatches('arn:aws:s3:::sample-app-*/*', OBJECT));
  assert.ok(!arnMatches('arn:aws:s3:::sample-app-*/*', 'arn:aws:s3:::other/report.csv'));
  assert.ok(arnMatches('*', KEY));
});

test('wildcards: ? is exactly one character', () => {
  assert.ok(arnMatches(`${BUCKET}/day-?/*`, `${BUCKET}/day-7/report.csv`));
  assert.ok(!arnMatches(`${BUCKET}/day-?/*`, `${BUCKET}/day-12/report.csv`));
  assert.ok(actionMatches('s3:Get?bject', 's3:GetObject'));
});

test('wildcards: ARN segments are matched one by one, and case matters', () => {
  assert.ok(arnMatches('arn:aws:dynamodb:*:123456789012:table/sample-*', 'arn:aws:dynamodb:eu-west-1:123456789012:table/sample-x'));
  assert.ok(!arnMatches('arn:aws:dynamodb:*:123456789012:table/sample-*', 'arn:aws:dynamodb:eu-west-1:111122223333:table/sample-x'));
  assert.ok(!arnMatches('arn:aws:s3:::Sample-App-Logs/*', OBJECT));
});

test('wildcards: actions match with * and ignore case', () => {
  assert.ok(actionMatches('s3:Get*', 's3:GetObject'));
  assert.ok(actionMatches('s3:Get*', 's3:GetBucketPolicy'));
  assert.ok(!actionMatches('s3:Get*', 's3:PutObject'));
  assert.ok(actionMatches('S3:getobject', 's3:GetObject'));
  assert.ok(actionMatches('*', 'kms:Decrypt'));
  assert.ok(actionMatches('iam:*AccessKey*', 'iam:CreateAccessKey'));
  assert.ok(!actionMatches('s3:GetObject', 's3:GetObjectAcl'));
});

test('conditions: StringEquals is exact and case-sensitive; StringLike takes wildcards', () => {
  const ctx = { 'aws:PrincipalTag/team': 'Orders' };
  assert.ok(!conditionHolds('StringEquals', 'aws:PrincipalTag/team', 'orders', ctx));
  assert.ok(conditionHolds('StringEquals', 'aws:PrincipalTag/team', 'Orders', ctx));
  assert.ok(conditionHolds('StringEqualsIgnoreCase', 'aws:PrincipalTag/team', 'orders', ctx));
  assert.ok(conditionHolds('StringLike', 'aws:PrincipalTag/team', 'Ord*', ctx));
  assert.ok(!conditionHolds('StringLike', 'aws:PrincipalTag/team', 'ord*', ctx));
  assert.ok(conditionHolds('StringNotEquals', 'aws:PrincipalTag/team', 'orders', ctx));
});

test('conditions: key names ignore case; several values are OR', () => {
  const ctx = { 'aws:SourceIp': '203.0.113.9' };
  assert.ok(conditionHolds('IpAddress', 'AWS:SOURCEIP', '203.0.113.0/24', ctx));
  assert.ok(conditionHolds('IpAddress', 'aws:SourceIp', ['198.51.100.0/24', '203.0.113.0/24'], ctx));
});

test('conditions: several keys and operators in one Condition are AND', () => {
  const both = { IpAddress: { 'aws:SourceIp': '203.0.113.0/24' }, Bool: { 'aws:SecureTransport': 'true' } };
  const id = identity(allow('s3:GetObject', '*', { Condition: both }));
  assert.equal(verdict({ context: { 'aws:SourceIp': '203.0.113.9', 'aws:SecureTransport': 'true' }, policies: [id] }), 'allow');
  assert.equal(verdict({ context: { 'aws:SourceIp': '203.0.113.9', 'aws:SecureTransport': 'false' }, policies: [id] }), 'implicit');
});

test('conditions: IpAddress and NotIpAddress use CIDR blocks', () => {
  assert.ok(inCidr('203.0.113.0/24', '203.0.113.255'));
  assert.ok(!inCidr('203.0.113.0/24', '198.51.100.0'));
  assert.ok(inCidr('198.51.100.7', '198.51.100.7'), 'no /n means /32');
  assert.ok(!inCidr('198.51.100.7', '198.51.100.8'));
  const ctx = { 'aws:SourceIp': '198.51.100.7' };
  assert.ok(conditionHolds('NotIpAddress', 'aws:SourceIp', '203.0.113.0/24', ctx));
  assert.ok(!conditionHolds('IpAddress', 'aws:SourceIp', '203.0.113.0/24', ctx));
});

test('conditions: Bool compares true and false', () => {
  assert.ok(conditionHolds('Bool', 'aws:SecureTransport', 'false', { 'aws:SecureTransport': 'false' }));
  assert.ok(!conditionHolds('Bool', 'aws:SecureTransport', 'false', { 'aws:SecureTransport': 'true' }));
  assert.ok(conditionHolds('Bool', 'aws:SecureTransport', true, { 'aws:SecureTransport': 'true' }));
});

test('conditions: ArnLike matches ARNs with wildcards, and aws:PrincipalArn is the role ARN', () => {
  const kase = { principal: ROLE, action: 's3:GetObject', resource: OBJECT, policies: [] };
  assert.equal(contextOf(kase)['aws:PrincipalArn'], ROLE);
  assert.equal(contextOf(kase)['aws:PrincipalAccount'], '123456789012');
  const ctx = contextOf(kase);
  assert.ok(conditionHolds('ArnLike', 'aws:PrincipalArn', 'arn:aws:iam::123456789012:role/sample-*', ctx));
  assert.ok(!conditionHolds('ArnLike', 'aws:PrincipalArn', 'arn:aws:iam::111122223333:role/*', ctx));
  assert.ok(conditionHolds('ArnNotLike', 'aws:PrincipalArn', 'arn:aws:iam::111122223333:role/*', ctx));
});

test('conditions: a missing key is false, except for negated operators and ...IfExists', () => {
  assert.ok(!conditionHolds('Bool', 'aws:MultiFactorAuthPresent', 'false', {}));
  assert.ok(!conditionHolds('StringEquals', 'aws:PrincipalTag/team', 'orders', {}));
  assert.ok(!conditionHolds('IpAddress', 'aws:SourceIp', '203.0.113.0/24', {}));
  assert.ok(conditionHolds('StringNotEquals', 'aws:RequestedRegion', 'us-east-1', {}));
  assert.ok(conditionHolds('NotIpAddress', 'aws:SourceIp', '203.0.113.0/24', {}));
  assert.ok(conditionHolds('BoolIfExists', 'aws:MultiFactorAuthPresent', 'false', {}));
  assert.ok(!conditionHolds('BoolIfExists', 'aws:MultiFactorAuthPresent', 'false', { 'aws:MultiFactorAuthPresent': 'true' }));
});

test('conditions: a Deny on Bool aws:MultiFactorAuthPresent "false" misses long-term keys; BoolIfExists does not', () => {
  const base = { principal: USER, action: 's3:DeleteObject' };
  const bool = identity(allow('s3:*'), deny('s3:DeleteObject', '*', { Condition: { Bool: { 'aws:MultiFactorAuthPresent': 'false' } } }));
  const ifExists = identity(allow('s3:*'), deny('s3:DeleteObject', '*', { Condition: { BoolIfExists: { 'aws:MultiFactorAuthPresent': 'false' } } }));
  assert.equal(verdict({ ...base, policies: [bool] }), 'allow');
  assert.equal(verdict({ ...base, policies: [ifExists] }), 'explicit');
  assert.equal(verdict({ ...base, context: { 'aws:MultiFactorAuthPresent': 'true' }, policies: [ifExists] }), 'allow');
});

test('the page lists every key a policy tests, with null when the request lacks it', () => {
  const kase = {
    principal: USER, action: 's3:GetObject', resource: OBJECT, context: { 'aws:SecureTransport': 'true' },
    policies: [identity(deny('s3:*', '*', { Condition: { Bool: { 'aws:MultiFactorAuthPresent': 'false' } } }))],
  };
  assert.deepEqual(contextShown(kase), [['aws:SecureTransport', 'true'], ['aws:MultiFactorAuthPresent', null]]);
});

test('the walk ends at the step that decided, and an explicit deny names its statement', () => {
  const result = evaluate({ principal: ROLE, action: 's3:GetObject', resource: OBJECT, policies: [identity(allow('s3:*'), deny('s3:GetObject'))] });
  assert.equal(result.decided.mark, 'deny');
  assert.deepEqual(result.decided.refs, [[0, 1]]);
  const quiet = evaluate({ principal: ROLE, action: 's3:GetObject', resource: OBJECT, policies: [identity(allow('s3:*')), boundary(allow('ec2:*'))] });
  assert.equal(quiet.decided.mark, 'no');
  assert.deepEqual(quiet.decided.policies, [1]);
});

test('things the engine does not model are refused, not guessed', () => {
  const kase = (policies, extra = {}) => ({ principal: ROLE, action: 's3:GetObject', resource: OBJECT, policies, ...extra });
  assert.throws(() => evaluate(kase([resource({ Effect: 'Allow', NotPrincipal: { AWS: ROLE }, Action: 's3:*', Resource: '*' })])), 'NotPrincipal');
  assert.throws(() => evaluate(kase([identity(allow('s3:*', '*', { Condition: { 'ForAnyValue:StringEquals': { 'aws:TagKeys': 'x' } } }))])), 'set operators');
  assert.throws(() => evaluate(kase([identity(allow('s3:*', 'arn:aws:s3:::home/${aws:username}/*'))])), 'policy variables');
  assert.throws(() => evaluate(kase([resource(grant('*')), boundary(allow('s3:*'))])), '"*" principal with a boundary');
  assert.throws(() => evaluate(kase([resource(grant({ AWS: '123456789012' }))])), 'account principal, same account, not KMS');
  assert.throws(() => evaluate(kase([identity({ Effect: 'Allow', Action: 's3:*', Resource: '*', Principal: '*' })])), 'Principal in an identity policy');
  assert.throws(() => evaluate(kase([session(allow('*'))], { principal: USER })), 'session policy for a user');
  assert.throws(() => evaluate(kase([identity(allow('s3:*', '*', { Condition: { IpAddress: { 'aws:SourceIp': '2001:db8::/32' } } }))], { context: { 'aws:SourceIp': '2001:db8::1' } })), 'IPv6');
});

// ------------------------------------------------------------ 3. the game

test('answering every case wrong loses', () => {
  const level = levels[0];
  const wrong = level.solution.map((answer) => (answer === 'allow' ? 'implicit' : 'allow'));
  const state = replay(level, wrong);
  assert.equal(state.status, 'lost');
  assert.equal(stars(state), 0);
});

test('doing nothing leaves the level playing', () => {
  assert.equal(replay(levels[0], []).status, 'playing');
});

test('one wrong answer still wins with 2 stars when pass allows it', () => {
  const level = levels[0];
  const answers = [...level.solution];
  answers[0] = answers[0] === 'allow' ? 'explicit' : 'allow';
  const state = replay(level, answers);
  assert.equal(state.status, level.cases.length - 1 >= level.pass ? 'won' : 'lost');
  if (state.status === 'won') assert.equal(stars(state), 2);
});

test('Deny with the wrong kind (explicit vs implicit) counts as wrong', () => {
  const level = levels[0];
  const i = level.solution.indexOf('implicit');
  const state = apply(replay(level, level.solution.slice(0, i)), 'explicit');
  assert.equal(state.given[i].right, false);
  assert.equal(state.given[i].verdict, 'implicit');
});

test('an unknown answer is rejected, and nothing changes after the level is over', () => {
  assert.throws(() => apply(start(levels[0]), 'deny'));
  const done = replay(levels[0], levels[0].solution);
  assert.deepEqual(apply(done, 'allow'), done);
});

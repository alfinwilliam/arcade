// RULES for Allow or Deny: AWS IAM policy evaluation, for the subset this game models.
// Pure: no page, no storage, no timers, no randomness. The same case always gets the same verdict.
//
// What evaluate(case) does, in AWS's own order (IAM User Guide, "Policy evaluation logic" and
// "How AWS enforcement code logic evaluates requests"). AWS checks resource control policies
// (RCPs) between steps 1 and 2; this game leaves RCPs out, as if every level had RCPFullAWSAccess.
//   1. Explicit deny  Any Deny statement that matches, in ANY policy (identity, resource, boundary,
//                     SCP, session), refuses the request. Final: Deny (explicit).
//   2. SCPs           For each level the case lists (Root, an OU, the account), at least one SCP
//                     attached there must Allow. SCPs never grant. Missing allow: Deny (implicit).
//   Same account (the caller and the resource are in one account):
//   3. Resource policy  An Allow that names the IAM user ARN or the role SESSION ARN is a direct
//                     grant: final Allow, whatever the identity policies, boundary or session policy
//                     leave out. An Allow that names the role ARN counts as the allow, but a
//                     boundary and a session policy still limit it. An Allow to "*" counts as
//                     the allow; it is modelled only with no boundary or session policy (AWS
//                     treats "*" with a boundary as a separate case, so evaluate() throws).
//                     A KMS key policy MUST allow: naming the account ("...:root") hands the
//                     decision to IAM policies; a key policy that allows nothing for this caller
//                     means Deny (implicit).
//   4. Identity policies  Must allow, unless step 3 already counted an allow.
//   5. Permissions boundary  If there is one, it must allow too.
//   6. Session policy  If there is one (role sessions only), it must allow too. Then: Allow.
//   Cross-account (the resource belongs to another account): two evaluations, both must allow.
//     Caller's account: SCPs, identity policies (must allow), boundary, session policy.
//     Resource's account: the resource policy must allow this caller (by account, role,
//     session or user ARN, or "*").
//
// Matching, per the IAM JSON policy reference:
//   Action / NotAction    * and ? wildcards; service prefix and action name ignore case.
//   Resource / NotResource  * and ? wildcards, checked per ARN segment (arn:partition:service:
//                     region:account:resource); * matches "/" too, so bucket/* covers every object
//                     but NOT the bucket itself. ARNs are compared case-sensitively.
//   Principal         resource policies only: "*", {"AWS": "*"}, an account id or
//                     arn:aws:iam::<account>:root, a role ARN, a role session ARN, a user ARN.
//                     {"Service": ...} and other kinds never match the IAM callers in this game.
//   Condition         operators below; all operators and keys in one Condition must hold (AND);
//                     several values for one key: any one may match (OR). Key NAMES ignore case.
//                     A key missing from the request makes the test false, except a negated
//                     operator (StringNotEquals, StringNotLike, NotIpAddress, ArnNotLike,
//                     ArnNotEquals), which is then true, and ...IfExists, which is then true.
//     StringEquals / StringNotEquals            exact, case-sensitive
//     StringEqualsIgnoreCase / ...NotEquals...  exact, ignoring case
//     StringLike / StringNotLike                case-sensitive, * and ? wildcards
//     Bool                                      "true" / "false"
//     IpAddress / NotIpAddress                  IPv4 CIDR; an address without /n means /32
//     ArnLike / ArnEquals / ArnNotLike / ArnNotEquals   ARN match as for Resource
//   Context           the case's own `context`, plus aws:PrincipalArn (the role ARN for a role
//                     session, the user ARN for a user) and aws:PrincipalAccount, which AWS adds.
//
// NOT modelled (evaluate() throws if a case needs it, so the tests catch it): NotPrincipal,
// ForAnyValue / ForAllValues and multivalued keys, policy variables such as ${aws:username},
// numeric and date operators, Null, IPv6, resource control policies (RCPs), KMS grants, VPC
// endpoint policies, role trust policies (AssumeRole), federated user sessions, service-linked
// roles and the management account (which SCPs never limit), a "*" principal in a same-account
// resource policy together with a boundary or session policy, and an account principal in a
// same-account resource policy other than a KMS key policy. Also: AWS lets a * at the END of an
// ARN segment run past the following colons; this engine does that only for the last segment
// written, and no case relies on it.

export const ANSWERS = ['allow', 'explicit', 'implicit'];
export const POLICY_TYPES = ['identity', 'resource', 'boundary', 'session', 'scp'];
export const TYPE_LABEL = {
  identity: 'Identity policy',
  resource: 'Resource policy',
  boundary: 'Permissions boundary',
  session: 'Session policy',
  scp: 'SCP',
};

const NEGATED = new Set(['StringNotEquals', 'StringNotEqualsIgnoreCase', 'StringNotLike', 'NotIpAddress',
  'ArnNotLike', 'ArnNotEquals']);
const OPERATORS = new Set(['StringEquals', 'StringEqualsIgnoreCase', 'StringLike', 'Bool', 'IpAddress',
  'ArnLike', 'ArnEquals', ...NEGATED]);
const DIRECT = new Set(['user', 'session']);   // same-account grants an implicit deny cannot limit

// ---------------------------------------------------------------- matching

const asList = (value) => (Array.isArray(value) ? value : [value]);

function globRegExp(pattern, ignoreCase) {
  let source = '';
  for (const ch of pattern) {
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, ignoreCase ? 'is' : 's');
}

// glob('s3:Get*', 's3:GetObject') -> true. * is any run of characters, ? exactly one.
export function glob(pattern, text, ignoreCase = false) {
  return globRegExp(pattern, ignoreCase).test(text);
}

// Action names ignore case: "s3:getobject" is the same action as "s3:GetObject".
export function actionMatches(pattern, action) {
  return glob(pattern, action, true);
}

// Six parts: arn, partition, service, region, account, and the resource (which may hold colons).
function splitArn(text) {
  const parts = text.split(':');
  return parts.length <= 6 ? parts : [...parts.slice(0, 5), parts.slice(5).join(':')];
}

// arnMatches('arn:aws:s3:::sample-app-logs/*', 'arn:aws:s3:::sample-app-logs/a.csv') -> true
export function arnMatches(pattern, arn) {
  if (pattern === '*') return true;
  const want = splitArn(pattern);
  const have = splitArn(arn);
  if (want.length < have.length) {
    const last = want.length - 1;                 // a trailing * may run past the colons
    if (!want[last].endsWith('*')) return false;
    return want.slice(0, last).every((part, i) => glob(part, have[i]))
      && glob(want[last], have.slice(last).join(':'));
  }
  if (want.length !== have.length) return false;
  return want.every((part, i) => glob(part, have[i]));
}

function ipToNumber(text) {
  const parts = text.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) {
    throw new Error(`"${text}" is not an IPv4 address (IPv6 is not modelled)`);
  }
  return parts.reduce((sum, p) => sum * 256 + Number(p), 0);
}

// inCidr('203.0.113.0/24', '203.0.113.9') -> true. No /n means /32.
export function inCidr(cidr, address) {
  const [base, bits = '32'] = cidr.split('/');
  const size = 2 ** (32 - Number(bits));
  const start = Math.floor(ipToNumber(base) / size) * size;
  const n = ipToNumber(address);
  return n >= start && n < start + size;
}

// One operator test on one key. Returns true or false.
export function conditionHolds(operator, key, wanted, context) {
  const ifExists = operator.endsWith('IfExists');
  const base = ifExists ? operator.slice(0, -'IfExists'.length) : operator;
  if (!OPERATORS.has(base)) throw new Error(`condition operator ${operator} is not modelled`);
  const value = lookup(context, key);
  if (value === undefined) return ifExists || NEGATED.has(base);
  const values = asList(wanted).map(String);
  const any = (test) => values.some(test);
  switch (base) {
    case 'StringEquals': return any((v) => v === value);
    case 'StringNotEquals': return !any((v) => v === value);
    case 'StringEqualsIgnoreCase': return any((v) => v.toLowerCase() === value.toLowerCase());
    case 'StringNotEqualsIgnoreCase': return !any((v) => v.toLowerCase() === value.toLowerCase());
    case 'StringLike': return any((v) => glob(v, value));
    case 'StringNotLike': return !any((v) => glob(v, value));
    case 'Bool': return any((v) => v.toLowerCase() === value.toLowerCase());
    case 'IpAddress': return any((v) => inCidr(v, value));
    case 'NotIpAddress': return !any((v) => inCidr(v, value));
    case 'ArnLike': case 'ArnEquals': return any((v) => arnMatches(v, value));
    default: return !any((v) => arnMatches(v, value));   // ArnNotLike, ArnNotEquals
  }
}

// Context key names ignore case: aws:sourceip finds aws:SourceIp.
function lookup(context, key) {
  const found = Object.keys(context).find((name) => name.toLowerCase() === key.toLowerCase());
  return found === undefined ? undefined : String(context[found]);
}

// Every [operator, key, wanted] in a Condition block, in order.
function conditionTests(condition) {
  const tests = [];
  for (const [operator, block] of Object.entries(condition || {})) {
    for (const [key, wanted] of Object.entries(block)) tests.push([operator, key, wanted]);
  }
  return tests;
}

// ------------------------------------------------------------- the request

// Who is calling: an IAM role (the request comes from a session of it) or an IAM user.
export function principalOf(kase) {
  const match = /^arn:aws:iam::(\d{12}):(role|user)\/([\w+=,.@-]+)$/.exec(kase.principal || '');
  if (!match) throw new Error(`principal "${kase.principal}" must be an IAM role or user ARN without a path`);
  const [, account, kind, name] = match;
  const session = kase.session || 'sample-session';
  return {
    kind, account, name, arn: kase.principal,
    sessionArn: kind === 'role' ? `arn:aws:sts::${account}:assumed-role/${name}/${session}` : null,
  };
}

// The request context AWS would see: what the case gives, plus the keys AWS always adds.
export function contextOf(kase) {
  const who = principalOf(kase);
  return { 'aws:PrincipalArn': who.arn, 'aws:PrincipalAccount': who.account, ...(kase.context || {}) };
}

// The keys the page lists under the request: every key a policy tests, plus the case's own.
// Each is [key, value] with value null when the request does not carry that key.
export function contextShown(kase) {
  const context = contextOf(kase);
  const keys = [];
  const add = (key) => {
    if (!keys.some((k) => k.toLowerCase() === key.toLowerCase())) keys.push(key);
  };
  Object.keys(kase.context || {}).forEach(add);
  for (const policy of kase.policies) {
    for (const statement of statementsOf(policy.doc)) conditionTests(statement.Condition).forEach(([, key]) => add(key));
  }
  return keys.map((key) => [key, lookup(context, key) ?? null]);
}

export function resourceAccountOf(kase) {
  return kase.resourceAccount || principalOf(kase).account;
}

export function statementsOf(doc) {
  return asList(doc.Statement);
}

// ------------------------------------------------------------- statements

// Which way a resource-policy statement names this caller: null (not at all), 'wildcard',
// 'account', 'role', 'session' or 'user'. When several entries match, the strongest wins.
function principalKind(statement, who) {
  const p = statement.Principal;
  if (p === '*') return 'wildcard';
  const rank = { account: 1, wildcard: 2, role: 2, session: 3, user: 3 };
  let best = null;
  for (const entry of asList((p && p.AWS) || [])) {
    let kind = null;
    if (entry === '*') kind = 'wildcard';
    else if (entry === who.account || entry === `arn:aws:iam::${who.account}:root`) kind = 'account';
    else if (who.kind === 'role' && entry === who.arn) kind = 'role';
    else if (who.kind === 'role' && entry === who.sessionArn) kind = 'session';
    else if (who.kind === 'user' && entry === who.arn) kind = 'user';
    if (kind && (!best || rank[kind] > rank[best])) best = kind;
  }
  return best;
}

const quoteList = (value) => asList(value).map((v) => `"${v}"`).join(', ');

function conditionText([operator, key, wanted], context) {
  const value = lookup(context, key);
  const has = value === undefined ? `the request has no ${key}` : `the request has ${key} = "${value}"`;
  return `${operator} ${key} ${quoteList(wanted)}; ${has}`;
}

// Why a statement does NOT apply to the request, as text; null when it applies.
function whyNot(statement, policy, request) {
  const { action, resource, context, who } = request;
  if (statement.Action !== undefined && !asList(statement.Action).some((a) => actionMatches(a, action))) {
    return `its Action (${quoteList(statement.Action)}) does not cover ${action}`;
  }
  if (statement.NotAction !== undefined && asList(statement.NotAction).some((a) => actionMatches(a, action))) {
    return `${action} is listed in its NotAction, so it is left out`;
  }
  if (statement.Resource !== undefined && !asList(statement.Resource).some((r) => arnMatches(r, resource))) {
    return `its Resource (${quoteList(statement.Resource)}) does not cover ${resource}`;
  }
  if (statement.NotResource !== undefined && asList(statement.NotResource).some((r) => arnMatches(r, resource))) {
    return `${resource} is listed in its NotResource, so it is left out`;
  }
  if (policy.type === 'resource' && !principalKind(statement, who)) {
    return 'its Principal does not name this caller';
  }
  const failed = conditionTests(statement.Condition).find(([op, key, wanted]) => !conditionHolds(op, key, wanted, context));
  if (failed) return `its condition is false: ${conditionText(failed, context)}`;
  return null;
}

// The interesting part of why a statement DOES apply: Not* elements and conditions.
function whyYes(statement, request) {
  const parts = [];
  if (statement.NotAction !== undefined) parts.push(`${request.action} is not in its NotAction, so it is covered`);
  if (statement.NotResource !== undefined) parts.push('the resource is not in its NotResource, so it is covered');
  for (const test of conditionTests(statement.Condition)) {
    const [operator, key] = test;
    const missing = lookup(request.context, key) === undefined;
    let note = '';
    if (missing && operator.endsWith('IfExists')) note = ' (...IfExists treats a missing key as a match)';
    else if (missing) note = ' (a missing key makes a negated operator true)';
    parts.push(`condition true: ${conditionText(test, request.context)}${note}`);
  }
  return parts;
}

export function statementLabel(policy, statement, index) {
  const which = statement.Sid ? `"${statement.Sid}"` : `statement ${index + 1}`;
  return `${which} in ${policy.name}`;
}

// ------------------------------------------------------------- checks

function checkCase(kase, who, policies) {
  const text = JSON.stringify(kase.policies);
  if (text.includes('${')) throw new Error('policy variables such as ${aws:username} are not modelled');
  for (const type of ['resource', 'boundary', 'session']) {
    if (policies.filter((p) => p.type === type).length > 1) throw new Error(`a case may have at most one ${type} policy`);
  }
  if (policies.some((p) => p.type === 'session') && who.kind !== 'role') {
    throw new Error('a session policy needs a role principal (federated user sessions are not modelled)');
  }
  for (const policy of policies) {
    if (!POLICY_TYPES.includes(policy.type)) throw new Error(`unknown policy type "${policy.type}"`);
    if (policy.type === 'scp' && !policy.attachedTo) throw new Error(`SCP ${policy.name} needs attachedTo`);
    policy.statements.forEach((s, i) => {
      const where = statementLabel(policy, s, i);
      if (s.Effect !== 'Allow' && s.Effect !== 'Deny') throw new Error(`${where}: Effect must be Allow or Deny`);
      if ((s.Action === undefined) === (s.NotAction === undefined)) throw new Error(`${where}: needs Action or NotAction`);
      if ((s.Resource === undefined) === (s.NotResource === undefined)) throw new Error(`${where}: needs Resource or NotResource`);
      if (s.NotPrincipal !== undefined) throw new Error(`${where}: NotPrincipal is not modelled`);
      if ((policy.type === 'resource') !== (s.Principal !== undefined)) {
        throw new Error(`${where}: a Principal belongs in resource policies and only there`);
      }
      for (const [operator] of conditionTests(s.Condition)) {
        const base = operator.endsWith('IfExists') ? operator.slice(0, -8) : operator;
        if (!OPERATORS.has(base)) throw new Error(`${where}: condition operator ${operator} is not modelled`);
      }
    });
  }
}

// ------------------------------------------------------------- evaluate

// The verdict for one case: { answer, steps, decided, crossAccount }.
//   answer   'allow', 'explicit' (an explicit deny) or 'implicit' (nothing allowed it)
//   steps    the walk, in AWS's order, up to the step that decided:
//            { title, mark, text, notes, refs, policies }
//              mark      'ok' (passed), 'note' (passed, worth a remark), 'allow' (final Allow),
//                        'deny' (explicit deny), 'no' (no allow here: implicit deny)
//              refs      [[policyIndex, statementIndex]] the statements this step rests on
//              policies  [policyIndex] the policies this step looked at
//              skipped   [[policyIndex, statementIndex]] Deny statements checked that do not apply
//   decided  the last step (the one that decided)
export function evaluate(kase) {
  const who = principalOf(kase);
  const request = { action: kase.action, resource: kase.resource, context: contextOf(kase), who };
  const policies = kase.policies.map((p, index) => ({ ...p, index, statements: statementsOf(p.doc) }));
  checkCase(kase, who, policies);

  const crossAccount = resourceAccountOf(kase) !== who.account;
  const isKms = splitArn(kase.resource)[2] === 'kms';
  const ofType = (type) => policies.filter((p) => p.type === type);
  const steps = [];
  const step = (fields) => steps.push({ notes: [], refs: [], policies: [], skipped: [], ...fields });
  const finish = (answer) => ({ answer, steps, decided: steps[steps.length - 1], crossAccount });
  const allowFinal = (text) => {
    step({ title: 'Decision', mark: 'allow', text });
    return finish('allow');
  };

  // Every statement with this effect in these policies: the ones that apply, and why the others do not.
  const scan = (list, effect) => {
    const hits = [];
    const misses = [];
    const missRefs = [];
    for (const policy of list) {
      policy.statements.forEach((statement, i) => {
        if (statement.Effect !== effect) return;
        const reason = whyNot(statement, policy, request);
        if (reason === null) hits.push({ policy, statement, i, ref: [policy.index, i] });
        else {
          misses.push(`${statementLabel(policy, statement, i)} does not apply: ${reason}.`);
          missRefs.push([policy.index, i]);
        }
      });
    }
    return { hits, misses, missRefs };
  };
  const names = (hits) => hits.map((h) => statementLabel(h.policy, h.statement, h.i)).join(' and ');
  const reasons = (hits) => hits.flatMap((h) => whyYes(h.statement, request));

  // 1. Explicit deny, anywhere.
  const denies = scan(policies, 'Deny');
  if (denies.hits.length > 0) {
    step({
      title: 'Explicit deny', mark: 'deny',
      text: `${names(denies.hits)} matches the request with "Effect": "Deny". An explicit deny beats every Allow: Deny.`,
      notes: reasons(denies.hits), refs: denies.hits.map((h) => h.ref), policies: denies.hits.map((h) => h.policy.index),
    });
    return finish('explicit');
  }
  const anyDeny = policies.some((p) => p.statements.some((s) => s.Effect === 'Deny'));
  step({
    title: 'Explicit deny', mark: anyDeny ? 'note' : 'ok',
    text: anyDeny ? 'No Deny statement matches the request.' : 'No policy here has a Deny statement.',
    notes: denies.misses, skipped: denies.missRefs,
  });

  // 2. SCPs: every level listed must allow.
  const scps = ofType('scp');
  const levels = [...new Set(scps.map((p) => p.attachedTo))];
  for (const level of levels) {
    const here = scps.filter((p) => p.attachedTo === level);
    const allows = scan(here, 'Allow');
    if (allows.hits.length === 0) {
      step({
        title: `SCPs at ${level}`, mark: 'no',
        text: `No SCP attached at ${level} allows ${kase.action}. Every level from the root down to the account must allow it: implicit deny.`,
        notes: allows.misses, policies: here.map((p) => p.index),
      });
      return finish('implicit');
    }
    step({
      title: `SCPs at ${level}`, mark: 'ok',
      text: `${names(allows.hits)} allows it. That only keeps the door open: an SCP grants nothing.`,
      refs: allows.hits.map((h) => h.ref), policies: here.map((p) => p.index),
    });
  }

  let resourceCounts = false;     // a role-ARN or "*" grant: enough instead of an identity allow
  let viaIam = false;             // a KMS key policy that names the account: IAM policies decide
  const identity = scan(ofType('identity'), 'Allow');
  const boundary = ofType('boundary')[0];
  const session = ofType('session')[0];
  const resourcePolicy = ofType('resource')[0];

  // Boundary and session policy: each, if present, must allow.
  const limits = (prefix = '') => {
    for (const [policy, title, what] of [[boundary, 'Permissions boundary', 'boundary'], [session, 'Session policy', 'session policy']]) {
      if (!policy) continue;
      const allows = scan([policy], 'Allow');
      if (allows.hits.length === 0) {
        step({
          title: prefix + title, mark: 'no',
          text: `The ${what} does not allow ${kase.action}. It grants nothing and only limits, so the Allow found above does not count here: implicit deny.`,
          notes: allows.misses, policies: [policy.index],
        });
        return false;
      }
      step({
        title: prefix + title, mark: 'ok', text: `${names(allows.hits)} allows it, so the ${what} does not get in the way.`,
        notes: reasons(allows.hits), refs: allows.hits.map((h) => h.ref), policies: [policy.index],
      });
    }
    return true;
  };
  // Identity policies. mustAllow false: an Allow from the resource policy already counts.
  const identityStep = (mustAllow, failText, noteText, title = 'Identity policies') => {
    if (identity.hits.length > 0) {
      step({
        title, mark: 'ok', text: `${names(identity.hits)} allows it.`,
        notes: reasons(identity.hits), refs: identity.hits.map((h) => h.ref), policies: identity.hits.map((h) => h.policy.index),
      });
      return true;
    }
    const ids = ofType('identity').map((p) => p.index);
    if (!mustAllow) {
      step({ title, mark: 'note', text: noteText, notes: identity.misses, policies: ids });
      return true;
    }
    const none = ids.length === 0 && !viaIam ? `The caller has no identity policy, so nothing grants ${kase.action}. ` : '';
    step({ title, mark: 'no', policies: ids, notes: identity.misses, text: none + failText });
    return false;
  };

  // Cross-account: the caller's account, then the resource's account. Both must allow.
  if (crossAccount) {
    const caller = `Caller's account ${who.account}`;
    if (!identityStep(true, 'Across accounts the caller\'s own identity policy must allow too, whatever the resource policy says: implicit deny.', '', `${caller}: identity policies`)) return finish('implicit');
    if (!limits(`${caller}: `)) return finish('implicit');
    const where = `the resource's account ${resourceAccountOf(kase)}`;
    const title = `Resource account ${resourceAccountOf(kase)}: resource policy`;
    if (!resourcePolicy) {
      step({ title, mark: 'no', text: `There is no resource policy, so nothing in ${where} lets this caller in. Across accounts that side must allow too: implicit deny.` });
      return finish('implicit');
    }
    const grants = scan([resourcePolicy], 'Allow');
    if (grants.hits.length === 0) {
      step({
        title, mark: 'no', notes: grants.misses, policies: [resourcePolicy.index],
        text: `No statement in ${resourcePolicy.name} (${where}) allows this caller to ${kase.action}. Across accounts both sides must allow: implicit deny.`,
      });
      return finish('implicit');
    }
    step({
      title, mark: 'ok', text: `${names(grants.hits)} (${where}) allows this caller.`,
      notes: reasons(grants.hits), refs: grants.hits.map((h) => h.ref), policies: [resourcePolicy.index],
    });
    return allowFinal('Both accounts allow it: Allow.');
  }

  // Same account: 3. resource policy.
  if (isKms && !resourcePolicy) throw new Error('a KMS key case needs its key policy (every KMS key has one)');
  if (resourcePolicy) {
    const grants = scan([resourcePolicy], 'Allow');
    const rank = { account: 1, wildcard: 2, role: 2, session: 3, user: 3 };
    let kind = null;
    for (const hit of grants.hits) {
      const k = principalKind(hit.statement, who);
      if (!kind || rank[k] > rank[kind]) kind = k;
    }
    const hits = grants.hits.filter((h) => principalKind(h.statement, who) === kind);
    const base = { refs: hits.map((h) => h.ref), policies: [resourcePolicy.index], notes: reasons(hits) };
    if (DIRECT.has(kind)) {
      const by = kind === 'user' ? 'the IAM user ARN' : 'the role session ARN';
      step({
        ...base, title: 'Resource policy', mark: 'ok',
        text: `${names(hits)} allows it and names ${by}. In one account that grants straight to the caller: an implicit deny in identity policies${kind === 'user' ? ' or a permissions boundary' : ', a boundary or a session policy'} cannot take it away.`,
      });
      return allowFinal('The resource policy granted it directly: Allow.');
    }
    if (kind === 'role' || kind === 'wildcard') {
      if (kind === 'wildcard' && (boundary || session)) {
        throw new Error('a "*" principal with a permissions boundary or session policy is not modelled');
      }
      resourceCounts = true;
      step({
        ...base, title: 'Resource policy', mark: 'ok',
        text: kind === 'role'
          ? `${names(hits)} allows it and names the role ARN. In one account that is enough without an identity allow, but a permissions boundary or session policy can still limit it.`
          : `${names(hits)} allows it for any principal ("*"). In one account that is enough without an identity allow.`,
      });
    } else if (kind === 'account') {
      if (!isKms) throw new Error('an account principal in a same-account resource policy is modelled only for KMS key policies');
      viaIam = true;
      step({
        ...base, title: 'Key policy', mark: 'note',
        text: `${names(hits)} names the account (…:root). That grants no one by itself: it lets IAM policies in the account decide.`,
      });
    } else if (isKms) {
      step({
        title: 'Key policy', mark: 'no', notes: grants.misses, policies: [resourcePolicy.index],
        text: `${resourcePolicy.name} neither allows this caller nor lets IAM policies decide (no statement for the account). A KMS key policy must allow, whatever IAM says: implicit deny.`,
      });
      return finish('implicit');
    } else {
      step({
        title: 'Resource policy', mark: 'note', notes: grants.misses, policies: [resourcePolicy.index],
        text: 'No statement in it allows this request, so it grants nothing here. In one account the identity policies can still allow it.',
      });
    }
  }

  // 4. Identity policies, 5. boundary, 6. session policy.
  const hasIdentity = ofType('identity').length > 0;
  let noIdentity = `${hasIdentity ? 'No identity statement allows it' : 'No other policy allows it'}`
    + `${resourcePolicy ? ', and the resource policy did not either' : ''}: implicit deny.`;
  if (viaIam) noIdentity = `The key policy left the decision to IAM, and ${hasIdentity ? 'no identity statement allows it' : 'there is no identity policy'}: implicit deny.`;
  if (!identityStep(!resourceCounts, noIdentity, 'No identity statement allows it. In one account the resource policy\'s Allow can stand in for it.')) {
    return finish('implicit');
  }
  if (!limits()) return finish('implicit');
  return allowFinal('Nothing denies it, every limit allows it, and a policy grants it: Allow.');
}

// ------------------------------------------------------------- the game

// The state at the start of a level: answering case 0.
export function start(level) {
  return { level, index: 0, given: [], right: 0, status: 'playing' };
}

// The one way state changes: answer the current case with 'allow', 'explicit' or 'implicit'.
// The level ends after the last case: WON with at least `pass` right answers, LOST otherwise.
export function apply(state, input) {
  if (state.status !== 'playing') return state;
  if (!ANSWERS.includes(input)) throw new Error(`"${input}" is not an answer (use ${ANSWERS.join(', ')})`);
  const verdict = evaluate(state.level.cases[state.index]).answer;
  const right = input === verdict;
  const index = state.index + 1;
  const total = state.right + (right ? 1 : 0);
  let status = 'playing';
  if (index === state.level.cases.length) status = total >= state.level.pass ? 'won' : 'lost';
  return { ...state, index, given: [...state.given, { input, verdict, right }], right: total, status };
}

export function replay(level, solution) {
  let state = start(level);
  for (const input of solution) state = apply(state, input);
  return state;
}

// 3 stars with every case right, 2 with one wrong, 1 otherwise. 0 unless won.
export function stars(state) {
  if (state.status !== 'won') return 0;
  return Math.max(1, 3 - (state.given.length - state.right));
}

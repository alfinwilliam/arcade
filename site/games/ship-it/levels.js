// LEVELS for Ship It, the pipeline puzzle.
// This file is data only. To change the game's content you edit this file and nothing else.
//
// How a pipeline runs (the rules live in logic.js):
//   - Stages run one after another. The steps in one stage run side by side, each on its
//     own clean machine, so a stage lasts as long as its slowest step.
//   - If a step fails, the steps beside it still finish, the run goes red, and later
//     stages never start.
//   - Time is whole minutes. "Runner-minutes" adds up the minutes every step ran, across
//     every check. Waiting for an approval or a lock costs nothing (no machine is held).
//     That is true of GitHub Actions and Bitbucket. In Jenkins it holds only when the top level
//     says `agent none` and the waiting stage takes its own agent (the level 6 and 8 snippets);
//     an `input` or `lock` inside an agent that is already running keeps that executor busy.
//   - A step that cannot even begin (no build output, no image, another deploy running)
//     fails after 1 minute.
//
// Schema for a level (every field is required unless it says optional):
//   id        unique text, starting "si-"
//   title     shown above the level
//   hint      one sentence shown while playing: the new idea in this level
//   lesson    one plain sentence for the win screen and the lessons page. It must be true.
//   inRealLife  1 to 3 snippets, { label, code }: the same idea as real config, at most
//             14 lines each. Inside these `backtick` strings, write \${ for a literal ${.
//   docs      1 to 3 links (full https addresses) to official documentation that backs the lesson
//   steps     the steps, as  id: { label, minutes, ...extras }. Ids are short lowercase
//             words with no spaces. minutes is a whole number, 1 or more. Extras (optional):
//               fails: ['lint-error']   the commits this step fails on (see "commits" below)
//               makes: 'app'            it builds output that later stages can use, but only
//                                       if the player switches on "publish" (an artifact)
//               needs: 'app'            it needs that output from an EARLIER stage of the same
//                                       run; without it, it fails. needs: 'image' is special:
//                                       the step pulls the container image instead (see pushes)
//               pushes: true            it builds a container image and pushes it to the
//                                       registry, tagged "latest" or, with the "tag" option,
//                                       with the push's own name (A, B ...). At most one per level.
//               deploys: 'staging'      it deploys to that environment ('staging' or
//                                       'production'). A deploy that starts while another push
//                                       is deploying to the same place fails at once.
//               cacheSaves: 2           it installs dependencies, and a warm cache (the "cache"
//                                       option) makes it this many minutes shorter. Must be less
//                                       than minutes. On a commit that changes the lockfile
//                                       (only 'new-dep') the cache misses: full time plus 1 minute.
//   pipeline  the starting stages, as a list of lists of step ids. Every step appears exactly
//             once, and no stage is empty.
//   on        options already switched on at the start, as  stepId: ['publish', ...]. {} for none.
//   toggles   which options the player may switch in this level:
//               'publish'  share what the step makes with later stages (an artifact)
//               'cache'    restore the dependency cache, keyed on the lockfile
//               'main'     run the step only on the main branch (skipped on any other branch)
//               'approve'  the step waits until a person approves it (see approveAt)
//               'lock'     only one push at a time may run this step; the next one waits its turn
//               'tag'      tag the pushed image with the push's own name instead of "latest"
//             publish needs a step with makes, cache needs cacheSaves, tag needs pushes.
//   checks    what the pipeline must do. Each is one push:
//               { commit: 'good', branch: 'main', expect: 'green', within: 12 }
//             or several pushes, A, B ... in order, at minutes after the first:
//               { runs: [{ commit: 'good', branch: 'main', at: 0, approveAt: 20 },
//                        { commit: 'good', branch: 'main', at: 2 }], expect: 'same-image' }
//             commit  'good', 'lint-error', 'test-fail', 'type-error', 'build-error', 'ui-bug'
//                     or 'new-dep' (good, but it changes the lockfile). Any other word works
//                     too: a step fails on it if the word is in that step's fails list.
//             branch  'main' or any other name, such as 'feature/x'
//             approveAt  optional: the minute a person approves every waiting step of that
//                     push. Leave it out and the push waits for ever at its first approval.
//             expect  'green'      every push finishes, nothing fails, and every deploy that
//                                  pulls the image got the image its own push built
//                     'red'        (one push) a step fails, and nothing was deployed first
//                     'no-deploy'  every push finishes green, no deploy step ran, and every
//                                  step that does not deploy did run (a branch is still built
//                                  and tested)
//                     'waits'      (one push) it stops for approval right before a step that
//                                  deploys to production, nothing failed, production untouched,
//                                  every other step has already run, and every deploy so far
//                                  got this push's own image
//                     'same-image' push A finishes green and every deploy in it got push A's
//                                  own image (needs approveAt on push A if production is gated)
//             within  optional: the limit in minutes from the push. For green and no-deploy it
//                     is the time to finish, for red the time to the first failure, for waits
//                     the time until nothing is left but the approval (the steps beside the
//                     waiting one have finished too).
//   stars     { three, two }: runner-minutes for three and for two stars. Any win is one star.
//   solution  a list of moves that wins:
//               'move STEP N'  put a step into stage N (stages count from 1)
//               'new STEP N'   put a step into a new stage that becomes stage N
//               'OPTION STEP'  switch an option, e.g. 'cache lint', 'main deploy'
//               'run'          run every check (the solution ends with it)
//             A stage left empty by a move disappears, so later stages move up one.
//
// The tests (python3 scripts/arcade.py test ship-it) check that for every level:
//   - the id is unique and starts with "si-", and every field above is present and well formed
//     (a lesson longer than 20 characters, 1 to 3 inRealLife snippets of at most 14 lines,
//     1 to 3 https docs links, at most one step with pushes, an expect from the list above);
//   - every step is in the pipeline exactly once, no stage is empty, and the options in `on`
//     suit their step (publish needs makes, cache needs cacheSaves, tag needs pushes);
//   - the solution wins, and its runner-minutes are at most stars.three, which is at most stars.two;
//   - the starting pipeline, run as it is, fails at least one check.
//
// To add a level: copy an entry, give it a new id, change the steps and checks, and set
// solution to ['run']. Open the game with ?dev on the end of the URL, win the level, and paste
// the moves it shows into `solution`. The win screen shows the runner-minutes: use them for
// stars.three, and something a little higher for stars.two.

export const levels = [
  {
    id: 'si-01', title: 'Fail fast',
    hint: 'A lint error should turn the run red in a minute, not after the slow steps. Tap Lint, then tap where it should go.',
    lesson: 'Put the quick checks first: a stage starts only when the one before it passed, so a commit with a lint error fails in a minute instead of after the slow build. This is called failing fast.',
    steps: {
      unit: { label: 'Unit tests', minutes: 5, fails: ['test-fail'] },
      build: { label: 'Build', minutes: 4 },
      lint: { label: 'Lint', minutes: 1, fails: ['lint-error'] },
    },
    pipeline: [['unit'], ['build'], ['lint']],
    on: {},
    toggles: [],
    checks: [
      { commit: 'good', branch: 'main', expect: 'green', within: 12 },
      { commit: 'lint-error', branch: 'main', expect: 'red', within: 2 },
      { commit: 'test-fail', branch: 'main', expect: 'red', within: 6 },
    ],
    stars: { three: 17, two: 20 },
    solution: ['new lint 1', 'run'],
    inRealLife: [
      { label: 'Jenkinsfile', code: `pipeline {
  agent any
  stages {
    stage('Lint')       { steps { sh 'npm run lint' } }
    stage('Unit tests') { steps { sh 'npm test' } }
    stage('Build')      { steps { sh 'npm run build' } }
  }
}` },
      { label: 'bitbucket-pipelines.yml', code: `image: node:24
pipelines:
  default:
    - step:
        name: Lint
        script:
          - npm ci && npm run lint
    - step:
        name: Unit tests
        script:
          - npm ci && npm test` },
      { label: 'GitHub Actions', code: `on: push
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npm run lint
  test:
    needs: lint        # starts only if lint passed
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npm test` },
    ],
    docs: [
      'https://www.jenkins.io/doc/book/pipeline/syntax/',
      'https://support.atlassian.com/bitbucket-cloud/docs/bitbucket-pipelines-configuration-reference/',
      'https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax',
    ],
  },

  {
    id: 'si-02', title: 'Side by side',
    hint: 'Steps that do not depend on each other can share a stage. A stage lasts as long as its slowest step.',
    lesson: 'Steps that do not depend on each other can run in parallel in one stage, which takes as long as its slowest step: the run finishes sooner, but each parallel Bitbucket step or GitHub Actions job still runs on its own runner, so the build minutes do not go down.',
    steps: {
      lint: { label: 'Lint', minutes: 1, fails: ['lint-error'] },
      unit: { label: 'Unit tests', minutes: 5, fails: ['test-fail'] },
      types: { label: 'Type check', minutes: 3, fails: ['type-error'] },
      build: { label: 'Build', minutes: 4 },
    },
    pipeline: [['lint'], ['unit'], ['types'], ['build']],
    on: {},
    toggles: [],
    checks: [
      { commit: 'good', branch: 'main', expect: 'green', within: 7 },
      { commit: 'lint-error', branch: 'main', expect: 'red', within: 2 },
      { commit: 'test-fail', branch: 'main', expect: 'red', within: 6 },
      { commit: 'type-error', branch: 'main', expect: 'red', within: 6 },
    ],
    stars: { three: 40, two: 46 },
    solution: ['move types 2', 'move build 2', 'run'],
    inRealLife: [
      { label: 'Jenkinsfile', code: `stage('Checks') {
  parallel {   // without their own agent { }, branches share this build's agent
    stage('Unit tests') { steps { sh 'npm test' } }
    stage('Type check') { steps { sh 'npx tsc --noEmit' } }
    stage('Build')      { steps { sh 'npm run build' } }
  }
}` },
      { label: 'bitbucket-pipelines.yml', code: `- parallel:
    - step:
        name: Unit tests
        script:
          - npm ci && npm test
    - step:
        name: Type check
        script:
          - npm ci && npx tsc --noEmit` },
      { label: 'GitHub Actions', code: `  test:
    needs: lint            # test and typecheck both wait for lint,
    runs-on: ubuntu-latest # then run at the same time
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npm test
  typecheck:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npx tsc --noEmit` },
    ],
    docs: [
      'https://www.jenkins.io/doc/book/pipeline/syntax/#parallel',
      'https://support.atlassian.com/bitbucket-cloud/docs/parallel-step-options/',
      'https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds',
    ],
  },

  {
    id: 'si-03', title: 'Clean machines',
    hint: 'Every step starts on a fresh machine. Browser tests and the deploy need the build output, so Build must publish it.',
    lesson: 'Each Bitbucket step and each GitHub Actions job (on GitHub-hosted runners) starts on a clean machine, and a Jenkins stage with its own agent may land on another machine, so a later job has the build output only if an earlier one saved it as an artifact (in Jenkins, stash and unstash).',
    steps: {
      lint: { label: 'Lint', minutes: 1, fails: ['lint-error'] },
      build: { label: 'Build', minutes: 4, makes: 'app' },
      unit: { label: 'Unit tests', minutes: 5, fails: ['test-fail'] },
      e2e: { label: 'Browser tests', minutes: 3, needs: 'app', fails: ['ui-bug'] },
      deploy: { label: 'Deploy staging', minutes: 2, needs: 'app', deploys: 'staging' },
    },
    pipeline: [['lint'], ['build', 'unit'], ['e2e'], ['deploy']],
    on: {},
    toggles: ['publish'],
    checks: [
      { commit: 'good', branch: 'main', expect: 'green', within: 12 },
      { commit: 'lint-error', branch: 'main', expect: 'red', within: 2 },
      { commit: 'test-fail', branch: 'main', expect: 'red', within: 7 },
      { commit: 'ui-bug', branch: 'main', expect: 'red', within: 10 },
    ],
    stars: { three: 39, two: 45 },
    solution: ['publish build', 'run'],
    inRealLife: [
      { label: 'Jenkinsfile', code: `stage('Build') {
  agent { label 'linux' }
  steps {
    sh 'npm ci && npm run build'
    stash name: 'dist', includes: 'dist/**'
  }
}
stage('Browser tests') {
  agent { label 'linux' }   // maybe another machine
  steps {
    unstash 'dist'
    sh 'npm ci && npm run e2e'
  }
}` },
      { label: 'bitbucket-pipelines.yml', code: `- step:
    name: Build
    script:
      - npm ci && npm run build
    artifacts:
      - dist/**
- step:
    name: Browser tests      # dist/ is copied in
    script:
      - npm ci && npm run e2e` },
      { label: 'GitHub Actions', code: `# in the build job, after npm run build:
      - uses: actions/upload-artifact@v7
        with: { name: dist, path: dist/ }
# in the e2e job (needs: build), on a fresh runner:
      - uses: actions/checkout@v7
      - uses: actions/download-artifact@v8
        with: { name: dist, path: dist/ }
      - run: npm ci && npm run e2e` },
    ],
    docs: [
      'https://www.jenkins.io/doc/pipeline/steps/workflow-basic-steps/',
      'https://support.atlassian.com/bitbucket-cloud/docs/use-bitbucket-artifacts-in-step/',
      'https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts',
    ],
  },

  {
    id: 'si-04', title: 'Warm cache',
    hint: 'Each of these steps spends 2 minutes installing dependencies. A cache keyed on the lockfile skips that until the lockfile changes.',
    lesson: 'A dependency cache keyed on a hash of the lockfile is restored on every run until the dependencies change; a commit that changes the lockfile misses once, installs everything and saves a new cache.',
    steps: {
      lint: { label: 'Lint', minutes: 3, cacheSaves: 2, fails: ['lint-error'] },
      unit: { label: 'Unit tests', minutes: 6, cacheSaves: 2, fails: ['test-fail'] },
      build: { label: 'Build', minutes: 5, cacheSaves: 2, makes: 'app' },
      deploy: { label: 'Deploy staging', minutes: 2, needs: 'app', deploys: 'staging' },
    },
    pipeline: [['lint'], ['unit', 'build'], ['deploy']],
    on: { build: ['publish'] },
    toggles: ['publish', 'cache'],
    checks: [
      { commit: 'good', branch: 'main', expect: 'green', within: 9 },
      { commit: 'lint-error', branch: 'main', expect: 'red', within: 2 },
      { commit: 'new-dep', branch: 'main', expect: 'green', within: 13 },
      { commit: 'test-fail', branch: 'main', expect: 'red', within: 6 },
    ],
    stars: { three: 38, two: 44 },
    solution: ['cache lint', 'cache unit', 'cache build', 'run'],
    inRealLife: [
      { label: 'Jenkinsfile (Job Cacher plugin)', code: `steps {
  cache(maxCacheSize: 250, caches: [
    arbitraryFileCache(path: '.npm-cache',
      cacheValidityDecidingFile: 'package-lock.json')
  ]) {
    sh 'npm ci --cache .npm-cache && npm test'
  }
}` },
      { label: 'bitbucket-pipelines.yml', code: `definitions:
  caches:
    npm-lock:
      key:
        files:
          - package-lock.json
      path: ~/.npm
pipelines:
  default:
    - step:
        caches:
          - npm-lock
        script:
          - npm ci && npm test` },
      { label: 'GitHub Actions', code: `- uses: actions/cache@v6
  with:
    path: ~/.npm
    key: npm-\${{ runner.os }}-\${{ hashFiles('**/package-lock.json') }}
- run: npm ci && npm test` },
    ],
    docs: [
      'https://plugins.jenkins.io/jobcacher/',
      'https://support.atlassian.com/bitbucket-cloud/docs/cache-dependencies/',
      'https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching',
    ],
  },

  {
    id: 'si-05', title: 'Main only',
    hint: 'A push to a feature branch should be built and tested, but it must never deploy. Only main deploys.',
    lesson: 'Build and test every branch, but run the deploy only on main: a branch condition skips it for feature branches and pull requests, so they get feedback without touching any environment.',
    steps: {
      lint: { label: 'Lint', minutes: 1, fails: ['lint-error'] },
      unit: { label: 'Unit tests', minutes: 4, fails: ['test-fail'] },
      build: { label: 'Build', minutes: 3, makes: 'app', fails: ['build-error'] },
      deploy: { label: 'Deploy staging', minutes: 2, needs: 'app', deploys: 'staging' },
    },
    pipeline: [['lint'], ['unit', 'build'], ['deploy']],
    on: { build: ['publish'] },
    toggles: ['publish', 'main'],
    checks: [
      { commit: 'good', branch: 'main', expect: 'green', within: 8 },
      { commit: 'good', branch: 'feature/x', expect: 'no-deploy' },
      { commit: 'build-error', branch: 'feature/x', expect: 'red', within: 5 },
      { commit: 'lint-error', branch: 'feature/x', expect: 'red', within: 2 },
      { commit: 'test-fail', branch: 'feature/x', expect: 'red', within: 6 },
    ],
    stars: { three: 35, two: 40 },
    solution: ['main deploy', 'run'],
    inRealLife: [
      { label: 'Jenkinsfile', code: `stage('Deploy staging') {
  when { branch 'main' }    // multibranch pipeline
  steps { sh './deploy.sh staging' }
}` },
      { label: 'bitbucket-pipelines.yml', code: `definitions:
  steps:
    - step: &test
        script: [npm ci, npm test]
pipelines:
  default:                # any branch without its own entry
    - step: *test
  branches:
    main:
      - step: *test
      - step:
          deployment: staging
          script: [./deploy.sh staging]` },
      { label: 'GitHub Actions', code: `  deploy:
    needs: [test, build]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: ./deploy.sh staging` },
    ],
    docs: [
      'https://www.jenkins.io/doc/book/pipeline/syntax/#when',
      'https://support.atlassian.com/bitbucket-cloud/docs/pipeline-start-conditions/',
      'https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idif',
    ],
  },

  {
    id: 'si-06', title: 'Ask first',
    hint: 'Every good commit on main should reach staging by itself, then wait for a person before production.',
    lesson: 'A manual approval stops the run just before the production deploy until a person approves it, so every good commit reaches staging on its own but production changes only when someone says so.',
    steps: {
      lint: { label: 'Lint', minutes: 1, fails: ['lint-error'] },
      unit: { label: 'Unit tests', minutes: 4, fails: ['test-fail'] },
      build: { label: 'Build', minutes: 3, makes: 'app' },
      staging: { label: 'Deploy staging', minutes: 2, needs: 'app', deploys: 'staging' },
      prod: { label: 'Deploy production', minutes: 2, needs: 'app', deploys: 'production' },
    },
    pipeline: [['lint'], ['unit', 'build'], ['staging'], ['prod']],
    on: { build: ['publish'], staging: ['main'], prod: ['main'] },
    toggles: ['publish', 'main', 'approve'],
    checks: [
      { commit: 'good', branch: 'main', expect: 'waits', within: 8 },
      { commit: 'good', branch: 'feature/x', expect: 'no-deploy' },
      { commit: 'test-fail', branch: 'main', expect: 'red', within: 6 },
      { commit: 'lint-error', branch: 'main', expect: 'red', within: 2 },
    ],
    stars: { three: 27, two: 32 },
    solution: ['approve prod', 'run'],
    inRealLife: [
      { label: 'Jenkinsfile', code: `// top level says agent none, so a build waiting here holds no executor
stage('Deploy production') {
  when { beforeInput true; branch 'main' }   // else branches ask too
  input {
    message 'Deploy to production?'
    submitter 'release-managers'   // user or group names
  }
  agent { label 'linux' }          // taken only after approval
  steps { sh './deploy.sh production' }
}` },
      { label: 'bitbucket-pipelines.yml', code: `- step:
    name: Deploy production
    deployment: production
    trigger: manual
    script:
      - ./deploy.sh production` },
      { label: 'GitHub Actions', code: `  deploy-prod:
    needs: deploy-staging
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production   # waits until a required reviewer approves
    # (required reviewers: public repos, or GitHub Enterprise for private ones)
    steps:
      - uses: actions/checkout@v7
      - run: ./deploy.sh production` },
    ],
    docs: [
      'https://www.jenkins.io/doc/book/pipeline/syntax/#input',
      'https://support.atlassian.com/bitbucket-cloud/docs/step-options/',
      'https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments',
    ],
  },

  {
    id: 'si-07', title: 'Same image',
    hint: 'Push A waits for approval while push B builds. When A is approved, production must get the image A built, not whatever "latest" is by then.',
    lesson: 'Build the image once, tag it with the commit instead of a moving tag such as latest, and deploy that exact tag to staging and then production, so production runs what was tested and approved.',
    steps: {
      unit: { label: 'Unit tests', minutes: 4, fails: ['test-fail'] },
      image: { label: 'Build image', minutes: 3, pushes: true },
      staging: { label: 'Deploy staging', minutes: 2, needs: 'image', deploys: 'staging' },
      prod: { label: 'Deploy production', minutes: 2, needs: 'image', deploys: 'production' },
    },
    pipeline: [['unit', 'image'], ['staging'], ['prod']],
    on: { staging: ['main'], prod: ['main', 'approve'] },
    toggles: ['main', 'approve', 'tag'],
    checks: [
      { commit: 'good', branch: 'main', expect: 'waits', within: 7 },
      { runs: [
        { commit: 'good', branch: 'main', at: 0, approveAt: 20 },
        { commit: 'good', branch: 'main', at: 2 },
      ], expect: 'same-image' },
      { commit: 'test-fail', branch: 'main', expect: 'red', within: 5 },
    ],
    stars: { three: 36, two: 42 },
    solution: ['tag image', 'run'],
    inRealLife: [
      { label: 'Jenkinsfile', code: `stage('Build image') {
  steps {
    sh 'docker build -t registry.example.com/sample-app:$GIT_COMMIT .'
    sh 'docker push registry.example.com/sample-app:$GIT_COMMIT'
  }
}
stage('Deploy staging') {
  steps {
    sh 'helm upgrade --install sample-app ./chart -n sample --set image.tag=$GIT_COMMIT'
  }
}` },
      { label: 'bitbucket-pipelines.yml', code: `- step:
    name: Build image
    services:
      - docker
    script:
      - docker build -t registry.example.com/sample-app:$BITBUCKET_COMMIT .
      - docker push registry.example.com/sample-app:$BITBUCKET_COMMIT
- step:
    name: Deploy staging
    deployment: staging
    script:
      - helm upgrade --install sample-app ./chart -n sample --set image.tag=$BITBUCKET_COMMIT` },
      { label: 'GitHub Actions', code: `# build-image job: one image, tagged with the commit
      - run: |
          docker build -t registry.example.com/sample-app:\${{ github.sha }} .
          docker push registry.example.com/sample-app:\${{ github.sha }}
# staging job, and later the production job: that same tag
      - run: >-
          helm upgrade --install sample-app ./chart -n sample
          --set image.tag=\${{ github.sha }}` },
    ],
    docs: [
      'https://plugins.jenkins.io/git/#plugin-content-environment-variables',
      'https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/',
      'https://docs.github.com/en/actions/reference/workflows-and-actions/contexts',
    ],
  },

  {
    id: 'si-08', title: 'One at a time',
    hint: 'Two pushes land two minutes apart. Their staging deploys overlap, and the second one fails. Make it wait its turn.',
    lesson: 'Two runs deploying to the same environment at once can collide (Helm, for one, refuses to upgrade a release while another upgrade of it is in progress), so put the deploy behind a lock or concurrency group: the second run then waits its turn and goes on by itself when the first is done.',
    steps: {
      unit: { label: 'Unit tests', minutes: 4, fails: ['test-fail'] },
      image: { label: 'Build image', minutes: 3, pushes: true },
      deploy: { label: 'Deploy staging', minutes: 3, needs: 'image', deploys: 'staging' },
    },
    pipeline: [['unit', 'image'], ['deploy']],
    on: { image: ['tag'], deploy: ['main'] },
    toggles: ['main', 'tag', 'lock'],
    checks: [
      { commit: 'good', branch: 'main', expect: 'green', within: 8 },
      { runs: [
        { commit: 'good', branch: 'main', at: 0 },
        { commit: 'good', branch: 'main', at: 2 },
      ], expect: 'green', within: 8 },
      { commit: 'test-fail', branch: 'main', expect: 'red', within: 5 },
      { commit: 'good', branch: 'feature/x', expect: 'no-deploy' },
    ],
    stars: { three: 44, two: 50 },
    solution: ['lock deploy', 'run'],
    inRealLife: [
      { label: 'Jenkinsfile (Lockable Resources plugin)', code: `pipeline {
  agent none   // each stage takes its own agent
  stages {
    // ... the Unit tests and Build image stages ...
    stage('Deploy staging') {
      when { beforeOptions true; branch 'main' }
      options { lock(resource: 'staging') }   // the next build waits here,
      agent { label 'linux' }                 // before it takes an agent
      steps {
        sh 'helm upgrade --install sample-app ./chart -n sample --set image.tag=$GIT_COMMIT'
      }
    }
  }
}` },
      { label: 'bitbucket-pipelines.yml', code: `- step:
    name: Deploy staging
    # deployment: alone halts the second run until someone resumes it by hand;
    # a concurrency group queues it instead and starts it, first in first out
    deployment: staging
    concurrency-group: deploy-staging
    script:
      - helm upgrade --install sample-app ./chart -n sample --set image.tag=$BITBUCKET_COMMIT` },
      { label: 'GitHub Actions', code: `  deploy-staging:
    needs: [unit, image]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    concurrency:
      group: deploy-staging
      queue: max   # every run waits its turn (by default only the newest waits)
    steps:
      - uses: actions/checkout@v7
      - run: helm upgrade --install sample-app ./chart -n sample --set image.tag=\${{ github.sha }}` },
    ],
    docs: [
      'https://plugins.jenkins.io/lockable-resources/',
      'https://support.atlassian.com/bitbucket-cloud/docs/step-options/',
      'https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idconcurrency',
    ],
  },
];

// The branch's pull request, end to end: collector.mjs runs git and a gh stand-in through its detached
// worker into the cache, logic parses the cached answer, and the render shows it on the git line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PULL_REQUEST_REFRESH_MS, createProbes, parsePullRequestJob, probesToStart, pullRequestTarget, readPullRequest, refreshPullRequest,
} from '../collector.mjs';
import { getPullRequest, parsePullRequest } from '../src/pull-request.ts';
import { renderLines } from '../src/render/index.ts';
import { mergeConfig } from '../src/config.ts';

const FAKE_GH = [process.execPath, fileURLToPath(new URL('./fixtures/fake-gh.mjs', import.meta.url))];
const REPO = { host: 'github.com', owner: 'acme', name: 'widgets' };
const NOW = Date.UTC(2026, 10, 13, 12);
const WORKER_WAIT_MS = 10_000;
const WORKER_POLL_MS = 50;

const plain = (text) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-pr-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const cacheFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((name) => /^[0-9a-f]{64}\.json$/.test(name)) : []);
const readCache = (dir) => JSON.parse(readFileSync(path.join(dir, cacheFiles(dir)[0]), 'utf8'));

async function waitFor(condition, what) {
  const deadline = Date.now() + WORKER_WAIT_MS;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`pull-request.test: timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, WORKER_POLL_MS));
  }
}

function gitRepo(dir, branch) {
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', `--initial-branch=${branch}`);
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
}

const ghAnswer = (overrides = {}) => JSON.stringify({
  number: 12, state: 'OPEN', isDraft: false, headRefName: 'feature/x', statusCheckRollup: [], ...overrides,
});

test('pullRequestTarget passes only names gh reads as a repo and a branch', () => {
  assert.deepEqual(pullRequestTarget(REPO, 'feature/x'), { repo: 'acme/widgets', branch: 'feature/x' });
  for (const branch of ['HEAD', '123', '-R', '--repo=evil/x', 'owner:branch', 'https://github.com/a/b/pull/1', 'rama con espacios', '', null]) {
    assert.equal(pullRequestTarget(REPO, branch), null, String(branch));
  }
  assert.equal(pullRequestTarget({ ...REPO, host: 'gitlab.com' }, 'main'), null);
  assert.equal(pullRequestTarget({ ...REPO, owner: 'a/b' }, 'main'), null);
  assert.equal(pullRequestTarget(null, 'main'), null);
});

test('parsePullRequestJob accepts only the jobs readPullRequest starts', () => {
  const file = path.join(tmpdir(), 'cache.json');
  const job = { command: ['gh'], file, repo: 'acme/widgets', branch: 'main' };
  assert.deepEqual(parsePullRequestJob(JSON.stringify(job)), job);
  for (const bad of [
    { ...job, branch: '--web' },
    { ...job, repo: 'acme/widgets/extra' },
    { ...job, file: 'relative.json' },
    { ...job, file: path.join(tmpdir(), 'cache.txt') },
    { ...job, command: [] },
    { ...job, command: [''] },
  ]) assert.equal(parsePullRequestJob(JSON.stringify(bad)), null, JSON.stringify(bad));
  assert.equal(parsePullRequestJob('not json'), null);
});

test('refreshPullRequest asks gh about the branch outside the repo and caches its answer or none', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'cache.json');
    assert.equal(await refreshPullRequest({ command: FAKE_GH, file, repo: 'acme/widgets', branch: 'feature/x' }), true);
    const call = JSON.parse(readFileSync(path.join(dir, 'fake-gh-call.json'), 'utf8'));
    assert.deepEqual(call.args.slice(0, 5), ['pr', 'view', 'feature/x', '--repo', 'acme/widgets']);
    assert.equal(path.resolve(call.cwd), path.resolve(dir), 'gh runs in the cache dir, never the repo');
    assert.equal(JSON.parse(JSON.parse(readFileSync(file, 'utf8')).stdout).number, 966);

    assert.equal(await refreshPullRequest({ command: FAKE_GH, file, repo: 'acme/widgets', branch: 'no-pr' }), true);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).stdout, null);
  });
});

test('readPullRequest answers from the cache and starts one refresh per stale period', async () => {
  await withTempDir(async (dir) => {
    const started = [];
    const startWorker = (job) => started.push(job);
    const target = { repo: 'acme/widgets', branch: 'feature/x' };

    assert.equal(readPullRequest(dir, target, { command: ['gh'], now: NOW, startWorker }), null);
    assert.equal(started.length, 1);
    assert.deepEqual({ ...started[0], file: undefined }, { command: ['gh'], file: undefined, ...target });
    assert.equal(readPullRequest(dir, target, { command: ['gh'], now: NOW + 1000, startWorker }), null);
    assert.equal(started.length, 1, 'a claimed refresh is not started again');

    await refreshPullRequest({ command: FAKE_GH, file: started[0].file, ...target });
    const fresh = readCache(dir).checkedAt;
    assert.match(readPullRequest(dir, target, { command: ['gh'], now: fresh + 1000, startWorker }).stdout, /"number":966/);
    assert.equal(started.length, 1);

    const answer = readPullRequest(dir, target, { command: ['gh'], now: fresh + PULL_REQUEST_REFRESH_MS, startWorker });
    assert.match(answer.stdout, /"number":966/, 'a stale answer is still shown while it refreshes');
    assert.equal(started.length, 2);
    assert.equal(readPullRequest(dir, target, { command: null, now: fresh + 3 * PULL_REQUEST_REFRESH_MS, startWorker }).stdout, answer.stdout);
    assert.equal(started.length, 2, 'without gh nothing starts');
  });
});

test('the github.pr probe refreshes in the background, then logic reads the branch PR', async () => {
  await withTempDir(async (dir) => {
    const repoDir = path.join(dir, 'repo');
    const cacheDir = path.join(dir, 'cache');
    await mkdir(repoDir);
    gitRepo(repoDir, 'feature/x');
    const probes = () => createProbes({ cwd: repoDir, argv: [], pullRequests: { dir: cacheDir, repo: REPO, command: FAKE_GH } });

    assert.equal(await getPullRequest(probes(), REPO, 'feature/x'), null, 'the first render does not wait for gh');
    await waitFor(() => cacheFiles(cacheDir).length === 1 && readCache(cacheDir).stdout !== null, 'the gh worker');

    const pullRequest = await getPullRequest(probes(), REPO, 'feature/x');
    assert.deepEqual(pullRequest, { number: 966, state: 'open', checks: 'pending', url: 'https://github.com/acme/widgets/pull/966' });
    assert.equal(await createProbes({ cwd: repoDir, argv: [] })(['github.pr']).then((answers) => answers['github.pr']), null,
      'no cache dir, no probe');
  });
});

test('parsePullRequest reads state, checks and the branch, and builds the URL from the repo', () => {
  const parse = (overrides, branch = 'feature/x', repo = REPO) => parsePullRequest(ghAnswer(overrides), repo, branch);
  assert.deepEqual(parse({}), { number: 12, state: 'open', checks: null, url: 'https://github.com/acme/widgets/pull/12' });
  assert.equal(parse({ isDraft: true }).state, 'draft');
  assert.equal(parse({ state: 'MERGED' }).state, 'merged');
  assert.equal(parse({ state: 'CLOSED' }).state, 'closed');
  assert.equal(parse({ state: 'WEIRD' }), null);
  assert.equal(parse({ number: -1 }), null);
  assert.equal(parse({}, 'other-branch'), null, 'a cache from before a branch switch shows nothing');
  assert.equal(parse({}, 'feature/x', { host: 'github.com', owner: 'a b', name: 'c' }), null);
  assert.equal(parsePullRequest('not json', REPO, 'feature/x'), null);

  const checks = (statusCheckRollup) => parse({ statusCheckRollup }).checks;
  assert.equal(checks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }]), 'success');
  assert.equal(checks([{ status: 'IN_PROGRESS', conclusion: '' }, { status: 'COMPLETED', conclusion: 'SUCCESS' }]), 'pending');
  assert.equal(checks([{ state: 'PENDING' }]), 'pending');
  assert.equal(checks([{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'TIMED_OUT' }]), 'failure');
  assert.equal(checks([{ state: 'ERROR' }]), 'failure');
});

test('on a base branch only an open PR shows', () => {
  for (const branch of ['main', 'master', 'develop']) {
    assert.equal(parsePullRequest(ghAnswer({ headRefName: branch, state: 'MERGED' }), REPO, branch), null, branch);
    assert.equal(parsePullRequest(ghAnswer({ headRefName: branch }), REPO, branch).state, 'open', branch);
  }
});

const CLEAN = { staged: 0, modified: 0, untracked: 0, conflicted: 0 };

function frame(config = {}, rest = {}) {
  return {
    stdin: { model: { display_name: 'Opus' }, cwd: '/home/u/dev/my-project', context_window: { context_window_size: 200000, used_percentage: 45 } },
    transcript: { tools: [], agents: [], todos: [] },
    claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0, costTotals: null, outputSpeed: null,
    gitStatus: { branch: 'feature/x', isDirty: true, ahead: 0, behind: 0, changes: { ...CLEAN, modified: 1 }, upstreamGone: false },
    pullRequest: { number: 966, state: 'open', checks: 'success', url: 'https://github.com/acme/widgets/pull/966' },
    usageData: null, memoryUsage: null, extraLabel: null,
    ...rest,
    config: mergeConfig(config),
  };
}

const gitLine = (rest, config = {}) => plain(renderLines(frame(config, rest), null, NOW).at(-1));
const BRANCH = '';
const PR_OPEN = '';
const CHECK = '';

test('by default the HUD comes first, then the directory, then git with the PR, as in issue #1', () => {
  const tools = { tools: [{ id: 't1', name: 'Read', status: 'completed', startTime: new Date(NOW - 1000), endTime: new Date(NOW) }] };
  for (const lineLayout of ['expanded', 'compact']) {
    const lines = renderLines(frame({ lineLayout, display: { showTools: true } }, { transcript: { agents: [], todos: [], ...tools } }), null, NOW);
    const shown = lines.map(plain);
    assert.ok(shown.length >= 4, lineLayout + ': ' + shown.join(' / '));
    assert.match(shown.at(-3), /Read/, lineLayout + ': activity lines come before the directory');
    assert.equal(shown.at(-2), 'my-project', lineLayout);
    assert.equal(shown.at(-1), `${BRANCH} feature/x  1 — ${PR_OPEN} #966 ${CHECK}`, lineLayout);
    assert.ok(!shown[0].includes('my-project') && !shown[0].includes('feature/x'), lineLayout);
    assert.match(shown[0], /^\[Opus\] █+░+ 45%/, lineLayout + ': context sits right after the model');
    assert.ok(lines.at(-1).includes('\x1b]8;;https://github.com/acme/widgets/pull/966\x1b\\'), 'the PR number is a link');
  }
});

test('the shell style counts changes as the prompt does, or marks a clean tree', () => {
  const status = (overrides) => ({ gitStatus: { branch: 'feature/x', isDirty: true, ahead: 0, behind: 0, upstreamGone: false, ...overrides }, pullRequest: null });
  assert.equal(gitLine(status({ changes: CLEAN, isDirty: false })), `${BRANCH} feature/x ${CHECK}`);
  assert.equal(gitLine(status({ ahead: 2, behind: 1, changes: { staged: 1, modified: 2, untracked: 3, conflicted: 4 } })),
    `${BRANCH} feature/x ↑2↓1 ✘ 4  1  2  3`);
  assert.equal(gitLine(status({ changes: undefined })), `${BRANCH} feature/x`, 'counts unknown after a status timeout: none shown');
});

test('the shell style colors the branch by its upstream, shows a detached SHA and cuts long names', () => {
  const branchColor = (overrides) => renderLines(frame({}, { gitStatus: { branch: 'feature/x', isDirty: false, ahead: 0, behind: 0, changes: CLEAN, ...overrides }, pullRequest: null }), null, NOW).at(-1);
  assert.ok(branchColor({ upstreamGone: false }).includes(`\x1b[1m\x1b[34m${BRANCH} feature/x`), 'bold blue');
  assert.ok(branchColor({ upstreamGone: true }).includes(`\x1b[1m\x1b[31m${BRANCH} feature/x`), 'bold red once the upstream is gone');
  assert.ok(branchColor({ branch: 'detached:abc1234' }).includes(`\x1b[1m\x1b[33m${BRANCH} abc1234`), 'bold yellow short SHA');
  const long = 'feature/' + 'x'.repeat(60);
  assert.equal(gitLine({ gitStatus: { branch: long, isDirty: false, ahead: 0, behind: 0, changes: CLEAN }, pullRequest: null }),
    `${BRANCH} ${long.slice(0, 39)}… ${CHECK}`);
});

test('by default model, effort, context and usage share the first line, and stack when it does not fit', () => {
  const usageData = { fiveHour: 25, sevenDay: 40, fiveHourResetAt: new Date(NOW + 90 * 60_000), sevenDayResetAt: new Date(NOW + 50 * 3_600_000) };
  const stdin = { model: { display_name: 'Opus' }, effort: { level: 'high' }, cwd: '/home/u/dev/my-project', context_window: { context_window_size: 200000, used_percentage: 45 } };
  const wide = renderLines(frame({}, { stdin, usageData }), 200, NOW).map(plain);
  assert.match(wide[0], /^\[Opus ◑ high\] █+░+ 45% │ 5h: █+░+ 25% \(1h 30m\)$/, 'context glued to the model with its bar, no label; usage short, with its bar (40% weekly stays under sevenDayThreshold)');
  const narrow = renderLines(frame({}, { stdin, usageData }), 40, NOW).map(plain);
  assert.match(narrow[0], /^\[Opus ◑ high\] █+░+ 45%$/);
  assert.ok(narrow.some((line) => /^5h: █+░+ 25%/.test(line)), 'usage stacks on its own line');
  const apart = renderLines(frame({ display: { contextBesideModel: false } }, { stdin, usageData }), 200, NOW).map(plain);
  assert.match(apart[0], /^\[Opus ◑ high\] │ Context █+░+ 45% │ 5h: █+░+ 25%/, 'contextBesideModel false brings back the Context element');
});

test('by default the config counts and the duration sit right under the model line', () => {
  const stdin = { model: { display_name: 'Opus' }, cwd: '/home/u/dev/my-project', context_window: { context_window_size: 200000, used_percentage: 45 },
    cost: { total_duration_ms: 65 * 60_000 } };
  const counts = { claudeMdCount: 2, mcpCount: 4, hooksCount: 7 };
  const shown = renderLines(frame({}, { stdin, ...counts }), 200, NOW).map(plain);
  assert.match(shown[0], /^\[Opus\] █+░+ 45%$/);
  assert.match(shown[1], /^2 CLAUDE\.md \| 4 MCPs \| 7 hooks \| ⏱️ +1h 5m$/);
  const firstLine = renderLines(frame({ display: { durationPlacement: 'firstLine' } }, { stdin, ...counts }), 200, NOW).map(plain);
  assert.match(firstLine[0], /^\[Opus\] █+░+ 45% │ ⏱️ +1h 5m$/);
  assert.doesNotMatch(firstLine[1], /⏱️/);
});

test('the classic style and inline layouts bring back the single first line', () => {
  const config = { display: { projectLayout: 'inline', mergeGroups: [] }, gitStatus: { layout: 'inline', style: 'classic', showPullRequest: false } };
  const shown = renderLines(frame(config), null, NOW).map(plain);
  assert.equal(shown[0], '[Opus] █████░░░░░ 45% │ my-project git:(feature/x*)');
  assert.ok(!shown.some((line) => line.includes('#966')));
  const classicWithPullRequest = gitLine({}, { gitStatus: { style: 'classic' } });
  assert.equal(classicWithPullRequest, `git:(feature/x*) ${PR_OPEN} #966 ${CHECK}`);
});

test('the PR shows its state and checks with Nerd Font icons, and jj never shows one', () => {
  const pr = (pullRequest) => gitLine({ pullRequest: { number: 7, url: 'https://github.com/acme/widgets/pull/7', ...pullRequest } });
  const prefix = `${BRANCH} feature/x  1 — `;
  assert.equal(pr({ state: 'merged', checks: 'failure' }), `${prefix} #7 `);
  assert.equal(pr({ state: 'closed', checks: 'pending' }), `${prefix} #7 `);
  assert.equal(pr({ state: 'draft', checks: null }), `${prefix}${PR_OPEN} #7 `, 'checks not known yet show a white clock');
  const jj = renderLines(frame({ jjStatus: { enabled: true } }, { gitStatus: { branch: 'main', isDirty: false, ahead: 0, behind: 0, vcs: 'jj' } }), null, NOW);
  assert.ok(!jj.map(plain).some((line) => line.includes('#966')));
  assert.ok(jj.map(plain).some((line) => line.startsWith('jj:(main)')), 'jj keeps the classic style');
});

test('a directory line set apart is hidden with the project element', () => {
  const shown = renderLines(frame({ elementOrder: ['context'] }), null, NOW).map(plain);
  assert.ok(!shown.includes('my-project'));
});

test('the collector starts the PR probe early unless the user turned it off', () => {
  const settings = (values) => (section, key) => values[`${section}.${key}`];
  assert.deepEqual(probesToStart(settings({})), ['git.status', 'github.pr']);
  assert.deepEqual(probesToStart(settings({ 'gitStatus.showPullRequest': false })), ['git.status']);
  assert.deepEqual(probesToStart(settings({ 'gitStatus.enabled': false })), []);
});

import type { Ask } from './channel.ts';
import { createDebug } from './debug.ts';
import { githubRepoUrl, type GitRepoIdentity } from './git.ts';

const debug = createDebug('pull-request');

export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed';
/** The combined state of the PR's checks; null when it has none. */
export type PullRequestChecks = 'success' | 'failure' | 'pending' | null;

export interface PullRequest {
  number: number;
  state: PullRequestState;
  checks: PullRequestChecks;
  /** The PR's page, built from the repo Claude Code reported, never from gh's output. */
  url: string;
}

/** On these branches only an open PR is shown: a merged one there is history, not the work at hand. */
export const BASE_BRANCHES: readonly string[] = ['main', 'master', 'develop'];

// gh's statusCheckRollup mixes check runs (status, conclusion) and commit statuses (state).
const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const FAILED_STATES = new Set(['FAILURE', 'ERROR']);
const PENDING_STATES = new Set(['PENDING', 'EXPECTED']);
const COMPLETED_STATUS = 'COMPLETED';

type ProbeAnswer = { stdout: string } | null | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function checksState(rollup: unknown): PullRequestChecks {
  if (!Array.isArray(rollup)) return null;
  const checks = rollup.filter(isRecord);
  if (checks.length === 0) return null;
  const failed = checks.some((check) => FAILED_CONCLUSIONS.has(String(check.conclusion)) || FAILED_STATES.has(String(check.state)));
  if (failed) return 'failure';
  const pending = checks.some((check) => (
    typeof check.status === 'string' ? check.status !== COMPLETED_STATUS : PENDING_STATES.has(String(check.state))
  ));
  return pending ? 'pending' : 'success';
}

function pullRequestState(state: unknown, isDraft: unknown): PullRequestState | null {
  if (state === 'OPEN') return isDraft === true ? 'draft' : 'open';
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed';
  return null;
}

/**
 * The PR in `gh pr view --json number,state,isDraft,headRefName,statusCheckRollup` output, when it
 * belongs to `branch`. The collector's cache can lag a branch switch, so another head means none.
 */
export function parsePullRequest(stdout: string, repo: GitRepoIdentity | null | undefined, branch: string): PullRequest | null {
  const base = githubRepoUrl(repo);
  if (!base) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    debug('pull request answer is not JSON:', error);
    return null;
  }
  if (!isRecord(parsed) || parsed.headRefName !== branch) return null;
  const number = parsed.number;
  const state = pullRequestState(parsed.state, parsed.isDraft);
  if (!Number.isSafeInteger(number) || (number as number) <= 0 || !state) return null;
  if (BASE_BRANCHES.includes(branch) && state !== 'open' && state !== 'draft') return null;
  return { number: number as number, state, checks: checksState(parsed.statusCheckRollup), url: `${base}/pull/${number}` };
}

/** The current branch's PR, from the collector's cached `gh` answer. */
export async function getPullRequest(ask: Ask, repo: GitRepoIdentity | null | undefined, branch: string): Promise<PullRequest | null> {
  const answer = (await ask(['github.pr']))['github.pr'] as ProbeAnswer;
  return answer && typeof answer.stdout === 'string' ? parsePullRequest(answer.stdout, repo, branch) : null;
}

import * as path from 'node:path';
import { DEFAULT_CONFIG } from '../config.ts';
import type { Frame, Layout } from './frame.ts';
import { blue, bold, critical, cyan, dim, git as gitColor, gitBranch, green, magenta, red, shade, warning, white, yellow } from './colors.ts';
import type { GitChanges, GitStatus } from '../git.ts';
import type { PullRequestChecks, PullRequestState } from '../pull-request.ts';
import { getFileHref, safeHyperlink } from '../utils/hyperlinks.ts';
import { sanitizeDisplayText } from '../utils/sanitize.ts';
import { truncateString } from '../utils/truncate.ts';

function aheadCount(f: Frame, ahead: number): string {
  const config = f.config.gitStatus ?? DEFAULT_CONFIG.gitStatus;
  const colors = f.config?.colors;
  const value = `↑${ahead}`;
  if (config.pushCriticalThreshold > 0 && ahead >= config.pushCriticalThreshold) return critical(value, colors);
  if (config.pushWarningThreshold > 0 && ahead >= config.pushWarningThreshold) return warning(value, colors);
  return gitBranch(value, colors);
}

// Nerd Font glyphs, as the shell prompt draws them.
const ICON_BRANCH = '';
const ICON_CLEAN = '';
const ICON_STAGED = '';
const ICON_MODIFIED = '';
const ICON_UNTRACKED = '';
const ICON_CONFLICT = '✘';
const PULL_REQUEST_ICONS: Record<PullRequestState, string> = { open: '', draft: '', merged: '', closed: '' };
const PULL_REQUEST_COLORS: Record<PullRequestState, (text: string) => string> = { open: green, draft: dim, merged: magenta, closed: red };
const CHECK_MARKS: Record<Exclude<PullRequestChecks, null>, string> = { success: green(''), failure: red(''), pending: yellow('') };
// Checks not known yet, or none reported.
const CHECKS_UNKNOWN = white('');
// The prompt's greys: the separator before the PR, and the untracked count.
const SEPARATOR_SHADE = 242;
const UNTRACKED_SHADE = 244;
const SHELL_BRANCH_MAX_LENGTH = 40;
const SHORT_SHA_LENGTH = 7;

/** `<icon> #123 <checks>`: the branch's PR, linked to its page and colored by state, then its checks. */
export function pullRequestPart(f: Frame): string | null {
  const pullRequest = f.pullRequest;
  if (!pullRequest || !(f.config.gitStatus ?? DEFAULT_CONFIG.gitStatus).showPullRequest) return null;
  const color = PULL_REQUEST_COLORS[pullRequest.state];
  const label = safeHyperlink(pullRequest.url, color(`${PULL_REQUEST_ICONS[pullRequest.state]} #${pullRequest.number}`));
  return `${label} ${pullRequest.checks ? CHECK_MARKS[pullRequest.checks] : CHECKS_UNKNOWN}`;
}

function shellBranch(status: GitStatus): string {
  const detached = /^detached:([0-9a-f]+)$/.exec(status.branch)?.[1];
  if (detached) return bold(`${ICON_BRANCH} ${detached.slice(0, SHORT_SHA_LENGTH)}`, yellow);
  const name = truncateString(sanitizeDisplayText(status.branch), SHELL_BRANCH_MAX_LENGTH, '…');
  return safeHyperlink(status.branchUrl, bold(`${ICON_BRANCH} ${name}`, status.upstreamGone ? red : blue));
}

function shellChanges(changes: GitChanges): string {
  const counts = [
    changes.conflicted > 0 ? bold(`${ICON_CONFLICT} ${changes.conflicted}`, red) : '',
    changes.staged > 0 ? green(`${ICON_STAGED} ${changes.staged}`) : '',
    changes.modified > 0 ? yellow(`${ICON_MODIFIED} ${changes.modified}`) : '',
    changes.untracked > 0 ? shade(`${ICON_UNTRACKED} ${changes.untracked}`, UNTRACKED_SHADE) : '',
  ].filter(Boolean);
  return counts.length > 0 ? counts.join(' ') : green(ICON_CLEAN);
}

/**
 * The shell prompt's git segment: `<icon> branch ↑1↓2 <conflicts> <staged> <modified> <untracked> — <PR> <checks>`,
 * with a check mark instead of counts when the tree is clean. The branch is red once its upstream is
 * gone, and a detached HEAD shows its short SHA in yellow.
 */
function shellVcsPart(f: Frame, status: GitStatus): string {
  const sync = (status.ahead > 0 ? cyan(`↑${status.ahead}`) : '') + (status.behind > 0 ? cyan(`↓${status.behind}`) : '');
  const parts = [shellBranch(status), sync, status.changes ? shellChanges(status.changes) : ''].filter(Boolean);
  const git = f.config.gitStatus ?? DEFAULT_CONFIG.gitStatus;
  const worktreeName = git.showWorktree ? sanitizeDisplayText(f.stdin.workspace?.git_worktree ?? '').trim() : '';
  if (worktreeName) parts.push(gitColor(`⎇ ${worktreeName}`, f.config?.colors));
  const pullRequest = pullRequestPart(f);
  return pullRequest ? `${parts.join(' ')} ${shade('—', SEPARATOR_SHADE)} ${pullRequest}` : parts.join(' ');
}

/**
 * git in the `shell` style (see shellVcsPart), or `git:(main* ↑2)` or `jj:(…)` in the `classic` one,
 * plus the worktree name. Classic expanded adds line diffs; classic compact adds Starship-style file
 * counts instead. jj is always classic and never shows git-only details.
 */
export function vcsPart(f: Frame, layout: Layout): string | null {
  const status = f.gitStatus;
  if (!status) return null;
  const git = f.config.gitStatus ?? DEFAULT_CONFIG.gitStatus;
  const jj = f.config.jjStatus ?? DEFAULT_CONFIG.jjStatus;
  const isJj = status.vcs === 'jj';
  if (!(isJj ? jj.enabled : git.enabled)) return null;
  if (!isJj && git.style === 'shell') return shellVcsPart(f, status);

  const colors = f.config?.colors;
  const dirty = (isJj ? jj.showDirty : git.showDirty) && status.isDirty;
  const branch = safeHyperlink(isJj ? undefined : status.branchUrl, gitBranch(`${sanitizeDisplayText(status.branch)}${dirty ? '*' : ''}`, colors));
  const inner = [branch];

  if (!isJj && git.showAheadBehind) {
    if (status.ahead > 0) inner.push(aheadCount(f, status.ahead));
    if (status.behind > 0) inner.push(gitBranch(`↓${status.behind}`, colors));
  }
  if (!isJj && git.showFileStats) {
    if (layout === 'expanded' && status.lineDiff) {
      const diff = [status.lineDiff.added > 0 ? green(`+${status.lineDiff.added}`) : '', status.lineDiff.deleted > 0 ? red(`-${status.lineDiff.deleted}`) : '']
        .filter(Boolean);
      if (diff.length > 0) inner.push(`[${diff.join(' ')}]`);
    }
    if (layout === 'compact' && status.fileStats) {
      const { modified, added, deleted, untracked } = status.fileStats;
      const counts = [[modified, '!'], [added, '+'], [deleted, '✘'], [untracked, '?']]
        .filter(([count]) => (count as number) > 0)
        .map(([count, symbol]) => `${symbol}${count}`);
      if (counts.length > 0) inner.push(gitBranch(counts.join(' '), colors));
    }
  }
  if (isJj && jj.showConflicts && status.conflict === true) inner.push(critical('!conflict', colors));

  const worktreeName = !isJj && git.showWorktree ? sanitizeDisplayText(f.stdin.workspace?.git_worktree ?? '').trim() : '';
  const worktree = worktreeName ? ` ${gitColor(`⎇ ${worktreeName}`, colors)}` : '';
  const pullRequest = isJj ? null : pullRequestPart(f);
  return `${gitColor(isJj ? 'jj:(' : 'git:(', colors)}${inner.join(' ')}${gitColor(')', colors)}${worktree}${pullRequest ? ` ${pullRequest}` : ''}`;
}

function insideCwd(cwd: string, candidate: string): string | null {
  const resolved = path.resolve(cwd, candidate);
  const relative = path.relative(path.resolve(cwd), resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)) ? resolved : null;
}

const MAX_FILES = 6;

/** Changed files in git's order, with per-file line diffs (expanded, gitStatus.showFileStats). */
export function gitFilesLine(f: Frame): string | null {
  const stats = f.gitStatus?.fileStats;
  if (!(f.config?.gitStatus?.showFileStats ?? false) || !stats) return null;
  if (stats.trackedFiles.length === 0 && stats.untracked === 0) return null;
  if (f.width !== null && f.width < 60) return null;

  const cwd = f.stdin.cwd;
  const files = stats.trackedFiles;

  const colorFor = { added: green, deleted: red, modified: yellow } as const;
  const prefix = { added: '+', deleted: '-', modified: '~' } as const;
  const entries = files.slice(0, MAX_FILES).map((file) => {
    const color = colorFor[file.type];
    const resolved = cwd ? insideCwd(cwd, file.fullPath) : null;
    const name = color(sanitizeDisplayText(file.basename));
    let entry = `${color(prefix[file.type])}${resolved ? safeHyperlink(getFileHref(resolved), name) : name}`;
    const diff = file.lineDiff;
    const diffParts = diff ? [diff.added > 0 ? green(`+${diff.added}`) : '', diff.deleted > 0 ? red(`-${diff.deleted}`) : ''].filter(Boolean) : [];
    if (diffParts.length > 0) entry += dim(`(${diffParts.join(' ')})`);
    return entry;
  });

  if (files.length > MAX_FILES) entries.push(dim(`+${files.length - MAX_FILES} more`));
  if (stats.untracked > 0) entries.push(dim(`?${stats.untracked}`));
  return entries.join('  ');
}

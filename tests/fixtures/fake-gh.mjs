// Stands in for the gh CLI in tests: `pr view <branch> --repo <owner/name> --json <fields>`.
// It records its argv and cwd beside the cache, and answers like gh: a PR for any branch but
// `no-pr`, for which it fails as gh does when a branch has no pull request.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const branch = args[2];
fs.writeFileSync(path.join(process.cwd(), 'fake-gh-call.json'), JSON.stringify({ args, cwd: process.cwd() }));
if (branch === 'no-pr') {
  process.stderr.write(`no pull requests found for branch "${branch}"\n`);
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  number: 966,
  state: 'OPEN',
  isDraft: false,
  headRefName: branch,
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'PENDING' }],
}));

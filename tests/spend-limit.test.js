// The organization's monthly spend cap, which Claude Code reports as rate_limits.spend_limit: shown as a
// bar beside the usage windows when it is reported, with the dollar amounts once the user names the cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLines } from '../src/render/index.ts';
import { mergeConfig } from '../src/config.ts';
import { getSpendLimitFromStdin } from '../src/stdin.ts';

const NOW = Date.UTC(2026, 10, 13, 12);
const DAY_SECONDS = 86_400;
const plain = (text) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

function render({ spendLimit, display = {}, usageData = null }) {
  const stdin = {
    model: { display_name: 'Opus' },
    context_window: { context_window_size: 200000, used_percentage: 10 },
    ...(spendLimit === undefined ? {} : { rate_limits: { spend_limit: spendLimit } }),
  };
  const frame = {
    stdin, transcript: { tools: [], agents: [], todos: [] }, claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0,
    costTotals: null, outputSpeed: null, gitStatus: null, usageData, memoryUsage: null, extraLabel: null, config: mergeConfig({ display }),
  };
  return renderLines(frame, 200, NOW).map(plain);
}

const capAt = (percent) => ({ used_percentage: percent, resets_at: NOW / 1000 + 20 * DAY_SECONDS });

test('getSpendLimitFromStdin reads the share used and the reset, or nothing', () => {
  assert.deepEqual(getSpendLimitFromStdin({ rate_limits: { spend_limit: capAt(20) } }), { percent: 20, resetAt: new Date(NOW + 20 * DAY_SECONDS * 1000) });
  assert.equal(getSpendLimitFromStdin({ rate_limits: { spend_limit: { used_percentage: null } } }), null);
  assert.equal(getSpendLimitFromStdin({}), null);
});

test('a reported spend cap shows as a bar beside the model and context, by default', () => {
  const [first] = render({ spendLimit: capAt(20) });
  assert.match(first, /^\[Opus\] █░+ 10% │ spend: ██░{8} 20% \(20d\)$/);
});

test('a subscription shows only its usage windows: the cap bar appears with the cap alone', () => {
  const usageData = { fiveHour: 25, sevenDay: 40, fiveHourResetAt: new Date(NOW + 90 * 60_000), sevenDayResetAt: new Date(NOW + 2 * DAY_SECONDS * 1000) };
  const [subscription] = render({ usageData });
  assert.match(subscription, /│ 5h: █+░+ 25% \(1h 30m\)$/);
  assert.doesNotMatch(subscription, /spend:/);
  const [both] = render({ usageData, spendLimit: capAt(50) });
  assert.match(both, /│ 5h: █+░+ 25% \(1h 30m\) \| spend: █{5}░{5} 50% \(20d\)$/);
});

test('with spendLimitUsd the bar also shows the dollars spent of the cap', () => {
  const [first] = render({ spendLimit: capAt(20), display: { spendLimitUsd: 500 } });
  assert.match(first, /spend: ██░{8} 20% \$100\/\$500 \(20d\)$/);
});

test('showSpendLimit false hides the cap, and spendLimitUsd takes only a positive amount', () => {
  assert.ok(!render({ spendLimit: capAt(20), display: { showSpendLimit: false } }).some((line) => line.includes('spend:')));
  for (const value of [0, -5, 'quinientos', null]) {
    assert.equal(mergeConfig({ display: { spendLimitUsd: value } }).display.spendLimitUsd, null, String(value));
  }
});

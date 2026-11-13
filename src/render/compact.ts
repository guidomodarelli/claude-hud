import { DEFAULT_PROJECT_LINE_ORDER } from '../config.ts';
import { t } from '../i18n/index.ts';
import type { Frame } from './frame.ts';
import { activityLine, type ActivityElement } from './activity.ts';
import { separatorLine, visibleWidth } from './ansi.ts';
import { modelCluster, tokenBreakdown } from './context.ts';
import { cacheHitRateLine, promptCacheLine, sessionTimeLine } from './lines.ts';
import { orderParts } from './order.ts';
import {
  advisorPart, authPart, compactionsPart, configCountParts, costPart, customLinePart, durationPart, extraPart,
  projectLines, projectParts, sessionNamePart, sessionTokensSummary, speedPart, versionPart, type Part,
} from './parts.ts';
import { usageAndSpendParts } from './usage.ts';

const ACTIVITY: ActivityElement[] = ['tools', 'skills', 'mcp', 'agents', 'todos'];

function sessionLine(f: Frame): string {
  const parts: Part[] = [];
  const add = (text: string | null, key: Part['key'] = null): void => {
    if (text) parts.push({ key, text });
  };
  add(customLinePart(f, 'first'));
  add(modelCluster(f), 'model');
  for (const part of projectParts(f, 'compact')) add(part, 'project');
  add(sessionNamePart(f), 'sessionName');
  add(versionPart(f), 'version');
  configCountParts(f).forEach((part) => add(part));
  (usageAndSpendParts(f, 'compact') ?? []).forEach((part) => add(part));
  if (f.config?.display?.showSessionTokens) add(sessionTokensSummary(f, `${t('format.tok')}:`));
  add(compactionsPart(f));
  add(advisorPart(f), 'advisor');
  add(durationPart(f), 'duration');
  add(sessionTimeLine(f));
  add(promptCacheLine(f));
  add(cacheHitRateLine(f));
  add(costPart(f), 'cost');
  add(speedPart(f), 'speed');
  add(extraPart(f), 'extra');
  add(authPart(f), 'auth');
  add(customLinePart(f, 'last'));
  const line = orderParts(parts, f.config?.projectLineOrder ?? DEFAULT_PROJECT_LINE_ORDER).join(' | ');
  return line + tokenBreakdown(f);
}

/** The compact layout: one session line, the activity lines, then the project and git lines when set apart. */
export function compactLines(f: Frame): string[] {
  const header = sessionLine(f);
  const activity = ACTIVITY.map((element) => activityLine(f, element)).filter((line): line is string => !!line);
  const lines = [header];
  if (f.config?.showSeparators && activity.length > 0) {
    const widest = Math.max(visibleWidth(header), 20);
    lines.push(separatorLine(f.width ? Math.min(widest, f.width) : widest));
  }
  return [...lines, ...activity, ...projectLines(f, 'compact')];
}

export const MAX_TERMINAL_WIDTH = 1000;
/**
 * Below this a reported width is a wrapper's arithmetic gone wrong (a TTY-less `stty size` read as 0,
 * minus a padding margin), not a real terminal: no element fits, and wrapping to it would cut every
 * line down to `.`. Such a width counts as unknown, so the next source, `maxWidth`, or no wrapping applies.
 */
export const MIN_TERMINAL_WIDTH = 10;

const columns = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= MIN_TERMINAL_WIDTH
    ? Math.min(Math.floor(parsed), MAX_TERMINAL_WIDTH)
    : null;
};

/** Claude Code sets COLUMNS for the statusline; a TTY's own width is the fallback. */
export function getTerminalWidth(): number | null {
  return columns(process.env.COLUMNS) ?? columns(process.stdout?.columns) ?? columns(process.stderr?.columns);
}

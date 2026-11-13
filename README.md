# Claude HUD

A Claude Code plugin that shows what's happening: context usage, rate limits, active tools, running agents, and todo progress, always visible below your input.

[![License](https://img.shields.io/github/license/jarrodwatts/claude-hud?v=2)](LICENSE)
[![Stars](https://img.shields.io/github/stars/jarrodwatts/claude-hud)](https://github.com/jarrodwatts/claude-hud/stargazers)

![Claude HUD in action](claude-hud-preview-5-2.png)

> 🌐 English | [中文文档](README.zh.md)

## Install

Inside Claude Code, run:

```
/plugin marketplace add jarrodwatts/claude-hud
/plugin install claude-hud
/reload-plugins
/hud
```

`/hud` checks your setup and points your status line at the HUD, after asking you. It needs Node.js 22.18 or later; if yours is older, `/hud` finds a newer one on your machine or helps you install one.

<details>
<summary><strong>Prefer the terminal?</strong></summary>

```bash
claude plugin marketplace add jarrodwatts/claude-hud
claude plugin install claude-hud@claude-hud
```

Then run `/reload-plugins` and `/hud` inside a session.

</details>

**Updates:** Claude Code doesn't auto-update third-party plugins by default. To turn it on, run `/plugin`, open **Marketplaces**, select **claude-hud**, and choose **Enable auto-update**. Or update by hand with `claude plugin marketplace update claude-hud` and `claude plugin update claude-hud@claude-hud`, then `/reload-plugins`. You don't need to set it up again.

## What You See

The default is four lines:

```
[Opus ◑ high] █████░░░░░ 45% │ 5h: ███░░░░░░░ 25% (1h 30m)
2 CLAUDE.md | 4 MCPs | 7 hooks | ⏱️  1h 5m
my-project
 main  2  1 —  #966 
```

- **Line 1**: model with its reasoning effort (`display.showEffortLevel`) and a provider label when one is detected (`Bedrock`, `Vertex`, `MiniMax`), then the context used right after it, as a bar and a percent that go green, then yellow, then red as it fills (`display.contextBesideModel`), and your subscriber rate limits in their short form with a bar, `5h: ███░░░░░░░ 25% (1h 30m)` (`display.usageCompact`, `display.usageCompactBar`). On a company plan with a monthly spend cap, the cap gets its own bar there too, `spend: ██░░░░░░░░ 20% (20d)`, with the dollars once you set `display.spendLimitUsd` (`$100/$500`); the HUD picks what to show from what Claude Code reports, so a subscription shows its windows and a cap shows its bar (`display.mergeGroups`; they stack on their own lines when the terminal is too narrow).
- **Line 2**: CLAUDE.md, rules, MCP and hook counts (`display.showConfigCounts`), then how long the session has run (`display.showDuration`, `display.durationPlacement`).
- **Line 3**: the project directory's name (`pathLevels`; `display.projectLayout: "inline"` puts it back on line 1).
- **Line 4**: git as a shell prompt draws it, with Nerd Font icons: the branch, `↑↓` against its upstream, staged, modified, untracked and conflicted counts (a check mark when clean), and, from the `gh` CLI when it is installed and signed in, the branch's pull request as a clickable link with its checks, drawn with Nerd Font icons (`gitStatus.showPullRequest`; `gitStatus.layout: "inline"` puts git back on line 1; `gitStatus.style: "classic"` brings back `git:(main*)`). Needs a Nerd Font in the terminal.

The directory and git lines always close the HUD, after any optional lines.

Optional lines include tools, agents and todos, plus about a hundred other options:

```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← tools
◐ explore [haiku]: Finding auth code (2m 15s)    ← agents
▸ Fix authentication bug (2/5)                   ← todos
```

## Change It, Fix It, Report It

Ask Claude, or type `/hud` and say what you want: "show tool activity", "use the compact layout", "the HUD is blank", "the context bar looks wrong". Claude looks up the options, shows you a preview, and saves the change once you approve it. `/hud` also undoes the last change, replays the last real render to explain what you see, and, for a real bug, writes a scrubbed report that you read in full before anything is filed.

Settings live in `~/.claude/plugins/claude-hud/config.json` (under `$CLAUDE_CONFIG_DIR` if set). To turn the HUD off for one session, start Claude Code with `CLAUDE_HUD_DISABLE=1`.

## Security

The HUD's logic runs in a locked-down Node process. Node's permission model blocks it from starting programs, reading your credentials, and writing anywhere but its own data folder. An import fence keeps Node's network modules and globals out of its reach; that fence blocks every way out found so far, and is tested against each one on every change. A small separate file runs the fixed `git`, `jj` and memory commands it needs. The HUD reads Claude Code's stdin, the session transcript, Claude config files, and git or jj metadata for the current directory, and calls no undocumented APIs.

`--extra-cmd` runs a shell command on every refresh and puts its output on the first line. It is ignored unless `CLAUDE_HUD_ALLOW_EXTRA_CMD=1` is set in the HUD's environment. Treat it as arbitrary code execution and never use a command from an untrusted source.

## Requirements

- Claude Code v2.1.260 or later
- Node.js 22.18 or later (Bun can start the HUD, which then runs on Node)

## Development

```bash
git clone https://github.com/jarrodwatts/claude-hud
cd claude-hud
npm ci && npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jarrodwatts/claude-hud&type=Date)](https://star-history.com/#jarrodwatts/claude-hud&Date)

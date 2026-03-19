# Elve Terminal

A powerful terminal panel for Visual Studio Code — tabs, split views, per-directory history, themes, and aliases, all living right next to your **Terminal**, **Output**, and **Problems** panels. </br> </br>
Download: [Link](https://marketplace.visualstudio.com/items?itemName=ElveApps.elve-terminal)

![Elve Terminal demo](https://github.com/banekondic1996/Elve-Terminal-VSCode/blob/main/media/demo.gif?raw=true)

---

## Features

### Tabs
A collapsible sidebar on the left lists all your open terminal tabs. Hover to expand it, click a tab to switch, and use the **+** row at the bottom to open a new one. Each tab tracks its current directory and updates its label automatically.

### Split Views
Right-click anywhere in the terminal to split horizontally or vertically. Each pane runs its own independent shell session and tracks its own working directory. Drag the divider between panes to resize them. Click anywhere in a pane — including on terminal text — to focus it. The history panel updates instantly to reflect that pane's directory.

### Per-Directory History
Elve reads history directly from the shell — no parallel writes, no duplicates.

- If a `.history` file exists in the current directory, Elve reads that (written by your shell via `PROMPT_COMMAND`).
- Otherwise it falls back to `~/.bash_history`.
- History is deduplicated and capped at 60 most-recent unique commands.
- The history panel refreshes automatically whenever you press Enter, switch panes, or change directory.
- In split view, each pane shows its **own** history based on its own current directory — independently.
- External terminals that write to `~/.bash_history` are picked up within 20 seconds.

Click the **History** button (⟳) in the panel header to open the history sidebar. Clicking a command in the list runs it immediately.

Use **Menu → Create history file** to create a `.history` file in the focused pane's current directory. On first launch, Elve automatically installs a shell hook into `/etc/profile.d/elve-history.sh` (requires passwordless `sudo`) that wires `PROMPT_COMMAND` to switch `HISTFILE` based on whether a `.history` file exists in the current directory.

### Panel Header Buttons
All controls live in the VS Code panel header — no extra toolbar cluttering your terminal space:

| Button | Action |
|--------|--------|
| › (chevron) | Toggle the tab sidebar |
| 🔒 | Quick Password — saves a password for fast `sudo` access |
| 🗑 | Clear the terminal |
| ✕ | Clear the current line (Ctrl+U) |
| ⏹ | Kill the current process (Ctrl+C) |
| ⟳ | Toggle history sidebar |
| ⋯ | Open submenu (Aliases, Settings, Create history file) |

### Themes
Choose from **VSCode** (follows your editor theme), GitHub Dark, Dracula, Monokai, Solarized Dark, or Nord. Customise hue, brightness, saturation, and opacity independently.

### Aliases
Open **Menu → Aliases** to manage shell aliases. Aliases from your `.bashrc` / `.zshrc` are automatically detected and shown. Save to apply them in every open session.

### Settings
Font family, size, theme, and all visual options are in **Menu → Settings**. There is also an optional bottom input box that lets you type commands without clicking into the terminal first.

### Right-Click Menu
Right-clicking in the terminal shows quick actions: Copy, Paste, Split, and — when text is selected — one-click installs via `pacman`, `yay`, `apt-get`, `dnf`, or a web search.

---

## Keyboard Shortcut

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+E` / `Cmd+Alt+E` | Focus Elve Terminal panel |

---

## Requirements

- VS Code 1.80+
- Node.js 18+ (for the extension host — already bundled with VS Code)
- A POSIX shell (bash or zsh) — Windows support via PowerShell
- Passwordless `sudo` recommended for automatic shell hook installation

---

## Setup: Per-Directory History

On first launch Elve tries to write `/etc/profile.d/elve-history.sh` via `sudo tee`. This installs a `PROMPT_COMMAND` hook that automatically switches `HISTFILE` between a local `.history` file (if one exists in the current directory) and `~/.bash_history`.

If passwordless `sudo` is not available, you can add the snippet manually to your `~/.bashrc` or `~/.zshrc`:

```bash
# elve-history-hook
set_project_history() {
  if [ -f ".history" ]; then
    export HISTFILE="$(pwd)/.history"
  else
    export HISTFILE="$HOME/.bash_history"
  fi
  history -a
  history -c
  history -r
}
PROMPT_COMMAND="set_project_history"
```

Then use **Menu → Create history file** inside Elve to create a `.history` file in any project directory you want isolated history for.

---

## Tips

- Add `.history` to your global `.gitignore` to avoid committing per-directory history files.
- Right-click the 🔒 button to update a saved password.
- The tab sidebar collapses to a thin 28 px rail — hover to peek, click the **›** button to hide it fully.
- In split view, click anywhere in a pane (even on text) to switch focus and update the history panel.

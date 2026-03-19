import * as vscode from 'vscode';
import { TerminalServer } from './terminalServer';

let terminalServer: TerminalServer | null = null;
let webviewView: vscode.WebviewView | null = null;

function postCmd(cmd: string) {
  webviewView?.webview.postMessage({ type: 'hostCommand', cmd });
}

export async function activate(context: vscode.ExtensionContext) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(sync~spin) Elve: starting...';
  statusBar.show();
  context.subscriptions.push(statusBar);

  terminalServer = new TerminalServer();
  await terminalServer.start();

  statusBar.text = `$(terminal) Elve: ws:${terminalServer.port}`;
  statusBar.tooltip = `Elve Terminal WebSocket on 127.0.0.1:${terminalServer.port}`;

  // ── Panel toggle button — bottom-right status bar ─────────────────────────
  // Priority 99 puts it just to the left of the WS status item (100)
  const panelToggleBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  panelToggleBar.text = '$(terminal-view-icon)';
  panelToggleBar.tooltip = 'Toggle Elve Terminal panel';
  panelToggleBar.command = 'elveTerminal.togglePanel';
  panelToggleBar.show();
  context.subscriptions.push(panelToggleBar);

  const provider = new ElveTerminalPanelProvider(context, terminalServer);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ElveTerminalPanelProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // ── Panel toggle status bar command ──────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('elveTerminal.togglePanel', async () => {
      // If the Elve panel is already visible, toggle the whole panel area off;
      // otherwise focus/show the Elve panel (which opens the panel area too).
      const isVisible = webviewView !== null && webviewView.visible;
      if (isVisible) {
        await vscode.commands.executeCommand('workbench.action.togglePanel');
      } else {
        await vscode.commands.executeCommand(`${ElveTerminalPanelProvider.viewType}.focus`);
      }
    })
  );

  // ── Panel header button commands ─────────────────────────────────────────
  const headerCmds: [string, string][] = [
    ['elveTerminal.openPanel',     'openPanel'],
    ['elveTerminal.collapseBar',   'collapseBar'],
    ['elveTerminal.password',      'password'],
    ['elveTerminal.bell',          'bell'],
    ['elveTerminal.clear',         'clear'],
    ['elveTerminal.clearLine',     'clearLine'],
    ['elveTerminal.kill',          'kill'],
    ['elveTerminal.toggleHistory', 'toggleHistory'],
    ['elveTerminal.menu',          'menu'],
  ];
  for (const [id, cmd] of headerCmds) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, () => {
        if (cmd === 'openPanel') {
          vscode.commands.executeCommand(`${ElveTerminalPanelProvider.viewType}.focus`);
        } else {
          postCmd(cmd);
        }
      })
    );
  }

  // ── webview/context menu commands — forward action into webview ───────────
  const ctxCmds: [string, string][] = [
    ['elveTerminal.ctx.copy',          'ctx.copy'],
    ['elveTerminal.ctx.paste',         'ctx.paste'],
    ['elveTerminal.ctx.splitH',        'ctx.splitH'],
    ['elveTerminal.ctx.splitV',        'ctx.splitV'],
    ['elveTerminal.ctx.pacman',        'ctx.pacman'],
    ['elveTerminal.ctx.yay',           'ctx.yay'],
    ['elveTerminal.ctx.apt',           'ctx.apt'],
    ['elveTerminal.ctx.dnf',           'ctx.dnf'],
    ['elveTerminal.ctx.search',        'ctx.search'],
    ['elveTerminal.ctx.histExecute',   'ctx.histExecute'],
    ['elveTerminal.ctx.histCopyInput', 'ctx.histCopyInput'],
    ['elveTerminal.ctx.histCopy',      'ctx.histCopy'],
  ];
  for (const [id, cmd] of ctxCmds) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        if (cmd === 'ctx.paste') {
          // Read clipboard in extension host (no browser gesture restriction)
          const text = await vscode.env.clipboard.readText();
          webviewView?.webview.postMessage({ type: 'hostCommand', cmd: 'ctx.paste', text });
        } else if (cmd === 'ctx.copy') {
          // Ask webview to copy xterm selection — it will postMessage the text back
          webviewView?.webview.postMessage({ type: 'hostCommand', cmd: 'ctx.copy' });
        } else {
          postCmd(cmd);
        }
      })
    );
  }

  context.subscriptions.push({ dispose: () => terminalServer?.stop() });
}

export function deactivate() {
  terminalServer?.stop();
}

class ElveTerminalPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'elveTerminal.panel';

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly server: TerminalServer
  ) {}

  resolveWebviewView(
    view: vscode.WebviewView,
    _resolveContext: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView = view;
    const mediaUri = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaUri]
    };

    view.webview.html = this.buildHtml(view.webview, mediaUri);

    // When the panel tab becomes visible again, tell the webview to scroll to bottom
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        view.webview.postMessage({ type: 'hostCommand', cmd: 'scrollToBottom' });
      }
    });

    // Handle messages from the webview
    view.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'openExternal') {
        vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
      if (msg.type === 'setContext') {
        vscode.commands.executeCommand('setContext', 'elveHasSelection', msg.value);
      }
      // Webview sends selected text so we can write it to the VS Code clipboard
      if (msg.type === 'copyToClipboard') {
        await vscode.env.clipboard.writeText(msg.text);
      }
      // Bell armed — show notification
      if (msg.type === 'bellArmed') {
        vscode.window.showInformationMessage('🔔 Elve: monitoring started — will beep when terminal goes idle.');
      }
      if (msg.type === 'bellFired') {
        vscode.window.showInformationMessage('🔔 Elve: terminal finished!');
      }
    });
  }

  private buildHtml(webview: vscode.Webview, mediaUri: vscode.Uri): string {
    const uri = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, file));

    const wsPort = this.server.port;
    const nonce = getNonce();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const initialCwd = workspaceFolders?.length
      ? workspaceFolders[0].uri.fsPath
      : (process.env.HOME || process.env.USERPROFILE || '/');

    return /* html */`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com;
    font-src ${webview.cspSource} https://fonts.gstatic.com data:;
    script-src 'nonce-${nonce}';
    connect-src ws://127.0.0.1:${wsPort};
    img-src ${webview.cspSource} data:;
  ">
  <title>Elve Terminal</title>
  <link rel="stylesheet" href="${uri('xterm.css')}">
  <link rel="stylesheet" href="${uri('styles.css')}">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body>
<div class="terminal-container">

  <div class="main-content">

    <!-- Left tab sidebar -->
    <div class="tab-sidebar" id="tab-sidebar">
      <div class="tab-sidebar-inner" id="tab-sidebar-inner">
        <div class="tab-list" id="tabs-container"></div>
      </div>
    </div>

    <!-- Terminal area — gives the right-click context its webviewSection -->
    <div class="terminal-area" id="terminal-area"
         data-vscode-context='{"webviewSection":"terminal","preventDefaultContextMenuItems":true}'></div>

    <!-- History sidebar -->
    <div class="history-sidebar" id="history-sidebar" style="display:none;">
      <div class="history-list" id="history-list">
        <div class="no-history">No history yet</div>
      </div>
    </div>

    <!-- Settings panel -->
    <div class="settings-panel" id="settings-panel" style="display:none;">
      <div class="settings-header">
        <h3>Settings</h3>
        <button class="close-panel" id="close-settings">&#x2715;</button>
      </div>
      <div class="settings-content">
        <div class="setting-group">
          <label>Font</label>
          <select id="font-family">
            <option value="JetBrains Mono">JetBrains Mono</option>
            <option value="Fira Code">Fira Code</option>
            <option value="Courier New">Courier New</option>
            <option value="Monaco">Monaco</option>
            <option value="Consolas">Consolas</option>
            <option value="monospace">System Monospace</option>
          </select>
        </div>
        <div class="setting-group">
          <label>Size: <span id="font-size-value">14</span>px</label>
          <input type="range" id="font-size" min="10" max="24" value="14">
        </div>
        <div class="setting-group">
          <label>Theme</label>
          <select id="theme">
            <option value="vscode">VSCode (follow editor)</option>
            <option value="github-dark">GitHub Dark</option>
            <option value="dracula">Dracula</option>
            <option value="monokai">Monokai</option>
            <option value="solarized-dark">Solarized Dark</option>
            <option value="nord">Nord</option>
          </select>
        </div>
        <div class="setting-group">
          <label>Hue: <span id="hue-value">0</span>&#xb0;</label>
          <input type="range" id="color-hue" min="0" max="360" value="0">
        </div>
        <div class="setting-group">
          <label>Brightness: <span id="brightness-value">100</span>%</label>
          <input type="range" id="brightness" min="50" max="150" value="100">
        </div>
        <div class="setting-group">
          <label>Opacity: <span id="opacity-value">100</span>%</label>
          <input type="range" id="bg-opacity" min="50" max="100" value="100">
        </div>
        <div class="setting-group">
          <label>Saturation: <span id="saturation-value">100</span>%</label>
          <input type="range" id="saturation" min="0" max="200" value="100">
        </div>
        <div class="setting-group">
          <label>Panel contrast: <span id="contrast-value">0</span></label>
          <input type="range" id="panel-contrast" min="-50" max="50" value="0">
        </div>
        <div class="setting-group">
          <label><input type="checkbox" id="show-input-box"> Bottom input box</label>
        </div>
        <div class="setting-group">
          <label><input type="checkbox" id="never-collapse-sidebar"> Never collapse tab sidebar</label>
        </div>
        <div class="setting-group">
          <label><input type="checkbox" id="ctrl-v-paste"> Use Ctrl+V to paste</label>
        </div>
      </div>
    </div>

    <!-- Alias panel -->
    <div class="alias-panel" id="alias-panel" style="display:none;">
      <div class="alias-header">
        <h3>Aliases</h3>
        <button class="close-panel" id="close-aliases">&#x2715;</button>
      </div>
      <div class="alias-content">
        <div id="alias-list"></div>
        <button class="add-alias-btn" id="add-alias">+ Add Alias</button>
        <div class="alias-actions">
          <button class="settings-apply" id="save-aliases">Save Aliases</button>
        </div>
      </div>
    </div>

  </div><!-- end main-content -->

  <!-- Bottom input box -->
  <div class="input-box-container" id="input-box-container" style="display:none;">
    <input type="text" id="bottom-input" class="bottom-input" placeholder="Type to send to terminal...">
  </div>

</div><!-- end terminal-container -->

<!-- Main submenu (⋯ button) -->
<div class="dropdown-menu" id="main-menu" style="display:none;">
  <div class="menu-item" data-action="control-aliases">Aliases</div>
  <div class="menu-item" data-action="settings">Settings</div>
  <div class="menu-item" data-action="create-history-file">Create history file</div>
  <div class="menu-item" data-action="collapse-top-bar">Collapse tab sidebar</div>
</div>

<!-- Password dialog -->
<div class="modal-overlay" id="password-overlay" style="display:none;">
  <div class="modal-dialog">
    <h3>Quick Password</h3>
    <p>Saved for quick sudo access</p>
    <input type="password" id="password-input" placeholder="Password">
    <div class="modal-actions">
      <button class="modal-btn" id="save-password">Save</button>
      <button class="modal-btn secondary" id="cancel-password">Cancel</button>
    </div>
  </div>
</div>

<!-- Debug overlay -->
<div id="debug-overlay">Connecting ws://127.0.0.1:${wsPort}...</div>

<script nonce="${nonce}">
  window.ELVE_WS_PORT = ${wsPort};
  window.ELVE_INITIAL_CWD = ${JSON.stringify(initialCwd)};
</script>
<script nonce="${nonce}" src="${uri('xterm.js')}"></script>
<script nonce="${nonce}" src="${uri('xterm-addon-fit.js')}"></script>
<script nonce="${nonce}" src="${uri('xterm-addon-web-links.js')}"></script>
<script nonce="${nonce}" src="${uri('terminal.js')}"></script>
</body>
</html>`;
  }
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
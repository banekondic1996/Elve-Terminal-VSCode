"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const terminalServer_1 = require("./terminalServer");
let terminalServer = null;
// Keep a reference so commands can post messages into the webview
let webviewView = null;
function postCmd(cmd) {
    webviewView?.webview.postMessage({ type: 'hostCommand', cmd });
}
async function activate(context) {
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '$(sync~spin) Elve: starting...';
    statusBar.show();
    context.subscriptions.push(statusBar);
    terminalServer = new terminalServer_1.TerminalServer();
    await terminalServer.start();
    statusBar.text = `$(terminal) Elve: ws:${terminalServer.port}`;
    statusBar.tooltip = `Elve Terminal WebSocket on 127.0.0.1:${terminalServer.port}`;
    const provider = new ElveTerminalPanelProvider(context, terminalServer);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(ElveTerminalPanelProvider.viewType, provider, { webviewOptions: { retainContextWhenHidden: true } }));
    // ── Register all panel-button commands ──────────────────────────────────
    const cmds = [
        ['elveTerminal.openPanel', 'openPanel'],
        ['elveTerminal.collapseBar', 'collapseBar'],
        ['elveTerminal.password', 'password'],
        ['elveTerminal.clear', 'clear'],
        ['elveTerminal.clearLine', 'clearLine'],
        ['elveTerminal.kill', 'kill'],
        ['elveTerminal.toggleHistory', 'toggleHistory'],
        ['elveTerminal.menu', 'menu'],
    ];
    for (const [id, cmd] of cmds) {
        context.subscriptions.push(vscode.commands.registerCommand(id, () => {
            if (cmd === 'openPanel') {
                vscode.commands.executeCommand(`${ElveTerminalPanelProvider.viewType}.focus`);
            }
            else {
                postCmd(cmd);
            }
        }));
    }
    context.subscriptions.push({ dispose: () => terminalServer?.stop() });
}
function deactivate() {
    terminalServer?.stop();
}
class ElveTerminalPanelProvider {
    constructor(ctx, server) {
        this.ctx = ctx;
        this.server = server;
    }
    resolveWebviewView(view, _resolveContext, _token) {
        webviewView = view;
        const mediaUri = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [mediaUri]
        };
        view.webview.html = this.buildHtml(view.webview, mediaUri);
    }
    buildHtml(webview, mediaUri) {
        const uri = (file) => webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, file));
        const wsPort = this.server.port;
        const nonce = getNonce();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const initialCwd = workspaceFolders?.length
            ? workspaceFolders[0].uri.fsPath
            : (process.env.HOME || process.env.USERPROFILE || '/');
        return /* html */ `<!DOCTYPE html>
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

  <!-- Collapsible tab sidebar (left) + terminal area -->
  <div class="main-content">

    <!-- Left tab sidebar — icon rail always visible, full list on hover -->
    <div class="tab-sidebar" id="tab-sidebar">
      <div class="tab-sidebar-inner" id="tab-sidebar-inner">
        <div class="tab-list" id="tabs-container"></div>
      </div>
    </div>

    <!-- Terminal -->
    <div class="terminal-area" id="terminal-area"></div>

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
          <label><input type="checkbox" id="beep-on-idle"> Beep on idle</label>
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

<!-- Context menus -->
<div class="context-menu" id="context-menu" style="display:none;">
  <div class="context-item" data-action="copy">Copy</div>
  <div class="context-item" data-action="paste">Paste</div>
  <div class="context-divider"></div>
  <div class="context-item" data-action="split-horizontal">Split Horizontal</div>
  <div class="context-item" data-action="split-vertical">Split Vertical</div>
  <div class="context-divider"></div>
  <div class="context-item" data-action="pacman">Install with pacman</div>
  <div class="context-item" data-action="yay">Install with yay</div>
  <div class="context-item" data-action="apt">Install with apt-get</div>
  <div class="context-item" data-action="dnf">Install with dnf</div>
  <div class="context-divider"></div>
  <div class="context-item" data-action="search">Web Search</div>
</div>

<div class="context-menu" id="history-context-menu" style="display:none;">
  <div class="context-item" data-action="execute">Execute</div>
  <div class="context-item" data-action="copy-to-input">Copy to input</div>
  <div class="context-divider"></div>
  <div class="context-item" data-action="copy">Copy</div>
</div>

<!-- Submenu (replaces old dropdown-menu — triggered by hostCommand:menu) -->
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
ElveTerminalPanelProvider.viewType = 'elveTerminal.panel';
function getNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
//# sourceMappingURL=extension.js.map
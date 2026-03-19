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
exports.TerminalServer = void 0;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const net = __importStar(require("net"));
const child_process_1 = require("child_process");
let pty;
try {
    pty = require('node-pty');
}
catch (e) {
    console.error('node-pty load failed:', e);
}
let WS;
try {
    WS = require('ws');
}
catch (e) {
    console.error('ws load failed:', e);
}
// ── Bashrc snippet Elve injects (via sudo) ────────────────────────────────────
const ELVE_MARKER = '# elve-history-hook';
const ELVE_SNIPPET = `
${ELVE_MARKER}
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
`;
/**
 * Ensures the Elve history hook exists in /etc/profile.d/elve-history.sh.
 * Uses `sudo tee -a` so it works without the extension process being root.
 * Silent if already present or if passwordless sudo is not available.
 */
function ensureBashrcHook() {
    const profileScript = '/etc/profile.d/elve-history.sh';
    try {
        if (fs.existsSync(profileScript)) {
            const content = fs.readFileSync(profileScript, 'utf8');
            if (content.includes(ELVE_MARKER))
                return; // already installed
        }
        // Write via passwordless sudo
        (0, child_process_1.execSync)(`printf '%s' ${JSON.stringify(ELVE_SNIPPET)} | sudo tee -a ${profileScript} > /dev/null`, { timeout: 5000, stdio: ['ignore', 'ignore', 'ignore'] });
        console.log(`[Elve] History hook written to ${profileScript}`);
    }
    catch (e) {
        // sudo not available or denied — silently skip
        console.warn('[Elve] Could not write history hook (needs passwordless sudo):', e.message);
    }
}
class TerminalServer {
    constructor() {
        this.port = 0;
        this.wss = null;
        this.sessions = new Map();
        /** Tracks last-seen byte size of ~/.bash_history per session id */
        this.bashHistorySize = new Map();
    }
    async start() {
        ensureBashrcHook();
        this.port = await this.freePort(37420);
        await new Promise((resolve, reject) => {
            const Server = WS.WebSocketServer || WS.Server;
            this.wss = new Server({ host: '127.0.0.1', port: this.port });
            this.wss.once('listening', () => {
                console.log(`[Elve] WS server ready on port ${this.port}`);
                resolve();
            });
            this.wss.once('error', reject);
            this.wss.on('connection', (ws) => this.onClient(ws));
        });
    }
    stop() {
        this.sessions.forEach(s => { try {
            s.ptyProcess.kill();
        }
        catch (e) { } });
        this.sessions.clear();
        try {
            this.wss?.close();
        }
        catch (e) { }
    }
    onClient(ws) {
        ws.on('message', (raw) => {
            try {
                this.handle(ws, JSON.parse(raw.toString()));
            }
            catch (e) {
                console.error('[Elve] bad message', e);
            }
        });
        ws.on('close', () => { });
        ws.on('error', (e) => console.error('[Elve] ws client error', e));
    }
    handle(ws, msg) {
        switch (msg.type) {
            case 'create':
                this.create(ws, msg.id, msg.cwd);
                break;
            case 'input':
                this.sessions.get(msg.id)?.ptyProcess.write(msg.data);
                break;
            case 'resize':
                this.resize(msg.id, msg.cols, msg.rows);
                break;
            case 'kill':
                this.kill(msg.id);
                break;
            case 'getCwd':
                this.sendCwd(ws, msg.id);
                break;
            case 'getHistory':
                this.sendHistory(ws, msg.cwd);
                break;
            // 'addHistory' intentionally absent — we never write history ourselves
            case 'createHistoryFile':
                this.createHistoryFile(ws, msg.cwd);
                break;
            case 'getBashrcAliases':
                this.sendBashrcAliases(ws);
                break;
        }
    }
    create(ws, id, cwd) {
        if (!pty) {
            this.send(ws, { type: 'error', id, message: 'node-pty not available — run npm install' });
            return;
        }
        const resolvedCwd = (cwd && fs.existsSync(cwd)) ? cwd : os.homedir();
        const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
        let proc;
        try {
            proc = pty.spawn(shell, [], {
                name: 'xterm-256color',
                cols: 80, rows: 24,
                cwd: resolvedCwd,
                env: { ...process.env }
            });
        }
        catch (e) {
            this.send(ws, { type: 'error', id, message: String(e.message || e) });
            return;
        }
        const session = { id, ptyProcess: proc, cwd: resolvedCwd };
        this.sessions.set(id, session);
        proc.onData((data) => this.send(ws, { type: 'output', id, data }));
        proc.onExit(() => {
            this.sessions.delete(id);
            this.bashHistorySize.delete(id);
            this.send(ws, { type: 'exit', id });
        });
        this.send(ws, { type: 'created', id, cwd: resolvedCwd });
        // Kick off 20-second polling for ~/.bash_history changes
        this.startBashHistoryPoll(ws, id);
    }
    /**
     * Poll ~/.bash_history every 20 s.
     * Only re-sends history to the client when the file byte-size has changed,
     * which means a command was added from any terminal (including external ones).
     * Does nothing when the current cwd has a local .history file (the shell
     * hook handles that file directly; the cwd-change polling in the client
     * already triggers getHistory on directory change).
     */
    startBashHistoryPoll(ws, id) {
        const bashHistFile = path.join(os.homedir(), '.bash_history');
        const poll = () => {
            if (ws.readyState !== 1 || !this.sessions.has(id))
                return; // session gone
            const s = this.sessions.get(id);
            const { local } = this.historyFilePath(s.cwd);
            if (!local) {
                // Using global ~/.bash_history — detect changes
                try {
                    const stat = fs.statSync(bashHistFile);
                    const prev = this.bashHistorySize.get(id) ?? -1;
                    if (stat.size !== prev) {
                        this.bashHistorySize.set(id, stat.size);
                        this.sendHistory(ws, s.cwd);
                    }
                }
                catch (e) { /* file might not exist yet */ }
            }
            // If local .history: no polling needed here; cwd-change events cover it.
            setTimeout(poll, 20000);
        };
        setTimeout(poll, 20000); // first check after 20 s
    }
    resize(id, cols, rows) {
        const s = this.sessions.get(id);
        if (s && cols > 0 && rows > 0) {
            try {
                s.ptyProcess.resize(cols, rows);
            }
            catch (e) { }
        }
    }
    kill(id) {
        const s = this.sessions.get(id);
        if (s) {
            try {
                s.ptyProcess.kill();
            }
            catch (e) { }
            this.sessions.delete(id);
        }
        this.bashHistorySize.delete(id);
    }
    sendCwd(ws, id) {
        const s = this.sessions.get(id);
        if (!s)
            return;
        let cwd = s.cwd;
        try {
            if (process.platform === 'linux') {
                const link = `/proc/${s.ptyProcess.pid}/cwd`;
                if (fs.existsSync(link)) {
                    cwd = fs.readlinkSync(link);
                    s.cwd = cwd;
                }
            }
        }
        catch (e) { }
        this.send(ws, { type: 'cwd', id, cwd });
    }
    sendBashrcAliases(ws) {
        const aliases = [];
        const rcFiles = [
            path.join(os.homedir(), '.bashrc'),
            path.join(os.homedir(), '.bash_aliases'),
            path.join(os.homedir(), '.zshrc'),
        ];
        const aliasRe = /^\s*alias\s+([^=]+)=['"]?(.+?)['"]?\s*$/;
        for (const file of rcFiles) {
            try {
                if (!fs.existsSync(file))
                    continue;
                const lines = fs.readFileSync(file, 'utf8').split('\n');
                for (const line of lines) {
                    const m = line.match(aliasRe);
                    if (m) {
                        const name = m[1].trim();
                        let cmd = m[2].trim().replace(/^['"]|['"]$/g, '');
                        if (name && cmd)
                            aliases.push({ name, command: cmd });
                    }
                }
            }
            catch (e) { }
        }
        this.send(ws, { type: 'bashrcAliases', aliases });
    }
    /**
     * Priority:
     *   1. .history in cwd  — local project history written by the shell hook
     *   2. ~/.bash_history  — global bash history, read-only from our side
     */
    historyFilePath(cwd) {
        const localFile = path.join(cwd || os.homedir(), '.history');
        if (cwd && fs.existsSync(localFile))
            return { file: localFile, local: true };
        return { file: path.join(os.homedir(), '.bash_history'), local: false };
    }
    sendHistory(ws, cwd) {
        const { file } = this.historyFilePath(cwd);
        let commands = [];
        try {
            if (fs.existsSync(file)) {
                const all = fs.readFileSync(file, 'utf8')
                    .split('\n')
                    .map(l => l.trim())
                    // bash_history may have timestamp lines like "#1700000000" — skip them
                    .filter(l => Boolean(l) && !l.startsWith('#'));
                // Deduplicate: keep only the LAST occurrence of each command (most-recent wins).
                // Walk backwards, collect first-seen entries → result is newest-first.
                const seen = new Set();
                const deduped = [];
                for (let i = all.length - 1; i >= 0; i--) {
                    if (!seen.has(all[i])) {
                        seen.add(all[i]);
                        deduped.push(all[i]);
                    }
                }
                commands = deduped.slice(0, 60);
            }
        }
        catch (e) { }
        this.send(ws, { type: 'history', commands });
    }
    // addToHistory removed — Elve no longer writes history files.
    createHistoryFile(ws, cwd) {
        const targetDir = (cwd && fs.existsSync(cwd)) ? cwd : os.homedir();
        const histFile = path.join(targetDir, '.history');
        try {
            if (!fs.existsSync(histFile)) {
                fs.writeFileSync(histFile, '', 'utf8');
                this.send(ws, { type: 'historyFileCreated', cwd: targetDir, path: histFile });
            }
            else {
                this.send(ws, { type: 'historyFileCreated', cwd: targetDir, path: histFile, existed: true });
            }
        }
        catch (e) {
            this.send(ws, { type: 'error', message: 'Could not create .history: ' + String(e.message || e) });
        }
        this.sendHistory(ws, cwd);
    }
    send(ws, msg) {
        try {
            if (ws.readyState === 1)
                ws.send(JSON.stringify(msg));
        }
        catch (e) { }
    }
    freePort(start) {
        return new Promise(resolve => {
            const s = net.createServer();
            s.listen(start, '127.0.0.1', () => {
                const port = s.address().port;
                s.close(() => resolve(port));
            });
            s.on('error', () => resolve(this.freePort(start + 1)));
        });
    }
}
exports.TerminalServer = TerminalServer;
//# sourceMappingURL=terminalServer.js.map
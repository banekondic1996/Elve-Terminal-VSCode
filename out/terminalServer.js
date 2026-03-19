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
class TerminalServer {
    constructor() {
        this.port = 0;
        this.wss = null;
        this.sessions = new Map();
    }
    async start() {
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
            case 'addHistory':
                this.addToHistory(ws, msg.cwd, msg.command);
                break;
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
        const histFile = path.join(resolvedCwd, '.history');
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
        proc.onExit(() => { this.sessions.delete(id); this.send(ws, { type: 'exit', id }); });
        this.send(ws, { type: 'created', id, cwd: resolvedCwd });
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
                        // Strip surrounding quotes from command
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
    // Priority: .history in cwd (if it exists), else ~/.elve_history (global fallback)
    historyFilePath(cwd) {
        const localFile = path.join(cwd || os.homedir(), '.history');
        if (cwd && fs.existsSync(localFile))
            return { file: localFile, local: true };
        return { file: path.join(os.homedir(), '.elve_history'), local: false };
    }
    sendHistory(ws, cwd) {
        const { file } = this.historyFilePath(cwd);
        let commands = [];
        try {
            if (fs.existsSync(file)) {
                commands = fs.readFileSync(file, 'utf8').trim().split('\n')
                    .map(l => l.trim()).filter(Boolean).reverse().slice(0, 60);
            }
        }
        catch (e) { }
        this.send(ws, { type: 'history', commands });
    }
    addToHistory(ws, cwd, command) {
        if (!command || !command.trim())
            return;
        const cmd = command.trim();
        const { file } = this.historyFilePath(cwd);
        try {
            let lines = [];
            if (fs.existsSync(file)) {
                lines = fs.readFileSync(file, 'utf8').trim().split('\n')
                    .map(l => l.trim()).filter(Boolean);
            }
            // Deduplicate: remove previous occurrence of same command
            lines = lines.filter(l => l !== cmd);
            lines.push(cmd);
            // Keep last 60 unique commands
            if (lines.length > 60)
                lines = lines.slice(lines.length - 60);
            fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
        }
        catch (e) {
            console.error('[Elve] addToHistory error', e);
        }
        // Send updated history back
        this.sendHistory(ws, cwd);
    }
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
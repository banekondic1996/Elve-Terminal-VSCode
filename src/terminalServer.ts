import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { execSync } from 'child_process';

let pty: any;
try { pty = require('node-pty'); } catch(e) { console.error('node-pty load failed:', e); }

let WS: any;
try { WS = require('ws'); } catch(e) { console.error('ws load failed:', e); }

interface Session {
  id: string;
  ptyProcess: any;
  cwd: string;
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
function ensureBashrcHook(): void {
  const profileScript = '/etc/profile.d/elve-history.sh';
  try {
    if (fs.existsSync(profileScript)) {
      const content = fs.readFileSync(profileScript, 'utf8');
      if (content.includes(ELVE_MARKER)) return; // already installed
    }
    // Write via passwordless sudo
    execSync(
      `printf '%s' ${JSON.stringify(ELVE_SNIPPET)} | sudo tee -a ${profileScript} > /dev/null`,
      { timeout: 5000, stdio: ['ignore', 'ignore', 'ignore'] }
    );
    console.log(`[Elve] History hook written to ${profileScript}`);
  } catch(e) {
    // sudo not available or denied — silently skip
    console.warn('[Elve] Could not write history hook (needs passwordless sudo):', (e as any).message);
  }
}

export class TerminalServer {
  public port: number = 0;
  private wss: any = null;
  private sessions = new Map<string, Session>();
  /** Tracks last-seen byte size of ~/.bash_history per session id */
  private bashHistorySize = new Map<string, number>();

  async start(): Promise<void> {
    ensureBashrcHook();

    this.port = await this.freePort(37420);

    await new Promise<void>((resolve, reject) => {
      const Server = WS.WebSocketServer || WS.Server;
      this.wss = new Server({ host: '127.0.0.1', port: this.port });
      this.wss.once('listening', () => {
        console.log(`[Elve] WS server ready on port ${this.port}`);
        resolve();
      });
      this.wss.once('error', reject);
      this.wss.on('connection', (ws: any) => this.onClient(ws));
    });
  }

  stop() {
    this.sessions.forEach(s => { try { s.ptyProcess.kill(); } catch(e){} });
    this.sessions.clear();
    try { this.wss?.close(); } catch(e){}
  }

  private onClient(ws: any) {
    ws.on('message', (raw: Buffer) => {
      try { this.handle(ws, JSON.parse(raw.toString())); }
      catch(e) { console.error('[Elve] bad message', e); }
    });
    ws.on('close', () => {});
    ws.on('error', (e: Error) => console.error('[Elve] ws client error', e));
  }

  private handle(ws: any, msg: any) {
    switch(msg.type) {
      case 'create':            this.create(ws, msg.id, msg.cwd); break;
      case 'input':             this.sessions.get(msg.id)?.ptyProcess.write(msg.data); break;
      case 'resize':            this.resize(msg.id, msg.cols, msg.rows); break;
      case 'kill':              this.kill(msg.id); break;
      case 'getCwd':            this.sendCwd(ws, msg.id); break;
      case 'getHistory':        this.sendHistory(ws, msg.cwd); break;
      // 'addHistory' intentionally absent — we never write history ourselves
      case 'deleteHistory':     this.deleteFromHistory(ws, msg.cwd, msg.command); break;
      case 'createHistoryFile': this.createHistoryFile(ws, msg.cwd); break;
      case 'getBashrcAliases':  this.sendBashrcAliases(ws); break;
    }
  }

  private create(ws: any, id: string, cwd?: string) {
    if (!pty) { this.send(ws, { type:'error', id, message:'node-pty not available — run npm install' }); return; }

    const resolvedCwd = (cwd && fs.existsSync(cwd)) ? cwd : os.homedir();
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');

    let proc: any;
    try {
      proc = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80, rows: 24,
        cwd: resolvedCwd,
        env: { ...process.env }
      });
    } catch(e: any) {
      this.send(ws, { type:'error', id, message: String(e.message || e) });
      return;
    }

    const session: Session = { id, ptyProcess: proc, cwd: resolvedCwd };
    this.sessions.set(id, session);

    proc.onData((data: string) => this.send(ws, { type:'output', id, data }));
    proc.onExit(() => {
      this.sessions.delete(id);
      this.bashHistorySize.delete(id);
      this.send(ws, { type:'exit', id });
    });

    this.send(ws, { type:'created', id, cwd: resolvedCwd });

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
  private startBashHistoryPoll(ws: any, id: string) {
    const bashHistFile = path.join(os.homedir(), '.bash_history');

    const poll = () => {
      if (ws.readyState !== 1 || !this.sessions.has(id)) return; // session gone

      const s = this.sessions.get(id)!;
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
        } catch(e) { /* file might not exist yet */ }
      }
      // If local .history: no polling needed here; cwd-change events cover it.

      setTimeout(poll, 20_000);
    };

    setTimeout(poll, 20_000); // first check after 20 s
  }

  private resize(id: string, cols: number, rows: number) {
    const s = this.sessions.get(id);
    if (s && cols > 0 && rows > 0) { try { s.ptyProcess.resize(cols, rows); } catch(e){} }
  }

  private kill(id: string) {
    const s = this.sessions.get(id);
    if (s) { try { s.ptyProcess.kill(); } catch(e){} this.sessions.delete(id); }
    this.bashHistorySize.delete(id);
  }

  private sendCwd(ws: any, id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    let cwd = s.cwd;
    try {
      if (process.platform === 'linux') {
        const link = `/proc/${s.ptyProcess.pid}/cwd`;
        if (fs.existsSync(link)) { cwd = fs.readlinkSync(link); s.cwd = cwd; }
      }
    } catch(e){}
    this.send(ws, { type:'cwd', id, cwd });
  }

  private sendBashrcAliases(ws: any) {
    const aliases: { name: string; command: string }[] = [];
    const rcFiles = [
      path.join(os.homedir(), '.bashrc'),
      path.join(os.homedir(), '.bash_aliases'),
      path.join(os.homedir(), '.zshrc'),
    ];
    const aliasRe = /^\s*alias\s+([^=]+)=['"]?(.+?)['"]?\s*$/;
    for (const file of rcFiles) {
      try {
        if (!fs.existsSync(file)) continue;
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        for (const line of lines) {
          const m = line.match(aliasRe);
          if (m) {
            const name = m[1].trim();
            let cmd = m[2].trim().replace(/^['"]|['"]$/g, '');
            if (name && cmd) aliases.push({ name, command: cmd });
          }
        }
      } catch(e){}
    }
    this.send(ws, { type: 'bashrcAliases', aliases });
  }

  /**
   * Priority:
   *   1. .history in cwd  — local project history written by the shell hook
   *   2. ~/.bash_history  — global bash history, read-only from our side
   */
  private historyFilePath(cwd: string): { file: string; local: boolean } {
    const localFile = path.join(cwd || os.homedir(), '.history');
    if (cwd && fs.existsSync(localFile)) return { file: localFile, local: true };
    return { file: path.join(os.homedir(), '.bash_history'), local: false };
  }

  private sendHistory(ws: any, cwd: string) {
    const { file } = this.historyFilePath(cwd);
    let commands: string[] = [];
    try {
      if (fs.existsSync(file)) {
        const all = fs.readFileSync(file, 'utf8')
          .split('\n')
          .map(l => l.trim())
          // bash_history may have timestamp lines like "#1700000000" — skip them
          .filter(l => Boolean(l) && !l.startsWith('#'));
        // Deduplicate: keep only the LAST occurrence of each command (most-recent wins).
        // Walk backwards, collect first-seen entries → result is newest-first.
        const seen = new Set<string>();
        const deduped: string[] = [];
        for (let i = all.length - 1; i >= 0; i--) {
          if (!seen.has(all[i])) { seen.add(all[i]); deduped.push(all[i]); }
        }
        commands = deduped.slice(0, 60);
      }
    } catch(e){}
    this.send(ws, { type: 'history', commands });
  }

  /**
   * Remove ALL occurrences of `command` from the history file (local .history
   * or ~/.bash_history), then send the refreshed history back to the client.
   * We rewrite the file directly — `history -d` only affects the running
   * shell's in-memory list and cannot be used reliably from the extension host.
   */
  private deleteFromHistory(ws: any, cwd: string, command: string) {
    if (!command || !command.trim()) return;
    const cmd = command.trim();
    const { file } = this.historyFilePath(cwd);
    try {
      if (fs.existsSync(file)) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        // Keep all lines that are NOT this command (handles duplicates + timestamp lines)
        const filtered = lines.filter(l => l.trim() !== cmd);
        fs.writeFileSync(file, filtered.join('\n'), 'utf8');
      }
    } catch(e) {
      console.error('[Elve] deleteFromHistory error', e);
    }
    // Send refreshed history so the panel updates
    this.sendHistory(ws, cwd);
  }

  // addToHistory removed — Elve no longer writes history files.

  private createHistoryFile(ws: any, cwd: string) {
    const targetDir = (cwd && fs.existsSync(cwd)) ? cwd : os.homedir();
    const histFile = path.join(targetDir, '.history');
    try {
      if (!fs.existsSync(histFile)) {
        fs.writeFileSync(histFile, '', 'utf8');
        this.send(ws, { type: 'historyFileCreated', cwd: targetDir, path: histFile });
      } else {
        this.send(ws, { type: 'historyFileCreated', cwd: targetDir, path: histFile, existed: true });
      }
    } catch(e: any) {
      this.send(ws, { type: 'error', message: 'Could not create .history: ' + String(e.message||e) });
    }
    this.sendHistory(ws, cwd);
  }

  private send(ws: any, msg: object) {
    try { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); } catch(e){}
  }

  private freePort(start: number): Promise<number> {
    return new Promise(resolve => {
      const s = net.createServer();
      s.listen(start, '127.0.0.1', () => {
        const port = (s.address() as net.AddressInfo).port;
        s.close(() => resolve(port));
      });
      s.on('error', () => resolve(this.freePort(start + 1)));
    });
  }
}
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';

let pty: any;
try { pty = require('node-pty'); } catch(e) { console.error('node-pty load failed:', e); }

let WS: any;
try { WS = require('ws'); } catch(e) { console.error('ws load failed:', e); }

interface Session {
  id: string;
  ptyProcess: any;
  cwd: string;
}

export class TerminalServer {
  public port: number = 0;
  private wss: any = null;
  private sessions = new Map<string, Session>();

  async start(): Promise<void> {
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
      case 'addHistory':        this.addToHistory(ws, msg.cwd, msg.command); break;
      case 'createHistoryFile': this.createHistoryFile(ws, msg.cwd); break;
      case 'getBashrcAliases':  this.sendBashrcAliases(ws); break;
    }
  }

  private create(ws: any, id: string, cwd?: string) {
    if (!pty) { this.send(ws, { type:'error', id, message:'node-pty not available — run npm install' }); return; }

    const resolvedCwd = (cwd && fs.existsSync(cwd)) ? cwd : os.homedir();
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
    const histFile = path.join(resolvedCwd, '.history');

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
    proc.onExit(() => { this.sessions.delete(id); this.send(ws, { type:'exit', id }); });

    this.send(ws, { type:'created', id, cwd: resolvedCwd });
  }

  private resize(id: string, cols: number, rows: number) {
    const s = this.sessions.get(id);
    if (s && cols > 0 && rows > 0) { try { s.ptyProcess.resize(cols, rows); } catch(e){} }
  }

  private kill(id: string) {
    const s = this.sessions.get(id);
    if (s) { try { s.ptyProcess.kill(); } catch(e){} this.sessions.delete(id); }
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
            // Strip surrounding quotes from command
            let cmd = m[2].trim().replace(/^['"]|['"]$/g, '');
            if (name && cmd) aliases.push({ name, command: cmd });
          }
        }
      } catch(e){}
    }
    this.send(ws, { type: 'bashrcAliases', aliases });
  }

  // Priority: .history in cwd (if it exists), else ~/.elve_history (global fallback)
  private historyFilePath(cwd: string): { file: string; local: boolean } {
    const localFile = path.join(cwd || os.homedir(), '.history');
    if (cwd && fs.existsSync(localFile)) return { file: localFile, local: true };
    return { file: path.join(os.homedir(), '.elve_history'), local: false };
  }

  private sendHistory(ws: any, cwd: string) {
    const { file } = this.historyFilePath(cwd);
    let commands: string[] = [];
    try {
      if (fs.existsSync(file)) {
        commands = fs.readFileSync(file, 'utf8').trim().split('\n')
          .map(l => l.trim()).filter(Boolean).reverse().slice(0, 60);
      }
    } catch(e){}
    this.send(ws, { type: 'history', commands });
  }

  private addToHistory(ws: any, cwd: string, command: string) {
    if (!command || !command.trim()) return;
    const cmd = command.trim();
    const { file } = this.historyFilePath(cwd);
    try {
      let lines: string[] = [];
      if (fs.existsSync(file)) {
        lines = fs.readFileSync(file, 'utf8').trim().split('\n')
          .map(l => l.trim()).filter(Boolean);
      }
      // Deduplicate: remove previous occurrence of same command
      lines = lines.filter(l => l !== cmd);
      lines.push(cmd);
      // Keep last 60 unique commands
      if (lines.length > 60) lines = lines.slice(lines.length - 60);
      fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
    } catch(e){ console.error('[Elve] addToHistory error', e); }
    // Send updated history back
    this.sendHistory(ws, cwd);
  }

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

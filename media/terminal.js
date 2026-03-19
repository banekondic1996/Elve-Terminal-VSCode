/* global Terminal, FitAddon, WebLinksAddon */
(function () {
  'use strict';

  window.vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : null;

  const WS_PORT = window.ELVE_WS_PORT;
  const INITIAL_CWD = window.ELVE_INITIAL_CWD || (navigator.platform.includes('Win') ? 'C:\\' : '/');

  // ── Debug overlay ──────────────────────────────────────────────────────────
  const _dbgEl = document.getElementById('debug-overlay');
  if (_dbgEl) { _dbgEl.style.pointerEvents = 'none'; _dbgEl.style.display = 'none'; }

  function dbg(msg, color) {
    const el = document.getElementById('debug-overlay');
    if (!el) return;
    el.style.display = 'block';
    el.style.color = color || '#58a6ff';
    el.textContent = msg;
    if (color === 'ok') {
      el.style.color = '#3fb950';
      setTimeout(() => { el.style.display = 'none'; }, 3000);
    }
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────
  class Conn {
    constructor() {
      this.listeners = {};
      this.queue = [];
      this.ws = null;
      this.open = false;
      this._connect();
    }
    _connect() {
      dbg('Connecting ws://127.0.0.1:' + WS_PORT + '...');
      this.ws = new WebSocket('ws://127.0.0.1:' + WS_PORT);
      this.ws.onopen = () => {
        this.open = true;
        dbg('Connected', 'ok');
        this.queue.forEach(m => this.ws.send(m));
        this.queue = [];
      };
      this.ws.onclose = () => {
        this.open = false;
        dbg('Reconnecting...');
        setTimeout(() => this._connect(), 1500);
      };
      this.ws.onerror = () => dbg('WS error — port ' + WS_PORT, '#f85149');
      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          (this.listeners[msg.type] || []).forEach(fn => fn(msg));
        } catch(ex) { console.error('[Elve] parse error', ex); }
      };
    }
    send(obj) {
      const s = JSON.stringify(obj);
      if (this.open) this.ws.send(s); else this.queue.push(s);
    }
    on(type, fn) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(fn);
    }
  }

  // ── Themes ─────────────────────────────────────────────────────────────────
  function getVscodeTheme() {
    const s = getComputedStyle(document.body);
    const get = v => s.getPropertyValue(v).trim() || null;
    return {
      background:    get('--vscode-panel-background') || get('--vscode-sideBar-background') || get('--vscode-editor-background') || '#1e1e1e',
      foreground:    get('--vscode-terminal-foreground')    || get('--vscode-editor-foreground')   || '#cccccc',
      cursor:        get('--vscode-terminalCursor-foreground') || '#cccccc',
      black:         get('--vscode-terminal-ansiBlack')     || '#000000',
      red:           get('--vscode-terminal-ansiRed')       || '#cd3131',
      green:         get('--vscode-terminal-ansiGreen')     || '#0dbc79',
      yellow:        get('--vscode-terminal-ansiYellow')    || '#e5e510',
      blue:          get('--vscode-terminal-ansiBlue')      || '#2472c8',
      magenta:       get('--vscode-terminal-ansiMagenta')   || '#bc3fbc',
      cyan:          get('--vscode-terminal-ansiCyan')      || '#11a8cd',
      white:         get('--vscode-terminal-ansiWhite')     || '#e5e5e5',
      brightBlack:   get('--vscode-terminal-ansiBrightBlack')   || '#666666',
      brightRed:     get('--vscode-terminal-ansiBrightRed')     || '#f14c4c',
      brightGreen:   get('--vscode-terminal-ansiBrightGreen')   || '#23d18b',
      brightYellow:  get('--vscode-terminal-ansiBrightYellow')  || '#f5f543',
      brightBlue:    get('--vscode-terminal-ansiBrightBlue')    || '#3b8eea',
      brightMagenta: get('--vscode-terminal-ansiBrightMagenta') || '#d670d6',
      brightCyan:    get('--vscode-terminal-ansiBrightCyan')    || '#29b8db',
      brightWhite:   get('--vscode-terminal-ansiBrightWhite')   || '#e5e5e5',
    };
  }

  const THEMES = {
    'github-dark':    { background:'#0d1117',foreground:'#c9d1d9',cursor:'#58a6ff',black:'#484f58',red:'#ff7b72',green:'#3fb950',yellow:'#d29922',blue:'#58a6ff',magenta:'#bc8cff',cyan:'#39c5cf',white:'#b1bac4',brightBlack:'#6e7681',brightRed:'#ffa198',brightGreen:'#56d364',brightYellow:'#e3b341',brightBlue:'#79c0ff',brightMagenta:'#d2a8ff',brightCyan:'#56d4dd',brightWhite:'#f0f6fc' },
    'dracula':        { background:'#282a36',foreground:'#f8f8f2',cursor:'#f8f8f2',black:'#21222c',red:'#ff5555',green:'#50fa7b',yellow:'#f1fa8c',blue:'#bd93f9',magenta:'#ff79c6',cyan:'#8be9fd',white:'#f8f8f2',brightBlack:'#6272a4',brightRed:'#ff6e6e',brightGreen:'#69ff94',brightYellow:'#ffffa5',brightBlue:'#d6acff',brightMagenta:'#ff92df',brightCyan:'#a4ffff',brightWhite:'#ffffff' },
    'monokai':        { background:'#272822',foreground:'#f8f8f2',cursor:'#f8f8f0',black:'#272822',red:'#f92672',green:'#a6e22e',yellow:'#f4bf75',blue:'#66d9ef',magenta:'#ae81ff',cyan:'#a1efe4',white:'#f8f8f2',brightBlack:'#75715e',brightRed:'#f92672',brightGreen:'#a6e22e',brightYellow:'#f4bf75',brightBlue:'#66d9ef',brightMagenta:'#ae81ff',brightCyan:'#a1efe4',brightWhite:'#f9f8f5' },
    'solarized-dark': { background:'#002b36',foreground:'#839496',cursor:'#839496',black:'#073642',red:'#dc322f',green:'#859900',yellow:'#b58900',blue:'#268bd2',magenta:'#d33682',cyan:'#2aa198',white:'#eee8d5',brightBlack:'#002b36',brightRed:'#cb4b16',brightGreen:'#586e75',brightYellow:'#657b83',brightBlue:'#839496',brightMagenta:'#6c71c4',brightCyan:'#93a1a1',brightWhite:'#fdf6e3' },
    'nord':           { background:'#2e3440',foreground:'#d8dee9',cursor:'#d8dee9',black:'#3b4252',red:'#bf616a',green:'#a3be8c',yellow:'#ebcb8b',blue:'#81a1c1',magenta:'#b48ead',cyan:'#88c0d0',white:'#e5e9f0',brightBlack:'#4c566a',brightRed:'#bf616a',brightGreen:'#a3be8c',brightYellow:'#ebcb8b',brightBlue:'#81a1c1',brightMagenta:'#b48ead',brightCyan:'#8fbcbb',brightWhite:'#eceff4' },
  };

  // ── Color helpers ──────────────────────────────────────────────────────────
  function adjustColor(hex, hue, brightness, saturation) {
    if (!hex || hex[0] !== '#' || hex.length < 7) return '#000000';
    let r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h, s, l=(max+min)/2;
    if (max===min) { h=s=0; } else {
      const d=max-min; s=l>0.5?d/(2-max-min):d/(max+min);
      if(max===r) h=((g-b)/d+(g<b?6:0))/6;
      else if(max===g) h=((b-r)/d+2)/6;
      else h=((r-g)/d+4)/6;
    }
    h=(h+hue/360)%1;
    s=Math.max(0,Math.min(1,s*(saturation/100)));
    l=Math.max(0,Math.min(1,l*(brightness/100)));
    let r2,g2,b2;
    if(s===0){r2=g2=b2=l;}else{
      const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
      const f=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<0.5)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
      r2=f(p,q,h+1/3);g2=f(p,q,h);b2=f(p,q,h-1/3);
    }
    const hex2=x=>{const v=Math.round(x*255).toString(16);return v.length===1?'0'+v:v;};
    return '#'+hex2(r2)+hex2(g2)+hex2(b2);
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let tabs = [];
  let activeTabId = null;
  let nextTabId = 1;
  let nextSessId = 1;
  let focusedSplit = 0;
  let showHistory = false;
  let commandHistory = [];  // always deduplicated, most-recent first
  let savedPassword = null;
  let selectedText = '';
  let selectedHistCmd = null;
  let sidebarCollapsed = false;
  let currentCwd = INITIAL_CWD;

  const settings = {
    fontFamily: 'JetBrains Mono',
    fontSize: 14,
    theme: 'vscode',
    colorHue: 0,
    brightness: 100,
    bgOpacity: 100,
    saturation: 100,
    showInputBox: false,
    neverCollapseSidebar: false,
    ctrlVPaste: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem('elveSettings') || '{}');
    Object.assign(settings, saved);
  } catch(e){}

  // ── Bell (alert on idle) state ───────────────────────────────────────────
  // bellArmed: user clicked bell once — watching for idle
  // bellFired: alarm went off, showing red for 10s
  let bellArmed  = false;
  let bellFired  = false;
  let bellResetTimer = null;
  let lastOutputTime = Date.now();
  const IDLE_THRESHOLD_MS = 1500; // fire after 1.5s of silence (prompt redraw is fast)

  // AudioContext must be created/resumed inside a user-gesture call stack.
  // We create it once on the first click anywhere in the webview, then reuse it.
  let _audioCtx = null;
  function getAudioCtx() {
    if (!_audioCtx) {
      try { _audioCtx = new AudioContext(); } catch(e) { return null; }
    }
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().catch(() => {});
    }
    return _audioCtx;
  }
  // Prime the AudioContext on first user interaction so it is ready when the bell fires.
  document.addEventListener('click',    () => getAudioCtx(), { once: false, capture: true });
  document.addEventListener('keydown',  () => getAudioCtx(), { once: false, capture: true });
  document.addEventListener('mousedown',() => getAudioCtx(), { once: false, capture: true });

  function updateBellIcon() {
    window.vscode?.postMessage({
      type: 'setContext',
      key: 'elveBellState',
      value: bellFired ? 'fired' : bellArmed ? 'armed' : 'off'
    });
    // postCmd so terminal.js can tell the extension to update the icon label
    // We encode state in the hostCommand reply instead — handled in hostCommand 'bell'
  }

  function armBell() {
    if (bellFired) return; // reset first
    bellArmed = !bellArmed;
    updateBellIcon();
    if (bellArmed) {
      // Notify VS Code (shows info notification)
      window.vscode?.postMessage({ type: 'bellArmed' });
      // Print confirmation in the active terminal
      const tab0 = tabs.find(t => t.id === activeTabId);
      const term0 = (tab0?.splits[focusedSplit]||tab0?.splits[0])?.term || tab0?.term;
      term0?.writeln('\r\n\x1b[32m🔔 Monitoring started — will beep when terminal goes idle.\x1b[0m');
    }
  }

  function onBellFired() {
    bellArmed = false;
    bellFired = true;
    updateBellIcon();
    // Notify VS Code notification
    window.vscode?.postMessage({ type: 'bellFired' });
    // Print in terminal
    const tab0 = tabs.find(t => t.id === activeTabId);
    const term0 = (tab0?.splits[focusedSplit]||tab0?.splits[0])?.term || tab0?.term;
    term0?.writeln('\r\n\x1b[31m🔔 Terminal idle — command finished!\x1b[0m');
    // Play audible beep (two short tones) using the pre-warmed AudioContext
    try {
      const actx = getAudioCtx();
      if (actx) {
        [[880, 0, 0.15], [1100, 0.2, 0.15]].forEach(([freq, start, dur]) => {
          const osc = actx.createOscillator();
          const gain = actx.createGain();
          osc.connect(gain); gain.connect(actx.destination);
          osc.type = 'sine'; osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.4, actx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + start + dur);
          osc.start(actx.currentTime + start);
          osc.stop(actx.currentTime + start + dur + 0.05);
        });
      }
    } catch(e){}
    if (bellResetTimer) clearTimeout(bellResetTimer);
    bellResetTimer = setTimeout(() => {
      bellFired = false;
      updateBellIcon();
    }, 10000);
  }

  const conn = new Conn();

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const tabsContainer  = $('tabs-container');
  const termArea       = $('terminal-area');
  const historySidebar = $('history-sidebar');
  const historyList    = $('history-list');
  const settingsPanel  = $('settings-panel');
  const aliasPanel     = $('alias-panel');
  const mainMenu       = $('main-menu');
  const tabSidebar     = $('tab-sidebar');

  // ── Settings UI ────────────────────────────────────────────────────────────
  function initSettingsUI() {
    const set = (id, v) => { const el=$(id); if(el) el.value=v; };
    const setC= (id, v) => { const el=$(id); if(el) el.checked=v; };
    set('font-family', settings.fontFamily);
    set('font-size', settings.fontSize);
    set('theme', settings.theme);
    set('color-hue', settings.colorHue);
    set('brightness', settings.brightness);
    set('bg-opacity', settings.bgOpacity);
    set('saturation', settings.saturation);
    setC('show-input-box', settings.showInputBox);
    setC('never-collapse-sidebar', settings.neverCollapseSidebar);
    setC('ctrl-v-paste', settings.ctrlVPaste);
    const lbl = (id, v) => { const el=$(id); if(el) el.textContent=v; };
    lbl('font-size-value', settings.fontSize);
    lbl('hue-value', settings.colorHue);
    lbl('brightness-value', settings.brightness);
    lbl('opacity-value', settings.bgOpacity);
    lbl('saturation-value', settings.saturation);
  }

  function saveSettings() {
    try { localStorage.setItem('elveSettings', JSON.stringify(settings)); } catch(e){}
  }

  function applyTheme() {
    const isVscode = settings.theme === 'vscode';
    const base = isVscode ? getVscodeTheme() : (THEMES[settings.theme] || THEMES['github-dark']);
    const bg = adjustColor(base.background, settings.colorHue, settings.brightness, settings.saturation);
    const op = settings.bgOpacity / 100;
    const r=parseInt(bg.slice(1,3),16), g=parseInt(bg.slice(3,5),16), b=parseInt(bg.slice(5,7),16);

    document.documentElement.style.setProperty('--hue', settings.colorHue + 'deg');
    document.documentElement.style.setProperty('--saturation', settings.saturation + '%');
    document.body.style.background = `rgba(${r},${g},${b},${op})`;

    if (isVscode) {
      document.documentElement.style.setProperty('--ui-bg',     'var(--vscode-sideBar-background, #161b22)');
      document.documentElement.style.setProperty('--ui-bg2',    'var(--vscode-panel-background, #0d1117)');
      document.documentElement.style.setProperty('--ui-border', 'var(--vscode-panel-border, #21262d)');
      document.documentElement.style.setProperty('--ui-fg',     'var(--vscode-foreground, #c9d1d9)');
      document.documentElement.style.setProperty('--ui-accent', 'var(--vscode-button-background, #58a6ff)');
    } else {
      document.documentElement.style.setProperty('--ui-bg',     '#161b22');
      document.documentElement.style.setProperty('--ui-bg2',    '#0d1117');
      document.documentElement.style.setProperty('--ui-border', '#21262d');
      document.documentElement.style.setProperty('--ui-fg',     '#c9d1d9');
      document.documentElement.style.setProperty('--ui-accent', '#58a6ff');
    }

    const termTheme = buildTermTheme();
    tabs.forEach(tab => {
      const update = (term, fa) => {
        term.options.fontFamily = '"' + settings.fontFamily + '", "Courier New", monospace';
        term.options.fontSize = settings.fontSize;
        term.options.theme = termTheme;
        setTimeout(() => { try { fa.fit(); } catch(e){} }, 0);
      };
      if (tab.splits.length) tab.splits.forEach(s => update(s.term, s.fa));
      else update(tab.term, tab.fa);
    });
  }

  function buildTermTheme() {
    const base = settings.theme === 'vscode' ? getVscodeTheme() : (THEMES[settings.theme] || THEMES['github-dark']);
    const { colorHue: hue, brightness, saturation } = settings;
    const theme = {};
    Object.keys(base).forEach(k => {
      theme[k] = k === 'background'
        ? adjustColor(base[k], hue, brightness, saturation)
        : adjustColor(base[k], hue, brightness, 100);
    });
    theme.cursorAccent = theme.background;
    theme.selection = '#388bfd40';
    return theme;
  }

  // ── Terminal creation ──────────────────────────────────────────────────────
  function makeTerm(cwd) {
    const term = new Terminal({
      fontFamily: '"' + settings.fontFamily + '", "Courier New", monospace',
      fontSize: settings.fontSize,
      fontWeight: 400,
      fontWeightBold: 600,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      theme: buildTermTheme(),
      allowTransparency: settings.bgOpacity < 100,
      scrollback: 10000,
    });
    const fa = new FitAddon.FitAddon();
    term.loadAddon(fa);
    term.loadAddon(new WebLinksAddon.WebLinksAddon());

    const sid = 'sess' + (nextSessId++);

    term.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown') return true;
      if (e.ctrlKey && !e.shiftKey && e.key === 'v') return false;
      return true;
    });
    conn.send({ type: 'create', id: sid, cwd });

    // No inputBuffer needed — Elve never writes history; the shell hook does.
    const onOutputData = (_raw) => {}; // kept for compat with split-pane wiring

    term.onData(data => {
      conn.send({ type: 'input', id: sid, data });
      // On Enter: refresh history for this split's cwd, but only if it's the focused pane
      if (data === '\r') {
        setTimeout(() => {
          const ownerTab = tabs.find(t => t.sid === sid || t.splits.some(s => s.sid === sid));
          if (!ownerTab || ownerTab.id !== activeTabId) return;
          const ownerSplit = ownerTab.splits.find(s => s.sid === sid);
          const splitIdx = ownerSplit ? ownerTab.splits.indexOf(ownerSplit) : -1;
          // Only refresh if this sid is the focused split (or it's a non-split tab)
          const isFocused = ownerTab.splits.length === 0 || splitIdx === focusedSplit;
          if (!isFocused) return;
          const cwd = ownerSplit ? (ownerSplit.cwd || ownerTab.cwd) : ownerTab.cwd;
          conn.send({ type: 'getHistory', cwd });
        }, 400);
      }
    });
    term.onResize(({ cols, rows }) => conn.send({ type: 'resize', id: sid, cols, rows }));
    return { term, fa, sid, onOutputData };
  }

  // ── Key guard ─────────────────────────────────────────────────────────────
  function attachKeyGuard(el, getTermFn) {
    el.addEventListener('keydown', e => {
      if (!e.ctrlKey) return;
      if (e.shiftKey && e.key === 'C') {
        e.stopPropagation(); e.preventDefault();
        const t = getTermFn();
        if (t) { const sel = t.getSelection(); if (sel) navigator.clipboard.writeText(sel).catch(() => {}); }
        return;
      }
      if (e.shiftKey && e.key === 'V') {
        e.stopPropagation(); e.preventDefault();
        navigator.clipboard.readText().then(txt => {
          const tab = tabs.find(t => t.id === activeTabId);
          const sid = (tab?.splits[focusedSplit]||tab?.splits[0])?.sid || tab?.sid;
          if (txt && sid) conn.send({ type: 'input', id: sid, data: txt });
        }).catch(() => {});
        return;
      }
      if (!e.shiftKey && e.key === 'v') {
        e.stopPropagation(); e.preventDefault();
        if (settings.ctrlVPaste) {
          navigator.clipboard.readText().then(txt => {
            const tab = tabs.find(t => t.id === activeTabId);
            const sid = (tab?.splits[focusedSplit]||tab?.splits[0])?.sid || tab?.sid;
            if (txt && sid) conn.send({ type: 'input', id: sid, data: txt });
          }).catch(() => {});
        }
        return;
      }
    }, true);
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────
  function cwdName(cwd) {
    if (!cwd) return 'bash';
    const parts = cwd.replace(/\\/g, '/').split('/');
    return parts.filter(Boolean).pop() || 'bash';
  }

  // Poll cwd for every active sid in a tab (main + all splits)
  function pollCwdForTab(tab) {
    if (tab.splits.length > 0) {
      tab.splits.forEach(s => conn.send({ type: 'getCwd', id: s.sid }));
    } else {
      conn.send({ type: 'getCwd', id: tab.sid });
    }
  }

  function addTab(cwd) {
    const id = nextTabId++;
    const resolvedCwd = cwd || (tabs.length ? tabs[tabs.length-1].cwd : INITIAL_CWD);
    const { term, fa, sid, onOutputData } = makeTerm(resolvedCwd);
    const tab = {
      id, name: cwdName(resolvedCwd), cwd: resolvedCwd,
      term, fa, sid, onOutputData,
      splits: [], splitDir: 'horizontal',
      el: null, wrapper: null, onResize: null,
      cwdTimer: null,
    };
    tab.cwdTimer = setInterval(() => pollCwdForTab(tab), 2000);
    tabs.push(tab);
    renderTabSidebar();
    switchTab(id);
  }

  function renderTabSidebar() {
    tabsContainer.innerHTML = '';
    tabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = 'tab-item' + (tab.id === activeTabId ? ' active' : '');
      el.dataset.tabId = tab.id;
      el.title = tab.cwd || tab.name;

      const icon = document.createElement('span');
      icon.className = 'tab-item-icon';
      icon.textContent = '▶';

      const label = document.createElement('span');
      label.className = 'tab-item-label';
      label.textContent = tab.name;

      el.appendChild(icon);
      el.appendChild(label);

      if (tabs.length > 1) {
        const x = document.createElement('button');
        x.className = 'tab-item-close';
        x.textContent = '✕';
        x.addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id); });
        el.appendChild(x);
      }

      el.addEventListener('click', () => switchTab(tab.id));
      tab.el = el;
      tabsContainer.appendChild(el);
    });

    // Add-tab inline after last tab
    const addEl = document.createElement('div');
    addEl.className = 'tab-item tab-add-inline';
    addEl.title = 'New Tab';
    addEl.innerHTML = '<span class="tab-item-icon" style="font-size:11px;opacity:0.7;">+</span><span class="tab-item-label">New Tab</span>';
    addEl.addEventListener('click', () => addTab());
    tabsContainer.appendChild(addEl);
  }

  function switchTab(id) {
    tabs.forEach(t => { if (t.wrapper) t.wrapper.style.display = 'none'; });
    tabsContainer.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));

    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    activeTabId = id;
    if (tab.el) tab.el.classList.add('active');

    if (!tab.wrapper) {
      tab.wrapper = document.createElement('div');
      tab.wrapper.className = 'terminal-wrapper';
      if (tab.splits.length > 0) {
        tab.wrapper.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:' + (tab.splitDir === 'horizontal' ? 'column' : 'row');
        tab.splits.forEach((split, idx) => buildPane(tab, split, idx));
      } else {
        tab.wrapper.style.cssText = 'width:100%;height:100%;';
        tab.term.open(tab.wrapper);
        attachKeyGuard(tab.wrapper, () => tab.term);
      }
      termArea.appendChild(tab.wrapper);
      tab.wrapper.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
      tab.wrapper.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation();
        const sid = (tab.splits[focusedSplit]||tab.splits[0])?.sid || tab.sid;
        const plain = e.dataTransfer.getData('text/plain');
        if (plain && plain.trim()) {
          const paths = plain.trim().split('\n').map(p => p.trim()).filter(Boolean).map(p => '"' + p + '"').join(' ');
          if (paths) { conn.send({ type: 'input', id: sid, data: paths }); return; }
        }
        const uriList = e.dataTransfer.getData('text/uri-list');
        if (uriList && uriList.trim()) {
          const paths = uriList.split('\n').map(u => u.trim()).filter(u => u && !u.startsWith('#'))
            .map(u => { try { const url = new URL(u); return decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')); } catch(ex) { return u; } })
            .map(p => '"' + p + '"').join(' ');
          if (paths) { conn.send({ type: 'input', id: sid, data: paths }); return; }
        }
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        const paths = files.map(f => '"' + (f.path || f.name) + '"').join(' ');
        conn.send({ type: 'input', id: sid, data: paths });
      });
    }

    tab.wrapper.style.display = tab.splits.length > 0 ? 'flex' : 'block';
    if (tab.onResize) window.removeEventListener('resize', tab.onResize);
    tab.onResize = () => fitTab(tab);
    window.addEventListener('resize', tab.onResize);
    if (showHistory) conn.send({ type: 'getHistory', cwd: tab.cwd });

    setTimeout(() => { fitTab(tab); focusTab(tab); }, 60);
  }

  // ── Split panes ────────────────────────────────────────────────────────────
  function buildPane(tab, split, idx) {
    const pane = document.createElement('div');
    pane.className = 'split-pane';
    pane.style.cssText = 'flex:1;overflow:hidden;position:relative;min-width:0;min-height:0;';

    function activatePane() {
      focusedSplit = idx;
      const liveSplit = tab.splits[idx];
      const cwdToUse = (liveSplit ? liveSplit.cwd : null) || tab.cwd;
      currentCwd = cwdToUse;
      if (showHistory) conn.send({ type: 'getHistory', cwd: cwdToUse });
    }

    pane.addEventListener('click', activatePane);

    // xterm captures pointer events on its canvas, so plain 'click' on the pane
    // never fires when the user clicks terminal text. Use mousedown on the xterm
    // screen element (added after term.open()) to catch all clicks including on text.
    split.term.open(pane);
    const screen = pane.querySelector('.xterm-screen');
    if (screen) screen.addEventListener('mousedown', activatePane);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'split-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', e => { e.stopPropagation(); closeSplit(tab, idx); });
    pane.appendChild(closeBtn);

    attachKeyGuard(pane, () => split.term);
    tab.wrapper.appendChild(pane);

    // Resize handle between panes (not after last)
    if (idx < tab.splits.length - 1) {
      const handle = document.createElement('div');
      const isHoriz = tab.splitDir === 'horizontal';
      handle.className = 'split-resize-handle ' + (isHoriz ? 'split-resize-h' : 'split-resize-v');
      handle.addEventListener('mousedown', e => startPaneResize(e, tab, isHoriz));
      tab.wrapper.appendChild(handle);
    }

    setTimeout(() => { try { split.fa.fit(); } catch(e){} }, 60);
  }

  function startPaneResize(e, tab, isHorizontal) {
    e.preventDefault();
    const panes = tab.wrapper.querySelectorAll('.split-pane');
    if (panes.length < 2) return;
    const p0 = panes[0], p1 = panes[1];
    const wrapperRect = tab.wrapper.getBoundingClientRect();
    const startPos = isHorizontal ? e.clientY : e.clientX;
    const totalSize = isHorizontal ? wrapperRect.height : wrapperRect.width;
    const startP0Size = isHorizontal ? p0.getBoundingClientRect().height : p0.getBoundingClientRect().width;
    const onMove = ev => {
      const delta = (isHorizontal ? ev.clientY : ev.clientX) - startPos;
      const newP0 = Math.max(80, Math.min(totalSize - 80, startP0Size + delta));
      p0.style.flex = 'none';
      p0.style[isHorizontal ? 'height' : 'width'] = (newP0 / totalSize * 100).toFixed(2) + '%';
      p1.style.flex = 'none';
      p1.style[isHorizontal ? 'height' : 'width'] = ((totalSize - newP0) / totalSize * 100).toFixed(2) + '%';
      fitTab(tab);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      fitTab(tab);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function fitTab(tab) {
    if (tab.splits.length) tab.splits.forEach(s => { try { s.fa.fit(); } catch(e){} });
    else { try { tab.fa.fit(); } catch(e){} }
  }

  function focusTab(tab) {
    const t = (tab.splits[focusedSplit] || tab.splits[0])?.term || tab.term;
    try { t.focus(); } catch(e){}
  }

  function closeTab(id) {
    if (tabs.length === 1) return;
    const idx = tabs.findIndex(t => t.id === id);
    const tab = tabs[idx];
    if (!tab) return;
    if (tab.el?.parentNode) tab.el.remove();
    if (tab.wrapper?.parentNode) tab.wrapper.remove();
    clearInterval(tab.cwdTimer);
    if (tab.onResize) window.removeEventListener('resize', tab.onResize);
    conn.send({ type: 'kill', id: tab.sid });
    tab.splits.forEach(s => conn.send({ type: 'kill', id: s.sid }));
    try { tab.term.dispose(); } catch(e){}
    tab.splits.forEach(s => { try { s.term.dispose(); } catch(e){} });
    tabs.splice(idx, 1);
    activeTabId = null;
    switchTab(tabs[Math.max(0, idx - 1)].id);
  }

  function splitTerminal(tab, dir) {
    if (tab.splits.length >= 2) return;
    tab.splitDir = dir;
    if (tab.splits.length === 0) tab.splits.push({ term: tab.term, fa: tab.fa, sid: tab.sid, onOutputData: tab.onOutputData, cwd: tab.cwd });
    const { term, fa, sid, onOutputData } = makeTerm(tab.cwd);
    tab.splits.push({ term, fa, sid, onOutputData, cwd: tab.cwd });
    tab.wrapper?.remove();
    tab.wrapper = null;
    switchTab(tab.id);
  }

  function closeSplit(tab, idx) {
    const split = tab.splits[idx];
    if (!split) return;
    if (split.sid !== tab.sid) {
      conn.send({ type:'kill', id: split.sid });
      try { split.term.dispose(); } catch(e){}
    }
    tab.splits.splice(idx, 1);
    if (tab.splits.length === 1) {
      tab.term = tab.splits[0].term;
      tab.fa   = tab.splits[0].fa;
      tab.sid  = tab.splits[0].sid;
      tab.splits = [];
    }
    tab.wrapper?.remove();
    tab.wrapper = null;
    focusedSplit = 0;
    switchTab(tab.id);
  }

  // ── Server messages ────────────────────────────────────────────────────────
  function findTabBySid(sid) {
    return tabs.find(t => t.sid === sid || t.splits.some(s => s.sid === sid));
  }

  conn.on('output', msg => {
    const tab = findTabBySid(msg.id);
    if (!tab) return;
    const split = tab.splits.find(s => s.sid === msg.id);
    const term = split ? split.term : tab.term;
    if (term) term.write(msg.data);
    const fn = split ? split.onOutputData : tab.onOutputData;
    if (fn) fn(msg.data);
    // Bell idle detection: any output resets the idle timer.
    // When output stops for IDLE_THRESHOLD_MS, the bell fires.
    if (bellArmed) {
      clearTimeout(window._bellIdleTimer);
      window._bellIdleTimer = setTimeout(() => {
        if (bellArmed) onBellFired();
      }, IDLE_THRESHOLD_MS);
    }
  });

  conn.on('created', msg => {
    const tab = findTabBySid(msg.id);
    if (!tab) return;
    const split = tab.splits.find(s => s.sid === msg.id);
    if (split) { split.cwd = msg.cwd; }
    else { tab.cwd = msg.cwd; tab.name = cwdName(msg.cwd); renderTabSidebar(); }
    conn.send({ type:'getHistory', cwd: msg.cwd });
  });

  conn.on('cwd', msg => {
    const tab = findTabBySid(msg.id);
    if (!tab) return;
    const split = tab.splits.find(s => s.sid === msg.id);
    if (split) {
      if (split.cwd === msg.cwd) return;
      split.cwd = msg.cwd;
      const splitIdx = tab.splits.indexOf(split);
      // Only update currentCwd and history if this is the active tab's focused split
      if (tab.id === activeTabId && splitIdx === focusedSplit) {
        currentCwd = msg.cwd;
        if (showHistory) conn.send({ type: 'getHistory', cwd: msg.cwd });
      }
    } else {
      if (msg.cwd === tab.cwd) return;
      tab.cwd = msg.cwd;
      tab.name = cwdName(msg.cwd);
      // In split view the tab's own sid is split[0]; update that split's cwd too
      if (tab.splits.length > 0) {
        const s0 = tab.splits.find(s => s.sid === tab.sid);
        if (s0) s0.cwd = msg.cwd;
      }
      renderTabSidebar();
      if (tab.id === activeTabId) {
        currentCwd = msg.cwd;
        // Only refresh history if no splits, or if split[0] is focused
        const isFocused = tab.splits.length === 0 || focusedSplit === 0;
        if (isFocused && showHistory) conn.send({ type: 'getHistory', cwd: msg.cwd });
      }
    }
  });

  // History from server — always deduplicated, most-recent first (server already does this,
  // but we enforce it on client too for the move-to-top-on-click case)
  conn.on('history', msg => {
    commandHistory = dedup(msg.commands || []).slice(0, 60);
    if (showHistory) renderHistory();
  });

  conn.on('historyFileCreated', msg => {
    dbg('.history ' + (msg.existed ? 'already exists' : 'created') + ': ' + msg.path, 'ok');
    if (showHistory) renderHistory();
  });

  conn.on('bashrcAliases', msg => { renderAliases(msg.aliases || []); });
  conn.on('error', msg => { dbg('Error: ' + (msg.message || '?'), '#f85149'); });

  // ── History helpers ────────────────────────────────────────────────────────
  function dedup(arr) {
    const seen = new Set();
    return arr.filter(c => { if (seen.has(c)) return false; seen.add(c); return true; });
  }

  function renderHistory() {
    historyList.innerHTML = '';
    if (!commandHistory.length) {
      historyList.innerHTML = '<div class="no-history">No history yet</div>';
      return;
    }
    commandHistory.forEach(cmd => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.textContent = cmd;
      el.dataset.command = cmd;
      el.dataset.vscodeContext = JSON.stringify({ webviewSection: 'historyItem', preventDefaultContextMenuItems: true });
      historyList.appendChild(el);
    });
  }

  // Move command to top of displayed list without waiting for server round-trip
  function promoteHistory(cmd) {
    commandHistory = [cmd, ...commandHistory.filter(c => c !== cmd)].slice(0, 60);
    if (showHistory) renderHistory();
  }

  // ── Send helpers ───────────────────────────────────────────────────────────
  function sendToActive(data) {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;
    const sid = (tab.splits[focusedSplit] || tab.splits[0])?.sid || tab.sid;
    conn.send({ type:'input', id: sid, data });
  }

  function execCmd(cmd) {
    cmd = cmd.trim();
    for (const p of ['pacman ','apt-get ','apt ','dnf ']) {
      if (cmd.startsWith(p) && !cmd.startsWith('sudo ')) { cmd = 'sudo ' + cmd; break; }
    }
    sendToActive(cmd + '\r');
  }

  // ── Panel resize ───────────────────────────────────────────────────────────
  function makePanelResizable(panel) {
    const handle = document.createElement('div');
    handle.className = 'panel-resize-handle';
    panel.insertBefore(handle, panel.firstChild);
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      const onMove = ev => {
        panel.style.width = Math.max(180, Math.min(600, startW - (ev.clientX - startX))) + 'px';
        const tab = tabs.find(t => t.id === activeTabId);
        if (tab) fitTab(tab);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  makePanelResizable(historySidebar);
  makePanelResizable(settingsPanel);
  makePanelResizable(aliasPanel);

  // ── Context menus ──────────────────────────────────────────────────────────
  function showMenu(menu, x, y) {
    menu.style.display = 'block';
    menu.style.left = '0'; menu.style.top = '0';
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      menu.style.left = Math.max(4, Math.min(x, window.innerWidth  - r.width  - 4)) + 'px';
      menu.style.top  = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
    });
  }

  function hideMenus() {
    mainMenu.style.display = 'none';
  }

  // ── Aliases ────────────────────────────────────────────────────────────────
  function loadAliases() { try { return JSON.parse(localStorage.getItem('elveAliases')||'[]'); } catch(e){return[];} }

  function renderAliases(bashrcAliases) {
    const list = $('alias-list');
    list.innerHTML = '';
    const saved = loadAliases();
    const merged = [...saved];
    if (bashrcAliases) bashrcAliases.forEach(ba => { if (!merged.find(a => a.name === ba.name)) merged.push(ba); });
    merged.forEach(a => addAliasRow(a.name, a.command, !saved.find(s => s.name === a.name)));
  }

  function addAliasRow(name, cmd, fromBashrc) {
    name = name || ''; cmd = cmd || '';
    const row = document.createElement('div');
    row.className = 'alias-item';
    row.innerHTML =
      '<input class="alias-name" placeholder="alias" value="' + name + '">' +
      '<input class="alias-command" placeholder="command" value="' + cmd + '">' +
      (fromBashrc ? '<span class="alias-source" title="From .bashrc / .zshrc">~</span>' : '') +
      '<button class="remove-alias">&#x2715;</button>';
    row.querySelector('.remove-alias').onclick = () => row.remove();
    $('alias-list').appendChild(row);
  }

  function saveAliases() {
    const aliases = [...document.querySelectorAll('.alias-item')].map(r => ({
      name: r.querySelector('.alias-name').value.trim(),
      command: r.querySelector('.alias-command').value.trim(),
    })).filter(a => a.name && a.command);
    try { localStorage.setItem('elveAliases', JSON.stringify(aliases)); } catch(e){}
    aliases.forEach(a => sendToActive("alias " + a.name + "='" + a.command + "'\r"));
    aliasPanel.style.display = 'none';
  }

  // ── Tab sidebar collapse ───────────────────────────────────────────────────
  function toggleSidebar() {
    if (settings.neverCollapseSidebar) return;
    sidebarCollapsed = !sidebarCollapsed;
    tabSidebar.classList.toggle('collapsed', sidebarCollapsed);
    const tab = tabs.find(t => t.id === activeTabId);
    setTimeout(() => { if (tab) { fitTab(tab); focusTab(tab); } }, 200);
  }

  // ── Host commands (from VSCode title bar buttons) ──────────────────────────
  window.addEventListener('message', e => {
    const msg = e.data;
    if (!msg || msg.type !== 'hostCommand') return;
    switch (msg.cmd) {
      case 'collapseBar':   toggleSidebar(); break;
      case 'password':
        if (savedPassword) sendToActive(savedPassword + '\r');
        else $('password-overlay').style.display = 'flex';
        break;
      case 'clear': {
        const tab = tabs.find(t => t.id === activeTabId); if (!tab) break;
        const sid = (tab.splits[focusedSplit]||tab.splits[0])?.sid || tab.sid;
        const term = (tab.splits[focusedSplit]||tab.splits[0])?.term || tab.term;
        conn.send({ type:'input', id:sid, data:'\x03' });
        setTimeout(() => { term.clear(); term.focus(); }, 100);
        break;
      }
      case 'clearLine':  sendToActive('\x15'); break;
      case 'kill':       sendToActive('\x03'); break;

      // ── webview/context menu actions ────────────────────────────────────
      case 'ctx.copy': {
        // Get the live xterm selection at command time (not stale selectedText)
        const tab0 = tabs.find(t => t.id === activeTabId);
        const liveText = ((tab0?.splits[focusedSplit]||tab0?.splits[0])?.term || tab0?.term)?.getSelection?.() || selectedText;
        if (liveText && window.vscode) {
          window.vscode.postMessage({ type: 'copyToClipboard', text: liveText });
        } else {
          navigator.clipboard.writeText(liveText).catch(()=>{});
        }
        break;
      }
      case 'ctx.paste': {
        // Extension host pre-fetched the clipboard text and sent it with the command
        const pasteText = msg.text;
        if (pasteText) {
          const tab2 = tabs.find(t => t.id === activeTabId);
          const sid2 = (tab2?.splits[focusedSplit]||tab2?.splits[0])?.sid || tab2?.sid;
          if (sid2) conn.send({ type:'input', id:sid2, data:pasteText });
        }
        break;
      }
      case 'ctx.splitH': { const t2=tabs.find(t=>t.id===activeTabId); if(t2) splitTerminal(t2,'horizontal'); break; }
      case 'ctx.splitV': { const t2=tabs.find(t=>t.id===activeTabId); if(t2) splitTerminal(t2,'vertical'); break; }
      case 'ctx.pacman': execCmd('sudo pacman -S ' + selectedText); break;
      case 'ctx.yay':    execCmd('yay -S ' + selectedText); break;
      case 'ctx.apt':    execCmd('sudo apt-get install ' + selectedText); break;
      case 'ctx.dnf':    execCmd('sudo dnf install ' + selectedText); break;
      case 'ctx.search':
        if (window.vscode) window.vscode.postMessage({ type:'openExternal', url:'https://www.google.com/search?q='+encodeURIComponent(selectedText) });
        break;
      // History context menu
      case 'ctx.histExecute':   sendToActive(selectedHistCmd + '\r'); break;
      case 'ctx.histCopyInput': sendToActive(selectedHistCmd); break;
      case 'ctx.histCopy':
        if (selectedHistCmd && window.vscode) window.vscode.postMessage({ type: 'copyToClipboard', text: selectedHistCmd });
        else navigator.clipboard.writeText(selectedHistCmd || '').catch(()=>{});
        break;
      case 'bell':
        if (bellFired) {
          // clicking while red resets it
          bellFired = false;
          bellArmed = false;
          if (bellResetTimer) clearTimeout(bellResetTimer);
          clearTimeout(window._bellIdleTimer);
          updateBellIcon();
        } else {
          armBell();
        }
        break;
      case 'toggleHistory':
        showHistory = !showHistory;
        historySidebar.style.display = showHistory ? 'flex' : 'none';
        if (showHistory) {
          settingsPanel.style.display = 'none';
          aliasPanel.style.display = 'none';
          const tab = tabs.find(t => t.id === activeTabId);
          const split = tab?.splits[focusedSplit] || tab?.splits[0];
          const cwd = (split ? split.cwd : null) || tab?.cwd || currentCwd;
          conn.send({ type: 'getHistory', cwd });
        }
        setTimeout(() => { const t=tabs.find(t=>t.id===activeTabId); if(t){fitTab(t);focusTab(t);} }, 100);
        break;
      case 'menu':
        if (mainMenu.style.display === 'block') { hideMenus(); break; }
        // Position near top-right corner of webview
        mainMenu.style.right = '4px';
        mainMenu.style.left = 'auto';
        mainMenu.style.top = '4px';
        mainMenu.style.display = 'block';
        break;
    }
  });



  // ── Submenu actions ────────────────────────────────────────────────────────
  mainMenu.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    hideMenus();
    if (action === 'settings') {
      const vis = settingsPanel.style.display !== 'none';
      settingsPanel.style.display = vis ? 'none' : 'flex';
      if (!vis) { historySidebar.style.display='none'; aliasPanel.style.display='none'; }
    }
    if (action === 'control-aliases') {
      const vis = aliasPanel.style.display !== 'none';
      aliasPanel.style.display = vis ? 'none' : 'flex';
      if (!vis) {
        settingsPanel.style.display='none'; historySidebar.style.display='none';
        renderAliases([]);
        conn.send({ type: 'getBashrcAliases' });
      }
    }
    if (action === 'create-history-file') {
      const tab = tabs.find(t => t.id === activeTabId);
      const split = tab?.splits[focusedSplit] || tab?.splits[0];
      const cwd = (split ? split.cwd : null) || tab?.cwd || currentCwd;
      conn.send({ type: 'createHistoryFile', cwd });
    }
    if (action === 'collapse-top-bar') toggleSidebar();
    const tab = tabs.find(t=>t.id===activeTabId);
    setTimeout(() => { if (tab) { fitTab(tab); focusTab(tab); } }, 100);
  });

  // ── History list events ────────────────────────────────────────────────────
  historyList.addEventListener('click', e => {
    const item = e.target.closest('.history-item');
    if (!item) return;
    const cmd = item.dataset.command;
    sendToActive(cmd + '\r');
    // History will update on next poll / cwd-change; no client-side write needed
  });

  historyList.addEventListener('contextmenu', e => {
    const item = e.target.closest('.history-item');
    if (!item) return;
    // Just track which command was right-clicked; VS Code shows the native menu
    selectedHistCmd = item.dataset.command;
  });

  // ── Track selection for webview/context when-clause ──────────────────────
  document.addEventListener('contextmenu', e => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab || !e.target.closest('#terminal-area')) return;
    selectedText = (tab.splits[focusedSplit]?.term || tab.term).getSelection?.().trim() || '';
    // Tell extension host so elveHasSelection when-clause stays accurate
    if (window.vscode) window.vscode.postMessage({ type: 'setContext', value: !!selectedText });
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.dropdown-menu')) hideMenus();
  });

  // ── Password dialog ────────────────────────────────────────────────────────
  $('password-lock') && $('password-lock').addEventListener('contextmenu', e => {
    e.preventDefault(); $('password-overlay').style.display = 'flex'; $('password-input').value = '';
  });
  $('save-password').addEventListener('click', () => {
    const pwd = $('password-input').value;
    if (pwd) savedPassword = pwd;
    $('password-overlay').style.display = 'none';
    $('password-input').value = '';
  });
  $('cancel-password').addEventListener('click', () => { $('password-overlay').style.display = 'none'; });

  $('close-settings').addEventListener('click', () => {
    settingsPanel.style.display = 'none';
    const tab = tabs.find(t=>t.id===activeTabId); if(tab){fitTab(tab);focusTab(tab);}
  });
  $('close-aliases').addEventListener('click', () => { aliasPanel.style.display = 'none'; });
  $('add-alias').addEventListener('click', () => addAliasRow('', ''));
  $('save-aliases').addEventListener('click', () => saveAliases());

  // add-tab is now rendered inline in renderTabSidebar()

  // ── Settings sliders ───────────────────────────────────────────────────────
  function watchRange(id, labelId, setter) {
    const el = $(id); if (!el) return;
    el.addEventListener('input', e => {
      if (labelId) $(labelId).textContent = e.target.value;
      setter(e.target.value);
      saveSettings(); applyTheme();
    });
  }
  watchRange('font-size',  'font-size-value',  v => settings.fontSize   = parseInt(v));
  watchRange('color-hue',  'hue-value',        v => settings.colorHue   = parseInt(v));
  watchRange('brightness', 'brightness-value', v => settings.brightness = parseInt(v));
  watchRange('bg-opacity', 'opacity-value',    v => settings.bgOpacity  = parseInt(v));
  watchRange('saturation', 'saturation-value', v => settings.saturation = parseInt(v));
  $('font-family').addEventListener('change', e => { settings.fontFamily = e.target.value; saveSettings(); applyTheme(); });
  $('theme').addEventListener('change', e => { settings.theme = e.target.value; saveSettings(); applyTheme(); });
  $('show-input-box').addEventListener('change', e => {
    settings.showInputBox = e.target.checked; saveSettings();
    $('input-box-container').style.display = e.target.checked ? 'flex' : 'none';
    setTimeout(() => { const t=tabs.find(t=>t.id===activeTabId); if(t) fitTab(t); }, 60);
  });
  $('never-collapse-sidebar').addEventListener('change', e => {
    settings.neverCollapseSidebar = e.target.checked; saveSettings();
    if (e.target.checked) {
      sidebarCollapsed = false;
      tabSidebar.classList.remove('collapsed');
      tabSidebar.classList.add('pinned');
    } else {
      tabSidebar.classList.remove('pinned');
    }
    setTimeout(() => { const t=tabs.find(t=>t.id===activeTabId); if(t){fitTab(t);focusTab(t);} }, 200);
  });
  $('ctrl-v-paste').addEventListener('change', e => {
    settings.ctrlVPaste = e.target.checked; saveSettings();
  });

  // ── Bottom input ───────────────────────────────────────────────────────────
  let lastInputVal = '';
  const bottomInput = $('bottom-input');
  bottomInput.addEventListener('input', e => {
    if (lastInputVal.length > 0) sendToActive('\x15');
    sendToActive(e.target.value);
    lastInputVal = e.target.value;
  });
  bottomInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { sendToActive('\r'); bottomInput.value = ''; lastInputVal = ''; }
    else if (e.key === 'Tab') { e.preventDefault(); sendToActive('\t'); }
  });

  // ── Boot ───────────────────────────────────────────────────────────────────
  initSettingsUI();
  applyTheme();
  if (settings.showInputBox) $('input-box-container').style.display = 'flex';
  if (settings.neverCollapseSidebar) {
    sidebarCollapsed = false;
    tabSidebar.classList.remove('collapsed');
    tabSidebar.classList.add('pinned');
  }

  function tryBoot() {
    if (conn.open) { addTab(INITIAL_CWD); }
    else { setTimeout(tryBoot, 100); }
  }
  tryBoot();

})();
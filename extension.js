// ChatGPT Usage for VS Code: your ChatGPT plan's Codex limits (the 5-hour window and the week) in a
// small sidebar card. It asks `codex app-server` for them (account/rateLimits/read); no model is called.
'use strict';
const vscode = require('vscode');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { version: VERSION } = require('./package.json');

const WIN = process.platform === 'win32';

// ------------------------------------------------------------------- Codex ----

function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

// The settings path, then PATH, then nvm's folders (VS Code started from the dock may not see nvm).
function findCodex() {
  const set = vscode.workspace.getConfiguration('chatgptUsage').get('codexPath');
  if (set && isFile(set)) return set;
  const names = WIN ? ['codex.exe', 'codex.cmd'] : ['codex'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) for (const n of names) if (dir && isFile(path.join(dir, n))) return path.join(dir, n);
  const nvm = path.join(os.homedir(), '.nvm', 'versions', 'node');
  let vers = [];
  try { vers = fs.readdirSync(nvm); } catch { /* no nvm */ }
  for (const p of [...vers.map((v) => path.join(nvm, v, 'bin', 'codex')), '/usr/local/bin/codex', '/opt/homebrew/bin/codex']) {
    if (isFile(p)) return p;
  }
  return null;
}

function readCodexLimits(exe) {
  return new Promise((resolve) => {
    // The npm `codex` is a node script, and its node sits in the same folder.
    const env = Object.assign({}, process.env, { PATH: path.dirname(exe) + path.delimiter + (process.env.PATH || '') });
    let child;
    try {
      child = cp.spawn(exe, ['app-server'], { cwd: os.homedir(), env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: exe.endsWith('.cmd') });
    } catch { resolve(null); return; }
    let buf = '', done = false;
    const finish = (limits) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.end(); // the server exits when its input closes
      setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); }, 3000);
      resolve(limits);
    };
    const timer = setTimeout(() => finish(null), 30000);
    child.stdout.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
        let m;
        try { m = JSON.parse(buf.slice(0, i)); } catch { continue; }
        if (m.id === 1) finish(m.result ? m.result.rateLimits || null : null);
      }
    });
    child.stdin.on('error', () => {});
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
    child.stdin.write([
      { method: 'initialize', id: 0, params: { clientInfo: { name: 'chatgpt_usage', title: 'ChatGPT Usage', version: VERSION } } },
      { method: 'initialized' },
      { method: 'account/rateLimits/read', id: 1 },
    ].map((m) => JSON.stringify(m)).join('\n') + '\n');
  });
}

// primary is the 5-hour window, secondary the week; a plan without one sends null.
function parseCodexLimits(r) {
  const win = (w) => (w && typeof w.usedPercent === 'number' ? w : null);
  const p = win(r && r.primary), w = win(r && r.secondary);
  if (!p && !w) return null;
  return {
    plan: r.planType || null,
    session: p ? Math.round(p.usedPercent) : null, sessionReset: p && p.resetsAt ? p.resetsAt * 1000 : null,
    week: w ? Math.round(w.usedPercent) : null, weekReset: w && w.resetsAt ? w.resetsAt * 1000 : null,
  };
}

// ----------------------------------------------------------------- the view ----

class UsageView {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.state = { usage: null, note: 'loading...' };
  }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((msg) => { if (msg.type === 'ready') this.post(); });
    view.onDidDispose(() => { this.view = null; });
  }

  html(webview, media) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const src = (f) => webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${src('style.css')}"></head><body>
<div id="card">
  <div class="lim top"><span class="lbl" id="name">CHATGPT</span><span id="reset" class="val">loading...</span></div>
  <div class="row"><div class="pct"><span id="pct">--</span><span class="sign">%</span></div><div class="bar"><div id="barS"></div></div></div>
  <div class="lim"><span class="lbl">WEEK</span><span id="week" class="val"></span></div>
  <div class="bar thin"><div id="barW"></div></div>
</div>
<script nonce="${nonce}" src="${src('main.js')}"></script>
</body></html>`;
  }

  post() {
    if (!this.view) return;
    this.view.webview.postMessage(Object.assign({ type: 'state', config: config() }, this.state));
  }
}

function config() {
  const c = vscode.workspace.getConfiguration('chatgptUsage');
  return { warnPercent: c.get('warnPercent'), critPercent: c.get('critPercent') };
}

// ------------------------------------------------------------------ activate ----

function activate(context) {
  const view = new UsageView(context);
  let probing = false;

  // A failed read keeps the last numbers.
  async function refresh() {
    if (probing) return;
    const exe = findCodex();
    if (!exe) { view.state.note = 'codex not found: set chatgptUsage.codexPath'; view.post(); return; }
    probing = true;
    const u = parseCodexLimits(await readCodexLimits(exe));
    probing = false;
    if (u) { view.state.usage = u; view.state.note = ''; }
    else view.state.note = 'no plan limits from codex (signed in with ChatGPT?)';
    view.post();
  }

  let timer = null;
  function schedule() {
    clearInterval(timer);
    const secs = Math.max(30, vscode.workspace.getConfiguration('chatgptUsage').get('refreshSeconds') || 60);
    timer = setInterval(refresh, secs * 1000);
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('chatgptUsage.view', view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('chatgptUsage.refresh', refresh),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('chatgptUsage')) return;
      if (e.affectsConfiguration('chatgptUsage.refreshSeconds')) schedule();
      if (e.affectsConfiguration('chatgptUsage.codexPath')) refresh();
      view.post();
    }),
    { dispose: () => clearInterval(timer) },
  );
  schedule();
  refresh();
}

function deactivate() {}

module.exports = { activate, deactivate, parseCodexLimits };

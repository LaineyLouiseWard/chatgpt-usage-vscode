// The ChatGPT Usage card: the 5-hour window and the week, from the extension's messages.
'use strict';
(function () {
  const vscode = acquireVsCodeApi();
  const COL = { warn: '#FBBF24', crit: '#F87171' };
  const $ = (id) => document.getElementById(id);
  let cfg = { warnPercent: 60, critPercent: 85 };
  let usage = null, note = 'loading...';

  function level(p) { return p >= cfg.critPercent ? 'crit' : p >= cfg.warnPercent ? 'warn' : 'ok'; }

  function span(ms) {
    const secs = (ms - Date.now()) / 1000;
    if (!(secs > 0)) return null;
    const mins = Math.floor(secs / 60), h = Math.floor(mins / 60), mm = mins % 60;
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h >= 1) return `${h}h ${String(mm).padStart(2, '0')}m`;
    return `${mm}m`;
  }

  // OpenAI's own black and white; only a filling 5-hour window takes colour.
  // The figure the card leads with: the 5-hour window, or the week on a plan without one.
  function lead(u) {
    if (u && u.session !== null && u.session !== undefined) return { pct: u.session, reset: u.sessionReset, lapsed: u.sessionLapsed, week: false };
    if (u && u.week !== null && u.week !== undefined) return { pct: u.week, reset: u.weekReset, lapsed: u.weekLapsed, week: true };
    return null;
  }

  function render() {
    const u = usage, L = lead(u);
    $('name').textContent = u && u.plan ? `CHATGPT ${u.plan.toUpperCase()}` : 'CHATGPT';
    if (!L) {
      $('pct').textContent = '--';
      $('barS').style.width = '0';
      $('reset').textContent = note;
    } else {
      const lv = level(L.pct);
      $('pct').textContent = String(L.pct);
      $('pct').style.color = lv === 'ok' ? '' : COL[lv];
      $('barS').style.width = `${Math.min(100, L.pct)}%`;
      $('barS').style.background = lv === 'ok' ? '' : COL[lv];
      const s = L.reset ? span(L.reset) : null;
      $('reset').textContent = s ? `${L.week ? 'week resets' : 'resets'} in ${s}` : L.lapsed ? `${L.week ? 'week' : 'window'} reset` : '';
    }
    // When the week leads, its own row would repeat the big number.
    $('weekLim').style.display = $('weekBar').style.display = L && L.week ? 'none' : '';
    const wk = u && u.week !== null && u.week !== undefined ? u.week : null;
    const ws = wk !== null && u.weekReset ? span(u.weekReset) : null;
    $('week').textContent = wk === null ? '' : `${wk}%` + (ws ? `  ·  ${ws}` : '');
    $('barW').style.width = wk === null ? '0' : `${Math.min(100, wk)}%`;
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type !== 'state') return;
    if (msg.config) cfg = Object.assign(cfg, msg.config);
    if ('usage' in msg) usage = msg.usage;
    if ('note' in msg) note = msg.note;
    render();
  });

  setInterval(render, 30000); // reset countdowns
  render();
  vscode.postMessage({ type: 'ready' });
})();

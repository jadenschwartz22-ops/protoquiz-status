// Builds dist/index.html (the public status page) from rollup.json: the Pi probe's own per-service/day stats
// (scripts/pi/pq-probe.mjs in the B2B repo; the Pi pushes it to the `data` branch every 15 min, runs this script and
// pushes dist/ to the `status-site` branch that Pages serves. No GitHub Actions involved). Every number on the page is a
// real probe result: check counts, p50/p95, and down intervals (2+ consecutive failed 5-minute checks).
// Incidents = those down intervals plus GitHub issues labelled "status". No runtime JS, no API calls from the browser.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const TZ = 'America/New_York', OWNER = 'jadenschwartz22-ops', REPO = 'protoquiz-status', CNAME = 'status.protoquiz.com';
const roll = JSON.parse(readFileSync(process.env.ROLLUP_JSON || 'rollup.json', 'utf8'));
const issues = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues?state=all&labels=status&per_page=100`, { signal: AbortSignal.timeout(15000) })
  .then(r => r.json()).then(a => a.filter(i => !i.pull_request)).catch(() => []);  // public API, no token
const now = Date.now(), nowS = Math.floor(now / 1e3), DAYS = 90;
const dayKey = t => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
const fmtDate = t => new Date(t).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
const fmtTime = t => new Date(t).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dur = m => m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.max(1, Math.round(m))} min`;
const GROUP_LABEL = { 'Consumer App': 'Consumer App · iOS & Android', 'Agency Platform': 'Agency Platform · B2B' };

const stale = nowS - roll.generated > 45 * 60;
const services = roll.services.map(s => {
  const step = s.hourlyCheck ? 60 : 5, cells = [];
  let checks = 0, down = 0;
  for (let i = DAYS - 1; i >= 0; i--) {
    const k = dayKey(now - i * 864e5), d = s.days[k]; if (d) { checks += d.n; down += d.dm; }
    cells.push({ k, d });
  }
  const covered = checks * step;
  return { ...s, cells, checks, down, uptime: covered ? 100 * Math.max(0, 1 - down / covered) : null };
});
const fmtPct = p => p == null ? '—' : p >= 99.995 ? '100%' : p.toFixed(p >= 99 ? 2 : 1) + '%';
const groups = [...new Set(services.map(s => s.group))].map(g => ({ name: GROUP_LABEL[g] || g, items: services.filter(s => s.group === g) }));
const downNow = services.filter(s => s.status === 'down');
const state = downNow.length ? (downNow.length === services.length ? 'down' : 'degraded') : 'up';
const banner = downNow.length ? (downNow.length === 1 ? `${downNow[0].name} is down` : `${downNow.length} services are down`) : 'All systems operational';
const total24 = services.reduce((a, s) => a + s.n24, 0);
const firstDay = services.flatMap(s => Object.keys(s.days)).sort()[0];

const outages = services.flatMap(s => s.outages.map(o => ({ svc: s.name, t0: o.s * 1e3, t1: o.e ? o.e * 1e3 : null }))).filter(o => o.t0 > now - DAYS * 864e5);
const issueItems = issues.filter(i => Date.parse(i.created_at) > now - DAYS * 864e5).map(i => ({ svc: String(i.title).replace(/[\u{1F6D1}⚠️✅]/gu, '').trim(), t0: Date.parse(i.created_at), t1: i.closed_at ? Date.parse(i.closed_at) : null, href: i.html_url }));
const events = [...outages, ...issueItems].sort((a, b) => b.t0 - a.t0);
const incidentHtml = o => `<article class="incident ${o.t1 ? '' : 'open'}">
  <h4>${o.href ? `<a href="${esc(o.href)}">${esc(o.svc)}</a>` : esc(o.svc) + (o.t1 ? ' outage' : ' outage, ongoing')}</h4>
  <p class="m">${o.t1 ? `Down ${dur((o.t1 - o.t0) / 6e4)} · ${fmtTime(o.t0)} to ${fmtTime(o.t1)}` : `Since ${fmtTime(o.t0)}`}</p></article>`;
const open = events.filter(e => !e.t1);
const dayList = Array.from({ length: 7 }, (_, d) => { const t = now - d * 864e5, k = dayKey(t); return { label: fmtDate(t), inc: events.filter(e => e.t1 && dayKey(e.t0) === k) }; });
const older = events.filter(e => e.t1 && e.t0 < now - 7 * 864e5 && dayKey(e.t0) !== dayKey(now - 7 * 864e5)).slice(0, 20);

const spark = h => {
  const pts = h.map((v, i) => [i, v]).filter(p => p[1] != null);
  if (pts.length < 2) return '<span class="stats">collecting data</span>';
  const w = 160, ht = 32, lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p[0] / 23 * w).toFixed(1)} ${(ht - 3 - (p[1] - lo) / Math.max(hi - lo, 1) * (ht - 6)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${ht}" width="${w}" height="${ht}" role="img" aria-label="Median response time per hour, last 24 hours"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
};
const bar = s => `<div class="bar" role="img" aria-label="${esc(s.name)} availability, last 90 days">${s.cells.map(({ k, d }) =>
  `<i class="${!d ? 'none' : d.dm === 0 ? '' : d.dm < 15 ? 'deg' : 'down'}" title="${k}: ${!d ? 'no data' : `${d.dm ? dur(d.dm) + ' down' : 'no downtime'}, ${d.n} checks${d.p50 ? ', p50 ' + d.p50 + ' ms' : ''}`}"></i>`).join('')}</div>`;
const ms = v => v == null ? '—' : v + ' ms';
const rowHtml = s => `<div class="row"><div class="top"><span class="name"><a href="${esc(s.url)}" rel="noopener">${esc(s.name)}</a></span>
<span class="pill ${s.status}">${s.status === 'down' ? 'Outage' : 'Operational'}${s.lastMs ? `<span class="ms">${s.lastMs} ms</span>` : ''}</span></div>
${bar(s)}<div class="axis"><span>90 days ago</span><span>${s.checks.toLocaleString('en-US')} checks · ${s.down ? dur(s.down) + ' down' : 'no downtime'}</span><span>Today</span></div>
<div class="stats"><div class="k"><span><b>${fmtPct(s.uptime)}</b> uptime</span><span><b>${ms(s.p50)}</b> p50</span><span><b>${ms(s.p95)}</b> p95</span><span>last 24 h</span></div>${spark(s.hourly)}</div></div>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ProtoQuiz Status</title>
<meta name="description" content="Live availability and incident history for ProtoQuiz: the consumer app, the agency platform, and the EMS Census.">
<meta name="theme-color" content="#06050a">
<link rel="icon" href="https://protoquiz.com/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="https://protoquiz.com/favicon-32.png"><link rel="icon" type="image/png" sizes="192x192" href="https://protoquiz.com/favicon-192.png"><link rel="apple-touch-icon" href="https://protoquiz.com/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="ProtoQuiz incidents" href="https://github.com/${OWNER}/${REPO}/issues.atom">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#06050a;--panel:#100d08;--panel-2:#161209;--line:#1c1a14;--line-2:#2a2618;--ink:#f4f1ea;--ink-soft:#a8a399;--muted:#8a8478;--amber:#ffb000;--amber-dim:#7a5a00;--up:#00d27a;--deg:#ffb000;--down:#ff3b30;--none:#1c1a14;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;--sans:Inter,-apple-system,system-ui,sans-serif}
*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit}.wrap{max-width:960px;margin:0 auto;padding:0 24px}.mono{font-family:var(--mono)}
header{border-bottom:1px solid var(--line);background:rgba(6,5,10,.9);backdrop-filter:blur(8px);position:sticky;top:0;z-index:2}
header .wrap{display:flex;align-items:center;justify-content:space-between;height:68px}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;font:600 15px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase}.brand img{width:40px;height:40px}.brand span{color:var(--muted);font-weight:500;margin-left:2px}
nav a{color:var(--ink-soft);text-decoration:none;font:500 12px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;margin-left:26px}nav a:hover{color:var(--amber)}
.hero{padding:44px 0 32px;border-bottom:1px solid var(--line)}
.eyebrow{font:600 11px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--amber);margin:0 0 14px}
h1{margin:0;font:600 30px/1.15 var(--mono);letter-spacing:.02em;text-transform:uppercase}h1.up{color:var(--up)}h1.degraded{color:var(--deg)}h1.down{color:var(--down)}
.sub{margin:10px 0 0;color:var(--muted);font:13px/1.6 var(--mono)}.sub b{color:var(--ink-soft);font-weight:500}
h2{font:600 11px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin:38px 0 12px;display:flex;justify-content:space-between;align-items:baseline}h2 span{color:var(--amber)}
.group{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.row{padding:18px 20px;border-top:1px solid var(--line)}.row:first-child{border-top:0}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.name{font-weight:600;font-size:15px}.name a{text-decoration:none}.name a:hover{color:var(--amber)}
.pill{font:500 12px/1 var(--mono);white-space:nowrap;color:var(--up)}.pill.down{color:var(--down)}.pill.degraded{color:var(--deg)}
.chart{display:block;width:100%;height:64px;margin:14px 0 10px;color:var(--up);opacity:.9}.chart .fill{fill:var(--up);opacity:.12}.chart.empty{display:flex;align-items:center;justify-content:center;font:12px var(--mono);color:var(--muted);border:1px dashed var(--line-2);border-radius:6px}
.meta{display:flex;justify-content:space-between;align-items:center;font:12px/1 var(--mono);color:var(--muted)}.meta b{color:var(--ink-soft);font-weight:500;font-variant-numeric:tabular-nums}
.log .day{padding:14px 0;border-top:1px solid var(--line);display:grid;grid-template-columns:150px 1fr;gap:16px}.log .day:first-child{border-top:0}
.log h3{margin:0;font:500 12px/1.6 var(--mono);color:var(--muted)}.log p.none{margin:0;color:var(--muted);font-size:14px}
.incident{padding:12px 14px;margin:0 0 8px;border-left:2px solid var(--down);background:var(--panel);border-radius:0 8px 8px 0}.incident.open{border-color:var(--deg)}
.incident h4{margin:0;font-size:14px;font-weight:600}.incident h4 a{text-decoration:none}.incident h4 a:hover{color:var(--amber)}.incident .m{margin:4px 0 0;font:12px/1.5 var(--mono);color:var(--muted)}
footer{margin:56px 0 44px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--muted);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}footer a{color:var(--ink-soft)}
@media(max-width:680px){h1{font-size:20px}nav a{margin-left:14px;font-size:11px}.brand img{width:32px;height:32px}.log .day{grid-template-columns:1fr;gap:4px}}
.hero{display:flex;gap:20px;align-items:center}.dot{flex:none;width:14px;height:14px;border-radius:50%;background:var(--up);box-shadow:0 0 0 6px rgba(0,210,122,.14)}.dot.degraded{background:var(--deg);box-shadow:0 0 0 6px rgba(255,176,0,.14)}.dot.down{background:var(--down);box-shadow:0 0 0 6px rgba(255,59,48,.16)}
.bar{display:grid;grid-template-columns:repeat(90,1fr);gap:2px;margin:14px 0 6px;height:30px}.bar i{border-radius:2px;background:var(--up);opacity:.85}.bar i.none{background:var(--none);opacity:1}.bar i.deg{background:var(--deg)}.bar i.down{background:var(--down)}.bar i:hover{opacity:1;outline:1px solid var(--ink-soft)}
.axis{display:flex;justify-content:space-between;font:11px/1 var(--mono);color:var(--muted);margin-bottom:12px}
.stats{display:flex;gap:18px;align-items:center;justify-content:space-between;font:12px/1.4 var(--mono);color:var(--muted)}.stats b{color:var(--ink-soft);font-weight:500;font-variant-numeric:tabular-nums}.stats .k{display:flex;gap:18px;flex-wrap:wrap}
.spark{flex:none;color:var(--amber)}.ms{color:var(--muted);font-weight:400;margin-left:8px}
@media(max-width:680px){.stats{flex-direction:column;align-items:flex-start}.bar{height:24px}}
</style></head><body>
<header><div class="wrap"><a class="brand" href="/"><img src="https://protoquiz.com/logo-128.png" alt="">ProtoQuiz&trade; <span>Status</span></a>
<nav><a href="https://protoquiz.com">Website</a><a href="https://protoquiz.com/agency/">For agencies</a><a href="https://protoquiz.com/census/">Census</a><a href="https://protoquiz.com/trust/">Trust</a></nav></div></header>
<main class="wrap">
<section class="hero"><span class="dot ${stale ? 'degraded' : state}"></span><div>
<p class="eyebrow">System status</p>
<h1 class="${stale ? 'degraded' : state}">${stale ? 'Status feed delayed' : banner}</h1>
<p class="sub">${services.length} services · <b>${total24.toLocaleString('en-US')}</b> checks in the last 24 hours, every 5 minutes from outside our network${firstDay ? ` · data since ${fmtDate(Date.parse(firstDay + 'T12:00:00Z'))}` : ''} · updated <b>${fmtTime(roll.generated * 1e3)}</b></p>
</div></section>
${open.length ? `<h2>Active incidents</h2>${open.map(incidentHtml).join('')}` : ''}
${groups.map(g => `<h2>${esc(g.name)}<span>${g.items.length} ${g.items.length === 1 ? 'service' : 'services'}</span></h2><div class="group">${g.items.map(rowHtml).join('')}</div>`).join('')}
<h2>Incident log<span>last 7 days</span></h2>
<section class="log">${dayList.map(d => `<div class="day"><h3>${d.label}</h3><div>${d.inc.length ? d.inc.map(incidentHtml).join('') : '<p class="none">No incidents reported.</p>'}</div></div>`).join('')}
${older.length ? `<div class="day"><h3>Earlier</h3><div>${older.map(incidentHtml).join('')}</div></div>` : ''}</section>
<footer><span>Agency customers: 99.5% monthly uptime commitment on the agency platform and API (<a href="https://protoquiz.com/legal/msa.html">MSA §7.5</a>).</span>
<span><a href="https://github.com/${OWNER}/${REPO}/issues">Incident feed</a> · <a href="https://github.com/${OWNER}/${REPO}/issues.atom">RSS</a> · <a href="https://github.com/${OWNER}/${REPO}/blob/data/rollup.json">Raw data</a></span></footer>
</main></body></html>`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
writeFileSync('dist/CNAME', CNAME + '\n');
writeFileSync('dist/.nojekyll', '');
console.log(`built: ${services.length} services, ${total24} checks/24h, ${events.length} incidents, state=${state}${stale ? ' (feed stale)' : ''}`);

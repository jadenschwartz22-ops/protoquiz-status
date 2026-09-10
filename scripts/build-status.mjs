// Builds dist/index.html (the public status page) from Upptime's data in this repo.
// Upptime commits history/<slug>.yml only when a site's status CHANGES (plus roughly one
// refresh a day), so commits are status transitions, not a per-check log. Uptime is
// therefore computed from status intervals (down from a red commit until the next green
// one), and response time is charted as a daily average of whatever samples exist.
// Incidents are GitHub issues labelled "status". No runtime JS, no API calls from the browser.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import yaml from 'js-yaml';

const DAYS = 90, TZ = 'America/New_York';
const cfg = yaml.load(readFileSync('.upptimerc.yml', 'utf8'));
const incidents = JSON.parse(readFileSync(process.env.INCIDENTS_JSON || 'incidents.json', 'utf8'));
const now = Date.now();
const dayKey = t => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
const fmtDate = t => new Date(t).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
const fmtTime = t => new Date(t).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function checks(slug) {
  const out = execSync(`git log --since="${DAYS + 1} days ago" --format=%at%x09%s -- history/${slug}.yml`, { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map(l => {
    const [ts, msg] = l.split('\t');
    const status = msg.startsWith('🟥') ? 'down' : msg.startsWith('🟨') ? 'degraded' : 'up';
    const ms = Number((msg.match(/in (\d+) ms/) || [])[1] || 0);
    return { t: Number(ts) * 1000, status, ms };
  });
}
// rows are newest-first status transitions. Uptime over [from, now] = 1 - time spent down.
const uptimeOver = (rows, from) => {
  const asc = rows.slice().sort((a, b) => a.t - b.t);
  if (!asc.length) return null;
  let st = asc.filter(r => r.t <= from).at(-1)?.status ?? 'up', cursor = from, down = 0;
  for (const r of asc) { if (r.t <= from) continue; if (st === 'down') down += r.t - cursor; st = r.status; cursor = r.t; }
  if (st === 'down') down += now - cursor;
  return 100 * (1 - down / (now - from));
};
const fmtPct = p => p == null ? '—' : (p >= 99.995 ? '100' : p.toFixed(2)) + '%';

const services = cfg.sites.map(site => {
  const [group, label] = site.name.split(' · ');
  const hist = yaml.load(readFileSync(`history/${site.slug}.yml`, 'utf8'));
  const rows = checks(site.slug);
  const byDay = {};
  for (const r of rows) if (r.ms) (byDay[dayKey(r.t)] ||= []).push(r.ms);
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const t = now - i * 864e5, d = byDay[dayKey(t)];
    days.push({ date: fmtDate(t), ms: d ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null });
  }
  const known = days.filter(d => d.ms != null);
  return {
    group, label, url: site.url, status: hist.status,
    uptime: { d7: uptimeOver(rows, now - 7 * 864e5), d30: uptimeOver(rows, now - 30 * 864e5), d90: uptimeOver(rows, now - 90 * 864e5) },
    resp: hist.responseTime || (known.length ? known.at(-1).ms : null),
    avg30: known.length ? Math.round(known.reduce((a, d) => a + d.ms, 0) / known.length) : null,

    days, checked: hist.lastUpdated,
  };
});
const GROUP_LABEL = { 'Consumer App': 'Consumer App · iOS & Android', 'Agency Platform': 'Agency Platform · B2B' };
const groups = [...new Set(services.map(s => s.group))].map(g => ({ name: GROUP_LABEL[g] || g, short: g, items: services.filter(s => s.group === g) }));

const STATUS = { up: ['Operational', 'up'], degraded: ['Degraded performance', 'degraded'], down: ['Outage', 'down'] };
const worst = services.some(s => s.status === 'down') ? 'down' : services.some(s => s.status === 'degraded') ? 'degraded' : 'up';
const banner = { up: 'All systems operational', degraded: 'Some systems degraded', down: 'Service disruption' }[worst];
const open = incidents.filter(i => i.state === 'open');
const recent = incidents.filter(i => i.state !== 'open' && Date.parse(i.created_at) > now - 90 * 864e5);
const cleanTitle = t => t.replace(/[\u{1F6D1}⚠️✅]/gu, '').trim();

const incidentHtml = (i) => {
  const closed = i.closed_at ? Date.parse(i.closed_at) : null, opened = Date.parse(i.created_at);
  const dur = closed ? Math.round((closed - opened) / 6e4) : null;
  return `<article class="incident ${i.state}">
    <h4><a href="${esc(i.html_url)}">${esc(cleanTitle(i.title))}</a></h4>
    <p class="m">${closed ? `Resolved in ${dur >= 60 ? Math.floor(dur / 60) + ' h ' + (dur % 60) + ' min' : dur + ' min'} · ${fmtTime(opened)} to ${fmtTime(closed)}` : `Investigating since ${fmtTime(opened)}`}</p>
  </article>`;
};
const byDayInc = {};
for (const i of recent) (byDayInc[dayKey(Date.parse(i.created_at))] ||= []).push(i);
const dayList = [];
for (let d = 0; d < 14; d++) { const t = now - d * 864e5, k = dayKey(t); dayList.push({ label: fmtDate(t), inc: byDayInc[k] || [] }); }
const older = recent.filter(i => Date.parse(i.created_at) < now - 14 * 864e5);

const spark = (ms) => {
  if (ms.length < 2) return '';
  const w = 120, h = 28, max = Math.max(...ms, 1), min = Math.min(...ms);
  const pts = ms.map((v, i) => `${(i / (ms.length - 1) * w).toFixed(1)},${(h - 2 - (v - min) / Math.max(max - min, 1) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-label="24-hour response time"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
};
const chart = (s) => {
  const pts = s.days.map((d, i) => ({ i, ms: d.ms })).filter(p => p.ms != null);
  if (pts.length < 2) return `<div class="chart empty">Collecting data</div>`;
  const w = 1000, ht = 64, pad = 6, max = Math.max(...pts.map(p => p.ms));
  const x = i => (i / (s.days.length - 1) * w).toFixed(1), y = v => (ht - pad - v / Math.max(max, 1) * (ht - 2 * pad)).toFixed(1);
  const line = pts.map((p, k) => (k ? 'L' : 'M') + x(p.i) + ' ' + y(p.ms)).join(' ');
  const area = line + ` L${x(pts.at(-1).i)} ${ht} L${x(pts[0].i)} ${ht} Z`;
  return `<svg class="chart" viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" aria-label="Daily average response time, last 30 days"><path d="${area}" class="fill"/><path d="${line}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
};
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ProtoQuiz Status</title>
<meta name="description" content="Live availability and incident history for ProtoQuiz: the consumer app, the agency platform, and the EMS Census.">
<meta name="theme-color" content="#06050a">
<link rel="icon" href="https://protoquiz.com/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="https://protoquiz.com/favicon-32.png"><link rel="icon" type="image/png" sizes="192x192" href="https://protoquiz.com/favicon-192.png"><link rel="apple-touch-icon" href="https://protoquiz.com/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="ProtoQuiz incidents" href="https://github.com/${cfg.owner}/${cfg.repo}/issues.atom">
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
</style></head><body>
<header><div class="wrap"><a class="brand" href="/"><img src="https://protoquiz.com/logo-128.png" alt="">ProtoQuiz&trade; <span>Status</span></a>
<nav><a href="https://protoquiz.com">Website</a><a href="https://protoquiz.com/agency/">For agencies</a><a href="https://protoquiz.com/census/">Census</a><a href="https://protoquiz.com/trust/">Trust</a></nav></div></header>
<main class="wrap">
<section class="hero">
<p class="eyebrow">System status</p>
<h1 class="${worst}">${banner}</h1>
<p class="sub">${services.length} services · ${process.env.CHECKS_24H ? `${process.env.CHECKS_24H} checks in the last 24 hours` : 'checked around the clock'} from outside our network · updated <b>${fmtTime(now)}</b></p>
</section>
${open.length ? `<h2>Active incidents</h2>${open.map(incidentHtml).join('')}` : ''}
${groups.map(g => `<h2>${esc(g.name)}<span>${g.items.length} ${g.items.length === 1 ? 'service' : 'services'}</span></h2><div class="group">${g.items.map(s => `
<div class="row"><div class="top"><span class="name"><a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a></span><span class="pill ${STATUS[s.status]?.[1] || 'up'}">${STATUS[s.status]?.[0] || 'Operational'}</span></div>
${chart(s)}
<div class="meta"><span>Daily response time, 30 days</span><b>${fmtPct(s.uptime.d30)} uptime · ${s.avg30 == null ? '—' : s.avg30 + ' ms'} avg</b></div></div>`).join('')}</div>`).join('')}
<h2>Incident log<span>last 14 days</span></h2>
<section class="log">${dayList.map(d => `<div class="day"><h3>${d.label}</h3><div>${d.inc.length ? d.inc.map(incidentHtml).join('') : '<p class="none">No incidents reported.</p>'}</div></div>`).join('')}
${older.length ? `<div class="day"><h3>Earlier</h3><div>${older.map(incidentHtml).join('')}</div></div>` : ''}</section>
<footer><span>Agency customers: 99.5% monthly uptime commitment on the agency platform and API (<a href="https://protoquiz.com/legal/msa.html">MSA §7.5</a>).</span>
<span><a href="https://github.com/${cfg.owner}/${cfg.repo}/issues">Incident feed</a> · <a href="https://github.com/${cfg.owner}/${cfg.repo}/issues.atom">RSS</a> · <a href="https://github.com/${cfg.owner}/${cfg.repo}">Raw data</a></span></footer>
</main></body></html>`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
writeFileSync('dist/CNAME', cfg['status-website'].cname + '\n');
writeFileSync('dist/.nojekyll', '');
console.log(`built: ${services.length} services, ${open.length} open / ${recent.length} recent incidents, worst=${worst}`);

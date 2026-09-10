// Builds dist/index.html (the public status page) from Upptime's data in this repo:
// per-check commits on history/<slug>.yml carry status + response time; open/closed
// GitHub issues (label "status") are incidents. No runtime JS, no API calls from the browser.
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
const pct = (rows) => rows.length ? (100 * rows.filter(r => r.status !== 'down').length / rows.length) : null;
const fmtPct = p => p == null ? '—' : (p >= 99.995 ? '100' : p.toFixed(2)) + '%';

const services = cfg.sites.map(site => {
  const [group, label] = site.name.split(' · ');
  const hist = yaml.load(readFileSync(`history/${site.slug}.yml`, 'utf8'));
  const rows = checks(site.slug);
  const byDay = {};
  for (const r of rows) (byDay[dayKey(r.t)] ||= []).push(r);
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const t = now - i * 864e5, k = dayKey(t), d = byDay[k] || [];
    const st = !d.length ? 'none' : d.some(r => r.status === 'down') ? 'down' : d.some(r => r.status === 'degraded') ? 'degraded' : 'up';
    days.push({ k, st, up: pct(d), n: d.length, date: fmtDate(t) });
  }
  const win = h => rows.filter(r => r.t > now - h * 36e5);
  const last24 = win(24);
  return {
    group, label, url: site.url, status: hist.status,
    uptime: { d1: pct(last24), d7: pct(win(24 * 7)), d30: pct(win(24 * 30)), d90: pct(rows) },
    resp: last24.length ? Math.round(last24.reduce((a, r) => a + r.ms, 0) / last24.length) : null,
    days, checked: hist.lastUpdated,
  };
});
const GROUP_LABEL = { 'Consumer App': 'Consumer App · iOS & Android', 'Agency Platform': 'Agency Platform · B2B' };
const groups = [...new Set(services.map(s => s.group))].map(g => ({ name: GROUP_LABEL[g] || g, items: services.filter(s => s.group === g) }));

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
    <p class="meta">${closed ? `Resolved in ${dur >= 60 ? Math.floor(dur / 60) + ' h ' + (dur % 60) + ' min' : dur + ' min'} · ${fmtTime(opened)} to ${fmtTime(closed)}` : `Investigating since ${fmtTime(opened)}`}</p>
  </article>`;
};
const byDayInc = {};
for (const i of recent) (byDayInc[dayKey(Date.parse(i.created_at))] ||= []).push(i);
const dayList = [];
for (let d = 0; d < 14; d++) { const t = now - d * 864e5, k = dayKey(t); dayList.push({ label: fmtDate(t), inc: byDayInc[k] || [] }); }
const older = recent.filter(i => Date.parse(i.created_at) < now - 14 * 864e5);

const bar = s => `<div class="bar" role="img" aria-label="90-day availability">${s.days.map(d =>
  `<i class="${d.st}" title="${d.date}${d.n ? `: ${fmtPct(d.up)} uptime, ${d.n} checks` : ': no data'}"></i>`).join('')}</div>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ProtoQuiz Status</title>
<meta name="description" content="Live availability and incident history for ProtoQuiz: the consumer app, the agency platform, and the EMS Census.">
<link rel="icon" href="https://protoquiz.com/logo-192.png">
<link rel="alternate" type="application/rss+xml" title="ProtoQuiz incidents" href="https://github.com/${cfg.owner}/${cfg.repo}/issues.atom">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#fff;--ink:#17171a;--muted:#6b6f76;--line:#e6e7ea;--soft:#f6f7f8;--up:#1f9d55;--up-bg:#e8f6ee;--deg:#d99a00;--deg-bg:#fff6e0;--down:#d13c3c;--down-bg:#fdecec;--none:#e2e4e8;--accent:#ffb000}
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 Inter,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}.wrap{max-width:900px;margin:0 auto;padding:0 24px}
header{border-bottom:1px solid var(--line)}header .wrap{display:flex;align-items:center;justify-content:space-between;height:64px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;text-decoration:none;font-size:16px}.brand img{width:28px;height:28px;border-radius:6px}
nav a{color:var(--muted);text-decoration:none;font-size:14px;margin-left:22px}nav a:hover{color:var(--ink)}
.banner{margin:32px 0 28px;padding:16px 20px;border-radius:8px;font-weight:600;font-size:17px;display:flex;justify-content:space-between;align-items:center}
.banner.up{background:var(--up-bg);color:#14532d}.banner.degraded{background:var(--deg-bg);color:#6b4b00}.banner.down{background:var(--down-bg);color:#7f1d1d}
.banner small{font-weight:400;font-size:13px;opacity:.8}
h2{font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:32px 0 10px}
.group{border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:18px}
.row{padding:16px 20px;border-top:1px solid var(--line)}.row:first-child{border-top:0}
.row .top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.row .name{font-weight:600}.row .name a{text-decoration:none}.row .name a:hover{text-decoration:underline}
.pill{font-size:13px;font-weight:600;white-space:nowrap}.pill.up{color:var(--up)}.pill.degraded{color:var(--deg)}.pill.down{color:var(--down)}
.bar{display:flex;gap:2px;margin:10px 0 6px;height:30px}.bar i{flex:1;border-radius:2px;background:var(--none);min-width:3px}
.bar i.up{background:var(--up)}.bar i.degraded{background:var(--deg)}.bar i.down{background:var(--down)}
.legend{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}.legend b{font-weight:500;color:var(--ink)}
.stats{display:flex;gap:18px;font-size:12px;color:var(--muted);margin-top:4px;flex-wrap:wrap}.stats span b{color:var(--ink);font-weight:500;font-variant-numeric:tabular-nums}
.day{padding:14px 0;border-top:1px solid var(--line)}.day:first-of-type{border-top:0}.day h3{font-size:14px;margin:0 0 4px}.day p.none{margin:0;color:var(--muted);font-size:14px}
.incident{padding:10px 14px;margin:8px 0;border-left:3px solid var(--down);background:var(--soft);border-radius:0 6px 6px 0}.incident.open{border-color:var(--deg);background:var(--deg-bg)}
.incident h4{margin:0;font-size:14px}.incident h4 a{text-decoration:none}.incident .meta{margin:2px 0 0;font-size:13px;color:var(--muted)}
footer{margin:48px 0 40px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--muted);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}footer a{color:var(--muted)}
@media(max-width:600px){nav a{margin-left:14px}.banner{font-size:15px}.stats{gap:12px}}
</style></head><body>
<header><div class="wrap"><a class="brand" href="/"><img src="https://protoquiz.com/logo-256.png" alt="">ProtoQuiz Status</a>
<nav><a href="https://protoquiz.com">Website</a><a href="https://protoquiz.com/agency/">Agency platform</a><a href="https://protoquiz.com/census/">EMS Census</a><a href="https://protoquiz.com/trust/">Trust &amp; Security</a></nav></div></header>
<main class="wrap">
<div class="banner ${worst}"><span>${banner}</span><small>Checked every 5 minutes · updated ${fmtTime(now)}</small></div>
${open.length ? `<h2>Active incidents</h2>${open.map(incidentHtml).join('')}` : ''}
${groups.map(g => `<h2>${esc(g.name)}</h2><div class="group">${g.items.map(s => `
<div class="row"><div class="top"><span class="name"><a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a></span><span class="pill ${STATUS[s.status]?.[1] || 'up'}">${STATUS[s.status]?.[0] || 'Operational'}</span></div>
${bar(s)}
<div class="legend"><span>90 days ago</span><b>${fmtPct(s.uptime.d90)} uptime</b><span>Today</span></div>
<div class="stats"><span>24h <b>${fmtPct(s.uptime.d1)}</b></span><span>7d <b>${fmtPct(s.uptime.d7)}</b></span><span>30d <b>${fmtPct(s.uptime.d30)}</b></span><span>Response <b>${s.resp == null ? '—' : s.resp + ' ms'}</b></span></div></div>`).join('')}</div>`).join('')}
<h2>Past incidents</h2>
<section>${dayList.map(d => `<div class="day"><h3>${d.label}</h3>${d.inc.length ? d.inc.map(incidentHtml).join('') : '<p class="none">No incidents reported.</p>'}</div>`).join('')}
${older.length ? `<div class="day"><h3>Earlier</h3>${older.map(incidentHtml).join('')}</div>` : ''}</section>
<footer><span>Agency customers: 99.5% monthly uptime commitment on the agency platform and API (<a href="https://protoquiz.com/legal/msa.html">MSA §7.5</a>).</span>
<span><a href="https://github.com/${cfg.owner}/${cfg.repo}/issues">Incident feed</a> · <a href="https://github.com/${cfg.owner}/${cfg.repo}/issues.atom">RSS</a> · <a href="https://github.com/${cfg.owner}/${cfg.repo}">Data</a></span></footer>
</main></body></html>`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
writeFileSync('dist/CNAME', cfg['status-website'].cname + '\n');
writeFileSync('dist/.nojekyll', '');
console.log(`built: ${services.length} services, ${open.length} open / ${recent.length} recent incidents, worst=${worst}`);

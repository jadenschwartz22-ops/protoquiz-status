# protoquiz-status — Claude Context

Upptime status page for ProtoQuiz. Built from the `upptime/upptime` template, configured for protoquiz.com surfaces. Self-hosted on GitHub Pages + GitHub Actions, zero $ recurring cost.

**Live URL:** https://status.protoquiz.com (HTTP works, HTTPS provisions automatically)

## What it monitors

`.upptimerc.yml` lists the surfaces. Update there + push to add/remove sites. Currently:

- protoquiz.com (marketing)
- protoquiz.com/agency/ (B2B landing)
- protoquiz.com/trust/ (security page)
- protoquiz.com/b2b/terms/
- api.protoquiz.com/api/monitor?type=health (backend, expects 200)
- highland.protoquiz.com (B2B reference customer)
- southmetro.protoquiz.com (B2B demo)

## How it works

GitHub Actions cron triggers `uptime.yml` every 5 minutes. The workflow hits each URL, records the result in `history/{site-slug}.yml`, and commits back to `main` using the `GH_PAT` secret. A separate `site.yml` workflow rebuilds the static SPA into `gh-pages` branch, which GitHub Pages serves.

`graphs.yml`, `summary.yml`, `response-time.yml` run nightly to regenerate visualizations.

## Repo wiring

- `GH_PAT` secret: reused the personal `gh auth token` (gho_*) — has repo + workflow scope, can commit back to main and trigger gh-pages rebuilds
- Default branch: `main` (template's was `master` — switched after first push)
- Cloudflare DNS: `status` CNAME → `jadenschwartz22-ops.github.io` (not proxied; GitHub Pages issues its own SSL via Let's Encrypt)

## Common ops

```bash
# Add or remove a monitored site → edit .upptimerc.yml, push.
git add .upptimerc.yml && git commit -m "monitor: ..." && git push

# Manually trigger an uptime check (instead of waiting for the 5-min cron)
gh workflow run uptime.yml

# Manually rebuild the static page
gh workflow run site.yml

# See recent runs / debug failures
gh run list --limit 10
gh run view <run-id> --log
```

## Notifications

Not yet wired. To enable Discord alerts on outages:
1. Get a Discord webhook URL for the channel
2. `gh secret set DISCORD_WEBHOOK_URL`
3. Uncomment the `notifications:` block in `.upptimerc.yml` and push

## Linked from

- protoquiz.com/trust (Service Level badge)
- protoquiz.com/agency (footer Trust column)
- Future: B2B MSA (when we update it to cite the status page URL alongside §7.5 SLA)

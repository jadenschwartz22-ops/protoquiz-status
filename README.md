# ProtoQuiz Status

Source for [status.protoquiz.com](https://status.protoquiz.com). Every number on the page is a real probe result.

How it works:

- A Raspberry Pi outside our cloud probes every service every 5 minutes (App Store listing hourly): Consumer App API, Agency web app (every live org host), Agency API, Protocol AI (5xx share), Website, EMS Census. One probe feeds both the page and the Discord down-alert. Probe code: `scripts/pi/pq-probe.mjs` in the private B2B repo.
- Every 15 minutes the Pi pushes `rollup.json` to the [`data` branch](https://github.com/jadenschwartz22-ops/protoquiz-status/blob/data/rollup.json): per service per day, checks, failures, p50/p95 response time and down intervals, 90 days.
- The Pi then runs `scripts/build-status.mjs` (this repo, `main`) on that file and pushes `dist/` to the `status-site` branch, which GitHub Pages serves. No GitHub Actions run here.
- Down = 2 or more consecutive failed checks. Incidents on the page are those down intervals plus issues labelled `status`.

Upptime (the previous monitor) is retired: its workflows are disabled, and its `history/` and `graphs/` are kept as the pre-2026-10-07 record. `.upptimerc.yml` is inert.

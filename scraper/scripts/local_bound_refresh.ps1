# Local Bound stat refresh — runs from a Windows scheduled task on a machine
# whose IP Bound (gobound.com) still answers. GitHub's runners get a bot
# challenge, so the cron scrape indexes 0 Bound games and carries old stat
# lines forward; without this job, Player of the Week and the box scores
# freeze at whatever the last local run produced (twelve days, Sep 2026).
#
# What it does: pulls main, re-runs the per-game stat merges
# (scripts/refresh_bound.py: Bound, then MaxPreps layered on top), runs the
# data gate, commits data/ and pushes with the same rebase-retry the cron
# uses. Skips itself when the checkout is not on main or data/ has local
# edits, so it never fights a dev session. Log:
#   %LOCALAPPDATA%\wpr-prep-sports\bound-refresh.log
#
# Setup / checks: docs/operations.md, "Local Bound refresh".
#
# Usage (manual):  powershell -File scraper\scripts\local_bound_refresh.ps1
#                  powershell -File scraper\scripts\local_bound_refresh.ps1 -Sport football -Sport volleyball

param([string[]]$Sport)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # scripts -> scraper -> repo
$py = Join-Path $repo 'scraper\.venv\Scripts\python.exe'
$logDir = Join-Path $env:LOCALAPPDATA 'wpr-prep-sports'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'bound-refresh.log'
if ((Test-Path $log) -and (Get-Item $log).Length -gt 2MB) {
  Move-Item -Force $log ($log + '.1')
}

function Log([string]$m) {
  $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $m
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Host $line
}
# Native commands go through cmd so stderr lands in the log as text instead
# of PowerShell 5.1 wrapping every stderr line in an ErrorRecord.
function Native([string]$cmdline) {
  cmd /c "$cmdline >> `"$log`" 2>&1"
  return $LASTEXITCODE
}

# Sports Bound covers, by month. Football Aug-Nov, basketball Nov-Mar
# (November overlaps: playoffs finish as tip-off arrives). Volleyball is
# left out on purpose: Bound has next to no volleyball coverage and the
# cron's MaxPreps pass already carries that sport.
if (-not $Sport) {
  $m = (Get-Date).Month
  $Sport = @()
  if ($m -ge 8 -and $m -le 11) { $Sport += 'football' }
  if ($m -ge 11 -or $m -le 3) { $Sport += 'boys_basketball', 'girls_basketball' }
  if ($Sport.Count -eq 0) { Log "off-season (month $m): nothing to refresh"; exit 0 }
}

Set-Location $repo
if (-not (Test-Path $py)) { Log "abort: scraper venv missing at $py"; exit 1 }

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { Log "skip: checkout is on '$branch', not main"; exit 0 }
if (git status --porcelain -- data) { Log "skip: data/ has uncommitted local changes"; exit 0 }

Log "start: $($Sport -join ' ')"
if ((Native 'git pull -q --ff-only origin main') -ne 0) { Log "abort: git pull --ff-only failed (diverged checkout or offline)"; exit 1 }

$sportArgs = ($Sport | ForEach-Object { "--sport $_" }) -join ' '
Set-Location (Join-Path $repo 'scraper')
if ((Native "`"$py`" scripts\refresh_bound.py $sportArgs") -ne 0) { Log "abort: refresh_bound.py failed"; Set-Location $repo; git checkout -q -- data; exit 1 }
if ((Native "`"$py`" scripts\validate_data.py") -ne 0) { Log "abort: validate_data.py failed; discarding this refresh"; Set-Location $repo; git checkout -q -- data; exit 1 }
Set-Location $repo

git add -- data
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Log "done: no stat changes"; exit 0 }

$stamp = Get-Date -Format 'yyyy-MM-ddTHH:mm'
git commit -q -m "data: local Bound refresh $stamp ($($Sport -join ' '))"
for ($attempt = 1; $attempt -le 3; $attempt++) {
  if ((Native 'git push -q origin main') -eq 0) { Log "done: pushed $(git rev-parse --short HEAD)"; exit 0 }
  Log "push rejected (attempt $attempt): rebasing"
  if ((Native 'git pull --rebase origin main') -ne 0) {
    # A conflict means the cron rewrote the same files since we pulled.
    # This refresh is superseded: drop the commit, restore data/ to
    # origin, leave any other local edits alone. Tomorrow's run redoes it.
    Native 'git rebase --abort' | Out-Null
    git reset -q --mixed HEAD~1
    git checkout -q -- data
    Native 'git pull -q --ff-only origin main' | Out-Null
    Log "abort: rebase conflict; refresh discarded (next run redoes it)"
    exit 1
  }
}
Log "abort: push rejected three times; commit left in place for the next run to carry"
exit 1

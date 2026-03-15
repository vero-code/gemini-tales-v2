# Run from backend/agents: .\run_local.ps1

# 1. Port Cleanup
Write-Host "--- Cleaning up ports 8001-8004 ---" -ForegroundColor Yellow
8001..8004 | ForEach-Object {
    $port = $_
    $netstat = netstat -ano | Select-String ":$port\s"
    foreach ($line in $netstat) {
        if ($line.ToString() -match '\s+(\d+)$') {
            $p = $Matches[1]
            if ($p -ne "0") {
                Write-Host "Stopping process $p on port $port" -ForegroundColor Gray
                try { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } catch {}
            }
        }
    }
}

# 2. Load .env (from main app folder)
Write-Host "--- Loading environment variables ---" -ForegroundColor Yellow
$envPath = "../app/.env"
if (Test-Path $envPath) {
    Get-Content $envPath -Encoding UTF8 | Where-Object { $_ -notmatch '^\s*#' -and $_ -match '=' } | ForEach-Object {
        $line = $_.Trim()
        if ($line -match '^([^=]+)=(.*)$') {
            $key = $Matches[1].Trim()
            $value = $Matches[2].Trim()
            if ($value -match '^([^#]*)') { $value = $Matches[1].Trim() }
            if ($value -match '^"(.*)"$') { $value = $Matches[1] }
            elseif ($value -match "^'(.*)'$") { $value = $Matches[1] }
            [System.Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}

function Start-Agent($name, $agentArgs) {
    Write-Host "Starting $name..." -ForegroundColor Cyan
    $command = "cd '$PWD'; uv run python $agentArgs"
    Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "$command" -PassThru
}

$procs = @()

# 3. Start A2A Agents
$procs += Start-Agent "Researcher (8001)"      "adk_app.py researcher --host 0.0.0.0 --port 8001 --a2a"
$procs += Start-Agent "Judge (8002)"           "adk_app.py judge --host 0.0.0.0 --port 8002 --a2a"
$procs += Start-Agent "Content Builder (8003)" "adk_app.py content_builder --host 0.0.0.0 --port 8003 --a2a"

Write-Host "Waiting 5 seconds for agents to wake up..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# 4. Start Orchestrator
$procs += Start-Agent "Orchestrator (8004)"    "adk_app.py orchestrator --host 0.0.0.0 --port 8004"

Write-Host ""
Write-Host "All systems are up and running!" -ForegroundColor Green
Write-Host "Main UI: http://localhost:8000" -ForegroundColor White
Write-Host ""

try {
    Write-Host "Press Ctrl+C to stop all services..." -ForegroundColor White
    while ($procs | Where-Object { -not $_.HasExited }) {
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host "`n--- Stopping all services ---" -ForegroundColor Red
    foreach ($p in $procs) {
        if ($null -ne $p -and -not $p.HasExited) {
            taskkill /F /T /PID $p.Id 2>$null
            # taskkill /F /T /PID $p.Id > $null 2>&1
        }
    }
    Write-Host "All services stopped." -ForegroundColor Red
}

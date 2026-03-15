# Run from backend/agents: .\deploy.ps1
$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $SCRIPT_DIR

if (Test-Path "../app/.env") {
    Write-Host "Loading .env file from app folder..."
    Get-Content "../app/.env" | Where-Object { $_ -match '=' -and -not $_.StartsWith('#') } | ForEach-Object {
        $name, $value = $_.Split('=', 2)
        $name = $name.Trim()
        $value = $value.Trim()
        [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
        Set-Item -Path "Env:\$name" -Value $value
    }
}

$GOOGLE_CLOUD_PROJECT = $env:GOOGLE_CLOUD_PROJECT
if (-not $GOOGLE_CLOUD_PROJECT) {
    $GOOGLE_CLOUD_PROJECT = (gcloud config get-value project -q)
}
if (-not $GOOGLE_CLOUD_PROJECT) {
    Write-Host "ERROR: Set GOOGLE_CLOUD_PROJECT environment variable." -ForegroundColor Red
    exit 1
}

$REGION = $env:GOOGLE_CLOUD_LOCATION
if ($REGION -eq "global" -or -not $REGION) {
    $REGION = (gcloud config get-value compute/region -q)
    if (-not $REGION) {
        $REGION = "us-central1"
    }
}

Write-Host "Using project: $GOOGLE_CLOUD_PROJECT"
Write-Host "Using region: $REGION"

$agents = @("researcher", "judge", "content_builder", "orchestrator")

try {
    Write-Host "Preparing shared files for agents..." -ForegroundColor Cyan
    foreach ($agent in $agents) {
        if (Test-Path "$agent") {
            # Copy shared folder
            $destShared = "$agent/shared"
            if (-not (Test-Path $destShared)) { New-Item -ItemType Directory -Path $destShared -Force }
            Copy-Item -Path "shared/*" -Destination $destShared -Force -Recurse
            
            # Copy adk_app.py to agent root
            Copy-Item -Path "adk_app.py" -Destination "$agent/" -Force
        }
    }

    Write-Host "`n--- Deploying Researcher ---" -ForegroundColor Cyan
    gcloud run deploy researcher --source "researcher" --project $GOOGLE_CLOUD_PROJECT --region $REGION --no-allow-unauthenticated

    Write-Host "`n--- Deploying Content Builder ---" -ForegroundColor Cyan
    gcloud run deploy content-builder --source "content_builder" --project $GOOGLE_CLOUD_PROJECT --region $REGION --no-allow-unauthenticated

    Write-Host "`n--- Deploying Judge ---" -ForegroundColor Cyan
    gcloud run deploy judge --source "judge" --project $GOOGLE_CLOUD_PROJECT --region $REGION --no-allow-unauthenticated

    Write-Host "`n--- Deploying Orchestrator ---" -ForegroundColor Cyan
    gcloud run deploy orchestrator --source "orchestrator" --project $GOOGLE_CLOUD_PROJECT --region $REGION --no-allow-unauthenticated

    Write-Host "`nAGENT DEPLOYMENT COMPLETE!" -ForegroundColor Green
}
finally {
    Write-Host "`nCleaning up shared files..."
    foreach ($agent in $agents) {
        Remove-Item -Path "$agent/adk_app.py" -ErrorAction SilentlyContinue
        Remove-Item -Path "$agent/shared" -Recurse -Force -ErrorAction SilentlyContinue
    }
}

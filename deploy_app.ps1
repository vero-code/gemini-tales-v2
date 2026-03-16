# Run from root: .\deploy_app.ps1
$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $SCRIPT_DIR

# Load configuration from backend/app/.env
if (Test-Path "backend/app/.env") {
    Write-Host "Loading configuration from backend/app/.env..." -ForegroundColor Gray
    Get-Content "backend/app/.env" | Where-Object { $_ -match '=' -and -not $_.StartsWith('#') } | ForEach-Object {
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
    Write-Host "ERROR: Set GOOGLE_CLOUD_PROJECT environment variable or run 'gcloud config set project'." -ForegroundColor Red
    exit 1
}

$REGION = $env:GOOGLE_CLOUD_LOCATION
if ($REGION -eq "global" -or -not $REGION) {
    $REGION = (gcloud config get-value compute/region -q)
    if (-not $REGION) {
        $REGION = "us-central1"
    }
}

Write-Host "`n--- Preparing Frontend Environment ---" -ForegroundColor Cyan
# Create/Update .env.production for the frontend build
$envProdContent = "VITE_GCP_PROJECT=$GOOGLE_CLOUD_PROJECT`n"
if ($env:MODEL_ID) { $envProdContent += "VITE_MODEL_ID=$($env:MODEL_ID)`n" }
if ($env:VITE_MODEL_ID_IMAGE) { $envProdContent += "VITE_MODEL_ID_IMAGE=$($env:VITE_MODEL_ID_IMAGE)`n" }
if ($env:GEMINI_API_KEY) { $envProdContent += "VITE_GEMINI_API_KEY=$($env:GEMINI_API_KEY)`n" }
$envProdContent | Out-File -FilePath "frontend/.env.production" -Encoding UTF8

Write-Host "`n--- Preparing Deployment Context ---" -ForegroundColor Cyan
# Copy Dockerfile to root so gcloud can find it automatically
Copy-Item -Path "backend/app/Dockerfile" -Destination "./Dockerfile" -Force

# Build-time environment variables for Vite (crucial for React build)
# We map from .env names to VITE_ names expected by App.tsx and the Dockerfile
$buildVars = "VITE_GCP_PROJECT=$GOOGLE_CLOUD_PROJECT"
if ($env:MODEL_ID) { $buildVars += ",VITE_MODEL_ID=$($env:MODEL_ID)" }
if ($env:VITE_MODEL_ID_IMAGE) { $buildVars += ",VITE_MODEL_ID_IMAGE=$($env:VITE_MODEL_ID_IMAGE)" }
if ($env:GEMINI_API_KEY) { $buildVars += ",VITE_GEMINI_API_KEY=$($env:GEMINI_API_KEY)" }

# Runtime variables for the Python backend
$runVars = "GOOGLE_CLOUD_PROJECT=$GOOGLE_CLOUD_PROJECT,GOOGLE_CLOUD_LOCATION=$REGION,GOOGLE_GENAI_USE_VERTEXAI=true"
if ($env:MODEL_ID) { $runVars += ",MODEL_ID=$($env:MODEL_ID)" }
if ($env:GEMINI_API_KEY) { $runVars += ",GEMINI_API_KEY=$($env:GEMINI_API_KEY)" }

try {
    Write-Host "`n--- Deploying Gemini Tales App (Puck + Frontend) ---" -ForegroundColor Cyan
    Write-Host "Project: $GOOGLE_CLOUD_PROJECT"
    Write-Host "Region:  $REGION"

    # Deploying from root context
    gcloud run deploy gemini-tales `
        --source . `
        --project $GOOGLE_CLOUD_PROJECT `
        --region $REGION `
        --allow-unauthenticated `
        --set-build-env-vars "$buildVars" `
        --set-env-vars "$runVars"

    Write-Host "`nAPP DEPLOYMENT COMPLETE!" -ForegroundColor Green
    Write-Host "Your Magic Mirror is live at the URL shown above."
}
finally {
    Write-Host "`nCleaning up temporary Dockerfile..." -ForegroundColor Gray
    Remove-Item -Path "./Dockerfile" -Force -ErrorAction SilentlyContinue
}

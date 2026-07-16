$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock] $Command,
    [Parameter(Mandatory = $true)]
    [string] $ErrorMessage
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw $ErrorMessage
  }
}

function Read-EnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name,
    [string] $Default = ""
  )

  $line = Get-Content ".env" -ErrorAction SilentlyContinue |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))=" } |
    Select-Object -First 1

  if (-not $line) {
    return $Default
  }

  return ($line -split "=", 2)[1].Trim().Trim('"').Trim("'")
}

$postgresContainer = $env:POSTGRES_CONTAINER
if (-not $postgresContainer) {
  $postgresContainer = "yana-postgres"
}

$redisContainer = $env:REDIS_CONTAINER
if (-not $redisContainer) {
  $redisContainer = "yana-redis"
}

$dbName = Read-EnvValue "POSTGRES_DB" "yana_ogo"
$dbUser = Read-EnvValue "POSTGRES_USER" "yana"
$dbPassword = Read-EnvValue "POSTGRES_PASSWORD" "yana_password"

Write-Host "Starting Docker services..."
Invoke-Checked { docker compose up -d } "Docker Compose could not start the local services. If the error mentions a container-name conflict, remove the old YANA containers with: docker rm -f yana-postgres yana-redis"

Write-Host "Waiting for Postgres..."
for ($i = 1; $i -le 30; $i++) {
  docker exec $postgresContainer pg_isready -U postgres | Out-Null
  if ($LASTEXITCODE -eq 0) {
    break
  }
  Start-Sleep -Seconds 2
}

Write-Host "Configuring Postgres database and user..."
$sql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$dbUser') THEN
    CREATE ROLE "$dbUser" LOGIN PASSWORD '$dbPassword';
  ELSE
    ALTER ROLE "$dbUser" WITH LOGIN PASSWORD '$dbPassword';
  END IF;
END
`$`$;
SELECT 'CREATE DATABASE "$dbName" OWNER "$dbUser"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$dbName')\gexec
GRANT ALL PRIVILEGES ON DATABASE "$dbName" TO "$dbUser";
"@

$sql | docker exec -i $postgresContainer psql -U postgres -d postgres
if ($LASTEXITCODE -ne 0) {
  throw "Could not configure Postgres inside Docker container '$postgresContainer'. Check the container name or set POSTGRES_CONTAINER before running this script."
}

Write-Host "Checking Redis..."
Invoke-Checked { docker exec $redisContainer redis-cli ping } "Could not reach Redis inside Docker container '$redisContainer'. Check the container name or set REDIS_CONTAINER before running this script."

Write-Host "Installing Windows dependencies if needed..."
Invoke-Checked { npm.cmd install --cache .\.npm-cache } "npm install failed."

Write-Host "Running database migrations..."
Invoke-Checked { npm.cmd run db:migrate } "Database migrations failed."

Write-Host "Building app..."
Invoke-Checked { npm.cmd run build } "Build failed."

Write-Host ""
Write-Host "YANA local setup is ready."
Write-Host "Start the app with: npm.cmd run dev"
Write-Host "Health check: http://localhost:3000/health"

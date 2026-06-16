param(
    [ValidateSet("up", "refresh", "down", "status", "logs")]
    [string]$Action = "up"
)

$ErrorActionPreference = "Stop"

$projectPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dockerRoot = "C:\docker"
$dockerPath = Join-Path $dockerRoot "medicoes-crud"

New-Item -ItemType Directory -Path $dockerRoot -Force | Out-Null

if (Test-Path -LiteralPath $dockerPath) {
    $item = Get-Item -LiteralPath $dockerPath
    $currentTarget = @($item.Target)[0]
    if ($item.LinkType -ne "Junction" -or $currentTarget -ne $projectPath) {
        throw "$dockerPath existe, mas não aponta para $projectPath."
    }
} else {
    New-Item -ItemType Junction -Path $dockerPath -Target $projectPath | Out-Null
}

Push-Location $dockerPath
try {
    switch ($Action) {
        "up" {
            docker compose up -d --build
        }
        "refresh" {
            docker compose up -d --build --force-recreate etl web
        }
        "down" {
            docker compose down
        }
        "status" {
            docker compose ps -a
        }
        "logs" {
            docker compose logs --tail 200
        }
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose terminou com o código $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

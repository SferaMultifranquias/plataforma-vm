$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$port = 3210
$baseUrl = "http://127.0.0.1:$port"

$job = Start-Job -ScriptBlock {
    param($root, $jobPort)
    Set-Location $root
    $env:PORT = [string]$jobPort
    node server.js *> $null
} -ArgumentList $projectRoot, $port

try {
    Start-Sleep -Seconds 3

    $healthOk = $false
    $lastError = $null
    for ($i = 0; $i -lt 20; $i++) {
        try {
            $healthResponse = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 3
            if ($healthResponse.ok -eq $true) {
                $healthOk = $true
                break
            }
            $lastError = "Resposta inesperada em /api/health"
        } catch {
            $lastError = $_.Exception.Message
            Start-Sleep -Milliseconds 500
        }
    }

    if (-not $healthOk) {
        throw "Smoke test falhou em /api/health: $lastError"
    }

    $configResponse = Invoke-RestMethod -Uri "$baseUrl/api/config" -TimeoutSec 3
    if ($null -eq $configResponse) {
        throw 'Smoke test falhou: /api/config sem resposta valida.'
    }

    $indexResponse = Invoke-WebRequest -Uri "$baseUrl/pedidos" -TimeoutSec 3
    if ($indexResponse.StatusCode -ne 200 -or -not ($indexResponse.Content -match 'Sfera VM - Sistema de Controle de Pedidos')) {
        throw 'Smoke test falhou: /pedidos nao retornou index.html.'
    }

    $loginResponse = Invoke-WebRequest -Uri "$baseUrl/login" -TimeoutSec 3
    if ($loginResponse.StatusCode -ne 200 -or -not ($loginResponse.Content -match 'Sfera VM - Sistema de Controle de Pedidos')) {
        throw 'Smoke test falhou: /login nao retornou index.html.'
    }

    $dashboardResponse = Invoke-WebRequest -Uri "$baseUrl/dashboard" -TimeoutSec 3
    if ($dashboardResponse.StatusCode -ne 200 -or -not ($dashboardResponse.Content -match 'Sfera VM - Sistema de Controle de Pedidos')) {
        throw 'Smoke test falhou: /dashboard nao retornou index.html.'
    }

    $newOrderResponse = Invoke-WebRequest -Uri "$baseUrl/novo-pedido" -TimeoutSec 3
    if ($newOrderResponse.StatusCode -ne 200 -or -not ($newOrderResponse.Content -match 'Sfera VM - Sistema de Controle de Pedidos')) {
        throw 'Smoke test falhou: /novo-pedido nao retornou index.html.'
    }

    $storesResponse = Invoke-WebRequest -Uri "$baseUrl/lojas" -TimeoutSec 3
    if ($storesResponse.StatusCode -ne 200 -or -not ($storesResponse.Content -match 'Sfera VM - Sistema de Controle de Pedidos')) {
        throw 'Smoke test falhou: /lojas nao retornou index.html.'
    }

    $usersResponse = Invoke-WebRequest -Uri "$baseUrl/usuarios" -TimeoutSec 3
    if ($usersResponse.StatusCode -ne 200 -or -not ($usersResponse.Content -match 'Sfera VM - Sistema de Controle de Pedidos')) {
        throw 'Smoke test falhou: /usuarios nao retornou index.html.'
    }

    $estoqueResponse = Invoke-WebRequest -Uri "$baseUrl/estoque" -TimeoutSec 3
    if ($estoqueResponse.StatusCode -ne 200 -or -not ($estoqueResponse.Content -match 'Sfera VM - Sistema de Controle de Pedidos')) {
        throw 'Smoke test falhou: /estoque nao retornou index.html.'
    }

    $ordersPartial = Invoke-WebRequest -Uri "$baseUrl/pages/pedidos.html" -TimeoutSec 3
    if ($ordersPartial.StatusCode -ne 200 -or -not ($ordersPartial.Content -match 'orders-page|orders-filter-card')) {
        throw 'Smoke test falhou: /pages/pedidos.html nao retornou o partial esperado.'
    }

    $usersPartial = Invoke-WebRequest -Uri "$baseUrl/pages/usuarios.html" -TimeoutSec 3
    if ($usersPartial.StatusCode -ne 200 -or -not ($usersPartial.Content -match 'users-page|users-summary-grid')) {
        throw 'Smoke test falhou: /pages/usuarios.html nao retornou o partial esperado.'
    }

    $loginPartial = Invoke-WebRequest -Uri "$baseUrl/pages/login.html" -TimeoutSec 3
    if ($loginPartial.StatusCode -ne 200 -or -not ($loginPartial.Content -match 'login-form|login-toggle-senha')) {
        throw 'Smoke test falhou: /pages/login.html nao retornou o partial esperado.'
    }

    $ordersCss = Invoke-WebRequest -Uri "$baseUrl/styles/pages/orders.css" -TimeoutSec 3
    if ($ordersCss.StatusCode -ne 200 -or -not ($ordersCss.Content -match 'orders-page|orders-summary-card')) {
        throw 'Smoke test falhou: /styles/pages/orders.css nao retornou o CSS esperado.'
    }

    $usersCss = Invoke-WebRequest -Uri "$baseUrl/styles/pages/users.css" -TimeoutSec 3
    if ($usersCss.StatusCode -ne 200 -or -not ($usersCss.Content -match 'users-page|users-summary-card')) {
        throw 'Smoke test falhou: /styles/pages/users.css nao retornou o CSS esperado.'
    }

    $loginCss = Invoke-WebRequest -Uri "$baseUrl/styles/pages/login.css" -TimeoutSec 3
    if ($loginCss.StatusCode -ne 200 -or -not ($loginCss.Content -match '#login-screen|login-page')) {
        throw 'Smoke test falhou: /styles/pages/login.css nao retornou o CSS esperado.'
    }

    try {
        Invoke-WebRequest -Uri "$baseUrl/api/admin/users" -TimeoutSec 3 -ErrorAction Stop | Out-Null
        throw 'Smoke test falhou: /api/admin/users deveria exigir autorizacao.'
    } catch {
        $status = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        if ($status -ne 401) {
            throw 'Smoke test falhou: /api/admin/users sem token nao retornou 401.'
        }
    }

    try {
        Invoke-WebRequest -Method Post -Uri "$baseUrl/api/admin/users" -TimeoutSec 3 -ErrorAction Stop -ContentType 'application/json' -Body '{}' | Out-Null
        throw 'Smoke test falhou: POST /api/admin/users deveria exigir autorizacao.'
    } catch {
        $status = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        if ($status -ne 401) {
            throw 'Smoke test falhou: POST /api/admin/users sem token nao retornou 401.'
        }
    }

    $privatePaths = @(
        '/src/server/services/supabase-admin-service.js',
        '/src/server/routes/users-admin.js',
        '/tests/server/users.test.js',
        '/scripts/admin/create-admin.js',
        '/supabase/config.toml',
        '/package.json',
        '/.env'
    )

    foreach ($privatePath in $privatePaths) {
        $privateExposed = $false
        try {
            $privateResponse = Invoke-WebRequest -Uri "$baseUrl$privatePath" -TimeoutSec 3 -ErrorAction Stop
            if ($privateResponse.StatusCode -eq 200) {
                $privateExposed = $true
            }
        } catch {
            $privateExposed = $false
        }

        if ($privateExposed) {
            throw "Smoke test falhou: arquivo privado exposto em $privatePath."
        }
    }

    Write-Output 'Smoke test ok.'
} finally {
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
}

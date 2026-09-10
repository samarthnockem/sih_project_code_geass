param(
  [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"
$BlockchainDir = Join-Path $ProjectRoot "blockchain"
$BackendEnvPath = Join-Path $BackendDir ".env"
$StartupDir = Join-Path $ProjectRoot ".local-startup"
$LogDir = Join-Path $StartupDir "logs"
$BackendLog = Join-Path $LogDir "backend.log"
$FrontendLog = Join-Path $LogDir "frontend.log"

$BackendUrl = "http://localhost:4000"
$FrontendUrl = "http://localhost:8000"
$HealthUrl = "$BackendUrl/api/health"
$ReadyUrl = "$BackendUrl/api/ready"
$ExpectedChainId = 11155111
$ExpectedChainIdHex = "0xaa36a7"

function Write-Step($Message) {
  Write-Host "[kryptovault] $Message"
}

function Fail($Message) {
  Write-Error $Message
  exit 1
}

function Require-Directory($Path, $Name) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    Fail "Required project folder missing: $Name ($Path)"
  }
}

function Read-DotEnv($Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
      continue
    }
    $parts = $trimmed.Split("=", 2)
    $values[$parts[0].Trim()] = $parts[1].Trim()
  }
  return $values
}

function Require-EnvValue($EnvValues, $Key) {
  if (-not $EnvValues.ContainsKey($Key) -or -not [string]$EnvValues[$Key]) {
    Fail "backend/.env must contain $Key."
  }
  return [string]$EnvValues[$Key]
}

function Invoke-JsonRpc($RpcUrl, $Method, $Params = @()) {
  $body = @{
    jsonrpc = "2.0"
    id = 1
    method = $Method
    params = $Params
  } | ConvertTo-Json -Compress

  return Invoke-RestMethod -Uri $RpcUrl -Method Post -ContentType "application/json" -Body $body -TimeoutSec 15
}

function Get-SepoliaChainId($RpcUrl) {
  try {
    $response = Invoke-JsonRpc $RpcUrl "eth_chainId"
    return [string]$response.result
  } catch {
    Fail "Sepolia RPC eth_chainId check failed. $($_.Exception.Message)"
  }
}

function Get-ContractCode($RpcUrl, $Address) {
  try {
    $response = Invoke-JsonRpc $RpcUrl "eth_getCode" @($Address, "latest")
    return [string]$response.result
  } catch {
    Fail "Sepolia contract bytecode check failed. $($_.Exception.Message)"
  }
}

function Wait-ForCondition($Name, [scriptblock]$Condition, $TimeoutSeconds, $FailureLog = $null) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null

  while ((Get-Date) -lt $deadline) {
    try {
      if (& $Condition) {
        return
      }
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Seconds 2
  }

  if ($FailureLog -and (Test-Path -LiteralPath $FailureLog)) {
    Write-Host ""
    Write-Host "Last lines from ${FailureLog}:"
    Get-Content -LiteralPath $FailureLog -Tail 80
  }
  if ($lastError) {
    Fail "$Name did not become ready within $TimeoutSeconds seconds. Last error: $lastError"
  }
  Fail "$Name did not become ready within $TimeoutSeconds seconds."
}

function Start-ServiceWindow($Title, $WorkingDirectory, $Command, $LogPath) {
  if (Test-Path -LiteralPath $LogPath) {
    Remove-Item -LiteralPath $LogPath -Force
  }

  $escapedDir = $WorkingDirectory.Replace("'", "''")
  $escapedLog = $LogPath.Replace("'", "''")
  $escapedCommand = $Command.Replace("'", "''")
  $psCommand = "& { `$host.UI.RawUI.WindowTitle = '$Title'; Set-Location -LiteralPath '$escapedDir'; '$Title starting...' | Tee-Object -FilePath '$escapedLog'; & $escapedCommand *>&1 | Tee-Object -FilePath '$escapedLog' -Append }"

  return Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $psCommand) -PassThru
}

function Test-HttpOk($Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 3
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 400
  } catch {
    return $false
  }
}

function Test-BackendHealth {
  return Test-HttpOk $HealthUrl
}

function Test-BackendReady {
  try {
    $response = Invoke-RestMethod -Uri $ReadyUrl -Method Get -TimeoutSec 3
    return $response.status -eq "ready" -and $response.database -eq "connected"
  } catch {
    return $false
  }
}

function Get-BackendReadyResponse {
  return Invoke-RestMethod -Uri $ReadyUrl -Method Get -TimeoutSec 5
}

function Test-FrontendReady {
  return Test-HttpOk $FrontendUrl
}

function Get-PortProcessIds($Port) {
  try {
    return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  } catch {
    return @()
  }
}

function Get-ProcessCommandLine($ProcessId) {
  try {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
    return [string]$processInfo.CommandLine
  } catch {
    return ""
  }
}

function Stop-KryptoVaultBackendOnPort {
  $processIds = Get-PortProcessIds 4000
  if (-not $processIds.Count) {
    return $false
  }

  $backendRoot = $BackendDir.ToLowerInvariant()
  $stopped = $false
  foreach ($processId in $processIds) {
    $commandLine = (Get-ProcessCommandLine $processId).ToLowerInvariant()
    if ($commandLine.Contains($backendRoot) -or $commandLine.Contains("src/server.ts") -or $commandLine.Contains("secure-vault-backend")) {
      Write-Step "Restarting existing backend process on port 4000 so current backend/.env is loaded"
      Stop-Process -Id $processId -Force
      $stopped = $true
      continue
    }

    Fail "Port 4000 is already in use by a non-KryptoVault process (PID $processId). Stop it before running startup."
  }

  if ($stopped) {
    Wait-ForCondition "Port 4000 release" { -not (Get-PortProcessIds 4000).Count } 30
  }

  return $stopped
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Step "Verifying project folders"
Require-Directory $FrontendDir "frontend"
Require-Directory $BackendDir "backend"
Require-Directory $BlockchainDir "blockchain"

if (-not (Test-Path -LiteralPath $BackendEnvPath -PathType Leaf)) {
  Fail "backend/.env is missing. Create it from backend/.env.example and keep your MongoDB Atlas MONGODB_URI."
}

$envValues = Read-DotEnv $BackendEnvPath
$mongodbUri = Require-EnvValue $envValues "MONGODB_URI"
$ethereumRpcUrl = Require-EnvValue $envValues "ETHEREUM_RPC_URL"
$contractAddress = Require-EnvValue $envValues "CONTRACT_ADDRESS"
$configuredChainId = Require-EnvValue $envValues "EXPECTED_CHAIN_ID"

if ($mongodbUri -match "^mongodb://127\.0\.0\.1" -or $mongodbUri -match "^mongodb://localhost") {
  Fail "backend/.env MONGODB_URI points to local MongoDB. Keep the MongoDB Atlas URI."
}
if ($ethereumRpcUrl -match "127\.0\.0\.1|localhost") {
  Fail "backend/.env ETHEREUM_RPC_URL must point to Ethereum Sepolia, not a local RPC."
}
if ($envValues["PORT"] -ne "4000") {
  Fail "backend/.env must contain PORT=4000. Current value: $($envValues["PORT"])"
}
if ($envValues["CORS_ORIGIN"] -ne $FrontendUrl) {
  Fail "backend/.env must contain CORS_ORIGIN=$FrontendUrl. Current value: $($envValues["CORS_ORIGIN"])"
}
if ([int]$configuredChainId -ne $ExpectedChainId) {
  Fail "backend/.env must contain EXPECTED_CHAIN_ID=$ExpectedChainId. Current value: $configuredChainId"
}
if ($contractAddress -notmatch "^0x[a-fA-F0-9]{40}$") {
  Fail "backend/.env CONTRACT_ADDRESS must be a valid Ethereum address."
}

Write-Step "Verifying Ethereum Sepolia RPC"
$chainId = Get-SepoliaChainId $ethereumRpcUrl
if ($chainId.ToLowerInvariant() -ne $ExpectedChainIdHex) {
  Fail "Configured Ethereum RPC returned chain ID $chainId. Expected $ExpectedChainIdHex."
}

Write-Step "Verifying deployed KryptoVault contract bytecode on Sepolia"
$contractCode = Get-ContractCode $ethereumRpcUrl $contractAddress
if (-not $contractCode -or $contractCode -eq "0x") {
  Fail "No deployed contract bytecode found at configured CONTRACT_ADDRESS $contractAddress on Sepolia."
}

Write-Step "Starting backend"
Stop-KryptoVaultBackendOnPort | Out-Null
Start-ServiceWindow "KryptoVault Backend" $BackendDir "npm.cmd run dev" $BackendLog | Out-Null
Wait-ForCondition "Backend health check $HealthUrl" { Test-BackendHealth } 90 $BackendLog
Wait-ForCondition "Backend readiness check $ReadyUrl" { Test-BackendReady } 90 $BackendLog

$readyResponse = Get-BackendReadyResponse
if ($readyResponse.status -ne "ready" -or $readyResponse.database -ne "connected") {
  Fail "Backend responded but is not ready: $($readyResponse | ConvertTo-Json -Compress)"
}

Write-Step "Starting frontend"
if (Test-FrontendReady) {
  Write-Step "Frontend is already responding; reusing the process on port 8000"
} else {
  $frontendPortProcesses = Get-PortProcessIds 8000
  if ($frontendPortProcesses.Count) {
    Fail "Port 8000 is already in use but the frontend did not respond successfully. Stop that process before running startup."
  }
  Start-ServiceWindow "KryptoVault Frontend" $FrontendDir "npm.cmd run dev" $FrontendLog | Out-Null
  Wait-ForCondition "Frontend $FrontendUrl" { Test-FrontendReady } 60 $FrontendLog
}

Write-Host ""
Write-Host "KRYPTOVAULT SEPOLIA ENVIRONMENT READY"
Write-Host ""
Write-Host "Frontend:"
Write-Host $FrontendUrl
Write-Host ""
Write-Host "Backend:"
Write-Host $BackendUrl
Write-Host ""
Write-Host "Backend Ready:"
Write-Host $ReadyUrl
Write-Host ""
Write-Host "Blockchain:"
Write-Host "Ethereum Sepolia"
Write-Host ""
Write-Host "Chain ID:"
Write-Host $ExpectedChainId
Write-Host ""
Write-Host "Contract:"
Write-Host $contractAddress
Write-Host ""
Write-Host "MongoDB:"
Write-Host "Atlas connected"
Write-Host ""
Write-Host "MetaMask:"
Write-Host "Use Ethereum Sepolia"
Write-Host ""
Write-Host "Logs:"
Write-Host $LogDir

if ($OpenBrowser) {
  Start-Process $FrontendUrl
}

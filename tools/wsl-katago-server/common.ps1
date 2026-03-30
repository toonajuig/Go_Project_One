Set-StrictMode -Version Latest

function Get-WslKatagoServerHome {
  if ($env:WSL_KATAGO_SERVER_HOME) {
    return $env:WSL_KATAGO_SERVER_HOME
  }

  return "/root/katago-server"
}

function Get-WslKatagoRuntimeDir {
  if ($env:WSL_KATAGO_RUNTIME_DIR) {
    return $env:WSL_KATAGO_RUNTIME_DIR
  }

  return "$(Get-WslKatagoServerHome)/runtime"
}

function Get-WslKatagoServerPort {
  if ($env:WSL_KATAGO_SERVER_PORT) {
    return [int]$env:WSL_KATAGO_SERVER_PORT
  }

  return 2718
}

function Get-WslKatagoPidFile {
  return "$(Get-WslKatagoServerHome)/wsl-katago-server.pid"
}

function Get-WslKatagoLogFile {
  return "$(Get-WslKatagoServerHome)/wsl-katago-server.log"
}

function Convert-ToWslPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $resolved = (Resolve-Path -LiteralPath $Path).Path
  if ($resolved -notmatch '^[A-Za-z]:\\') {
    throw "Only local Windows drive paths are supported: $resolved"
  }

  $drive = $resolved.Substring(0, 1).ToLowerInvariant()
  $rest = $resolved.Substring(2).Replace('\', '/')
  return "/mnt/$drive$rest"
}

function Get-WslKatagoLauncherPath {
  return Convert-ToWslPath (Join-Path $PSScriptRoot "launch_katago_server.py")
}

function Convert-ToBashOneLiner {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Script
  )

  $lines = $Script -split "`r?`n"
  $trimmed = foreach ($line in $lines) {
    $value = $line.Trim()
    if ($value.Length -gt 0) {
      $value
    }
  }

  return ($trimmed -join "; ")
}

function Invoke-WslScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Script
  )

  $tempFile = Join-Path $env:TEMP ("wsl-katago-" + [guid]::NewGuid().ToString("N") + ".sh")
  $normalized = $Script -replace "`r`n", "`n"
  $encoding = New-Object System.Text.ASCIIEncoding
  [System.IO.File]::WriteAllText($tempFile, $normalized, $encoding)

  try {
    $wslTempFile = Convert-ToWslPath $tempFile
    & wsl.exe bash $wslTempFile | Out-Host
    $exitCode = $LASTEXITCODE
    return $exitCode
  } finally {
    Remove-Item -LiteralPath $tempFile -ErrorAction SilentlyContinue
  }
}

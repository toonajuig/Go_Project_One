. "$PSScriptRoot\common.ps1"

$port = Get-WslKatagoServerPort
$payload = @{
  board_size = 19
  moves = @("R4", "D16")
} | ConvertTo-Json -Compress

$response = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:$port/select-move/katago_gtp_bot" `
  -ContentType "application/json" `
  -Body $payload `
  -TimeoutSec 60

$response | ConvertTo-Json -Depth 8

param(
 [string]$OutputDirectory = "$PSScriptRoot\diagnostics",
 [string[]]$GameLogDirectories = @(),
 [string[]]$BridgeConfigFiles = @()
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$secrets = [System.Collections.Generic.List[string]]::new()
$envPath = Join-Path $root '.env'
if (Test-Path -LiteralPath $envPath) {
 foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match '^\s*(STEAM_WEB_API_KEY|BRIDGE_TOKEN|STEAM_HTTP_PROXY)\s*=\s*(.+)$') {
   $value = $Matches[2].Trim().Trim('"').Trim("'")
   if ($value.Length -gt 3) { $secrets.Add($value) }
  }
 }
}
foreach ($configPath in $BridgeConfigFiles) {
 $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
 if ($config.token) { $secrets.Add([string]$config.token) }
}
$out = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $out -Force | Out-Null
$name = 'HYMM-diagnostics-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6)
$stage = Join-Path $out $name
New-Item -ItemType Directory -Path $stage | Out-Null
function Sanitize([string]$Text) {
 foreach ($secret in $secrets) { $Text = $Text.Replace($secret, '[REDACTED]') }
 $Text = $Text -replace '(?im)^.*(?:Authorization|Cookie|Set-Cookie|openid\.|steam_state|csrf|[?&]key=|password|api.?key|["'']?token["'']?\s*[:=]).*$', '[REDACTED credential line]'
 $Text = $Text -replace '(?i)\b[a-f0-9]{32,}\b', '[REDACTED token]'
 $Text = $Text -replace '\b\d{17}\b', '[SteamID]'
 return $Text
}
$directories = @((Join-Path $PSScriptRoot 'logs')) + $GameLogDirectories
$index = 0
foreach ($directory in $directories) {
 if (!(Test-Path -LiteralPath $directory -PathType Container)) { continue }
 # Only text logs in the explicitly selected folder; never recurse into configs or databases.
 $files = Get-ChildItem -LiteralPath $directory -File | Where-Object { $_.Extension -in @('.log', '.txt') -and $_.Name -match '(log|rgl|console|web)' } | Sort-Object LastWriteTime -Descending | Select-Object -First 6
 foreach ($file in $files) {
  $index++
  $text = (Get-Content -LiteralPath $file.FullName -Tail 2000 -Encoding UTF8) -join "`n"
  Sanitize $text | Set-Content -LiteralPath (Join-Path $stage "log-$index.txt") -Encoding UTF8
 }
}
@("HYMM diagnostics", "Collected: $([DateTime]::UtcNow.ToString('o'))", "Log files: $index", 'No database, config, .env or game credentials included.', 'Review text files for player names, addresses and free-form sensitive text before sharing.') | Set-Content -LiteralPath (Join-Path $stage 'README.txt') -Encoding UTF8
$zip = Join-Path $out "$name.zip"
Compress-Archive -LiteralPath $stage -DestinationPath $zip
Write-Output "Diagnostics: $zip"
Write-Output "Review folder: $stage"

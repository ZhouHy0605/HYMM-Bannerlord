param([string]$ServerRoot = 'D:\steam\steamapps\common\Mount & Blade II Dedicated Server')
$ErrorActionPreference = 'Stop'
dotnet build "$PSScriptRoot\ArenaBridge.csproj" -c Release "-p:ServerRoot=$ServerRoot"
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
$package = Join-Path $PSScriptRoot 'package\ArenaBridge'
$binary = Join-Path $package 'bin\Win64_Shipping_Server'
New-Item -ItemType Directory -Force -Path $binary | Out-Null
Copy-Item -LiteralPath "$PSScriptRoot\bin\Release\net6.0\ArenaBridge.dll" -Destination $binary -Force
Copy-Item -LiteralPath "$PSScriptRoot\SubModule.xml" -Destination $package -Force
Copy-Item -LiteralPath "$PSScriptRoot\bridge.example.json" -Destination $binary -Force
Write-Output "Packaged module: $package"

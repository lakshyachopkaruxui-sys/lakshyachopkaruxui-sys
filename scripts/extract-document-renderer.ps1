$ErrorActionPreference = 'Stop'
$toolRoot = Join-Path $PSScriptRoot '../tools/document-renderer'
$installer = (Resolve-Path (Join-Path $toolRoot 'LibreOfficePortable.paf.exe')).Path
$destination = [IO.Path]::GetFullPath((Join-Path $toolRoot 'LibreOfficePortable'))
$expected = '3409f75e56916214afa745fa2cd1bd64103cb02c85fbc50d306997c41690a294'
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw 'Renderer download hash changed' }
if (-not $destination.StartsWith([IO.Path]::GetFullPath($toolRoot) + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid portable destination' }
$process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$destination") -WindowStyle Hidden -PassThru -Wait
Write-Output "Portable extraction exit $($process.ExitCode)"
Get-ChildItem -LiteralPath $destination -Filter soffice.exe -Recurse | Select-Object -ExpandProperty FullName

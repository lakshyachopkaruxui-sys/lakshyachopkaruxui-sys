param([switch]$Wait)
$ErrorActionPreference = 'Stop'
$previewRoot = Split-Path -Parent $PSScriptRoot
$previewNode = (Get-Command node.exe -ErrorAction Stop).Source
$previewScript = Join-Path $PSScriptRoot 'preview-supervisor.mjs'
$previewProcess = Start-Process -FilePath $previewNode -ArgumentList @(('"' + $previewScript + '"'), 'run') -WorkingDirectory $previewRoot -WindowStyle Hidden -PassThru
if ($Wait) {
    $previewProcess.WaitForExit()
    exit $previewProcess.ExitCode
}

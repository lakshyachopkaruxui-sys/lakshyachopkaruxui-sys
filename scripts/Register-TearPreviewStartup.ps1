# Run only after the user permits the Windows sign-in task.
$ErrorActionPreference = 'Stop'
$previewRoot = Split-Path -Parent $PSScriptRoot
$previewLauncher = Join-Path $PSScriptRoot 'Start-TearPreview.ps1'
$previewUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$previewHash = [System.Security.Cryptography.SHA256]::Create()
try {
    $previewSuffix = [BitConverter]::ToString($previewHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($previewRoot.ToLowerInvariant()))).Replace('-', '').Substring(0, 8)
} finally { $previewHash.Dispose() }
$previewTaskName = 'TearPreview-' + $previewSuffix
$previewShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$previewArguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $previewLauncher + '" -Wait'
$previewExisting = Get-ScheduledTask -TaskName $previewTaskName -ErrorAction SilentlyContinue
if ($previewExisting -and ($previewExisting.Actions.Arguments -notcontains $previewArguments)) {
    throw 'An unrelated task already uses this name. No changes were made.'
}
$previewAction = New-ScheduledTaskAction -Execute $previewShell -Argument $previewArguments -WorkingDirectory $previewRoot
$previewTrigger = New-ScheduledTaskTrigger -AtLogOn -User $previewUser
$previewPrincipal = New-ScheduledTaskPrincipal -UserId $previewUser -LogonType Interactive -RunLevel Limited
$previewSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $previewTaskName -Action $previewAction -Trigger $previewTrigger -Principal $previewPrincipal -Settings $previewSettings -Description ('Keep the local Tear preview available at 127.0.0.1:5174. Project: ' + $previewRoot) -Force | Out-Null
Start-ScheduledTask -TaskName $previewTaskName
Get-ScheduledTask -TaskName $previewTaskName | Select-Object TaskName, State

# Historical SAPI preview generator. Current narrator: render-neural-narration.py.
# Run from Windows PowerShell with an installed SAPI voice.
param([string]$VoiceName = 'Microsoft David Desktop')
$ErrorActionPreference = 'Stop'
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../validation/narration-sapi-legacy'))
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$speaker = New-Object -ComObject SAPI.SpVoice
$voices = $speaker.GetVoices()
$selected = $null
for ($index = 0; $index -lt $voices.Count; $index++) {
    $voice = $voices.Item($index)
    Write-Output $voice.GetDescription()
    if ($voice.GetDescription() -like "*$VoiceName*") { $selected = $voice }
}
if ($null -eq $selected) { throw "Installed voice not found: $VoiceName" }
$speaker.Voice = $selected
$speaker.Rate = -2
$speaker.Volume = 90
$scriptPath = Join-Path $PSScriptRoot '../src/audio/narrationScript.ts'
$scriptText = Get-Content -LiteralPath $scriptPath -Raw
$lines = @{}
foreach ($match in [regex]::Matches($scriptText, "id: '([^']+)',\s+text: '([^']+)'")) {
    $lines[$match.Groups[1].Value + '.wav'] = $match.Groups[2].Value
}
if ($lines.Count -ne 5) { throw 'Expected five narration cues in narrationScript.ts' }
foreach ($name in $lines.Keys) {
    $stream = New-Object -ComObject SAPI.SpFileStream
    $renderPath = Join-Path $outputDirectory ($name + '.rendering.wav')
    $complete = $false
    try {
        # SAFT22kHz16BitMono = 22; SSFMCreateForWrite = 3.
        $stream.Format.Type = 22
        $stream.Open($renderPath, 3, $false)
        $speaker.AudioOutputStream = $stream
        $speaker.Speak($lines[$name]) | Out-Null
        $complete = $true
    } finally {
        $stream.Close()
        if (-not $complete -and (Test-Path -LiteralPath $renderPath)) {
            Remove-Item -LiteralPath $renderPath
        }
    }
    Move-Item -LiteralPath $renderPath -Destination (Join-Path $outputDirectory $name) -Force
}
$rendered = @{}
foreach ($name in $lines.Keys) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [IO.File]::ReadAllBytes((Join-Path $outputDirectory $name))
        $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    } finally { $sha.Dispose() }
    $rendered[$name] = @{
        text = $lines[$name]
        sha256 = $hash
    }
}
$rendered | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $outputDirectory 'script.json') -Encoding UTF8
Write-Output "Rendered synthetic preview narration using $($selected.GetDescription())."
Write-Output 'Historical SAPI preview only. Use render-neural-narration.py for the current narrator.'

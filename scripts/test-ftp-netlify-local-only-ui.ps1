# Netlify / non-local FTP UI gate — static checks + PowerShell runtime of probe logic.
# NO real FTP / dry-run / production publish / STOR/DELE/RNFR/RNTO / git.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\perfo\Desktop\SmileAIStudio'
$results = New-Object System.Collections.Generic.List[object]
$apiHits = 0
$ftpWrite = 0

function Add-Result {
  param([string]$Id, [bool]$Ok, [string]$Detail)
  [void]$results.Add([pscustomobject]@{ id = $Id; ok = $Ok; detail = $Detail })
}
function Read-Text([string]$Path) {
  return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
}
function HasLit([string]$Path, [string]$Lit) {
  return (Read-Text $Path).Contains($Lit)
}

$probe = Join-Path $root 'js\smile-ftp-probe.js'
$dry = Join-Path $root 'js\smile-ftp-dry-run.js'
$prod = Join-Path $root 'js\smile-ftp-production-publish.js'
$script = Join-Path $root 'script.js'
$index = Join-Path $root 'index.html'
$nodeJs = Join-Path $root 'scripts\test-ftp-netlify-local-only-node.js'

$probeText = Read-Text $probe
$msgMatch = [regex]::Match($probeText, 'LOCAL_ONLY_MSG\s*=\s*"([^"]+)"')
if (-not $msgMatch.Success) { throw 'LOCAL_ONLY_MSG not found in smile-ftp-probe.js' }
$msg = $msgMatch.Groups[1].Value

# A
Add-Result -Id 'A' -Ok ($msg.Length -gt 10) -Detail ('LOCAL_ONLY_MSG len=' + $msg.Length)

# B
Add-Result -Id 'B' -Ok (
  (HasLit $probe 'localhost') -and (HasLit $probe '127.0.0.1') -and (HasLit $probe 'function isLocalFtpRuntime')
) -Detail 'isLocalFtpRuntime host checks'

# C
$needle = 'if (!isLocalFtpRuntime())'
$count = ([regex]::Matches($probeText, [regex]::Escape($needle))).Count
Add-Result -Id 'C' -Ok ($count -ge 3) -Detail ("probe early-returns count=$count")

# D
Add-Result -Id 'D' -Ok (
  (HasLit $dry 'isLocalFtpRuntime') -and (HasLit $prod 'isLocalFtpRuntimeForProd') -and (HasLit $prod 'LOCAL_ONLY_MSG_PROD')
) -Detail 'dry-run + production local-only guards'

# E
Add-Result -Id 'E' -Ok (
  (HasLit $script 'applyFtpLocalOnlyUiGate') -and (HasLit $script 'guardLocalFtpOrExplain') -and (HasLit $script $msg)
) -Detail 'script.js UI gate helpers'

# F
$t = Read-Text $script
$start = $t.IndexOf('function openPublishMgmtView()')
$end = $t.IndexOf('function saveFtpConfigFromForm()')
$body = if ($start -ge 0 -and $end -gt $start) { $t.Substring($start, $end - $start) } else { '' }
Add-Result -Id 'F' -Ok (
  $body.Contains('applyFtpLocalOnlyUiGate') -and $body.Contains('FTP_LOCAL_ONLY_MSG') -and $body.Contains('if (!local)')
) -Detail 'openPublishMgmtView local-only path'

# G
$start = $t.IndexOf('function applyFtpLocalOnlyUiGate()')
$end = $t.IndexOf('function guardLocalFtpOrExplain')
$body = if ($start -ge 0 -and $end -gt $start) { $t.Substring($start, $end - $start) } else { '' }
$okG = $body.Contains('btn-web-ftp-open-confirm') `
  -and $body.Contains('btn-web-ftp-open-dry-run') `
  -and $body.Contains('btn-web-pipeline-ftp') `
  -and $body.Contains('btn-web-ftp-publish-execute') `
  -and -not $body.Contains('btn-web-pipeline-html') `
  -and -not $body.Contains('btn-web-pipeline-package') `
  -and -not $body.Contains('btn-web-build-html')
Add-Result -Id 'G' -Ok $okG -Detail 'FTP disable list excludes HTML/package'

# H
$fns = @(
  'function saveFtpConfigFromForm()',
  'function openFtpConfirmView()',
  'function runFtpProbeFromUi()',
  'function openFtpDryRunConfirmView()',
  'function runFtpDryRunFromUi()',
  'function openFtpProductionPublishConfirm()',
  'function executeFtpProductionPublish()',
  'function runRealPublishUnlockFromUi()'
)
$okH = $true
$miss = New-Object System.Collections.Generic.List[string]
foreach ($fn in $fns) {
  $i = $t.IndexOf($fn)
  if ($i -lt 0) { $okH = $false; [void]$miss.Add($fn); continue }
  $chunk = $t.Substring($i, [Math]::Min(500, $t.Length - $i))
  if (-not $chunk.Contains('guardLocalFtpOrExplain')) {
    $okH = $false
    [void]$miss.Add($fn)
  }
}
Add-Result -Id 'H' -Ok $okH -Detail ('handlers guard miss=' + ($miss -join ','))

# I
Add-Result -Id 'I' -Ok ((Read-Text $index).Contains('Netlify')) -Detail 'index.html mentions Netlify local-only'

# J — prefer node; fallback PowerShell host-gate simulation
$jOk = $false
$jDetail = ''
$nodeCmd = $null
foreach ($cand in @(
  'node',
  'C:\Program Files\nodejs\node.exe',
  (Join-Path $env:APPDATA 'nvm\nodejs\node.exe')
)) {
  if ($cand -eq 'node') {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $nodeCmd = $cmd.Source; break }
  } elseif (Test-Path -LiteralPath $cand) {
    $nodeCmd = $cand; break
  }
}
if ($nodeCmd) {
  try {
    $out = & $nodeCmd $nodeJs $root 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw $out }
    $jOk = $true
    $jDetail = ('node ' + $out.Trim())
  } catch {
    $jOk = $false
    $jDetail = $_.Exception.Message
  }
} else {
  # Fallback: extract isLocalFtpRuntime logic via hostname list checks in source
  $hostsLocal = @('localhost', '127.0.0.1', '::1', '[::1]')
  $hostsRemote = @('develop--smile-ai-studio.netlify.app', 'egaonokiroku.co.jp')
  $fnMatch = [regex]::Match($probeText, 'function isLocalFtpRuntime\(\) \{([\s\S]*?)\n  \}')
  $fnBody = $fnMatch.Groups[1].Value
  $localOk = $true
  foreach ($h in $hostsLocal) {
    if (-not $fnBody.Contains('"' + $h + '"')) { $localOk = $false }
  }
  $remoteGate = $probeText.Contains('if (!isLocalFtpRuntime())') -and $probeText.Contains('localOnlyBody')
  $jOk = $localOk -and $remoteGate
  $jDetail = 'powershell-fallback host-list+early-return (node unavailable)'
}
Add-Result -Id 'J' -Ok $jOk -Detail $jDetail

# K
Add-Result -Id 'K' -Ok (HasLit $script $msg) -Detail 'UI LOCAL_ONLY_MSG present'

# L
$start = $t.IndexOf('function refreshWebPublishPipelineCards()')
$end = $t.IndexOf('function showWebFtpRootConfirmError')
$body = if ($start -ge 0 -and $end -gt $start) { $t.Substring($start, $end - $start) } else { '' }
Add-Result -Id 'L' -Ok (
  $body.Contains('isLocalFtpRuntime()') -and $body.Contains('applyFtpLocalOnlyUiGate()')
) -Detail 'refreshWebPublishPipelineCards local gate'

# M — parse-failure string must not be the Netlify open path message
$openBodyStart = $t.IndexOf('function openPublishMgmtView()')
$openBodyEnd = $t.IndexOf('function saveFtpConfigFromForm()')
$openBody = if ($openBodyStart -ge 0 -and $openBodyEnd -gt $openBodyStart) {
  $t.Substring($openBodyStart, $openBodyEnd - $openBodyStart)
} else { '' }
$parseMsgMatch = [regex]::Match($probeText, 'res\.json\(\)\.catch\([\s\S]{0,120}?userMessage:\s*"([^"]+)"')
$parseMsg = if ($parseMsgMatch.Success) { $parseMsgMatch.Groups[1].Value } else { '' }
$mOk = $openBody.Contains('FTP_LOCAL_ONLY_MSG') -and $openBody.Contains('if (!local)') -and (
  $parseMsg.Length -eq 0 -or -not $openBody.Contains($parseMsg)
)
Add-Result -Id 'M' -Ok $mOk -Detail 'openPublishMgmtView uses LOCAL_ONLY not parse-failure'

$fail = @($results | Where-Object { -not $_.ok })
Write-Host '=== FTP Netlify local-only UI tests ==='
foreach ($r in $results) {
  $mark = if ($r.ok) { 'PASS' } else { 'FAIL' }
  Write-Host ("[{0}] {1}: {2}" -f $mark, $r.id, $r.detail)
}
$passCount = $results.Count - $fail.Count
Write-Host ("apiHits={0} ftpWrite={1} pass={2}/{3}" -f $apiHits, $ftpWrite, $passCount, $results.Count)
if ($fail.Count -gt 0) { exit 1 }
exit 0

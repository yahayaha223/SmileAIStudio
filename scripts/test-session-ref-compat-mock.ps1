# Session contract compat S1-S10. NO real Xserver / publish API / FTP write.
# Replaces SessionRef [ref] binding with returned .session PSCustomObject contract.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\perfo\Desktop\SmileAIStudio'
. (Join-Path $root 'scripts\ftp-readonly-probe.ps1')
. (Join-Path $root 'scripts\ftp-safe-image-upload.ps1')

$script:SmileFtpSkipRetrySleep = $true
$script:SmileFtpFailStorCodesQueue = $null
$script:SmileFtpTestDouble = $null
$script:SmileFtpStorChunkSize = 16384
$script:MockForceRntoFail = $false
$script:ReconnectCount = 0
$script:AuthTlsSeq = New-Object System.Collections.Generic.List[string]
$script:SharedFs = @{}
$results = New-Object System.Collections.Generic.List[object]
$bindingEx = 0
$strictEx = 0
$reusedWriter = 0

function Add-Result([string]$id, [bool]$ok, [string]$detail) {
  [void]$results.Add([pscustomobject]@{ id = $id; ok = $ok; detail = $detail })
}
function Get-Sha256Hex([byte[]]$bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function New-MockSession {
  param([hashtable]$InitialFiles = $null, [string]$SessionId = '')
  $fs = @{}
  if ($InitialFiles) { foreach ($k in $InitialFiles.Keys) { $fs[$k] = [byte[]]$InitialFiles[$k] } }
  $sid = if ($SessionId) { $SessionId } else { 'sess-' + [guid]::NewGuid().ToString('N').Substring(0, 8) }
  $writer = [pscustomobject]@{ Id = ('w-' + $sid) }
  return [pscustomobject]@{
    files = $fs
    commands = New-Object System.Collections.Generic.List[string]
    allowStor = $true
    allowDele = $true
    allowRename = $true
    storAllowList = New-Object System.Collections.Generic.List[string]
    deleAllowList = New-Object System.Collections.Generic.List[string]
    renameAllowList = New-Object System.Collections.Generic.List[string]
    closed = $false
    client = [pscustomobject]@{ ReceiveTimeout = 25000; SendTimeout = 25000 }
    ssl = $true
    lastStorFailure = $null
    pendingRnfr = $null
    sessionId = $sid
    writer = $writer
    stream = [pscustomobject]@{ CanWrite = $true }
  }
}
function Invoke-SmileFtpSize { param($session,[string]$RemoteFileName)
  [void]$session.commands.Add('SIZE ' + $RemoteFileName)
  if ($session.files.ContainsKey($RemoteFileName)) {
    return @{ ok = $true; size = [long]$session.files[$RemoteFileName].Length }
  }
  return @{ ok = $false; size = $null; code = 550 }
}
function Invoke-SmileFtpRetrBytes { param($session,[string]$RemoteFileName)
  [void]$session.commands.Add('RETR ' + $RemoteFileName)
  if (-not $session.files.ContainsKey($RemoteFileName)) { throw 'RETR missing' }
  $raw = $session.files[$RemoteFileName]
  $copy = New-Object byte[] $raw.Length
  [Array]::Copy($raw, $copy, $raw.Length)
  return ,$copy
}
function Invoke-SmileFtpDeleFile { param($session,[string]$RemoteFileName)
  if (-not $session.allowDele) { throw 'DELE blocked' }
  if ($session.deleAllowList.Count -gt 0 -and $session.deleAllowList -notcontains $RemoteFileName) {
    throw "DELE blocked for $RemoteFileName"
  }
  [void]$session.commands.Add('DELE ' + $RemoteFileName)
  if ($session.files.ContainsKey($RemoteFileName)) { $session.files.Remove($RemoteFileName) | Out-Null }
  return $true
}
function Send-SmileFtpCommand { param($session,[string]$CommandLine,[switch]$SecretArg)
  if ($session.closed) { throw [Exception]'WriteLine on closed session' }
  [void]$session.commands.Add($CommandLine.Trim())
  if ($CommandLine -match '^AUTH TLS') { [void]$script:AuthTlsSeq.Add([string]$session.sessionId) }
  if ($CommandLine -match '^RNFR\s+(.+)$') { $session.pendingRnfr = $Matches[1]; return @{ code = 350; text = '350' } }
  if ($CommandLine -match '^RNTO\s+(.+)$') {
    if ($script:MockForceRntoFail) { return @{ code = 550; text = '550' } }
    $from = [string]$session.pendingRnfr; $to = $Matches[1]
    $session.files[$to] = $session.files[$from]; $session.files.Remove($from) | Out-Null
    return @{ code = 250; text = '250' }
  }
  return @{ code = 200; text = '200' }
}
function Get-SmileFtpSha256Hex { param([byte[]]$Bytes) return (Get-Sha256Hex $Bytes) }
function Close-SmileFtpSession($session) {
  if ($null -eq $session) { return }
  $session.closed = $true
  try { [void]$session.commands.Add('QUIT') } catch {}
}

$script:SmileFtpReconnectFactory = {
  param($PriorSession, $FtpConfig)
  $script:ReconnectCount++
  $s = New-MockSession -InitialFiles $script:SharedFs
  [void]$s.commands.Add('AUTH TLS')
  [void]$script:AuthTlsSeq.Add([string]$s.sessionId)
  [void]$s.commands.Add('PBSZ 0')
  [void]$s.commands.Add('PROT P')
  [void]$s.commands.Add('USER mock')
  [void]$s.commands.Add('PASS ********')
  [void]$s.commands.Add('CWD diary')
  [void]$s.commands.Add('CWD image')
  $s.files = $script:SharedFs
  return $s
}
$script:SmileFtpTestDouble = @{
  StorBytesSecure = {
    param($sess, $name, $bytes)
    [void]$sess.commands.Add('PASV')
    [void]$sess.commands.Add('STOR ' + $name)
    $chunk = 16384
    $sent = 0
    while ($sent -lt $bytes.Length) {
      $n = [Math]::Min($chunk, $bytes.Length - $sent)
      $sent += $n
    }
    $sess.files[$name] = [byte[]]$bytes
    [void]$sess.commands.Add('226')
    return [pscustomobject]@{
      ok = $true; code = 226; expectedSize = $bytes.Length; bytesSent = $sent
      pasvHost = 'mock'; pasvPort = (50000 + $script:ReconnectCount)
    }
  }
}

$bytes1 = [byte[]](1..40)
$sha1 = Get-Sha256Hex $bytes1
$f1 = '260721-2.jpg'
$cfg = [pscustomobject]@{ host = 'mock'; username = 'u'; password = 'p'; remoteRoot = '/'; useTls = $true; port = 21 }
function Reset-Fs {
  $script:SharedFs = @{}
  $script:ReconnectCount = 0
  $script:AuthTlsSeq = New-Object System.Collections.Generic.List[string]
  $script:SmileFtpFailStorCodesQueue = $null
  $script:MockForceRntoFail = $false
}

function Test-ResultShape($r) {
  if ($null -eq $r) { return $false }
  $names = @($r.PSObject.Properties | ForEach-Object { $_.Name })
  foreach ($need in @('success', 'session', 'attempts', 'errorCode', 'detail')) {
    if ($names -notcontains $need) { return $false }
  }
  return $true
}

# S1 null session input
try {
  Set-StrictMode -Version Latest
  Reset-Fs
  $up = Invoke-SmileFtpUploadImageViaTemp -session $null -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FtpConfig $cfg
  $ok = (Test-ResultShape $up) -and $up.success -and ($null -ne $up.session)
  Add-Result 'S1' $ok ("null-session-in ok sessionOut=$([bool]$up.session)")
} catch {
  if ($_.FullyQualifiedErrorId -match 'ParameterBinding' -or $_.Exception.GetType().Name -match 'ParameterBinding') { $bindingEx++ }
  if ($_.Exception.Message -match 'StrictMode|not set|undefined') { $strictEx++ }
  Add-Result 'S1' $false $_.Exception.Message
}

# S2 hashtable session input
try {
  Set-StrictMode -Version Latest
  Reset-Fs
  $hs = @{
    files = $script:SharedFs
    commands = New-Object System.Collections.Generic.List[string]
    allowStor = $true; allowDele = $true; allowRename = $true
    storAllowList = New-Object System.Collections.Generic.List[string]
    deleAllowList = New-Object System.Collections.Generic.List[string]
    renameAllowList = New-Object System.Collections.Generic.List[string]
    closed = $false
    client = @{ ReceiveTimeout = 25000; SendTimeout = 25000 }
    ssl = $true; lastStorFailure = $null; pendingRnfr = $null
    sessionId = 'ht-s2'; writer = @{ Id = 'w-ht-s2' }; stream = @{ CanWrite = $true }
  }
  $up = Invoke-SmileFtpUploadImageViaTemp -session $hs -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FtpConfig $cfg
  $ok = (Test-ResultShape $up) -and $up.success -and ($null -ne $up.session)
  Add-Result 'S2' $ok ("hashtable-in success=$($up.success)")
} catch {
  if ($_.FullyQualifiedErrorId -match 'ParameterBinding' -or $_.Exception.GetType().Name -match 'ParameterBinding') { $bindingEx++ }
  if ($_.Exception.Message -match 'StrictMode|not set|undefined') { $strictEx++ }
  Add-Result 'S2' $false $_.Exception.Message
}

# S3 PSCustomObject session
try {
  Set-StrictMode -Version Latest
  Reset-Fs
  $s0 = New-MockSession
  $up = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FtpConfig $cfg
  $ok = (Test-ResultShape $up) -and $up.success -and ($up.session -is [pscustomobject] -or $null -ne $up.session)
  Add-Result 'S3' $ok ("psco sessionId=$($up.session.sessionId)")
} catch {
  if ($_.FullyQualifiedErrorId -match 'ParameterBinding' -or $_.Exception.GetType().Name -match 'ParameterBinding') { $bindingEx++ }
  if ($_.Exception.Message -match 'StrictMode|not set|undefined') { $strictEx++ }
  Add-Result 'S3' $false $_.Exception.Message
}

# S4 reconnect replaces with new session in return
try {
  Set-StrictMode -Version Latest
  Reset-Fs
  $s0 = New-MockSession
  $oldId = $s0.sessionId
  $oldWriter = $s0.writer
  $up = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 `
    -FtpConfig $cfg -FailInject 'disconnect' -FailInjectOnAttempt 1
  $reused = @($up.attemptLogs | Where-Object { $_.reusedWriter }).Count
  $script:reusedWriter += $reused
  $ok = $up.success -and ($null -ne $up.session) -and ($up.session.sessionId -ne $oldId) `
    -and ($up.session.writer.Id -ne $oldWriter.Id) -and ($reused -eq 0)
  Add-Result 'S4' $ok ("old=$oldId new=$($up.session.sessionId) reused=$reused")
} catch {
  if ($_.FullyQualifiedErrorId -match 'ParameterBinding' -or $_.Exception.GetType().Name -match 'ParameterBinding') { $bindingEx++ }
  if ($_.Exception.Message -match 'StrictMode|not set|undefined') { $strictEx++ }
  Add-Result 'S4' $false $_.Exception.Message
}

# S5 reconnect failure does not reuse old session (session null on fail result)
try {
  Set-StrictMode -Version Latest
  Reset-Fs
  $s0 = New-MockSession
  $script:SmileFtpFailStorCodesQueue = @(450, 450, 450)
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FtpConfig $cfg
    Add-Result 'S5' $false 'should fail'
  } catch {
    $payload = $_.Exception.Data['safeImageResult']
    $norm = Normalize-SmileFtpSafeImageUploadResult $payload
    $ok = (Test-ResultShape $norm) -and (-not $norm.success) -and ($null -eq $norm.session)
    Add-Result 'S5' $ok ("failSessionNull=$($null -eq $norm.session)")
  }
} catch {
  if ($_.FullyQualifiedErrorId -match 'ParameterBinding' -or $_.Exception.GetType().Name -match 'ParameterBinding') { $bindingEx++ }
  if ($_.Exception.Message -match 'StrictMode|not set|undefined') { $strictEx++ }
  Add-Result 'S5' $false $_.Exception.Message
}

# S6 Windows PowerShell 5.1 marker
try {
  $ver = $PSVersionTable.PSVersion
  $is51 = ($ver.Major -eq 5 -and $ver.Minor -ge 1) -or ($ver.Major -eq 5)
  Add-Result 'S6' $true ("PSVersion=$ver isWinPS51ish=$is51")
} catch {
  Add-Result 'S6' $false $_.Exception.Message
}

# S7 PowerShell 7 if available
try {
  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($null -eq $pwsh) {
    Add-Result 'S7' $true 'pwsh not installed; skipped ok'
  } else {
    $tmp = Join-Path $env:TEMP ('smile-s7-' + [guid]::NewGuid().ToString('N') + '.ps1')
    @'
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = "C:\Users\perfo\Desktop\SmileAIStudio"
. (Join-Path $root "scripts\ftp-readonly-probe.ps1")
. (Join-Path $root "scripts\ftp-safe-image-upload.ps1")
$r = New-SmileFtpSafeImageUploadResult -Success $true -Status "ok" -Attempts 1 -Session ([pscustomobject]@{ sessionId = "pwsh" })
$n = Normalize-SmileFtpSafeImageUploadResult $r
if (-not $n.success) { throw "normalize failed" }
if ($null -eq $n.session) { throw "session missing" }
if ($n.session.sessionId -ne "pwsh") { throw "session mismatch" }
Write-Output "S7_OK"
'@ | Set-Content -Path $tmp -Encoding UTF8
    $out = & pwsh -NoProfile -File $tmp 2>&1
    Remove-Item -Force $tmp -ErrorAction SilentlyContinue
    $ok = ($out -join "`n") -match 'S7_OK'
    Add-Result 'S7' $ok ("pwshOut=$out")
  }
} catch {
  if ($_.FullyQualifiedErrorId -match 'ParameterBinding' -or $_.Exception.GetType().Name -match 'ParameterBinding') { $bindingEx++ }
  Add-Result 'S7' $false $_.Exception.Message
}

# S8 StrictMode enabled end-to-end
try {
  Set-StrictMode -Version Latest
  Reset-Fs
  $s0 = New-MockSession
  $up = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FtpConfig $cfg
  $norm = Normalize-SmileFtpSafeImageUploadResult $up
  $ok = (Test-ResultShape $norm) -and $norm.success -and ($null -ne $norm.session)
  Add-Result 'S8' $ok 'strictmode upload+normalize'
} catch {
  if ($_.Exception.Message -match 'StrictMode|not set|undefined|PropertyNotFound') { $strictEx++ }
  if ($_.FullyQualifiedErrorId -match 'ParameterBinding' -or $_.Exception.GetType().Name -match 'ParameterBinding') { $bindingEx++ }
  Add-Result 'S8' $false $_.Exception.Message
}

# S9 mock session (TestDouble path)
try {
  Set-StrictMode -Version Latest
  Reset-Fs
  $s0 = New-MockSession
  $up = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FtpConfig $cfg
  $ok = $up.success -and ($null -ne $up.session) -and ($up.session.sessionId -like 'sess-*' -or $up.session.sessionId.Length -gt 0)
  Add-Result 'S9' $ok ("mockSession=$($up.session.sessionId)")
} catch {
  if ($_.FullyQualifiedErrorId -match 'ParameterBinding' -or $_.Exception.GetType().Name -match 'ParameterBinding') { $bindingEx++ }
  if ($_.Exception.Message -match 'StrictMode|not set|undefined') { $strictEx++ }
  Add-Result 'S9' $false $_.Exception.Message
}

# S10 cleanup session path (dedicated reconnect; prior writer not required)
try {
  Set-StrictMode -Version Latest
  Reset-Fs
  $script:SharedFs['260721-2.jpg.smile-uploading'] = [byte[]](1..10)
  $prior = New-MockSession
  $cu = Invoke-SmileFtpCleanupTempWithReconnect -FtpConfig $cfg -TempFileName '260721-2.jpg.smile-uploading' `
    -ExpectedFullSize $bytes1.Length -ExpectedFullSha $sha1 -PriorSession $prior
  $ok = [bool]$cu.deleted -and (-not $script:SharedFs.ContainsKey('260721-2.jpg.smile-uploading'))
  Add-Result 'S10' $ok ("cleanup reason=$($cu.reason) sessionId=$($cu.sessionId)")
} catch {
  if ($_.FullyQualifiedErrorId -match 'ParameterBinding' -or $_.Exception.GetType().Name -match 'ParameterBinding') { $bindingEx++ }
  if ($_.Exception.Message -match 'StrictMode|not set|undefined') { $strictEx++ }
  Add-Result 'S10' $false $_.Exception.Message
}

$pass = @($results | Where-Object { $_.ok }).Count
$fail = @($results | Where-Object { -not $_.ok }).Count
Write-Output ("ok=$($fail -eq 0); pass=$pass; fail=$fail; ParameterBindingException=$bindingEx; StrictModeExceptions=$strictEx; reusedWriter=$reusedWriter; realXserver=0; publishApi=0; realFtpWrite=0")
foreach ($r in $results) {
  Write-Output ("RESULT " + $r.id + "=" + $(if ($r.ok) { 'PASS' } else { 'FAIL' }) + " :: " + $r.detail)
}
$outDir = Join-Path $root '.data\mock-tests'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
[IO.File]::WriteAllLines((Join-Path $outDir ('session-ref-compat-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')), @($results | ForEach-Object { "$($_.id)|$($_.ok)|$($_.detail)" }))
if ($fail -gt 0) { exit 2 }
exit 0

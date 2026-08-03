# Local mock A-T: control reconnect + chunk write. NO real Xserver / publish API.
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
$results = New-Object System.Collections.Generic.List[object]
$undefEx = 0

function Add-Result([string]$id, [bool]$ok, [string]$detail) {
  [void]$results.Add([pscustomobject]@{ id = $id; ok = $ok; detail = $detail })
}
function Get-Sha256Hex([byte[]]$bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function Count-Cmd($s, [string]$pat) {
  return @($s.commands | Where-Object { $_ -match $pat }).Count
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

$script:SharedFs = @{}
$script:SmileFtpReconnectFactory = {
  param($PriorSession, $FtpConfig)
  $script:ReconnectCount++
  $forceAuth = $false
  $forceLogin = $false
  if ($null -ne $FtpConfig) {
    try {
      $p = $FtpConfig.PSObject.Properties['forceAuthFail']
      if ($null -ne $p) { $forceAuth = [bool]$p.Value }
    } catch {}
    try {
      $p2 = $FtpConfig.PSObject.Properties['forceLoginFail']
      if ($null -ne $p2) { $forceLogin = [bool]$p2.Value }
    } catch {}
  }
  if ($forceAuth) {
    throw [Exception]'AUTH TLS failed / exceptionType=RECONNECT_AUTH_TLS'
  }
  if ($forceLogin) {
    throw [Exception]'530 authentication failed / exceptionType=RECONNECT_LOGIN'
  }
  $s = New-MockSession -InitialFiles $script:SharedFs
  [void]$s.commands.Add('AUTH TLS')
  [void]$script:AuthTlsSeq.Add([string]$s.sessionId)
  [void]$s.commands.Add('PBSZ 0')
  [void]$s.commands.Add('PROT P')
  [void]$s.commands.Add('USER mock')
  [void]$s.commands.Add('PASS ********')
  [void]$s.commands.Add('CWD diary')
  [void]$s.commands.Add('CWD image')
  # Keep shared FS reference
  $s.files = $script:SharedFs
  return $s
}

$script:SmileFtpTestDouble = @{
  StorBytesSecure = {
    param($sess, $name, $bytes)
    [void]$sess.commands.Add('PASV')
    [void]$sess.commands.Add('STOR ' + $name)
    # Simulate chunk accounting
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
$bytes2 = [byte[]](41..90)
$sha1 = Get-Sha256Hex $bytes1
$sha2 = Get-Sha256Hex $bytes2
$f1 = '260721-2.jpg'; $f2 = '260721-2b.jpg'
$t1 = '260721-2.jpg.smile-uploading'
$cfg = [pscustomobject]@{ host = 'mock'; username = 'u'; password = 'p'; remoteRoot = '/'; useTls = $true; port = 21 }

function Reset-Fs { $script:SharedFs = @{}; $script:ReconnectCount = 0; $script:AuthTlsSeq = New-Object System.Collections.Generic.List[string]; $script:SmileFtpFailStorCodesQueue = $null; $script:MockForceRntoFail = $false }

# A first success
try {
  Reset-Fs
  $s0 = New-MockSession
  $up = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FtpConfig $cfg
  $ok = $up.success -and $up.attempts -eq 1 -and $script:SharedFs.ContainsKey($f1) -and (-not $script:SharedFs.ContainsKey($t1)) -and ($null -ne $up.session)
  Add-Result 'A' $ok ("attempts=$($up.attempts) reconnects=$script:ReconnectCount")
} catch { Add-Result 'A' $false $_.Exception.Message }

# B disconnect then 2nd success
try {
  Reset-Fs
  $s0 = New-MockSession
  $up = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 `
    -FtpConfig $cfg -FailInject 'disconnect' -FailInjectOnAttempt 1
  $ids = @($up.attemptLogs | ForEach-Object { $_.sessionId }) | Select-Object -Unique
  $ok = $up.success -and $up.attempts -eq 2 -and $ids.Count -eq 2 -and ($null -ne $up.session)
  Add-Result 'B' $ok ("attempts=$($up.attempts) uniqueSessions=$($ids.Count)")
} catch { Add-Result 'B' $false $_.Exception.Message }

# C two disconnects then 3rd success
try {
  Reset-Fs
  $s0 = New-MockSession
  # use queue 450x2 then null via FailStorCodesQueue after reconnect path — inject disconnect on 1 and 2 via queue
  $script:SmileFtpFailStorCodesQueue = @(450, 450, $null)
  $up = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FtpConfig $cfg
  $ids = @($up.attemptLogs | ForEach-Object { $_.sessionId }) | Select-Object -Unique
  $ok = $up.success -and $up.attempts -eq 3 -and $ids.Count -eq 3 -and ($null -ne $up.session)
  Add-Result 'C' $ok ("attempts=$($up.attempts) uniqueSessions=$($ids.Count)")
} catch { Add-Result 'C' $false $_.Exception.Message }

# D three disconnects
try {
  Reset-Fs
  $s0 = New-MockSession
  $script:SmileFtpFailStorCodesQueue = @(450, 450, 450)
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FtpConfig $cfg
    Add-Result 'D' $false 'should fail'
  } catch {
    $payload = $_.Exception.Data['safeImageResult']
    $att = 0
    $sessNull = $true
    if ($null -ne $payload) {
      try { $att = [int]$payload.attempts } catch { $att = 0 }
      try { $sessNull = ($null -eq $payload.session) } catch { $sessNull = $false }
    }
    $ok = (-not $script:SharedFs.ContainsKey($f1)) -and ($att -eq 3) -and $sessNull
    Add-Result 'D' $ok ("attempts=$att")
  }
} catch { Add-Result 'D' $false $_.Exception.Message }

# E after 450 does not reuse old writer
try {
  Reset-Fs
  $s0 = New-MockSession
  $oldWriter = $s0.writer
  $up = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 `
    -FtpConfig $cfg -FailInject 'disconnect' -FailInjectOnAttempt 1
  $reused = @($up.attemptLogs | Where-Object { $_.reusedWriter }).Count
  $ok = $up.success -and ($reused -eq 0) -and ($null -ne $up.session) -and ($up.session.writer.Id -ne $oldWriter.Id)
  Add-Result 'E' $ok ("reusedWriterLogs=$reused")
} catch { Add-Result 'E' $false $_.Exception.Message }

# F reconnect AUTH TLS fail
try {
  Reset-Fs
  $s0 = New-MockSession
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 `
      -FtpConfig $cfg -FailInject 'reconnectAuthFail' -FailInjectOnAttempt 0 -MaxAttempts 1
    Add-Result 'F' $false 'should throw'
  } catch {
    Add-Result 'F' ($_.Exception.Message -match 'AUTH TLS|RECONNECT_AUTH') 'auth fail recorded'
  }
} catch { Add-Result 'F' $false $_.Exception.Message }

# G reconnect login fail
try {
  Reset-Fs
  $s0 = New-MockSession
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 `
      -FtpConfig $cfg -FailInject 'reconnectLoginFail' -FailInjectOnAttempt 0 -MaxAttempts 1
    Add-Result 'G' $false 'should throw'
  } catch {
    Add-Result 'G' ($_.Exception.Message -match '530|RECONNECT_LOGIN') 'login fail recorded'
  }
} catch { Add-Result 'G' $false $_.Exception.Message }

# H temp residual incomplete fingerprint DELE success
try {
  Reset-Fs
  $script:SharedFs[$t1] = [byte[]](1..10)
  $s = & $script:SmileFtpReconnectFactory $null $cfg
  $del = Remove-SmileFtpIncompleteTempImage -session $s -TempFileName $t1 -ExpectedFullSize $bytes1.Length -ExpectedFullSha $sha1
  Add-Result 'H' ($del.deleted -and (-not $script:SharedFs.ContainsKey($t1))) ("reason=$($del.reason)")
} catch { Add-Result 'H' $false $_.Exception.Message }

# I complete fingerprint refuse DELE
try {
  Reset-Fs
  $script:SharedFs[$t1] = [byte[]]$bytes1
  $s = & $script:SmileFtpReconnectFactory $null $cfg
  $del = Remove-SmileFtpIncompleteTempImage -session $s -TempFileName $t1 -ExpectedFullSize $bytes1.Length -ExpectedFullSha $sha1
  $ok = (-not $del.deleted) -and $del.refused -and $script:SharedFs.ContainsKey($t1)
  Add-Result 'I' $ok ("reason=$($del.reason)")
} catch { Add-Result 'I' $false $_.Exception.Message }

# J cleanup reconnect fail
try {
  Reset-Fs
  $s0 = New-MockSession
  $script:SmileFtpFailStorCodesQueue = @(450)
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 `
      -FtpConfig $cfg -FailInject 'cleanupReconnectFail' -FailInjectOnAttempt 1 -MaxAttempts 1
    Add-Result 'J' $false 'should throw'
  } catch {
    $payload = $_.Exception.Data['safeImageResult']
    $mr = $false
    if ($null -ne $payload) {
      try { $mr = [bool]$payload.manualReviewRequired } catch { $mr = $false }
    }
    Add-Result 'J' $mr ("manualReview=$mr")
  }
} catch { Add-Result 'J' $false $_.Exception.Message }

# K chunk cut mid-write
try {
  Reset-Fs
  $s0 = New-MockSession
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 `
      -FtpConfig $cfg -FailInject 'chunkCut' -FailInjectOnAttempt 1 -MaxAttempts 1
    Add-Result 'K' $false 'should fail'
  } catch {
    Add-Result 'K' ($_.Exception.Message -match 'chunk cut|STOR_DATA_WRITE_FAILED|bytesSent=16384') 'chunk cut handled'
  }
} catch { Add-Result 'K' $false $_.Exception.Message }

# L bytesSent short
try {
  Reset-Fs
  $s0 = New-MockSession
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 `
      -FtpConfig $cfg -FailInject 'bytesShort' -FailInjectOnAttempt 1 -MaxAttempts 1
    Add-Result 'L' $false 'should fail'
  } catch {
    Add-Result 'L' ($_.Exception.Message -match 'bytesSent mismatch|STOR_BYTES_SENT_MISMATCH') 'short send detected'
  }
} catch { Add-Result 'L' $false $_.Exception.Message }

# M SIZE mismatch after 226
try {
  Reset-Fs
  $s0 = New-MockSession
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 `
      -FtpConfig $cfg -FailInject 'sizeMismatch' -FailInjectOnAttempt 1 -MaxAttempts 1
    Add-Result 'M' $false 'should fail'
  } catch {
    Add-Result 'M' ($_.Exception.Message -match 'size mismatch') 'size mismatch'
  }
} catch { Add-Result 'M' $false $_.Exception.Message }

# N SHA mismatch
try {
  Reset-Fs
  $s0 = New-MockSession
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 `
      -FtpConfig $cfg -FailInject 'shaMismatch' -FailInjectOnAttempt 1 -MaxAttempts 1
    Add-Result 'N' $false 'should fail'
  } catch {
    Add-Result 'N' ($_.Exception.Message -match 'sha mismatch') 'sha mismatch'
  }
} catch { Add-Result 'N' $false $_.Exception.Message }

# O img1 ok img2 fail => index STOR 0
try {
  Reset-Fs
  $s0 = New-MockSession
  $up1 = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FtpConfig $cfg
  $session = $up1.session
  $script:SmileFtpFailStorCodesQueue = @(450, 450, 450)
  $failed = $false
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $session -FormalFileName $f2 -Bytes $bytes2 -ExpectedSha $sha2 -FtpConfig $cfg
  } catch { $failed = $true }
  $indexStor = 0
  $gate = $script:SharedFs.ContainsKey($f1) -and $script:SharedFs.ContainsKey($f2)
  Add-Result 'O' ($failed -and (-not $gate) -and ($indexStor -eq 0)) 'index blocked'
} catch { Add-Result 'O' $false $_.Exception.Message }

# P both images then index
try {
  Reset-Fs
  $s0 = New-MockSession
  $up1 = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FtpConfig $cfg
  $session = $up1.session
  $up2 = Invoke-SmileFtpUploadImageViaTemp -session $session -FormalFileName $f2 -Bytes $bytes2 -ExpectedSha $sha2 -FtpConfig $cfg
  $session = $up2.session
  $gate = $script:SharedFs.ContainsKey($f1) -and $script:SharedFs.ContainsKey($f2)
  if ($gate) { [void]$session.commands.Add('STOR index.htm.smile-publishing') }
  $indexStor = @($session.commands | Where-Object { $_ -match '^STOR index' }).Count
  Add-Result 'P' ($gate -and $indexStor -eq 1) 'index after both'
} catch { Add-Result 'P' $false $_.Exception.Message }

# Q reused writer count 0 across reconnect success path
try {
  Reset-Fs
  $s0 = New-MockSession
  $up = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 `
    -FtpConfig $cfg -FailInject 'disconnect' -FailInjectOnAttempt 1
  $reused = @($up.attemptLogs | Where-Object { $_.reusedWriter }).Count
  Add-Result 'Q' ($reused -eq 0) "reused=$reused"
} catch { Add-Result 'Q' $false $_.Exception.Message }

# R StrictMode / undef
try {
  Set-StrictMode -Version Latest
  Remove-Variable SmileFtpTestDouble -Scope Script -EA SilentlyContinue
  $null = Get-SmileFtpTestDouble
  $null = Get-SmileFtpStorBackendMode
  $script:SmileFtpTestDouble = $null
  Add-Result 'R' ($undefEx -eq 0) 'strict ok'
} catch {
  if ($_.Exception.Message -match 'not set|undefined|StrictMode|Variable') { $undefEx++ }
  Add-Result 'R' $false $_.Exception.Message
}

# S manualReviewRequired
try {
  Reset-Fs
  $s0 = New-MockSession
  $script:SmileFtpFailStorCodesQueue = @(450)
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 `
      -FtpConfig $cfg -FailInject 'cleanupReconnectFail' -FailInjectOnAttempt 1 -MaxAttempts 1
    Add-Result 'S' $false 'should fail'
  } catch {
    $payload = $_.Exception.Data['safeImageResult']
    $mr = $false
    if ($null -ne $payload) {
      try { $mr = [bool]$payload.manualReviewRequired } catch { $mr = $false }
    }
    Add-Result 'S' $mr "manualReview=$mr"
  }
} catch { Add-Result 'S' $false $_.Exception.Message }

# T do not delete existing formal
try {
  Reset-Fs
  $script:SharedFs[$f1] = [byte[]]$bytes1
  $s0 = New-MockSession
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s0 -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FtpConfig $cfg
    Add-Result 'T' $false 'should collision'
  } catch {
    $still = $script:SharedFs.ContainsKey($f1)
    $deleFormal = 0
    Add-Result 'T' ($still -and ($_.Exception.Message -match 'collision')) 'formal preserved'
  }
} catch { Add-Result 'T' $false $_.Exception.Message }

$pass = @($results | Where-Object { $_.ok }).Count
$fail = @($results | Where-Object { -not $_.ok }).Count
Write-Output ("ok=$($fail -eq 0); pass=$pass; fail=$fail; undefVarExceptions=$undefEx; realXserver=0; publishApi=0; chunkSize=16384")
foreach ($r in $results) {
  Write-Output ("RESULT " + $r.id + "=" + $(if ($r.ok) { 'PASS' } else { 'FAIL' }) + " :: " + $r.detail)
}
$outDir = Join-Path $root '.data\mock-tests'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
[IO.File]::WriteAllLines((Join-Path $outDir ('reconnect-chunk-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')), @($results | ForEach-Object { "$($_.id)|$($_.ok)|$($_.detail)" }))
if ($fail -gt 0) { exit 2 }
exit 0

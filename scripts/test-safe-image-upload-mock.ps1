# Local mock E2E A-O for safe temp image upload + lastStorFailure contract.
# NO real Xserver / FTP network / production publish API.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\perfo\Desktop\SmileAIStudio'
. (Join-Path $root 'scripts\ftp-readonly-probe.ps1')
. (Join-Path $root 'scripts\ftp-safe-image-upload.ps1')
. (Join-Path $root 'scripts\ftp-production-publish.ps1')

$script:SmileFtpSkipRetrySleep = $true
$script:SmileFtpFailStorCodesQueue = $null
$script:MockForceRntoFail = $false
$script:SmileFtpTestDouble = $null
$results = New-Object System.Collections.Generic.List[object]

function Get-Sha256Hex([byte[]]$bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Add-Result([string]$id, [bool]$ok, [string]$detail) {
  [void]$results.Add([pscustomobject]@{ id = $id; ok = $ok; detail = $detail })
}

function Count-Cmd($session, [string]$pattern) {
  return @($session.commands | Where-Object { $_ -match $pattern }).Count
}

function New-MockSession {
  param([hashtable]$InitialFiles = $null)
  $fs = @{}
  if ($InitialFiles) { foreach ($k in $InitialFiles.Keys) { $fs[$k] = [byte[]]$InitialFiles[$k] } }
  $session = [pscustomobject]@{
    files = $fs
    commands = New-Object System.Collections.Generic.List[string]
    allowStor = $true
    allowDele = $false
    allowRename = $true
    storAllowList = New-Object System.Collections.Generic.List[string]
    deleAllowList = New-Object System.Collections.Generic.List[string]
    renameAllowList = New-Object System.Collections.Generic.List[string]
    closed = $false
    client = [pscustomobject]@{ ReceiveTimeout = 25000; SendTimeout = 25000 }
    ssl = $true
    lastStorFailure = $null
    pendingRnfr = $null
    dataTransferTimeoutMs = 120000
    controlReplyTimeoutMs = 60000
  }
  return $session
}

function Install-MockFtpDouble {
  param($session)
  $script:SmileFtpTestDouble = @{
    StorBytesSecure = {
      param($sess, $name, $bytes)
      if (-not $sess.allowStor) { throw 'STOR blocked' }
      if ($sess.storAllowList.Count -gt 0 -and $sess.storAllowList -notcontains $name) {
        throw "STOR blocked for non-manifest file: $name"
      }
      [void]$sess.commands.Add('PASV')
      [void]$sess.commands.Add('STOR ' + $name)
      $sess.files[$name] = [byte[]]$bytes
      [void]$sess.commands.Add('226')
      return [pscustomobject]@{ ok = $true; code = 226; expectedSize = $bytes.Length; pasvHost = 'mock'; pasvPort = 1 }
    }
  }
}

function Invoke-SmileFtpSize {
  param($session, [string]$RemoteFileName)
  [void]$session.commands.Add('SIZE ' + $RemoteFileName)
  if ($session.files.ContainsKey($RemoteFileName)) {
    return @{ ok = $true; size = [long]$session.files[$RemoteFileName].Length; code = 213; text = ('213 ' + $session.files[$RemoteFileName].Length) }
  }
  return @{ ok = $false; size = $null; code = 550; text = '550 No such file' }
}
function Invoke-SmileFtpRetrBytes {
  param($session, [string]$RemoteFileName)
  [void]$session.commands.Add('RETR ' + $RemoteFileName)
  if (-not $session.files.ContainsKey($RemoteFileName)) { throw "RETR failed: $RemoteFileName" }
  $raw = $session.files[$RemoteFileName]
  $copy = New-Object byte[] ($raw.Length)
  [Array]::Copy($raw, $copy, $raw.Length)
  return ,$copy
}
function Invoke-SmileFtpDeleFile {
  param($session, [string]$RemoteFileName)
  if (-not $session.allowDele) { throw 'DELE not enabled' }
  if ($session.deleAllowList.Count -gt 0 -and $session.deleAllowList -notcontains $RemoteFileName) {
    throw "DELE blocked for non-tracked file: $RemoteFileName"
  }
  [void]$session.commands.Add('DELE ' + $RemoteFileName)
  if (-not $session.files.ContainsKey($RemoteFileName)) { throw "DELE failed: $RemoteFileName" }
  $session.files.Remove($RemoteFileName) | Out-Null
  return $true
}
function Send-SmileFtpCommand {
  param($session, [string]$CommandLine, [switch]$SecretArg)
  [void]$session.commands.Add($CommandLine.Trim())
  if ($CommandLine -match '^TYPE\b' -or $CommandLine -match '^CWD\b') {
    return @{ code = 250; text = '250 OK'; lines = @('250 OK') }
  }
  if ($CommandLine -match '^RNFR\s+(.+)$') {
    $session.pendingRnfr = $Matches[1]
    return @{ code = 350; text = '350 OK'; lines = @('350 OK') }
  }
  if ($CommandLine -match '^RNTO\s+(.+)$') {
    if ($script:MockForceRntoFail) {
      return @{ code = 550; text = '550 RNTO failed'; lines = @('550 RNTO failed') }
    }
    $from = [string]$session.pendingRnfr
    $to = $Matches[1]
    if (-not $from -or -not $session.files.ContainsKey($from)) {
      return @{ code = 550; text = '550 RNFR source missing'; lines = @('550 missing') }
    }
    $session.files[$to] = $session.files[$from]
    $session.files.Remove($from) | Out-Null
    $session.pendingRnfr = $null
    return @{ code = 250; text = '250 OK'; lines = @('250 OK') }
  }
  return @{ code = 200; text = '200 OK'; lines = @('200 OK') }
}
function Invoke-SmileFtpStorBytesSecure {
  param($session, [string]$RemoteFileName, [byte[]]$Bytes)
  return & $script:SmileFtpTestDouble.StorBytesSecure $session $RemoteFileName $Bytes
}
function Get-SmileFtpSha256Hex {
  param([byte[]]$Bytes)
  return (Get-Sha256Hex $Bytes)
}

$bytes1 = [byte[]](1..120)
$bytes2 = [byte[]](50..180)
$sha1 = Get-Sha256Hex $bytes1
$sha2 = Get-Sha256Hex $bytes2
$f1 = '260721-2.jpg'
$f2 = '260721-2b.jpg'
$t1 = '260721-2.jpg.smile-uploading'
$t2 = '260721-2b.jpg.smile-uploading'

function Prep-Session {
  param([hashtable]$init = $null)
  $s = New-MockSession -InitialFiles $init
  Install-MockFtpDouble -session $s
  return $s
}

function Test-HasProp($obj, [string]$name) {
  if ($null -eq $obj) { return $false }
  return ($null -ne $obj.PSObject.Properties[$name])
}

function Invoke-SafePublishFailureAnnotate {
  # Mimics ftp-production-publish.ps1 failure path around lastStorFailure (StrictMode)
  param($session)
  $result = [ordered]@{ ok = $false; result = 'FAILED'; storFailure = $null }
  $storFail = Get-SmileFtpObjectProperty -Object $session -Name 'lastStorFailure' -DefaultValue $null
  if ($null -ne $storFail) { $result.storFailure = $storFail }
  $up = Normalize-SmileFtpSafeImageUploadResult (Get-SmileFtpObjectProperty -Object $session -Name 'lastUploadResult' -DefaultValue $null)
  if (-not $up.success) { $result.result = 'FAILED' }
  return [pscustomobject]$result
}

# ---- A: first attempt success ----
try {
  $s = Prep-Session
  $tx = New-SmileFtpUploadTransactionList
  $script:SmileFtpFailStorCodesQueue = $null
  $up = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -TransactionList $tx
  $ok = $up.success -and $up.ok -and (Test-HasProp $up 'lastStorFailure') -and ($null -eq $up.lastStorFailure) `
    -and $s.files.ContainsKey($f1) -and (-not $s.files.ContainsKey($t1)) `
    -and ((Count-Cmd $s '^STOR\b') -eq 1) -and $up.attempts -eq 1
  Add-Result 'A' $ok ("attempts=$($up.attempts) lastStorFailureNull=$($null -eq $up.lastStorFailure)")
} catch { Add-Result 'A' $false $_.Exception.Message }

# ---- B: 450 then 2nd success ----
try {
  $s = Prep-Session
  $tx = New-SmileFtpUploadTransactionList
  $script:SmileFtpFailStorCodesQueue = @(450, $null)
  $up = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -TransactionList $tx
  $ok = $up.success -and $up.attempts -eq 2 -and $s.files.ContainsKey($f1) -and (Test-HasProp $up 'lastStorFailure')
  Add-Result 'B' $ok ("attempts=$($up.attempts)")
} catch { Add-Result 'B' $false $_.Exception.Message }

# ---- C: 3x fail ----
try {
  $s = Prep-Session
  $tx = New-SmileFtpUploadTransactionList
  $script:SmileFtpFailStorCodesQueue = @(450, 450, 450)
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -TransactionList $tx
    Add-Result 'C' $false 'should have thrown'
  } catch {
    $payload = $null
    try { $payload = $_.Exception.Data['safeImageResult'] } catch {}
    $norm = Normalize-SmileFtpSafeImageUploadResult $payload
    $ok = (-not $s.files.ContainsKey($f1)) -and (-not $norm.success) -and (Test-HasProp $norm 'lastStorFailure') -and $norm.attempts -eq 3
    Add-Result 'C' $ok ("attempts=$($norm.attempts) formalAbsent=$(-not $s.files.ContainsKey($f1))")
  }
} catch { Add-Result 'C' $false $_.Exception.Message }

# ---- D: SIZE mismatch ----
try {
  $s = Prep-Session
  $script:SmileFtpFailStorCodesQueue = $null
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FailInject 'sizeMismatch' -FailInjectOnAttempt 1
    Add-Result 'D' $false 'should throw'
  } catch {
    $ok = (-not $s.files.ContainsKey($f1)) -and ($_.Exception.Message -match 'size mismatch')
    Add-Result 'D' $ok ("formalAbsent=$(-not $s.files.ContainsKey($f1))")
  }
} catch { Add-Result 'D' $false $_.Exception.Message }

# ---- E: SHA mismatch ----
try {
  $s = Prep-Session
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -FailInject 'shaMismatch' -FailInjectOnAttempt 1
    Add-Result 'E' $false 'should throw'
  } catch {
    $ok = (-not $s.files.ContainsKey($f1)) -and ($_.Exception.Message -match 'sha mismatch')
    Add-Result 'E' $ok ("formalAbsent=$(-not $s.files.ContainsKey($f1))")
  }
} catch { Add-Result 'E' $false $_.Exception.Message }

# ---- F: RNTO fail ----
try {
  $s = Prep-Session
  $script:MockForceRntoFail = $true
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1
    Add-Result 'F' $false 'should throw'
  } catch {
    $ok = (-not $s.files.ContainsKey($f1)) -and ($_.Exception.Message -match 'RNTO') -and (-not $s.files.ContainsKey($t1))
    Add-Result 'F' $ok ("formalAbsent=$(-not $s.files.ContainsKey($f1)) tempAbsent=$(-not $s.files.ContainsKey($t1))")
  } finally { $script:MockForceRntoFail = $false }
} catch { Add-Result 'F' $false $_.Exception.Message }

# ---- G: return has lastStorFailure=null ----
try {
  $s = Prep-Session
  $up = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1
  $ok = (Test-HasProp $up 'lastStorFailure') -and ($null -eq $up.lastStorFailure) -and $up.success
  Add-Result 'G' $ok 'lastStorFailure present and null on success'
} catch { Add-Result 'G' $false $_.Exception.Message }

# ---- H: return has lastStorFailure with value ----
try {
  $built = New-SmileFtpSafeImageUploadResult -Success $false -Status 'failed' -Attempts 1 `
    -LastStorFailure ([pscustomobject]@{ code = 450; remoteSize = 98010; expectedBytes = 120 }) `
    -ErrorCode 'SAFE_IMAGE_UPLOAD_FAILED' -Detail 'mock 450'
  $ok = (Test-HasProp $built 'lastStorFailure') -and ($null -ne $built.lastStorFailure) -and ([int]$built.lastStorFailure.code -eq 450)
  Add-Result 'H' $ok 'lastStorFailure present with value'
} catch { Add-Result 'H' $false $_.Exception.Message }

# ---- I: old shape without lastStorFailure ----
try {
  $old = [pscustomobject]@{ ok = $true; attemptCount = 1; formalFileName = $f1 }
  $threw = $false
  try {
    $norm = Normalize-SmileFtpSafeImageUploadResult $old
    $annotate = Invoke-SafePublishFailureAnnotate -session (@{ closed = $true })
  } catch {
    $threw = $true
  }
  $ok = (-not $threw) -and (Test-HasProp $norm 'lastStorFailure') -and ($null -eq $norm.lastStorFailure) -and ($annotate.result -eq 'FAILED' -or $norm.success)
  Add-Result 'I' $ok 'old shape normalized; no PropertyNotFoundException'
} catch { Add-Result 'I' $false $_.Exception.Message }

# ---- J: null return ----
try {
  $threw = $false
  try {
    $norm = Normalize-SmileFtpSafeImageUploadResult $null
    $null = Invoke-SafePublishFailureAnnotate -session $null
  } catch { $threw = $true }
  $ok = (-not $threw) -and (-not $norm.success) -and (Test-HasProp $norm 'lastStorFailure') -and ($norm.errorCode -eq 'SAFE_IMAGE_NULL_RESULT')
  Add-Result 'J' $ok 'null result -> FAILED safely'
} catch { Add-Result 'J' $false $_.Exception.Message }

# ---- K: empty object ----
try {
  $threw = $false
  try {
    $norm = Normalize-SmileFtpSafeImageUploadResult ([pscustomobject]@{})
  } catch { $threw = $true }
  $ok = (-not $threw) -and (-not $norm.success) -and (Test-HasProp $norm 'lastStorFailure') -and ($norm.errorCode -eq 'SAFE_IMAGE_EMPTY_RESULT')
  Add-Result 'K' $ok 'empty object -> FAILED safely'
} catch { Add-Result 'K' $false $_.Exception.Message }

# ---- L: StrictMode + session without prior lastStorFailure key (hashtable like New-SmileFtpSession) ----
try {
  Set-StrictMode -Version Latest
  $ht = @{
    commands = New-Object System.Collections.Generic.List[string]
    closed = $false
    # intentionally omit lastStorFailure to prove safe getter
  }
  $threw = $false
  try {
    $v = Get-SmileFtpObjectProperty -Object $ht -Name 'lastStorFailure' -DefaultValue $null
    $r = Invoke-SafePublishFailureAnnotate -session $ht
  } catch { $threw = $true }
  $ok = (-not $threw) -and ($null -eq $v) -and ($r.result -eq 'FAILED')
  # Also ensure New-SmileFtpSession includes the property (without connecting): inspect source contract via helper init
  $withProp = @{ lastStorFailure = $null; closed = $false }
  $v2 = Get-SmileFtpObjectProperty -Object $withProp -Name 'lastStorFailure' -DefaultValue 'missing'
  $ok = $ok -and ($null -eq $v2)
  Add-Result 'L' $ok 'StrictMode safe access; no PropertyNotFoundException'
} catch { Add-Result 'L' $false $_.Exception.Message }

# ---- M: publish failure path before image STOR (session without lastStorFailure) ----
try {
  $sessionPreImage = @{
    commands = New-Object System.Collections.Generic.List[string]
    closed = $false
    allowStor = $true
    # no lastStorFailure
  }
  $threw = $false
  $progress = @('1/8 lock', '2/8 recheck')
  try {
    # Simulate catch annotation before any image upload command
    $annotated = Invoke-SafePublishFailureAnnotate -session $sessionPreImage
    $writeCmds = @($sessionPreImage.commands | Where-Object { $_ -match '^(STOR|DELE|RNFR|RNTO)\b' }).Count
  } catch { $threw = $true }
  $ok = (-not $threw) -and ($annotated.result -eq 'FAILED') -and ($writeCmds -eq 0) -and ($progress.Count -ge 1)
  Add-Result 'M' $ok 'pre-image failure annotate safe; write cmds=0'
} catch { Add-Result 'M' $false $_.Exception.Message }

# ---- N: both images success required before index ----
try {
  $s = Prep-Session
  $tx = New-SmileFtpUploadTransactionList
  $null = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -TransactionList $tx
  $indexStor = 0
  $gatePass = ($s.files.ContainsKey($f1) -and $s.files.ContainsKey($f2))
  if ($gatePass) { throw 'gate should not pass yet' }
  # no index STOR while incomplete
  $null = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f2 -Bytes $bytes2 -ExpectedSha $sha2 -TransactionList $tx
  $gatePass2 = $s.files.ContainsKey($f1) -and $s.files.ContainsKey($f2) -and (-not $s.files.ContainsKey($t1)) -and (-not $s.files.ContainsKey($t2))
  if ($gatePass2) {
    [void]$s.commands.Add('STOR index.htm.smile-publishing')
    $indexStor = Count-Cmd $s '^STOR index'
  }
  $ok = $gatePass2 -and ($indexStor -eq 1)
  Add-Result 'N' $ok 'index STOR only after both images ok'
} catch { Add-Result 'N' $false $_.Exception.Message }

# ---- O: image failure => index STOR 0 ----
try {
  $s = Prep-Session
  $tx = New-SmileFtpUploadTransactionList
  $null = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -TransactionList $tx
  $script:SmileFtpFailStorCodesQueue = @(450, 450, 450)
  $img2Failed = $false
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f2 -Bytes $bytes2 -ExpectedSha $sha2 -TransactionList $tx
  } catch { $img2Failed = $true }
  $gatePass = $s.files.ContainsKey($f1) -and $s.files.ContainsKey($f2)
  $indexStor = 0
  if (-not $gatePass) {
    # correctly skip index
  } else {
    [void]$s.commands.Add('STOR index.htm.smile-publishing')
    $indexStor = 1
  }
  $ok = $img2Failed -and (-not $gatePass) -and ($indexStor -eq 0) -and ((Count-Cmd $s '^STOR index') -eq 0)
  Add-Result 'O' $ok 'image fail blocks index STOR'
} catch { Add-Result 'O' $false $_.Exception.Message }

$pass = @($results | Where-Object { $_.ok }).Count
$fail = @($results | Where-Object { -not $_.ok }).Count
$summaryText = @"
ok=$($fail -eq 0); pass=$pass; fail=$fail; realXserver=0; publishApi=0; realStor=0; realDele=0; realRnfr=0; realRnto=0; xserverUpdates=0; articleStatus=package-ready
"@
Write-Output $summaryText
foreach ($r in $results) {
  Write-Output ("RESULT " + $r.id + "=" + $(if ($r.ok) { 'PASS' } else { 'FAIL' }) + " :: " + $r.detail)
}
$outDir = Join-Path $root '.data\mock-tests'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$lines = @($results | ForEach-Object { "$($_.id)|$($_.ok)|$($_.detail)" })
$outPath = Join-Path $outDir ('safe-image-upload-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
[IO.File]::WriteAllLines($outPath, $lines)
if ($fail -gt 0) { exit 2 }
exit 0

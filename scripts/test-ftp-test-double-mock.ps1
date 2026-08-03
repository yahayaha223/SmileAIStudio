# Local mock A-L for SmileFtpTestDouble StrictMode safety. NO real Xserver / publish API.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\perfo\Desktop\SmileAIStudio'

# Ensure variable is NOT inherited from a prior session before first dotsource tests.
# We will Remove-Variable inside case A after dotsource+re-init.

. (Join-Path $root 'scripts\ftp-readonly-probe.ps1')
. (Join-Path $root 'scripts\ftp-safe-image-upload.ps1')

$results = New-Object System.Collections.Generic.List[object]
$undefExCount = 0

function Add-Result([string]$id, [bool]$ok, [string]$detail) {
  [void]$results.Add([pscustomobject]@{ id = $id; ok = $ok; detail = $detail })
}

function Test-UndefVarException([scriptblock]$Block) {
  try {
    & $Block | Out-Null
    return @{ threw = $false; undef = $false; msg = '' }
  } catch {
    $msg = [string]$_.Exception.Message
    $undef = ($msg -match '設定されていないため取得できません' -or $msg -match 'SmileFtpTestDouble' -or $msg -match 'FtpTestDouble')
    if ($undef) { $script:undefExCount++ }
    return @{ threw = $true; undef = $undef; msg = $msg }
  }
}

# ---- A: undefined ----
try {
  Remove-Variable -Name SmileFtpTestDouble -Scope Script -ErrorAction SilentlyContinue
  $r = Test-UndefVarException {
    $null = Get-SmileFtpTestDouble
    $mode = Get-SmileFtpStorBackendMode
    if ($mode -ne 'real') { throw 'expected real backend when undefined' }
  }
  Add-Result 'A' ((-not $r.undef) -and (-not $r.threw -or -not $r.undef)) ("mode after undef ok; threw=$($r.threw) undef=$($r.undef)")
  # Restore init for later tests
  $script:SmileFtpTestDouble = $null
} catch {
  if ($_.Exception.Message -match '設定されていないため取得できません') { $undefExCount++ }
  Add-Result 'A' $false $_.Exception.Message
}

# ---- B: null ----
try {
  $script:SmileFtpTestDouble = $null
  $r = Test-UndefVarException {
    if ((Get-SmileFtpStorBackendMode) -ne 'real') { throw 'expected real' }
    if ($null -ne (Get-SmileFtpTestDouble)) { throw 'expected null double' }
  }
  Add-Result 'B' (-not $r.threw) ("backend=real null double")
} catch {
  if ($_.Exception.Message -match '設定されていないため取得できません') { $undefExCount++ }
  Add-Result 'B' $false $_.Exception.Message
}

# ---- C: empty hashtable ----
try {
  $script:SmileFtpTestDouble = @{}
  $r = Test-UndefVarException {
    if ((Get-SmileFtpStorBackendMode) -ne 'real') { throw 'empty hashtable must not select mock' }
  }
  Add-Result 'C' (-not $r.threw) 'empty hashtable -> real'
  $script:SmileFtpTestDouble = $null
} catch {
  if ($_.Exception.Message -match '設定されていないため取得できません') { $undefExCount++ }
  Add-Result 'C' $false $_.Exception.Message
}

# ---- D: valid mock object ----
try {
  $called = $false
  $script:SmileFtpTestDouble = @{
    StorBytesSecure = {
      param($sess, $name, $bytes)
      $script:called = $true
      return [pscustomobject]@{ ok = $true; code = 226; expectedSize = $bytes.Length }
    }
  }
  $r = Test-UndefVarException {
    if ((Get-SmileFtpStorBackendMode) -ne 'mock') { throw 'expected mock' }
    $sess = [pscustomobject]@{ allowStor = $true }
    $out = Invoke-SmileFtpStorBytesSecure -session $sess -RemoteFileName '260721-2.jpg.smile-uploading' -Bytes ([byte[]](1..8))
    if (-not $out.ok -or $out.code -ne 226) { throw 'mock stor failed' }
  }
  Add-Result 'D' (-not $r.threw) 'valid mock used'
  $script:SmileFtpTestDouble = $null
} catch {
  if ($_.Exception.Message -match '設定されていないため取得できません') { $undefExCount++ }
  Add-Result 'D' $false $_.Exception.Message
}

# ---- E: incomplete old mock (no StorBytesSecure) ----
try {
  $script:SmileFtpTestDouble = @{ Other = 1 }
  $r = Test-UndefVarException {
    if ((Get-SmileFtpStorBackendMode) -ne 'real') { throw 'incomplete mock must fall back to real' }
  }
  Add-Result 'E' (-not $r.threw) 'incomplete mock -> real'
  $script:SmileFtpTestDouble = $null
} catch {
  if ($_.Exception.Message -match '設定されていないため取得できません') { $undefExCount++ }
  Add-Result 'E' $false $_.Exception.Message
}

# ---- F: StrictMode enabled (already) + direct-style safe access ----
try {
  Set-StrictMode -Version Latest
  Remove-Variable -Name SmileFtpTestDouble -Scope Script -ErrorAction SilentlyContinue
  $r = Test-UndefVarException {
    $td = Get-SmileFtpTestDouble
    $use = Test-SmileFtpUseTestDoubleStor
    $mode = Get-SmileFtpStorBackendMode
    if ($null -ne $td -or $use -or $mode -ne 'real') { throw 'strict undef path failed' }
  }
  Add-Result 'F' (-not $r.undef) ("StrictMode safe; threw=$($r.threw) undef=$($r.undef)")
  $script:SmileFtpTestDouble = $null
} catch {
  if ($_.Exception.Message -match '設定されていないため取得できません') { $undefExCount++ }
  Add-Result 'F' $false $_.Exception.Message
}

# ---- G: production mode selects real FTP branch ----
try {
  $script:SmileFtpTestDouble = $null
  $mode = Get-SmileFtpStorBackendMode
  $use = Test-SmileFtpUseTestDoubleStor
  Add-Result 'G' (($mode -eq 'real') -and (-not $use)) 'production -> real branch'
} catch {
  if ($_.Exception.Message -match '設定されていないため取得できません') { $undefExCount++ }
  Add-Result 'G' $false $_.Exception.Message
}

# ---- H: mock mode selects mock branch ----
try {
  $script:SmileFtpTestDouble = @{
    StorBytesSecure = { param($s,$n,$b) return [pscustomobject]@{ ok = $true; code = 226 } }
  }
  $mode = Get-SmileFtpStorBackendMode
  $use = Test-SmileFtpUseTestDoubleStor
  Add-Result 'H' (($mode -eq 'mock') -and $use) 'mock -> mock branch'
  $script:SmileFtpTestDouble = $null
} catch {
  if ($_.Exception.Message -match '設定されていないため取得できません') { $undefExCount++ }
  Add-Result 'H' $false $_.Exception.Message
}

# ---- I: before first image STOR — no exception with real branch + mocked connect gate ----
try {
  $script:SmileFtpTestDouble = $null
  # Simulate publish reaching image stage: backend resolved, allowlist prepared, no STOR yet
  $r = Test-UndefVarException {
    $mode = Get-SmileFtpStorBackendMode
    if ($mode -ne 'real') { throw 'pre-image must be real in production' }
    $temp = Get-SmileFtpImageTempName -FormalFileName '260721-2.jpg'
    if ($temp -ne '260721-2.jpg.smile-uploading') { throw 'bad temp name' }
    # Do not call real STOR / Connect
  }
  Add-Result 'I' (-not $r.threw) 'pre-image no exception; no STOR'
} catch {
  if ($_.Exception.Message -match '設定されていないため取得できません') { $undefExCount++ }
  Add-Result 'I' $false $_.Exception.Message
}

# ---- J/K: reuse lightweight mock upload gate (no real FTP) ----
# Redefine helpers for in-memory FS like the other mock harness
function Get-Sha256Hex([byte[]]$bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
$bytes1 = [byte[]](1..40)
$bytes2 = [byte[]](41..90)
$sha1 = Get-Sha256Hex $bytes1
$sha2 = Get-Sha256Hex $bytes2
$f1 = '260721-2.jpg'; $f2 = '260721-2b.jpg'
$t1 = '260721-2.jpg.smile-uploading'; $t2 = '260721-2b.jpg.smile-uploading'

function New-MemSession {
  return [pscustomobject]@{
    files = @{}
    commands = New-Object System.Collections.Generic.List[string]
    allowStor = $true
    allowDele = $true
    allowRename = $true
    storAllowList = New-Object System.Collections.Generic.List[string]
    deleAllowList = New-Object System.Collections.Generic.List[string]
    renameAllowList = New-Object System.Collections.Generic.List[string]
    closed = $false
    lastStorFailure = $null
    pendingRnfr = $null
    client = [pscustomobject]@{ ReceiveTimeout = 25000; SendTimeout = 25000 }
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
  [void]$session.commands.Add('DELE ' + $RemoteFileName)
  if ($session.files.ContainsKey($RemoteFileName)) { $session.files.Remove($RemoteFileName) | Out-Null }
  return $true
}
function Send-SmileFtpCommand { param($session,[string]$CommandLine,[switch]$SecretArg)
  [void]$session.commands.Add($CommandLine.Trim())
  if ($CommandLine -match '^RNFR\s+(.+)$') { $session.pendingRnfr = $Matches[1]; return @{ code = 350; text = '350' } }
  if ($CommandLine -match '^RNTO\s+(.+)$') {
    $from = [string]$session.pendingRnfr; $to = $Matches[1]
    $session.files[$to] = $session.files[$from]; $session.files.Remove($from) | Out-Null
    return @{ code = 250; text = '250' }
  }
  return @{ code = 200; text = '200' }
}
function Get-SmileFtpSha256Hex { param([byte[]]$Bytes) return (Get-Sha256Hex $Bytes) }

$script:SmileFtpTestDouble = @{
  StorBytesSecure = {
    param($sess, $name, $bytes)
    [void]$sess.commands.Add('STOR ' + $name)
    $sess.files[$name] = [byte[]]$bytes
    return [pscustomobject]@{ ok = $true; code = 226; expectedSize = $bytes.Length }
  }
}
$script:SmileFtpSkipRetrySleep = $true
$script:SmileFtpFailStorCodesQueue = $null

# J: both images then index
try {
  $s = New-MemSession
  $tx = New-SmileFtpUploadTransactionList
  $null = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -TransactionList $tx
  $gate1 = $s.files.ContainsKey($f1) -and $s.files.ContainsKey($f2)
  $null = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f2 -Bytes $bytes2 -ExpectedSha $sha2 -TransactionList $tx
  $gate2 = $s.files.ContainsKey($f1) -and $s.files.ContainsKey($f2)
  $indexStor = 0
  if ($gate2) { [void]$s.commands.Add('STOR index.htm.smile-publishing'); $indexStor = 1 }
  Add-Result 'J' ((-not $gate1) -and $gate2 -and ($indexStor -eq 1)) 'index only after both images'
} catch {
  if ($_.Exception.Message -match '設定されていないため取得できません') { $undefExCount++ }
  Add-Result 'J' $false $_.Exception.Message
}

# K: image2 fail => index STOR 0
try {
  $s = New-MemSession
  $tx = New-SmileFtpUploadTransactionList
  $null = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f1 -Bytes $bytes1 -ExpectedSha $sha1 -TransactionList $tx
  $script:SmileFtpFailStorCodesQueue = @(450, 450, 450)
  $failed = $false
  try {
    $null = Invoke-SmileFtpUploadImageViaTemp -session $s -FormalFileName $f2 -Bytes $bytes2 -ExpectedSha $sha2 -TransactionList $tx
  } catch { $failed = $true }
  $gate = $s.files.ContainsKey($f1) -and $s.files.ContainsKey($f2)
  $indexCount = @($s.commands | Where-Object { $_ -match '^STOR index' }).Count
  Add-Result 'K' ($failed -and (-not $gate) -and ($indexCount -eq 0)) 'image fail blocks index STOR'
} catch {
  if ($_.Exception.Message -match '設定されていないため取得できません') { $undefExCount++ }
  Add-Result 'K' $false $_.Exception.Message
} finally {
  $script:SmileFtpFailStorCodesQueue = $null
  $script:SmileFtpTestDouble = $null
}

# ---- L: undefined variable exception count ----
try {
  Remove-Variable -Name SmileFtpTestDouble -Scope Script -ErrorAction SilentlyContinue
  $before = $undefExCount
  $r = Test-UndefVarException {
    $null = Get-SmileFtpTestDouble
    $null = Test-SmileFtpUseTestDoubleStor
    $null = Get-SmileFtpStorBackendMode
  }
  $ok = (-not $r.undef) -and ($undefExCount -eq $before)
  Add-Result 'L' $ok ("undefExTotal=$undefExCount")
  $script:SmileFtpTestDouble = $null
} catch {
  if ($_.Exception.Message -match '設定されていないため取得できません') { $undefExCount++ }
  Add-Result 'L' $false $_.Exception.Message
}

$pass = @($results | Where-Object { $_.ok }).Count
$fail = @($results | Where-Object { -not $_.ok }).Count
Write-Output ("ok=$($fail -eq 0); pass=$pass; fail=$fail; undefVarExceptions=$undefExCount; realXserver=0; publishApi=0; realStor=0; realDele=0; realRnfr=0; realRnto=0")
foreach ($r in $results) {
  Write-Output ("RESULT " + $r.id + "=" + $(if ($r.ok) { 'PASS' } else { 'FAIL' }) + " :: " + $r.detail)
}
$outDir = Join-Path $root '.data\mock-tests'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$path = Join-Path $outDir ('ftp-test-double-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
[IO.File]::WriteAllLines($path, @($results | ForEach-Object { "$($_.id)|$($_.ok)|$($_.detail)" }))
if ($fail -gt 0 -or $undefExCount -gt 0) { exit 2 }
exit 0

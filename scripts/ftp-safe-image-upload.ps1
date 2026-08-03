# Safe image upload: temp STOR -> verify -> RNFR/RNTO formal.
# Used by production publish. No real network I/O beyond session helpers.
Set-StrictMode -Version Latest

# Always defined so StrictMode never throws on production (null = use real FTP).
$script:SmileFtpTestDouble = $null

function Get-SmileFtpTestDouble {
  $variable = Get-Variable -Name SmileFtpTestDouble -Scope Script -ErrorAction SilentlyContinue
  if ($null -eq $variable) {
    return $null
  }
  return $variable.Value
}

function Test-SmileFtpUseTestDoubleStor {
  $td = Get-SmileFtpTestDouble
  if ($null -eq $td) { return $false }
  try {
    if ($td -is [System.Collections.IDictionary]) {
      if (-not $td.Contains('StorBytesSecure') -and -not $td.ContainsKey('StorBytesSecure')) { return $false }
      $fn = $td['StorBytesSecure']
      return ($null -ne $fn)
    }
    $fn = Get-SmileFtpObjectProperty -Object $td -Name 'StorBytesSecure' -DefaultValue $null
    return ($null -ne $fn)
  } catch {
    return $false
  }
}

function Get-SmileFtpStorBackendMode {
  if (Test-SmileFtpUseTestDoubleStor) { return 'mock' }
  return 'real'
}

function Get-SmileFtpImageTempName {
  param([Parameter(Mandatory = $true)][string]$FormalFileName)
  $fn = [IO.Path]::GetFileName($FormalFileName)
  if ($fn -notmatch '^\d{6}-\d+b?\.jpg$') {
    throw [InvalidOperationException]("invalid formal image name for temp upload: $fn")
  }
  return ($fn + '.smile-uploading')
}

function Test-SmileFtpImageTempName {
  param([string]$FileName)
  return [bool]($FileName -match '^\d{6}-\d+b?\.jpg\.smile-uploading$')
}

function Test-SmileFtpRetryableTransferCode {
  param([int]$Code, [string]$Text = '')
  if (@(425, 426, 450) -contains $Code) { return $true }
  if ($Text -match '(?i)timeout|timed out|connection (reset|lost|closed)|link to file server lost|broken pipe') {
    return $true
  }
  return $false
}

function Test-SmileFtpStorCompletionSuccess {
  param([int]$Code)
  # 226 Transfer complete is ideal; some servers reply 250 after STOR.
  return ($Code -eq 226 -or ($Code -ge 200 -and $Code -lt 300 -and $Code -ne 227))
}

function Get-SmileFtpImageUploadRetryWaitsSec {
  return @(2, 5, 10)
}

function Get-SmileFtpObjectProperty {
  param(
    $Object,
    [Parameter(Mandatory = $true)][string]$Name,
    $DefaultValue = $null
  )
  if ($null -eq $Object) { return $DefaultValue }
  try {
    if ($Object -is [System.Collections.IDictionary]) {
      if ($Object.Contains($Name)) { return $Object[$Name] }
      if ($Object.ContainsKey($Name)) { return $Object[$Name] }
      return $DefaultValue
    }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $DefaultValue }
    return $prop.Value
  } catch {
    return $DefaultValue
  }
}

function ConvertTo-SmileFtpArray {
  # StrictMode: @($List[object]) throws ArgumentException — enumerate instead.
  param($Value)
  if ($null -eq $Value) { return @() }
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($item in $Value) { [void]$out.Add($item) }
  return ,$out.ToArray()
}

function Test-SmileFtpCollectionHasItem {
  param($Collection, $Item)
  if ($null -eq $Collection) { return $false }
  foreach ($x in $Collection) {
    if ($x -eq $Item) { return $true }
  }
  return $false
}

function Add-SmileFtpAllowListItem {
  param($List, [string]$Item)
  if ($null -eq $List) { return }
  if (-not (Test-SmileFtpCollectionHasItem -Collection $List -Item $Item)) {
    [void]$List.Add($Item)
  }
}

function Set-SmileFtpObjectProperty {
  param(
    $Object,
    [Parameter(Mandatory = $true)][string]$Name,
    $Value
  )
  if ($null -eq $Object) { return }
  try {
    if ($Object -is [System.Collections.IDictionary]) {
      $Object[$Name] = $Value
      return
    }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -ne $prop) {
      $prop.Value = $Value
    } else {
      Add-Member -InputObject $Object -MemberType NoteProperty -Name $Name -Value $Value -Force
    }
  } catch {}
}

function New-SmileFtpSafeImageUploadResult {
  param(
    [bool]$Success = $false,
    [string]$Status = '',
    [int]$Attempts = 0,
    [string]$TempRemotePath = '',
    [string]$FinalRemotePath = '',
    [long]$ExpectedSize = 0,
    $RemoteSize = $null,
    [string]$ExpectedSha256 = '',
    [string]$RemoteSha256 = '',
    $LastStorFailure = $null,
    $FtpCommands = $null,
    $CreatedArtifacts = $null,
    $CleanupResults = $null,
    $ErrorCode = $null,
    $Detail = $null,
    [bool]$ManualReviewRequired = $false,
    $AttemptLogs = $null,
    $Residue = $null,
    # Compatibility aliases used by older callers / tests
    [bool]$Ok = $false,
    [string]$FormalFileName = '',
    [string]$TempFileName = '',
    [int]$AttemptCount = 0,
    [string]$StorTarget = '',
    [string]$RenamedTo = '',
    $Session = $null
  )
  $attemptsVal = if ($AttemptCount -gt 0) { $AttemptCount } else { $Attempts }
  $successVal = if ($Success -or $Ok) { $true } else { $false }
  $statusVal = if ($Status) { $Status } elseif ($successVal) { 'ok' } else { 'failed' }
  return [pscustomobject]@{
    success = $successVal
    status = $statusVal
    attempts = [int]$attemptsVal
    tempRemotePath = [string]$TempRemotePath
    finalRemotePath = [string]$FinalRemotePath
    expectedSize = [long]$ExpectedSize
    remoteSize = $RemoteSize
    expectedSha256 = [string]$ExpectedSha256
    remoteSha256 = [string]$RemoteSha256
    lastStorFailure = $LastStorFailure
    ftpCommands = (ConvertTo-SmileFtpArray $FtpCommands)
    createdArtifacts = (ConvertTo-SmileFtpArray $CreatedArtifacts)
    cleanupResults = (ConvertTo-SmileFtpArray $CleanupResults)
    errorCode = $ErrorCode
    detail = $Detail
    manualReviewRequired = [bool]$ManualReviewRequired
    attemptLogs = (ConvertTo-SmileFtpArray $AttemptLogs)
    residue = $Residue
    session = $Session
    # Compatibility
    ok = $successVal
    formalFileName = [string]$FormalFileName
    tempFileName = [string]$TempFileName
    attemptCount = [int]$attemptsVal
    storTarget = [string]$StorTarget
    renamedTo = [string]$RenamedTo
  }
}

function Normalize-SmileFtpSafeImageUploadResult {
  param($Value)
  if ($null -eq $Value) {
    return New-SmileFtpSafeImageUploadResult -Success $false -Status 'null-result' `
      -ErrorCode 'SAFE_IMAGE_NULL_RESULT' -Detail 'upload result was null'
  }
  $propNames = @()
  try {
    if ($Value -is [System.Collections.IDictionary]) {
      $propNames = @($Value.Keys | ForEach-Object { [string]$_ })
    } else {
      $propNames = @($Value.PSObject.Properties | ForEach-Object { $_.Name })
    }
  } catch {
    $propNames = @()
  }
  if ($propNames.Count -eq 0) {
    return New-SmileFtpSafeImageUploadResult -Success $false -Status 'empty-result' `
      -ErrorCode 'SAFE_IMAGE_EMPTY_RESULT' -Detail 'upload result had no properties'
  }
  $success = $false
  $okProp = Get-SmileFtpObjectProperty -Object $Value -Name 'success' -DefaultValue $null
  if ($null -ne $okProp) { $success = [bool]$okProp }
  else {
    $okProp2 = Get-SmileFtpObjectProperty -Object $Value -Name 'ok' -DefaultValue $false
    $success = [bool]$okProp2
  }
  return New-SmileFtpSafeImageUploadResult `
    -Success $success `
    -Status ([string](Get-SmileFtpObjectProperty -Object $Value -Name 'status' -DefaultValue $(if ($success) { 'ok' } else { 'failed' }))) `
    -Attempts ([int](Get-SmileFtpObjectProperty -Object $Value -Name 'attempts' -DefaultValue (Get-SmileFtpObjectProperty -Object $Value -Name 'attemptCount' -DefaultValue 0))) `
    -TempRemotePath ([string](Get-SmileFtpObjectProperty -Object $Value -Name 'tempRemotePath' -DefaultValue '')) `
    -FinalRemotePath ([string](Get-SmileFtpObjectProperty -Object $Value -Name 'finalRemotePath' -DefaultValue '')) `
    -ExpectedSize ([long](Get-SmileFtpObjectProperty -Object $Value -Name 'expectedSize' -DefaultValue 0)) `
    -RemoteSize (Get-SmileFtpObjectProperty -Object $Value -Name 'remoteSize' -DefaultValue $null) `
    -ExpectedSha256 ([string](Get-SmileFtpObjectProperty -Object $Value -Name 'expectedSha256' -DefaultValue '')) `
    -RemoteSha256 ([string](Get-SmileFtpObjectProperty -Object $Value -Name 'remoteSha256' -DefaultValue '')) `
    -LastStorFailure (Get-SmileFtpObjectProperty -Object $Value -Name 'lastStorFailure' -DefaultValue $null) `
    -FtpCommands (Get-SmileFtpObjectProperty -Object $Value -Name 'ftpCommands' -DefaultValue @()) `
    -CreatedArtifacts (Get-SmileFtpObjectProperty -Object $Value -Name 'createdArtifacts' -DefaultValue @()) `
    -CleanupResults (Get-SmileFtpObjectProperty -Object $Value -Name 'cleanupResults' -DefaultValue @()) `
    -ErrorCode (Get-SmileFtpObjectProperty -Object $Value -Name 'errorCode' -DefaultValue $null) `
    -Detail (Get-SmileFtpObjectProperty -Object $Value -Name 'detail' -DefaultValue $null) `
    -FormalFileName ([string](Get-SmileFtpObjectProperty -Object $Value -Name 'formalFileName' -DefaultValue '')) `
    -TempFileName ([string](Get-SmileFtpObjectProperty -Object $Value -Name 'tempFileName' -DefaultValue '')) `
    -StorTarget ([string](Get-SmileFtpObjectProperty -Object $Value -Name 'storTarget' -DefaultValue '')) `
    -RenamedTo ([string](Get-SmileFtpObjectProperty -Object $Value -Name 'renamedTo' -DefaultValue '')) `
    -Session (Get-SmileFtpObjectProperty -Object $Value -Name 'session' -DefaultValue $null) `
    -ManualReviewRequired ([bool](Get-SmileFtpObjectProperty -Object $Value -Name 'manualReviewRequired' -DefaultValue $false)) `
    -Residue (Get-SmileFtpObjectProperty -Object $Value -Name 'residue' -DefaultValue $null)
}

function New-SmileFtpUploadTransactionList {
  return New-Object System.Collections.Generic.List[object]
}

function Add-SmileFtpUploadTransaction {
  param(
    $List,
    [string]$FileName,
    [string]$RemotePath,
    [string]$Kind,
    [bool]$ExistedBefore = $false,
    [long]$ExpectedSize = 0,
    [string]$ExpectedSha = '',
    [bool]$Formalized = $false
  )
  [void]$List.Add([pscustomobject]@{
    fileName = $FileName
    remotePath = $RemotePath
    kind = $Kind
    existedBefore = $ExistedBefore
    expectedSize = $ExpectedSize
    expectedSha = $ExpectedSha
    formalized = $Formalized
    registeredAt = (Get-Date).ToString('o')
  })
}

function Get-SmileFtpRollbackDeleteCandidates {
  param($TransactionList)
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($t in @($TransactionList)) {
    if ($t.existedBefore) { continue }
    $fn = [string]$t.fileName
    $allowed =
      (Test-SmileFtpImageTempName $fn) -or
      ($fn -match '^\d{6}-\d+b?\.jpg$') -or
      ($fn -eq 'index.htm.smile-publishing') -or
      ($fn -eq 'index.htm.smile-prepub-bak')
    if (-not $allowed) { continue }
    # Only delete temps, or formal images we created this run (formalized or kind image)
    if ((Test-SmileFtpImageTempName $fn) -or
        $t.kind -eq 'image-temp' -or
        $t.kind -eq 'temp-index' -or
        $t.kind -eq 'prepub-bak' -or
        ($t.kind -eq 'image' -and -not $t.existedBefore) -or
        ($t.formalized -and ($fn -match '^\d{6}-\d+b?\.jpg$'))) {
      if (-not ($out | Where-Object { $_.fileName -eq $fn })) {
        [void]$out.Add($t)
      }
    }
  }
  return @($out)
}

function Get-SmileFtpStorChunkSize {
  $v = Get-Variable -Name SmileFtpStorChunkSize -Scope Script -ErrorAction SilentlyContinue
  if ($null -ne $v -and [int]$v.Value -gt 0) { return [int]$v.Value }
  return 16384
}

function Write-SmileFtpDataChunks {
  param(
    $Stream,
    [byte[]]$Bytes,
    [int]$ChunkSize = 0
  )
  if ($ChunkSize -le 0) { $ChunkSize = Get-SmileFtpStorChunkSize }
  $total = 0
  if ($null -ne $Bytes) { $total = $Bytes.Length }
  $sent = 0
  while ($sent -lt $total) {
    $n = [Math]::Min($ChunkSize, $total - $sent)
    $Stream.Write($Bytes, $sent, $n)
    $sent += $n
  }
  if ($total -gt 0) { $Stream.Flush() }
  if ($sent -ne $total) {
    throw [Exception]("chunk write bytesSent mismatch: sent=$sent expected=$total / exceptionType=STOR_BYTES_SENT_MISMATCH")
  }
  return $sent
}

function Close-SmileFtpSessionQuiet {
  param($session, [System.Collections.Generic.List[object]]$QuitLog = $null)
  if ($null -eq $session) { return }
  $quitOk = $false
  $quitErr = $null
  try {
    if (Get-Command Close-SmileFtpSession -ErrorAction SilentlyContinue) {
      Close-SmileFtpSession $session
      $quitOk = $true
    } else {
      Set-SmileFtpObjectProperty -Object $session -Name 'closed' -Value $true
    }
  } catch {
    $quitErr = $_.Exception.Message
  }
  if ($null -ne $QuitLog) {
    [void]$QuitLog.Add([pscustomobject]@{
        at = (Get-Date).ToString('o')
        quitOk = $quitOk
        error = $quitErr
        sessionId = [string](Get-SmileFtpObjectProperty -Object $session -Name 'sessionId' -DefaultValue '')
      })
  }
}

function New-SmileFtpSessionId {
  return ('sess-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
}

function Connect-SmileFtpSessionForImageDir {
  param(
    $FtpConfig,
    $PriorSession = $null,
    [string]$RemoteImageDir = 'image'
  )
  # Optional mock reconnect factory (local tests only)
  $factory = Get-Variable -Name SmileFtpReconnectFactory -Scope Script -ErrorAction SilentlyContinue
  if ($null -ne $factory -and $null -ne $factory.Value) {
    $ns = & $factory.Value $PriorSession $FtpConfig
    if ($ns) {
      if (-not (Get-SmileFtpObjectProperty -Object $ns -Name 'sessionId')) {
        Set-SmileFtpObjectProperty -Object $ns -Name 'sessionId' -Value (New-SmileFtpSessionId)
      }
      return $ns
    }
  }
  if (-not $FtpConfig) { throw [Exception]'FtpConfig required for reconnect / exceptionType=RECONNECT_NO_CONFIG' }
  $conn = Connect-SmileFtpAuthenticatedSession `
    -HostName ([string]$FtpConfig.host) `
    -Port ([int]($(if ($FtpConfig.port) { $FtpConfig.port } else { 21 }))) `
    -Username ([string]$FtpConfig.username) `
    -Password ([string]$FtpConfig.password) `
    -RemoteRoot ([string]($(if ($FtpConfig.remoteRoot) { $FtpConfig.remoteRoot } else { '/' }))) `
    -UseTls ([bool]($(if ($null -ne $FtpConfig.useTls) { $FtpConfig.useTls } else { $true }))) `
    -TimeoutMs ([int]($(if ($FtpConfig.timeoutMs) { $FtpConfig.timeoutMs } else { 30000 })))
  $session = $conn.session
  Set-SmileFtpObjectProperty -Object $session -Name 'sessionId' -Value (New-SmileFtpSessionId)
  $session.allowStor = $true
  $session.allowDele = $true
  $session.allowRename = $true
  if ($null -eq (Get-SmileFtpObjectProperty -Object $session -Name 'storAllowList' -DefaultValue $null)) { $session.storAllowList = New-Object System.Collections.Generic.List[string] }
  if ($null -eq (Get-SmileFtpObjectProperty -Object $session -Name 'deleAllowList' -DefaultValue $null)) { $session.deleAllowList = New-Object System.Collections.Generic.List[string] }
  if ($null -eq (Get-SmileFtpObjectProperty -Object $session -Name 'renameAllowList' -DefaultValue $null)) { $session.renameAllowList = New-Object System.Collections.Generic.List[string] }
  if ($null -ne $PriorSession) {
    foreach ($n in @('storAllowList', 'deleAllowList', 'renameAllowList')) {
      $prev = Get-SmileFtpObjectProperty -Object $PriorSession -Name $n -DefaultValue $null
      if ($null -ne $prev) {
        foreach ($x in $prev) {
          $list = Get-SmileFtpObjectProperty -Object $session -Name $n
          Add-SmileFtpAllowListItem -List $list -Item ([string]$x)
        }
      }
    }
  }
  $null = Send-SmileFtpCommand $session 'TYPE A'
  $cwdDiary = Send-SmileFtpCommand $session 'CWD diary'
  if ($cwdDiary.code -ge 400) { throw [Exception]'reconnect CWD diary failed / exceptionType=RECONNECT_CWD_DIARY' }
  $cwdImg = Send-SmileFtpCommand $session ("CWD " + $RemoteImageDir)
  if ($cwdImg.code -ge 400) { throw [Exception]'reconnect CWD image failed / exceptionType=RECONNECT_CWD_IMAGE' }
  $null = Send-SmileFtpCommand $session 'TYPE I'
  Set-SmileFtpObjectProperty -Object $session -Name 'lastStorFailure' -Value $null
  return $session
}

function Test-SmileFtpTempAllowsDeleteByFingerprint {
  param(
    [long]$RemoteSize,
    [string]$RemoteSha = '',
    [long]$ExpectedFullSize,
    [string]$ExpectedFullSha = ''
  )
  # Complete temp matching expected full image: do not DELE (may be mid-rename).
  if ($ExpectedFullSize -gt 0 -and $RemoteSize -eq $ExpectedFullSize) {
    if ($ExpectedFullSha -and $RemoteSha -and ($RemoteSha.ToLowerInvariant() -eq $ExpectedFullSha.ToLowerInvariant())) {
      return [pscustomobject]@{ allow = $false; reason = 'fingerprint-complete-match-refuse-dele' }
    }
  }
  # Incomplete or sha mismatch => our leftover / abort residue — allow DELE
  return [pscustomobject]@{ allow = $true; reason = 'fingerprint-incomplete-or-mismatch' }
}

function Invoke-SmileFtpCloseDataChannelOrdered {
  param($data)
  # Close data stream/TLS first, then TCP — then caller reads control 226.
  try {
    if ($null -ne $data -and $null -ne $data.stream) {
      try { $data.stream.Flush() } catch {}
      try { $data.stream.Dispose() } catch {}
    }
  } catch {}
  try {
    if ($null -ne $data -and $null -ne $data.client) { $data.client.Close() }
  } catch {}
}

function Invoke-SmileFtpStorBytesSecure {
  param(
    $session,
    [string]$RemoteFileName,
    [byte[]]$Bytes,
    [int]$DataTransferTimeoutMs = 120000,
    [int]$ControlReplyTimeoutMs = 60000
  )
  # Mock only when a usable test double is explicitly set; undefined/null/empty => real FTP.
  if (Test-SmileFtpUseTestDoubleStor) {
    $td = Get-SmileFtpTestDouble
    return & $td.StorBytesSecure $session $RemoteFileName $Bytes
  }
  if (-not $session.allowStor) {
    throw [InvalidOperationException]'STOR not enabled on session'
  }
  $startedAt = Get-Date
  $expectedSize = 0
  if ($null -ne $Bytes) { $expectedSize = $Bytes.Length }
  $bytesSent = 0

  # Fresh PASV each STOR — never reuse prior data connection.
  $null = Send-SmileFtpCommand $session 'TYPE I'
  $prevRecv = $session.client.ReceiveTimeout
  $prevSend = $session.client.SendTimeout
  try {
    $session.client.ReceiveTimeout = [Math]::Max($DataTransferTimeoutMs, $ControlReplyTimeoutMs)
    $session.client.SendTimeout = $DataTransferTimeoutMs
    $data = Open-SmileFtpPassiveData $session
    try {
      $data.client.ReceiveTimeout = $DataTransferTimeoutMs
      $data.client.SendTimeout = $DataTransferTimeoutMs
    } catch {}
    $pasvHost = $(if ($data.pasvHost) { [string]$data.pasvHost } else { '' })
    $pasvPort = $(if ($null -ne $data.pasvPort) { [int]$data.pasvPort } else { 0 })
    $tlsUsed = [bool]$session.ssl

    $stor = Send-SmileFtpCommand $session ("STOR " + $RemoteFileName)
    if ($stor.code -ne 150 -and $stor.code -ne 125) {
      Invoke-SmileFtpCloseDataChannelOrdered $data
      $code = [int]$stor.code
      $ex = [Exception]("STOR rejected: $RemoteFileName / code=$code / text=$($stor.text) / expectedSize=$expectedSize / pasv=$pasvHost`:$pasvPort / tls=$tlsUsed / exceptionType=STOR_REJECTED")
      $ex.Data['ftpCode'] = $code
      $ex.Data['retryable'] = (Test-SmileFtpRetryableTransferCode -Code $code -Text ([string]$stor.text))
      $ex.Data['bytesSent'] = 0
      throw $ex
    }
    $null = Protect-SmileFtpDataChannel $data
    try {
      if ($null -ne $Bytes -and $Bytes.Length -gt 0) {
        $bytesSent = Write-SmileFtpDataChunks -Stream $data.stream -Bytes $Bytes
      }
    } catch {
      Invoke-SmileFtpCloseDataChannelOrdered $data
      $ex = [Exception]("STOR data write failed: $RemoteFileName / bytesSent=$bytesSent / expected=$expectedSize / $($_.Exception.Message) / exceptionType=STOR_DATA_WRITE_FAILED")
      $ex.Data['ftpCode'] = 0
      $ex.Data['retryable'] = $true
      $ex.Data['bytesSent'] = $bytesSent
      throw $ex
    }

    Invoke-SmileFtpCloseDataChannelOrdered $data

    $session.client.ReceiveTimeout = $ControlReplyTimeoutMs
    $done = $null
    try {
      $done = Read-SmileFtpReply $session
    } catch {
      $ex = [Exception]("STOR control reply wait failed: $RemoteFileName / $($_.Exception.Message) / exceptionType=STOR_CONTROL_TIMEOUT")
      $ex.Data['ftpCode'] = 0
      $ex.Data['retryable'] = $true
      $ex.Data['bytesSent'] = $bytesSent
      throw $ex
    }

    $code = [int]$done.code
    if (-not (Test-SmileFtpStorCompletionSuccess -Code $code)) {
      $remoteSize = $null
      try {
        $sz = Invoke-SmileFtpSize -session $session -RemoteFileName $RemoteFileName
        if ($null -ne $sz -and [bool]$sz.ok) { $remoteSize = $sz.size }
      } catch {}
      $elapsed = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 3)
      $safeText = ([string]$done.text)
      if ($safeText.Length -gt 240) { $safeText = $safeText.Substring(0, 240) + '...' }
      $diag = [ordered]@{
        remotePath = $RemoteFileName
        code = $code
        text = $safeText
        expectedBytes = $expectedSize
        bytesSent = $bytesSent
        remoteSize = $remoteSize
        elapsedSec = $elapsed
        pasvHost = $pasvHost
        pasvPort = $pasvPort
        tls = $tlsUsed
        exceptionType = 'STOR_COMPLETION_FAILED'
        retryable = (Test-SmileFtpRetryableTransferCode -Code $code -Text $safeText)
      }
      Set-SmileFtpObjectProperty -Object $session -Name 'lastStorFailure' -Value ([pscustomobject]$diag)
      $ex = [Exception]("STOR completion failed: $RemoteFileName / code=$code / text=$safeText / remoteSize=$remoteSize / expectedSize=$expectedSize / bytesSent=$bytesSent / elapsedSec=$elapsed / pasv=$pasvHost`:$pasvPort / tls=$tlsUsed / exceptionType=STOR_COMPLETION_FAILED")
      $ex.Data['ftpCode'] = $code
      $ex.Data['retryable'] = [bool]$diag.retryable
      $ex.Data['remoteSize'] = $remoteSize
      $ex.Data['bytesSent'] = $bytesSent
      throw $ex
    }
    return [pscustomobject]@{
      ok = $true
      code = $code
      expectedSize = $expectedSize
      bytesSent = $bytesSent
      pasvHost = $pasvHost
      pasvPort = $pasvPort
    }
  } finally {
    try { $session.client.ReceiveTimeout = $prevRecv } catch {}
    try { $session.client.SendTimeout = $prevSend } catch {}
  }
}

# Keep legacy Invoke-SmileFtpStorBytes in ftp-readonly-probe.ps1.
# Callers of secure STOR use Invoke-SmileFtpStorBytesSecure directly.

function Remove-SmileFtpIncompleteTempImage {
  param(
    $session,
    [string]$TempFileName,
    [long]$ExpectedFullSize,
    [string]$ExpectedFullSha = '',
    [switch]$RequireFingerprintAllow
  )
  if (-not (Test-SmileFtpImageTempName $TempFileName)) {
    throw [InvalidOperationException]"refusing to delete non-temp image name: $TempFileName"
  }
  $sz = Invoke-SmileFtpSize -session $session -RemoteFileName $TempFileName
  if ($null -eq $sz -or -not [bool]$sz.ok) {
    return [pscustomobject]@{ deleted = $false; reason = 'absent'; remoteSize = $null; remoteSha = '' }
  }
  $size = [long]$sz.size
  $remoteSha = ''
  try {
    $bytes = Invoke-SmileFtpRetrBytes -session $session -RemoteFileName $TempFileName
    $remoteSha = Get-SmileFtpSha256Hex $bytes
  } catch {}
  $fp = Test-SmileFtpTempAllowsDeleteByFingerprint -RemoteSize $size -RemoteSha $remoteSha `
    -ExpectedFullSize $ExpectedFullSize -ExpectedFullSha $ExpectedFullSha
  if (-not $fp.allow) {
    return [pscustomobject]@{
      deleted = $false
      reason = [string]$fp.reason
      remoteSize = $size
      remoteSha = $remoteSha
      refused = $true
    }
  }
  if (-not $session.allowDele) { $session.allowDele = $true }
  if ($null -eq (Get-SmileFtpObjectProperty -Object $session -Name 'deleAllowList' -DefaultValue $null)) {
    $session.deleAllowList = New-Object System.Collections.Generic.List[string]
  }
  Add-SmileFtpAllowListItem -List $session.deleAllowList -Item $TempFileName
  $null = Invoke-SmileFtpDeleFile -session $session -RemoteFileName $TempFileName
  return [pscustomobject]@{
    deleted = $true
    reason = [string]$fp.reason
    remoteSize = $size
    remoteSha = $remoteSha
  }
}

function Invoke-SmileFtpCleanupTempWithReconnect {
  param(
    $FtpConfig,
    [string]$TempFileName,
    [long]$ExpectedFullSize,
    [string]$ExpectedFullSha,
    $PriorSession = $null
  )
  $quitLog = New-Object System.Collections.Generic.List[object]
  $cleanupSession = $null
  $factoryVar = Get-Variable -Name SmileFtpReconnectFactory -Scope Script -ErrorAction SilentlyContinue
  $hasFactory = ($null -ne $factoryVar -and $null -ne $factoryVar.Value)
  $canReconnect = ($null -ne $FtpConfig) -or $hasFactory

  # Local mocks without reconnect: cleanup on the provided session (do not close it).
  if (-not $canReconnect) {
    try {
      if ($null -eq $PriorSession) {
        return [pscustomobject]@{
          ok = $false; deleted = $false; reason = 'cleanup-no-session'
          manualReviewRequired = $true; quitLog = @(); residuePath = '/diary/image/' + $TempFileName
        }
      }
      Add-SmileFtpAllowListItem -List (Get-SmileFtpObjectProperty -Object $PriorSession -Name 'deleAllowList' -DefaultValue $null) -Item $TempFileName
      $del = Remove-SmileFtpIncompleteTempImage -session $PriorSession -TempFileName $TempFileName `
        -ExpectedFullSize $ExpectedFullSize -ExpectedFullSha $ExpectedFullSha
      $refused = [bool](Get-SmileFtpObjectProperty -Object $del -Name 'refused' -DefaultValue $false)
      return [pscustomobject]@{
        ok = [bool]$del.deleted -or ($del.reason -eq 'absent')
        deleted = [bool]$del.deleted
        reason = [string]$del.reason
        refused = $refused
        remoteSize = $del.remoteSize
        remoteSha = $del.remoteSha
        manualReviewRequired = (-not $del.deleted -and $del.reason -ne 'absent' -and -not $refused)
        quitLog = @()
        sessionId = [string](Get-SmileFtpObjectProperty -Object $PriorSession -Name 'sessionId' -DefaultValue '')
      }
    } catch {
      return [pscustomobject]@{
        ok = $false; deleted = $false; reason = 'cleanup-inplace-failed'
        error = $_.Exception.Message; manualReviewRequired = $true; quitLog = @()
        residuePath = '/diary/image/' + $TempFileName
      }
    }
  }

  try {
    Close-SmileFtpSessionQuiet -session $PriorSession -QuitLog $quitLog
    $cleanupSession = Connect-SmileFtpSessionForImageDir -FtpConfig $FtpConfig -PriorSession $PriorSession
    Add-SmileFtpAllowListItem -List (Get-SmileFtpObjectProperty -Object $cleanupSession -Name 'deleAllowList' -DefaultValue $null) -Item $TempFileName
    $del = Remove-SmileFtpIncompleteTempImage -session $cleanupSession -TempFileName $TempFileName `
      -ExpectedFullSize $ExpectedFullSize -ExpectedFullSha $ExpectedFullSha
    Close-SmileFtpSessionQuiet -session $cleanupSession -QuitLog $quitLog
    $refused = [bool](Get-SmileFtpObjectProperty -Object $del -Name 'refused' -DefaultValue $false)
    return [pscustomobject]@{
      ok = [bool]$del.deleted -or ($del.reason -eq 'absent')
      deleted = [bool]$del.deleted
      reason = [string]$del.reason
      refused = $refused
      remoteSize = $del.remoteSize
      remoteSha = $del.remoteSha
      manualReviewRequired = (-not $del.deleted -and $del.reason -ne 'absent' -and -not $refused)
      quitLog = (ConvertTo-SmileFtpArray $quitLog)
      sessionId = [string](Get-SmileFtpObjectProperty -Object $cleanupSession -Name 'sessionId' -DefaultValue '')
    }
  } catch {
    try { Close-SmileFtpSessionQuiet -session $cleanupSession -QuitLog $quitLog } catch {}
    return [pscustomobject]@{
      ok = $false
      deleted = $false
      reason = 'cleanup-reconnect-failed'
      error = $_.Exception.Message
      manualReviewRequired = $true
      quitLog = (ConvertTo-SmileFtpArray $quitLog)
      residuePath = '/diary/image/' + $TempFileName
    }
  }
}

function Invoke-SmileFtpUploadImageViaTemp {
  param(
    $session,
    [Parameter(Mandatory = $true)][string]$FormalFileName,
    [Parameter(Mandatory = $true)][byte[]]$Bytes,
    [Parameter(Mandatory = $true)][string]$ExpectedSha,
    [int]$MaxAttempts = 3,
    [int[]]$RetryWaitsSec = $null,
    $TransactionList = $null,
    [string]$FailInject = '',
    [int]$FailInjectOnAttempt = 0,
    $FtpConfig = $null
  )
  if ($FormalFileName -notmatch '^\d{6}-\d+b?\.jpg$') {
    throw [InvalidOperationException]"allowlist reject formal image: $FormalFileName"
  }
  $tempName = Get-SmileFtpImageTempName -FormalFileName $FormalFileName
  if (-not $RetryWaitsSec) { $RetryWaitsSec = Get-SmileFtpImageUploadRetryWaitsSec }
  $expectedSize = $Bytes.Length
  $expectedSha = $ExpectedSha.ToLowerInvariant()
  $attempts = New-Object System.Collections.Generic.List[object]
  $attemptLogs = New-Object System.Collections.Generic.List[object]
  $quitLogs = New-Object System.Collections.Generic.List[object]
  $remotePathFormal = '/diary/image/' + $FormalFileName
  $remotePathTemp = '/diary/image/' + $tempName
  $manualReview = $false
  $residue = $null
  $lastError = $null
  $current = $session
  if (-not (Get-Variable -Name SmileFtpFailStorCodesQueue -Scope Script -ErrorAction SilentlyContinue)) {
    $script:SmileFtpFailStorCodesQueue = $null
  }
  if (-not (Get-Variable -Name SmileFtpSkipRetrySleep -Scope Script -ErrorAction SilentlyContinue)) {
    $script:SmileFtpSkipRetrySleep = $false
  }

  # Seed allowlists on whatever session we start with
  if ($null -ne $current) {
    Add-SmileFtpAllowListItem -List (Get-SmileFtpObjectProperty -Object $current -Name 'storAllowList' -DefaultValue $null) -Item $tempName
    $renameList = Get-SmileFtpObjectProperty -Object $current -Name 'renameAllowList' -DefaultValue $null
    if ($null -ne $renameList) {
      Add-SmileFtpAllowListItem -List $renameList -Item $tempName
      Add-SmileFtpAllowListItem -List $renameList -Item $FormalFileName
    }
    $current.allowRename = $true
  }
  if ($null -ne $TransactionList) {
    Add-SmileFtpUploadTransaction -List $TransactionList -FileName $tempName -RemotePath $remotePathTemp `
      -Kind 'image-temp' -ExistedBefore $false -ExpectedSize $expectedSize -ExpectedSha $expectedSha
  }

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $startedAt = Get-Date
    $log = [ordered]@{
      attempt = $attempt
      sessionId = ''
      pasvHost = ''
      pasvPort = 0
      bytesSent = 0
      expectedBytes = $expectedSize
      storCode = $null
      remoteSize = $null
      exceptionType = $null
      exceptionMessage = $null
      cleanup = $null
      reconnect = $null
      startedAt = $startedAt.ToString('o')
      endedAt = $null
      reusedWriter = $false
    }
    try {
      # Prefer brand-new control session when reconnect is available (FtpConfig and/or mock factory).
      # Local mocks without FtpConfig/factory keep the provided session (PS 5.1-safe; no [ref] SessionRef).
      $factoryVar = Get-Variable -Name SmileFtpReconnectFactory -Scope Script -ErrorAction SilentlyContinue
      $hasFactory = ($null -ne $factoryVar -and $null -ne $factoryVar.Value)
      $canReconnect = ($null -ne $FtpConfig) -or $hasFactory
      $priorWriter = Get-SmileFtpObjectProperty -Object $current -Name 'writer' -DefaultValue $null
      if ($canReconnect) {
        Close-SmileFtpSessionQuiet -session $current -QuitLog $quitLogs
        if ($FailInject -eq 'reconnectAuthFail' -and ($FailInjectOnAttempt -eq 0 -or $FailInjectOnAttempt -eq $attempt)) {
          throw [Exception]'AUTH TLS failed / exceptionType=RECONNECT_AUTH_TLS'
        }
        if ($FailInject -eq 'reconnectLoginFail' -and ($FailInjectOnAttempt -eq 0 -or $FailInjectOnAttempt -eq $attempt)) {
          throw [Exception]'530 authentication failed / exceptionType=RECONNECT_LOGIN'
        }
        if ($FailInject -eq 'cleanupReconnectFail' -and ($FailInjectOnAttempt -eq 0 -or $FailInjectOnAttempt -eq $attempt)) {
          # fall through after stor fail path
        }
        try {
          $current = Connect-SmileFtpSessionForImageDir -FtpConfig $FtpConfig -PriorSession $current
          $log.reconnect = 'ok'
        } catch {
          $log.reconnect = 'failed'
          $log.exceptionType = 'RECONNECT_FAILED'
          $log.exceptionMessage = $_.Exception.Message
          throw
        }
        $sid = [string](Get-SmileFtpObjectProperty -Object $current -Name 'sessionId' -DefaultValue '')
        $log.sessionId = $sid
        $newWriter = Get-SmileFtpObjectProperty -Object $current -Name 'writer' -DefaultValue $null
        if (($null -ne $priorWriter) -and ($null -ne $newWriter) -and [object]::ReferenceEquals($priorWriter, $newWriter)) {
          $log.reusedWriter = $true
          throw [Exception]'reused broken writer detected / exceptionType=WRITER_REUSED'
        }
      } else {
        if ($null -eq $current) {
          throw [Exception]'FtpConfig required for reconnect / exceptionType=RECONNECT_NO_CONFIG'
        }
        $sid = [string](Get-SmileFtpObjectProperty -Object $current -Name 'sessionId' -DefaultValue '')
        $log.reconnect = 'skipped-no-config'
        $log.sessionId = $sid
      }

      # Collision check on formal each attempt
      $szFormal = Invoke-SmileFtpSize -session $current -RemoteFileName $FormalFileName
      if ($null -ne $szFormal -and [bool]$szFormal.ok) {
        throw [Exception]("collision before stor: $FormalFileName")
      }

      # Ensure allowlists
      Add-SmileFtpAllowListItem -List (Get-SmileFtpObjectProperty -Object $current -Name 'storAllowList' -DefaultValue $null) -Item $tempName
      Add-SmileFtpAllowListItem -List (Get-SmileFtpObjectProperty -Object $current -Name 'deleAllowList' -DefaultValue $null) -Item $tempName

      # Pre-STOR: delete incomplete leftover temp only
      try {
        $preDel = Remove-SmileFtpIncompleteTempImage -session $current -TempFileName $tempName `
          -ExpectedFullSize $expectedSize -ExpectedFullSha $expectedSha
        $log.cleanup = $preDel
      } catch {
        $log.cleanup = @{ deleted = $false; error = $_.Exception.Message }
      }

      if ($attempt -gt 1) {
        $waitIdx = [Math]::Min($attempt - 2, $RetryWaitsSec.Count - 1)
        $waitSec = [int]$RetryWaitsSec[$waitIdx]
        if ($waitSec -gt 0 -and -not $script:SmileFtpSkipRetrySleep) {
          Start-Sleep -Seconds $waitSec
        }
      }

      # Optional transfer fail queue for retry tests
      $failQueue = Get-Variable -Name SmileFtpFailStorCodesQueue -Scope Script -ErrorAction SilentlyContinue
      if ($null -ne $failQueue -and $null -ne $failQueue.Value) {
        $qList = New-Object System.Collections.ArrayList
        foreach ($qi in $failQueue.Value) { [void]$qList.Add($qi) }
        if ($qList.Count -gt 0) {
          $nextFail = $qList[0]
          $qList.RemoveAt(0)
          $script:SmileFtpFailStorCodesQueue = @($qList.ToArray())
          $nextCode = 0
          if ($null -ne $nextFail) {
            try { $nextCode = [int]$nextFail } catch { $nextCode = 0 }
          }
          if ($nextCode -gt 0) {
            $fc = $nextCode
            $ex = [Exception]("STOR completion failed: $tempName / code=$fc / text=$fc Transfer aborted. Link to file server lost / remoteSize=98010 / expectedSize=$expectedSize / exceptionType=STOR_COMPLETION_FAILED")
            $ex.Data['ftpCode'] = $fc
            $ex.Data['retryable'] = $true
            throw $ex
          }
        }
      }
      if ($FailInject -and $FailInjectOnAttempt -eq $attempt) {
        if ($FailInject -eq 'stor450' -or $FailInject -eq 'disconnect') {
          $ex = [Exception]"STOR data write failed: $tempName / bytesSent=32768 / expected=$expectedSize / connection forcibly closed / exceptionType=STOR_DATA_WRITE_FAILED"
          $ex.Data['ftpCode'] = 0
          $ex.Data['retryable'] = $true
          $ex.Data['bytesSent'] = 32768
          throw $ex
        }
        if ($FailInject -eq 'chunkCut') {
          $ex = [Exception]"STOR data write failed: $tempName / bytesSent=16384 / expected=$expectedSize / chunk cut / exceptionType=STOR_DATA_WRITE_FAILED"
          $ex.Data['retryable'] = $true
          $ex.Data['bytesSent'] = 16384
          throw $ex
        }
        if ($FailInject -eq 'bytesShort') {
          $ex = [Exception]"chunk write bytesSent mismatch: sent=100 expected=$expectedSize / exceptionType=STOR_BYTES_SENT_MISMATCH"
          $ex.Data['retryable'] = $true
          $ex.Data['bytesSent'] = 100
          throw $ex
        }
      }

      $storResult = Invoke-SmileFtpStorBytesSecure -session $current -RemoteFileName $tempName -Bytes $Bytes
      $log.bytesSent = [long](Get-SmileFtpObjectProperty -Object $storResult -Name 'bytesSent' -DefaultValue $expectedSize)
      $log.storCode = Get-SmileFtpObjectProperty -Object $storResult -Name 'code' -DefaultValue $null
      $log.pasvHost = [string](Get-SmileFtpObjectProperty -Object $storResult -Name 'pasvHost' -DefaultValue '')
      $log.pasvPort = [int](Get-SmileFtpObjectProperty -Object $storResult -Name 'pasvPort' -DefaultValue 0)

      if ($FailInject -eq 'sizeMismatch' -and ($FailInjectOnAttempt -eq 0 -or $FailInjectOnAttempt -eq $attempt)) {
        throw [Exception]("size mismatch after temp stor: $tempName")
      }
      $sz = Invoke-SmileFtpSize -session $current -RemoteFileName $tempName
      if ($null -eq $sz -or -not [bool]$sz.ok -or [long]$sz.size -ne $expectedSize) {
        throw [Exception]("size mismatch after temp stor: $tempName")
      }
      $log.remoteSize = [long]$sz.size

      if ($FailInject -eq 'shaMismatch' -and ($FailInjectOnAttempt -eq 0 -or $FailInjectOnAttempt -eq $attempt)) {
        throw [Exception]("sha mismatch after temp stor: $tempName")
      }
      $gotRaw = Invoke-SmileFtpRetrBytes -session $current -RemoteFileName $tempName
      if ($gotRaw -is [byte[]]) { $got = $gotRaw } else {
        $arr = @($gotRaw); $got = New-Object byte[] $arr.Count
        for ($bi = 0; $bi -lt $arr.Count; $bi++) { $got[$bi] = [byte]$arr[$bi] }
      }
      $gotSha = Get-SmileFtpSha256Hex -Bytes $got
      if ($gotSha -ne $expectedSha -or $got.Length -ne $expectedSize) {
        throw [Exception]("sha mismatch after temp stor: $tempName")
      }

      if ($FailInject -eq 'rntoFail' -and ($FailInjectOnAttempt -eq 0 -or $FailInjectOnAttempt -eq $attempt)) {
        throw [Exception]("RNTO failed: $FormalFileName")
      }
      $rnfr = Send-SmileFtpCommand $current ("RNFR " + $tempName)
      if ($rnfr.code -ge 400) { throw [Exception]("RNFR failed: $tempName / $($rnfr.text)") }
      $rnto = Send-SmileFtpCommand $current ("RNTO " + $FormalFileName)
      if ($rnto.code -ge 400) { throw [Exception]("RNTO failed: $FormalFileName / $($rnto.text)") }

      if ($FailInject -eq 'formalVerifyFail' -and ($FailInjectOnAttempt -eq 0 -or $FailInjectOnAttempt -eq $attempt)) {
        throw [Exception]("formal verify failed: $FormalFileName")
      }
      $szF = Invoke-SmileFtpSize -session $current -RemoteFileName $FormalFileName
      if ($null -eq $szF -or -not [bool]$szF.ok -or [long]$szF.size -ne $expectedSize) {
        throw [Exception]("formal size mismatch: $FormalFileName")
      }
      $gotFRaw = Invoke-SmileFtpRetrBytes -session $current -RemoteFileName $FormalFileName
      if ($gotFRaw -is [byte[]]) { $gotF = $gotFRaw } else {
        $arrF = @($gotFRaw); $gotF = New-Object byte[] $arrF.Count
        for ($bi = 0; $bi -lt $arrF.Count; $bi++) { $gotF[$bi] = [byte]$arrF[$bi] }
      }
      $shaF = Get-SmileFtpSha256Hex -Bytes $gotF
      if ($shaF -ne $expectedSha) { throw [Exception]("formal sha mismatch: $FormalFileName") }

      if ($null -ne $TransactionList) {
        Add-SmileFtpUploadTransaction -List $TransactionList -FileName $FormalFileName -RemotePath $remotePathFormal `
          -Kind 'image' -ExistedBefore $false -ExpectedSize $expectedSize -ExpectedSha $expectedSha -Formalized $true
      }

      $log.endedAt = (Get-Date).ToString('o')
      [void]$attemptLogs.Add([pscustomobject]$log)
      [void]$attempts.Add([pscustomobject]@{ attempt = $attempt; ok = $true; sessionId = $sid })

      $cmdSnap = New-Object System.Collections.Generic.List[string]
      try {
        foreach ($c in (Get-SmileFtpObjectProperty -Object $current -Name 'commands' -DefaultValue @())) {
          [void]$cmdSnap.Add([string]$c)
        }
      } catch {}
      return (New-SmileFtpSafeImageUploadResult `
          -Success $true -Status 'ok' -Attempts $attempt `
          -TempRemotePath $remotePathTemp -FinalRemotePath $remotePathFormal `
          -ExpectedSize $expectedSize -RemoteSize $expectedSize `
          -ExpectedSha256 $expectedSha -RemoteSha256 $shaF `
          -LastStorFailure $null -FtpCommands (ConvertTo-SmileFtpArray $cmdSnap) `
          -CreatedArtifacts @($FormalFileName) -CleanupResults (ConvertTo-SmileFtpArray $attemptLogs) `
          -ManualReviewRequired $false -AttemptLogs (ConvertTo-SmileFtpArray $attemptLogs) `
          -FormalFileName $FormalFileName -TempFileName $tempName `
          -StorTarget $tempName -RenamedTo $FormalFileName `
          -Session $current)
    } catch {
      $lastError = $_
      $log.exceptionMessage = $_.Exception.Message
      $log.exceptionType = 'UPLOAD_ATTEMPT_FAILED'
      if ($_.Exception.Message -match 'exceptionType=([A-Z0-9_]+)') { $log.exceptionType = $Matches[1] }
      try { if ($_.Exception.Data['bytesSent']) { $log.bytesSent = [long]$_.Exception.Data['bytesSent'] } } catch {}
      $code = 0
      try { if ($_.Exception.Data['ftpCode']) { $code = [int]$_.Exception.Data['ftpCode'] } } catch {}
      if ($code -eq 0 -and $_.Exception.Message -match 'code=(\d{3})') { $code = [int]$Matches[1] }
      $retryable = $false
      try { if ($_.Exception.Data.Contains('retryable')) { $retryable = [bool]$_.Exception.Data['retryable'] } } catch {}
      if (-not $retryable) {
        $retryable = Test-SmileFtpRetryableTransferCode -Code $code -Text $_.Exception.Message
      }
      if ($_.Exception.Message -match 'size mismatch|sha mismatch|RNTO failed|RNFR failed|formal (size|sha|verify)|collision|allowlist|fingerprint-complete|型が一致|types do not match|RECONNECT_AUTH|RECONNECT_LOGIN|WRITER_REUSED') {
        if ($_.Exception.Message -notmatch 'STOR_DATA_WRITE_FAILED|STOR_COMPLETION_FAILED|STOR_CONTROL_TIMEOUT|RECONNECT_FAILED|chunk cut|forcibly closed|bytesSent mismatch') {
          $retryable = $false
        }
      }
      if ($_.Exception.Message -match 'RECONNECT_AUTH|RECONNECT_LOGIN|RECONNECT_FAILED|RECONNECT_CWD') {
        $retryable = $true
      }

      # Dedicated cleanup reconnect (do not use possibly broken current writer)
      # RNFR/RNTO failure: temp may be complete — force rename-rollback DELE (fingerprint gate would refuse).
      if ($_.Exception.Message -match 'RNTO failed|RNFR failed') {
        try {
          if ($null -ne $current) {
            if (-not $current.allowDele) { $current.allowDele = $true }
            if ($null -eq (Get-SmileFtpObjectProperty -Object $current -Name 'deleAllowList' -DefaultValue $null)) {
              $current.deleAllowList = New-Object System.Collections.Generic.List[string]
            }
            Add-SmileFtpAllowListItem -List $current.deleAllowList -Item $tempName
            $null = Invoke-SmileFtpDeleFile -session $current -RemoteFileName $tempName
            $cu = [pscustomobject]@{
              ok = $true; deleted = $true; reason = 'rename-rollback'
              manualReviewRequired = $false
              sessionId = [string](Get-SmileFtpObjectProperty -Object $current -Name 'sessionId' -DefaultValue '')
            }
          } else {
            $cu = [pscustomobject]@{
              ok = $false; deleted = $false; reason = 'rename-rollback-no-session'
              manualReviewRequired = $true; residuePath = $remotePathTemp
            }
          }
        } catch {
          $cu = [pscustomobject]@{
            ok = $false; deleted = $false; reason = 'rename-rollback-failed'
            error = $_.Exception.Message; manualReviewRequired = $true; residuePath = $remotePathTemp
          }
        }
      } elseif ($FailInject -eq 'cleanupReconnectFail' -and ($FailInjectOnAttempt -eq 0 -or $FailInjectOnAttempt -eq $attempt)) {
        $cu = [pscustomobject]@{
          ok = $false; deleted = $false; reason = 'cleanup-reconnect-failed'
          manualReviewRequired = $true; residuePath = $remotePathTemp
        }
      } else {
        $cu = Invoke-SmileFtpCleanupTempWithReconnect -FtpConfig $FtpConfig -TempFileName $tempName `
          -ExpectedFullSize $expectedSize -ExpectedFullSha $expectedSha -PriorSession $current
      }
      $log.cleanup = $cu
      if ($cu.manualReviewRequired) {
        $manualReview = $true
        $residue = [ordered]@{
          path = $remotePathTemp
          size = $(if ($cu.PSObject.Properties['remoteSize']) { $cu.remoteSize } else { $null })
          sha256 = $(if ($cu.PSObject.Properties['remoteSha']) { $cu.remoteSha } else { '' })
        }
      }
      $log.endedAt = (Get-Date).ToString('o')
      [void]$attemptLogs.Add([pscustomobject]$log)
      [void]$attempts.Add([pscustomobject]@{
          attempt = $attempt; ok = $false; retryable = $retryable; ftpCode = $code
          sessionId = [string]$log.sessionId; error = $_.Exception.Message
        })

      # Invalidate only when next attempt can reconnect; otherwise keep mock session for retries
      $factoryVar2 = Get-Variable -Name SmileFtpReconnectFactory -Scope Script -ErrorAction SilentlyContinue
      $hasFactory2 = ($null -ne $factoryVar2 -and $null -ne $factoryVar2.Value)
      if (($null -ne $FtpConfig) -or $hasFactory2) {
        $current = $null
      }

      if (-not $retryable -or $attempt -ge $MaxAttempts) { break }
    }
  }

  $msg = 'image upload via temp failed'
  if ($null -ne $lastError) { $msg = [string]$lastError.Exception.Message }
  $failResult = New-SmileFtpSafeImageUploadResult `
    -Success $false -Status 'failed' -Attempts ([int]$attempts.Count) `
    -TempRemotePath $remotePathTemp -FinalRemotePath $remotePathFormal `
    -ExpectedSize $expectedSize `
    -ExpectedSha256 $expectedSha `
    -LastStorFailure (Get-SmileFtpObjectProperty -Object $session -Name 'lastStorFailure' -DefaultValue $null) `
    -CleanupResults (ConvertTo-SmileFtpArray $attemptLogs) -AttemptLogs (ConvertTo-SmileFtpArray $attemptLogs) `
    -ManualReviewRequired $manualReview -Residue $residue `
    -ErrorCode 'SAFE_IMAGE_UPLOAD_FAILED' -Detail $msg `
    -FormalFileName $FormalFileName -TempFileName $tempName -StorTarget $tempName `
    -Session $null
  $ex = New-Object System.Exception ("$msg / formal=$FormalFileName / temp=$tempName / attempts=$($attempts.Count)")
  try {
    if ($null -ne $lastError -and $null -ne $lastError.Exception.Data) {
      foreach ($k in @($lastError.Exception.Data.Keys)) {
        try { $ex.Data[$k] = $lastError.Exception.Data[$k] } catch {}
      }
    }
    $ex.Data['attemptCount'] = [int]$attempts.Count
    $ex.Data['safeImageResult'] = $failResult
    $ex.Data['manualReviewRequired'] = $manualReview
  } catch {}
  throw $ex
}

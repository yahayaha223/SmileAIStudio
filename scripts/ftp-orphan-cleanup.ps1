# Orphan cleanup for failed production publish leftovers.
# Default is DRY-RUN (no DELE). Pass -ExecuteDele only after explicit approval.
Set-StrictMode -Version Latest

function Get-SmileOrphanIncidentFingerprint {
  return [pscustomobject]@{
    publishId = 'pub-20260721-210012-h9t3wt'
    remotePath = '/diary/image/260721-2.jpg'
    fileName = '260721-2.jpg'
    expectedOrphanSize = 98010
    expectedOrphanSha256 = 'e81096c74c8e31d6c70f5c2a16274d17d5bac8a3696aeb6ab929876449b15128'
    expectedFullSize = 133154
    expectedFullSha256 = 'eabdd5ce9bef14a7e205de256e2443145b139fdabcc6a6cc738acb5ebe23e7f6'
    expectedIndexSha256 = '0fd9e02bee19f02e8e194ea8442258947523131ceadb34b13768dcc6d2bdd3e3'
    expectedIndexSize = 37109
    historyResult = 'ROLLED_BACK'
    allowlist = @(
      '/diary/image/260721-2.jpg',
      '/diary/image/260721-2b.jpg',
      '/diary/index.htm.smile-publishing',
      '/diary/index.htm.smile-prepub-bak'
    )
  }
}

function Find-SmileLatestPublishHistory {
  param(
    [Parameter(Mandatory = $true)][string]$WorkspaceRoot,
    [Parameter(Mandatory = $true)][string]$PublishId
  )
  $dir = [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot '.data\publish-history'))
  if (-not (Test-Path -LiteralPath $dir)) { return $null }
  $all = @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue)
  $files = @($all | Where-Object { $_.Name -match [regex]::Escape($PublishId) } | Sort-Object LastWriteTime -Descending)
  if ($files.Count -lt 1) { return $null }
  $raw = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($files[0].FullName))
  $result = $null
  $m = [regex]::Match($raw, '"result"\s*:\s*"([^"]+)"')
  if ($m.Success) { $result = $m.Groups[1].Value }
  $histPublishId = $null
  $m2 = [regex]::Match($raw, '"publishId"\s*:\s*"([^"]+)"')
  if ($m2.Success) { $histPublishId = $m2.Groups[1].Value }
  return [pscustomobject]@{
    path = $files[0].FullName
    relPath = ('.data/publish-history/' + $files[0].Name)
    history = [pscustomobject]@{
      result = $result
      publishId = $histPublishId
    }
  }
}

function Test-SmileOrphanImageCleanupEligibility {
  param(
    [Parameter(Mandatory = $true)][string]$WorkspaceRoot,
    [Parameter(Mandatory = $true)][string]$PublishId,
    $RemoteProbe = $null,
    [switch]$SkipLiveProbe
  )
  $fp = Get-SmileOrphanIncidentFingerprint
  $checks = New-Object System.Collections.Generic.List[object]
  $blockers = New-Object System.Collections.Generic.List[string]

  function Add-Check([string]$Name, [bool]$Ok, [string]$Detail) {
    [void]$checks.Add([pscustomobject]@{ name = $Name; ok = $Ok; detail = $Detail })
    if (-not $Ok) { [void]$blockers.Add(($Name + ': ' + $Detail)) }
  }

  Add-Check 'publishId' ($PublishId -eq $fp.publishId) ("got=$PublishId expected=$($fp.publishId)")
  Add-Check 'allowlist' ($fp.allowlist -contains $fp.remotePath) $fp.remotePath

  $hist = Find-SmileLatestPublishHistory -WorkspaceRoot $WorkspaceRoot -PublishId $PublishId
  $histOk = $false
  $histDetail = 'history missing'
  if ($hist -and $hist.history) {
    $histOk = ([string]$hist.history.result -eq $fp.historyResult) -and ([string]$hist.history.publishId -eq $fp.publishId)
    $histDetail = ('result=' + [string]$hist.history.result + ' path=' + $hist.relPath)
  }
  Add-Check 'history-ROLLED_BACK' $histOk $histDetail

  $localImg = Join-Path $WorkspaceRoot 'CorporateSite\diary\diary\image\260721-2.jpg'
  $localSha = ''
  $localSize = 0
  if (Test-Path -LiteralPath $localImg) {
    $lb = [IO.File]::ReadAllBytes($localImg)
    $localSize = $lb.Length
    if (Get-Command Get-SmileFtpSha256Hex -ErrorAction SilentlyContinue) {
      $localSha = Get-SmileFtpSha256Hex $lb
    } else {
      $sha = [Security.Cryptography.SHA256]::Create()
      try {
        $localSha = ([BitConverter]::ToString($sha.ComputeHash($lb)) -replace '-', '').ToLowerInvariant()
      } finally { $sha.Dispose() }
    }
  }
  Add-Check 'local-full-size' ($localSize -eq $fp.expectedFullSize) ("localSize=$localSize")
  Add-Check 'local-full-sha' ($localSha -eq $fp.expectedFullSha256) ("localSha=$localSha")

  if ($null -ne $RemoteProbe) {
    $remote = $RemoteProbe
    Add-Check 'remote-path' ([string]$remote.remotePath -eq [string]$fp.remotePath) ([string]$remote.remotePath)
    Add-Check 'remote-exists' ([bool]$remote.exists) ('exists=' + [bool]$remote.exists)
    $rSize = 0
    try { $rSize = [long]$remote.size } catch { $rSize = -1 }
    $rSha = [string]$remote.sha256
    $iSha = [string]$remote.indexSha256
    $iSize = 0
    try { $iSize = [long]$remote.indexSize } catch { $iSize = -1 }
    Add-Check 'remote-size-orphan' ($rSize -eq [long]$fp.expectedOrphanSize) ("size=$rSize")
    Add-Check 'remote-sha-orphan' ($rSha -eq [string]$fp.expectedOrphanSha256) ("sha=$rSha")
    Add-Check 'remote-not-full-size' ($rSize -ne [long]$fp.expectedFullSize) ("size=$rSize")
    Add-Check 'remote-not-local-sha' ($rSha -ne $localSha) 'diff-from-local'
    Add-Check 'index-sha' ($iSha -eq [string]$fp.expectedIndexSha256) ("indexSha=$iSha")
    Add-Check 'index-size' ($iSize -eq [long]$fp.expectedIndexSize) ("indexSize=$iSize")
    Add-Check 'did-not-exist-before' ([bool]$remote.didNotExistBefore) 'didNotExistBefore'
  } else {
    Add-Check 'remote-probe' $false 'remote probe data required'
  }

  $ok = ($blockers.Count -eq 0)
  $cand = @()
  if ($ok) { $cand = @([string]$fp.remotePath) }
  return [pscustomobject]@{
    ok = $ok
    wouldDelete = $ok
    deleteCandidates = $cand
    blockers = [string[]]@($blockers.ToArray())
    checks = @($checks.ToArray())
    fingerprint = $fp
    historyRelPath = $(if ($hist) { [string]$hist.relPath } else { $null })
    executeDele = $false
    note = 'Default is check-only. Formal Xserver DELE requires executeDele=true and explicitConfirm.'
  }
}

function Invoke-SmileOrphanImageCleanup {
  param(
    [Parameter(Mandatory = $true)][string]$WorkspaceRoot,
    [Parameter(Mandatory = $true)]$FtpConfig,
    [Parameter(Mandatory = $true)][string]$PublishId,
    [bool]$ExplicitConfirm = $false,
    [bool]$ExecuteDele = $false,
    $RemoteProbeOverride = $null
  )
  $fp = Get-SmileOrphanIncidentFingerprint
  $out = [ordered]@{
    ok = $false
    executed = $false
    deleted = @()
    wouldDelete = @()
    blockers = @()
    checks = @()
    commands = @()
    writeCommandCount = 0
    userMessage = ''
  }

  if ($PublishId -ne $fp.publishId) {
    $out.blockers = @('publishId mismatch')
    $out.userMessage = 'publishId mismatch'
    return [pscustomobject]$out
  }
  if ($ExecuteDele -and -not $ExplicitConfirm) {
    $out.blockers = @('explicitConfirm required for executeDele')
    $out.userMessage = 'explicitConfirm required for executeDele'
    return [pscustomobject]$out
  }

  $probe = $RemoteProbeOverride
  $session = $null
  try {
    if (-not $probe) {
      if (-not (Get-Command Connect-SmileFtpAuthenticatedSession -ErrorAction SilentlyContinue)) {
        throw (New-Object System.Exception('FTP module not loaded'))
      }
      $conn = Connect-SmileFtpAuthenticatedSession `
        -HostName ([string]$FtpConfig.host) `
        -Port ([int]($(if ($FtpConfig.port) { $FtpConfig.port } else { 21 }))) `
        -Username ([string]$FtpConfig.username) `
        -Password ([string]$FtpConfig.password) `
        -RemoteRoot ([string]($(if ($FtpConfig.remoteRoot) { $FtpConfig.remoteRoot } else { '/' }))) `
        -UseTls ([bool]($(if ($null -ne $FtpConfig.useTls) { $FtpConfig.useTls } else { $true }))) `
        -TimeoutMs ([int]($(if ($FtpConfig.timeoutMs) { $FtpConfig.timeoutMs } else { 25000 })))
      $session = $conn.session
      $session.allowStor = $false
      $session.allowDele = $false
      $session.allowRename = $false

      $null = Send-SmileFtpCommand $session 'TYPE A'
      $null = Send-SmileFtpCommand $session 'CWD diary'
      $idxBytes = Invoke-SmileFtpRetrBytes -session $session -RemoteFileName 'index.htm'
      $idxSha = Get-SmileFtpSha256Hex $idxBytes
      $null = Send-SmileFtpCommand $session 'TYPE A'
      $null = Send-SmileFtpCommand $session 'CWD image'
      $sz = Invoke-SmileFtpSize -session $session -RemoteFileName $fp.fileName
      $exists = [bool]($sz -and $sz.ok)
      $remoteSize = $(if ($exists) { [long]$sz.size } else { $null })
      $remoteSha = $null
      if ($exists) {
        $rb = Invoke-SmileFtpRetrBytes -session $session -RemoteFileName $fp.fileName
        $remoteSha = Get-SmileFtpSha256Hex $rb
      }
      $probe = [pscustomobject]@{
        remotePath = $fp.remotePath
        exists = $exists
        size = $remoteSize
        sha256 = $remoteSha
        indexSha256 = $idxSha
        indexSize = $idxBytes.Length
        didNotExistBefore = $true
      }
    }

    $elig = Test-SmileOrphanImageCleanupEligibility `
      -WorkspaceRoot $WorkspaceRoot `
      -PublishId $PublishId `
      -RemoteProbe $probe `
      -SkipLiveProbe
    $out.checks = @($elig.checks)
    $out.blockers = @($elig.blockers)
    $out.wouldDelete = @($elig.deleteCandidates)
    $out.ok = [bool]$elig.ok
    if (-not $elig.ok) {
      $out.userMessage = 'cleanup conditions not met (no DELE)'
      return [pscustomobject]$out
    }

    if (-not $ExecuteDele) {
      $out.userMessage = 'one delete candidate confirmed; executeDele=false so no Xserver DELE'
      return [pscustomobject]$out
    }

    if (-not $session) {
      throw (New-Object System.Exception('session required for executeDele'))
    }
    $session.allowDele = $true
    $session.deleAllowList = New-Object System.Collections.Generic.List[string]
    [void]$session.deleAllowList.Add($fp.fileName)
    $null = Send-SmileFtpCommand $session 'TYPE A'
    try { $null = Send-SmileFtpCommand $session 'CWD image' } catch {}
    $null = Invoke-SmileFtpDeleFile -session $session -RemoteFileName $fp.fileName
    $out.executed = $true
    $out.deleted = @($fp.remotePath)
    $out.userMessage = 'orphan image deleted'
    $out.commands = @($session.commands)
    $out.writeCommandCount = Get-SmileFtpWriteCommandCount -Commands $out.commands
    return [pscustomobject]$out
  } catch {
    $msg = $_.Exception.Message
    if ($FtpConfig.password) { $msg = $msg.Replace([string]$FtpConfig.password, '********') }
    $out.blockers = @($msg)
    $out.userMessage = 'orphan cleanup error'
    if ($session) { $out.commands = @($session.commands) }
    return [pscustomobject]$out
  } finally {
    if ($session) {
      try { Close-SmileFtpSession $session } catch {}
    }
  }
}

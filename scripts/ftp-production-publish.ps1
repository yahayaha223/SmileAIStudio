# Smile AI Studio - Explicit production publish (STOR) + rollback DELE whitelist
# Requires scripts/ftp-readonly-probe.ps1 and scripts/ftp-safe-image-upload.ps1 to be dot-sourced first.
# Never auto-runs. Caller must pass explicitConfirm=$true.

Set-StrictMode -Version Latest

function Get-SmilePublishLockPath {
  param([string]$Root, [string]$PublishId)
  $dir = [IO.Path]::GetFullPath((Join-Path $Root '.data\publish-locks'))
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $safe = ($PublishId -replace '[^a-zA-Z0-9_\-]', '')
  if ([string]::IsNullOrEmpty($safe)) { $safe = 'unknown' }
  if ($safe.Length -gt 64) { $safe = $safe.Substring(0, 64) }
  return Join-Path $dir ($safe + '.lock.json')
}

function Test-SmilePublishLock {
  param([string]$Root, [string]$PublishId, [int]$MaxAgeMinutes = 30)
  $path = Get-SmilePublishLockPath -Root $Root -PublishId $PublishId
  if (-not (Test-Path -LiteralPath $path)) {
    return @{ locked = $false; stale = $false; path = $path; forceExpirable = $false; inProgress = $false }
  }
  try {
    $obj = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $started = [datetime]::Parse([string]$obj.startedAt)
    $ageMin = ((Get-Date).ToUniversalTime() - $started.ToUniversalTime()).TotalMinutes
    $inProgress = [bool]$obj.inProgress
    if (-not $inProgress -and $ageMin -gt $MaxAgeMinutes) {
      return @{ locked = $false; stale = $true; path = $path; lock = $obj; forceExpirable = $true; inProgress = $false }
    }
    if ($inProgress -and $ageMin -gt ($MaxAgeMinutes * 3)) {
      return @{ locked = $true; stale = $true; path = $path; lock = $obj; forceExpirable = $true; inProgress = $true }
    }
    return @{ locked = $true; stale = $false; path = $path; lock = $obj; inProgress = $inProgress; forceExpirable = $false }
  } catch {
    return @{ locked = $true; stale = $true; path = $path; forceExpirable = $true; inProgress = $false }
  }
}

function Acquire-SmilePublishLock {
  param([string]$Root, [string]$PublishId, [string]$Owner = 'api')
  $existing = Test-SmilePublishLock -Root $Root -PublishId $PublishId
  $force = $false
  if ($existing.ContainsKey('forceExpirable')) { $force = [bool]$existing.forceExpirable }
  if ($existing.locked -and -not $force) {
    throw [Exception]'publish lock already held'
  }
  $path = Get-SmilePublishLockPath -Root $Root -PublishId $PublishId
  $obj = [ordered]@{
    publishId = $PublishId
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    owner = $Owner
    inProgress = $true
    pid = $PID
  }
  [IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
  return $path
}

function Update-SmilePublishLock {
  param([string]$LockPath, [hashtable]$Patch)
  if (-not (Test-Path -LiteralPath $LockPath)) { return }
  $obj = Get-Content -LiteralPath $LockPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $hash = [ordered]@{}
  foreach ($p in $obj.PSObject.Properties) { $hash[$p.Name] = $p.Value }
  foreach ($k in $Patch.Keys) { $hash[$k] = $Patch[$k] }
  [IO.File]::WriteAllText($LockPath, ($hash | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
}

function Release-SmilePublishLock {
  param([string]$LockPath)
  if ($LockPath -and (Test-Path -LiteralPath $LockPath)) {
    Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-SmilePublishHistoryDir {
  param([string]$Root)
  $dir = [IO.Path]::GetFullPath((Join-Path $Root '.data\publish-history'))
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  return $dir
}

function Save-SmilePublishHistory {
  param([string]$Root, $History)
  $dir = Get-SmilePublishHistoryDir -Root $Root
  $id = [string]$History.publishId
  $safe = ($id -replace '[^a-zA-Z0-9_\-]', '')
  if ([string]::IsNullOrEmpty($safe)) { $safe = 'pub' }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $path = Join-Path $dir ($stamp + '_' + $safe + '.json')
  $json = ($History | ConvertTo-Json -Depth 14)
  if ($json -match '(?i)"password"\s*:') {
    throw [Exception]'history contains password field'
  }
  [IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
  return ($path.Substring($Root.Length).TrimStart('\','/') -replace '\\','/')
}

function Resolve-SmileWorkspacePath {
  param([string]$Root, [string]$Rel)
  $rel = ($Rel -replace '/', [IO.Path]::DirectorySeparatorChar).TrimStart([IO.Path]::DirectorySeparatorChar)
  $full = [IO.Path]::GetFullPath((Join-Path $Root $rel))
  $rootFull = [IO.Path]::GetFullPath($Root)
  if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw [Exception]'path escapes workspace'
  }
  return $full
}

<#
  Explicit production publish.
  $Payload fields (selected):
    explicitConfirm, confirmPhrase, confirmChecks
    publishId, diaryId, title, publishDate
    manifest (files with localPath/remotePath/sha256/size/type)
    dryRunReport (verdict READY_FOR_PRODUCTION, productionBackupSha256, ...)
    backupRelPath
    expectedProductionIndexSha256
    failAt (optional mock: image2|indexStor|indexVerify)
#>
function Invoke-SmileFtpProductionPublish {
  param(
    [Parameter(Mandatory=$true)][string]$WorkspaceRoot,
    [Parameter(Mandatory=$true)]$FtpConfig,
    [Parameter(Mandatory=$true)]$Payload
  )

  $result = [ordered]@{
    ok = $false
    result = 'FAILED'
    stage = 'init'
    progress = @()
    publishId = [string]$Payload.publishId
    diaryId = [string]$Payload.diaryId
    commands = @()
    storFiles = @()
    uploadedImages = @()
    indexUploaded = $false
    rollback = $null
    historyRelPath = $null
    httpCheck = $null
    userMessage = $null
    writeCommandCount = 0
    host = [string]$FtpConfig.host
    remoteRoot = [string]$FtpConfig.remoteRoot
  }

  $script:SmilePublishVerified = $false
  $lockPath = $null
  $session = $null
  $uploadedImages = New-Object System.Collections.Generic.List[string]
  # STOR開始前に登録。完了前失敗でも「公開前未存在」ならロールバック削除候補にする。
  $attemptedUploads = New-Object System.Collections.Generic.List[object]
  $uploadTx = New-SmileFtpUploadTransactionList
  $backupIndexBytes = $null
  $expectedSha = [string]$Payload.expectedProductionIndexSha256

  function Add-AttemptedUpload {
    param(
      [string]$FileName,
      [string]$RemotePath,
      [string]$Kind,
      [bool]$ExistedBefore,
      [long]$ExpectedSize = 0,
      [string]$ExpectedSha = ''
    )
    [void]$attemptedUploads.Add([pscustomobject]@{
      fileName = $FileName
      remotePath = $RemotePath
      kind = $Kind
      existedBefore = $ExistedBefore
      expectedSize = $ExpectedSize
      expectedSha = $ExpectedSha
      registeredAt = (Get-Date).ToString('o')
    })
    if (Get-Command Add-SmileFtpUploadTransaction -ErrorAction SilentlyContinue) {
      Add-SmileFtpUploadTransaction -List $uploadTx -FileName $FileName -RemotePath $RemotePath `
        -Kind $Kind -ExistedBefore $ExistedBefore -ExpectedSize $ExpectedSize -ExpectedSha $ExpectedSha
    }
  }

  function Add-Progress([string]$Text) {
    $result.progress = @($result.progress) + @($Text)
    $result.stage = $Text
  }

  try {
    # --- explicit confirm ---
    if (-not [bool]$Payload.explicitConfirm) {
      throw [Exception]'explicit confirm required'
    }
    if ([string]$Payload.confirmPhrase -ne '公開') {
      throw [Exception]'confirm phrase mismatch'
    }
    $checks = $Payload.confirmChecks
    if (-not $checks -or -not [bool]$checks.homepage -or -not [bool]$checks.content -or -not [bool]$checks.rollback) {
      throw [Exception]'two-step checks incomplete'
    }

    $publishId = [string]$Payload.publishId
    if (-not $publishId) { throw [Exception]'publishId required' }

    $dry = $Payload.dryRunReport
    if (-not $dry -or [string]$dry.verdict -ne 'READY_FOR_PRODUCTION') {
      throw [Exception]'READY_FOR_PRODUCTION required'
    }
    if ([string]$dry.publishId -and [string]$dry.publishId -ne $publishId) {
      throw [Exception]'publishId mismatch with dry-run'
    }

    $manifest = $Payload.manifest
    if (-not $manifest -or -not $manifest.files) { throw [Exception]'manifest required' }
    $files = @($manifest.files)
    $htmlFile = @($files | Where-Object { $_.type -eq 'html' }) | Select-Object -First 1
    $imageFiles = @($files | Where-Object { $_.type -eq 'image' })
    if (-not $htmlFile) { throw [Exception]'manifest html missing' }
    if ($imageFiles.Count -lt 1) { throw [Exception]'manifest images missing' }

    foreach ($f in $files) {
      $rp = [string]$f.remotePath
      if ($f.type -eq 'html' -and -not (Test-SmileFtpRemotePathAllowed -RemotePath $rp -Kind 'html')) {
        throw [Exception]'invalid html remotePath'
      }
      if ($f.type -eq 'image' -and -not (Test-SmileFtpRemotePathAllowed -RemotePath $rp -Kind 'image')) {
        throw [Exception]'invalid image remotePath'
      }
      if ($rp.Contains('..')) { throw [Exception]'remotePath traversal' }
    }

    $backupRel = [string]$Payload.backupRelPath
    if (-not $backupRel -or $backupRel -notmatch '^production-backups/') {
      throw [Exception]'backupRelPath invalid'
    }
    $backupIndexRel = $backupRel.TrimEnd('/') + '/remote/diary/index.htm'
    $backupIndexAbs = Resolve-SmileWorkspacePath -Root $WorkspaceRoot -Rel $backupIndexRel
    if (-not (Test-Path -LiteralPath $backupIndexAbs)) {
      throw [Exception]'production backup index missing'
    }
    $backupIndexBytes = [IO.File]::ReadAllBytes($backupIndexAbs)
    $backupSha = Get-SmileFtpSha256Hex $backupIndexBytes
    if ($expectedSha -and $backupSha -ne $expectedSha.ToLowerInvariant()) {
      # expected is dry-run production sha; backup file should match that
      if ($backupSha -ne ([string]$dry.productionBackupSha256).ToLowerInvariant() -and
          $backupSha -ne $expectedSha.ToLowerInvariant()) {
        throw [Exception]'backup sha mismatch'
      }
    }
    $compareSha = if ($expectedSha) { $expectedSha.ToLowerInvariant() } else { ([string]$dry.productionBackupSha256).ToLowerInvariant() }
    if ($compareSha -and $backupSha -ne $compareSha) {
      # Prefer matching dry-run recorded sha
      if (([string]$dry.productionBackupSha256).ToLowerInvariant() -and
          $backupSha -ne ([string]$dry.productionBackupSha256).ToLowerInvariant()) {
        throw [Exception]'backup sha mismatch vs dry-run'
      }
    }

    # FTP host must match dry-run host if provided
    if ($dry.ftpConnection -and $dry.ftpConnection.host -and
        [string]$dry.ftpConnection.host -ne [string]$FtpConfig.host) {
      throw [Exception]'FTP host mismatch vs dry-run'
    }

    Add-Progress '1/8 公開ロック取得・条件再検査中'
    $lockPath = Acquire-SmilePublishLock -Root $WorkspaceRoot -PublishId $publishId

    $pkgIndexAbs = Resolve-SmileWorkspacePath -Root $WorkspaceRoot -Rel ([string]$htmlFile.localPath)
    if (-not (Test-Path -LiteralPath $pkgIndexAbs)) { throw [Exception]'package index missing' }
    $pkgIndexBytes = [IO.File]::ReadAllBytes($pkgIndexAbs)
    $pkgIndexSha = Get-SmileFtpSha256Hex $pkgIndexBytes
    if ([string]$htmlFile.sha256 -and $pkgIndexSha -ne ([string]$htmlFile.sha256).ToLowerInvariant()) {
      throw [Exception]'package index sha mismatch vs manifest'
    }

    $imagePayload = @()
    foreach ($img in $imageFiles) {
      $abs = Resolve-SmileWorkspacePath -Root $WorkspaceRoot -Rel ([string]$img.localPath)
      if (-not (Test-Path -LiteralPath $abs)) { throw [Exception]("image missing: $($img.localPath)") }
      $bytes = [IO.File]::ReadAllBytes($abs)
      if ($bytes.Length -lt 4) { throw [Exception]("image too small: $($img.localPath)") }
      $sha = Get-SmileFtpSha256Hex $bytes
      if ([string]$img.sha256 -and $sha -ne ([string]$img.sha256).ToLowerInvariant()) {
        throw [Exception]("image sha mismatch: $($img.localPath)")
      }
      $fn = [IO.Path]::GetFileName($abs)
      if ($fn -notmatch '^\d{6}-\d+b?\.jpg$') { throw [Exception]("bad image name: $fn") }
      $imagePayload += @{
        fileName = $fn
        bytes = $bytes
        sha256 = $sha
        size = $bytes.Length
        remotePath = [string]$img.remotePath
      }
    }

    Add-Progress '2/8 本番状態を再確認中'
    $conn = Connect-SmileFtpAuthenticatedSession `
      -HostName ([string]$FtpConfig.host) `
      -Port ([int]($(if ($FtpConfig.port) { $FtpConfig.port } else { 21 }))) `
      -Username ([string]$FtpConfig.username) `
      -Password ([string]$FtpConfig.password) `
      -RemoteRoot ([string]($(if ($FtpConfig.remoteRoot) { $FtpConfig.remoteRoot } else { '/' }))) `
      -UseTls ([bool]($(if ($null -ne $FtpConfig.useTls) { $FtpConfig.useTls } else { $true }))) `
      -TimeoutMs ([int]($(if ($FtpConfig.timeoutMs) { $FtpConfig.timeoutMs } else { 30000 })))
    $session = $conn.session

    # Allowlist for STOR / rename (temp images + temp index → formal)
    $tempIndexName = 'index.htm.smile-publishing'
    $session.allowStor = $true
    $session.dataTransferTimeoutMs = 120000
    $session.controlReplyTimeoutMs = 60000
    foreach ($img in $imagePayload) {
      $tempImg = Get-SmileFtpImageTempName -FormalFileName $img.fileName
      [void]$session.storAllowList.Add($tempImg)
      [void]$session.storAllowList.Add($img.fileName)
      [void]$session.renameAllowList.Add($tempImg)
      [void]$session.renameAllowList.Add($img.fileName)
    }
    [void]$session.storAllowList.Add($tempIndexName)
    [void]$session.storAllowList.Add('index.htm')
    $session.allowRename = $true
    [void]$session.renameAllowList.Add($tempIndexName)
    [void]$session.renameAllowList.Add('index.htm')
    [void]$session.renameAllowList.Add('index.htm.smile-prepub-bak')

    $cwdDiary = Send-SmileFtpCommand $session 'CWD diary'
    if ($cwdDiary.code -ge 400) { throw [Exception]'diary folder missing' }

    $null = Send-SmileFtpCommand $session 'SIZE index.htm'
    $null = Send-SmileFtpCommand $session 'MDTM index.htm'
    $liveBytes = Invoke-SmileFtpRetrBytes -session $session -RemoteFileName 'index.htm'
    $liveSha = Get-SmileFtpSha256Hex $liveBytes
    $drySha = ([string]$dry.productionBackupSha256).ToLowerInvariant()
    if (-not $drySha) { $drySha = $backupSha }
    if ($drySha -and $liveSha -ne $drySha) {
      throw [Exception]'production changed after dry-run'
    }
    # Keep live production index as rollback source (prefer freshest RETR)
    $backupIndexBytes = $liveBytes

    Add-Progress '2/8 バックアップを検証中'
    # re-list images for collision
    $null = Send-SmileFtpCommand $session 'TYPE A'
    $cwdImg = Send-SmileFtpCommand $session 'CWD image'
    if ($cwdImg.code -ge 400) { throw [Exception]'image folder missing' }
    $data = Open-SmileFtpPassiveData $session
    $listReply = Send-SmileFtpCommand $session 'LIST'
    if ($listReply.code -ne 150 -and $listReply.code -ne 125) {
      try { $data.client.Close() } catch {}
      throw [Exception]'LIST failed'
    }
    $null = Protect-SmileFtpDataChannel $data
    $listText = Read-SmileFtpDataText $data
    $null = Read-SmileFtpReply $session
    $remoteNames = Get-SmileFtpListFileNames -ListText $listText
    foreach ($img in $imagePayload) {
      if ($remoteNames -contains $img.fileName) {
        throw [Exception]("collision: $($img.fileName)")
      }
    }

    # Optional fail inject for mock E2E
    $failAt = [string]$Payload.failAt

    Add-Progress ('3/8 画像をアップロード中（0/' + $imagePayload.Count + '）')
    $imgIndex = 0
    $imageUploadResults = @()
    foreach ($img in $imagePayload) {
      $imgIndex++
      Add-Progress ('3/8 画像を安全アップロード中（' + $imgIndex + '/' + $imagePayload.Count + '）')
      if ($failAt -eq 'image2' -and $imgIndex -eq 2) {
        throw [Exception]'injected image2 STOR failure'
      }
      $imgRemotePath = '/diary/image/' + $img.fileName
      $tempName = Get-SmileFtpImageTempName -FormalFileName $img.fileName
      Add-AttemptedUpload -FileName $tempName -RemotePath ('/diary/image/' + $tempName) -Kind 'image-temp' `
        -ExistedBefore $false -ExpectedSize ([long]$img.size) -ExpectedSha ([string]$img.sha256)

      $inject = ''
      $injectAttempt = 0
      $script:SmileFtpFailStorCodesQueue = $null
      if ($failAt -eq 'stor450x1' -and $imgIndex -eq 1) { $script:SmileFtpFailStorCodesQueue = @(450, $null) }
      if ($failAt -eq 'stor450x2' -and $imgIndex -eq 1) { $script:SmileFtpFailStorCodesQueue = @(450, 450, $null) }
      if ($failAt -eq 'stor450x3' -and $imgIndex -eq 1) { $script:SmileFtpFailStorCodesQueue = @(450, 450, 450) }
      if ($failAt -eq 'sizeMismatch' -and $imgIndex -eq 1) { $inject = 'sizeMismatch'; $injectAttempt = 1 }
      if ($failAt -eq 'shaMismatch' -and $imgIndex -eq 1) { $inject = 'shaMismatch'; $injectAttempt = 1 }
      if ($failAt -eq 'rntoFail' -and $imgIndex -eq 1) { $inject = 'rntoFail'; $injectAttempt = 1 }
      if ($failAt -eq 'formalVerifyFail' -and $imgIndex -eq 1) { $inject = 'formalVerifyFail'; $injectAttempt = 1 }

      $script:SmileFtpSkipRetrySleep = $true
      try {
        $upRaw = Invoke-SmileFtpUploadImageViaTemp -session $session -FormalFileName $img.fileName `
          -Bytes $img.bytes -ExpectedSha $img.sha256 -MaxAttempts 3 -TransactionList $uploadTx `
          -FailInject $inject -FailInjectOnAttempt $injectAttempt `
          -FtpConfig $FtpConfig
        $up = Normalize-SmileFtpSafeImageUploadResult $upRaw
        $nextSession = Get-SmileFtpObjectProperty -Object $up -Name 'session' -DefaultValue $null
        if ($null -ne $nextSession) { $session = $nextSession }
        if (-not [bool](Get-SmileFtpObjectProperty -Object $up -Name 'success' -DefaultValue $false)) {
          $detail = [string](Get-SmileFtpObjectProperty -Object $up -Name 'detail' -DefaultValue 'safe image upload failed')
          throw [Exception]$detail
        }
        if ([bool](Get-SmileFtpObjectProperty -Object $up -Name 'manualReviewRequired' -DefaultValue $false)) {
          $result.manualReviewRequired = $true
        }
      } finally {
        $script:SmileFtpSkipRetrySleep = $false
        $script:SmileFtpFailStorCodesQueue = $null
      }

      Add-AttemptedUpload -FileName $img.fileName -RemotePath $imgRemotePath -Kind 'image' `
        -ExistedBefore $false -ExpectedSize ([long]$img.size) -ExpectedSha ([string]$img.sha256)
      [void]$uploadedImages.Add($img.fileName)
      $result.uploadedImages = @($uploadedImages)
      $result.storFiles = @($result.storFiles) + @('STOR ' + $tempName)
      if ($up) { $imageUploadResults += $up }
    }
    $result.imageUploadResults = @($imageUploadResults)

    # Gate: all images must be formally present before index.htm work
    Add-Progress '4/8 画像を検証中'
    foreach ($img in $imagePayload) {
      $szInfo = Invoke-SmileFtpSize -session $session -RemoteFileName $img.fileName
      if (-not $szInfo -or -not $szInfo.ok -or $szInfo.size -ne $img.size) {
        throw [Exception]("size mismatch after image upload gate: $($img.fileName)")
      }
      $got = Invoke-SmileFtpRetrBytes -session $session -RemoteFileName $img.fileName
      $gotSha = Get-SmileFtpSha256Hex $got
      if ($gotSha -ne $img.sha256) { throw [Exception]("sha mismatch after image upload gate: $($img.fileName)") }
      # Temp must not remain
      $tempName = Get-SmileFtpImageTempName -FormalFileName $img.fileName
      $szTemp = Invoke-SmileFtpSize -session $session -RemoteFileName $tempName
      if ($szTemp -and $szTemp.ok) {
        throw [Exception]("temp image still present after rename: $tempName")
      }
    }

    # back to diary for index
    $null = Send-SmileFtpCommand $session 'TYPE A'
    $cdup = Send-SmileFtpCommand $session 'CWD ..'
    if ($cdup.code -ge 400) {
      # try absolute from root again
      $null = Send-SmileFtpCommand $session ("CWD " + $conn.remoteRoot)
      $null = Send-SmileFtpCommand $session 'CWD diary'
    }

    Add-Progress '5/8 index.htmを一時名でアップロード中'
    if ($failAt -eq 'indexStor') {
      throw [Exception]'injected index STOR failure'
    }
    Add-AttemptedUpload -FileName $tempIndexName -RemotePath ('/diary/' + $tempIndexName) -Kind 'temp-index' `
      -ExistedBefore $false -ExpectedSize ([long]$pkgIndexBytes.Length) -ExpectedSha $pkgIndexSha
    $null = Invoke-SmileFtpStorBytes -session $session -RemoteFileName $tempIndexName -Bytes $pkgIndexBytes
    $result.storFiles = @($result.storFiles) + @('STOR ' + $tempIndexName)
    $result.tempIndexUploaded = $true

    Add-Progress '5/8 一時indexのサイズ・SHAを確認中'
    $tempBytes = Invoke-SmileFtpRetrBytes -session $session -RemoteFileName $tempIndexName
    $tempSha = Get-SmileFtpSha256Hex $tempBytes
    if ($tempSha -ne $pkgIndexSha -or $tempBytes.Length -ne $pkgIndexBytes.Length) {
      throw [Exception]'temp index sha/size mismatch after stor'
    }

    Add-Progress '5/8 既存index.htmをバックアップし安全に切替中'
    # Remote pre-publish backup of current formal index (rollback source already in memory)
    Add-AttemptedUpload -FileName 'index.htm.smile-prepub-bak' -RemotePath '/diary/index.htm.smile-prepub-bak' -Kind 'prepub-bak' `
      -ExistedBefore $false -ExpectedSize ([long]$backupIndexBytes.Length)
    $null = Invoke-SmileFtpStorBytes -session $session -RemoteFileName 'index.htm.smile-prepub-bak' -Bytes $backupIndexBytes
    $result.storFiles = @($result.storFiles) + @('STOR index.htm.smile-prepub-bak')
    $result.prepubBackupUploaded = $true

    # Atomic-ish switch: rename temp → formal index.htm
    $rnfr = Send-SmileFtpCommand $session ("RNFR " + $tempIndexName)
    if ($rnfr.code -ge 400) {
      throw [Exception]('RNFR temp index failed: ' + $rnfr.text)
    }
    $rnto = Send-SmileFtpCommand $session 'RNTO index.htm'
    if ($rnto.code -ge 400) {
      # Fallback: verified temp content already matches package — STOR formal then DELE temp
      $null = Invoke-SmileFtpStorBytes -session $session -RemoteFileName 'index.htm' -Bytes $pkgIndexBytes
      $result.storFiles = @($result.storFiles) + @('STOR index.htm')
      $session.allowDele = $true
      if (-not $session.deleAllowList) {
        $session.deleAllowList = New-Object System.Collections.Generic.List[string]
      }
      if ($session.deleAllowList -notcontains $tempIndexName) {
        [void]$session.deleAllowList.Add($tempIndexName)
      }
      try { $null = Invoke-SmileFtpDeleFile -session $session -RemoteFileName $tempIndexName } catch {}
      $result.indexSwitchMode = 'stor-fallback'
    } else {
      $result.indexSwitchMode = 'rename'
    }
    $result.indexUploaded = $true

    Add-Progress '6/8 本番ファイルを検証中'
    $afterBytes = Invoke-SmileFtpRetrBytes -session $session -RemoteFileName 'index.htm'
    $afterSha = Get-SmileFtpSha256Hex $afterBytes
    if ($afterSha -ne $pkgIndexSha) { throw [Exception]'index sha mismatch after switch' }
    if ($failAt -eq 'indexVerify') {
      throw [Exception]'injected index verify failure'
    }
    # Cleanup remote prepub bak after successful verify (optional; keep if DELE fails)
    try {
      $session.allowDele = $true
      if (-not $session.deleAllowList) {
        $session.deleAllowList = New-Object System.Collections.Generic.List[string]
      }
      if ($session.deleAllowList -notcontains 'index.htm.smile-prepub-bak') {
        [void]$session.deleAllowList.Add('index.htm.smile-prepub-bak')
      }
      $null = Invoke-SmileFtpDeleFile -session $session -RemoteFileName 'index.htm.smile-prepub-bak'
      $result.prepubBackupDeleted = $true
    } catch {
      $result.prepubBackupDeleted = $false
    }
    # Mark verified so a later history-only failure never triggers FTP rollback
    $script:SmilePublishVerified = $true

    Add-Progress '7/8 ホームページ表示を確認中'
    $httpCheck = @{
      ok = $true
      mode = 'local-bytes'
      note = 'mock/local verify via RETR sha; remote HTTP skipped for localhost mock'
      status = 200
    }
    $hostName = [string]$FtpConfig.host
    if ($hostName -ne '127.0.0.1' -and $hostName -ne 'localhost') {
      $base = [string]$Payload.productionDiaryUrl
      if (-not $base) { $base = 'https://www.egaonokiroku.co.jp/diary/index.htm' }
      try {
        $url = $base + '?t=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
        $httpCheck = @{
          ok = ($resp.StatusCode -eq 200)
          mode = 'http'
          status = [int]$resp.StatusCode
          titleFound = ($resp.Content -like ('*' + [string]$Payload.title + '*'))
        }
        if (-not $httpCheck.ok) { throw [Exception]'HTTP check failed' }
      } catch {
        throw [Exception]'HTTP check failed'
      }
    }
    $result.httpCheck = $httpCheck

    Add-Progress '8/8 公開履歴を保存中'
    $null = Send-SmileFtpCommand $session 'QUIT'
    $session.closed = $true
    try { $session.client.Close() } catch {}
    $result.commands = @($session.commands)
    $result.writeCommandCount = @($result.commands | Where-Object { $_ -match '^(STOR|DELE)\b' }).Count

    $history = [ordered]@{
      publishId = $publishId
      diaryId = [string]$Payload.diaryId
      title = [string]$Payload.title
      publishDate = [string]$Payload.publishDate
      executedAt = (Get-Date).ToString('o')
      host = [string]$FtpConfig.host
      port = [int]($(if ($FtpConfig.port) { $FtpConfig.port } else { 21 }))
      username = [string]$FtpConfig.username
      remoteRoot = [string]$FtpConfig.remoteRoot
      files = @($files | ForEach-Object {
        @{ localPath = $_.localPath; remotePath = $_.remotePath; type = $_.type; sha256 = $_.sha256; size = $_.size }
      })
      beforeIndexSha256 = $drySha
      afterIndexSha256 = $afterSha
      packageIndexSha256 = $pkgIndexSha
      backupRelPath = $backupRel
      ftpCommands = $result.commands
      httpCheck = $httpCheck
      rollbackNeeded = $false
      result = 'SUCCESS'
      uploadedImages = @($uploadedImages)
    }
    try {
      $result.historyRelPath = Save-SmilePublishHistory -Root $WorkspaceRoot -History $history
    } catch {
      # Files already verified on server — do not rollback; withhold production-published
      Release-SmilePublishLock -LockPath $lockPath
      $lockPath = $null
      $result.ok = $false
      $result.result = 'FAILED'
      $result.detail = 'history save failed after successful upload verify'
      $result.userMessage = '本番ファイルの配置は完了しましたが、公開履歴の保存に失敗したため status は更新しません。'
      $result.stage = 'history-failed'
      return [pscustomobject]$result
    }

    Release-SmilePublishLock -LockPath $lockPath
    $lockPath = $null

    $result.ok = $true
    $result.result = 'SUCCESS'
    $result.userMessage = '本番公開が完了しました'
    $result.stage = 'done'
    return [pscustomobject]$result
  } catch {
    $err = [string]$_.Exception.Message
    $safeErr = $err
    if ($FtpConfig.password) { $safeErr = $safeErr.Replace([string]$FtpConfig.password, '********') }

    $rolled = $false
    $rollbackNotes = @()
    # Never FTP-rollback after post-verify history issues (handled above) or if already verified
    if ($script:SmilePublishVerified) {
      if ($lockPath) { Release-SmilePublishLock -LockPath $lockPath }
      $result.ok = $false
      $result.result = 'FAILED'
      $result.detail = $safeErr
      $result.userMessage = '本番配置後の後処理に失敗しました（本番の自動復元は行っていません）'
      return [pscustomobject]$result
    }
    try {
      if ($session -and -not $session.closed) {
        # Allowlist from this publish transaction only (temps + newly formalized images + index temps)
        $rollbackAllowExact = New-Object System.Collections.Generic.List[string]
        foreach ($n in @('index.htm.smile-publishing', 'index.htm.smile-prepub-bak')) {
          [void]$rollbackAllowExact.Add($n)
        }
        foreach ($img in @($imagePayload)) {
          [void]$rollbackAllowExact.Add([string]$img.fileName)
          [void]$rollbackAllowExact.Add((Get-SmileFtpImageTempName -FormalFileName $img.fileName))
        }
        foreach ($a in @($attemptedUploads)) {
          $fn = [string]$a.fileName
          if ($fn -and $rollbackAllowExact -notcontains $fn) {
            if ((Test-SmileFtpImageTempName $fn) -or ($fn -match '^\d{6}-\d+b?\.jpg$') -or
                $fn -eq 'index.htm.smile-publishing' -or $fn -eq 'index.htm.smile-prepub-bak') {
              [void]$rollbackAllowExact.Add($fn)
            }
          }
        }
        $session.allowDele = $true
        $session.deleAllowList = New-Object System.Collections.Generic.List[string]
        foreach ($n in $rollbackAllowExact) { [void]$session.deleAllowList.Add($n) }

        if ($result.indexUploaded -and $backupIndexBytes) {
          $session.allowStor = $true
          if ($session.storAllowList -notcontains 'index.htm') { [void]$session.storAllowList.Add('index.htm') }
          try {
            # ensure in diary dir
            try { $null = Send-SmileFtpCommand $session 'CWD diary' } catch {}
            $null = Invoke-SmileFtpStorBytes -session $session -RemoteFileName 'index.htm' -Bytes $backupIndexBytes
            $restored = Invoke-SmileFtpRetrBytes -session $session -RemoteFileName 'index.htm'
            $restoredSha = Get-SmileFtpSha256Hex $restored
            $bakSha = Get-SmileFtpSha256Hex $backupIndexBytes
            if ($restoredSha -eq $bakSha) {
              $rollbackNotes += 'index.htm restored'
              $rolled = $true
            } else {
              $rollbackNotes += 'index.htm restore sha mismatch'
              $rolled = $false
            }
          } catch {
            $rollbackNotes += 'index.htm restore failed'
            $rolled = $false
          }
        }

        # Cleanup temp / prepub / orphan images from attemptedUploads (even if STOR completion failed)
        $orphanImageNames = New-Object System.Collections.Generic.List[string]
        $orphanDiaryNames = New-Object System.Collections.Generic.List[string]
        foreach ($a in @($attemptedUploads)) {
          if ($a.existedBefore) {
            $rollbackNotes += ('skip delete preexisting ' + $a.fileName)
            continue
          }
          if ($rollbackAllowExact -notcontains [string]$a.fileName) {
            $rollbackNotes += ('skip delete not-allowlisted ' + $a.fileName)
            continue
          }
          if ($a.kind -eq 'image' -or $a.kind -eq 'image-temp') {
            if ($orphanImageNames -notcontains [string]$a.fileName) {
              [void]$orphanImageNames.Add([string]$a.fileName)
            }
          } else {
            if ($orphanDiaryNames -notcontains [string]$a.fileName) {
              [void]$orphanDiaryNames.Add([string]$a.fileName)
            }
          }
        }
        # Also include successfully uploaded images (subset of orphans usually)
        foreach ($n in @($uploadedImages)) {
          if ($rollbackAllowExact -contains [string]$n -and $orphanImageNames -notcontains [string]$n) {
            [void]$orphanImageNames.Add([string]$n)
          }
        }
        foreach ($orphan in @('index.htm.smile-publishing', 'index.htm.smile-prepub-bak')) {
          if ($orphanDiaryNames -notcontains $orphan) { [void]$orphanDiaryNames.Add($orphan) }
        }

        foreach ($orphan in @($orphanDiaryNames)) {
          try {
            try { $null = Send-SmileFtpCommand $session 'CWD diary' } catch {}
            $sz = Invoke-SmileFtpSize -session $session -RemoteFileName $orphan
            if (-not $sz -or -not $sz.ok) {
              $rollbackNotes += ('orphan absent ' + $orphan)
              continue
            }
            $null = Invoke-SmileFtpDeleFile -session $session -RemoteFileName $orphan
            $rollbackNotes += ('deleted orphan ' + $orphan)
            $rolled = $true
          } catch {
            $rollbackNotes += ('delete orphan failed ' + $orphan)
          }
        }

        if ($orphanImageNames.Count -gt 0) {
          try {
            $null = Send-SmileFtpCommand $session 'TYPE A'
            try { $null = Send-SmileFtpCommand $session 'CWD image' } catch {
              try {
                $null = Send-SmileFtpCommand $session ("CWD " + ([string]$FtpConfig.remoteRoot))
                $null = Send-SmileFtpCommand $session 'CWD diary'
                $null = Send-SmileFtpCommand $session 'CWD image'
              } catch {}
            }
            foreach ($n in @($orphanImageNames)) {
              try {
                $sz = Invoke-SmileFtpSize -session $session -RemoteFileName $n
                if (-not $sz -or -not $sz.ok) {
                  $rollbackNotes += ('image absent ' + $n)
                  continue
                }
                $null = Invoke-SmileFtpDeleFile -session $session -RemoteFileName $n
                $rollbackNotes += ('deleted ' + $n)
                $rolled = $true
              } catch {
                $rollbackNotes += ('delete failed ' + $n)
                $rolled = $false
              }
            }
          } catch {
            $rollbackNotes += 'image rollback failed'
            $rolled = $false
          }
        } elseif (-not $result.indexUploaded -and $attemptedUploads.Count -eq 0) {
          $rolled = $true  # nothing written
        }

        try {
          $null = Send-SmileFtpCommand $session 'QUIT'
          $session.closed = $true
          $session.client.Close()
        } catch {}
        $result.commands = @($session.commands)
      }
    } catch {
      $rollbackNotes += 'rollback exception'
      $rolled = $false
    }

    if ($session) { $result.commands = @($session.commands) }
    $result.writeCommandCount = @($result.commands | Where-Object { $_ -match '^(STOR|DELE)\b' }).Count
    $result.uploadedImages = @($uploadedImages)
    $result.attemptedUploads = @($attemptedUploads | ForEach-Object {
      [ordered]@{
        fileName = $_.fileName
        remotePath = $_.remotePath
        kind = $_.kind
        existedBefore = [bool]$_.existedBefore
        expectedSize = $_.expectedSize
      }
    })
    $storFail = Get-SmileFtpObjectProperty -Object $session -Name 'lastStorFailure' -DefaultValue $null
    if ($null -ne $storFail) {
      $result.storFailure = $storFail
    }
    $result.rollback = @{
      attempted = $true
      ok = $rolled
      notes = $rollbackNotes
    }

    $userMsg = '本番公開に失敗しました'
    if ($err -match 'production changed after dry-run') {
      $userMsg = '予行演習後に本番ホームページが変更されたため、公開を中止しました。'
    } elseif ($err -match '^collision') {
      $userMsg = '本番サーバーに同名画像が存在するため公開できません。'
    } elseif (-not $rolled -and ($result.indexUploaded -or $uploadedImages.Count -gt 0 -or $attemptedUploads.Count -gt 0)) {
      $userMsg = '自動復元に失敗しました。手動確認が必要です。'
    } elseif ($rolled -and ($result.indexUploaded -or $uploadedImages.Count -gt 0 -or $attemptedUploads.Count -gt 0)) {
      $userMsg = '公開に失敗したため、本番を公開前の状態へ戻しました。'
    }

    $histResult = if ($rolled) { 'ROLLED_BACK' } else { 'FAILED' }
    try {
      $history = [ordered]@{
        publishId = [string]$Payload.publishId
        diaryId = [string]$Payload.diaryId
        title = [string]$Payload.title
        publishDate = [string]$Payload.publishDate
        executedAt = (Get-Date).ToString('o')
        host = [string]$FtpConfig.host
        username = [string]$FtpConfig.username
        remoteRoot = [string]$FtpConfig.remoteRoot
        result = $histResult
        failedStage = [string]$result.stage
        errorClass = $safeErr
        uploadedImages = @($uploadedImages)
        indexUploaded = [bool]$result.indexUploaded
        rollback = $result.rollback
        ftpCommands = $result.commands
        backupRelPath = [string]$Payload.backupRelPath
      }
      $result.historyRelPath = Save-SmilePublishHistory -Root $WorkspaceRoot -History $history
    } catch {}

    if ($lockPath) { Release-SmilePublishLock -LockPath $lockPath }

    $result.ok = $false
    $result.result = $histResult
    $result.userMessage = $userMsg
    $result.detail = $safeErr
    if ($userMsg -like '*手動確認*') {
      $result.critical = $true
      $result.manualRecovery = @{
        backupRelPath = [string]$Payload.backupRelPath
        uploadedImages = @($uploadedImages)
        indexUploaded = [bool]$result.indexUploaded
      }
    }
    return [pscustomobject]$result
  } finally {
    if ($session -and -not $session.closed) {
      try { Close-SmileFtpSession $session } catch {}
    }
  }
}

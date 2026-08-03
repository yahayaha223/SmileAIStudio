$ErrorActionPreference = 'Continue'
$root = 'C:\Users\perfo\Desktop\SmileAIStudio'
$port = 8765

$mimes = @{
  '.html'='text/html; charset=utf-8'
  '.htm'='text/html'
  '.js'='application/javascript; charset=utf-8'
  '.css'='text/css; charset=utf-8'
  '.json'='application/json; charset=utf-8'
  '.png'='image/png'
  '.jpg'='image/jpeg'
  '.jpeg'='image/jpeg'
  '.gif'='image/gif'
  '.svg'='image/svg+xml'
  '.ico'='image/x-icon'
  '.woff'='font/woff'
  '.woff2'='font/woff2'
}

function Send-Bytes([System.Net.HttpListenerResponse]$res, [int]$code, [byte[]]$bytes, [string]$ctype) {
  $res.StatusCode = $code
  if ($ctype) { $res.ContentType = $ctype }
  try {
    $res.Headers['Access-Control-Allow-Origin'] = '*'
    $res.Headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
    $res.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
  } catch {}
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Send-Json($res, [int]$code, $obj) {
  $json = ($obj | ConvertTo-Json -Compress -Depth 12)
  Send-Bytes $res $code ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8'
}

function Read-BodyBytes([System.Net.HttpListenerRequest]$req) {
  $ms = New-Object System.IO.MemoryStream
  $req.InputStream.CopyTo($ms)
  return $ms.ToArray()
}

function Test-SafeDiaryImageName([string]$name) {
  return $name -match '^\d{6}-\d+b?\.jpg$'
}

function Get-SafeImagePath([string]$fullRoot, [string]$fileName) {
  if (-not (Test-SafeDiaryImageName $fileName)) { return $null }
  if ($fileName.Contains('..') -or $fileName.Contains('/') -or $fileName.Contains('\')) { return $null }
  $dir = [IO.Path]::GetFullPath((Join-Path $fullRoot 'CorporateSite\diary\diary\image'))
  $path = [IO.Path]::GetFullPath((Join-Path $dir $fileName))
  if (-not $path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  return $path
}

function Start-StaticListener {
  foreach ($tryPort in @(8765, 8766)) {
    $listener = $null
    try {
      $listener = New-Object System.Net.HttpListener
      $listener.Prefixes.Add("http://127.0.0.1:$tryPort/")
      $listener.Start()
      $script:port = $tryPort
      return $listener
    } catch {
      if ($listener) { try { $listener.Abort(); $listener.Close() } catch {} }
    }
  }
  return $null
}

while ($true) {
  $listener = Start-StaticListener
  if (-not $listener) { Start-Sleep -Seconds 2; continue }
  $prefix = "http://127.0.0.1:$port/"
  @{ pid = $PID; port = $port; url = $prefix } | ConvertTo-Json |
    Set-Content -Path (Join-Path $env:TEMP 'smile-static-server.json') -Encoding UTF8

  $fullRoot = (Resolve-Path $root).Path
  $allowedIndex = [IO.Path]::GetFullPath((Join-Path $fullRoot 'CorporateSite\diary\diary\index.htm'))
  $allowedDiaryDir = [IO.Path]::GetFullPath((Join-Path $fullRoot 'CorporateSite\diary\diary'))
  $allowedImageDir = [IO.Path]::GetFullPath((Join-Path $fullRoot 'CorporateSite\diary\diary\image'))
  $tmpRoot = [IO.Path]::GetFullPath((Join-Path $fullRoot 'CorporateSite\diary\diary\_tmp_publish'))
  $ftpProbeScript = [IO.Path]::GetFullPath((Join-Path $fullRoot 'scripts\ftp-readonly-probe.ps1'))
  if (Test-Path -LiteralPath $ftpProbeScript) {
    . $ftpProbeScript
  }
  $ftpSafeImageScript = [IO.Path]::GetFullPath((Join-Path $fullRoot 'scripts\ftp-safe-image-upload.ps1'))
  if (Test-Path -LiteralPath $ftpSafeImageScript) {
    . $ftpSafeImageScript
  }
  $ftpPublishScript = [IO.Path]::GetFullPath((Join-Path $fullRoot 'scripts\ftp-production-publish.ps1'))
  if (Test-Path -LiteralPath $ftpPublishScript) {
    . $ftpPublishScript
  }
  $ftpOrphanScript = [IO.Path]::GetFullPath((Join-Path $fullRoot 'scripts\ftp-orphan-cleanup.ps1'))
  if (Test-Path -LiteralPath $ftpOrphanScript) {
    . $ftpOrphanScript
  }
  $script:LastFtpProbeResult = $null
  $script:LastFtpDryRunBackup = $null
  $script:LastFtpDryRunReport = $null
  $script:LastProductionPublishResult = $null
  $script:LastOrphanCleanupResult = $null
  # サーバー再起動で必ず false。スコープ付き武装APIでのみ true になる。
  $script:RealPublishApiArmed = $false
  $script:RealPublishArmScope = $null

  function Normalize-SmileRemoteRoot([string]$Root) {
    $r = ([string]$Root).Replace('\', '/').Trim()
    if (-not $r) { return '/' }
    return $r
  }

  function Normalize-SmileRemotePath([string]$Path) {
    $p = ([string]$Path).Replace('\', '/').Trim()
    if (-not $p) { return '' }
    if (-not $p.StartsWith('/')) { $p = '/' + $p }
    return $p
  }

  function Protect-SmileSecretText {
    param(
      [AllowNull()][string]$Text,
      [string]$Password = ''
    )
    if ($null -eq $Text) { return '' }
    $out = [string]$Text
    if ($Password) {
      try { $out = $out.Replace($Password, '********') } catch {}
    }
    # Mask PASS command values and common secret patterns
    $out = [regex]::Replace($out, '(?im)\bPASS\s+\S+', 'PASS ********')
    $out = [regex]::Replace($out, '(?im)("?(?:password|passwd|secret|token|authorization|api[_-]?key)"?\s*[:=]\s*)([^\s,"}]+)', '$1********')
    $out = [regex]::Replace($out, '(?im)\bAuthorization:\s*.+', 'Authorization: ********')
    if ($out.Length -gt 600) { $out = $out.Substring(0, 600) + '…' }
    return $out
  }

  function Protect-SmileFtpCommandList {
    param($Commands, [string]$Password = '')
    # Generic.List にして空でも ConvertTo-Json で [] になるようにする（@() は {} になり得る）
    $list = New-Object 'System.Collections.Generic.List[string]'
    foreach ($c in @($Commands)) {
      if ($null -eq $c) { continue }
      $list.Add((Protect-SmileSecretText -Text ([string]$c) -Password $Password))
    }
    return , $list.ToArray()
  }

  function New-SmileProductionPublishFailureResult {
    param(
      [string]$PublishId = '',
      [string]$ErrorCode = 'PRODUCTION_PUBLISH_EXCEPTION',
      [string]$UserMessage = '本番公開処理でエラーが発生しました',
      [string]$Detail = '',
      [string]$Stage = 'server-exception',
      [string]$ExceptionType = '',
      [string]$Password = '',
      $FtpCommands = @(),
      [bool]$RollbackAttempted = $false,
      [bool]$RollbackSucceeded = $false,
      [int]$WriteCommandCount = 0,
      [int]$ProductionUpdateCount = 0
    )
    $safeDetail = Protect-SmileSecretText -Text $Detail -Password $Password
    $safeCmds = Protect-SmileFtpCommandList -Commands $FtpCommands -Password $Password
    return [ordered]@{
      ok = $false
      result = 'FAILED'
      errorCode = $ErrorCode
      userMessage = $UserMessage
      detail = $safeDetail
      stage = $Stage
      exceptionType = $ExceptionType
      timestamp = (Get-Date).ToString('o')
      executedAt = (Get-Date).ToString('o')
      publishId = $PublishId
      writeCommandCount = $WriteCommandCount
      productionUpdateCount = $ProductionUpdateCount
      storCount = 0
      deleCount = 0
      commands = $safeCmds
      ftpCommands = $safeCmds
      progress = @('サーバー本番公開処理', $Stage)
      rollbackAttempted = $RollbackAttempted
      rollbackSucceeded = $RollbackSucceeded
      rollback = @{
        attempted = $RollbackAttempted
        succeeded = $RollbackSucceeded
      }
      realPublishStarted = $true
      safeMode = $false
      indexUploaded = $false
      uploadedImages = @()
    }
  }

  function Test-SmileFtpConfigReadyForPublish {
    param(
      [Parameter(Mandatory = $true)]$FtpConfig,
      $ArmScope = $null
    )
    $blockers = New-Object System.Collections.Generic.List[string]
    $errorCode = ''
    if (-not $FtpConfig -or -not [string]$FtpConfig.host -or -not [string]$FtpConfig.username) {
      return [pscustomobject]@{
        ok = $false
        errorCode = 'FTP_CONFIG_MISSING'
        blockers = @('保存済みFTP設定の host / username が不足しています')
      }
    }
    if (-not [string]$FtpConfig.password) {
      return [pscustomobject]@{
        ok = $false
        errorCode = 'FTP_PASSWORD_MISSING'
        blockers = @('保存済みFTP設定にパスワードがありません（値は表示しません）')
      }
    }
    $port = 21
    try { $port = [int]($(if ($FtpConfig.port) { $FtpConfig.port } else { 21 })) } catch { $port = 0 }
    if ($port -lt 1 -or $port -gt 65535) {
      $blockers.Add('FTPポートが不正です') | Out-Null
      $errorCode = 'FTP_CONFIG_MISSING'
    }
    $rootNorm = Normalize-SmileRemoteRoot ([string]$FtpConfig.remoteRoot)
    if (-not $rootNorm) {
      $blockers.Add('remoteRoot が不正です') | Out-Null
      $errorCode = 'FTP_CONFIG_MISSING'
    }
    if ($null -eq $FtpConfig.useTls) {
      $blockers.Add('TLS設定がありません') | Out-Null
      if (-not $errorCode) { $errorCode = 'FTP_CONFIG_MISSING' }
    }
    if ($ArmScope) {
      if ([string]$FtpConfig.host -ne [string]$ArmScope.host -or
          [string]$FtpConfig.username -ne [string]$ArmScope.username -or
          $rootNorm -ne (Normalize-SmileRemoteRoot ([string]$ArmScope.remoteRoot))) {
        return [pscustomobject]@{
          ok = $false
          errorCode = 'FTP_SCOPE_MISMATCH'
          blockers = @('再読込したFTP設定が武装スコープと一致しません')
        }
      }
    }
    if ($blockers.Count -gt 0) {
      return [pscustomobject]@{
        ok = $false
        errorCode = $(if ($errorCode) { $errorCode } else { 'FTP_CONFIG_MISSING' })
        blockers = @($blockers)
      }
    }
    return [pscustomobject]@{
      ok = $true
      errorCode = ''
      blockers = @()
      host = [string]$FtpConfig.host
      port = $port
      username = [string]$FtpConfig.username
      remoteRoot = $rootNorm
      useTls = [bool]$FtpConfig.useTls
      passwordPresent = $true
    }
  }

  function Get-SmileRealPublishArmPublicView {
    Clear-SmileRealPublishArmIfExpired | Out-Null
    $scope = $script:RealPublishArmScope
    return @{
      armed = [bool]$script:RealPublishApiArmed
      publishId = $(if ($scope) { [string]$scope.publishId } else { '' })
      host = $(if ($scope) { [string]$scope.host } else { '' })
      username = $(if ($scope) { [string]$scope.username } else { '' })
      remoteRoot = $(if ($scope) { [string]$scope.remoteRoot } else { '' })
      allowedRemotePaths = $(if ($scope) { @($scope.allowedRemotePaths) } else { @() })
      expiresAt = $(if ($scope) { [string]$scope.expiresAt } else { '' })
      armedAt = $(if ($scope) { [string]$scope.armedAt } else { '' })
      backupRelPath = $(if ($scope) { [string]$scope.backupRelPath } else { '' })
    }
  }

  function Clear-SmileRealPublishArmIfExpired {
    if (-not $script:RealPublishApiArmed -or -not $script:RealPublishArmScope) {
      return $false
    }
    $exp = $null
    try { $exp = [datetime]::Parse([string]$script:RealPublishArmScope.expiresAt) } catch { $exp = $null }
    if (-not $exp -or ([datetime]::Now -gt $exp)) {
      $script:RealPublishApiArmed = $false
      $script:RealPublishArmScope = $null
      return $true
    }
    return $false
  }

  function Test-SmileRealPublishArmScopeMatch {
    param(
      [Parameter(Mandatory = $true)]$Payload,
      [Parameter(Mandatory = $true)]$FtpConfig
    )
    $blockers = New-Object System.Collections.Generic.List[string]
    Clear-SmileRealPublishArmIfExpired | Out-Null
    if (-not $script:RealPublishApiArmed -or -not $script:RealPublishArmScope) {
      $blockers.Add('RealPublishApiArmed が false です') | Out-Null
      return [pscustomobject]@{ ok = $false; blockers = @($blockers) }
    }
    $scope = $script:RealPublishArmScope
    $publishId = [string]$Payload.publishId
    if ($publishId -ne [string]$scope.publishId) {
      $blockers.Add('武装スコープの publishId と一致しません') | Out-Null
    }
    $hostName = [string]$FtpConfig.host
    $userName = [string]$FtpConfig.username
    $rootNorm = Normalize-SmileRemoteRoot ([string]$FtpConfig.remoteRoot)
    if ($hostName -ne [string]$scope.host) { $blockers.Add('武装スコープの host と一致しません') | Out-Null }
    if ($userName -ne [string]$scope.username) { $blockers.Add('武装スコープの username と一致しません') | Out-Null }
    if ($rootNorm -ne (Normalize-SmileRemoteRoot ([string]$scope.remoteRoot))) {
      $blockers.Add('武装スコープの remoteRoot と一致しません') | Out-Null
    }
    $allowed = @($scope.allowedRemotePaths | ForEach-Object { Normalize-SmileRemotePath $_ })
    $files = @()
    if ($Payload.manifest -and $Payload.manifest.files) { $files = @($Payload.manifest.files) }
    if ($files.Count -eq 0) { $blockers.Add('manifest.files が空です') | Out-Null }
    if ($files.Count -ne $allowed.Count) {
      $blockers.Add('武装許可ファイル件数と一致しません') | Out-Null
    }
    foreach ($f in $files) {
      $rp = Normalize-SmileRemotePath ([string]$f.remotePath)
      if ($allowed -notcontains $rp) {
        $blockers.Add(('許可されていない remotePath: ' + $rp)) | Out-Null
      }
    }
    foreach ($a in $allowed) {
      $hit = $false
      foreach ($f in $files) {
        if ((Normalize-SmileRemotePath ([string]$f.remotePath)) -eq $a) { $hit = $true; break }
      }
      if (-not $hit) { $blockers.Add(('必須 remotePath が不足: ' + $a)) | Out-Null }
    }
    return [pscustomobject]@{ ok = ($blockers.Count -eq 0); blockers = @($blockers) }
  }

  function Test-SmileDiskDryRunReadyForArm {
    param(
      [Parameter(Mandatory = $true)][string]$WorkspaceRoot,
      [Parameter(Mandatory = $true)][string]$PublishId,
      [Parameter(Mandatory = $true)][string[]]$AllowedRemotePaths
    )
    $blockers = New-Object System.Collections.Generic.List[string]
    $bound = $null
    if (Get-Command Find-SmileFtpDryRunBundleByPublishId -ErrorAction SilentlyContinue) {
      try {
        $bound = Find-SmileFtpDryRunBundleByPublishId -WorkspaceRoot $WorkspaceRoot -PublishId $PublishId
      } catch { $bound = $null }
    }
    if (-not $bound -or -not $bound.report -or -not $bound.backup) {
      $blockers.Add('publishId に一致する最新 dry-run 成果物がありません') | Out-Null
      return [pscustomobject]@{ ok = $false; blockers = @($blockers); bound = $null }
    }
    $report = $bound.report
    $backup = $bound.backup
    $executedAt = $null
    try { $executedAt = [datetime]::Parse([string]$report.executedAt) } catch { $executedAt = $null }
    if (-not $executedAt -or (([datetime]::Now) - $executedAt).TotalHours -gt 24) {
      $blockers.Add('最新dry-runが24時間以内ではありません') | Out-Null
    }
    if ([string]$report.verdict -ne 'READY_FOR_PRODUCTION') {
      $blockers.Add('verdict が READY_FOR_PRODUCTION ではありません') | Out-Null
    }
    if ([string]$report.publishId -ne $PublishId) {
      $blockers.Add('dry-run publishId が一致しません') | Out-Null
    }
    if (-not [bool]$report.backupSha256Verified -and -not [bool]$backup.backupSha256Verified) {
      $blockers.Add('backupSha256Verified が true ではありません') | Out-Null
    }
    if (-not [bool]$report.simulationSuccess) {
      $blockers.Add('simulationSuccess が true ではありません') | Out-Null
    }
    if ($report.PSObject.Properties.Name -contains 'rollbackReady' -and -not [bool]$report.rollbackReady) {
      $blockers.Add('rollbackReady が true ではありません') | Out-Null
    }
    $wc = 0
    try { $wc = [int]$report.writeCommandCount } catch { $wc = [int]$backup.writeCommandCount }
    if ($wc -ne 0) { $blockers.Add('writeCommandCount が 0 ではありません') | Out-Null }
    $pu = 0
    try { $pu = [int]$report.productionUpdateCount } catch { $pu = 0 }
    if ($pu -ne 0) { $blockers.Add('productionUpdateCount が 0 ではありません') | Out-Null }
    $coll = @()
    if ($report.imageCollision -and $report.imageCollision.collidingImages) {
      $coll = @($report.imageCollision.collidingImages)
    } elseif ($backup.collidingImages) {
      $coll = @($backup.collidingImages)
    }
    if ($coll.Count -gt 0) { $blockers.Add('同名画像衝突があります') | Out-Null }

    $paths = @()
    if ($report.remoteFullPaths) {
      foreach ($p in @($report.remoteFullPaths)) {
        $rp = Normalize-SmileRemotePath ($(if ($p.remoteFullPath) { $p.remoteFullPath } elseif ($p.remotePath) { $p.remotePath } else { '' }))
        if ($rp) { $paths += $rp }
      }
    }
    if ($paths.Count -eq 0 -and $report.plannedFiles) {
      foreach ($p in @($report.plannedFiles)) {
        $rp = Normalize-SmileRemotePath ([string]$p.remotePath)
        if ($rp) { $paths += $rp }
      }
    }
    $allowedNorm = @($AllowedRemotePaths | ForEach-Object { Normalize-SmileRemotePath $_ })
    foreach ($rp in $paths) {
      if ($allowedNorm -notcontains $rp) {
        $blockers.Add(('不正パス: ' + $rp)) | Out-Null
      }
    }
    foreach ($a in $allowedNorm) {
      if ($paths -notcontains $a) { $blockers.Add(('必須パス不足: ' + $a)) | Out-Null }
    }

    $bakRel = [string]$bound.backupRelPath
    if (-not $bakRel) { $bakRel = [string]$backup.backupRelPath }
    if (-not $bakRel) { $bakRel = [string]$report.productionBackupLocation }
    $indexRel = ($bakRel.TrimEnd('/') + '/remote/diary/index.htm') -replace '\\', '/'
    $indexAbs = [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot ($indexRel.Replace('/', [IO.Path]::DirectorySeparatorChar))))
    if (-not (Test-Path -LiteralPath $indexAbs)) {
      $blockers.Add('本番バックアップ index.htm がありません') | Out-Null
    }

    if ($PublishId -and (Get-Command Test-SmilePublishLock -ErrorAction SilentlyContinue)) {
      try {
        $st = Test-SmilePublishLock -Root $WorkspaceRoot -PublishId $PublishId
        if ($st -and [bool]$st.inProgress -and -not [bool]$st.stale) {
          $blockers.Add('公開ロック中です') | Out-Null
        }
      } catch { }
    }

    return [pscustomobject]@{
      ok = ($blockers.Count -eq 0)
      blockers = @($blockers)
      bound = $bound
      backupRelPath = $bakRel
      report = $report
    }
  }

  function Get-SmileOptionalProperty {
    param(
      [Parameter(Mandatory = $false)]$Object,
      [Parameter(Mandatory = $true)][string]$Name,
      $DefaultValue = $null
    )
    if ($null -eq $Object) { return $DefaultValue }
    try {
      $property = $Object.PSObject.Properties[$Name]
      if ($null -eq $property) { return $DefaultValue }
      return $property.Value
    } catch {
      return $DefaultValue
    }
  }

  function Get-SmileNormalizedSha256([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    $s = $Value.Trim().ToLowerInvariant()
    if ($s -notmatch '^[0-9a-f]{64}$') { return '' }
    return $s
  }

  function Add-SmileShaCandidate {
    param(
      [System.Collections.Generic.List[string]]$List,
      [string]$Value
    )
    $n = Get-SmileNormalizedSha256 $Value
    if ($n) { $List.Add($n) | Out-Null }
  }

  <#
    productionChangedAfterDryRun を false / true / unknown で解決する。
    FTP再取得は行わない。レポート・payload・ローカルbackup/verification のみ使用。
  #>
  function Resolve-SmileProductionChangedAfterDryRun {
    param(
      $Report = $null,
      $Payload = $null,
      [string]$WorkspaceRoot = '',
      [string]$BackupRelPath = ''
    )

    if ($null -eq $Report -and $null -eq $Payload) {
      return [pscustomobject]@{
        state = 'unknown'
        reason = 'report-and-payload-missing'
        message = '本番変更の確認に必要な情報が不足しています。再度予行演習を行ってください。'
        shaCount = 0
        uniqueShaCount = 0
      }
    }

    # 1) 明示プロパティ（report / verification / payload 直下）
    $explicitCandidates = @(
      (Get-SmileOptionalProperty -Object $Report -Name 'productionChangedAfterDryRun'),
      (Get-SmileOptionalProperty -Object (Get-SmileOptionalProperty -Object $Report -Name 'verification') -Name 'productionChangedAfterDryRun'),
      (Get-SmileOptionalProperty -Object $Payload -Name 'productionChangedAfterDryRun'),
      (Get-SmileOptionalProperty -Object (Get-SmileOptionalProperty -Object $Payload -Name 'verification') -Name 'productionChangedAfterDryRun')
    )
    foreach ($ex in $explicitCandidates) {
      if ($null -eq $ex) { continue }
      if ($ex -is [bool]) {
        return [pscustomobject]@{
          state = $(if ($ex) { 'true' } else { 'false' })
          reason = 'explicit-property'
          message = $(if ($ex) {
              '予行演習後に本番index.htmが変更されています。公開を中止しました。'
            } else {
              '予行演習後の本番変更：なし（SHA-256再確認済み）'
            })
          shaCount = 0
          uniqueShaCount = 0
        }
      }
      $exStr = ([string]$ex).Trim().ToLowerInvariant()
      if ($exStr -eq 'true' -or $exStr -eq '1' -or $exStr -eq 'yes') {
        return [pscustomobject]@{
          state = 'true'
          reason = 'explicit-property-string'
          message = '予行演習後に本番index.htmが変更されています。公開を中止しました。'
          shaCount = 0
          uniqueShaCount = 0
        }
      }
      if ($exStr -eq 'false' -or $exStr -eq '0' -or $exStr -eq 'no') {
        return [pscustomobject]@{
          state = 'false'
          reason = 'explicit-property-string'
          message = '予行演習後の本番変更：なし（SHA-256再確認済み）'
          shaCount = 0
          uniqueShaCount = 0
        }
      }
      if ($exStr -eq 'unknown') {
        return [pscustomobject]@{
          state = 'unknown'
          reason = 'explicit-unknown'
          message = '本番変更の確認に必要な情報が不足しています。再度予行演習を行ってください。'
          shaCount = 0
          uniqueShaCount = 0
        }
      }
    }

    # 2) プロパティなし → 実体SHAから再判定（FTPなし）
    $shaList = New-Object 'System.Collections.Generic.List[string]'
    $prodIndex = Get-SmileOptionalProperty -Object $Report -Name 'productionIndex'
    Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $Report -Name 'productionBackupSha256'))
    Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $Report -Name 'retrievedSha256'))
    Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $Report -Name 'backupFileSha256'))
    Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $Report -Name 'productionIndexSha256'))
    Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $prodIndex -Name 'sha256'))
    Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $prodIndex -Name 'retrievedSha256'))
    Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $prodIndex -Name 'backupFileSha256'))

    $ver = Get-SmileOptionalProperty -Object $Report -Name 'verification'
    if (-not $ver -and $Payload) { $ver = Get-SmileOptionalProperty -Object $Payload -Name 'verification' }
    Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $ver -Name 'productionIndexSha256'))

    Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $Payload -Name 'expectedProductionIndexSha256'))

    $bakRel = $BackupRelPath
    if (-not $bakRel) {
      $bakRel = [string](Get-SmileOptionalProperty -Object $Report -Name 'productionBackupLocation')
    }
    if (-not $bakRel -and $Payload) {
      $bakRel = [string](Get-SmileOptionalProperty -Object $Payload -Name 'backupRelPath')
    }
    if ($WorkspaceRoot -and $bakRel) {
      $manifestAbs = [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot (($bakRel.TrimEnd('/','\') + '/production-backup-manifest.json').Replace('/', [IO.Path]::DirectorySeparatorChar))))
      $verifyAbs = [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot (($bakRel.TrimEnd('/','\') + '/verification-report.json').Replace('/', [IO.Path]::DirectorySeparatorChar))))
      if (Test-Path -LiteralPath $manifestAbs) {
        try {
          $bm = Get-Content -LiteralPath $manifestAbs -Raw -Encoding UTF8 | ConvertFrom-Json
          $bmPi = Get-SmileOptionalProperty -Object $bm -Name 'productionIndex'
          Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $bmPi -Name 'sha256'))
          Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $bmPi -Name 'retrievedSha256'))
          Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $bmPi -Name 'backupFileSha256'))
          Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $bm -Name 'productionIndexSha256'))
        } catch { }
      }
      if (Test-Path -LiteralPath $verifyAbs) {
        try {
          $vr = Get-Content -LiteralPath $verifyAbs -Raw -Encoding UTF8 | ConvertFrom-Json
          Add-SmileShaCandidate $shaList ([string](Get-SmileOptionalProperty -Object $vr -Name 'productionIndexSha256'))
        } catch { }
      }
    }

    $unique = @($shaList | Select-Object -Unique)
    if ($unique.Count -eq 0) {
      return [pscustomobject]@{
        state = 'unknown'
        reason = 'sha-missing'
        message = '本番変更の確認に必要な情報が不足しています。再度予行演習を行ってください。'
        shaCount = 0
        uniqueShaCount = 0
      }
    }
    if ($unique.Count -eq 1) {
      return [pscustomobject]@{
        state = 'false'
        reason = 'sha-match'
        message = '予行演習後の本番変更：なし（SHA-256再確認済み）'
        shaCount = $shaList.Count
        uniqueShaCount = 1
      }
    }
    return [pscustomobject]@{
      state = 'true'
      reason = 'sha-mismatch'
      message = '予行演習後に本番index.htmが変更されています。公開を中止しました。'
      shaCount = $shaList.Count
      uniqueShaCount = $unique.Count
    }
  }

  function Test-SmileRealPublishUnlockRequest {
    param(
      [Parameter(Mandatory = $true)]$Payload,
      [Parameter(Mandatory = $true)]$FtpConfig,
      [Parameter(Mandatory = $true)][string]$WorkspaceRoot
    )
    $blockers = New-Object System.Collections.Generic.List[string]
    $unlock = Get-SmileOptionalProperty -Object $Payload -Name 'realPublishUnlock'
    if (-not $unlock -or -not [bool](Get-SmileOptionalProperty -Object $unlock -Name 'explicitUnlockRequest' -DefaultValue $false)) {
      $blockers.Add('明示的な実公開解除要求がありません') | Out-Null
    }
    $publishId = [string](Get-SmileOptionalProperty -Object $Payload -Name 'publishId' -DefaultValue '')
    if (-not $publishId) { $blockers.Add('publishId がありません') | Out-Null }
    if ($unlock -and $publishId -and [string](Get-SmileOptionalProperty -Object $unlock -Name 'publishId') -ne $publishId) {
      $blockers.Add('解除publishIdが一致しません') | Out-Null
    }
    $hostName = [string]$FtpConfig.host
    $userName = [string]$FtpConfig.username
    $rootNorm = ([string]$FtpConfig.remoteRoot).Replace('\', '/').Trim()
    if (-not $rootNorm) { $rootNorm = '/' }
    if ($unlock) {
      if ([string](Get-SmileOptionalProperty -Object $unlock -Name 'host') -ne $hostName) { $blockers.Add('解除hostが一致しません') | Out-Null }
      if ([string](Get-SmileOptionalProperty -Object $unlock -Name 'username') -ne $userName) { $blockers.Add('解除usernameが一致しません') | Out-Null }
      $uRoot = ([string](Get-SmileOptionalProperty -Object $unlock -Name 'remoteRoot')).Replace('\', '/').Trim()
      if (-not $uRoot) { $uRoot = '/' }
      if ($uRoot -ne $rootNorm) { $blockers.Add('解除remoteRootが一致しません') | Out-Null }
      $expiresAt = $null
      try { $expiresAt = [datetime]::Parse([string](Get-SmileOptionalProperty -Object $unlock -Name 'expiresAt')) } catch { $expiresAt = $null }
      if (-not $expiresAt -or ([datetime]::Now -gt $expiresAt)) {
        $blockers.Add('解除の有効期限切れ、またはexpiresAt不正です') | Out-Null
      }
      if (-not [bool](Get-SmileOptionalProperty -Object $unlock -Name 'checksConfirmed' -DefaultValue $false) -or
          -not [bool](Get-SmileOptionalProperty -Object $unlock -Name 'phraseConfirmed' -DefaultValue $false)) {
        $blockers.Add('解除確認フラグが不足しています') | Out-Null
      }
    }
    if (-not (Get-SmileOptionalProperty -Object $Payload -Name 'manifestHash') -and -not (Get-SmileOptionalProperty -Object $Payload -Name 'manifest')) {
      $blockers.Add('manifestハッシュ/本体がありません') | Out-Null
    }
    if (-not (Get-SmileOptionalProperty -Object $Payload -Name 'dryRunReportHash') -and -not (Get-SmileOptionalProperty -Object $Payload -Name 'dryRunReport')) {
      $blockers.Add('dry-run-reportハッシュ/本体がありません') | Out-Null
    }
    $report = Get-SmileOptionalProperty -Object $Payload -Name 'dryRunReport'
    $changedInfo = $null
    if ($report) {
      if ([string](Get-SmileOptionalProperty -Object $report -Name 'verdict' -DefaultValue '') -ne 'READY_FOR_PRODUCTION') {
        $blockers.Add('READY_FOR_PRODUCTION ではありません') | Out-Null
      }
      if (-not [bool](Get-SmileOptionalProperty -Object $report -Name 'backupSha256Verified' -DefaultValue $false)) {
        $blockers.Add('backupSha256Verified が true ではありません') | Out-Null
      }
      if (-not [bool](Get-SmileOptionalProperty -Object $report -Name 'simulationSuccess' -DefaultValue $false)) {
        $blockers.Add('simulationSuccess が true ではありません') | Out-Null
      }
      $rollbackReadyProp = Get-SmileOptionalProperty -Object $report -Name 'rollbackReady'
      if ($null -ne $rollbackReadyProp -and -not [bool]$rollbackReadyProp) {
        $blockers.Add('rollbackReady が true ではありません') | Out-Null
      }

      $changedInfo = Resolve-SmileProductionChangedAfterDryRun `
        -Report $report `
        -Payload $Payload `
        -WorkspaceRoot $WorkspaceRoot `
        -BackupRelPath ([string](Get-SmileOptionalProperty -Object $Payload -Name 'backupRelPath' -DefaultValue ''))
      if ($changedInfo.state -eq 'true') {
        $blockers.Add([string]$changedInfo.message) | Out-Null
      } elseif ($changedInfo.state -eq 'unknown') {
        $blockers.Add([string]$changedInfo.message) | Out-Null
      }
    } else {
      $blockers.Add('dry-run-report がありません') | Out-Null
      $changedInfo = Resolve-SmileProductionChangedAfterDryRun -Report $null -Payload $Payload -WorkspaceRoot $WorkspaceRoot
      if ($changedInfo.state -ne 'false') {
        # report欠落時は unknown 扱いで二重にならないよう、report無しblockerのみでも足りるが明示する
        if ($blockers -notcontains [string]$changedInfo.message -and $changedInfo.state -eq 'unknown') {
          # already have dry-run-report missing
        }
      }
    }
    if ($publishId -and (Get-Command Test-SmilePublishLock -ErrorAction SilentlyContinue)) {
      try {
        $st = Test-SmilePublishLock -Root $WorkspaceRoot -PublishId $publishId
        if ($st -and [bool]$st.inProgress -and -not [bool]$st.stale) {
          $blockers.Add('公開ロック中です') | Out-Null
        }
      } catch { }
    }
    return [pscustomobject]@{
      ok = ($blockers.Count -eq 0)
      blockers = @($blockers)
      productionChangedAfterDryRun = $(if ($changedInfo) { [string]$changedInfo.state } else { 'unknown' })
      productionChangedDetail = $changedInfo
    }
  }

  try {
    while ($listener.IsListening) {
      try { $ctx = $listener.GetContext() } catch { break }
      $req = $ctx.Request
      $res = $ctx.Response
      try {
        $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)

        if ($req.HttpMethod -eq 'OPTIONS') {
          Send-Bytes $res 204 ([byte[]]@()) 'text/plain'
          continue
        }

        # FTP config (masked) — secrets never logged
        if ($path -eq '/api/ftp-config' -and $req.HttpMethod -eq 'GET') {
          try {
            $cfg = Read-SmileFtpConfig -Root $fullRoot
            Send-Json $res 200 @{ ok = $true; config = (Get-SmileFtpConfigPublicView $cfg) }
          } catch {
            Send-Json $res 500 @{ ok = $false; error = 'FTP設定の読込に失敗しました' }
          }
          continue
        }

        if ($path -eq '/api/ftp-config' -and $req.HttpMethod -eq 'POST') {
          try {
            $raw = Read-BodyBytes $req
            $payload = ([Text.Encoding]::UTF8.GetString($raw) | ConvertFrom-Json)
            $existing = Read-SmileFtpConfig -Root $fullRoot
            $newPass = [string]$payload.password
            if ([string]::IsNullOrEmpty($newPass) -or $newPass -eq '********') {
              if ($existing -and $existing.password) { $newPass = [string]$existing.password }
              else { $newPass = '' }
            }
            $hostName = ([string]$payload.host).Trim()
            if (-not $hostName) {
              Send-Json $res 400 @{ ok = $false; error = 'ホスト名が必要です' }
              continue
            }
            if ($hostName -match '(?i)password|secret|token') {
              Send-Json $res 400 @{ ok = $false; error = 'ホスト名が不正です' }
              continue
            }
            $cfgObj = [ordered]@{
              host = $hostName
              port = [int]($(if ($payload.port) { $payload.port } else { 21 }))
              username = ([string]$payload.username).Trim()
              password = $newPass
              remoteRoot = ([string]($(if ($payload.remoteRoot) { $payload.remoteRoot } else { '/' }))).Trim()
              useTls = [bool]($(if ($null -ne $payload.useTls) { $payload.useTls } else { $true }))
              passive = $true
              timeoutMs = [int]($(if ($payload.timeoutMs) { $payload.timeoutMs } else { 25000 }))
              updatedAt = (Get-Date).ToString('o')
            }
            $null = Write-SmileFtpConfig -Root $fullRoot -Config $cfgObj
            # パスワードをレスポンス・ログに出さない
            Send-Json $res 200 @{ ok = $true; config = (Get-SmileFtpConfigPublicView $cfgObj) }
          } catch {
            Send-Json $res 500 @{ ok = $false; error = 'FTP設定の保存に失敗しました' }
          }
          continue
        }

        if ($path -eq '/api/ftp-probe-last' -and $req.HttpMethod -eq 'GET') {
          Send-Json $res 200 @{
            ok = $true
            result = $script:LastFtpProbeResult
            writeExecuted = $false
            deleteExecuted = $false
            uploadExecuted = $false
          }
          continue
        }

        # Read-only FTP probe (LIST/PWD/CWD/SIZE/MDTM only for file ops)
        if ($path -eq '/api/ftp-probe' -and $req.HttpMethod -eq 'POST') {
          try {
            if (-not (Get-Command Invoke-SmileFtpReadonlyProbe -ErrorAction SilentlyContinue)) {
              Send-Json $res 500 @{ ok = $false; error = 'FTPプローブモジュールがありません' }
              continue
            }
            $cfg = Read-SmileFtpConfig -Root $fullRoot
            if (-not $cfg -or -not $cfg.host -or -not $cfg.username -or -not $cfg.password) {
              Send-Json $res 400 @{
                ok = $false
                category = 'その他'
                userMessage = 'FTP情報が未設定です。公開管理の設定から保存してください。'
              }
              continue
            }
            $probe = Invoke-SmileFtpReadonlyProbe `
              -HostName ([string]$cfg.host) `
              -Port ([int]($(if ($cfg.port) { $cfg.port } else { 21 }))) `
              -Username ([string]$cfg.username) `
              -Password ([string]$cfg.password) `
              -RemoteRoot ([string]($(if ($cfg.remoteRoot) { $cfg.remoteRoot } else { '/' }))) `
              -UseTls ([bool]($(if ($null -ne $cfg.useTls) { $cfg.useTls } else { $true }))) `
              -Passive $true `
              -TimeoutMs ([int]($(if ($cfg.timeoutMs) { $cfg.timeoutMs } else { 25000 })))

            # 最終結果からパスワードが混入していないことを保証
            $safe = [ordered]@{}
            foreach ($p in $probe.PSObject.Properties) {
              if ($p.Name -eq 'password') { $safe[$p.Name] = '********'; continue }
              $val = $p.Value
              if ($val -is [string] -and $cfg.password -and $val.Contains([string]$cfg.password)) {
                $val = $val.Replace([string]$cfg.password, '********')
              }
              $safe[$p.Name] = $val
            }
            $safe['writeExecuted'] = $false
            $safe['deleteExecuted'] = $false
            $safe['uploadExecuted'] = $false
            $safe['renameExecuted'] = $false
            $safe['mkdirExecuted'] = $false
            $safe['readOnly'] = $true
            $script:LastFtpProbeResult = [pscustomobject]$safe
            $code = if ($probe.ok) { 200 } else { 200 }
            Send-Json $res $code $script:LastFtpProbeResult
          } catch {
            Send-Json $res 500 @{
              ok = $false
              category = 'その他'
              userMessage = 'FTP接続確認中にエラーが発生しました'
              writeExecuted = $false
              deleteExecuted = $false
              uploadExecuted = $false
            }
          }
          continue
        }

        # Production backup + dry-run fetch (RETR/LIST only — never STOR/DELE/MKD)
        if ($path -eq '/api/ftp-production-dry-run' -and $req.HttpMethod -eq 'POST') {
          try {
            if (-not (Get-Command Invoke-SmileFtpProductionBackup -ErrorAction SilentlyContinue)) {
              Send-Json $res 500 @{ ok = $false; userMessage = '本番バックアップモジュールがありません' }
              continue
            }
            $cfg = Read-SmileFtpConfig -Root $fullRoot
            if (-not $cfg -or -not $cfg.host -or -not $cfg.username -or -not $cfg.password) {
              Send-Json $res 400 @{ ok = $false; verdict = 'BLOCKED'; userMessage = 'FTP情報が未設定です' }
              continue
            }
            $raw = Read-BodyBytes $req
            $payload = ([Text.Encoding]::UTF8.GetString($raw) | ConvertFrom-Json)
            $publishId = [string]$payload.publishId
            if (-not $publishId) { $publishId = ('pub-' + (Get-Date -Format 'yyyyMMddHHmmss')) }
            $images = @()
            if ($payload.plannedImageNames) { $images = @($payload.plannedImageNames) }
            foreach ($img in $images) {
              if ($img -notmatch '^\d{6}-\d+b?\.jpg$') {
                Send-Json $res 400 @{
                  ok = $false
                  verdict = 'BLOCKED'
                  userMessage = '不正な画像ファイル名です'
                }
                continue 2
              }
            }
            $bak = Invoke-SmileFtpProductionBackup `
              -WorkspaceRoot $fullRoot `
              -FtpConfig $cfg `
              -PublishId $publishId `
              -PlannedImageNames $images

            $safe = [ordered]@{}
            foreach ($p in $bak.PSObject.Properties) {
              if ($p.Name -eq 'password') { $safe[$p.Name] = '********'; continue }
              $val = $p.Value
              if ($val -is [string] -and $cfg.password -and $val.Contains([string]$cfg.password)) {
                $val = $val.Replace([string]$cfg.password, '********')
              }
              $safe[$p.Name] = $val
            }
            $safe['readOnly'] = $true
            $safe['productionUpdateCount'] = 0
            $script:LastFtpDryRunBackup = [pscustomobject]$safe
            Send-Json $res 200 $script:LastFtpDryRunBackup
          } catch {
            $safeDetail = [string]$_.Exception.Message
            if ($cfg -and $cfg.password) {
              $safeDetail = $safeDetail.Replace([string]$cfg.password, '********')
            }
            if ($safeDetail.Length -gt 220) { $safeDetail = $safeDetail.Substring(0, 220) }
            Send-Json $res 500 @{
              ok = $false
              verdict = 'BLOCKED'
              userMessage = '本番バックアップ中にエラーが発生しました'
              detail = $safeDetail
              writeCommandCount = 0
              productionUpdateCount = 0
            }
          }
          continue
        }

        if ($path -eq '/api/ftp-production-dry-run-report' -and $req.HttpMethod -eq 'POST') {
          try {
            $raw = Read-BodyBytes $req
            $payload = ([Text.Encoding]::UTF8.GetString($raw) | ConvertFrom-Json)
            $rel = [string]$payload.backupRelPath
            if (-not $rel -or $rel -notmatch '^production-backups/[A-Za-z0-9_\-]+$') {
              Send-Json $res 400 @{ ok = $false; error = 'backupRelPath が不正です' }
              continue
            }
            $dir = [IO.Path]::GetFullPath((Join-Path $fullRoot ($rel.Replace('/', [IO.Path]::DirectorySeparatorChar))))
            $allowedBak = [IO.Path]::GetFullPath((Join-Path $fullRoot 'production-backups'))
            if (-not $dir.StartsWith($allowedBak, [StringComparison]::OrdinalIgnoreCase)) {
              Send-Json $res 403 @{ ok = $false; error = 'バックアップパスが不正です' }
              continue
            }
            if (-not (Test-Path -LiteralPath $dir)) {
              Send-Json $res 404 @{ ok = $false; error = 'バックアップフォルダがありません' }
              continue
            }
            # Strip secrets from report body
            $reportObj = $payload.report
            $json = ($reportObj | ConvertTo-Json -Depth 14 -Compress:$false)
            if ($json -match '(?i)password\s*[:=]') {
              Send-Json $res 400 @{ ok = $false; error = 'レポートに秘密情報らしき記述があります' }
              continue
            }
            $reportPath = Join-Path $dir 'production-dry-run-report.json'
            $verifyPath = Join-Path $dir 'verification-report.json'
            [IO.File]::WriteAllText($reportPath, $json, [Text.UTF8Encoding]::new($false))
            if ($payload.verificationReport) {
              $vj = ($payload.verificationReport | ConvertTo-Json -Depth 12)
              [IO.File]::WriteAllText($verifyPath, $vj, [Text.UTF8Encoding]::new($false))
            }
            $script:LastFtpDryRunReport = @{
              ok = $true
              publishId = [string]$reportObj.publishId
              backupRelPath = $rel
              reportRelPath = ($rel + '/production-dry-run-report.json')
              verdict = [string]$reportObj.verdict
              writeCommandCount = [int]$reportObj.writeCommandCount
              productionUpdateCount = 0
              backupSha256Verified = [bool]$reportObj.backupSha256Verified
              simulationSuccess = [bool]$reportObj.simulationSuccess
            }
            # Keep in-memory pointer aligned to same publishId
            if ($script:LastFtpDryRunBackup -and
                [string]$script:LastFtpDryRunBackup.publishId -ne [string]$reportObj.publishId) {
              # Prefer the backup folder tied to this report
              if (Get-Command Find-SmileFtpDryRunBundleByPublishId -ErrorAction SilentlyContinue) {
                $bound = Find-SmileFtpDryRunBundleByPublishId -WorkspaceRoot $fullRoot -PublishId ([string]$reportObj.publishId)
                if ($bound -and $bound.backup) { $script:LastFtpDryRunBackup = $bound.backup }
              }
            }
            Send-Json $res 200 $script:LastFtpDryRunReport
          } catch {
            Send-Json $res 500 @{ ok = $false; error = 'レポート保存に失敗しました' }
          }
          continue
        }

        if ($path -eq '/api/ftp-dry-run-last' -and $req.HttpMethod -eq 'GET') {
          $qPublishId = ''
          try {
            if ($req.QueryString) { $qPublishId = [string]$req.QueryString['publishId'] }
          } catch { $qPublishId = '' }
          if (-not $qPublishId) { $qPublishId = '' }
          $qPublishId = $qPublishId.Trim()

          if ($qPublishId -and (Get-Command Find-SmileFtpDryRunBundleByPublishId -ErrorAction SilentlyContinue)) {
            $bound = $null
            try {
              $bound = Find-SmileFtpDryRunBundleByPublishId -WorkspaceRoot $fullRoot -PublishId $qPublishId
            } catch {
              $bound = $null
            }
            if ($bound) {
              $script:LastFtpDryRunBackup = $bound.backup
              $script:LastFtpDryRunReport = @{
                ok = $true
                publishId = $bound.publishId
                backupRelPath = $bound.backupRelPath
                reportRelPath = $bound.reportRelPath
                verdict = $(if ($bound.report -and $bound.report.verdict) { [string]$bound.report.verdict } else { '' })
                writeCommandCount = $(if ($bound.report) { [int]$bound.report.writeCommandCount } else { [int]$bound.backup.writeCommandCount })
                productionUpdateCount = 0
                backupSha256Verified = [bool]$bound.backup.backupSha256Verified
                simulationSuccess = [bool]($(if ($bound.report) { $bound.report.simulationSuccess } else { $false }))
                report = $bound.report
                verificationReport = $bound.verificationReport
                createdAt = $bound.createdAt
                folderLastWriteTime = $bound.folderLastWriteTime
              }
              Send-Json $res 200 @{
                ok = $true
                publishId = $bound.publishId
                backup = $bound.backup
                report = $script:LastFtpDryRunReport
                boundByPublishId = $true
              }
              continue
            }
            Send-Json $res 200 @{
              ok = $false
              publishId = $qPublishId
              userMessage = ('publishId に一致する本番バックアップ/予行演習結果がありません: ' + $qPublishId)
              boundByPublishId = $true
            }
            continue
          }

          Send-Json $res 200 @{
            ok = $true
            publishId = $(if ($script:LastFtpDryRunReport) { [string]$script:LastFtpDryRunReport.publishId } elseif ($script:LastFtpDryRunBackup) { [string]$script:LastFtpDryRunBackup.publishId } else { '' })
            backup = $script:LastFtpDryRunBackup
            report = $script:LastFtpDryRunReport
            boundByPublishId = $false
          }
          continue
        }

        if ($path -eq '/api/real-publish-arm-status' -and $req.HttpMethod -eq 'GET') {
          Send-Json $res 200 @{
            ok = $true
            status = (Get-SmileRealPublishArmPublicView)
          }
          continue
        }

        if ($path -eq '/api/real-publish-disarm' -and $req.HttpMethod -eq 'POST') {
          $script:RealPublishApiArmed = $false
          $script:RealPublishArmScope = $null
          Send-Json $res 200 @{
            ok = $true
            status = (Get-SmileRealPublishArmPublicView)
            userMessage = '実公開API武装を解除しました'
          }
          continue
        }

        # Scoped real-publish API arm (memory only; resets on server restart). Never logs password.
        if ($path -eq '/api/real-publish-arm' -and $req.HttpMethod -eq 'POST') {
          try {
            $cfg = Read-SmileFtpConfig -Root $fullRoot
            if (-not $cfg -or -not $cfg.host -or -not $cfg.username) {
              Send-Json $res 400 @{ ok = $false; userMessage = 'FTP情報が未設定です' }
              continue
            }
            $raw = Read-BodyBytes $req
            $payload = ([Text.Encoding]::UTF8.GetString($raw) | ConvertFrom-Json)
            if (-not [bool]$payload.explicitArmRequest) {
              Send-Json $res 400 @{ ok = $false; userMessage = '明示的な武装要求が必要です' }
              continue
            }
            $publishId = [string]$payload.publishId
            $hostName = [string]$payload.host
            $userName = [string]$payload.username
            $rootNorm = Normalize-SmileRemoteRoot ([string]$payload.remoteRoot)
            $cfgRoot = Normalize-SmileRemoteRoot ([string]$cfg.remoteRoot)
            $allowed = @()
            if ($payload.allowedRemotePaths) {
              $allowed = @($payload.allowedRemotePaths | ForEach-Object { Normalize-SmileRemotePath ([string]$_) })
            }
            $blockers = New-Object System.Collections.Generic.List[string]
            if (-not $publishId) { $blockers.Add('publishId がありません') | Out-Null }
            if ($hostName -ne [string]$cfg.host) { $blockers.Add('host が保存済みFTP設定と一致しません') | Out-Null }
            if ($userName -ne [string]$cfg.username) { $blockers.Add('username が保存済みFTP設定と一致しません') | Out-Null }
            if ($rootNorm -ne $cfgRoot) { $blockers.Add('remoteRoot が保存済みFTP設定と一致しません') | Out-Null }

            # Fixed single-article scope for this arming operation
            $fixedId = 'pub-20260721-210012-h9t3wt'
            $fixedHost = 'sv301.xserver.jp'
            $fixedUser = 'smileai@egaonokiroku.co.jp'
            $fixedRoot = '/'
            $fixedPaths = @(
              '/diary/index.htm',
              '/diary/image/260721-2.jpg',
              '/diary/image/260721-2b.jpg'
            )
            if ($publishId -ne $fixedId) { $blockers.Add('このフェーズで武装できる publishId ではありません') | Out-Null }
            if ($hostName -ne $fixedHost) { $blockers.Add('このフェーズで武装できる host ではありません') | Out-Null }
            if ($userName -ne $fixedUser) { $blockers.Add('このフェーズで武装できる username ではありません') | Out-Null }
            if ($rootNorm -ne $fixedRoot) { $blockers.Add('このフェーズで武装できる remoteRoot ではありません') | Out-Null }
            if ($allowed.Count -ne $fixedPaths.Count) {
              $blockers.Add('allowedRemotePaths の件数が不正です') | Out-Null
            }
            foreach ($p in $allowed) {
              if ($fixedPaths -notcontains $p) { $blockers.Add(('許可されていないパス: ' + $p)) | Out-Null }
            }
            foreach ($p in $fixedPaths) {
              if ($allowed -notcontains $p) { $blockers.Add(('必須パス不足: ' + $p)) | Out-Null }
            }

            $sessionExp = $null
            try { $sessionExp = [datetime]::Parse([string]$payload.sessionUnlockExpiresAt) } catch { $sessionExp = $null }
            if (-not $sessionExp) {
              $blockers.Add('ブラウザ解除期限 (sessionUnlockExpiresAt) が不正です') | Out-Null
            } elseif ([datetime]::Now -gt $sessionExp) {
              $blockers.Add('ブラウザ解除期限を過ぎています') | Out-Null
            }

            $disk = $null
            if ($blockers.Count -eq 0) {
              $disk = Test-SmileDiskDryRunReadyForArm `
                -WorkspaceRoot $fullRoot `
                -PublishId $publishId `
                -AllowedRemotePaths $fixedPaths
              if (-not $disk.ok) {
                foreach ($b in @($disk.blockers)) { $blockers.Add([string]$b) | Out-Null }
              }
            }

            if ($disk -and $disk.report -and $disk.report.ftpConnection) {
              $fc = $disk.report.ftpConnection
              if ([string]$fc.host -and [string]$fc.host -ne $hostName) {
                $blockers.Add('dry-run host が一致しません') | Out-Null
              }
              if ([string]$fc.username -and [string]$fc.username -ne $userName) {
                $blockers.Add('dry-run username が一致しません') | Out-Null
              }
              $fcRoot = Normalize-SmileRemoteRoot ([string]$fc.remoteRoot)
              if ($fcRoot -ne $rootNorm) {
                $blockers.Add('dry-run remoteRoot が一致しません') | Out-Null
              }
            }

            if ($blockers.Count -gt 0) {
              $script:RealPublishApiArmed = $false
              $script:RealPublishArmScope = $null
              Send-Json $res 403 @{
                ok = $false
                armed = $false
                userMessage = '実公開API武装条件を満たしていません'
                blockers = @($blockers)
                status = (Get-SmileRealPublishArmPublicView)
              }
              continue
            }

            # Server expiry must be within browser unlock expiry (never later)
            $serverExpiresAt = $sessionExp
            $script:RealPublishApiArmed = $true
            $script:RealPublishArmScope = [ordered]@{
              publishId = $publishId
              host = $hostName
              username = $userName
              remoteRoot = $rootNorm
              allowedRemotePaths = $fixedPaths
              expiresAt = $serverExpiresAt.ToString('o')
              armedAt = (Get-Date).ToString('o')
              backupRelPath = [string]$disk.backupRelPath
            }
            Send-Json $res 200 @{
              ok = $true
              armed = $true
              userMessage = '実公開APIをスコープ付きで武装しました（本番公開はまだ実行していません）'
              status = (Get-SmileRealPublishArmPublicView)
              note = 'パスワードは保存・応答していません。サーバー再起動で武装は解除されます。'
            }
          } catch {
            $script:RealPublishApiArmed = $false
            $script:RealPublishArmScope = $null
            Send-Json $res 500 @{
              ok = $false
              armed = $false
              userMessage = '実公開API武装処理でエラーが発生しました'
            }
          }
          continue
        }

        # Explicit production publish (STOR). Requires explicitConfirm + phrase 公開 + unlock revalidation.
        if ($path -eq '/api/production-diary-publish' -and $req.HttpMethod -eq 'POST') {
          $publishIdForFail = ''
          $cfgPasswordForFail = ''
          $failStage = 'pre-publish'
          $payload = $null
          $cfg = $null
          try {
            if (-not (Get-Command Invoke-SmileFtpProductionPublish -ErrorAction SilentlyContinue)) {
              $fail = New-SmileProductionPublishFailureResult `
                -ErrorCode 'PRODUCTION_PUBLISH_MODULE_MISSING' `
                -UserMessage '本番公開モジュールがありません' `
                -Detail 'Invoke-SmileFtpProductionPublish が見つかりません' `
                -Stage 'module-load'
              $script:LastProductionPublishResult = [pscustomobject]$fail
              Send-Json $res 500 $fail
              continue
            }
            $failStage = 'ftp-config-initial-read'
            $cfg = Read-SmileFtpConfig -Root $fullRoot
            $cfgPasswordForFail = if ($cfg -and $cfg.password) { [string]$cfg.password } else { '' }
            $cfgReady0 = Test-SmileFtpConfigReadyForPublish -FtpConfig $cfg -ArmScope $null
            if (-not $cfgReady0.ok) {
              $fail = New-SmileProductionPublishFailureResult `
                -ErrorCode $cfgReady0.errorCode `
                -UserMessage 'FTP情報が不足しているため本番公開を中止しました' `
                -Detail (($cfgReady0.blockers -join ' / ')) `
                -Stage 'ftp-config-initial-read' `
                -Password $cfgPasswordForFail
              $fail['blockers'] = @($cfgReady0.blockers)
              $fail['realPublishStarted'] = $false
              $script:LastProductionPublishResult = [pscustomobject]$fail
              Send-Json $res 400 $fail
              continue
            }
            $raw = Read-BodyBytes $req
            $payload = ([Text.Encoding]::UTF8.GetString($raw) | ConvertFrom-Json)
            $publishIdForFail = [string]$payload.publishId
            if (-not [bool]$payload.explicitConfirm) {
              Send-Json $res 400 @{ ok = $false; userMessage = '明示的な本番公開確認が必要です' }
              continue
            }
            $unlockCheck = Test-SmileRealPublishUnlockRequest -Payload $payload -FtpConfig $cfg -WorkspaceRoot $fullRoot
            if (-not $unlockCheck.ok) {
              Send-Json $res 403 @{
                ok = $false
                result = 'FAILED'
                errorCode = 'REAL_PUBLISH_UNLOCK_REVALIDATION_FAILED'
                userMessage = '実公開解除のサーバー側再検証に失敗しました'
                blockers = $unlockCheck.blockers
                writeCommandCount = 0
                productionUpdateCount = 0
                storCount = 0
                deleCount = 0
                realPublishStarted = $false
              }
              continue
            }
            # スコープ付き武装が有効かつ期限内・対象一致のときだけ STOR 経路へ進む。
            Clear-SmileRealPublishArmIfExpired | Out-Null
            if (-not $script:RealPublishApiArmed) {
              Send-Json $res 403 @{
                ok = $false
                result = 'REAL_PUBLISH_API_NOT_ARMED'
                errorCode = 'REAL_PUBLISH_API_NOT_ARMED'
                userMessage = '実公開APIは現フェーズでは無効です（サーバー武装オフ / STOR・DELE 0件）'
                writeCommandCount = 0
                productionUpdateCount = 0
                storCount = 0
                deleCount = 0
                realPublishStarted = $false
                safeMode = $true
              }
              continue
            }
            $scopeCheck = Test-SmileRealPublishArmScopeMatch -Payload $payload -FtpConfig $cfg
            if (-not $scopeCheck.ok) {
              Send-Json $res 403 @{
                ok = $false
                result = 'REAL_PUBLISH_ARM_SCOPE_MISMATCH'
                errorCode = 'REAL_PUBLISH_ARM_SCOPE_MISMATCH'
                userMessage = '武装スコープ外の公開要求です（拒否 / STOR・DELE 0件）'
                blockers = $scopeCheck.blockers
                writeCommandCount = 0
                productionUpdateCount = 0
                storCount = 0
                deleCount = 0
                realPublishStarted = $false
                safeMode = $true
              }
              continue
            }

            # 本番公開API実行直前：保存済みFTP設定を再読込し、接続前に不足を検知する
            $failStage = 'ftp-config-reload-before-connect'
            $cfg = Read-SmileFtpConfig -Root $fullRoot
            $cfgPasswordForFail = if ($cfg -and $cfg.password) { [string]$cfg.password } else { '' }
            $cfgReady = Test-SmileFtpConfigReadyForPublish -FtpConfig $cfg -ArmScope $script:RealPublishArmScope
            if (-not $cfgReady.ok) {
              $fail = New-SmileProductionPublishFailureResult `
                -PublishId $publishIdForFail `
                -ErrorCode $cfgReady.errorCode `
                -UserMessage 'FTP設定不足のためFTP接続前に中止しました（パスワードは表示しません）' `
                -Detail (($cfgReady.blockers -join ' / ')) `
                -Stage 'ftp-config-reload-before-connect' `
                -Password $cfgPasswordForFail
              $fail['blockers'] = @($cfgReady.blockers)
              $fail['realPublishStarted'] = $false
              $fail['ftpConfigCheck'] = @{
                hostPresent = [bool]($cfg -and $cfg.host)
                portPresent = [bool]($cfg -and $null -ne $cfg.port)
                usernamePresent = [bool]($cfg -and $cfg.username)
                remoteRootPresent = [bool]($cfg -and $cfg.remoteRoot)
                tlsPresent = [bool]($cfg -and $null -ne $cfg.useTls)
                passwordPresent = [bool]($cfg -and [string]$cfg.password)
              }
              $script:LastProductionPublishResult = [pscustomobject]$fail
              Send-Json $res 400 $fail
              continue
            }

            $failStage = 'Invoke-SmileFtpProductionPublish'
            # Capture only the final return object (suppress accidental pipeline noise)
            $pubAll = @(Invoke-SmileFtpProductionPublish -WorkspaceRoot $fullRoot -FtpConfig $cfg -Payload $payload)
            $pub = $pubAll | Select-Object -Last 1
            $safe = [ordered]@{}
            foreach ($p in $pub.PSObject.Properties) {
              if ($p.Name -eq 'password') { continue }
              $val = $p.Value
              if ($p.Name -eq 'commands' -or $p.Name -eq 'ftpCommands') {
                $val = Protect-SmileFtpCommandList -Commands $val -Password $cfgPasswordForFail
              } elseif ($val -is [string]) {
                $val = Protect-SmileSecretText -Text $val -Password $cfgPasswordForFail
              }
              $safe[$p.Name] = $val
            }
            $script:LastProductionPublishResult = [pscustomobject]$safe
            Send-Json $res 200 $script:LastProductionPublishResult
          } catch {
            $ex = $_.Exception
            $msg = if ($ex) { [string]$ex.Message } else { [string]$_ }
            $exType = if ($ex) { $ex.GetType().FullName } else { 'Unknown' }
            $innerMsg = ''
            if ($ex -and $ex.InnerException) { $innerMsg = [string]$ex.InnerException.Message }
            $rawStack = if ($_.ScriptStackTrace) { [string]$_.ScriptStackTrace } else { '' }
            $stackShort = (($rawStack -split "`r?`n") | Select-Object -First 6) -join ' | '
            $detailParts = @(
              "message=$(Protect-SmileSecretText -Text $msg -Password $cfgPasswordForFail)",
              "exceptionType=$exType",
              "inner=$(Protect-SmileSecretText -Text $innerMsg -Password $cfgPasswordForFail)",
              "stage=$failStage",
              "stack=$(Protect-SmileSecretText -Text $stackShort -Password $cfgPasswordForFail)"
            )
            $errorCode = 'PRODUCTION_PUBLISH_EXCEPTION'
            $userMessage = '本番公開処理でエラーが発生しました'
            $statusCode = 500
            if ($msg -match 'publish lock already held') {
              $errorCode = 'PUBLISH_LOCK_HELD'
              $userMessage = '同じ公開が実行中です（二重実行を拒否しました）'
              $statusCode = 409
            }
            $fail = New-SmileProductionPublishFailureResult `
              -PublishId $publishIdForFail `
              -ErrorCode $errorCode `
              -UserMessage $userMessage `
              -Detail ($detailParts -join '; ') `
              -Stage $failStage `
              -ExceptionType $exType `
              -Password $cfgPasswordForFail `
              -FtpCommands @() `
              -RollbackAttempted $false `
              -RollbackSucceeded $false `
              -WriteCommandCount 0 `
              -ProductionUpdateCount 0
            $script:LastProductionPublishResult = [pscustomobject]$fail
            Send-Json $res $statusCode $fail
          }
          continue
        }

        if ($path -eq '/api/production-publish-last' -and $req.HttpMethod -eq 'GET') {
          Send-Json $res 200 @{ ok = $true; result = $script:LastProductionPublishResult }
          continue
        }

        # Orphan leftover cleanup (default: check-only, no DELE). Never logs password.
        if ($path -eq '/api/production-orphan-cleanup' -and $req.HttpMethod -eq 'POST') {
          try {
            if (-not (Get-Command Invoke-SmileOrphanImageCleanup -ErrorAction SilentlyContinue)) {
              Send-Json $res 500 @{ ok = $false; userMessage = '残留削除モジュールがありません' }
              continue
            }
            $cfg = Read-SmileFtpConfig -Root $fullRoot
            if (-not $cfg -or -not $cfg.host -or -not $cfg.username -or -not $cfg.password) {
              Send-Json $res 400 @{ ok = $false; userMessage = 'FTP情報が未設定です' }
              continue
            }
            $raw = Read-BodyBytes $req
            $payload = ([Text.Encoding]::UTF8.GetString($raw) | ConvertFrom-Json)
            $publishId = [string]$payload.publishId
            $executeDele = [bool]$payload.executeDele
            $explicitConfirm = [bool]$payload.explicitConfirm
            if ($executeDele) {
              # Hard block for now: formal DELE must be explicitly enabled in a later approved task.
              # Current server build refuses executeDele to prevent accidental Xserver writes.
              Send-Json $res 403 @{
                ok = $false
                executed = $false
                userMessage = '現在は削除チェック専用です。正式DELEはまだ有効化していません'
                executeDeleRequested = $true
              }
              continue
            }
            $clean = Invoke-SmileOrphanImageCleanup `
              -WorkspaceRoot $fullRoot `
              -FtpConfig $cfg `
              -PublishId $publishId `
              -ExplicitConfirm $explicitConfirm `
              -ExecuteDele $false
            $safe = [ordered]@{}
            foreach ($p in $clean.PSObject.Properties) {
              if ($p.Name -eq 'password') { continue }
              $val = $p.Value
              if ($val -is [string]) {
                $val = Protect-SmileSecretText -Text $val -Password ([string]$cfg.password)
              }
              $safe[$p.Name] = $val
            }
            $script:LastOrphanCleanupResult = [pscustomobject]$safe
            Send-Json $res 200 $script:LastOrphanCleanupResult
          } catch {
            $msg = Protect-SmileSecretText -Text $_.Exception.Message -Password ''
            Send-Json $res 500 @{ ok = $false; userMessage = '残留削除チェックでエラー'; detail = $msg }
          }
          continue
        }

        if ($path -eq '/api/production-orphan-cleanup-last' -and $req.HttpMethod -eq 'GET') {
          Send-Json $res 200 @{ ok = $true; result = $script:LastOrphanCleanupResult }
          continue
        }

        if ($path -eq '/api/production-publish-lock' -and $req.HttpMethod -eq 'GET') {
          try {
            $qid = [string]$req.QueryString['publishId']
            if (-not $qid) {
              Send-Json $res 400 @{ ok = $false; error = 'publishId required' }
              continue
            }
            $st = Test-SmilePublishLock -Root $fullRoot -PublishId $qid
            Send-Json $res 200 @{
              ok = $true
              locked = [bool]$st.locked
              stale = [bool]$st.stale
              inProgress = [bool]$st.inProgress
            }
          } catch {
            Send-Json $res 500 @{ ok = $false }
          }
          continue
        }

        # List diary images
        if ($path -eq '/api/local-diary-images-list' -and $req.HttpMethod -eq 'GET') {
          if (-not (Test-Path -LiteralPath $allowedImageDir)) {
            Send-Json $res 200 @{ ok = $true; files = @(); path = 'CorporateSite/diary/diary/image/' }
            continue
          }
          $files = @(Get-ChildItem -LiteralPath $allowedImageDir -File | ForEach-Object { $_.Name })
          $pairs = @{}
          foreach ($f in $files) {
            if ($f -match '^(\d{6}-\d+)b\.jpg$') {
              $base = $Matches[1]
              if (-not $pairs.ContainsKey($base)) { $pairs[$base] = @{ display = $false; large = $false } }
              $pairs[$base].large = $true
            } elseif ($f -match '^(\d{6}-\d+)\.jpg$') {
              $base = $Matches[1]
              if (-not $pairs.ContainsKey($base)) { $pairs[$base] = @{ display = $false; large = $false } }
              $pairs[$base].display = $true
            }
          }
          $inconsistencies = @()
          foreach ($k in $pairs.Keys) {
            $p = $pairs[$k]
            if ($p.display -xor $p.large) {
              $inconsistencies += @{
                base = $k
                displayName = ($k + '.jpg')
                largeName = ($k + 'b.jpg')
                hasDisplay = [bool]$p.display
                hasLarge = [bool]$p.large
              }
            }
          }
          Send-Json $res 200 @{
            ok = $true
            files = $files
            inconsistencies = $inconsistencies
            path = 'CorporateSite/diary/diary/image/'
          }
          continue
        }

        # Unified publish: images + index.htm (transactional)
        if ($path -eq '/api/local-diary-publish' -and $req.HttpMethod -eq 'POST') {
          $sessionId = $null
          $stageDir = $null
          $promoted = New-Object System.Collections.Generic.List[string]
          $backupPath = $null
          $indexWritten = $false
          try {
            $raw = Read-BodyBytes $req
            $payload = ([Text.Encoding]::UTF8.GetString($raw) | ConvertFrom-Json)
            $sessionId = [string]$payload.sessionId
            if (-not $sessionId -or $sessionId -notmatch '^[a-zA-Z0-9_\-]{6,64}$') {
              Send-Json $res 400 @{ ok = $false; error = 'sessionIdが不正です'; stage = 'validate' }
              continue
            }
            $backupName = [string]$payload.backupName
            if (-not $backupName -or $backupName -notmatch '^index_backup_\d{8}_\d{6}\.htm$') {
              Send-Json $res 400 @{ ok = $false; error = 'バックアップ名が不正です'; stage = 'validate' }
              continue
            }
            if (-not $payload.updatedIndexBase64) {
              Send-Json $res 400 @{ ok = $false; error = 'updatedIndexBase64 がありません'; stage = 'validate' }
              continue
            }
            $images = @()
            if ($payload.images) { $images = @($payload.images) }

            # Validate image names + no overwrite
            $validationError = $null
            foreach ($img in $images) {
              $fn = [string]$img.fileName
              $dest = Get-SafeImagePath $fullRoot $fn
              if (-not $dest) {
                $validationError = @{ ok = $false; error = ("不正な画像ファイル名: " + $fn); stage = 'validate'; fileName = $fn }
                break
              }
              if (Test-Path -LiteralPath $dest) {
                $validationError = @{ ok = $false; error = ("既存画像があるため上書きしません: " + $fn); stage = 'conflict'; fileName = $fn }
                break
              }
              if (-not $img.base64) {
                $validationError = @{ ok = $false; error = ("画像データが空です: " + $fn); stage = 'validate'; fileName = $fn }
                break
              }
            }
            if ($validationError) {
              $code = if ($validationError.stage -eq 'conflict') { 409 } else { 400 }
              Send-Json $res $code $validationError
              continue
            }

            if (-not (Test-Path -LiteralPath $allowedIndex)) {
              Send-Json $res 404 @{ ok = $false; error = 'index.htm が見つかりません'; stage = 'validate' }
              continue
            }

            # Stage temp images
            if (-not (Test-Path -LiteralPath $tmpRoot)) {
              New-Item -ItemType Directory -Path $tmpRoot | Out-Null
            }
            $stageDir = Join-Path $tmpRoot $sessionId
            if (Test-Path -LiteralPath $stageDir) {
              Remove-Item -LiteralPath $stageDir -Recurse -Force
            }
            New-Item -ItemType Directory -Path $stageDir | Out-Null

            foreach ($img in $images) {
              $fn = [string]$img.fileName
              $bytes = [Convert]::FromBase64String([string]$img.base64)
              if ($bytes.Length -lt 32) {
                throw [Exception]("一時画像サイズ異常: $fn")
              }
              $tmpFile = Join-Path $stageDir $fn
              [IO.File]::WriteAllBytes($tmpFile, $bytes)
            }

            # Verify staged
            foreach ($img in $images) {
              $fn = [string]$img.fileName
              $tmpFile = Join-Path $stageDir $fn
              if (-not (Test-Path -LiteralPath $tmpFile)) {
                throw [Exception]("一時画像がありません: $fn")
              }
              $len = (Get-Item -LiteralPath $tmpFile).Length
              if ($len -lt 32) {
                throw [Exception]("一時画像検証失敗: $fn")
              }
            }

            # Backup index
            $backupPath = [IO.Path]::GetFullPath((Join-Path $allowedDiaryDir $backupName))
            if (-not $backupPath.StartsWith($allowedDiaryDir, [StringComparison]::OrdinalIgnoreCase)) {
              throw [Exception]('バックアップパスが不正です')
            }
            if (Test-Path -LiteralPath $backupPath) {
              throw [Exception]("バックアップ同名が既に存在します: $backupName")
            }
            [IO.File]::Copy($allowedIndex, $backupPath, $false)

            # Write index
            $indexBytes = [Convert]::FromBase64String([string]$payload.updatedIndexBase64)
            if ($indexBytes.Length -lt 100) {
              throw [Exception]('更新HTMLサイズが異常です')
            }
            [IO.File]::WriteAllBytes($allowedIndex, $indexBytes)
            $indexWritten = $true

            # Promote images (never overwrite)
            foreach ($img in $images) {
              $fn = [string]$img.fileName
              $dest = Get-SafeImagePath $fullRoot $fn
              if (Test-Path -LiteralPath $dest) {
                throw [Exception]("配置直前に既存ファイルを検出: $fn")
              }
              $tmpFile = Join-Path $stageDir $fn
              [IO.File]::Move($tmpFile, $dest)
              $promoted.Add($fn) | Out-Null
            }

            # Cleanup stage
            if ($stageDir -and (Test-Path -LiteralPath $stageDir)) {
              Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
            }

            Send-Json $res 200 @{
              ok = $true
              backupName = $backupName
              backupPath = ('CorporateSite/diary/diary/' + $backupName)
              indexPath = 'CorporateSite/diary/diary/index.htm'
              imageDir = 'CorporateSite/diary/diary/image/'
              promoted = @($promoted)
              imageCount = $promoted.Count
              writtenIndexBytes = $indexBytes.Length
              rollbackNeeded = $false
            }
          } catch {
            $rbOk = $true
            $rbNotes = @()
            try {
              if ($indexWritten -and $backupPath -and (Test-Path -LiteralPath $backupPath)) {
                [IO.File]::Copy($backupPath, $allowedIndex, $true)
                $rbNotes += 'index.htmをバックアップから復元'
              }
              foreach ($fn in $promoted) {
                $dest = Get-SafeImagePath $fullRoot $fn
                if ($dest -and (Test-Path -LiteralPath $dest)) {
                  Remove-Item -LiteralPath $dest -Force
                  $rbNotes += ("追加画像を削除: " + $fn)
                }
              }
              if ($stageDir -and (Test-Path -LiteralPath $stageDir)) {
                Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
                $rbNotes += '一時ファイルを削除'
              }
            } catch {
              $rbOk = $false
              $rbNotes += $_.Exception.Message
            }
            Send-Json $res 500 @{
              ok = $false
              error = $_.Exception.Message
              stage = 'publish'
              message = '反映に失敗したため、変更前の状態へ戻しました。'
              rollbackOk = $rbOk
              rollbackNotes = $rbNotes
            }
          }
          continue
        }

        # HTML-only apply (no images) — keep for compatibility
        if ($path -eq '/api/local-diary-apply' -and $req.HttpMethod -eq 'POST') {
          try {
            $raw = Read-BodyBytes $req
            $payload = ([Text.Encoding]::UTF8.GetString($raw) | ConvertFrom-Json)
            $backupName = [string]$payload.backupName
            if (-not $backupName -or $backupName -notmatch '^index_backup_\d{8}_\d{6}\.htm$') {
              Send-Json $res 400 @{ ok = $false; error = 'バックアップ名が不正です' }
              continue
            }
            if (-not $payload.updatedBase64) {
              Send-Json $res 400 @{ ok = $false; error = 'updatedBase64 がありません' }
              continue
            }
            if (-not (Test-Path -LiteralPath $allowedIndex)) {
              Send-Json $res 404 @{ ok = $false; error = 'index.htm が見つかりません' }
              continue
            }
            $backupPath = [IO.Path]::GetFullPath((Join-Path $allowedDiaryDir $backupName))
            if (-not $backupPath.StartsWith($allowedDiaryDir, [StringComparison]::OrdinalIgnoreCase)) {
              Send-Json $res 403 @{ ok = $false; error = 'バックアップパスが不正です' }
              continue
            }
            [IO.File]::Copy($allowedIndex, $backupPath, $false)
            $updated = [Convert]::FromBase64String([string]$payload.updatedBase64)
            [IO.File]::WriteAllBytes($allowedIndex, $updated)
            Send-Json $res 200 @{
              ok = $true
              backupName = $backupName
              backupPath = ('CorporateSite/diary/diary/' + $backupName)
              indexPath = 'CorporateSite/diary/diary/index.htm'
              writtenBytes = $updated.Length
            }
          } catch {
            Send-Json $res 500 @{ ok = $false; error = $_.Exception.Message }
          }
          continue
        }

        # Static files
        if ($path -eq '/') { $path = '/index.html' }
        $rel = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
        $fullFile = [IO.Path]::GetFullPath((Join-Path $root $rel))
        if (-not $fullFile.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $fullFile -PathType Leaf)) {
          Send-Bytes $res 404 ([Text.Encoding]::UTF8.GetBytes('Not Found')) 'text/plain; charset=utf-8'
        } else {
          $ext = [IO.Path]::GetExtension($fullFile).ToLowerInvariant()
          $ctype = $mimes[$ext]
          if ($ext -eq '.htm' -and $fullFile -match '[\\/]CorporateSite[\\/]') {
            $ctype = 'text/html; charset=Shift_JIS'
          } elseif ($ext -eq '.html') {
            $ctype = 'text/html; charset=utf-8'
          }
          Send-Bytes $res 200 ([IO.File]::ReadAllBytes($fullFile)) $ctype
        }
      } catch {
        try { Send-Bytes $res 500 ([Text.Encoding]::UTF8.GetBytes('Error')) 'text/plain; charset=utf-8' } catch {}
      } finally {
        try { $res.OutputStream.Close() } catch {}
      }
    }
  } finally {
    try { $listener.Stop(); $listener.Close() } catch {}
  }
  Start-Sleep -Seconds 1
}

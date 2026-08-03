# Smile AI Studio - Read-only FTP probe (ASCII source for Windows PowerShell 5.1)
# Allowed file ops: PWD, CWD, SIZE, MDTM, LIST (+ PASV/AUTH/USER/PASS for session)
# Forbidden: STOR, DELE, MKD, RNFR, RNTO, APPE, SITE, CHMOD, etc.

Set-StrictMode -Version Latest

$script:SmileFtpAllowedCommands = @(
  'USER','PASS','ACCT','AUTH','PBSZ','PROT','FEAT','SYST','TYPE',
  'PASV','EPSV','PWD','XPWD','CWD','XCWD','CDUP','XCUP',
  'SIZE','MDTM','LIST','NLST','MLSD','RETR','STOR','DELE','QUIT','NOOP','OPTS'
)

$script:SmileFtpForbiddenCommands = @(
  'STOU','APPE','RMD','XRMD','MKD','XMKD',
  'RNFR','RNTO','SITE','CHMOD','PUT','REST','MFMT','SMNT',
  'PORT','EPRT'
)

function Get-SmileFtpSafeErrorCategory {
  param([string]$Message, [string]$Raw = '')
  $m = ("$Message $Raw")
  $ml = $m.ToLowerInvariant()

  # Prefer specific Smile codes before generic 550 → FOLDER mapping
  if ($m -match 'DIARY_FOLDER_MISSING|diary folder not found') {
    return @{ category = 'DIARY_FOLDER'; userMessageJa = 'diary-folder-missing' }
  }
  if ($m -match 'INDEX_HTM_MISSING|index\.htm not found|diary/index\.htm not found') {
    return @{ category = 'INDEX_MISSING'; userMessageJa = 'index-missing' }
  }
  if ($m -match 'SIZE_UNSUPPORTED|size not (supported|implemented)|size command not') {
    return @{ category = 'SIZE_UNSUPPORTED'; userMessageJa = 'size-unsupported' }
  }
  if ($m -match 'SIZE_PERMISSION|size permission') {
    return @{ category = 'SIZE_PERMISSION'; userMessageJa = 'size-permission' }
  }
  if ($m -match 'IMAGE_FOLDER_MISSING|diary/image folder not found|image folder not found') {
    return @{ category = 'IMAGE_FOLDER'; userMessageJa = 'image-folder-missing' }
  }
  if ($m -match 'PUBLIC_FOLDER_MISSING|public folder not found') {
    return @{ category = 'FOLDER'; userMessageJa = 'folder-missing' }
  }

  if ($ml -match 'dns|could not be determined|unknown host|no such host|host name') {
    return @{ category = 'DNS'; userMessageJa = 'host-resolve-failed' }
  }
  if ($ml -match '530|login incorrect|authentication|auth fail|not logged in') {
    return @{ category = 'AUTH'; userMessageJa = 'auth-failed' }
  }
  if ($ml -match 'timeout|timed out') {
    return @{ category = 'TIMEOUT'; userMessageJa = 'timeout' }
  }
  if ($ml -match 'ssl|tls|certificate|secure channel|auth tls') {
    return @{ category = 'TLS'; userMessageJa = 'tls-failed' }
  }
  if ($ml -match '553|permission denied|access denied') {
    return @{ category = 'PERMISSION'; userMessageJa = 'permission' }
  }
  # Generic 550 only after specific codes; avoid classifying SIZE failures as folder-missing
  if ($ml -match 'failed to change directory|cwd .+ not found|no such directory') {
    return @{ category = 'FOLDER'; userMessageJa = 'folder-missing' }
  }
  return @{ category = 'OTHER'; userMessageJa = 'other' }
}

function Convert-SmileFtpUserMessage {
  param([string]$Code, [string]$Category)
  switch ($Code) {
    'host-resolve-failed' { return 'ホスト名を解決できませんでした。FTPホスト名を確認してください。' }
    'auth-failed' { return 'ユーザー名またはパスワードが正しくありません。' }
    'timeout' { return '接続がタイムアウトしました。ネットワークやホスト・ポートを確認してください。' }
    'tls-failed' { return 'TLS（暗号化）の確立に失敗しました。TLS設定を確認してください。' }
    'folder-missing' { return '指定の公開フォルダが見つかりません。' }
    'diary-folder-missing' { return 'diary フォルダが見つかりません。' }
    'index-missing' { return 'diary/index.htm が見つかりません。' }
    'size-unsupported' { return 'このサーバーは SIZE コマンドに対応していません（LIST/MLSDで存在確認を続行します）。' }
    'size-permission' { return 'SIZE の参照権限が不足しています（LIST/MLSDで存在確認を続行します）。' }
    'image-folder-missing' { return 'diary/image フォルダが見つかりません。' }
    'permission' { return '参照権限が不足している可能性があります（書き込みは行っていません）。' }
    default {
      switch ($Category) {
        'DNS' { return 'ホスト名を解決できませんでした。FTPホスト名を確認してください。' }
        'AUTH' { return 'ユーザー名またはパスワードが正しくありません。' }
        'TIMEOUT' { return '接続がタイムアウトしました。ネットワークやホスト・ポートを確認してください。' }
        'TLS' { return 'TLS（暗号化）の確立に失敗しました。TLS設定を確認してください。' }
        'FOLDER' { return '指定の公開フォルダが見つかりません。' }
        'DIARY_FOLDER' { return 'diary フォルダが見つかりません。' }
        'INDEX_MISSING' { return 'diary/index.htm が見つかりません。' }
        'SIZE_UNSUPPORTED' { return 'このサーバーは SIZE コマンドに対応していません。' }
        'SIZE_PERMISSION' { return 'SIZE の参照権限が不足しています。' }
        'IMAGE_FOLDER' { return 'diary/image フォルダが見つかりません。' }
        'PERMISSION' { return '参照権限が不足している可能性があります（書き込みは行っていません）。' }
        default { return 'FTP接続確認に失敗しました。設定を見直してください。' }
      }
    }
  }
}

function Test-SmileFtpCommandAllowed {
  param([string]$CommandLine, $session = $null)
  $parts = @($CommandLine -split '\s+', 2)
  $cmd = $parts[0].ToUpperInvariant()
  $arg = if ($parts.Count -gt 1) { [string]$parts[1] } else { '' }

  if ($cmd -eq 'STOR') {
    if (-not ($session -and $session.allowStor)) {
      throw [InvalidOperationException]'STOR blocked (publish write mode required)'
    }
    if ($session.storAllowList -and @($session.storAllowList).Count -gt 0) {
      $fn = ($arg -replace '\\','/' -split '/')[-1]
      if (@($session.storAllowList) -notcontains $fn) {
        throw [InvalidOperationException]("STOR blocked for non-manifest file: $fn")
      }
    }
    return $cmd
  }
  if ($cmd -eq 'DELE') {
    if (-not ($session -and $session.allowDele)) {
      throw [InvalidOperationException]'DELE blocked (rollback mode required)'
    }
    $fn = ($arg -replace '\\','/' -split '/')[-1]
    if (-not $session.deleAllowList -or (@($session.deleAllowList) -notcontains $fn)) {
      throw [InvalidOperationException]("DELE blocked for non-tracked file: $fn")
    }
    return $cmd
  }
  # Publish-only atomic rename (temp → index.htm). Off by default.
  if ($cmd -eq 'RNFR' -or $cmd -eq 'RNTO') {
    if (-not ($session -and $session.allowRename)) {
      throw [InvalidOperationException]'RNFR/RNTO blocked (publish rename mode required)'
    }
    $fn = ($arg -replace '\\','/' -split '/')[-1]
    if ($session.renameAllowList -and @($session.renameAllowList).Count -gt 0) {
      if (@($session.renameAllowList) -notcontains $fn) {
        throw [InvalidOperationException]("Rename blocked for non-allowlisted file: $fn")
      }
    }
    return $cmd
  }
  if ($script:SmileFtpForbiddenCommands -contains $cmd) {
    throw [InvalidOperationException]("Forbidden FTP command blocked: $cmd")
  }
  if ($script:SmileFtpAllowedCommands -notcontains $cmd) {
    throw [InvalidOperationException]("FTP command not allowed: $cmd")
  }
  return $cmd
}

function New-SmileFtpSession {
  param(
    [string]$HostName,
    [int]$Port = 21,
    [int]$TimeoutMs = 25000
  )
  $client = New-Object System.Net.Sockets.TcpClient
  $iar = $client.BeginConnect($HostName, $Port, $null, $null)
  if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
    try { $client.Close() } catch {}
    throw [TimeoutException]'Connection timed out'
  }
  try { $client.EndConnect($iar) } catch {
    try { $client.Close() } catch {}
    throw
  }
  $client.ReceiveTimeout = $TimeoutMs
  $client.SendTimeout = $TimeoutMs
  $stream = $client.GetStream()
  return @{
    client = $client
    stream = $stream
    reader = $null
    writer = $null
    ssl = $null
    encoding = [Text.Encoding]::ASCII
    commands = New-Object System.Collections.Generic.List[string]
    closed = $false
    allowStor = $false
    allowDele = $false
    allowRename = $false
    storAllowList = New-Object System.Collections.Generic.List[string]
    deleAllowList = New-Object System.Collections.Generic.List[string]
    renameAllowList = New-Object System.Collections.Generic.List[string]
    # StrictMode-safe: always present (null until a STOR completion failure is recorded)
    lastStorFailure = $null
  }
}

function Connect-SmileFtpStreamIO($session) {
  $session.reader = New-Object System.IO.StreamReader($session.stream, $session.encoding, $false, 1024, $true)
  $session.writer = New-Object System.IO.StreamWriter($session.stream, $session.encoding, 1024, $true)
  $session.writer.NewLine = "`r`n"
  $session.writer.AutoFlush = $true
}

function Read-SmileFtpReply($session) {
  $lines = New-Object System.Collections.Generic.List[string]
  $code = $null
  while ($true) {
    $line = $session.reader.ReadLine()
    if ($null -eq $line) { throw [IO.IOException]'FTP reply ended unexpectedly' }
    [void]$lines.Add($line)
    if ($line -match '^(\d{3})([- ].*)$') {
      $code = [int]$Matches[1]
      if ($Matches[2].StartsWith(' ')) { break }
      # multiline: 123-... continues until 123 <space>...
    } elseif ($line -match '^(\d{3})$') {
      # tolerate bare codes (some servers/mocks omit the required space+text)
      $code = [int]$Matches[1]
      break
    }
  }
  return @{
    code = $code
    text = ($lines -join "`n")
    lines = @($lines)
  }
}

function Send-SmileFtpCommand {
  param($session, [string]$CommandLine, [switch]$SecretArg)
  $cmd = Test-SmileFtpCommandAllowed -CommandLine $CommandLine -session $session
  if ($SecretArg -or $cmd -eq 'PASS') {
    [void]$session.commands.Add(($cmd + ' ********'))
  } else {
    [void]$session.commands.Add($CommandLine.Trim())
  }
  $session.writer.WriteLine($CommandLine)
  return Read-SmileFtpReply $session
}

function Enable-SmileFtpTls($session) {
  $reply = Send-SmileFtpCommand $session 'AUTH TLS'
  if ($reply.code -lt 200 -or $reply.code -ge 300) {
    throw [Exception]("AUTH TLS failed")
  }
  $ssl = New-Object System.Net.Security.SslStream($session.stream, $false, {
    param($sender, $certificate, $chain, $errors)
    return $true
  })
  $ssl.AuthenticateAsClient($script:SmileFtpCurrentHost)
  $session.ssl = $ssl
  $session.stream = $ssl
  Connect-SmileFtpStreamIO $session
  $null = Send-SmileFtpCommand $session 'PBSZ 0'
  $null = Send-SmileFtpCommand $session 'PROT P'
  return $true
}

function Open-SmileFtpPassiveData($session) {
  $reply = Send-SmileFtpCommand $session 'PASV'
  if ($reply.code -ne 227) {
    throw [Exception]'PASV failed'
  }
  # Capture groups immediately: Read-SmileFtpReply overwrites $Matches with reply-code groups,
  # and -notmatch can leave stale/partial Matches (wrong data port → RETR hang).
  $pasvText = [string]$reply.text
  $m = [regex]::Match($pasvText, '\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)')
  if (-not $m.Success) {
    throw [Exception]'PASV parse failed'
  }
  $ip = "$($m.Groups[1].Value).$($m.Groups[2].Value).$($m.Groups[3].Value).$($m.Groups[4].Value)"
  $port = ([int]$m.Groups[5].Value) * 256 + ([int]$m.Groups[6].Value)
  if ($port -le 0 -or $port -gt 65535) {
    throw [Exception]("PASV invalid port: $port")
  }
  # Prefer connecting back to the control host (NAT-safe). Fall back to PASV IP.
  $connectHost = $(if ($script:SmileFtpCurrentHost) { [string]$script:SmileFtpCurrentHost } else { $ip })
  $dataClient = New-Object System.Net.Sockets.TcpClient
  $dataClient.ReceiveTimeout = $session.client.ReceiveTimeout
  $dataClient.SendTimeout = $session.client.SendTimeout
  try {
    $dataClient.Connect($connectHost, $port)
  } catch {
    if ($connectHost -ne $ip) {
      $dataClient = New-Object System.Net.Sockets.TcpClient
      $dataClient.ReceiveTimeout = $session.client.ReceiveTimeout
      $dataClient.SendTimeout = $session.client.SendTimeout
      $dataClient.Connect($ip, $port)
      $connectHost = $ip
    } else {
      throw
    }
  }
  try {
    $session.lastPasvHost = $connectHost
    $session.lastPasvPort = $port
    $session.lastPasvAdvertisedIp = $ip
  } catch {}
  $dataStream = [System.Net.Sockets.NetworkStream]$dataClient.GetStream()
  # Do NOT TLS-wrap yet. Many FTPS servers (incl. Xserver) start the data-channel
  # handshake only after RETR/LIST/STOR is accepted (150/125).
  return @{
    client = $dataClient
    stream = $dataStream
    needsTls = [bool]$session.ssl
    secured = $false
    pasvHost = $connectHost
    pasvPort = $port
  }
}

function Protect-SmileFtpDataChannel($data) {
  if (-not $data -or -not $data.needsTls -or $data.secured) { return $data }
  $dataSsl = New-Object System.Net.Security.SslStream($data.stream, $false, {
    param($sender, $certificate, $chain, $errors)
    return $true
  })
  $dataSsl.AuthenticateAsClient([string]$script:SmileFtpCurrentHost)
  $data.stream = $dataSsl
  $data.secured = $true
  return $data
}

function Read-SmileFtpDataText($data) {
  $reader = New-Object System.IO.StreamReader($data.stream, [Text.Encoding]::UTF8, $true, 1024, $true)
  try {
    return $reader.ReadToEnd()
  } finally {
    try { $reader.Dispose() } catch {}
    try { $data.stream.Dispose() } catch {}
    try { $data.client.Close() } catch {}
  }
}

function Read-SmileFtpDataBytes($data) {
  $ms = New-Object System.IO.MemoryStream
  try {
    $data.stream.CopyTo($ms)
    return $ms.ToArray()
  } finally {
    try { $ms.Dispose() } catch {}
    try { $data.stream.Dispose() } catch {}
    try { $data.client.Close() } catch {}
  }
}

function Get-SmileFtpSha256Hex {
  param($Bytes)
  if ($null -eq $Bytes) { throw [ArgumentNullException]'Bytes' }
  $b = $Bytes -as [byte[]]
  if ($null -eq $b) {
    throw [ArgumentException]('Get-SmileFtpSha256Hex expects byte[]')
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($b)
    return ([BitConverter]::ToString($hash) -replace '-','').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-SmileFtpListFileNames {
  param([string]$ListText)
  $names = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($ListText -split "`r?`n")) {
    $t = $line.Trim()
    if (-not $t) { continue }
    $name = $null
    if ($t -match '^type=') {
      # MLSD: type=file;...; name
      if ($t -match ';\s*([^\s;]+)\s*$') { $name = $Matches[1] }
      if ($t -match 'type=dir') { continue }
    } elseif ($t -match '^(?:d|-)[rwx-]{9}') {
      if ($t.StartsWith('d')) { continue }
      $parts = $t -split '\s+'
      if ($parts.Count -ge 9) { $name = ($parts[8..($parts.Count-1)] -join ' ') }
    } else {
      $name = $t
    }
    if ($name -and $name -ne '.' -and $name -ne '..') {
      [void]$names.Add($name)
    }
  }
  return @($names)
}

function Get-SmileFtpListEntries {
  param([string]$ListText)
  $entries = New-Object System.Collections.Generic.List[object]
  foreach ($line in ($ListText -split "`r?`n")) {
    $t = $line.Trim()
    if (-not $t) { continue }
    $name = $null
    $isDir = $false
    $size = $null
    $modify = $null
    if ($t -match '^type=') {
      if ($t -match 'type=dir') { $isDir = $true }
      if ($t -match ';\s*([^\s;]+)\s*$') { $name = $Matches[1] }
      if ($t -match '(?:^|;)size=(\d+)') { $size = [long]$Matches[1] }
      if ($t -match '(?:^|;)modify=(\d{14})') { $modify = $Matches[1] }
    } elseif ($t -match '^(d|-)[rwx-]{9}') {
      $isDir = ($Matches[1] -eq 'd')
      $parts = $t -split '\s+'
      if ($parts.Count -ge 9) {
        $size = 0
        [void][long]::TryParse($parts[4], [ref]$size)
        $name = ($parts[8..($parts.Count - 1)] -join ' ')
      }
    } else {
      $name = $t
    }
    if ($name -and $name -ne '.' -and $name -ne '..') {
      [void]$entries.Add([pscustomobject]@{
        name = $name
        isDir = $isDir
        size = $size
        modify = $modify
      })
    }
  }
  return @($entries)
}

function Invoke-SmileFtpDirListing {
  param($session)
  # Prefer MLSD, fallback to LIST. Caller should already be in the target directory.
  foreach ($cmd in @('MLSD', 'LIST')) {
    try {
      $data = Open-SmileFtpPassiveData $session
      $listReply = Send-SmileFtpCommand $session $cmd
      if ($listReply.code -ne 150 -and $listReply.code -ne 125) {
        try { $data.client.Close() } catch {}
        continue
      }
      $null = Protect-SmileFtpDataChannel $data
      $listText = Read-SmileFtpDataText $data
      $listDone = Read-SmileFtpReply $session
      if ($listDone.code -ge 400) { continue }
      return @{
        ok = $true
        method = $cmd
        text = $listText
        entries = @(Get-SmileFtpListEntries -ListText $listText)
        names = @(Get-SmileFtpListFileNames -ListText $listText)
      }
    } catch {
      continue
    }
  }
  return @{
    ok = $false
    method = $null
    text = ''
    entries = @()
    names = @()
  }
}

function Find-SmileFtpListEntry {
  param($Entries, [string]$FileName)
  $want = [string]$FileName
  foreach ($e in @($Entries)) {
    if (-not $e) { continue }
    if ([string]$e.name -eq $want -and -not $e.isDir) { return $e }
  }
  foreach ($e in @($Entries)) {
    if (-not $e) { continue }
    if ([string]$e.name -eq $want) { return $e }
  }
  return $null
}

function Invoke-SmileFtpSize {
  param($session, [string]$RemoteFileName)
  $null = Send-SmileFtpCommand $session 'TYPE I'
  $reply = Send-SmileFtpCommand $session ("SIZE " + $RemoteFileName)
  if ($reply.code -eq 213 -and $reply.text -match '(\d+)\s*$') {
    return @{
      ok = $true
      size = [long]$Matches[1]
      code = $reply.code
      text = $reply.text
      unsupported = $false
      permission = $false
    }
  }
  $unsupported = ($reply.code -eq 500 -or $reply.code -eq 502 -or
    $reply.text -match '(?i)not (implemented|understood)|unknown command|unrecognized')
  $permission = ($reply.code -eq 550 -and $reply.text -match '(?i)permission|denied|access') -or
    ($reply.code -eq 553)
  return @{
    ok = $false
    size = $null
    code = $reply.code
    text = $reply.text
    unsupported = [bool]$unsupported
    permission = [bool]$permission
  }
}

function Invoke-SmileFtpMdtm {
  param($session, [string]$RemoteFileName)
  $null = Send-SmileFtpCommand $session 'TYPE I'
  $reply = Send-SmileFtpCommand $session ("MDTM " + $RemoteFileName)
  if ($reply.code -eq 213) {
    return @{
      ok = $true
      raw = ($reply.text -replace '^\d{3}\s+', '').Trim()
      iso = Convert-SmileFtpMdtmToIso $reply.text
      code = $reply.code
    }
  }
  return @{
    ok = $false
    raw = $null
    iso = $null
    code = $reply.code
    text = $reply.text
  }
}

function Invoke-SmileFtpRetrBytes {
  param($session, [string]$RemoteFileName)
  $null = Send-SmileFtpCommand $session 'TYPE I'
  $data = Open-SmileFtpPassiveData $session
  $retr = Send-SmileFtpCommand $session ("RETR " + $RemoteFileName)
  if ($retr.code -ne 150 -and $retr.code -ne 125) {
    try { $data.client.Close() } catch {}
    throw [Exception]("RETR failed: $RemoteFileName")
  }
  $null = Protect-SmileFtpDataChannel $data
  $bytes = Read-SmileFtpDataBytes $data
  $done = Read-SmileFtpReply $session
  if ($done.code -ge 400) {
    throw [Exception]("RETR completion failed: $RemoteFileName")
  }
  return $bytes
}

function Invoke-SmileFtpStorBytes {
  param($session, [string]$RemoteFileName, [byte[]]$Bytes)
  if (-not $session.allowStor) {
    throw [InvalidOperationException]'STOR not enabled on session'
  }
  $startedAt = Get-Date
  $expectedSize = 0
  if ($Bytes) { $expectedSize = $Bytes.Length }
  $prevRecv = $session.client.ReceiveTimeout
  $prevSend = $session.client.SendTimeout
  $dataMs = 120000
  $ctrlMs = 60000
  try {
    if ($session.PSObject.Properties['dataTransferTimeoutMs'] -and $session.dataTransferTimeoutMs) {
      $dataMs = [int]$session.dataTransferTimeoutMs
    }
    if ($session.PSObject.Properties['controlReplyTimeoutMs'] -and $session.controlReplyTimeoutMs) {
      $ctrlMs = [int]$session.controlReplyTimeoutMs
    }
  } catch {}
  try {
    $session.client.ReceiveTimeout = [Math]::Max($dataMs, $ctrlMs)
    $session.client.SendTimeout = $dataMs
    # Fresh PASV every STOR — do not reuse old data connections.
    $null = Send-SmileFtpCommand $session 'TYPE I'
    $data = Open-SmileFtpPassiveData $session
    try {
      $data.client.ReceiveTimeout = $dataMs
      $data.client.SendTimeout = $dataMs
    } catch {}
    $pasvHost = $(if ($data.pasvHost) { [string]$data.pasvHost } elseif ($session.lastPasvHost) { [string]$session.lastPasvHost } else { '' })
    $pasvPort = $(if ($null -ne $data.pasvPort) { [int]$data.pasvPort } elseif ($null -ne $session.lastPasvPort) { [int]$session.lastPasvPort } else { 0 })
    $tlsUsed = [bool]$session.ssl
    $stor = Send-SmileFtpCommand $session ("STOR " + $RemoteFileName)
    if ($stor.code -ne 150 -and $stor.code -ne 125) {
      try { if ($data.stream) { $data.stream.Dispose() } } catch {}
      try { $data.client.Close() } catch {}
      $safeReject = ([string]$stor.text)
      if ($session.PSObject.Properties.Name -contains 'passwordMask' -and $session.passwordMask) {
        $safeReject = $safeReject.Replace([string]$session.passwordMask, '********')
      }
      throw [Exception]("STOR rejected: $RemoteFileName / code=$($stor.code) / text=$safeReject / expectedSize=$expectedSize / pasv=$pasvHost`:$pasvPort / tls=$tlsUsed")
    }
    $null = Protect-SmileFtpDataChannel $data
    try {
      if ($Bytes -and $Bytes.Length -gt 0) {
        $data.stream.Write($Bytes, 0, $Bytes.Length)
        $data.stream.Flush()
      }
    } finally {
      # Ordered close: data/TLS first, then socket; then wait for control 226/250.
      try { if ($data.stream) { $data.stream.Dispose() } } catch {}
      try { $data.client.Close() } catch {}
    }
    $session.client.ReceiveTimeout = $ctrlMs
    $failedAt = Get-Date
    $done = Read-SmileFtpReply $session
    # 450/425/426 must never be treated as success. Prefer 226; accept other 2xx except PASV 227.
    $okDone = ($done.code -eq 226) -or ($done.code -ge 200 -and $done.code -lt 300 -and $done.code -ne 227)
    if (-not $okDone) {
      $remoteSize = $null
      try {
        $sz = Invoke-SmileFtpSize -session $session -RemoteFileName $RemoteFileName
        if ($sz -and $sz.ok) { $remoteSize = $sz.size }
      } catch { }
      $elapsed = [math]::Round((($failedAt) - $startedAt).TotalSeconds, 3)
      $safeText = ([string]$done.text) -replace '(?im)\bPASS\s+\S+', 'PASS ********'
      $safeText = $safeText -replace '(?im)("?(?:password|passwd|secret|token|authorization)"?\s*[:=]\s*)([^\s,"}]+)', '$1********'
      if ($safeText.Length -gt 240) { $safeText = $safeText.Substring(0, 240) + '...' }
      $diag = [ordered]@{
        remotePath = $RemoteFileName
        code = [int]$done.code
        text = $safeText
        expectedBytes = $expectedSize
        remoteSize = $remoteSize
        startedAt = $startedAt.ToString('o')
        failedAt = $failedAt.ToString('o')
        elapsedSec = $elapsed
        pasvHost = $pasvHost
        pasvPort = $pasvPort
        tls = $tlsUsed
        exceptionType = 'STOR_COMPLETION_FAILED'
      }
      try {
        if ($session -is [System.Collections.IDictionary]) {
          $session['lastStorFailure'] = [pscustomobject]$diag
        } else {
          $session.lastStorFailure = [pscustomobject]$diag
        }
      } catch {}
      throw [Exception]("STOR completion failed: $RemoteFileName / code=$($done.code) / text=$safeText / remoteSize=$remoteSize / expectedSize=$expectedSize / elapsedSec=$elapsed / pasv=$pasvHost`:$pasvPort / tls=$tlsUsed / exceptionType=STOR_COMPLETION_FAILED")
    }
    return $true
  } finally {
    try { $session.client.ReceiveTimeout = $prevRecv } catch {}
    try { $session.client.SendTimeout = $prevSend } catch {}
  }
}

function Invoke-SmileFtpDeleFile {
  param($session, [string]$RemoteFileName)
  if (-not $session.allowDele) {
    throw [InvalidOperationException]'DELE not enabled on session'
  }
  $reply = Send-SmileFtpCommand $session ("DELE " + $RemoteFileName)
  if ($reply.code -lt 200 -or $reply.code -ge 300) {
    throw [Exception]("DELE failed: $RemoteFileName")
  }
  return $true
}

function Connect-SmileFtpAuthenticatedSession {
  param(
    [string]$HostName,
    [int]$Port,
    [string]$Username,
    [string]$Password,
    [string]$RemoteRoot,
    [bool]$UseTls,
    [int]$TimeoutMs
  )
  $script:SmileFtpCurrentHost = $HostName
  $session = New-SmileFtpSession -HostName $HostName -Port $Port -TimeoutMs $TimeoutMs
  Connect-SmileFtpStreamIO $session
  $greeting = Read-SmileFtpReply $session
  if ($greeting.code -ne 220) { throw [Exception]'Unexpected FTP greeting' }
  if ($UseTls) {
    $null = Enable-SmileFtpTls $session
  }
  $u = Send-SmileFtpCommand $session ("USER " + $Username)
  if ($u.code -eq 331) {
    $p = Send-SmileFtpCommand $session ("PASS " + $Password) -SecretArg
    if ($p.code -lt 200 -or $p.code -ge 300) { throw [Exception]'530 authentication failed' }
  } elseif ($u.code -lt 200 -or $u.code -ge 300) {
    throw [Exception]'530 authentication failed'
  }
  $null = Send-SmileFtpCommand $session 'TYPE A'
  $pwd1 = Send-SmileFtpCommand $session 'PWD'
  $root = ($RemoteRoot -replace '\\','/').Trim()
  if (-not $root) { $root = '/' }
  if ($root -ne '/' -and $root -ne '') {
    $cwdRoot = Send-SmileFtpCommand $session ("CWD " + $root)
    if ($cwdRoot.code -lt 200 -or $cwdRoot.code -ge 300) {
      throw [Exception]'PUBLIC_FOLDER_MISSING: public folder not found'
    }
    $pwd1 = Send-SmileFtpCommand $session 'PWD'
  }
  return @{
    session = $session
    tlsEstablished = [bool]$UseTls
    currentDirectory = $pwd1.text
    remoteRoot = $root
  }
}

function Test-SmileFtpRemotePathAllowed {
  param([string]$RemotePath, [string]$Kind)
  $p = ($RemotePath -replace '\\','/').Trim()
  if (-not $p) { return $false }
  if ($p.Contains('..')) { return $false }
  if ($p -match '^[A-Za-z]:') { return $false }
  if ($Kind -eq 'html') {
    return ($p -eq '/diary/index.htm' -or $p -eq 'diary/index.htm')
  }
  if ($Kind -eq 'image') {
    return ($p -match '^/?diary/image/[^/]+$' -and $p -notmatch '\.\.')
  }
  return $false
}

function Join-SmileFtpRemoteFullPath {
  param([string]$RemoteRoot, [string]$RemotePath)
  $root = ($RemoteRoot -replace '\\','/').TrimEnd('/')
  $rel = ($RemotePath -replace '\\','/').TrimStart('/')
  if (-not $root -or $root -eq '/') { return '/' + $rel }
  return $root + '/' + $rel
}

function Close-SmileFtpSession($session) {
  if (-not $session -or $session.closed) { return }
  $session.closed = $true
  try {
    if ($session.writer -and $session.stream -and $session.stream.CanWrite) {
      try {
        Test-SmileFtpCommandAllowed 'QUIT' | Out-Null
        [void]$session.commands.Add('QUIT')
        $session.writer.WriteLine('QUIT')
      } catch {}
    }
  } catch {}
  try { if ($session.reader) { $session.reader.Dispose() } } catch {}
  try { if ($session.writer) { $session.writer.Dispose() } } catch {}
  try { if ($session.ssl) { $session.ssl.Dispose() } } catch {}
  try { if ($session.client) { $session.client.Close() } } catch {}
}

function Convert-SmileFtpMdtmToIso {
  param([string]$Raw)
  if ($Raw -match '(\d{14})') {
    $s = $Matches[1]
    $dt = [datetime]::ParseExact($s, 'yyyyMMddHHmmss', [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal)
    return $dt.ToString('o')
  }
  return $null
}

function Get-SmileFtpImageCountFromList {
  param([string]$ListText)
  $count = 0
  foreach ($line in ($ListText -split "`r?`n")) {
    $t = $line.Trim()
    if (-not $t) { continue }
    $name = $t
    if ($t -match '^(?:d|-)[rwx-]{9}') {
      $parts = $t -split '\s+'
      if ($parts.Count -ge 9) { $name = ($parts[8..($parts.Count-1)] -join ' ') }
    }
    if ($name -match '\.(jpe?g|png|gif|webp)$') { $count++ }
  }
  return $count
}

function Invoke-SmileFtpReadonlyProbe {
  param(
    [Parameter(Mandatory=$true)][string]$HostName,
    [int]$Port = 21,
    [Parameter(Mandatory=$true)][string]$Username,
    [Parameter(Mandatory=$true)][string]$Password,
    [string]$RemoteRoot = '/',
    [bool]$UseTls = $true,
    [bool]$Passive = $true,
    [int]$TimeoutMs = 25000
  )

  if (-not $Passive) {
    return [pscustomobject]@{
      ok = $false
      category = 'OTHER'
      categoryJa = 'その他'
      userMessage = 'このツールはパッシブモード（PASV）のみ対応です。'
      commands = @()
      writeExecuted = $false
      deleteExecuted = $false
      uploadExecuted = $false
    }
  }

  $script:SmileFtpCurrentHost = $HostName
  $session = $null
  $result = [ordered]@{
    ok = $false
    mode = 'readonly-probe'
    host = $HostName
    port = $Port
    username = $Username
    password = '********'
    useTls = $UseTls
    tlsEstablished = $false
    passive = $true
    remoteRoot = $RemoteRoot
    currentDirectory = $null
    publicRootOk = $false
    diaryFolderExists = $false
    diaryIndexExists = $false
    diaryIndexSize = $null
    diaryIndexMdtm = $null
    diaryIndexMdtmRaw = $null
    sizeOk = $false
    sizeSource = $null
    sizeAttempted = $false
    sizeCode = $null
    sizeUnsupported = $false
    sizePermission = $false
    sizeFallbackContinued = $false
    mdtmOk = $false
    mdtmSource = $null
    diaryListingMethod = $null
    imageDirExists = $false
    imageCount = $null
    imageCheckMethod = $null
    writeTest = 'not-executed'
    productionPublish = 'not-executed'
    writeExecuted = $false
    deleteExecuted = $false
    uploadExecuted = $false
    renameExecuted = $false
    mkdirExecuted = $false
    writeCommandCount = 0
    productionUpdateCount = 0
    commands = @()
    category = $null
    categoryJa = $null
    userMessage = $null
    detail = $null
  }

  try {
    $session = New-SmileFtpSession -HostName $HostName -Port $Port -TimeoutMs $TimeoutMs
    Connect-SmileFtpStreamIO $session
    $greeting = Read-SmileFtpReply $session
    if ($greeting.code -ne 220) {
      throw [Exception]'Unexpected FTP greeting'
    }

    if ($UseTls) {
      $null = Enable-SmileFtpTls $session
      $result.tlsEstablished = $true
    }

    $u = Send-SmileFtpCommand $session ("USER " + $Username)
    if ($u.code -eq 331) {
      $p = Send-SmileFtpCommand $session ("PASS " + $Password) -SecretArg
      if ($p.code -lt 200 -or $p.code -ge 300) {
        throw [Exception]'530 authentication failed'
      }
    } elseif ($u.code -lt 200 -or $u.code -ge 300) {
      throw [Exception]'530 authentication failed'
    }

    $null = Send-SmileFtpCommand $session 'TYPE A'

    $pwd1 = Send-SmileFtpCommand $session 'PWD'
    $result.currentDirectory = $pwd1.text
    $result.publicRootOk = $true

    $root = ($RemoteRoot -replace '\\','/').Trim()
    if (-not $root) { $root = '/' }
    if ($root -ne '/' -and $root -ne '') {
      $cwdRoot = Send-SmileFtpCommand $session ("CWD " + $root)
      if ($cwdRoot.code -lt 200 -or $cwdRoot.code -ge 300) {
        throw [Exception]'PUBLIC_FOLDER_MISSING: public folder not found'
      }
      $pwd2 = Send-SmileFtpCommand $session 'PWD'
      $result.currentDirectory = $pwd2.text
    }

    $cwdDiary = Send-SmileFtpCommand $session 'CWD diary'
    if ($cwdDiary.code -lt 200 -or $cwdDiary.code -ge 300) {
      throw [Exception]'DIARY_FOLDER_MISSING: diary folder not found'
    }
    $result.diaryFolderExists = $true

    # SIZE / MDTM / RETR 前はバイナリモードへ
    $null = Send-SmileFtpCommand $session 'TYPE I'

    $sizeInfo = Invoke-SmileFtpSize -session $session -RemoteFileName 'index.htm'
    $result.sizeAttempted = $true
    $result.sizeCode = $sizeInfo.code
    if ($sizeInfo.ok) {
      $result.diaryIndexExists = $true
      $result.diaryIndexSize = $sizeInfo.size
      $result.sizeOk = $true
      $result.sizeSource = 'SIZE'
    } else {
      $result.sizeOk = $false
      if ($sizeInfo.unsupported) { $result.sizeUnsupported = $true }
      if ($sizeInfo.permission) { $result.sizePermission = $true }
    }

    # SIZE失敗でも、CWD diary成功後は「フォルダなし」にしない。MLSD/LISTへフォールバック。
    $listing = $null
    if (-not $result.diaryIndexExists -or -not $result.sizeOk) {
      $listing = Invoke-SmileFtpDirListing -session $session
      $result.diaryListingMethod = $listing.method
      $entry = Find-SmileFtpListEntry -Entries $listing.entries -FileName 'index.htm'
      if ($entry) {
        $result.diaryIndexExists = $true
        if (-not $result.sizeOk -and $null -ne $entry.size) {
          $result.diaryIndexSize = [long]$entry.size
          $result.sizeSource = $listing.method
          $result.sizeOk = $true
        } elseif (-not $result.sizeOk) {
          $result.sizeSource = $listing.method + '-exists-only'
        }
        if (-not $result.diaryIndexMdtmRaw -and $entry.modify) {
          $result.diaryIndexMdtmRaw = $entry.modify
          $result.diaryIndexMdtm = Convert-SmileFtpMdtmToIso $entry.modify
          $result.mdtmSource = $listing.method
        }
      }
    }

    if (-not $result.diaryIndexExists) {
      if ($result.sizeUnsupported) {
        throw [Exception]'SIZE_UNSUPPORTED: SIZE not supported and index.htm not found via LIST/MLSD'
      }
      if ($result.sizePermission) {
        throw [Exception]'SIZE_PERMISSION: SIZE permission denied and index.htm not found via LIST/MLSD'
      }
      throw [Exception]'INDEX_HTM_MISSING: diary/index.htm not found'
    }

    # SIZE非対応/権限エラーでも、LISTで存在確認できれば接続確認を継続
    if (-not $result.sizeOk -and $result.diaryIndexExists) {
      $result.sizeFallbackContinued = $true
    }

    $mdtmInfo = Invoke-SmileFtpMdtm -session $session -RemoteFileName 'index.htm'
    if ($mdtmInfo.ok) {
      $result.diaryIndexMdtmRaw = $mdtmInfo.raw
      $result.diaryIndexMdtm = $mdtmInfo.iso
      $result.mdtmOk = $true
      $result.mdtmSource = 'MDTM'
    } else {
      $result.mdtmOk = $false
      if (-not $listing) {
        $listing = Invoke-SmileFtpDirListing -session $session
      }
      if ($listing -and $listing.ok) {
        $entry2 = Find-SmileFtpListEntry -Entries $listing.entries -FileName 'index.htm'
        if ($entry2 -and $entry2.modify) {
          $result.diaryIndexMdtmRaw = $entry2.modify
          $result.diaryIndexMdtm = Convert-SmileFtpMdtmToIso $entry2.modify
          $result.mdtmOk = $true
          $result.mdtmSource = $listing.method
        }
      }
    }

    # diary/image は CWD または MLSD/LIST で個別確認
    $cwdImg = Send-SmileFtpCommand $session 'CWD image'
    if ($cwdImg.code -ge 200 -and $cwdImg.code -lt 300) {
      $result.imageDirExists = $true
      # ディレクトリ一覧は ASCII の方が安定するサーバーがある
      $null = Send-SmileFtpCommand $session 'TYPE A'
      $imgListing = Invoke-SmileFtpDirListing -session $session
      if ($imgListing.ok) {
        $result.imageCount = Get-SmileFtpImageCountFromList $imgListing.text
        $result.imageCheckMethod = 'CWD+' + $imgListing.method
      } else {
        $result.imageCount = $null
        $result.imageCheckMethod = 'CWD-only'
      }
      # return to diary for consistent end state
      $null = Send-SmileFtpCommand $session 'CWD ..'
    } else {
      # Still in diary: look for image as directory entry
      if (-not $listing -or -not $listing.ok) {
        $listing = Invoke-SmileFtpDirListing -session $session
      }
      $imgEntry = $null
      foreach ($e in @($listing.entries)) {
        if ($e -and [string]$e.name -eq 'image' -and $e.isDir) { $imgEntry = $e; break }
      }
      if ($imgEntry) {
        $result.imageDirExists = $true
        $result.imageCount = $null
        $result.imageCheckMethod = 'LIST-dir-entry'
      } else {
        throw [Exception]'IMAGE_FOLDER_MISSING: diary/image folder not found'
      }
    }

    $null = Send-SmileFtpCommand $session 'QUIT'
    $session.closed = $true
    try { $session.client.Close() } catch {}

    $result.ok = $true
    $result.userMessage = 'FTP接続成功'
    $result.commands = @($session.commands)
    $result.writeCommandCount = Get-SmileFtpWriteCommandCount -Commands $result.commands
    $result.productionUpdateCount = 0
    if ($result.writeCommandCount -gt 0) {
      $result.ok = $false
      $result.userMessage = '書込み系コマンドが検出されたため中止しました'
    }
    return [pscustomobject]$result
  } catch {
    $cat = Get-SmileFtpSafeErrorCategory -Message $_.Exception.Message
    $result.ok = $false
    $result.category = $cat.category
    $map = @{
      DNS = 'DNS'
      AUTH = '認証'
      TIMEOUT = 'タイムアウト'
      TLS = 'TLS'
      FOLDER = '公開フォルダなし'
      DIARY_FOLDER = 'diaryフォルダなし'
      INDEX_MISSING = 'index.htmなし'
      SIZE_UNSUPPORTED = 'SIZE非対応'
      SIZE_PERMISSION = 'SIZE権限エラー'
      IMAGE_FOLDER = 'imageフォルダなし'
      PERMISSION = '権限不足'
      OTHER = 'その他'
    }
    $result.categoryJa = $map[$cat.category]
    if (-not $result.categoryJa) { $result.categoryJa = 'その他' }
    $result.userMessage = Convert-SmileFtpUserMessage -Code $cat.userMessageJa -Category $cat.category
    $safeDetail = [string]$_.Exception.Message
    if ($Password) { $safeDetail = $safeDetail.Replace($Password, '********') }
    if ($safeDetail.Length -gt 180) { $safeDetail = $safeDetail.Substring(0, 180) }
    $result.detail = $safeDetail
    if ($session) {
      $result.commands = @($session.commands)
      $result.writeCommandCount = Get-SmileFtpWriteCommandCount -Commands $result.commands
    }
    $result.productionUpdateCount = 0
    return [pscustomobject]$result
  } finally {
    if ($session -and -not $session.closed) {
      Close-SmileFtpSession $session
      if (-not $result.commands -or @($result.commands).Count -eq 0) {
        $result.commands = @($session.commands)
      }
    }
  }
}

function Get-SmileFtpConfigPath {
  param([string]$Root)
  return [IO.Path]::GetFullPath((Join-Path $Root '.data\ftp-config.json'))
}

function Read-SmileFtpConfig {
  param([string]$Root)
  $path = Get-SmileFtpConfigPath $Root
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $raw = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
  return ($raw | ConvertFrom-Json)
}

function Write-SmileFtpConfig {
  param([string]$Root, $Config)
  $dir = [IO.Path]::GetFullPath((Join-Path $Root '.data'))
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $path = Get-SmileFtpConfigPath $Root
  $json = ($Config | ConvertTo-Json -Depth 6)
  [IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
  return $path
}

function Get-SmileFtpConfigPublicView($Config) {
  if (-not $Config) {
    return @{
      configured = $false
      host = ''
      port = 21
      username = ''
      password = '********'
      hasPassword = $false
      remoteRoot = '/'
      useTls = $true
      passive = $true
      timeoutMs = 25000
      connectionMode = 'passive'
      readOnly = $true
    }
  }
  $hasPass = -not [string]::IsNullOrEmpty([string]$Config.password)
  return @{
    configured = $true
    host = [string]$Config.host
    port = [int]($(if ($Config.port) { $Config.port } else { 21 }))
    username = [string]$Config.username
    password = '********'
    hasPassword = $hasPass
    remoteRoot = [string]($(if ($Config.remoteRoot) { $Config.remoteRoot } else { '/' }))
    useTls = [bool]($(if ($null -ne $Config.useTls) { $Config.useTls } else { $true }))
    passive = $true
    timeoutMs = [int]($(if ($Config.timeoutMs) { $Config.timeoutMs } else { 25000 }))
    connectionMode = 'passive'
    readOnly = $true
  }
}

function Get-SmileFtpWriteCommandCount {
  param([string[]]$Commands)
  $n = 0
  foreach ($c in @($Commands)) {
    if ([string]$c -match '^(STOR|STOU|APPE|DELE|RMD|XRMD|MKD|XMKD|RNFR|RNTO|SITE|CHMOD|PUT)\b') {
      $n++
    }
  }
  return $n
}

<#
  Production backup + read-only fetch for dry-run.
  Writes under production-backups/<stamp>_<publishId>/
  Never sends write FTP commands.
#>
function Invoke-SmileFtpProductionBackup {
  param(
    [Parameter(Mandatory=$true)][string]$WorkspaceRoot,
    [Parameter(Mandatory=$true)]$FtpConfig,
    [Parameter(Mandatory=$true)][string]$PublishId,
    [string[]]$PlannedImageNames = @(),
    [hashtable]$RemotePathMap = @{}
  )

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $safePub = ($PublishId -replace '[^a-zA-Z0-9_\-]', '')
  if ([string]::IsNullOrEmpty($safePub)) { $safePub = 'pub' }
  if ($safePub.Length -gt 40) { $safePub = $safePub.Substring(0, 40) }
  $backupRel = "production-backups/$stamp`_$safePub"
  $backupAbs = [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot ($backupRel -replace '/', [IO.Path]::DirectorySeparatorChar)))
  $remoteDir = Join-Path $backupAbs 'remote\diary'
  $imageBakDir = Join-Path $remoteDir 'image'
  New-Item -ItemType Directory -Path $imageBakDir -Force | Out-Null

  $hostName = [string]$FtpConfig.host
  $port = [int]($(if ($FtpConfig.port) { $FtpConfig.port } else { 21 }))
  $user = [string]$FtpConfig.username
  $pass = [string]$FtpConfig.password
  $root = [string]($(if ($FtpConfig.remoteRoot) { $FtpConfig.remoteRoot } else { '/' }))
  $useTls = [bool]($(if ($null -ne $FtpConfig.useTls) { $FtpConfig.useTls } else { $true }))
  $timeoutMs = [int]($(if ($FtpConfig.timeoutMs) { $FtpConfig.timeoutMs } else { 25000 }))

  $conn = $null
  $session = $null
  $out = [ordered]@{
    ok = $false
    publishId = $PublishId
    backupRelPath = $backupRel
    backupAbsPath = $backupAbs
    host = $hostName
    port = $port
    username = $user
    password = '********'
    remoteRoot = $root
    remoteFullPaths = @()
    productionIndexRelPath = ($backupRel + '/remote/diary/index.htm')
    productionIndexSize = $null
    productionIndexSha256 = $null
    productionIndexMdtm = $null
    imageDirListing = @()
    collidingImages = @()
    retrievedCollidingImages = @()
    commands = @()
    writeCommandCount = 0
    productionUpdateCount = 0
    tlsEstablished = $false
    currentDirectory = $null
    retrievedSha256 = $null
    backupFileSha256 = $null
    backupSha256Verified = $false
    userMessage = $null
    category = $null
    categoryJa = $null
    detail = $null
  }

  try {
    if (-not $root -or $root -eq '要確認') {
      throw [Exception]'remote root unconfirmed'
    }
    $htmlRemote = '/diary/index.htm'
    if (-not (Test-SmileFtpRemotePathAllowed -RemotePath $htmlRemote -Kind 'html')) {
      throw [Exception]'invalid remote html path'
    }
    foreach ($img in @($PlannedImageNames)) {
      $rp = '/diary/image/' + $img
      if (-not (Test-SmileFtpRemotePathAllowed -RemotePath $rp -Kind 'image')) {
        throw [Exception]("invalid remote image path: $img")
      }
    }

    $conn = Connect-SmileFtpAuthenticatedSession -HostName $hostName -Port $port -Username $user -Password $pass -RemoteRoot $root -UseTls $useTls -TimeoutMs $timeoutMs
    $session = $conn.session
    $out.tlsEstablished = [bool]$conn.tlsEstablished
    $out.currentDirectory = $conn.currentDirectory
    $out.remoteFullPaths = @(
      (Join-SmileFtpRemoteFullPath -RemoteRoot $root -RemotePath '/diary/index.htm')
    ) + @($PlannedImageNames | ForEach-Object {
      Join-SmileFtpRemoteFullPath -RemoteRoot $root -RemotePath ("/diary/image/" + $_)
    })

    $cwdDiary = Send-SmileFtpCommand $session 'CWD diary'
    if ($cwdDiary.code -lt 200 -or $cwdDiary.code -ge 300) {
      throw [Exception]'DIARY_FOLDER_MISSING: diary folder not found'
    }

    $sizeInfo = Invoke-SmileFtpSize -session $session -RemoteFileName 'index.htm'
    $mdtmInfo = Invoke-SmileFtpMdtm -session $session -RemoteFileName 'index.htm'
    if ($mdtmInfo.ok) {
      $out.productionIndexMdtm = $mdtmInfo.iso
    }

    $indexBytes = Invoke-SmileFtpRetrBytes -session $session -RemoteFileName 'index.htm'
    if (-not $indexBytes -or $indexBytes.Length -lt 32) {
      throw [Exception]'RETR index.htm empty'
    }
    $indexPath = Join-Path $remoteDir 'index.htm'
    $retrievedSha = Get-SmileFtpSha256Hex $indexBytes
    [IO.File]::WriteAllBytes($indexPath, $indexBytes)
    $rereadBytes = [IO.File]::ReadAllBytes($indexPath)
    $rereadSha = Get-SmileFtpSha256Hex $rereadBytes
    $shaVerified = ($retrievedSha -and $rereadSha -and ($retrievedSha -eq $rereadSha))
    $out.productionIndexSize = $indexBytes.Length
    $out.productionIndexSha256 = $retrievedSha
    $out.retrievedSha256 = $retrievedSha
    $out.backupFileSha256 = $rereadSha
    $out.backupSha256Verified = [bool]$shaVerified
    if (-not $shaVerified) {
      throw [Exception]'backup SHA-256 mismatch after save'
    }
    if ($mdtmInfo.ok) {
      $out.productionIndexMdtm = $mdtmInfo.iso
    }
    $null = Send-SmileFtpCommand $session 'TYPE A'

    $cwdImg = Send-SmileFtpCommand $session 'CWD image'
    if ($cwdImg.code -lt 200 -or $cwdImg.code -ge 300) {
      throw [Exception]'550 diary/image folder not found'
    }

    $data = Open-SmileFtpPassiveData $session
    $listReply = Send-SmileFtpCommand $session 'LIST'
    if ($listReply.code -ne 150 -and $listReply.code -ne 125) {
      try { $data.client.Close() } catch {}
      throw [Exception]'LIST image failed'
    }
    $null = Protect-SmileFtpDataChannel $data
    $listText = Read-SmileFtpDataText $data
    $listDone = Read-SmileFtpReply $session
    if ($listDone.code -ge 400) { throw [Exception]'LIST completion failed' }

    $names = Get-SmileFtpListFileNames -ListText $listText
    $out.imageDirListing = @($names)

    $collisions = @()
    foreach ($img in @($PlannedImageNames)) {
      if ($names -contains $img) { $collisions += $img }
    }
    $out.collidingImages = @($collisions)

    # Conditional RETR of colliding remote images into backup only (never overwrite production)
    foreach ($img in $collisions) {
      if ($img -notmatch '^[A-Za-z0-9._\-]+$') { continue }
      $bytes = Invoke-SmileFtpRetrBytes -session $session -RemoteFileName $img
      $dest = Join-Path $imageBakDir $img
      [IO.File]::WriteAllBytes($dest, $bytes)
      $out.retrievedCollidingImages += @{
        fileName = $img
        size = $bytes.Length
        sha256 = (Get-SmileFtpSha256Hex $bytes)
        localRelPath = ($backupRel + '/remote/diary/image/' + $img)
      }
    }

    $null = Send-SmileFtpCommand $session 'QUIT'
    $session.closed = $true
    try { $session.client.Close() } catch {}

    $out.commands = @($session.commands)
    $out.writeCommandCount = Get-SmileFtpWriteCommandCount -Commands $out.commands
    $out.productionUpdateCount = 0
    $out.ok = ($out.writeCommandCount -eq 0)
    if (-not $out.ok) {
      $out.userMessage = 'Write FTP command detected; abort'
    } else {
      $out.userMessage = 'production backup ok'
    }

    $backupManifest = [ordered]@{
      createdAt = (Get-Date).ToString('o')
      publishId = $PublishId
      host = $hostName
      port = $port
      username = $user
      password = '********'
      remoteRoot = $root
      remoteFullPaths = $out.remoteFullPaths
      productionIndex = @{
        remotePath = '/diary/index.htm'
        localRelPath = $out.productionIndexRelPath
        size = $out.productionIndexSize
        sha256 = $out.productionIndexSha256
        retrievedSha256 = $out.retrievedSha256
        backupFileSha256 = $out.backupFileSha256
        backupSha256Verified = [bool]$out.backupSha256Verified
        mdtm = $out.productionIndexMdtm
      }
      collidingImages = $out.collidingImages
      retrievedCollidingImages = $out.retrievedCollidingImages
      imageDirListingCount = @($out.imageDirListing).Count
      commands = $out.commands
      writeCommandCount = $out.writeCommandCount
      productionUpdateCount = 0
      backupSha256Verified = [bool]$out.backupSha256Verified
      note = 'FTP write commands were not sent. Backup only.'
    }
    $bmPath = Join-Path $backupAbs 'production-backup-manifest.json'
    [IO.File]::WriteAllText($bmPath, ($backupManifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))

    return [pscustomobject]$out
  } catch {
    if ($session -and -not $session.closed) {
      Close-SmileFtpSession $session
      $out.commands = @($session.commands)
    }
    $out.writeCommandCount = Get-SmileFtpWriteCommandCount -Commands $out.commands
    $out.productionUpdateCount = 0
    $cat = Get-SmileFtpSafeErrorCategory -Message $_.Exception.Message
    $out.ok = $false
    $out.category = $cat.category
    $map = @{ DNS='DNS'; AUTH='認証'; TIMEOUT='タイムアウト'; TLS='TLS'; FOLDER='フォルダなし'; PERMISSION='権限不足'; OTHER='その他' }
    $out.categoryJa = $(if ($map.ContainsKey($cat.category)) { $map[$cat.category] } else { 'その他' })
    $msg = [string]$_.Exception.Message
    if ($msg -match 'remote root unconfirmed') {
      $out.userMessage = '公開ルートが未確定のため停止しました。'
    } elseif ($msg -match 'invalid remote') {
      $out.userMessage = 'remotePath が許可範囲外のため停止しました。'
    } else {
      $out.userMessage = Convert-SmileFtpUserMessage -Code $cat.userMessageJa -Category $cat.category
    }
    $safe = $msg
    if ($pass) { $safe = $safe.Replace($pass, '********') }
    if ($safe.Length -gt 180) { $safe = $safe.Substring(0, 180) }
    $out.detail = $safe
    return [pscustomobject]$out
  }
}

function Find-SmileFtpDryRunBundleByPublishId {
  param(
    [Parameter(Mandatory = $true)][string]$WorkspaceRoot,
    [Parameter(Mandatory = $true)][string]$PublishId
  )
  $want = ([string]$PublishId).Trim()
  if (-not $want) {
    return $null
  }
  $bakRoot = [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot 'production-backups'))
  if (-not (Test-Path -LiteralPath $bakRoot)) { return $null }

  $dirs = @(Get-ChildItem -LiteralPath $bakRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending)
  foreach ($d in $dirs) {
    $bmPath = Join-Path $d.FullName 'production-backup-manifest.json'
    if (-not (Test-Path -LiteralPath $bmPath)) { continue }
    try {
      $bm = (Get-Content -LiteralPath $bmPath -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch { continue }
    if (([string]$bm.publishId).Trim() -ne $want) { continue }

    $reportPath = Join-Path $d.FullName 'production-dry-run-report.json'
    $verifyPath = Join-Path $d.FullName 'verification-report.json'
    $indexPath = Join-Path $d.FullName 'remote\diary\index.htm'
    $report = $null
    $verification = $null
    if (Test-Path -LiteralPath $reportPath) {
      try { $report = (Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json) } catch {}
    }
    if (Test-Path -LiteralPath $verifyPath) {
      try { $verification = (Get-Content -LiteralPath $verifyPath -Raw -Encoding UTF8 | ConvertFrom-Json) } catch {}
    }

    $rel = 'production-backups/' + $d.Name
    $backupView = [ordered]@{
      ok = $true
      publishId = [string]$bm.publishId
      backupRelPath = $rel
      host = [string]$bm.host
      username = [string]$bm.username
      remoteRoot = [string]$bm.remoteRoot
      productionIndexRelPath = $(if ($bm.productionIndex.localRelPath) { [string]$bm.productionIndex.localRelPath } else { ($rel + '/remote/diary/index.htm') })
      productionIndexSize = $bm.productionIndex.size
      productionIndexSha256 = [string]$bm.productionIndex.sha256
      productionIndexMdtm = $bm.productionIndex.mdtm
      retrievedSha256 = [string]($(if ($bm.productionIndex.retrievedSha256) { $bm.productionIndex.retrievedSha256 } else { $bm.productionIndex.sha256 }))
      backupFileSha256 = [string]($(if ($bm.productionIndex.backupFileSha256) { $bm.productionIndex.backupFileSha256 } else { $bm.productionIndex.sha256 }))
      backupSha256Verified = [bool]($(if ($null -ne $bm.backupSha256Verified) { $bm.backupSha256Verified } elseif ($null -ne $bm.productionIndex.backupSha256Verified) { $bm.productionIndex.backupSha256Verified } else { $false }))
      collidingImages = @($bm.collidingImages)
      writeCommandCount = [int]$bm.writeCommandCount
      productionUpdateCount = 0
      commands = @($bm.commands)
      createdAt = [string]$bm.createdAt
      folderLastWriteTime = $d.LastWriteTime.ToString('o')
      password = '********'
    }

    return [pscustomobject]@{
      ok = $true
      publishId = $want
      backupRelPath = $rel
      backup = [pscustomobject]$backupView
      backupManifest = $bm
      report = $report
      verificationReport = $verification
      reportRelPath = $(if (Test-Path -LiteralPath $reportPath) { ($rel + '/production-dry-run-report.json') } else { $null })
      indexExists = [bool](Test-Path -LiteralPath $indexPath)
      createdAt = [string]$bm.createdAt
      folderLastWriteTime = $d.LastWriteTime.ToString('o')
    }
  }
  return $null
}


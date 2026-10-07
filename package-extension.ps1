$ErrorActionPreference = 'Stop'
$workspace = $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $workspace 'manifest.json') -Raw | ConvertFrom-Json
$name = "抖音下载与口播字幕-v$($manifest.version)"
$destination = Join-Path $workspace $name
$archive = Join-Path $workspace "$name.zip"
if ((Test-Path -LiteralPath $destination) -or (Test-Path -LiteralPath $archive)) {
  throw '该版本安装包已经存在。请先提升版本号，避免覆盖已经交付的文件。'
}
$files = @(
  'manifest.json', 'core.js', 'capture-core.js', 'page-hook.js', 'bridge.js', 'background.js', 'content.js',
  'subtitle-core.js', 'sidepanel.html', 'sidepanel.css', 'sidepanel.js', 'speech-engine.js', 'speech-worker.js',
  '安装说明.md', 'THIRD_PARTY_NOTICES.md', '验证说明.md'
)
New-Item -ItemType Directory -Path $destination | Out-Null
foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $workspace $file) -Destination (Join-Path $destination $file)
}
foreach ($directory in @('assets', 'licenses')) {
  Copy-Item -LiteralPath (Join-Path $workspace $directory) -Destination (Join-Path $destination $directory) -Recurse
}
Compress-Archive -LiteralPath $destination -DestinationPath $archive -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $count = 0
  foreach ($entry in $zip.Entries) {
    if (-not $entry.Name) { continue }
    $relative = $entry.FullName.Replace('\','/').Substring($name.Length + 1)
    $source = Join-Path $workspace $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "压缩包存在未知文件：$relative" }
    $stream = $entry.Open()
    try { $archiveHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') } finally { $stream.Dispose() }
    if ($archiveHash -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash) { throw "打包内容不一致：$relative" }
    $count += 1
  }
  $expected = (Get-ChildItem -LiteralPath $destination -Recurse -File).Count
  if ($count -ne $expected) { throw '压缩包文件数不一致' }
} finally { $zip.Dispose(); $sha.Dispose() }
Write-Output "archive=$archive"
Write-Output "files_verified=$count"
Write-Output "bytes=$((Get-Item -LiteralPath $archive).Length)"
Write-Output "sha256=$((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash)"

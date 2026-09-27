# Builds the Chrome Web Store package from extension/ only: dist/PagePixel-<version>.zip
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-zip.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$ext = Join-Path $root 'extension'
$config = Join-Path $ext 'lib\upload-config.js'

if (-not (Test-Path $config)) {
  throw 'Missing extension\lib\upload-config.js. Copy upload-config.example.js to upload-config.js and set UPLOAD_KEY to the Worker secret.'
}
if ((Get-Content $config -Raw) -match 'replace-with-the-worker-secret') {
  throw 'extension\lib\upload-config.js still contains the placeholder UPLOAD_KEY.'
}

$version = (Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zipPath = Join-Path $dist "PagePixel-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Confirm:$false }

$exclude = @('lib/upload-config.example.js')
$extFull = (Resolve-Path $ext).Path.TrimEnd('\') + '\'
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in Get-ChildItem $ext -Recurse -File) {
    # Forward slashes: Windows PowerShell 5.1's Compress-Archive can write backslash entry
    # names, which some zip consumers treat as literal file names.
    $entry = $file.FullName.Substring($extFull.Length).Replace('\', '/')
    if ($exclude -contains $entry) { continue }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}

$size = [math]::Round((Get-Item $zipPath).Length / 1KB)
Write-Output "Built $zipPath ($size KB)"

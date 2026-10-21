# Builds the release zip: dist/area-lookup-v<version>.zip
# containing a single area-lookup/ folder that players unzip into their mods folder.
# Entries are written with forward slashes (Compress-Archive in Windows
# PowerShell 5.1 uses backslashes, which unzip wrongly on macOS/Linux).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
$files = "manifest.json", "index.js", "README.md", "LICENSE"
New-Item -ItemType Directory -Force dist | Out-Null
$zip = Join-Path $PSScriptRoot "dist\area-lookup-v$version.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }

$archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
try {
	foreach ($f in $files) {
		[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $PSScriptRoot $f), "area-lookup/$f") | Out-Null
	}
} finally {
	$archive.Dispose()
}

Write-Output "Built dist\area-lookup-v$version.zip"

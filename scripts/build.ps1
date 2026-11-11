# src/ 를 압축해 dist/ 에 Chrome 용 zip 과 토르(Firefox)용 xpi 를 만든다 (D018).
# 실행: pwsh scripts/build.ps1
# 원본 manifest 는 하나다. Firefox 만 쓰는 background.scripts 는 Chrome 이 "requires manifest version of 2
# or lower" 오류를 띄우므로 원본에 두지 않고, 여기서 xpi 안의 manifest 에만 넣는다.
# -OutDir: 결과를 둘 폴더. 테스트는 임시 폴더를 넘겨 dist 의 배포 파일을 덮어쓰지 않는다
param([string]$OutDir)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'src'
$dist = if ($OutDir) { $OutDir } else { Join-Path $root 'dist' }
$manifestText = Get-Content (Join-Path $src 'manifest.json') -Raw
$version = ($manifestText | ConvertFrom-Json).version

# Firefox 의 배경은 service worker 가 아니라 스크립트라 공용 모듈을 먼저 싣는다
$gecko = $manifestText | ConvertFrom-Json
$gecko.background | Add-Member -NotePropertyName scripts -NotePropertyValue @('common.js', 'background.js')
$geckoText = $gecko | ConvertTo-Json -Depth 10

# src 밖의 adtest·테스트는 원래 들어가지 않는다. 백업 파일은 src 에 잘못 들어와도 뺀다
$files = Get-ChildItem $src -Recurse -File | Where-Object { $_.Name -notlike 'settings-backup*' }

New-Item -ItemType Directory -Force $dist | Out-Null
foreach ($target in @(@{ Name = "unclasp-$version-chrome.zip"; Manifest = $null },
                      @{ Name = "unclasp-$version.xpi"; Manifest = $geckoText })) {
  $out = Join-Path $dist $target.Name
  if (Test-Path $out) { Remove-Item $out }
  $zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
  try {
    foreach ($f in $files) {
      # Firefox 는 압축 안 경로의 구분자가 / 여야 xpi 를 읽는다. Compress-Archive 는 \ 를 쓸 수 있다
      $entry = $f.FullName.Substring($src.Length + 1).Replace('\', '/')
      if ($entry -eq 'manifest.json' -and $target.Manifest) {
        $w = New-Object System.IO.StreamWriter($zip.CreateEntry($entry, 'Optimal').Open(), (New-Object System.Text.UTF8Encoding $false))
        try { $w.Write($target.Manifest) } finally { $w.Dispose() }
      } else {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entry, 'Optimal') | Out-Null
      }
    }
    # MIT 는 모든 복사본에 고지를 넣으라고 한다 (D061)
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root 'LICENSE'), 'LICENSE', 'Optimal') | Out-Null
  } finally {
    $zip.Dispose()
  }
  Write-Output "$($target.Name)  ($($files.Count + 1)개 파일)"
}

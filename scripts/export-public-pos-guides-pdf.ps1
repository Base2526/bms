# Export the reviewed DOCX files through Microsoft Word so each PDF has identical text.
# Requires Word on Windows. Run build-public-pos-guides.py first.
param(
  [string]$OutputDirectory = "",
  [string[]]$Guides = @("retail", "board-game", "restaurant", "pharmacy", "pet-supply", "building-materials")
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Join-Path $repoRoot "apps\web\public\guides\pos"
if (-not $OutputDirectory) { $OutputDirectory = $sourceDirectory }
$outputFullPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputFullPath) | Out-Null

$wordApp = $null
try {
  $wordApp = New-Object -ComObject Word.Application
  $wordApp.Visible = $false
  $wordApp.DisplayAlerts = 0
  foreach ($slug in $Guides) {
    $sourcePath = Join-Path $sourceDirectory "bms-pos-$slug-th.docx"
    if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Missing guide: $sourcePath" }
    $pdfPath = Join-Path $outputFullPath "bms-pos-$slug-th.pdf"
    $document = $null
    try {
      $document = $wordApp.Documents.Open($sourcePath, $false, $true)
      $document.ExportAsFixedFormat($pdfPath, 17)
      Write-Output $pdfPath
    }
    finally {
      if ($document) {
        $document.Close($false)
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document)
      }
    }
  }
}
finally {
  if ($wordApp) {
    $wordApp.Quit()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wordApp)
  }
}

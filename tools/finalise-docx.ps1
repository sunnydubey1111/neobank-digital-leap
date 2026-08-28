# Opens the built document in Word, refreshes the contents field so its page
# numbers are stored in the file, saves, and reports the pagination.
#
#   powershell -ExecutionPolicy Bypass -File tools\finalise-docx.ps1
#
# Optional. The document is complete without this step: Word refreshes the
# field on open in any case. Running it here means the reader sees the page
# numbers immediately rather than after a field update.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$doc  = Join-Path $root "build\NeoBank-HLD-Sunny-Dubey.docx"
if (-not (Test-Path $doc)) { throw "Not found: $doc. Run 'node tools/build-docx.mjs' first." }

$word = $null
$d    = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0

    $d = $word.Documents.Open($doc, [ref]$false, [ref]$false)
    $d.Fields.Update() | Out-Null
    foreach ($toc in $d.TablesOfContents) { $toc.Update() }
    $d.Repaginate()

    $pages = $d.ComputeStatistics(2)   # wdStatisticPages
    $words = $d.ComputeStatistics(0)   # wdStatisticWords
    $d.Save()
    $d.Close(0)
    $d = $null

    Write-Output "Pages: $pages"
    Write-Output "Words: $words"
}
finally {
    if ($d)    { try { $d.Close(0) } catch {} }
    if ($word) { try { $word.Quit() } catch {} }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}

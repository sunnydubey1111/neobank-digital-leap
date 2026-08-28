# Converts the built submission document to a real .docx using Word itself.
#
#   powershell -ExecutionPolicy Bypass -File tools\to-docx.ps1
#
# Word performs the conversion, so the result is identical to opening the file
# and choosing Save As. Requires Microsoft Word to be installed.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$src  = Join-Path $root "build\NeoBank-HLD-Sunny-Dubey.doc"
$dst  = Join-Path $root "build\NeoBank-HLD-Sunny-Dubey.docx"

if (-not (Test-Path $src)) {
    throw "Source not found: $src. Run 'node tools/build-submission.mjs' first."
}
if (Test-Path $dst) { Remove-Item $dst -Force }

$word = $null
$doc  = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0

    # Background repagination dominates the runtime on a document this long and
    # is not needed to produce the file.
    try { $word.Options.Pagination = $false } catch {}

    $doc = $word.Documents.Open($src, [ref]$false, [ref]$false)

    # 16 = wdFormatDocumentDefault (.docx)
    $doc.SaveAs2($dst, 16)
    $doc.Close(0)
    $doc = $null

    $size = [math]::Round((Get-Item $dst).Length / 1MB, 2)
    Write-Output "Wrote $dst ($size MB)"
}
finally {
    if ($doc)  { try { $doc.Close(0) } catch {} }
    if ($word) { try { $word.Quit() } catch {} }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}

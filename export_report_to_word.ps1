# Export IoTank Report to Word (.docx) on Desktop
$mdPath  = "C:\Users\josep\.gemini\antigravity\brain\a3cdd0df-b7c1-4ce1-b7ae-510fdad7b512\iotank_progress_report_v2.md"
$outPath = "C:\Users\josep\OneDrive\Desktop\IoTank_SaaS_Implementation_Report.docx"

$mdContent = Get-Content $mdPath -Raw -Encoding UTF8

# Launch Word via COM
$word = New-Object -ComObject Word.Application
$word.Visible = $false

$doc  = $word.Documents.Add()
$sel  = $word.Selection

# Process each line
$lines = $mdContent -split "`r?`n"

foreach ($line in $lines) {
    if ($line -match '^# (.+)') {
        $sel.Style = $doc.Styles["Heading 1"]
        $sel.TypeText($Matches[1])
    } elseif ($line -match '^## (.+)') {
        $sel.Style = $doc.Styles["Heading 2"]
        $sel.TypeText($Matches[1])
    } elseif ($line -match '^### (.+)') {
        $sel.Style = $doc.Styles["Heading 3"]
        $sel.TypeText($Matches[1])
    } elseif ($line -match '^#### (.+)') {
        $sel.Style = $doc.Styles["Heading 4"]
        $sel.TypeText($Matches[1])
    } elseif ($line -match '^\> \[!') {
        # Alert blocks — render as Normal with brackets intact
        $sel.Style = $doc.Styles["Normal"]
        $clean = $line -replace '^\> ', ''
        $sel.TypeText($clean)
    } elseif ($line -match '^\> (.+)') {
        $sel.Style = $doc.Styles["Quote"]
        $sel.TypeText($Matches[1])
    } elseif ($line -match '^\|') {
        # Table rows — render as Normal
        $sel.Style = $doc.Styles["Normal"]
        $clean = $line -replace '\*\*([^*]+)\*\*', '$1'  # strip bold markers
        $sel.TypeText($clean)
    } elseif ($line -match '^- (.+)' -or $line -match '^\* (.+)') {
        $sel.Style = $doc.Styles["List Bullet"]
        $clean = $line -replace '^[-\*]\s+', '' -replace '\*\*([^*]+)\*\*', '$1' -replace '`([^`]+)`', '$1'
        $sel.TypeText($clean)
    } elseif ($line -match '^\d+\. (.+)') {
        $sel.Style = $doc.Styles["List Number"]
        $clean = $line -replace '^\d+\.\s+', '' -replace '\*\*([^*]+)\*\*', '$1' -replace '`([^`]+)`', '$1'
        $sel.TypeText($clean)
    } elseif ($line.Trim() -eq '' -or $line.Trim() -eq '---') {
        $sel.Style = $doc.Styles["Normal"]
        $sel.TypeText('')
    } else {
        $sel.Style = $doc.Styles["Normal"]
        $clean = $line -replace '\*\*([^*]+)\*\*', '$1' -replace '`([^`]+)`', '$1' -replace '\[([^\]]+)\]\([^\)]+\)', '$1'
        $sel.TypeText($clean)
    }
    $sel.TypeParagraph()
}

$doc.SaveAs([ref]$outPath, [ref]16)  # 16 = wdFormatXMLDocument (.docx)
$doc.Close()
$word.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null

Write-Host "Saved to: $outPath"

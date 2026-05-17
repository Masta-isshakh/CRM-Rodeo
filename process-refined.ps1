$inputPath = "qa-artifacts/loading-audit/loading-audit-strict-async-actionable.json"
$outputPath = "qa-artifacts/loading-audit/loading-audit-strict-async-ultra-clean.json"
$summaryPath = "qa-artifacts/loading-audit/loading-audit-strict-async-ultra-clean-summary.json"

$data = Get-Content $inputPath -Raw | ConvertFrom-Json
Write-Host "Input Count: $($data.Count)"

$processed = New-Object System.Collections.Generic.List[PSCustomObject]

$dropRegex = "open\w+|close\w+|goTo\w+|navigate|setView|setCurrentFolder|openDrivePopup|openRow|openShareModal|set\w+|toggle\w+|focus|draft|onKey|onInput|stopPropagation|preventDefault|onClose|onCancel|onBack|removeFieldDef|removeScannedItem"
$keepRegex = "save|submit|create|update|delete|import|export|upload|download|approve|reject|restore|move|share|bulk|send|fetch|refresh|load|sync|revoke|confirm|handle\w+"

foreach ($item in $data) {
    if ($item.status -eq "covered") {
        $processed.Add($item)
        continue
    }

    $action = $item.action
    if ($null -eq $action) { $action = "" }

    if ($action -eq "loadCategories" -or $action -match "\(\) => loadCategories\(") {
        continue
    }

    $shouldDrop = $action -match $dropRegex
    $shouldKeep = $action -match $keepRegex

    if ($shouldDrop -and -not $shouldKeep) {
        continue
    }

    $processed.Add($item)
}

Write-Host "After filtering: $($processed.Count)"

# Deduplicate
$processed = $processed | Sort-Object page, line | Group-Object page, action, "line-reference" | ForEach-Object { $_.Group[0] }
Write-Host "After dedup: $($processed.Count)"

# Sort
$processed = $processed | Sort-Object page, line

# Save main file
$processed | ConvertTo-Json -Depth 10 | Out-File $outputPath -Encoding utf8

# Summary
$notCovered = $processed | Where-Object { $_.status -eq "not-covered" }
$needsReview = $processed | Where-Object { $_.status -eq "needs-review" }
$covered = $processed | Where-Object { $_.status -eq "covered" }

$top50 = ($notCovered + $needsReview) | Select-Object -First 50

$summary = [PSCustomObject]@{
    generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    sourceReport = $inputPath
    totalEntries = $processed.Count
    counts = @{
        covered = $covered.Count
        notCovered = $notCovered.Count
        needsReview = $needsReview.Count
    }
    triageNotCovered = $notCovered
    triageNeedsReview = $needsReview
    "top-50-priority" = $top50
}

$summary | ConvertTo-Json -Depth 10 | Out-File $summaryPath -Encoding utf8

Write-Host "Counts: covered: $($covered.Count), not-covered: $($notCovered.Count), needs-review: $($needsReview.Count)"
Write-Host "`nTop 15 Priority Entries:"
$top50 | Select-Object -First 15 | ForEach-Object { Write-Host "- page: $($_.page), action: $($_.action), line: $($_.line)" }

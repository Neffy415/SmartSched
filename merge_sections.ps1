# PowerShell script to merge REMAINING_SECTIONS_EXPANSION.md content into PROJECT_REPORT_GUIDE.md

# Read both files
$mainFile = "c:\Users\titto\OneDrive\Desktop\smartSched\PROJECT_REPORT_GUIDE.md"
$expansionFile = "c:\Users\titto\OneDrive\Desktop\smartSched\REMAINING_SECTIONS_EXPANSION.md"

$mainContent = Get-Content $mainFile -Raw
$expansionContent = Get-Content $expansionFile -Raw

# Extract sections from expansion file (everything after "## Section 13: Features Implementation")
$needsReplacement = $expansionContent -match "### 13\.1 Feature 1"
$section13Start = $expansionContent.IndexOf("### 13.1 Feature 1")
$allReplacements = $expansionContent.Substring($section13Start)

# Find where section 13 starts in main file and where section 14 starts in template
$mainSection13Start = $mainContent.IndexOf("### 13.1 Feature 1: AI Study Schedule Generation")
$mainSection21End = $mainContent.LastIndexOf("# 21. APPENDICES")

Write-Host "Main file size: $(($mainContent | Measure-Object -Character).Characters) chars"
Write-Host "Found section 13 at position: $mainSection13Start"
Write-Host "Found section 21 at position: $mainSection21End"

# Extract everything before section 13
$beforeSection13 = $mainContent.Substring(0, $mainSection13Start)

# Extract everything from section 21 onwards
$fromSection21 = $mainContent.Substring($mainSection21End)

# Combine: before section 13 + new expansions + section 21
$updatedContent = $beforeSection13 + $allReplacements + "`n`n" + $fromSection21

# Write to file
Set-Content -Path $mainFile -Value $updatedContent -Encoding UTF8

Write-Host "Successfully merged expansion content into PROJECT_REPORT_GUIDE.md"
Write-Host "Update complete"

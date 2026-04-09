param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'seo-batch.config.json'),
    [string]$InputFile,
    [switch]$ForceLatest
)

# XML workbook exports can omit optional nodes/attributes; avoid strict
# property errors while traversing mixed inline/shared-string cell shapes.
Set-StrictMode -Off
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem

$script:XmlNamespace = 'http://www.w3.org/XML/1998/namespace'
$script:TargetSeoHeaders = @(
    'Thông số kỹ thuật',
    'Mô tả',
    'SEO title',
    'SEO description',
    'SEO keywords'
)
$script:LogPath = $null
$script:RowsProcessed = 0
$script:RowsErrored = 0

$script:ProductRules = @(
    @{
        Match = 'bo ky chen'
        Label = 'bộ kỷ chén'
        UseCase = 'dâng nước thờ hoặc trà thờ'
        UseShort = 'dâng nước thờ'
        Selection = 'nên ưu tiên số chén và chiều ngang cân đối với mặt bàn thờ'
        Space = 'bàn thờ gia tiên hoặc bàn thờ Phật'
    },
    @{
        Match = 'ky chen'
        Label = 'kỷ chén thờ'
        UseCase = 'dâng nước thờ hoặc trà thờ'
        UseShort = 'dâng nước thờ'
        Selection = 'nên ưu tiên số chén và chiều ngang cân đối với mặt bàn thờ'
        Space = 'bàn thờ gia tiên hoặc bàn thờ Phật'
    },
    @{
        Match = 'bat huong'
        Label = 'bát hương'
        UseCase = 'làm điểm trung tâm cho bàn thờ'
        UseShort = 'đặt trung tâm bàn thờ'
        Selection = 'nên chọn theo đường kính và tỷ lệ hài hòa với bàn thờ'
        Space = 'bàn thờ gia tiên, bàn thờ Phật hoặc ban thần tài'
    },
    @{
        Match = 'mam bong'
        Label = 'mâm bồng'
        UseCase = 'bày hoa quả và lễ phẩm'
        UseShort = 'bày hoa quả cúng'
        Selection = 'nên cân đối đường kính với bát hương và lọ hoa'
        Space = 'bàn thờ gia tiên hoặc bàn thờ Phật'
    },
    @{
        Match = 'luc binh'
        Label = 'lục bình'
        UseCase = 'trưng bày tạo thế cân đối và trang nghiêm'
        UseShort = 'trưng bày không gian thờ'
        Selection = 'nên chọn chiều cao phù hợp vị trí đặt và tổng thể gian thờ'
        Space = 'phòng thờ, gian thờ hoặc không gian trưng bày'
    },
    @{
        Match = 'lo hoa'
        Label = 'lọ hoa thờ'
        UseCase = 'cắm hoa cúng và tạo thế cân đối cho bàn thờ'
        UseShort = 'cắm hoa cúng'
        Selection = 'nên chọn chiều cao hài hòa với bát hương và chân nến'
        Space = 'bàn thờ gia tiên hoặc bàn thờ Phật'
    },
    @{
        Match = 'doc binh'
        Label = 'độc bình'
        UseCase = 'trưng bày tạo điểm nhấn trang trọng'
        UseShort = 'trưng bày trang trọng'
        Selection = 'nên chọn chiều cao tương xứng với không gian đặt'
        Space = 'phòng khách, phòng thờ hoặc không gian trưng bày'
    },
    @{
        Match = 'binh hut loc'
        Label = 'bình hút lộc'
        UseCase = 'trưng bày tạo điểm nhấn phong thủy'
        UseShort = 'trưng bày phong thủy'
        Selection = 'nên chọn họa tiết và chiều cao hợp vị trí đặt'
        Space = 'phòng khách, phòng làm việc hoặc quà tặng'
    },
    @{
        Match = 'choe'
        Label = 'chóe thờ'
        UseCase = 'đựng gạo muối hoặc nước thờ'
        UseShort = 'đựng đồ thờ'
        Selection = 'nên phối cùng bộ kỷ và bát hương đồng tông men'
        Space = 'bàn thờ gia tiên hoặc bàn thờ Phật'
    },
    @{
        Match = 'nam ruou'
        Label = 'nậm rượu thờ'
        UseCase = 'bày rượu thờ trong bộ đồ thờ'
        UseShort = 'bày rượu thờ'
        Selection = 'nên phối cùng bộ kỷ chén và các món cùng hệ men'
        Space = 'bàn thờ gia tiên hoặc bàn thờ Phật'
    },
    @{
        Match = 'bat tra sam'
        Label = 'bát trà sâm'
        UseCase = 'bày trà hoặc trà sâm trong bộ đồ thờ'
        UseShort = 'bày trà thờ'
        Selection = 'nên phối cùng bộ đồ thờ cùng màu men để tổng thể đồng bộ'
        Space = 'bàn thờ gia tiên hoặc bàn thờ Phật'
    },
    @{
        Match = 'bat com'
        Label = 'bát cơm cúng'
        UseCase = 'bày cơm cúng gọn gàng trong bộ đồ thờ'
        UseShort = 'bày cơm cúng'
        Selection = 'nên phối cùng bộ đồ thờ cùng màu men để tổng thể đồng bộ'
        Space = 'bàn thờ gia tiên hoặc bàn thờ Phật'
    },
    @{
        Match = 'am chen'
        Label = 'bộ ấm chén'
        UseCase = 'pha trà, tiếp khách hoặc trưng bày'
        UseShort = 'pha trà, tiếp khách'
        Selection = 'nên chọn dung tích và số món phù hợp nhu cầu sử dụng'
        Space = 'phòng khách, không gian trà hoặc quà tặng'
    },
    @{
        Match = 'den dau'
        Label = 'đèn dầu thờ'
        UseCase = 'tạo ánh sáng điểm nhấn cho bàn thờ'
        UseShort = 'trang trí bàn thờ'
        Selection = 'nên chọn chiều cao và dáng phù hợp các món thờ xung quanh'
        Space = 'bàn thờ gia tiên hoặc bàn thờ Phật'
    },
    @{
        Match = 'ong huong'
        Label = 'ống hương'
        UseCase = 'cắm và bảo quản hương trên bàn thờ'
        UseShort = 'đựng hương'
        Selection = 'nên chọn dáng gọn và tông men phù hợp bộ thờ'
        Space = 'bàn thờ gia tiên hoặc bàn thờ Phật'
    },
    @{
        Match = 'tuong'
        Label = 'tượng gốm'
        UseCase = 'thờ hoặc trưng bày trang trọng'
        UseShort = 'thờ hoặc trưng bày'
        Selection = 'nên ưu tiên thần thái, tỷ lệ và vị trí đặt phù hợp'
        Space = 'không gian thờ hoặc trưng bày'
    },
    @{
        Match = 'bo do tho'
        Label = 'bộ đồ thờ'
        UseCase = 'hoàn thiện tổng thể không gian thờ cúng'
        UseShort = 'hoàn thiện bộ đồ thờ'
        Selection = 'nên cân đối theo kích thước bàn thờ và phối đồng bộ màu men'
        Space = 'bàn thờ gia tiên, bàn thờ Phật hoặc phòng thờ'
    }
)

$script:MotifHints = @(
    'sen',
    'phúc lộc thọ',
    'long phụng',
    'rồng',
    'phượng',
    'tứ cảnh',
    'hoa đào',
    'hoa cúc',
    'mai điểu',
    'cá chép',
    'công đào',
    'hoa sen'
)

$script:IntroTemplates = @(
    '{0} là lựa chọn phù hợp để {1}, giúp tổng thể không gian thờ giữ được nét trang nghiêm và đồng bộ.',
    '{0} phù hợp cho nhu cầu {1}, nhất là khi muốn bàn thờ gọn, hài hòa và có điểm nhấn đúng chất gốm thờ.',
    '{0} mang lại cảm giác chỉn chu khi {1}, đồng thời giúp bộ thờ nhìn thống nhất và ấm cúng hơn.'
)

$script:DetailTemplates = @(
    'Dựa trên dữ liệu sản phẩm, mẫu này thuộc dòng {0}{1}. {2}',
    'Từ tên gọi, danh mục và thuộc tính hiện có, đây là mẫu {0}{1}. {2}',
    'Thông tin trong file cho thấy sản phẩm thuộc nhóm {0}{1}. {2}'
)

$script:SelectionTemplates = @(
    'Khi chọn {0}, {1}. {2}',
    'Với dòng {0}, {1}. {2}',
    'Để bộ thờ nhìn cân đối hơn, {1} khi chọn {0}. {2}'
)

function Get-ObjectPropertyValue {
    param(
        $Object,
        [string]$Name,
        $DefaultValue = $null
    )

    if ($null -eq $Object) {
        return $DefaultValue
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $DefaultValue
    }

    if ($null -eq $property.Value) {
        return $DefaultValue
    }

    return $property.Value
}

function Resolve-AbsolutePath {
    param(
        [string]$BaseDir,
        [string]$CandidatePath
    )

    if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
        return $null
    }

    if ([System.IO.Path]::IsPathRooted($CandidatePath)) {
        return [System.IO.Path]::GetFullPath($CandidatePath)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BaseDir $CandidatePath))
}

function Ensure-Directory {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Write-Log {
    param(
        [string]$Level,
        [string]$Message,
        [string]$Sku = ''
    )

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $segments = @($timestamp, $Level)
    if (-not [string]::IsNullOrWhiteSpace($Sku)) {
        $segments += "SKU=$Sku"
    }
    $line = ('[{0}] {1}' -f ($segments -join ' | '), $Message)
    Write-Host $line
    if (-not [string]::IsNullOrWhiteSpace($script:LogPath)) {
        Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
    }
}

function Remove-Diacritics {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ''
    }

    $prepared = $Text.Replace('đ', 'd').Replace('Đ', 'D')
    $normalized = $prepared.Normalize([Text.NormalizationForm]::FormD)
    $builder = New-Object System.Text.StringBuilder
    foreach ($character in $normalized.ToCharArray()) {
        $category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($character)
        if ($category -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$builder.Append($character)
        }
    }

    return $builder.ToString().Normalize([Text.NormalizationForm]::FormC)
}

function Normalize-MatchText {
    param([string]$Text)

    $clean = Remove-Diacritics $Text
    $clean = $clean.ToLowerInvariant()
    $clean = $clean -replace '[^a-z0-9]+', ' '
    $clean = $clean -replace '\s+', ' '
    return $clean.Trim()
}

function Convert-ColumnLettersToIndex {
    param([string]$ColumnLetters)

    $normalized = $ColumnLetters.ToUpperInvariant()
    $value = 0
    foreach ($character in $normalized.ToCharArray()) {
        $value = ($value * 26) + ([int][char]$character - [int][char]'A' + 1)
    }
    return $value
}

function Convert-ColumnIndexToLetters {
    param([int]$ColumnIndex)

    $result = ''
    $current = $ColumnIndex
    while ($current -gt 0) {
        $current--
        $letterCode = [int][char]'A' + ([int]($current % 26))
        $result = ([char]$letterCode) + $result
        $current = [int]($current / 26)
    }
    return $result
}

function Get-ColumnLettersFromReference {
    param([string]$Reference)

    return ($Reference -replace '\d', '')
}

function Get-FirstNonEmpty {
    param([object[]]$Values)

    foreach ($value in $Values) {
        if ($null -eq $value) {
            continue
        }

        $text = [string]$value
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            return $text.Trim()
        }
    }

    return $null
}

function Split-MultiValue {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return @()
    }

    $normalized = $Value -replace '\s+\|\s+', '|' -replace '\r\n', '|' -replace '\n', '|'
    $parts = $normalized.Split('|')
    $cleaned = @()
    foreach ($part in $parts) {
        $text = $part.Trim()
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            $cleaned += $text
        }
    }
    return $cleaned
}

function Convert-StringToDecimal {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    $trimmed = $Value.Trim() -replace '[^0-9,.\-]', ''
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return $null
    }

    $styles = [Globalization.NumberStyles]::AllowDecimalPoint -bor [Globalization.NumberStyles]::AllowThousands -bor [Globalization.NumberStyles]::AllowLeadingSign
    $parsed = 0.0

    if ([double]::TryParse($trimmed, $styles, [Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
        return [decimal]$parsed
    }

    if ([double]::TryParse($trimmed, $styles, [Globalization.CultureInfo]::GetCultureInfo('vi-VN'), [ref]$parsed)) {
        return [decimal]$parsed
    }

    return $null
}

function Format-Currency {
    param([string]$Value)

    $number = Convert-StringToDecimal $Value
    if ($null -eq $number) {
        return $null
    }

    return ('{0:N0}đ' -f $number).Replace(',', '.')
}

function Format-Weight {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    if ($Value -match '[a-zA-Z]') {
        return $Value.Trim()
    }

    $number = Convert-StringToDecimal $Value
    if ($null -eq $number) {
        return $Value.Trim()
    }

    if ($number -ge 1000) {
        $kg = [Math]::Round(([double]$number / 1000), 2)
        if ($kg -eq [Math]::Floor($kg)) {
            return ('{0} kg' -f [int]$kg)
        }
        return ('{0} kg' -f ($kg.ToString('0.##', [Globalization.CultureInfo]::InvariantCulture)))
    }

    return ('{0} g' -f ([int][Math]::Round([double]$number)))
}

function Truncate-AtWord {
    param(
        [string]$Text,
        [int]$MaxLength
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ''
    }

    $trimmed = $Text.Trim()
    if ($trimmed.Length -le $MaxLength) {
        return $trimmed
    }

    $candidate = $trimmed.Substring(0, $MaxLength).Trim()
    $lastSpace = $candidate.LastIndexOf(' ')
    if ($lastSpace -gt 0) {
        $candidate = $candidate.Substring(0, $lastSpace).Trim()
    }

    return $candidate.TrimEnd(',', ';', '.', ':') + '...'
}

function Get-DeterministicIndex {
    param(
        [string]$Seed,
        [int]$Count
    )

    if ($Count -le 0) {
        return 0
    }

    $effectiveSeed = if ([string]::IsNullOrWhiteSpace($Seed)) { 'default' } else { $Seed }
    $bytes = [Text.Encoding]::UTF8.GetBytes($effectiveSeed)
    $md5 = [System.Security.Cryptography.MD5]::Create()
    try {
        $hash = $md5.ComputeHash($bytes)
    }
    finally {
        $md5.Dispose()
    }

    $number = [BitConverter]::ToUInt32($hash, 0)
    return [int]($number % $Count)
}

function Select-SeededText {
    param(
        [string]$Seed,
        [string[]]$Options
    )

    if ($null -eq $Options -or $Options.Count -eq 0) {
        return ''
    }

    return $Options[(Get-DeterministicIndex -Seed $Seed -Count $Options.Count)]
}

function Escape-Html {
    param([string]$Text)

    if ($null -eq $Text) {
        return ''
    }

    return [System.Security.SecurityElement]::Escape([string]$Text)
}

function Get-OpenXmlSheetPath {
    param(
        [string]$ExtractedRoot,
        [xml]$WorkbookXml,
        [xml]$RelationshipXml,
        [string]$RequestedSheetName
    )

    $selectedSheet = $null
    $sheets = @($WorkbookXml.workbook.sheets.sheet)
    if (-not [string]::IsNullOrWhiteSpace($RequestedSheetName)) {
        $selectedSheet = $sheets | Where-Object { $_.name -eq $RequestedSheetName } | Select-Object -First 1
    }

    if ($null -eq $selectedSheet) {
        $selectedSheet = $sheets | Select-Object -First 1
    }

    if ($null -eq $selectedSheet) {
        throw 'Không tìm thấy worksheet nào trong file Excel.'
    }

    $relationshipId = $selectedSheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $relationship = @($RelationshipXml.Relationships.Relationship) | Where-Object { $_.Id -eq $relationshipId } | Select-Object -First 1
    if ($null -eq $relationship) {
        throw ('Không tìm thấy quan hệ sheet cho worksheet "{0}".' -f $selectedSheet.name)
    }

    $target = [string]$relationship.Target
    $resolved = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $ExtractedRoot 'xl') $target))

    return [pscustomobject]@{
        Name = [string]$selectedSheet.name
        Path = $resolved
    }
}

function Load-SharedStrings {
    param([string]$SharedStringsPath)

    $items = New-Object 'System.Collections.Generic.List[string]'
    if (-not (Test-Path -LiteralPath $SharedStringsPath)) {
        return $items
    }

    [xml]$sharedXml = Get-Content -LiteralPath $SharedStringsPath -Raw -Encoding UTF8
    foreach ($si in @($sharedXml.sst.si)) {
        if ($si.t) {
            $items.Add([string]$si.t.InnerText)
            continue
        }

        if ($si.r) {
            $parts = @()
            foreach ($run in @($si.r)) {
                if ($run.t) {
                    $parts += [string]$run.t.InnerText
                }
            }
            $items.Add(($parts -join ''))
            continue
        }

        $items.Add('')
    }

    return $items
}

function Get-CellText {
    param(
        $Cell,
        [System.Collections.Generic.List[string]]$SharedStrings
    )

    if ($null -eq $Cell) {
        return $null
    }

    $cellType = [string]$Cell.t
    if ($cellType -eq 'inlineStr') {
        if ($Cell.is) {
            return [string]$Cell.is.InnerText
        }
        return ''
    }

    if ($cellType -eq 's') {
        $indexText = [string]$Cell.v
        if ([string]::IsNullOrWhiteSpace($indexText)) {
            return ''
        }

        $index = [int]$indexText
        if ($index -ge 0 -and $index -lt $SharedStrings.Count) {
            return $SharedStrings[$index]
        }

        return $indexText
    }

    if ($Cell.v) {
        return [string]$Cell.v
    }

    return ''
}

function Get-CellStyle {
    param($Cell)

    if ($null -eq $Cell) {
        return $null
    }

    if ($Cell.Attributes['s']) {
        return [string]$Cell.Attributes['s'].Value
    }

    return $null
}

function Get-OrderedCells {
    param($Row)

    return @($Row.c)
}

function Get-OrCreateCell {
    param(
        [xml]$SheetXml,
        $Row,
        [string]$ColumnLetters,
        [string]$StyleHint
    )

    $rowIndex = [int]$Row.r
    $cellRef = '{0}{1}' -f $ColumnLetters, $rowIndex
    foreach ($existingCell in (Get-OrderedCells $Row)) {
        if ([string]$existingCell.r -eq $cellRef) {
            return $existingCell
        }
    }

    $worksheetNamespace = $SheetXml.DocumentElement.NamespaceURI
    $newCell = $SheetXml.CreateElement('c', $worksheetNamespace)
    $newCell.SetAttribute('r', $cellRef)
    if (-not [string]::IsNullOrWhiteSpace($StyleHint)) {
        $newCell.SetAttribute('s', $StyleHint)
    }

    $targetIndex = Convert-ColumnLettersToIndex $ColumnLetters
    $inserted = $false
    foreach ($existingCell in (Get-OrderedCells $Row)) {
        $existingIndex = Convert-ColumnLettersToIndex (Get-ColumnLettersFromReference ([string]$existingCell.r))
        if ($existingIndex -gt $targetIndex) {
            [void]$Row.InsertBefore($newCell, $existingCell)
            $inserted = $true
            break
        }
    }

    if (-not $inserted) {
        [void]$Row.AppendChild($newCell)
    }

    return $newCell
}

function Set-CellInlineString {
    param(
        [xml]$SheetXml,
        $Cell,
        [string]$Value,
        [string]$StyleHint
    )

    if (-not [string]::IsNullOrWhiteSpace($StyleHint)) {
        $Cell.SetAttribute('s', $StyleHint)
    }

    $Cell.SetAttribute('t', 'inlineStr')

    while ($Cell.HasChildNodes) {
        [void]$Cell.RemoveChild($Cell.FirstChild)
    }

    $worksheetNamespace = $SheetXml.DocumentElement.NamespaceURI
    $inlineNode = $SheetXml.CreateElement('is', $worksheetNamespace)
    $textNode = $SheetXml.CreateElement('t', $worksheetNamespace)
    [void]$textNode.SetAttribute('space', $script:XmlNamespace, 'preserve')
    $textNode.InnerText = if ($null -eq $Value) { '' } else { $Value }
    [void]$inlineNode.AppendChild($textNode)
    [void]$Cell.AppendChild($inlineNode)
}

function Save-XmlDocument {
    param(
        [xml]$Document,
        [string]$Path
    )

    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
    $settings.Indent = $false
    $settings.NewLineHandling = [System.Xml.NewLineHandling]::None

    $writer = [System.Xml.XmlWriter]::Create($Path, $settings)
    try {
        $Document.Save($writer)
    }
    finally {
        $writer.Dispose()
    }
}

function Get-HeaderMap {
    param(
        $HeaderRow,
        [System.Collections.Generic.List[string]]$SharedStrings
    )

    $map = @{}
    foreach ($cell in (Get-OrderedCells $HeaderRow)) {
        $headerText = Get-CellText -Cell $cell -SharedStrings $SharedStrings
        if (-not [string]::IsNullOrWhiteSpace($headerText)) {
            $map[$headerText.Trim()] = Get-ColumnLettersFromReference ([string]$cell.r)
        }
    }
    return $map
}

function Get-RowStyleHint {
    param(
        $Row,
        [string]$FallbackStyle
    )

    foreach ($cell in (Get-OrderedCells $Row)) {
        $style = Get-CellStyle $cell
        if (-not [string]::IsNullOrWhiteSpace($style)) {
            $FallbackStyle = $style
        }
    }

    return $FallbackStyle
}

function Ensure-TargetHeaders {
    param(
        [xml]$SheetXml,
        $HeaderRow,
        [hashtable]$HeaderMap,
        [string[]]$TargetHeaders
    )

    $highestIndex = 0
    foreach ($columnLetters in $HeaderMap.Values) {
        $columnIndex = Convert-ColumnLettersToIndex $columnLetters
        if ($columnIndex -gt $highestIndex) {
            $highestIndex = $columnIndex
        }
    }

    $headerStyle = Get-RowStyleHint -Row $HeaderRow -FallbackStyle $null
    foreach ($header in $TargetHeaders) {
        if ($HeaderMap.ContainsKey($header)) {
            continue
        }

        $highestIndex++
        $columnLetters = Convert-ColumnIndexToLetters $highestIndex
        $cell = Get-OrCreateCell -SheetXml $SheetXml -Row $HeaderRow -ColumnLetters $columnLetters -StyleHint $headerStyle
        Set-CellInlineString -SheetXml $SheetXml -Cell $cell -Value $header -StyleHint $headerStyle
        $HeaderMap[$header] = $columnLetters
    }

    return $HeaderMap
}

function Get-RowData {
    param(
        $Row,
        [hashtable]$HeaderMap,
        [System.Collections.Generic.List[string]]$SharedStrings
    )

    $cellsByColumn = @{}
    foreach ($cell in (Get-OrderedCells $Row)) {
        $cellsByColumn[(Get-ColumnLettersFromReference ([string]$cell.r))] = $cell
    }

    $data = @{}
    foreach ($headerName in $HeaderMap.Keys) {
        $columnLetters = $HeaderMap[$headerName]
        $cell = $cellsByColumn[$columnLetters]
        $data[$headerName] = Get-CellText -Cell $cell -SharedStrings $SharedStrings
    }
    $data['__rowNumber'] = [int]$Row.r
    return $data
}

function Test-RowHasContent {
    param([hashtable]$RowData)

    foreach ($key in $RowData.Keys) {
        if ($key -eq '__rowNumber') {
            continue
        }

        $value = $RowData[$key]
        if (-not [string]::IsNullOrWhiteSpace([string]$value)) {
            return $true
        }
    }

    return $false
}

function Try-ParseJson {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    $trimmed = $Value.Trim()
    if (($trimmed.StartsWith('{') -or $trimmed.StartsWith('[')) -and ($trimmed.EndsWith('}') -or $trimmed.EndsWith(']'))) {
        try {
            return $trimmed | ConvertFrom-Json
        }
        catch {
            return $null
        }
    }

    return $null
}

function Get-FieldValue {
    param(
        [hashtable]$RowData,
        [string[]]$FieldNames
    )

    foreach ($fieldName in $FieldNames) {
        if ($RowData.Contains($fieldName)) {
            $value = [string]$RowData[$fieldName]
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                return $value.Trim()
            }
        }
    }

    return $null
}

function Get-AttributeMap {
    param([hashtable]$RowData)

    $map = @{}
    foreach ($key in $RowData.Keys) {
        if ($key -eq '__rowNumber') {
            continue
        }

        if ($key -like 'Thuộc tính:*') {
            $attributeName = $key.Substring('Thuộc tính:'.Length).Trim()
            $attributeValue = [string]$RowData[$key]
            if (-not [string]::IsNullOrWhiteSpace($attributeValue)) {
                $map[$attributeName] = $attributeValue.Trim()
            }
        }
    }

    $rawAttributes = Get-FieldValue -RowData $RowData -FieldNames @('Thuộc tính')
    $parsedJson = Try-ParseJson $rawAttributes
    if ($null -ne $parsedJson) {
        foreach ($property in $parsedJson.PSObject.Properties) {
            $cleanName = [string]$property.Name
            if ($cleanName.StartsWith('CODE:')) {
                $cleanName = $cleanName.Substring(5)
            }
            $cleanName = $cleanName -replace '_', ' '
            if (-not $map.ContainsKey($cleanName)) {
                $map[$cleanName] = [string]$property.Value
            }
        }
    }

    return $map
}

function Get-VariantSummary {
    param([hashtable]$RowData)

    $parts = @()

    foreach ($fieldName in @('Mã SP con', 'Tên biến thể / thành phần', 'Thành phần bundle/grouped', 'Biến thể', 'Tiêu đề bundle')) {
        $value = Get-FieldValue -RowData $RowData -FieldNames @($fieldName)
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        $parsed = Try-ParseJson $value
        if ($null -ne $parsed) {
            if ($parsed -is [System.Collections.IEnumerable] -and -not ($parsed -is [string])) {
                foreach ($item in $parsed) {
                    $parts += ([string]$item)
                }
            }
            else {
                foreach ($property in $parsed.PSObject.Properties) {
                    $parts += [string]$property.Value
                }
            }
            continue
        }

        $parts += (Split-MultiValue $value)
    }

    $cleaned = @()
    $seen = @{}
    foreach ($part in $parts) {
        $text = [string]$part
        if ([string]::IsNullOrWhiteSpace($text)) {
            continue
        }

        $normalized = Normalize-MatchText $text
        if (-not $seen.ContainsKey($normalized)) {
            $seen[$normalized] = $true
            $cleaned += $text.Trim()
        }
    }

    return $cleaned
}

function Resolve-ProductRule {
    param(
        [string]$ProductName,
        [string]$CategoryText,
        [string]$ProductTypeRaw
    )

    $haystack = Normalize-MatchText ('{0} {1} {2}' -f $ProductName, $CategoryText, $ProductTypeRaw)
    foreach ($rule in $script:ProductRules) {
        if ($haystack -like ('*' + $rule.Match + '*')) {
            return $rule
        }
    }

    return @{
        Label = 'sản phẩm gốm sứ'
        UseCase = 'trưng bày hoặc sử dụng trong không gian thờ'
        UseShort = 'trưng bày hoặc sử dụng trong không gian thờ'
        Selection = 'nên ưu tiên tỷ lệ hài hòa và tông men đồng bộ với các món xung quanh'
        Space = 'không gian thờ hoặc trưng bày'
    }
}

function Resolve-MenType {
    param(
        [hashtable]$RowData,
        [hashtable]$AttributeMap,
        [string]$ProductName
    )

    $candidates = @(
        $AttributeMap['Loại men'],
        $AttributeMap['loai men'],
        $(Get-FieldValue -RowData $RowData -FieldNames @('Thuộc tính: Loại men'))
    )

    foreach ($candidate in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
            return ([string]$candidate).Trim()
        }
    }

    $normalizedName = Normalize-MatchText $ProductName
    if ($normalizedName -like '*men ran*') { return 'Men rạn' }
    if ($normalizedName -like '*men lam*') { return 'Men lam' }
    if ($normalizedName -like '*men ngoc*') { return 'Men ngọc' }
    if ($normalizedName -like '*men nau*') { return 'Men nâu' }
    if ($normalizedName -like '*men xanh*') { return 'Men xanh' }
    if ($normalizedName -like '*men trang*') { return 'Men trắng' }

    return $null
}

function Convert-ToTitleText {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }

    $culture = [Globalization.CultureInfo]::GetCultureInfo('vi-VN')
    $lower = $Text.Trim().ToLower($culture)
    return $culture.TextInfo.ToTitleCase($lower)
}

function Resolve-Motif {
    param(
        [string]$ProductName,
        [hashtable]$AttributeMap
    )

    if ($ProductName -match '\s[-–]\s(.+)$') {
        $suffix = $Matches[1].Trim()
        if ($suffix.Length -le 40 -and $suffix -notmatch '\d') {
            return Convert-ToTitleText $suffix
        }
    }

    $combined = Normalize-MatchText ('{0} {1}' -f $ProductName, ($AttributeMap.Values -join ' '))
    foreach ($hint in $script:MotifHints) {
        if ($combined -like ('*' + (Normalize-MatchText $hint) + '*')) {
            return Convert-ToTitleText $hint
        }
    }

    return $null
}

function New-KeywordList {
    param([hashtable]$Context)

    $keywords = @()
    $productName = $Context.Name
    $productKind = $Context.ProductKind
    $menType = $Context.MenType
    $motif = $Context.Motif
    $normalizedName = Normalize-MatchText $productName
    $normalizedMen = Normalize-MatchText $menType

    $keywords += $productName
    $keywords += $productKind

    if (-not [string]::IsNullOrWhiteSpace($menType)) {
        $keywords += ('{0} {1}' -f $productKind, $menType.ToLower())
        if (-not [string]::IsNullOrWhiteSpace($normalizedMen) -and $normalizedName -notlike ('*' + $normalizedMen + '*')) {
            $keywords += ('{0} {1}' -f $productName, $menType.ToLower())
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($motif)) {
        $keywords += ('{0} họa tiết {1}' -f $productKind, $motif.ToLower())
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.SizeText)) {
        $keywords += ('{0} {1}' -f $productKind, $Context.SizeText)
    }

    $keywords += ('{0} đồ thờ' -f $productKind)
    $keywords += ('{0} gốm sứ Bát Tràng' -f $productKind)
    $keywords += ('{0} bàn thờ' -f $productKind)

    $cleaned = @()
    $seen = @{}
    foreach ($keyword in $keywords) {
        if ([string]::IsNullOrWhiteSpace($keyword)) {
            continue
        }

        $text = ($keyword -replace '\s+', ' ').Trim(' ', ',', ';')
        if ([string]::IsNullOrWhiteSpace($text)) {
            continue
        }

        $normalized = Normalize-MatchText $text
        if (-not $seen.ContainsKey($normalized)) {
            $seen[$normalized] = $true
            $cleaned += $text
        }
    }

    return ($cleaned | Select-Object -First 8)
}

function Get-ReadableImageUrl {
    param([hashtable]$RowData)

    return Get-FieldValue -RowData $RowData -FieldNames @('Ảnh đại diện', 'Link ảnh', 'Link sản phẩm / ảnh')
}

function New-ProductContext {
    param(
        [hashtable]$RowData,
        $Config
    )

    $attributes = Get-AttributeMap $RowData
    $productName = Get-FieldValue -RowData $RowData -FieldNames @('Tên sản phẩm')
    $productKindRule = Resolve-ProductRule -ProductName $productName -CategoryText (Get-FieldValue -RowData $RowData -FieldNames @('Danh mục')) -ProductTypeRaw (Get-FieldValue -RowData $RowData -FieldNames @('Loại sản phẩm'))
    $weightText = Get-FirstNonEmpty @(
        $(Get-FieldValue -RowData $RowData -FieldNames @('Khối lượng')),
        $attributes['Khối lượng'],
        $attributes['khoi luong'],
        $(Get-FieldValue -RowData $RowData -FieldNames @('Thuộc tính: Khối lượng'))
    )

    $context = @{
        RowNumber = [int]$RowData['__rowNumber']
        Sku = Get-FieldValue -RowData $RowData -FieldNames @('Mã SP')
        Name = $productName
        ProductLink = Get-FieldValue -RowData $RowData -FieldNames @('Link sản phẩm', 'Link sản phẩm / ảnh')
        PriceText = Get-FirstNonEmpty @(
            $(Get-FieldValue -RowData $RowData -FieldNames @('Giá bán')),
            $(Get-FieldValue -RowData $RowData -FieldNames @('Giá'))
        )
        PriceDisplay = $null
        CategoryRaw = Get-FieldValue -RowData $RowData -FieldNames @('Danh mục')
        ProductTypeRaw = Get-FieldValue -RowData $RowData -FieldNames @('Loại sản phẩm')
        Domain = Get-FieldValue -RowData $RowData -FieldNames @('Domain')
        ImageUrl = Get-ReadableImageUrl $RowData
        GalleryImages = Split-MultiValue (Get-FieldValue -RowData $RowData -FieldNames @('Thư viện ảnh'))
        Attributes = $attributes
        ProductKind = $productKindRule.Label
        UseCase = $productKindRule.UseCase
        UseShort = $productKindRule.UseShort
        SelectionHint = $productKindRule.Selection
        Space = $productKindRule.Space
        MenType = $null
        Motif = $null
        SizeText = Get-FirstNonEmpty @(
            $attributes['Kích thước'],
            $attributes['Đường kính bát hương'],
            $attributes['Kích thước lọ hoa, lục bình'],
            $attributes['Đường kính mâm bồng, đĩa'],
            $attributes['Chiều cao'],
            $attributes['Dung tích']
        )
        DiameterText = Get-FirstNonEmpty @(
            $attributes['Đường kính bát hương'],
            $attributes['Đường kính mâm bồng, đĩa']
        )
        HeightText = $attributes['Chiều cao']
        CapacityText = $attributes['Dung tích']
        WeightText = $weightText
        WeightDisplay = Format-Weight $weightText
        VariantSummary = Get-VariantSummary $RowData
        BundleTitle = Get-FieldValue -RowData $RowData -FieldNames @('Tiêu đề bundle')
        BrandContext = Get-ObjectPropertyValue -Object (Get-ObjectPropertyValue -Object $Config -Name 'content') -Name 'defaultBrandContext' -DefaultValue 'gốm sứ Bát Tràng'
        DefaultUseContext = Get-ObjectPropertyValue -Object (Get-ObjectPropertyValue -Object $Config -Name 'content') -Name 'defaultUseContext' -DefaultValue 'đồ thờ'
    }

    $context.PriceDisplay = Format-Currency $context.PriceText
    $context.MenType = Resolve-MenType -RowData $RowData -AttributeMap $attributes -ProductName $productName
    $context.Motif = Resolve-Motif -ProductName $productName -AttributeMap $attributes

    return $context
}

function Build-SpecLines {
    param([hashtable]$Context)

    $candidates = @()
    $candidates += ('Dòng sản phẩm: {0}' -f $Context.ProductKind)

    if (-not [string]::IsNullOrWhiteSpace($Context.MenType)) {
        $candidates += ('Loại men: {0}' -f $Context.MenType)
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.Motif)) {
        $candidates += ('Họa tiết: {0}' -f $Context.Motif)
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.SizeText)) {
        $candidates += ('Kích thước: {0}' -f $Context.SizeText)
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.DiameterText) -and $Context.DiameterText -ne $Context.SizeText) {
        $candidates += ('Đường kính: {0}' -f $Context.DiameterText)
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.HeightText) -and $Context.HeightText -ne $Context.SizeText) {
        $candidates += ('Chiều cao: {0}' -f $Context.HeightText)
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.CapacityText)) {
        $candidates += ('Dung tích: {0}' -f $Context.CapacityText)
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.WeightDisplay)) {
        $candidates += ('Khối lượng: {0}' -f $Context.WeightDisplay)
    }

    $candidates += ('Công năng: {0}' -f $Context.UseShort)
    $candidates += ('Phù hợp: {0}' -f $Context.Space)

    if ($Context.VariantSummary.Count -gt 0) {
        $variantText = ($Context.VariantSummary | Select-Object -First 2) -join ', '
        $candidates += ('Biến thể liên quan: {0}' -f $variantText)
    }

    $result = @()
    $seen = @{}
    foreach ($candidate in $candidates) {
        $text = $candidate.Trim()
        if ([string]::IsNullOrWhiteSpace($text)) {
            continue
        }

        $normalized = Normalize-MatchText $text
        if (-not $seen.ContainsKey($normalized)) {
            $seen[$normalized] = $true
            $result += $text
        }
    }

    $finalLines = $result | Select-Object -First 7
    if ($finalLines.Count -lt 3) {
        $finalLines += 'Chất liệu: Gốm sứ'
        $finalLines += ('Ngữ cảnh: {0}' -f $Context.DefaultUseContext)
    }

    return ($finalLines | Select-Object -First 7) -join "`n"
}

function Build-HighlightItems {
    param([hashtable]$Context)

    $items = @()

    if (-not [string]::IsNullOrWhiteSpace($Context.MenType)) {
        $items += ('Thuộc dòng {0}, hợp không gian thờ truyền thống và dễ phối cùng các món đồng bộ.' -f $Context.MenType.ToLower())
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.Motif)) {
        $items += ('Điểm nhấn họa tiết {0} tạo cảm giác mềm mại, trang nhã và gần với tinh thần đồ thờ Việt.' -f $Context.Motif.ToLower())
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.SizeText)) {
        $items += ('Thông số tham khảo hiện có: {0}, thuận tiện hơn khi phối cùng bộ thờ sẵn có.' -f $Context.SizeText)
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.WeightDisplay)) {
        $items += ('Khối lượng tham khảo khoảng {0}, đủ gọn để bày trí và di chuyển khi vệ sinh bàn thờ.' -f $Context.WeightDisplay)
    }

    $items += ('Công năng chính là {0}, phù hợp với {1}.' -f $Context.UseShort, $Context.Space)

    if ($Context.VariantSummary.Count -gt 0) {
        $variantPreview = ($Context.VariantSummary | Select-Object -First 3) -join ', '
        $items += ('Dữ liệu file có thêm biến thể hoặc thành phần liên quan như {0}, giúp nội dung bám sát sản phẩm hơn.' -f $variantPreview)
    }

    return ($items | Select-Object -First 4)
}

function Build-DetailSentence {
    param([hashtable]$Context)

    $parts = @()
    if (-not [string]::IsNullOrWhiteSpace($Context.SizeText)) {
        $parts += ('Thông số đang có là {0}' -f $Context.SizeText)
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.WeightDisplay)) {
        $parts += ('khối lượng tham khảo khoảng {0}' -f $Context.WeightDisplay)
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.PriceDisplay)) {
        $parts += ('mức giá tham khảo {0}' -f $Context.PriceDisplay)
    }

    if ($Context.VariantSummary.Count -gt 0) {
        $variantPreview = ($Context.VariantSummary | Select-Object -First 3) -join ', '
        $parts += ('dữ liệu biến thể/thành phần liên quan gồm {0}' -f $variantPreview)
    }

    if ($parts.Count -eq 0) {
        return 'Nội dung được suy luận từ tên gọi, danh mục và thuộc tính sẵn có để bám đúng ngữ cảnh sản phẩm.'
    }

    $sentence = (($parts -join '; ') + '.')
    return ($sentence.Substring(0, 1).ToUpper() + $sentence.Substring(1))
}

function Build-ImageHtml {
    param(
        [hashtable]$Context,
        $Config
    )

    $contentConfig = Get-ObjectPropertyValue -Object $Config -Name 'content'
    $includeImage = Get-ObjectPropertyValue -Object $contentConfig -Name 'includeImageInDescription' -DefaultValue $true
    if (-not $includeImage) {
        return ''
    }

    $imageUrl = $Context.ImageUrl
    if ([string]::IsNullOrWhiteSpace($imageUrl) -and $Context.GalleryImages.Count -gt 0) {
        $imageUrl = $Context.GalleryImages[0]
    }

    if ([string]::IsNullOrWhiteSpace($imageUrl)) {
        return ''
    }

    return ('<p><img src="{0}" alt="{1}" /></p>' -f (Escape-Html $imageUrl), (Escape-Html $Context.Name))
}

function New-HtmlDescription {
    param(
        [hashtable]$Context,
        $Config
    )

    $seed = Get-FirstNonEmpty @($Context.Sku, $Context.Name, [string]$Context.RowNumber)
    $introTemplate = Select-SeededText -Seed ($seed + '-intro') -Options $script:IntroTemplates
    $detailTemplate = Select-SeededText -Seed ($seed + '-detail') -Options $script:DetailTemplates
    $selectionTemplate = Select-SeededText -Seed ($seed + '-selection') -Options $script:SelectionTemplates

    $intro = [string]::Format($introTemplate, $Context.Name, $Context.UseCase)

    $menSuffix = if (-not [string]::IsNullOrWhiteSpace($Context.MenType)) { ' với điểm nhấn ' + $Context.MenType.ToLower() } else { '' }
    $detailSentence = Build-DetailSentence $Context
    $detail = [string]::Format($detailTemplate, $Context.ProductKind, $menSuffix, $detailSentence)

    $selectionTail = if (-not [string]::IsNullOrWhiteSpace($Context.Motif)) {
        'Nếu muốn giữ tổng thể mềm và có điểm nhấn, nên phối họa tiết ' + $Context.Motif.ToLower() + ' cùng các món cùng dòng men.'
    }
    else {
        'Ưu tiên cùng tông men hoặc cùng nhóm sản phẩm để bàn thờ nhìn liền mạch và đỡ rối mắt.'
    }
    $selection = [string]::Format($selectionTemplate, $Context.ProductKind, $Context.SelectionHint, $selectionTail)

    $highlights = Build-HighlightItems $Context
    $highlightHtml = @()
    foreach ($item in $highlights) {
        $highlightHtml += ('<li>{0}</li>' -f (Escape-Html $item))
    }

    $imageHtml = Build-ImageHtml -Context $Context -Config $Config

    $htmlParts = @()
    $htmlParts += ('<p>{0}</p>' -f (Escape-Html $intro))
    if (-not [string]::IsNullOrWhiteSpace($imageHtml)) {
        $htmlParts += $imageHtml
    }
    $htmlParts += '<h3>Điểm nổi bật</h3>'
    $htmlParts += ('<ul>{0}</ul>' -f ($highlightHtml -join ''))
    $htmlParts += '<h3>Mô tả chi tiết</h3>'
    $htmlParts += ('<p>{0}</p>' -f (Escape-Html $detail))
    $htmlParts += '<h3>Ứng dụng và cách chọn</h3>'
    $htmlParts += ('<p>{0}</p>' -f (Escape-Html $selection))

    return $htmlParts -join ''
}

function New-SeoTitle {
    param([hashtable]$Context)

    $options = @(
        ('{0} cho {1}' -f $Context.Name, $Context.DefaultUseContext),
        ('{0} {1}' -f $Context.Name, $Context.ProductKind),
        ('{0} chuẩn {1}' -f $Context.Name, $Context.BrandContext)
    )

    foreach ($option in $options) {
        $title = ($option -replace '\s+', ' ').Trim()
        if ($title.Length -le 68) {
            return $title
        }
    }

    return Truncate-AtWord -Text $options[0] -MaxLength 68
}

function New-SeoDescription {
    param([hashtable]$Context)

    $parts = @()
    $parts += $Context.Name
    $parts += ('phù hợp để {0}' -f $Context.UseShort)

    if (-not [string]::IsNullOrWhiteSpace($Context.MenType)) {
        $parts += ('nổi bật với {0}' -f $Context.MenType.ToLower())
    }

    if (-not [string]::IsNullOrWhiteSpace($Context.Motif)) {
        $parts += ('điểm nhấn {0}' -f $Context.Motif.ToLower())
    }

    $parts += 'giúp bàn thờ đồng bộ và trang nghiêm hơn'

    $description = ($parts -join ', ') + '.'
    return Truncate-AtWord -Text $description -MaxLength 158
}

function New-SeoPayload {
    param(
        [hashtable]$RowData,
        $Config
    )

    $context = New-ProductContext -RowData $RowData -Config $Config
    return @{
        'Thông số kỹ thuật' = Build-SpecLines $context
        'Mô tả' = New-HtmlDescription -Context $context -Config $Config
        'SEO title' = New-SeoTitle $context
        'SEO description' = New-SeoDescription $context
        'SEO keywords' = (New-KeywordList $context) -join ', '
        '__context' = $context
    }
}

function Update-WorksheetDimension {
    param(
        [xml]$SheetXml,
        [hashtable]$HeaderMap,
        [int]$MaxRowNumber
    )

    $maxColumnIndex = 0
    foreach ($columnLetters in $HeaderMap.Values) {
        $columnIndex = Convert-ColumnLettersToIndex $columnLetters
        if ($columnIndex -gt $maxColumnIndex) {
            $maxColumnIndex = $columnIndex
        }
    }

    $maxColumnLetters = Convert-ColumnIndexToLetters $maxColumnIndex
    if ($SheetXml.worksheet.dimension) {
        $SheetXml.worksheet.dimension.ref = ('A1:{0}{1}' -f $maxColumnLetters, $MaxRowNumber)
        return
    }

    $worksheetNamespace = $SheetXml.DocumentElement.NamespaceURI
    $dimensionNode = $SheetXml.CreateElement('dimension', $worksheetNamespace)
    $dimensionNode.SetAttribute('ref', ('A1:{0}{1}' -f $maxColumnLetters, $MaxRowNumber))
    $worksheetNode = $SheetXml.worksheet
    if ($worksheetNode.FirstChild) {
        [void]$worksheetNode.InsertBefore($dimensionNode, $worksheetNode.FirstChild)
    }
    else {
        [void]$worksheetNode.AppendChild($dimensionNode)
    }
}

function Get-OutputPath {
    param(
        [string]$InputPath,
        [string]$OutputMode,
        [string]$OutputDir,
        [string]$ConfiguredOutputFileName
    )

    if ($OutputMode -eq 'overwrite') {
        return $InputPath
    }

    Ensure-Directory $OutputDir
    if (-not [string]::IsNullOrWhiteSpace($ConfiguredOutputFileName)) {
        return (Join-Path $OutputDir $ConfiguredOutputFileName)
    }

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($InputPath)
    return (Join-Path $OutputDir ($baseName + '-seo-filled.xlsx'))
}

function Resolve-InputWorkbook {
    param(
        [string]$InputDirectory,
        [string]$PreferredInputFile,
        [string]$Pattern,
        [bool]$ProcessLatest,
        [string]$InputOverride,
        [bool]$ForceLatestSelection
    )

    if (-not [string]::IsNullOrWhiteSpace($InputOverride)) {
        $resolved = Resolve-AbsolutePath -BaseDir $InputDirectory -CandidatePath $InputOverride
        if (-not (Test-Path -LiteralPath $resolved)) {
            throw ('Không tìm thấy file input được truyền vào: {0}' -f $resolved)
        }
        return (Get-Item -LiteralPath $resolved)
    }

    if (-not [string]::IsNullOrWhiteSpace($PreferredInputFile) -and -not $ForceLatestSelection) {
        $resolvedPreferred = Resolve-AbsolutePath -BaseDir $InputDirectory -CandidatePath $PreferredInputFile
        if (Test-Path -LiteralPath $resolvedPreferred) {
            return (Get-Item -LiteralPath $resolvedPreferred)
        }
        throw ('Không tìm thấy preferredInputFile: {0}' -f $resolvedPreferred)
    }

    $files = @(Get-ChildItem -LiteralPath $InputDirectory -File -Filter $Pattern | Where-Object { -not $_.Name.StartsWith('~$') } | Sort-Object LastWriteTime -Descending)
    if ($files.Count -eq 0) {
        throw ('Không tìm thấy file Excel nào trong thư mục {0} với pattern {1}.' -f $InputDirectory, $Pattern)
    }

    if ($ProcessLatest -or $ForceLatestSelection) {
        return $files[0]
    }

    return $files[0]
}

function Compress-DirectoryToXlsx {
    param(
        [string]$SourceDirectory,
        [string]$DestinationFile
    )

    if (Test-Path -LiteralPath $DestinationFile) {
        Remove-Item -LiteralPath $DestinationFile -Force
    }

    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $SourceDirectory,
        $DestinationFile,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )
}

$configFullPath = Resolve-AbsolutePath -BaseDir $PSScriptRoot -CandidatePath $ConfigPath
if (-not (Test-Path -LiteralPath $configFullPath)) {
    throw ('Không tìm thấy config: {0}' -f $configFullPath)
}

$config = Get-Content -LiteralPath $configFullPath -Raw -Encoding UTF8 | ConvertFrom-Json
$inputDirectory = Resolve-AbsolutePath -BaseDir $PSScriptRoot -CandidatePath (Get-ObjectPropertyValue -Object $config -Name 'inputDir' -DefaultValue '.')
$preferredInputFile = Get-ObjectPropertyValue -Object $config -Name 'preferredInputFile' -DefaultValue ''
$inputPattern = Get-ObjectPropertyValue -Object $config -Name 'inputPattern' -DefaultValue '*.xlsx'
$processLatestFile = [bool](Get-ObjectPropertyValue -Object $config -Name 'processLatestFile' -DefaultValue $true)
$sheetName = Get-ObjectPropertyValue -Object $config -Name 'sheetName' -DefaultValue ''
$outputMode = (Get-ObjectPropertyValue -Object $config -Name 'outputMode' -DefaultValue 'new').ToLowerInvariant()
$outputDirectory = Resolve-AbsolutePath -BaseDir $PSScriptRoot -CandidatePath (Get-ObjectPropertyValue -Object $config -Name 'outputDir' -DefaultValue './output')
$outputFileName = Get-ObjectPropertyValue -Object $config -Name 'outputFileName' -DefaultValue ''
$logDirectory = Resolve-AbsolutePath -BaseDir $PSScriptRoot -CandidatePath (Get-ObjectPropertyValue -Object $config -Name 'logDir' -DefaultValue './logs')
$overwriteExistingSeo = [bool](Get-ObjectPropertyValue -Object $config -Name 'overwriteExistingSeo' -DefaultValue $true)

Ensure-Directory $logDirectory
$script:LogPath = Join-Path $logDirectory ('seo-batch-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
New-Item -ItemType File -Path $script:LogPath -Force | Out-Null

$tempExtractRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('seo-batch-' + [guid]::NewGuid().ToString('N'))

try {
    $inputFileInfo = Resolve-InputWorkbook -InputDirectory $inputDirectory -PreferredInputFile $preferredInputFile -Pattern $inputPattern -ProcessLatest $processLatestFile -InputOverride $InputFile -ForceLatestSelection ([bool]$ForceLatest)
    $outputFilePath = Get-OutputPath -InputPath $inputFileInfo.FullName -OutputMode $outputMode -OutputDir $outputDirectory -ConfiguredOutputFileName $outputFileName

    Write-Log -Level 'INFO' -Message ('File đang xử lý: {0}' -f $inputFileInfo.FullName)
    Write-Log -Level 'INFO' -Message ('File output sẽ ghi vào: {0}' -f $outputFilePath)

    Ensure-Directory $tempExtractRoot
    [System.IO.Compression.ZipFile]::ExtractToDirectory($inputFileInfo.FullName, $tempExtractRoot)

    [xml]$workbookXml = Get-Content -LiteralPath (Join-Path $tempExtractRoot 'xl\workbook.xml') -Raw -Encoding UTF8
    [xml]$workbookRelsXml = Get-Content -LiteralPath (Join-Path $tempExtractRoot 'xl\_rels\workbook.xml.rels') -Raw -Encoding UTF8
    $sheetInfo = Get-OpenXmlSheetPath -ExtractedRoot $tempExtractRoot -WorkbookXml $workbookXml -RelationshipXml $workbookRelsXml -RequestedSheetName $sheetName
    $sharedStrings = Load-SharedStrings -SharedStringsPath (Join-Path $tempExtractRoot 'xl\sharedStrings.xml')

    Write-Log -Level 'INFO' -Message ('Worksheet được chọn: {0}' -f $sheetInfo.Name)

    [xml]$sheetXml = Get-Content -LiteralPath $sheetInfo.Path -Raw -Encoding UTF8
    $rows = @($sheetXml.worksheet.sheetData.row)
    if ($rows.Count -lt 1) {
        throw 'Worksheet không có dòng header.'
    }

    $headerRow = $rows | Where-Object { [int]$_.r -eq 1 } | Select-Object -First 1
    if ($null -eq $headerRow) {
        throw 'Không tìm thấy dòng header (row 1).'
    }

    $headerMap = Get-HeaderMap -HeaderRow $headerRow -SharedStrings $sharedStrings
    $headerMap = Ensure-TargetHeaders -SheetXml $sheetXml -HeaderRow $headerRow -HeaderMap $headerMap -TargetHeaders $script:TargetSeoHeaders

    $maxRowNumber = 1
    foreach ($row in $rows) {
        $rowNumber = [int]$row.r
        if ($rowNumber -gt $maxRowNumber) {
            $maxRowNumber = $rowNumber
        }

        if ($rowNumber -eq 1) {
            continue
        }

        $rowData = Get-RowData -Row $row -HeaderMap $headerMap -SharedStrings $sharedStrings
        if (-not (Test-RowHasContent $rowData)) {
            continue
        }

        $sku = Get-FieldValue -RowData $rowData -FieldNames @('Mã SP')
        $productName = Get-FieldValue -RowData $rowData -FieldNames @('Tên sản phẩm')

        if ([string]::IsNullOrWhiteSpace($sku) -and [string]::IsNullOrWhiteSpace($productName)) {
            Write-Log -Level 'WARN' -Message ('Bỏ qua dòng {0} vì không có Mã SP và Tên sản phẩm.' -f $rowNumber)
            continue
        }

        try {
            $payload = New-SeoPayload -RowData $rowData -Config $config
            $rowStyleHint = Get-RowStyleHint -Row $row -FallbackStyle $null

            foreach ($targetHeader in $script:TargetSeoHeaders) {
                $existingValue = Get-FieldValue -RowData $rowData -FieldNames @($targetHeader)
                if (-not $overwriteExistingSeo -and -not [string]::IsNullOrWhiteSpace($existingValue)) {
                    continue
                }

                $columnLetters = $headerMap[$targetHeader]
                $targetCell = Get-OrCreateCell -SheetXml $sheetXml -Row $row -ColumnLetters $columnLetters -StyleHint $rowStyleHint
                $cellStyle = Get-CellStyle $targetCell
                if ([string]::IsNullOrWhiteSpace($cellStyle)) {
                    $cellStyle = $rowStyleHint
                }
                Set-CellInlineString -SheetXml $sheetXml -Cell $targetCell -Value ([string]$payload[$targetHeader]) -StyleHint $cellStyle
            }

            $script:RowsProcessed++
            Write-Log -Level 'INFO' -Message ('Đã xử lý dòng {0}: {1}' -f $rowNumber, $productName) -Sku $sku
        }
        catch {
            $script:RowsErrored++
            Write-Log -Level 'ERROR' -Message ('Lỗi dòng {0}: {1}' -f $rowNumber, $_.Exception.Message) -Sku $sku
        }
    }

    Update-WorksheetDimension -SheetXml $sheetXml -HeaderMap $headerMap -MaxRowNumber $maxRowNumber
    Save-XmlDocument -Document $sheetXml -Path $sheetInfo.Path

    if ($outputMode -eq 'overwrite') {
        if (Test-Path -LiteralPath $outputFilePath) {
            Remove-Item -LiteralPath $outputFilePath -Force
        }
        Compress-DirectoryToXlsx -SourceDirectory $tempExtractRoot -DestinationFile $outputFilePath
    }
    else {
        Ensure-Directory (Split-Path -Path $outputFilePath -Parent)
        Compress-DirectoryToXlsx -SourceDirectory $tempExtractRoot -DestinationFile $outputFilePath
    }

    Write-Log -Level 'INFO' -Message ('Tổng sản phẩm đã xử lý: {0}' -f $script:RowsProcessed)
    Write-Log -Level 'INFO' -Message ('Tổng sản phẩm lỗi: {0}' -f $script:RowsErrored)
    Write-Log -Level 'INFO' -Message ('Hoàn tất. Output: {0}' -f $outputFilePath)
}
finally {
    if (Test-Path -LiteralPath $tempExtractRoot) {
        Remove-Item -LiteralPath $tempExtractRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}



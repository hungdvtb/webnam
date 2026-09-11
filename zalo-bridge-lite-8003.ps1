param(
    [int] $Port = 8003,
    [switch] $SelfTest
)

$ErrorActionPreference = 'Stop'
$script:BridgeVersion = '2026.09.10.1'
$script:BridgeStartedAt = Get-Date

function Write-BridgeLog {
    param([string] $Message)

    Write-Host ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
}

if (-not ('Win32LiteBridge' -as [type])) {
    Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class Win32LiteBridge
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
}

Add-Type -AssemblyName System.Windows.Forms | Out-Null

try {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
} catch {
    # Older Windows builds may not expose the enum; the default protocol still applies.
}

$script:AllowedOrigins = @(
    'http://localhost:3003',
    'http://127.0.0.1:3003',
    'https://admin.gomdaithanh.com',
    'http://admin.gomdaithanh.com'
)

$script:BrowserProcessNames = @('chrome', 'msedge', 'firefox', 'browser', 'coccoc', 'brave')

function Test-ContainsText {
    param(
        [string] $Text,
        [string] $Needle
    )

    if ([string]::IsNullOrWhiteSpace($Text) -or [string]::IsNullOrWhiteSpace($Needle)) {
        return $false
    }

    return $Text.IndexOf($Needle, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Test-ContainsAnyText {
    param(
        [string] $Text,
        [string[]] $Needles
    )

    foreach ($needle in $Needles) {
        if (Test-ContainsText $Text $needle) {
            return $true
        }
    }

    return $false
}

function ConvertTo-StringArray {
    param(
        $Value,
        [string[]] $Fallback
    )

    $items = @()
    if ($null -eq $Value) {
        $items = @()
    } elseif ($Value -is [array]) {
        $items = $Value
    } else {
        $items = @($Value)
    }

    $normalized = @($items | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne '' })
    if ($normalized.Count -gt 0) {
        return [string[]] $normalized
    }

    return [string[]] $Fallback
}

function ConvertTo-BridgeBool {
    param(
        $Value,
        [bool] $Default
    )

    if ($null -eq $Value) {
        return $Default
    }

    if ($Value -is [bool]) {
        return [bool] $Value
    }

    $text = "$Value".Trim().ToLowerInvariant()
    return @('1', 'true', 'yes', 'on') -contains $text
}

function Get-BridgeValue {
    param(
        $Object,
        [string] $Name,
        $Default
    )

    if ($null -eq $Object -or [string]::IsNullOrWhiteSpace($Name)) {
        return $Default
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        return $Default
    }

    return $property.Value
}

function Limit-Number {
    param(
        [int] $Value,
        [int] $Min,
        [int] $Max
    )

    return [Math]::Min([Math]::Max($Value, $Min), $Max)
}

function Release-BridgeModifierKeys {
    $keyUp = 0x0002
    foreach ($key in @(0x10, 0x11, 0x12, 0x5B, 0x5C)) {
        try {
            [Win32LiteBridge]::keybd_event([byte] $key, [byte] 0, [uint32] $keyUp, [UIntPtr]::Zero)
        } catch {
            # Best-effort cleanup only.
        }
    }
}

function Send-BridgeKey {
    param([byte] $VirtualKey)

    $keyUp = 0x0002
    [Win32LiteBridge]::keybd_event($VirtualKey, [byte] 0, [uint32] 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    [Win32LiteBridge]::keybd_event($VirtualKey, [byte] 0, [uint32] $keyUp, [UIntPtr]::Zero)
}

function Send-BridgePaste {
    $keyUp = 0x0002
    Release-BridgeModifierKeys
    [Win32LiteBridge]::keybd_event([byte] 0x11, [byte] 0, [uint32] 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    [Win32LiteBridge]::keybd_event([byte] 0x56, [byte] 0, [uint32] 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    [Win32LiteBridge]::keybd_event([byte] 0x56, [byte] 0, [uint32] $keyUp, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    [Win32LiteBridge]::keybd_event([byte] 0x11, [byte] 0, [uint32] $keyUp, [UIntPtr]::Zero)
    Release-BridgeModifierKeys
}

function Invoke-ClipboardWrite {
    param([scriptblock] $Action)

    $lastError = $null
    for ($attempt = 0; $attempt -lt 10; $attempt += 1) {
        try {
            & $Action
            return
        } catch {
            $lastError = $_
            Start-Sleep -Milliseconds (80 + ($attempt * 80))
        }
    }

    throw "Cannot write Windows clipboard: $($lastError.Exception.Message)"
}

function Set-BridgeClipboardText {
    param([string] $Text)

    if ($null -eq $Text) {
        return $false
    }

    Invoke-ClipboardWrite {
        [System.Windows.Forms.Clipboard]::SetText($Text, [System.Windows.Forms.TextDataFormat]::UnicodeText)
    }

    return $true
}

function Clear-OldBridgeTempDirectories {
    param([string] $Root)

    if (-not (Test-Path -LiteralPath $Root)) {
        return
    }

    try {
        Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-2) } |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        # Temp cleanup should never block sending.
    }
}

function New-BridgeTempDirectory {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) 'WebnamZaloBridge\clipboard'
    [void] [System.IO.Directory]::CreateDirectory($root)
    Clear-OldBridgeTempDirectories $root

    $directory = Join-Path $root ([Guid]::NewGuid().ToString('N'))
    [void] [System.IO.Directory]::CreateDirectory($directory)

    return $directory
}

function Resolve-BridgeDownloadExtension {
    param(
        [string] $Url,
        [string] $ContentType
    )

    $allowedExtensions = @('.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.mp4', '.mov', '.webm', '.mkv', '.avi')
    try {
        $extension = [System.IO.Path]::GetExtension(([Uri] $Url).AbsolutePath).ToLowerInvariant()
        if ($allowedExtensions -contains $extension) {
            return $extension
        }
    } catch {
        # Fall back to content type below.
    }

    $normalizedType = "$ContentType".Split(';')[0].Trim().ToLowerInvariant()
    switch ($normalizedType) {
        'image/png' { return '.png' }
        'image/webp' { return '.webp' }
        'image/gif' { return '.gif' }
        'image/bmp' { return '.bmp' }
        'image/x-ms-bmp' { return '.bmp' }
        'video/mp4' { return '.mp4' }
        'video/quicktime' { return '.mov' }
        'video/webm' { return '.webm' }
        'video/x-matroska' { return '.mkv' }
        'video/x-msvideo' { return '.avi' }
        default { return '.jpg' }
    }
}

function Save-BridgeUrlToFile {
    param(
        [string] $Url,
        [string] $Directory,
        [int] $Index
    )

    if ([string]::IsNullOrWhiteSpace($Url)) {
        throw 'Media URL is empty.'
    }

    try {
        $uri = [Uri] $Url
        if (-not (@('http', 'https') -contains $uri.Scheme.ToLowerInvariant())) {
            throw 'Media URL must be http or https.'
        }
    } catch {
        throw "Invalid media URL: $Url"
    }

    $request = [System.Net.HttpWebRequest] [System.Net.WebRequest]::Create($Url)
    $request.Method = 'GET'
    $request.UserAgent = 'Mozilla/5.0 WebnamZaloBridge/1.0'
    $request.Timeout = 45000
    $request.ReadWriteTimeout = 45000
    $request.AllowAutoRedirect = $true
    $response = $null

    try {
        Write-BridgeLog ("Downloading media #{0}: {1}" -f $Index, $Url)
        $response = [System.Net.HttpWebResponse] $request.GetResponse()
        $statusCode = [int] $response.StatusCode
        if ($statusCode -lt 200 -or $statusCode -ge 300) {
            throw "HTTP $statusCode"
        }

        $contentType = "$($response.ContentType)"
        $extension = Resolve-BridgeDownloadExtension $Url $contentType
        $path = Join-Path $Directory ('zalo-bridge-media-{0:D2}{1}' -f $Index, $extension)
        $inputStream = $response.GetResponseStream()
        $outputStream = [System.IO.File]::Open($path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
        try {
            $buffer = New-Object byte[] 81920
            while ($true) {
                $read = $inputStream.Read($buffer, 0, $buffer.Length)
                if ($read -le 0) {
                    break
                }
                $outputStream.Write($buffer, 0, $read)
            }
        } finally {
            if ($null -ne $outputStream) {
                $outputStream.Dispose()
            }
            if ($null -ne $inputStream) {
                $inputStream.Dispose()
            }
        }

        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -le 0) {
            throw 'Downloaded media file is empty.'
        }

        Write-BridgeLog ("Saved media #{0}: {1}" -f $Index, $path)
        return $path
    } catch {
        $shortUrl = if ($Url.Length -gt 160) { $Url.Substring(0, 160) + '...' } else { $Url }
        throw ("Cannot download media #{0}: {1}. {2}" -f $Index, $shortUrl, $_.Exception.Message)
    } finally {
        if ($null -ne $response) {
            $response.Dispose()
        }
    }
}

function Set-BridgeClipboardFiles {
    param([string[]] $Paths)

    $existingPaths = @($Paths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Leaf) })
    if ($existingPaths.Count -eq 0) {
        return 0
    }

    $collection = New-Object System.Collections.Specialized.StringCollection
    foreach ($path in $existingPaths) {
        [void] $collection.Add((Resolve-Path -LiteralPath $path).Path)
    }

    Invoke-ClipboardWrite {
        [System.Windows.Forms.Clipboard]::SetFileDropList($collection)
    }

    return $existingPaths.Count
}

function Set-BridgeClipboardPayload {
    param($Payload)

    $filePaths = @()
    $providedPaths = ConvertTo-StringArray (Get-BridgeValue $Payload 'file_paths' @()) @()
    foreach ($path in $providedPaths) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            $filePaths += (Resolve-Path -LiteralPath $path).Path
        }
    }

    $mediaUrls = @()
    $mediaUrls += ConvertTo-StringArray (Get-BridgeValue $Payload 'image_urls' @()) @()
    $mediaUrls += ConvertTo-StringArray (Get-BridgeValue $Payload 'media_urls' @()) @()
    $mediaUrls += ConvertTo-StringArray (Get-BridgeValue $Payload 'video_urls' @()) @()

    if ($mediaUrls.Count -gt 0) {
        $tempDirectory = New-BridgeTempDirectory
        Write-BridgeLog ("Preparing {0} media file(s) for clipboard." -f $mediaUrls.Count)
        for ($index = 0; $index -lt $mediaUrls.Count; $index += 1) {
            $filePaths += Save-BridgeUrlToFile $mediaUrls[$index] $tempDirectory ($index + 1)
        }
    }

    if ($filePaths.Count -gt 0) {
        Write-BridgeLog ("Writing {0} file(s) to clipboard." -f $filePaths.Count)
        return @{
            type = 'files'
            count = Set-BridgeClipboardFiles ([string[]] $filePaths)
        }
    }

    $textValue = Get-BridgeValue $Payload 'text' $null
    if ($null -ne $textValue -and "$textValue" -ne '') {
        Write-BridgeLog ("Writing text to clipboard. Length: {0}" -f "$textValue".Length)
        [void] (Set-BridgeClipboardText "$textValue")
        return @{
            type = 'text'
            count = 1
        }
    }

    return @{
        type = 'existing'
        count = 0
    }
}

function Normalize-ZaloTarget {
    param($Target)

    $text = "$Target".Trim().ToLowerInvariant()
    if (@('web', 'chrome', 'zalo_web', 'zalo-web') -contains $text) {
        return 'web'
    }

    return 'pc'
}

function Get-ZaloKeywords {
    param([string] $Target)

    if ((Normalize-ZaloTarget $Target) -eq 'web') {
        return @('Zalo -', 'chat.zalo.me', 'web.zalo.me')
    }

    return @('Zalo')
}

function Test-BrowserProcess {
    param([string] $ProcessName)

    $normalized = "$ProcessName".Trim().ToLowerInvariant()
    foreach ($name in $script:BrowserProcessNames) {
        if ($normalized -eq $name) {
            return $true
        }
    }

    return $false
}

function Get-TopLevelWindows {
    $script:LiteBridgeWindows = @()

    $callback = [Win32LiteBridge+EnumWindowsProc] {
        param([IntPtr] $Handle, [IntPtr] $Param)

        try {
            if (-not [Win32LiteBridge]::IsWindowVisible($Handle)) {
                return $true
            }

            $length = [Win32LiteBridge]::GetWindowTextLength($Handle)
            if ($length -le 0) {
                return $true
            }

            $titleBuilder = New-Object System.Text.StringBuilder -ArgumentList ($length + 1)
            [void] [Win32LiteBridge]::GetWindowText($Handle, $titleBuilder, $titleBuilder.Capacity)
            $title = $titleBuilder.ToString().Trim()
            if ($title -eq '') {
                return $true
            }

            [uint32] $processId = 0
            [void] [Win32LiteBridge]::GetWindowThreadProcessId($Handle, [ref] $processId)
            $processName = ''
            try {
                $processName = (Get-Process -Id ([int] $processId) -ErrorAction Stop).ProcessName
            } catch {
                $processName = ''
            }

            $rect = New-Object Win32LiteBridge+RECT
            [void] [Win32LiteBridge]::GetWindowRect($Handle, [ref] $rect)
            $windowWidth = [int] [Math]::Max(0, $rect.Right - $rect.Left)
            $windowHeight = [int] [Math]::Max(0, $rect.Bottom - $rect.Top)

            $script:LiteBridgeWindows += [pscustomobject] @{
                Handle = $Handle
                Title = $title
                ProcessId = [int] $processId
                ProcessName = $processName
                Left = [int] $rect.Left
                Top = [int] $rect.Top
                Width = $windowWidth
                Height = $windowHeight
            }
        } catch {
            return $true
        }

        return $true
    }

    [void] [Win32LiteBridge]::EnumWindows($callback, [IntPtr]::Zero)
    $windows = @($script:LiteBridgeWindows)
    Remove-Variable -Scope Script -Name LiteBridgeWindows -ErrorAction SilentlyContinue

    return $windows
}

function Get-ZaloWindowScore {
    param(
        $Window,
        [string] $Target,
        [string[]] $Keywords
    )

    $score = 0
    foreach ($keyword in $Keywords) {
        if (Test-ContainsText $Window.Title $keyword) {
            $score += 20
        }
    }

    if (Test-ContainsText $Window.Title 'Sidebar') {
        $score -= 120
    }

    if (Test-ContainsText $Window.Title 'quick-replies') {
        $score -= 120
    }

    $isBrowser = Test-BrowserProcess $Window.ProcessName
    if ($Target -eq 'web') {
        if ($isBrowser) {
            $score += 80
        }
        if (Test-ContainsText $Window.Title 'Zalo -') {
            $score += 40
        }
        if ((Test-ContainsText $Window.Title 'chat.zalo') -or (Test-ContainsText $Window.Title 'web.zalo')) {
            $score += 40
        }
    } else {
        if (-not $isBrowser) {
            $score += 80
        }
        if (Test-ContainsText $Window.ProcessName 'Zalo') {
            $score += 120
        }
        if (Test-ContainsText $Window.Title 'Zalo -') {
            $score += 30
        }
    }

    return $score
}

function Find-ZaloWindow {
    param(
        [string] $Target,
        [string[]] $Keywords
    )

    $targetName = Normalize-ZaloTarget $Target
    $fallbackKeywords = Get-ZaloKeywords $targetName
    $keywordsToUse = ConvertTo-StringArray $Keywords $fallbackKeywords
    $matches = @()

    foreach ($window in (Get-TopLevelWindows)) {
        if (-not (Test-ContainsAnyText $window.Title $keywordsToUse)) {
            continue
        }

        $score = Get-ZaloWindowScore $window $targetName $keywordsToUse
        if ($score -gt 0) {
            $matches += [pscustomobject] @{ Window = $window; Score = $score }
        }
    }

    return ($matches | Sort-Object -Property Score -Descending | Select-Object -First 1).Window
}

function Find-PanelWindow {
    param([string[]] $Keywords)

    $fallback = @('Sidebar', 'quick-replies', 'admin.gomdaithanh.com', 'localhost:3003')
    $keywordsToUse = ConvertTo-StringArray $Keywords $fallback
    $matches = @()
    $windows = @(Get-TopLevelWindows)

    foreach ($window in $windows) {
        if (-not (Test-ContainsAnyText $window.Title $keywordsToUse)) {
            continue
        }

        $score = 20
        foreach ($keyword in $keywordsToUse) {
            if (Test-ContainsText $window.Title $keyword) {
                $score += 20
            }
        }

        if (Test-ContainsText $window.Title 'Sidebar') {
            $score += 80
        }
        if (Test-ContainsText $window.Title 'quick-replies') {
            $score += 60
        }
        if (Test-BrowserProcess $window.ProcessName) {
            $score += 20
        }

        $matches += [pscustomobject] @{ Window = $window; Score = $score }
    }

    if ($matches.Count -gt 0) {
        return ($matches | Sort-Object -Property Score -Descending | Select-Object -First 1).Window
    }

    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $rightEdgeStart = [int] ($screen.Left + [Math]::Max(0, $screen.Width - 760))
    foreach ($window in $windows) {
        if (-not (Test-BrowserProcess $window.ProcessName)) {
            continue
        }

        if ((Test-ContainsText $window.Title 'Zalo -') -or (Test-ContainsText $window.Title 'chat.zalo') -or (Test-ContainsText $window.Title 'DevTools')) {
            continue
        }

        $score = 0
        if ($window.Width -ge 280 -and $window.Width -le 700) {
            $score += 80
        }
        if ($window.Left -ge $rightEdgeStart) {
            $score += 80
        }
        if ($window.Height -ge [Math]::Max(300, [int] ($screen.Height * 0.6))) {
            $score += 20
        }
        foreach ($keyword in @('Trả lời nhanh', 'Tra loi nhanh', 'quick-replies', 'admin.gomdaithanh.com', 'localhost:3003')) {
            if (Test-ContainsText $window.Title $keyword) {
                $score += 40
            }
        }

        if ($score -ge 120) {
            $matches += [pscustomobject] @{ Window = $window; Score = $score }
        }
    }

    return ($matches | Sort-Object -Property Score -Descending | Select-Object -First 1).Window
}

function Activate-Window {
    param($Window)

    if ($null -eq $Window) {
        throw 'Window not found.'
    }

    [void] [Win32LiteBridge]::ShowWindow($Window.Handle, 9)
    Start-Sleep -Milliseconds 120
    [void] [Win32LiteBridge]::SetForegroundWindow($Window.Handle)

    try {
        $shell = New-Object -ComObject WScript.Shell
        if ($Window.ProcessId -gt 0) {
            [void] $shell.AppActivate($Window.ProcessId)
        } else {
            [void] $shell.AppActivate($Window.Title)
        }
    } catch {
        # SetForegroundWindow above is usually enough.
    }

    Start-Sleep -Milliseconds 160
    Release-BridgeModifierKeys
}

function Invoke-ZaloPasteAction {
    param(
        $Payload,
        $Window,
        $Shell,
        [bool] $ShouldActivate = $true
    )

    $target = Normalize-ZaloTarget $Payload.zalo_target
    $paste = ConvertTo-BridgeBool $Payload.paste $true
    $enter = ConvertTo-BridgeBool $Payload.enter $false
    $defaultDelay = if ($enter) { 250 } else { 0 }
    $delay = Limit-Number ([int] (Get-BridgeValue $Payload 'before_enter_delay_ms' $defaultDelay)) 0 5000
    $afterPasteDelay = Limit-Number ([int] (Get-BridgeValue $Payload 'after_paste_delay_ms' 180)) 0 2000
    $afterEnterDelay = Limit-Number ([int] (Get-BridgeValue $Payload 'after_enter_delay_ms' 120)) 0 2000
    $clipboardPayload = Set-BridgeClipboardPayload $Payload

    if ($ShouldActivate) {
        Activate-Window $Window
    }

    Release-BridgeModifierKeys

    try {
        if ($paste) {
            Send-BridgePaste
            Start-Sleep -Milliseconds $afterPasteDelay
        }

        if ($enter) {
            if ($delay -gt 0) {
                Start-Sleep -Milliseconds $delay
            }
            Release-BridgeModifierKeys
            Send-BridgeKey ([byte] 0x0D)
            Start-Sleep -Milliseconds $afterEnterDelay
        }
    } finally {
        Release-BridgeModifierKeys
    }

    return @{
        ok = $true
        action = 'paste'
        target = $target
        pasted = $paste
        enter = $enter
        clipboard_type = $clipboardPayload.type
        clipboard_count = $clipboardPayload.count
        window_title = $Window.Title
        process = $Window.ProcessName
    }
}

function Invoke-PasteZalo {
    param($Payload)

    $target = Normalize-ZaloTarget $Payload.zalo_target
    Write-BridgeLog ("Paste request target={0} paste={1} enter={2}" -f $target, (Get-BridgeValue $Payload 'paste' $true), (Get-BridgeValue $Payload 'enter' $false))
    $keywords = ConvertTo-StringArray $Payload.window_keywords (Get-ZaloKeywords $target)
    $window = Find-ZaloWindow $target $keywords
    if ($null -eq $window) {
        throw "Cannot find Zalo $target window. Open the Zalo chat window and try again."
    }

    $shell = New-Object -ComObject WScript.Shell
    return Invoke-ZaloPasteAction $Payload $window $shell $true
}

function Invoke-ZaloBatchSend {
    param($Payload)

    $target = Normalize-ZaloTarget $Payload.zalo_target
    $keywords = ConvertTo-StringArray $Payload.window_keywords (Get-ZaloKeywords $target)
    $steps = @(Get-BridgeValue $Payload 'steps' @())
    if ($steps.Count -eq 0) {
        throw 'Batch contains no Zalo send steps.'
    }

    Write-BridgeLog ("Batch send target={0} steps={1}" -f $target, $steps.Count)

    $preparedMediaByStep = @()
    $downloadedUrls = @{}
    $batchTempDirectory = $null
    $downloadIndex = 0

    for ($index = 0; $index -lt $steps.Count; $index += 1) {
        $step = $steps[$index]
        $stepUrls = @()
        $stepUrls += ConvertTo-StringArray (Get-BridgeValue $step 'image_urls' @()) @()
        $stepUrls += ConvertTo-StringArray (Get-BridgeValue $step 'media_urls' @()) @()
        $stepUrls += ConvertTo-StringArray (Get-BridgeValue $step 'video_urls' @()) @()

        $stepPaths = @()
        $providedPaths = ConvertTo-StringArray (Get-BridgeValue $step 'file_paths' @()) @()
        foreach ($path in $providedPaths) {
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                $stepPaths += (Resolve-Path -LiteralPath $path).Path
            }
        }

        if ($stepUrls.Count -gt 0 -and $null -eq $batchTempDirectory) {
            $batchTempDirectory = New-BridgeTempDirectory
        }

        foreach ($url in $stepUrls) {
            $cacheKey = "$url"
            if ($downloadedUrls.ContainsKey($cacheKey)) {
                $stepPaths += $downloadedUrls[$cacheKey]
                continue
            }

            $downloadIndex += 1
            $savedPath = Save-BridgeUrlToFile $url $batchTempDirectory $downloadIndex
            $downloadedUrls[$cacheKey] = $savedPath
            $stepPaths += $savedPath
        }

        $preparedMediaByStep += ,([pscustomobject] @{
            paths = [string[]] $stepPaths
            count = $stepPaths.Count
        })
    }

    $window = Find-ZaloWindow $target $keywords
    if ($null -eq $window) {
        throw "Cannot find Zalo $target window. Open the Zalo chat window and try again."
    }

    Activate-Window $window
    $shell = New-Object -ComObject WScript.Shell
    $sentSteps = 0
    $sentText = 0
    $sentMedia = 0
    $stepResults = @()

    for ($index = 0; $index -lt $steps.Count; $index += 1) {
        $step = $steps[$index]
        $text = Get-BridgeValue $step 'text' ''
        $preparedMedia = $preparedMediaByStep[$index]
        $filePaths = ConvertTo-StringArray (Get-BridgeValue $preparedMedia 'paths' @()) @()
        $mediaCount = [int] $preparedMedia.count
        $hasText = -not [string]::IsNullOrWhiteSpace("$text")
        $hasMedia = $mediaCount -gt 0

        if (-not $hasText -and -not $hasMedia) {
            continue
        }

        try {
            if ($hasText) {
                $textPayload = [pscustomobject] @{
                    zalo_target = $target
                    text = "$text"
                    paste = $true
                    enter = (-not $hasMedia)
                    after_paste_delay_ms = Get-BridgeValue $step 'text_after_paste_delay_ms' 80
                    before_enter_delay_ms = Get-BridgeValue $step 'text_before_enter_delay_ms' 100
                    after_enter_delay_ms = Get-BridgeValue $step 'after_enter_delay_ms' 80
                }
                $textResult = Invoke-ZaloPasteAction $textPayload $window $shell $false
                $sentText += 1

                if ($hasMedia) {
                    $afterTextDelay = Limit-Number ([int] (Get-BridgeValue $step 'after_text_delay_ms' 40)) 0 1000
                    if ($afterTextDelay -gt 0) {
                        Start-Sleep -Milliseconds $afterTextDelay
                    }
                }
            }

            if ($hasMedia) {
                $mediaPayload = [pscustomobject] @{
                    zalo_target = $target
                    file_paths = $filePaths
                    paste = $true
                    enter = $true
                    after_paste_delay_ms = Get-BridgeValue $step 'media_after_paste_delay_ms' 120
                    before_enter_delay_ms = Get-BridgeValue $step 'media_before_enter_delay_ms' 900
                    after_enter_delay_ms = Get-BridgeValue $step 'after_enter_delay_ms' 80
                }
                $mediaResult = Invoke-ZaloPasteAction $mediaPayload $window $shell $false
                $sentMedia += $mediaResult.clipboard_count
            }

            $sentSteps += 1
            $afterStepDelay = Limit-Number ([int] (Get-BridgeValue $step 'after_step_delay_ms' 120)) 0 2000
            if ($afterStepDelay -gt 0 -and $index -lt ($steps.Count - 1)) {
                Start-Sleep -Milliseconds $afterStepDelay
            }

            $stepResults += [pscustomobject] @{
                index = $index + 1
                text = $hasText
                media_count = $mediaCount
            }
        } catch {
            throw ("Batch failed at step #{0} after sending {1} step(s): {2}" -f ($index + 1), $sentSteps, $_.Exception.Message)
        }
    }

    return @{
        ok = $true
        action = 'batch-send'
        target = $target
        steps_sent = $sentSteps
        text_count = $sentText
        media_count = $sentMedia
        window_title = $window.Title
        process = $window.ProcessName
        steps = $stepResults
    }
}

function Test-SafeSidebarUrl {
    param([string] $Url)

    if ([string]::IsNullOrWhiteSpace($Url)) {
        return $false
    }

    try {
        $uri = [Uri] $Url
        $host = $uri.Host.ToLowerInvariant()
        return (@('localhost', '127.0.0.1', 'admin.gomdaithanh.com') -contains $host) -and $uri.AbsolutePath -eq '/admin/quick-replies'
    } catch {
        return $false
    }
}

function Invoke-SplitZalo {
    param($Payload)

    $target = Normalize-ZaloTarget $Payload.zalo_target
    $zaloKeywords = ConvertTo-StringArray $Payload.zalo_window_keywords (Get-ZaloKeywords $target)
    $panelKeywords = ConvertTo-StringArray $Payload.browser_window_keywords @('Sidebar', 'quick-replies', 'admin.gomdaithanh.com', 'localhost:3003')

    $panel = Find-PanelWindow $panelKeywords
    if (($null -eq $panel) -and (Test-SafeSidebarUrl "$($Payload.sidebar_url)")) {
        Start-Process "$($Payload.sidebar_url)"
        Start-Sleep -Milliseconds 1500
        $panel = Find-PanelWindow $panelKeywords
    }

    $zalo = Find-ZaloWindow $target $zaloKeywords
    if ($null -eq $zalo) {
        throw "Cannot find Zalo $target window. Open Zalo first and try again."
    }

    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $gap = Limit-Number ([int] (Get-BridgeValue $Payload 'gap' 0)) 0 48
    $margin = Limit-Number ([int] (Get-BridgeValue $Payload 'margin' 0)) 0 80
    $sidebarWidth = Limit-Number ([int] (Get-BridgeValue $Payload 'sidebar_width' 360)) 300 520

    $left = [int] ($screen.Left + $margin)
    $top = [int] ($screen.Top + $margin)
    $height = [int] ([Math]::Max(320, $screen.Height - ($margin * 2)))
    $totalWidth = [int] ([Math]::Max(700, $screen.Width - ($margin * 2)))
    $zaloWidth = [int] ([Math]::Max(520, $totalWidth - $sidebarWidth - $gap))
    $panelLeft = [int] ($left + $zaloWidth + $gap)

    [void] [Win32LiteBridge]::ShowWindow($zalo.Handle, 9)
    [void] [Win32LiteBridge]::MoveWindow($zalo.Handle, $left, $top, $zaloWidth, $height, $true)

    if ($null -ne $panel) {
        [void] [Win32LiteBridge]::ShowWindow($panel.Handle, 9)
        [void] [Win32LiteBridge]::MoveWindow($panel.Handle, $panelLeft, $top, $sidebarWidth, $height, $true)
        Activate-Window $panel
    } else {
        Activate-Window $zalo
    }

    return @{
        ok = $true
        action = 'split'
        target = $target
        zalo_found = $true
        browser_found = ($null -ne $panel)
        zalo_title = $zalo.Title
        browser_title = $(if ($null -ne $panel) { $panel.Title } else { '' })
    }
}

function Test-OriginAllowed {
    param([string] $Origin)

    if ([string]::IsNullOrWhiteSpace($Origin)) {
        return $true
    }

    $originTrimmed = $Origin.TrimEnd('/')
    foreach ($allowed in $script:AllowedOrigins) {
        if ($originTrimmed.Equals($allowed.TrimEnd('/'), [StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }

    return $false
}

function Read-HttpRequest {
    param([System.Net.Sockets.TcpClient] $Client)

    $Client.ReceiveTimeout = 30000
    $stream = $Client.GetStream()

    $headerBytes = New-Object 'System.Collections.Generic.List[byte]'
    while ($true) {
        $byteValue = $stream.ReadByte()
        if ($byteValue -lt 0) {
            break
        }

        [void] $headerBytes.Add([byte] $byteValue)
        $count = $headerBytes.Count
        if ($count -gt 65536) {
            throw 'HTTP request headers are too large.'
        }

        if (
            $count -ge 4 -and
            $headerBytes[$count - 4] -eq 13 -and
            $headerBytes[$count - 3] -eq 10 -and
            $headerBytes[$count - 2] -eq 13 -and
            $headerBytes[$count - 1] -eq 10
        ) {
            break
        }
    }

    if ($headerBytes.Count -eq 0) {
        return $null
    }

    $headerText = [System.Text.Encoding]::ASCII.GetString($headerBytes.ToArray())
    $headerLines = @($headerText -split "`r?`n" | Where-Object { $_ -ne '' })
    if ($headerLines.Count -eq 0) {
        return $null
    }

    $requestLine = $headerLines[0]
    if ([string]::IsNullOrWhiteSpace($requestLine)) {
        return $null
    }

    $headers = @{}
    foreach ($line in @($headerLines | Select-Object -Skip 1)) {
        $colon = $line.IndexOf(':')
        if ($colon -gt 0) {
            $name = $line.Substring(0, $colon).Trim().ToLowerInvariant()
            $value = $line.Substring($colon + 1).Trim()
            $headers[$name] = $value
        }
    }

    $body = ''
    $contentLength = 0
    if ($headers.ContainsKey('content-length')) {
        [void] [int]::TryParse($headers['content-length'], [ref] $contentLength)
    }

    if ($contentLength -gt 0) {
        $bodyBytes = New-Object byte[] $contentLength
        $offset = 0
        while ($offset -lt $contentLength) {
            $read = $stream.Read($bodyBytes, $offset, $contentLength - $offset)
            if ($read -le 0) {
                break
            }

            $offset += $read
        }

        if ($offset -lt $contentLength) {
            throw "HTTP request body ended early. Expected $contentLength byte(s), got $offset."
        }

        $body = [System.Text.Encoding]::UTF8.GetString($bodyBytes, 0, $offset)
    }

    $parts = $requestLine.Split(' ')
    $path = if ($parts.Count -ge 2) { $parts[1] } else { '/' }
    if ($path.StartsWith('http://') -or $path.StartsWith('https://')) {
        try {
            $path = ([Uri] $path).PathAndQuery
        } catch {
            $path = '/'
        }
    }

    return @{
        Stream = $stream
        Method = if ($parts.Count -ge 1) { $parts[0].ToUpperInvariant() } else { 'GET' }
        Path = $path
        Headers = $headers
        Body = $body
    }
}

function Write-HttpResponse {
    param(
        [System.IO.Stream] $Stream,
        [int] $Status,
        [string] $Reason,
        $Body,
        [string] $Origin
    )

    $bodyBytes = @()
    $contentType = 'application/json; charset=utf-8'
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Depth 12 -Compress
        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    }

    $headers = "HTTP/1.1 $Status $Reason`r`n"
    $headers += "Content-Type: $contentType`r`n"
    $headers += "Content-Length: $($bodyBytes.Length)`r`n"
    $headers += "Connection: close`r`n"
    $headers += "Access-Control-Allow-Methods: POST, OPTIONS`r`n"
    $headers += "Access-Control-Allow-Headers: Accept, Content-Type, X-Requested-With, X-Quick-Reply-Local-Bridge`r`n"
    $headers += "Access-Control-Max-Age: 600`r`n"
    $headers += "Access-Control-Allow-Private-Network: true`r`n"
    if (-not [string]::IsNullOrWhiteSpace($Origin)) {
        $headers += "Access-Control-Allow-Origin: $Origin`r`n"
        $headers += "Vary: Origin`r`n"
    }
    $headers += "`r`n"

    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($bodyBytes.Length -gt 0) {
        $Stream.Write($bodyBytes, 0, $bodyBytes.Length)
    }
    $Stream.Flush()
}

function Handle-Request {
    param($Request)

    $origin = ''
    if ($Request.Headers.ContainsKey('origin')) {
        $origin = $Request.Headers['origin']
    }

    $pathOnly = ($Request.Path -split '\?')[0]

    if (-not (Test-OriginAllowed $origin)) {
        Write-HttpResponse $Request.Stream 403 'Forbidden' @{ message = 'Origin is not allowed.' } ''
        return
    }

    if ($Request.Method -eq 'OPTIONS') {
        Write-HttpResponse $Request.Stream 204 'No Content' $null $origin
        return
    }

    if ($Request.Method -eq 'GET' -and ($pathOnly -eq '/' -or $pathOnly -eq '/api/quick-replies/local-window-bridge/health')) {
        Write-HttpResponse $Request.Stream 200 'OK' @{
            message = 'Webnam Zalo Bridge Lite is running.'
            ok = $true
            port = $Port
            version = $script:BridgeVersion
            pid = $PID
            started_at = $script:BridgeStartedAt.ToString('yyyy-MM-dd HH:mm:ss')
        } $origin
        return
    }

    if ($Request.Method -ne 'POST') {
        Write-HttpResponse $Request.Stream 405 'Method Not Allowed' @{ message = 'Use POST.' } $origin
        return
    }

    if (-not $Request.Headers.ContainsKey('x-quick-reply-local-bridge') -or $Request.Headers['x-quick-reply-local-bridge'] -ne '1') {
        Write-HttpResponse $Request.Stream 403 'Forbidden' @{ message = 'Missing bridge header.' } $origin
        return
    }

    $payload = @{}
    if (-not [string]::IsNullOrWhiteSpace($Request.Body)) {
        $payload = $Request.Body | ConvertFrom-Json
    }

    try {
        if ($pathOnly -eq '/api/quick-replies/local-window-bridge/paste-zalo') {
            $result = Invoke-PasteZalo $payload
            Write-HttpResponse $Request.Stream 200 'OK' @{ message = 'Lite bridge pasted to Zalo.'; result = $result } $origin
            return
        }

        if ($pathOnly -eq '/api/quick-replies/local-window-bridge/send-zalo-batch') {
            $result = Invoke-ZaloBatchSend $payload
            Write-HttpResponse $Request.Stream 200 'OK' @{ message = 'Lite bridge sent Zalo batch.'; result = $result } $origin
            return
        }

        if ($pathOnly -eq '/api/quick-replies/local-window-bridge/split-zalo') {
            $result = Invoke-SplitZalo $payload
            Write-HttpResponse $Request.Stream 200 'OK' @{ message = 'Lite bridge arranged Zalo and quick reply panel.'; result = $result } $origin
            return
        }

        Write-HttpResponse $Request.Stream 404 'Not Found' @{ message = 'Bridge endpoint not found.' } $origin
    } catch {
        $errorMessage = $_.Exception.Message
        $errorCode = 'BRIDGE_ACTION_FAILED'
        if ($errorMessage -like 'Cannot find Zalo*') {
            $errorCode = 'ZALO_WINDOW_NOT_FOUND'
        } elseif ($errorMessage -like 'Cannot download media*') {
            $errorCode = 'MEDIA_DOWNLOAD_FAILED'
        } elseif ($errorMessage -like 'Cannot write Windows clipboard*') {
            $errorCode = 'CLIPBOARD_WRITE_FAILED'
        }

        Write-BridgeLog ("ERROR {0} {1}: {2}" -f $Request.Method, $pathOnly, $errorMessage)
        Write-HttpResponse $Request.Stream 422 'Unprocessable Entity' @{
            ok = $false
            code = $errorCode
            message = $errorMessage
            path = $pathOnly
            version = $script:BridgeVersion
        } $origin
    }
}

if ($SelfTest) {
    $windows = @(Get-TopLevelWindows)
    Write-Host "OK: Zalo bridge lite script loaded. Version: $script:BridgeVersion. Visible windows: $($windows.Count). Port: $Port."
    exit 0
}

$listener = New-Object System.Net.Sockets.TcpListener -ArgumentList ([System.Net.IPAddress]::Parse('127.0.0.1')), $Port
$listener.Server.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket, [System.Net.Sockets.SocketOptionName]::ReuseAddress, $true)
$listener.Start()
Write-BridgeLog "Webnam Zalo Bridge Lite $script:BridgeVersion listening on http://127.0.0.1:$Port"

while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
        $request = Read-HttpRequest $client
        if ($null -ne $request) {
            Handle-Request $request
        }
    } catch {
        try {
            $stream = $client.GetStream()
            Write-HttpResponse $stream 500 'Internal Server Error' @{ message = $_.Exception.Message } ''
        } catch {
            # Ignore response failures.
        }
    } finally {
        $client.Close()
    }
}

@echo off
setlocal EnableExtensions

set "TASK_NAME=Webnam Zalo Bridge Lite 8003"
set "PORT=8003"
set "INSTALL_ROOT=D:\WebnamZaloBridge"
if not exist "D:\" set "INSTALL_ROOT=%LOCALAPPDATA%\WebnamZaloBridge"
call :refresh_paths
set "DRY_RUN="

if /I "%~1"=="--dry-run" set "DRY_RUN=1"
if /I "%~1"=="--remove" goto remove_task
if /I "%~1"=="--uninstall" goto remove_task
if /I "%~1"=="/remove" goto remove_task
if /I "%~1"=="/uninstall" goto remove_task

echo.
echo ============================================
echo  Cai dat Webnam Zalo Bridge Lite cong %PORT%
echo ============================================
echo.
echo Thu muc cai dat: %INSTALL_ROOT%
echo.

if defined DRY_RUN (
    echo [DRY RUN] se tao thu muc "%INSTALL_ROOT%".
    echo [DRY RUN] se ghi script bridge tu trong file cai dat nay.
    echo [DRY RUN] se tao runner tu khoi dong lai neu bridge bi tat.
    echo [DRY RUN] se tao file chay cung Windows trong Startup.
    echo [DRY RUN] se bat bridge truc tiep va kiem tra http://127.0.0.1:%PORT%.
    exit /b 0
)

call :ensure_install_root
if errorlevel 1 exit /b 1

call :write_bridge_script
if errorlevel 1 exit /b 1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -SelfTest
if errorlevel 1 (
    echo.
    echo Script bridge lite chua chay duoc tren may nay.
    echo Kiem tra PowerShell/Windows roi thu lai.
    pause
    exit /b 1
)

call :stop_existing_bridge
call :write_runner_files
if errorlevel 1 exit /b 1

call :write_startup_file
if errorlevel 1 exit /b 1

schtasks /Delete /F /TN "%TASK_NAME%" >nul 2>nul
start "" wscript.exe //B //Nologo "%RUNNER%"

call :wait_bridge
if errorlevel 1 (
    echo.
    echo Chua thay bridge chay tai http://127.0.0.1:%PORT%.
    echo Dang mo cua so bridge de hien loi truc tiep.
    echo Neu cua so bao loi, chup man hinh gui cho nguoi sua code.
    echo Log: "%LOG_FILE%"
    start "Webnam Zalo Bridge Lite" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -STA -File "%PS_SCRIPT%" -Port %PORT%
    pause
    exit /b 1
)

echo.
echo Xong. Bridge lite da duoc cai vao "%INSTALL_ROOT%" va dang chay tai http://127.0.0.1:%PORT%.
echo Bridge se tu khoi dong lai neu bi tat va tu chay cung Windows bang Startup.
echo Tu gio vao web chinh roi bam Panel phai / gui tin nhu binh thuong.
echo Log neu can xem: "%LOG_FILE%"
echo.
pause
exit /b 0

:refresh_paths
set "PS_SCRIPT=%INSTALL_ROOT%\zalo-bridge-lite-8003.ps1"
set "RUNNER_CMD=%INSTALL_ROOT%\zalo-bridge-lite-runner.cmd"
set "RUNNER=%INSTALL_ROOT%\zalo-bridge-lite-runner.vbs"
set "LOG_FILE=%INSTALL_ROOT%\zalo-bridge-lite.log"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_RUNNER=%STARTUP_DIR%\Webnam Zalo Bridge Lite 8003.vbs"
exit /b 0

:ensure_install_root
if exist "%INSTALL_ROOT%" exit /b 0
mkdir "%INSTALL_ROOT%" >nul 2>nul
if not errorlevel 1 exit /b 0

if /I "%INSTALL_ROOT%"=="%LOCALAPPDATA%\WebnamZaloBridge" (
    echo Khong tao duoc thu muc cai dat "%INSTALL_ROOT%".
    pause
    exit /b 1
)

echo Khong ghi duoc vao o D. Se cai vao AppData cua user hien tai.
set "INSTALL_ROOT=%LOCALAPPDATA%\WebnamZaloBridge"
call :refresh_paths
if not exist "%INSTALL_ROOT%" mkdir "%INSTALL_ROOT%" >nul 2>nul
if errorlevel 1 (
    echo Khong tao duoc thu muc cai dat "%INSTALL_ROOT%".
    pause
    exit /b 1
)
exit /b 0

:write_bridge_script
set "INSTALLER_PATH=%~f0"
set "PS_SCRIPT_PATH=%PS_SCRIPT%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $raw=[IO.File]::ReadAllText($env:INSTALLER_PATH); $marker='__WEBNAM_ZALO_BRIDGE_LITE_PS1__'; $index=$raw.LastIndexOf($marker); if($index -lt 0){ throw 'Missing embedded bridge payload.' }; $payload=$raw.Substring($index + $marker.Length).TrimStart([char]13,[char]10); $utf8=New-Object System.Text.UTF8Encoding -ArgumentList $false; [IO.File]::WriteAllText($env:PS_SCRIPT_PATH,$payload,$utf8)"
if errorlevel 1 (
    echo Khong ghi duoc script bridge vao "%PS_SCRIPT%".
    pause
    exit /b 1
)
exit /b 0

:stop_existing_bridge
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$current=$PID; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $current -and $_.CommandLine -and ($_.CommandLine -like '*zalo-bridge-lite-8003.ps1*' -or $_.CommandLine -like '*zalo-bridge-lite-runner.cmd*' -or $_.CommandLine -like '*zalo-bridge-lite-runner.vbs*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul
exit /b 0

:write_runner_files
(
    echo @echo off
    echo cd /d "%INSTALL_ROOT%"
    echo :bridge_loop
    echo echo %%date%% %%time%% Starting Webnam Zalo Bridge Lite on port %PORT% ^>^> "%LOG_FILE%"
    echo powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%PS_SCRIPT%" -Port %PORT% ^>^> "%LOG_FILE%" 2^>^&1
    echo set "EXIT_CODE=%%ERRORLEVEL%%"
    echo echo %%date%% %%time%% Bridge stopped with code %%EXIT_CODE%%. Restarting in 3 seconds. ^>^> "%LOG_FILE%"
    echo timeout /t 3 /nobreak ^>nul
    echo goto bridge_loop
) > "%RUNNER_CMD%"
if errorlevel 1 (
    echo Khong tao duoc file runner cmd: "%RUNNER_CMD%".
    pause
    exit /b 1
)

(
    echo Option Explicit
    echo Dim shell, runner
    echo Set shell = CreateObject("WScript.Shell"^)
    echo runner = "%RUNNER_CMD%"
    echo shell.Run Chr(34^) ^& runner ^& Chr(34^), 0, False
) > "%RUNNER%"
if errorlevel 1 (
    echo Khong tao duoc file runner vbs: "%RUNNER%".
    pause
    exit /b 1
)
exit /b 0

:write_startup_file
if not exist "%STARTUP_DIR%" mkdir "%STARTUP_DIR%" >nul 2>nul
copy /Y "%RUNNER%" "%STARTUP_RUNNER%" >nul
if errorlevel 1 (
    echo Khong tao duoc file chay cung Windows trong Startup: "%STARTUP_RUNNER%".
    pause
    exit /b 1
)
exit /b 0

:wait_bridge
set "BRIDGE_HEALTH_URL=http://127.0.0.1:%PORT%/api/quick-replies/local-window-bridge/health"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$url=$env:BRIDGE_HEALTH_URL; $ok=$false; for($i=0; $i -lt 30; $i++){ try { $res=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2; if($res.StatusCode -eq 200 -and $res.Content -match 'Webnam Zalo Bridge Lite'){ $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if($ok){ exit 0 }; exit 1"
exit /b %errorlevel%

:remove_task
echo.
echo Dang go cai dat Webnam Zalo Bridge Lite...
if defined DRY_RUN (
    echo [DRY RUN] se xoa task cu "%TASK_NAME%", file Startup va cac file runner trong "%INSTALL_ROOT%".
    exit /b 0
)

schtasks /Delete /F /TN "%TASK_NAME%" >nul 2>nul
call :stop_existing_bridge
if exist "%STARTUP_RUNNER%" del /f /q "%STARTUP_RUNNER%" >nul 2>nul
if exist "%RUNNER%" del /f /q "%RUNNER%" >nul 2>nul
if exist "%RUNNER_CMD%" del /f /q "%RUNNER_CMD%" >nul 2>nul
echo Da go file tu dong chay cung Windows. File script/log se duoc giu lai trong "%INSTALL_ROOT%".
pause
exit /b 0

__WEBNAM_ZALO_BRIDGE_LITE_PS1__
param(
    [int] $Port = 8003,
    [switch] $SelfTest
)

$ErrorActionPreference = 'Stop'
$script:BridgeVersion = '2026.09.09.1'
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

            $script:LiteBridgeWindows += [pscustomobject] @{
                Handle = $Handle
                Title = $title
                ProcessId = [int] $processId
                ProcessName = $processName
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

    foreach ($window in (Get-TopLevelWindows)) {
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

    $paste = ConvertTo-BridgeBool $Payload.paste $true
    $enter = ConvertTo-BridgeBool $Payload.enter $false
    $defaultDelay = if ($enter) { 250 } else { 0 }
    $delay = Limit-Number ([int] (Get-BridgeValue $Payload 'before_enter_delay_ms' $defaultDelay)) 0 5000
    $clipboardPayload = Set-BridgeClipboardPayload $Payload

    Activate-Window $window
    $shell = New-Object -ComObject WScript.Shell

    if ($paste) {
        $shell.SendKeys('^v')
        Start-Sleep -Milliseconds 280
    }

    if ($enter) {
        if ($delay -gt 0) {
            Start-Sleep -Milliseconds $delay
        }
        $shell.SendKeys('~')
        Start-Sleep -Milliseconds 180
    }

    return @{
        ok = $true
        action = 'paste'
        target = $target
        pasted = $paste
        enter = $enter
        clipboard_type = $clipboardPayload.type
        clipboard_count = $clipboardPayload.count
        window_title = $window.Title
        process = $window.ProcessName
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

    $Client.ReceiveTimeout = 10000
    $stream = $Client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $false, 8192, $true)
    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) {
        return $null
    }

    $headers = @{}
    while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq '') {
            break
        }

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
        $buffer = New-Object char[] $contentLength
        $read = $reader.ReadBlock($buffer, 0, $contentLength)
        if ($read -gt 0) {
            $body = -join $buffer[0..($read - 1)]
        }
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

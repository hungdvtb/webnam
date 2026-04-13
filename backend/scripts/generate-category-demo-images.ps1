Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$backendRoot = Split-Path -Parent $PSScriptRoot
$storagePublicRoot = Join-Path $backendRoot 'storage\app\public'
$categoriesRoot = Join-Path $storagePublicRoot 'categories'
$generatedRoot = Join-Path $categoriesRoot 'demo'
$categoryBannerRoot = Join-Path $storagePublicRoot 'category_banners'
$manifestPath = Join-Path $backendRoot 'storage\app\generated\category-demo-assets.json'

foreach ($path in @($categoriesRoot, $generatedRoot, (Split-Path -Parent $manifestPath))) {
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path | Out-Null
    }
}

function New-Color {
    param(
        [int]$R,
        [int]$G,
        [int]$B,
        [int]$A = 255
    )

    return [System.Drawing.Color]::FromArgb($A, $R, $G, $B)
}

function Convert-HexToColor {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Hex,
        [int]$Alpha = 255
    )

    $clean = $Hex.Trim().TrimStart('#')
    if ($clean.Length -ne 6) {
        throw "Hex color '$Hex' is invalid."
    }

    return New-Color `
        -R ([Convert]::ToInt32($clean.Substring(0, 2), 16)) `
        -G ([Convert]::ToInt32($clean.Substring(2, 2), 16)) `
        -B ([Convert]::ToInt32($clean.Substring(4, 2), 16)) `
        -A $Alpha
}

function Get-Palette {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Theme
    )

    switch ($Theme) {
        'art' {
            return @{
                OverlayStart = Convert-HexToColor '#1f1208' 210
                OverlayEnd = Convert-HexToColor '#5c3a17' 110
                Accent = Convert-HexToColor '#e2c07a'
                AccentSoft = Convert-HexToColor '#f7e8bf' 200
                CardFill = Convert-HexToColor '#f8f1df' 242
                CardBorder = Convert-HexToColor '#d2b16a'
                Title = Convert-HexToColor '#fff6de'
                Body = Convert-HexToColor '#f4e5bf'
                RibbonFill = Convert-HexToColor '#3f250e' 230
                RibbonText = Convert-HexToColor '#f8e7b6'
            }
        }
        'tea' {
            return @{
                OverlayStart = Convert-HexToColor '#25170f' 205
                OverlayEnd = Convert-HexToColor '#7a5431' 105
                Accent = Convert-HexToColor '#e7c38b'
                AccentSoft = Convert-HexToColor '#f5e7cd' 200
                CardFill = Convert-HexToColor '#f7efe1' 242
                CardBorder = Convert-HexToColor '#d5b38a'
                Title = Convert-HexToColor '#fff7ea'
                Body = Convert-HexToColor '#f0dcc3'
                RibbonFill = Convert-HexToColor '#4a2d1b' 230
                RibbonText = Convert-HexToColor '#f7e7cd'
            }
        }
        'wealth' {
            return @{
                OverlayStart = Convert-HexToColor '#2a1208' 215
                OverlayEnd = Convert-HexToColor '#8f4f1c' 105
                Accent = Convert-HexToColor '#f7c44b'
                AccentSoft = Convert-HexToColor '#ffe29e' 210
                CardFill = Convert-HexToColor '#fff3d2' 240
                CardBorder = Convert-HexToColor '#f0bc3d'
                Title = Convert-HexToColor '#fff8dc'
                Body = Convert-HexToColor '#fde6af'
                RibbonFill = Convert-HexToColor '#5a240c' 228
                RibbonText = Convert-HexToColor '#fff0b7'
            }
        }
        'crackle' {
            return @{
                OverlayStart = Convert-HexToColor '#16243d' 208
                OverlayEnd = Convert-HexToColor '#9f8461' 98
                Accent = Convert-HexToColor '#d9c39a'
                AccentSoft = Convert-HexToColor '#f6edd8' 205
                CardFill = Convert-HexToColor '#f3ede2' 242
                CardBorder = Convert-HexToColor '#d1b78b'
                Title = Convert-HexToColor '#fff9ef'
                Body = Convert-HexToColor '#ebe1c8'
                RibbonFill = Convert-HexToColor '#20324f' 228
                RibbonText = Convert-HexToColor '#f9f0db'
            }
        }
        'spiritual' {
            return @{
                OverlayStart = Convert-HexToColor '#062421' 210
                OverlayEnd = Convert-HexToColor '#1b6b58' 100
                Accent = Convert-HexToColor '#ead48f'
                AccentSoft = Convert-HexToColor '#f5edbe' 205
                CardFill = Convert-HexToColor '#eef6ee' 238
                CardBorder = Convert-HexToColor '#c5b06b'
                Title = Convert-HexToColor '#f8faef'
                Body = Convert-HexToColor '#e4edce'
                RibbonFill = Convert-HexToColor '#113730' 228
                RibbonText = Convert-HexToColor '#f8eebe'
            }
        }
        'size' {
            return @{
                OverlayStart = Convert-HexToColor '#0d1936' 214
                OverlayEnd = Convert-HexToColor '#8f6a36' 104
                Accent = Convert-HexToColor '#f4ca74'
                AccentSoft = Convert-HexToColor '#ffebb8' 210
                CardFill = Convert-HexToColor '#f5efe3' 240
                CardBorder = Convert-HexToColor '#d6b26d'
                Title = Convert-HexToColor '#fff7e1'
                Body = Convert-HexToColor '#f2e2b6'
                RibbonFill = Convert-HexToColor '#17284f' 228
                RibbonText = Convert-HexToColor '#fee8b1'
            }
        }
        default {
            return @{
                OverlayStart = Convert-HexToColor '#1e2230' 208
                OverlayEnd = Convert-HexToColor '#5d6a82' 96
                Accent = Convert-HexToColor '#e4cf96'
                AccentSoft = Convert-HexToColor '#fff0c5' 205
                CardFill = Convert-HexToColor '#f6f1e8' 240
                CardBorder = Convert-HexToColor '#d1b885'
                Title = Convert-HexToColor '#fff9ee'
                Body = Convert-HexToColor '#eee2c5'
                RibbonFill = Convert-HexToColor '#24314b' 228
                RibbonText = Convert-HexToColor '#f7ead0'
            }
        }
    }
}

function New-BitmapFromFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $image = [System.Drawing.Image]::FromFile($Path)
    try {
        return [System.Drawing.Bitmap]::new($image)
    } finally {
        $image.Dispose()
    }
}

function Get-CoverSourceRectangle {
    param(
        [int]$SourceWidth,
        [int]$SourceHeight,
        [int]$TargetWidth,
        [int]$TargetHeight,
        [double]$FocusX = 0.5,
        [double]$FocusY = 0.5
    )

    $sourceRatio = $SourceWidth / [double]$SourceHeight
    $targetRatio = $TargetWidth / [double]$TargetHeight

    if ($sourceRatio -gt $targetRatio) {
        $cropHeight = $SourceHeight
        $cropWidth = [int][Math]::Round($cropHeight * $targetRatio)
        $maxX = [Math]::Max($SourceWidth - $cropWidth, 0)
        $cropX = [int][Math]::Round($maxX * [Math]::Min([Math]::Max($FocusX, 0), 1))
        $cropY = 0
    } else {
        $cropWidth = $SourceWidth
        $cropHeight = [int][Math]::Round($cropWidth / $targetRatio)
        $maxY = [Math]::Max($SourceHeight - $cropHeight, 0)
        $cropY = [int][Math]::Round($maxY * [Math]::Min([Math]::Max($FocusY, 0), 1))
        $cropX = 0
    }

    if (($cropX + $cropWidth) -gt $SourceWidth) {
        $cropX = $SourceWidth - $cropWidth
    }

    if (($cropY + $cropHeight) -gt $SourceHeight) {
        $cropY = $SourceHeight - $cropHeight
    }

    return [System.Drawing.Rectangle]::new([Math]::Max($cropX, 0), [Math]::Max($cropY, 0), $cropWidth, $cropHeight)
}

function New-RoundedRectanglePath {
    param(
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius
    )

    $diameter = [Math]::Min($Radius * 2, [Math]::Min($Width, $Height))
    $rect = [System.Drawing.RectangleF]::new($X, $Y, $Width, $Height)
    $arc = [System.Drawing.RectangleF]::new($rect.X, $rect.Y, $diameter, $diameter)
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()

    $path.AddArc($arc, 180, 90)
    $arc.X = $rect.Right - $diameter
    $path.AddArc($arc, 270, 90)
    $arc.Y = $rect.Bottom - $diameter
    $path.AddArc($arc, 0, 90)
    $arc.X = $rect.X
    $path.AddArc($arc, 90, 90)
    $path.CloseFigure()

    return $path
}

function Draw-CoverImage {
    param(
        [Parameter(Mandatory = $true)]
        [System.Drawing.Graphics]$Graphics,
        [Parameter(Mandatory = $true)]
        [System.Drawing.Image]$Image,
        [Parameter(Mandatory = $true)]
        [System.Drawing.Rectangle]$Destination,
        [double]$FocusX = 0.5,
        [double]$FocusY = 0.5
    )

    $source = Get-CoverSourceRectangle -SourceWidth $Image.Width -SourceHeight $Image.Height -TargetWidth $Destination.Width -TargetHeight $Destination.Height -FocusX $FocusX -FocusY $FocusY
    $Graphics.DrawImage($Image, $Destination, $source, [System.Drawing.GraphicsUnit]::Pixel)
}

function Draw-CoverImageRounded {
    param(
        [Parameter(Mandatory = $true)]
        [System.Drawing.Graphics]$Graphics,
        [Parameter(Mandatory = $true)]
        [System.Drawing.Image]$Image,
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius,
        [double]$FocusX = 0.5,
        [double]$FocusY = 0.5
    )

    $path = New-RoundedRectanglePath -X $X -Y $Y -Width $Width -Height $Height -Radius $Radius
    try {
        $state = $Graphics.Save()
        try {
            $Graphics.SetClip($path)
            $destination = [System.Drawing.Rectangle]::new([int][Math]::Round($X), [int][Math]::Round($Y), [int][Math]::Round($Width), [int][Math]::Round($Height))
            Draw-CoverImage -Graphics $Graphics -Image $Image -Destination $destination -FocusX $FocusX -FocusY $FocusY
        } finally {
            $Graphics.Restore($state)
        }
    } finally {
        $path.Dispose()
    }
}

function Fill-RoundedRectangle {
    param(
        [System.Drawing.Graphics]$Graphics,
        [System.Drawing.Brush]$Brush,
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius
    )

    $path = New-RoundedRectanglePath -X $X -Y $Y -Width $Width -Height $Height -Radius $Radius
    try {
        $Graphics.FillPath($Brush, $path)
    } finally {
        $path.Dispose()
    }
}

function Draw-RoundedRectangleOutline {
    param(
        [System.Drawing.Graphics]$Graphics,
        [System.Drawing.Pen]$Pen,
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius
    )

    $path = New-RoundedRectanglePath -X $X -Y $Y -Width $Width -Height $Height -Radius $Radius
    try {
        $Graphics.DrawPath($Pen, $path)
    } finally {
        $path.Dispose()
    }
}

function New-FontSafe {
    param(
        [string]$FontName,
        [float]$Size,
        [System.Drawing.FontStyle]$Style
    )

    try {
        return [System.Drawing.Font]::new($FontName, $Size, $Style, [System.Drawing.GraphicsUnit]::Pixel)
    } catch {
        return [System.Drawing.Font]::new('Times New Roman', $Size, $Style, [System.Drawing.GraphicsUnit]::Pixel)
    }
}

function Find-FittingFont {
    param(
        [System.Drawing.Graphics]$Graphics,
        [string]$Text,
        [string]$FontName,
        [System.Drawing.FontStyle]$Style,
        [int]$MaxSize,
        [int]$MinSize,
        [int]$Width,
        [int]$Height,
        [switch]$SingleLine
    )

    for ($size = $MaxSize; $size -ge $MinSize; $size -= 2) {
        $font = New-FontSafe -FontName $FontName -Size $size -Style $Style
        $measured = if ($SingleLine) {
            $Graphics.MeasureString($Text, $font)
        } else {
            $Graphics.MeasureString($Text, $font, $Width)
        }

        if ($measured.Width -le ($Width + 8) -and $measured.Height -le ($Height + 6)) {
            return $font
        }

        $font.Dispose()
    }

    return New-FontSafe -FontName $FontName -Size $MinSize -Style $Style
}

function Get-LogoTitle {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Category
    )

    return [string]$Category.name
}

function Get-Subtitle {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Category
    )

    $slug = [string]$Category.slug

    if ($slug -match 'am-tra|tra-dao') {
        return 'Refined Bat Trang tea sets for calm and elegant hosting corners.'
    }

    if ($slug -match 'tranh|my-thuat') {
        return 'Ceramic art, wall pieces, and decor curated for a premium display feel.'
    }

    if ($slug -match 'bat-dia|dia-trang-tri') {
        return 'Tableware and decorative ceramic pieces with a clean handcrafted look.'
    }

    if ($slug -match 'than-tai') {
        return 'Fortune altar styling with bright, rich, and welcoming composition.'
    }

    if ($slug -match 'kich-thuoc|^ban-') {
        return 'Curated altar set suggestions arranged by surface size and balance.'
    }

    if ($slug -match 'tuong|phong-thuy') {
        return 'Spiritual icons and feng shui ceramics placed in a calm premium setting.'
    }

    if ($slug -match 'do-tho|ban-tho|men-lam|men-ran') {
        return 'Premium Bat Trang altar ceramics with luminous surfaces and rich detail.'
    }

    return 'Coordinated Bat Trang ceramic visuals for category previews and storefront cards.'
}

function Get-Eyebrow {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Category
    )

    $slug = [string]$Category.slug

    if ($slug -match 'am-tra|tra-dao') {
        return 'BAT TRANG TEA CERAMICS'
    }

    if ($slug -match 'tranh|my-thuat|trang-tri') {
        return 'BAT TRANG ART & DECOR'
    }

    if ($slug -match 'bat-dia|dia-trang-tri') {
        return 'BAT TRANG TABLEWARE'
    }

    if ($slug -match 'than-tai') {
        return 'FORTUNE ALTAR COLLECTION'
    }

    if ($slug -match 'tuong|phong-thuy') {
        return 'SPIRITUAL CERAMIC ICONS'
    }

    if ($slug -match 'kich-thuoc|^ban-') {
        return 'ALTAR SIZE SELECTOR'
    }

    if ($slug -match 'do-tho|ban-tho|men-lam|men-ran') {
        return 'PREMIUM ALTAR CERAMICS'
    }

    return 'BAT TRANG CERAMICS'
}

function Get-Theme {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Category
    )

    $slug = [string]$Category.slug

    if ($slug -match 'than-tai') { return 'wealth' }
    if ($slug -match 'am-tra|tra-dao') { return 'tea' }
    if ($slug -match 'bat-dia|men-ran') { return 'crackle' }
    if ($slug -match 'tranh|my-thuat|trang-tri') { return 'art' }
    if ($slug -match 'tuong|phong-thuy') { return 'spiritual' }
    if ($slug -match 'kich-thuoc|^ban-') { return 'size' }
    if ($slug -match 'do-tho|ban-tho|men-lam') { return 'size' }
    return 'default'
}

function Resolve-SourcePath {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Category,
        [Parameter(Mandatory = $true)]
        [hashtable]$CategoryById
    )

    $existingLogo = Join-Path $categoriesRoot ("cat_{0}_logo.png" -f $Category.id)
    $existingBanner = Join-Path $categoriesRoot ("cat_{0}_banner.png" -f $Category.id)

    if (Test-Path -LiteralPath $existingLogo) {
        return $existingLogo
    }

    if (Test-Path -LiteralPath $existingBanner) {
        return $existingBanner
    }

    $explicit = @{
        'bat-dia-men-ran' = Join-Path $categoryBannerRoot 'bat-dia.png'
        'dia-trang-tri-ve-tay-1' = Join-Path $categoryBannerRoot 'bat-dia.png'
        'do-tho-cung-bat-trang-1' = Join-Path $categoryBannerRoot 'do-tho.png'
        'chon-san-pham-theo-ban-tho' = Join-Path $categoriesRoot 'cat_34_logo.png'
        'test' = Join-Path $categoriesRoot 'cat_4_logo.png'
        'bo-am-tra-dao1111' = Join-Path $categoryBannerRoot 'bo-am-tra.png'
        'ban-1m27-1m4' = Join-Path $categoriesRoot 'cat_34_logo.png'
        'ban-1m57-1m75' = Join-Path $categoriesRoot 'cat_35_logo.png'
        'ban-1m75-1m97' = Join-Path $categoriesRoot 'cat_36_logo.png'
        'ban-tren-2m17' = Join-Path $categoriesRoot 'cat_31_logo.png'
    }

    if ($explicit.ContainsKey($Category.slug) -and (Test-Path -LiteralPath $explicit[$Category.slug])) {
        return $explicit[$Category.slug]
    }

    if ($Category.parent_id -and $CategoryById.ContainsKey([int]$Category.parent_id)) {
        $parentCategory = $CategoryById[[int]$Category.parent_id]
        $parentLogo = Join-Path $categoriesRoot ("cat_{0}_logo.png" -f $parentCategory.id)
        $parentBanner = Join-Path $categoriesRoot ("cat_{0}_banner.png" -f $parentCategory.id)

        if (Test-Path -LiteralPath $parentLogo) {
            return $parentLogo
        }

        if (Test-Path -LiteralPath $parentBanner) {
            return $parentBanner
        }
    }

    foreach ($candidate in @(
        (Join-Path $categoryBannerRoot 'do-tho.png'),
        (Join-Path $categoryBannerRoot 'tranh-gom.png'),
        (Join-Path $categoryBannerRoot 'bo-am-tra.png'),
        (Join-Path $categoryBannerRoot 'bat-dia.png')
    )) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "No source image was found for category '$($Category.name)'."
}

function New-Graphics {
    param(
        [Parameter(Mandatory = $true)]
        [System.Drawing.Bitmap]$Bitmap
    )

    $graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    return $graphics
}

function Build-Banner {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Category,
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,
        [Parameter(Mandatory = $true)]
        [string]$OutputPath
    )

    $theme = Get-Theme -Category $Category
    $palette = Get-Palette -Theme $theme
    $source = New-BitmapFromFile -Path $SourcePath
    $bitmap = [System.Drawing.Bitmap]::new(1600, 760)

    try {
        $graphics = New-Graphics -Bitmap $bitmap
        try {
            $graphics.Clear((Convert-HexToColor '#101418'))
            Draw-CoverImage -Graphics $graphics -Image $source -Destination ([System.Drawing.Rectangle]::new(0, 0, 1600, 760)) -FocusX 0.52 -FocusY 0.42

            $overlay = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
                [System.Drawing.Rectangle]::new(0, 0, 1600, 760),
                $palette.OverlayStart,
                $palette.OverlayEnd,
                0.0
            )

            try {
                $graphics.FillRectangle($overlay, 0, 0, 1600, 760)
            } finally {
                $overlay.Dispose()
            }

            $rightGlow = [System.Drawing.SolidBrush]::new((Convert-HexToColor '#ffffff' 26))
            try {
                Fill-RoundedRectangle -Graphics $graphics -Brush $rightGlow -X 870 -Y 74 -Width 620 -Height 610 -Radius 42
            } finally {
                $rightGlow.Dispose()
            }

            $shadowBrush = [System.Drawing.SolidBrush]::new((Convert-HexToColor '#000000' 65))
            try {
                Fill-RoundedRectangle -Graphics $graphics -Brush $shadowBrush -X 950 -Y 114 -Width 470 -Height 470 -Radius 38
            } finally {
                $shadowBrush.Dispose()
            }

            $cardBrush = [System.Drawing.SolidBrush]::new($palette.CardFill)
            try {
                Fill-RoundedRectangle -Graphics $graphics -Brush $cardBrush -X 930 -Y 94 -Width 470 -Height 470 -Radius 36
            } finally {
                $cardBrush.Dispose()
            }

            Draw-CoverImageRounded -Graphics $graphics -Image $source -X 950 -Y 114 -Width 430 -Height 430 -Radius 30 -FocusX 0.5 -FocusY 0.44

            $cardPen = [System.Drawing.Pen]::new($palette.CardBorder, 4)
            try {
                Draw-RoundedRectangleOutline -Graphics $graphics -Pen $cardPen -X 930 -Y 94 -Width 470 -Height 470 -Radius 36
            } finally {
                $cardPen.Dispose()
            }

            $accentPen = [System.Drawing.Pen]::new($palette.AccentSoft, 3)
            try {
                $accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
                $accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
                $graphics.DrawLine($accentPen, 116, 146, 320, 146)
                $graphics.DrawLine($accentPen, 116, 606, 386, 606)
            } finally {
                $accentPen.Dispose()
            }

            $eyebrowText = Get-Eyebrow -Category $Category
            $titleText = [string]$Category.name
            $subtitleText = Get-Subtitle -Category $Category

            $eyebrowFont = Find-FittingFont -Graphics $graphics -Text $eyebrowText -FontName 'Segoe UI' -Style ([System.Drawing.FontStyle]::Bold) -MaxSize 22 -MinSize 14 -Width 620 -Height 30 -SingleLine
            $titleFont = Find-FittingFont -Graphics $graphics -Text $titleText -FontName 'Georgia' -Style ([System.Drawing.FontStyle]::Bold) -MaxSize 82 -MinSize 38 -Width 680 -Height 230
            $subtitleFont = Find-FittingFont -Graphics $graphics -Text $subtitleText -FontName 'Segoe UI' -Style ([System.Drawing.FontStyle]::Regular) -MaxSize 28 -MinSize 18 -Width 660 -Height 110

            try {
                $eyebrowBrush = [System.Drawing.SolidBrush]::new($palette.AccentSoft)
                $titleBrush = [System.Drawing.SolidBrush]::new($palette.Title)
                $subtitleBrush = [System.Drawing.SolidBrush]::new($palette.Body)

                try {
                    $format = [System.Drawing.StringFormat]::new()
                    $format.Alignment = [System.Drawing.StringAlignment]::Near
                    $format.LineAlignment = [System.Drawing.StringAlignment]::Near

                    $graphics.DrawString($eyebrowText, $eyebrowFont, $eyebrowBrush, [System.Drawing.RectangleF]::new(112, 168, 640, 40), $format)
                    $graphics.DrawString($titleText, $titleFont, $titleBrush, [System.Drawing.RectangleF]::new(108, 214, 700, 248), $format)
                    $graphics.DrawString($subtitleText, $subtitleFont, $subtitleBrush, [System.Drawing.RectangleF]::new(112, 486, 650, 94), $format)
                } finally {
                    $eyebrowBrush.Dispose()
                    $titleBrush.Dispose()
                    $subtitleBrush.Dispose()
                }
            } finally {
                $eyebrowFont.Dispose()
                $titleFont.Dispose()
                $subtitleFont.Dispose()
            }

            $logoTitle = Get-LogoTitle -Category $Category
            $ribbonBrush = [System.Drawing.SolidBrush]::new($palette.RibbonFill)
            $ribbonPen = [System.Drawing.Pen]::new($palette.Accent, 2)
            try {
                Fill-RoundedRectangle -Graphics $graphics -Brush $ribbonBrush -X 980 -Y 588 -Width 370 -Height 84 -Radius 22
                Draw-RoundedRectangleOutline -Graphics $graphics -Pen $ribbonPen -X 980 -Y 588 -Width 370 -Height 84 -Radius 22
            } finally {
                $ribbonBrush.Dispose()
                $ribbonPen.Dispose()
            }

            $ribbonFont = Find-FittingFont -Graphics $graphics -Text $logoTitle -FontName 'Georgia' -Style ([System.Drawing.FontStyle]::Bold) -MaxSize 32 -MinSize 20 -Width 320 -Height 32
            try {
                $ribbonTextBrush = [System.Drawing.SolidBrush]::new($palette.RibbonText)
                try {
                    $ribbonFormat = [System.Drawing.StringFormat]::new()
                    $ribbonFormat.Alignment = [System.Drawing.StringAlignment]::Center
                    $ribbonFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
                    $graphics.DrawString($logoTitle, $ribbonFont, $ribbonTextBrush, [System.Drawing.RectangleF]::new(1002, 612, 326, 38), $ribbonFormat)
                } finally {
                    $ribbonTextBrush.Dispose()
                }
            } finally {
                $ribbonFont.Dispose()
            }
        } finally {
            $graphics.Dispose()
        }

        $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $source.Dispose()
        $bitmap.Dispose()
    }
}

function Build-Logo {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Category,
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,
        [Parameter(Mandatory = $true)]
        [string]$OutputPath
    )

    $theme = Get-Theme -Category $Category
    $palette = Get-Palette -Theme $theme
    $source = New-BitmapFromFile -Path $SourcePath
    $bitmap = [System.Drawing.Bitmap]::new(640, 640)

    try {
        $graphics = New-Graphics -Bitmap $bitmap
        try {
            Draw-CoverImage -Graphics $graphics -Image $source -Destination ([System.Drawing.Rectangle]::new(0, 0, 640, 640)) -FocusX 0.5 -FocusY 0.44

            $overlay = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
                [System.Drawing.Rectangle]::new(0, 0, 640, 640),
                $palette.OverlayStart,
                $palette.OverlayEnd,
                90.0
            )

            try {
                $graphics.FillRectangle($overlay, 0, 0, 640, 640)
            } finally {
                $overlay.Dispose()
            }

            $frameBrush = [System.Drawing.SolidBrush]::new((Convert-HexToColor '#000000' 66))
            try {
                Fill-RoundedRectangle -Graphics $graphics -Brush $frameBrush -X 64 -Y 56 -Width 512 -Height 430 -Radius 42
            } finally {
                $frameBrush.Dispose()
            }

            $cardBrush = [System.Drawing.SolidBrush]::new($palette.CardFill)
            try {
                Fill-RoundedRectangle -Graphics $graphics -Brush $cardBrush -X 54 -Y 46 -Width 512 -Height 430 -Radius 42
            } finally {
                $cardBrush.Dispose()
            }

            Draw-CoverImageRounded -Graphics $graphics -Image $source -X 74 -Y 66 -Width 472 -Height 390 -Radius 34 -FocusX 0.5 -FocusY 0.44

            $cardPen = [System.Drawing.Pen]::new($palette.CardBorder, 4)
            try {
                Draw-RoundedRectangleOutline -Graphics $graphics -Pen $cardPen -X 54 -Y 46 -Width 512 -Height 430 -Radius 42
            } finally {
                $cardPen.Dispose()
            }

            $accentPen = [System.Drawing.Pen]::new($palette.AccentSoft, 3)
            try {
                $accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
                $accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
                $graphics.DrawLine($accentPen, 110, 84, 202, 84)
                $graphics.DrawLine($accentPen, 438, 84, 530, 84)
            } finally {
                $accentPen.Dispose()
            }

            $title = Get-LogoTitle -Category $Category
            $ribbonBrush = [System.Drawing.SolidBrush]::new($palette.RibbonFill)
            $ribbonPen = [System.Drawing.Pen]::new($palette.Accent, 2)
            try {
                Fill-RoundedRectangle -Graphics $graphics -Brush $ribbonBrush -X 92 -Y 514 -Width 456 -Height 78 -Radius 24
                Draw-RoundedRectangleOutline -Graphics $graphics -Pen $ribbonPen -X 92 -Y 514 -Width 456 -Height 78 -Radius 24
            } finally {
                $ribbonBrush.Dispose()
                $ribbonPen.Dispose()
            }

            $titleFont = Find-FittingFont -Graphics $graphics -Text $title -FontName 'Georgia' -Style ([System.Drawing.FontStyle]::Bold) -MaxSize 34 -MinSize 20 -Width 394 -Height 48
            try {
                $titleBrush = [System.Drawing.SolidBrush]::new($palette.RibbonText)
                try {
                    $format = [System.Drawing.StringFormat]::new()
                    $format.Alignment = [System.Drawing.StringAlignment]::Center
                    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
                    $graphics.DrawString($title, $titleFont, $titleBrush, [System.Drawing.RectangleF]::new(120, 528, 400, 48), $format)
                } finally {
                    $titleBrush.Dispose()
                }
            } finally {
                $titleFont.Dispose()
            }
        } finally {
            $graphics.Dispose()
        }

        $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $source.Dispose()
        $bitmap.Dispose()
    }
}

$categoryJson = @'
<?php
require 'vendor/autoload.php';
$app = require 'bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$rows = App\Models\Category::query()
    ->orderBy('id')
    ->get(['id', 'parent_id', 'name', 'slug']);
echo json_encode($rows, JSON_UNESCAPED_UNICODE);
'@ | php

if (-not $categoryJson) {
    throw 'Failed to load categories from Laravel.'
}

$categories = $categoryJson | ConvertFrom-Json
$categoryById = @{}
foreach ($category in $categories) {
    $categoryById[[int]$category.id] = $category
}

$manifest = New-Object System.Collections.Generic.List[object]

foreach ($category in $categories) {
    $sourcePath = Resolve-SourcePath -Category $category -CategoryById $categoryById
    $bannerRelativePath = "/storage/categories/demo/$($category.slug)-banner.png"
    $logoRelativePath = "/storage/categories/demo/$($category.slug)-logo.png"
    $bannerOutputPath = Join-Path $generatedRoot "$($category.slug)-banner.png"
    $logoOutputPath = Join-Path $generatedRoot "$($category.slug)-logo.png"

    Build-Banner -Category $category -SourcePath $sourcePath -OutputPath $bannerOutputPath
    Build-Logo -Category $category -SourcePath $sourcePath -OutputPath $logoOutputPath

    $manifest.Add([pscustomobject]@{
        id = [int]$category.id
        name = [string]$category.name
        slug = [string]$category.slug
        source_path = $sourcePath
        banner_path = $bannerRelativePath
        logo_path = $logoRelativePath
    }) | Out-Null
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$env:CATEGORY_DEMO_MANIFEST = $manifestPath
@'
<?php
require 'vendor/autoload.php';
$app = require 'bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$manifestPath = getenv('CATEGORY_DEMO_MANIFEST');
if (!$manifestPath || !is_file($manifestPath)) {
    fwrite(STDERR, "Manifest file not found.\n");
    exit(1);
}

$manifestRaw = file_get_contents($manifestPath);
if ($manifestRaw === false) {
    fwrite(STDERR, "Manifest JSON could not be read.\n");
    exit(1);
}

$manifestRaw = preg_replace('/^\xEF\xBB\xBF/', '', $manifestRaw);
$decoded = json_decode($manifestRaw, true);
if (!is_array($decoded)) {
    fwrite(STDERR, "Manifest JSON is invalid.\n");
    exit(1);
}

foreach ($decoded as $row) {
    if (!isset($row['id'], $row['banner_path'], $row['logo_path'])) {
        continue;
    }

    App\Models\Category::withoutGlobalScopes()
        ->where('id', (int) $row['id'])
        ->update([
            'banner_path' => (string) $row['banner_path'],
            'logo_path' => (string) $row['logo_path'],
            'banner_media_asset_id' => null,
            'logo_media_asset_id' => null,
            'updated_at' => now(),
        ]);
}
'@ | php

$manifest | Select-Object id, name, slug, banner_path, logo_path | Format-Table -AutoSize

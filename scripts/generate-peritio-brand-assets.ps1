Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$assetsDir = Join-Path $repoRoot "mobile\assets"

$ink = [System.Drawing.Color]::FromArgb(255, 15, 35, 58)
$paper = [System.Drawing.Color]::FromArgb(255, 244, 240, 230)
$sand = [System.Drawing.Color]::FromArgb(255, 232, 221, 203)
$brass = [System.Drawing.Color]::FromArgb(255, 201, 164, 106)
$transparent = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)

function New-RoundedRectPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = [Math]::Max(1, $Radius * 2)

  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-Mark {
  param(
    [System.Drawing.Graphics]$Graphics,
    [float]$X,
    [float]$Y,
    [float]$Size,
    [System.Drawing.Color]$Primary,
    [System.Drawing.Color]$Accent
  )

  $stemWidth = $Size * 0.16
  $stemHeight = $Size * 0.64
  $ringSize = $Size * 0.42
  $ringStroke = [Math]::Max(4, $Size * 0.075)

  $stemPath = New-RoundedRectPath ($X + $Size * 0.23) ($Y + $Size * 0.18) $stemWidth $stemHeight ($stemWidth / 2)
  $stemBrush = New-Object System.Drawing.SolidBrush($Primary)
  $Graphics.FillPath($stemBrush, $stemPath)
  $stemBrush.Dispose()
  $stemPath.Dispose()

  $ringPen = New-Object System.Drawing.Pen($Primary, $ringStroke)
  $ringPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $ringPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $Graphics.DrawEllipse($ringPen, $X + $Size * 0.34, $Y + $Size * 0.18, $ringSize, $ringSize)
  $ringPen.Dispose()

  $accentPath = New-RoundedRectPath ($X + $Size * 0.46) ($Y + $Size * 0.70) ($Size * 0.20) ($Size * 0.04) ($Size * 0.02)
  $accentBrush = New-Object System.Drawing.SolidBrush($Accent)
  $Graphics.FillPath($accentBrush, $accentPath)
  $accentBrush.Dispose()
  $accentPath.Dispose()
}

function Draw-CenteredString {
  param(
    [System.Drawing.Graphics]$Graphics,
    [string]$Text,
    [string]$FontFamily,
    [float]$Size,
    [System.Drawing.FontStyle]$Style,
    [System.Drawing.Color]$Color,
    [float]$Y,
    [float]$CanvasWidth
  )

  $font = New-Object System.Drawing.Font($FontFamily, $Size, $Style, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush($Color)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Near
  $Graphics.DrawString($Text, $font, $brush, $CanvasWidth / 2, $Y, $format)
  $format.Dispose()
  $brush.Dispose()
  $font.Dispose()
}

function Save-Bitmap {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [string]$Path
  )

  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function New-Canvas {
  param(
    [int]$Width,
    [int]$Height,
    [System.Drawing.Color]$Background
  )

  $bitmap = New-Object System.Drawing.Bitmap $Width, $Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear($Background)
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

# icon.png
$iconCanvas = New-Canvas -Width 1024 -Height 1024 -Background $ink
$iconBorderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(28, $paper), 8)
$iconCanvas.Graphics.DrawRectangle($iconBorderPen, 40, 40, 944, 944)
$iconBorderPen.Dispose()
Draw-Mark -Graphics $iconCanvas.Graphics -X 140 -Y 132 -Size 744 -Primary $paper -Accent $brass
Save-Bitmap -Bitmap $iconCanvas.Bitmap -Path (Join-Path $assetsDir "icon.png")
$iconCanvas.Graphics.Dispose()
$iconCanvas.Bitmap.Dispose()

# adaptive-icon.png
$adaptiveCanvas = New-Canvas -Width 1024 -Height 1024 -Background $transparent
Draw-Mark -Graphics $adaptiveCanvas.Graphics -X 140 -Y 132 -Size 744 -Primary $paper -Accent $brass
Save-Bitmap -Bitmap $adaptiveCanvas.Bitmap -Path (Join-Path $assetsDir "adaptive-icon.png")
$adaptiveCanvas.Graphics.Dispose()
$adaptiveCanvas.Bitmap.Dispose()

# splash-icon.png
$splashCanvas = New-Canvas -Width 1800 -Height 1800 -Background $transparent
Draw-Mark -Graphics $splashCanvas.Graphics -X 500 -Y 360 -Size 800 -Primary $ink -Accent $brass
$ruleBrush = New-Object System.Drawing.SolidBrush($brass)
$rulePath = New-RoundedRectPath 690 1232 420 18 9
$splashCanvas.Graphics.FillPath($ruleBrush, $rulePath)
$ruleBrush.Dispose()
$rulePath.Dispose()
Draw-CenteredString -Graphics $splashCanvas.Graphics -Text "Peritio" -FontFamily "Segoe UI Semibold" -Size 188 -Style ([System.Drawing.FontStyle]::Bold) -Color $ink -Y 1090 -CanvasWidth 1800
Save-Bitmap -Bitmap $splashCanvas.Bitmap -Path (Join-Path $assetsDir "splash-icon.png")
$splashCanvas.Graphics.Dispose()
$splashCanvas.Bitmap.Dispose()

# favicon.png
$faviconCanvas = New-Canvas -Width 256 -Height 256 -Background $ink
Draw-Mark -Graphics $faviconCanvas.Graphics -X 24 -Y 20 -Size 208 -Primary $paper -Accent $brass
Save-Bitmap -Bitmap $faviconCanvas.Bitmap -Path (Join-Path $assetsDir "favicon.png")
$faviconCanvas.Graphics.Dispose()
$faviconCanvas.Bitmap.Dispose()

# remove any stale test file from local experiments
$testPath = Join-Path $assetsDir "test-draw.png"
if (Test-Path $testPath) {
  Remove-Item -LiteralPath $testPath -Force
}

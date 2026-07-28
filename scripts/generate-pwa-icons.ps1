Add-Type -AssemblyName System.Drawing

$outputDirectory = Join-Path $PSScriptRoot '..\\public\\icons'
New-Item -ItemType Directory -Force $outputDirectory | Out-Null

function New-MuseboardIcon([int] $size, [string] $filename) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(24, 26, 30))

  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $mint = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(137, 222, 176))

  function Scale-Point([double] $x, [double] $y) {
    return New-Object System.Drawing.PointF([single]($x * $size), [single]($y * $size))
  }

  $left = @(
    (Scale-Point 0.246 0.453),
    (Scale-Point 0.338 0.340),
    (Scale-Point 0.471 0.553),
    (Scale-Point 0.379 0.668)
  )
  $middle = @(
    (Scale-Point 0.387 0.305),
    (Scale-Point 0.490 0.178),
    (Scale-Point 0.719 0.545),
    (Scale-Point 0.615 0.672)
  )
  $right = @(
    (Scale-Point 0.590 0.359),
    (Scale-Point 0.682 0.246),
    (Scale-Point 0.811 0.451),
    (Scale-Point 0.719 0.564)
  )

  $graphics.FillPolygon($white, $left)
  $graphics.FillPolygon($mint, $middle)
  $graphics.FillPolygon($white, $right)

  $target = Join-Path $outputDirectory $filename
  $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)

  $white.Dispose()
  $mint.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-MuseboardIcon 180 'museboard-180.png'
New-MuseboardIcon 192 'museboard-192.png'
New-MuseboardIcon 512 'museboard-512.png'

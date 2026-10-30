# Desenha as imagens do instalador do Windows (NSIS) no estilo Zen Noturno.
# sidebar.bmp 164x314 (telas de boas-vindas/fim) e header.bmp 150x57 (cabeçalho das demais telas).
Add-Type -AssemblyName System.Drawing
$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'src-tauri\installer'
New-Item -ItemType Directory -Force $out | Out-Null

$ink   = [System.Drawing.Color]::FromArgb(18, 17, 16)
$washi = [System.Drawing.Color]::FromArgb(233, 228, 216)
$faint = [System.Drawing.Color]::FromArgb(142, 136, 124)
$seal  = [System.Drawing.Color]::FromArgb(200, 55, 45)
$red   = [System.Drawing.Color]::FromArgb(232, 96, 78)
$rand  = New-Object System.Random 7

function New-Canvas($w, $h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear($ink)
  # Textura de papel: pontinhos claros bem sutis.
  for ($i = 0; $i -lt ($w * $h / 9); $i++) {
    $a = $rand.Next(4, 16)
    $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($a, 233, 228, 216))
    $g.FillRectangle($b, $rand.Next(0, $w), $rand.Next(0, $h), 1, 1); $b.Dispose()
  }
  return @($bmp, $g)
}

# Ensō: vários arcos sobrepostos com espessura variando, como pincel seco.
function Draw-Enso($g, $x, $y, $d, $width) {
  for ($k = 0; $k -lt 26; $k++) {
    $start = -70 + $k * 12.5
    $w = $width * (0.55 + 0.45 * [Math]::Sin([Math]::PI * $k / 26))
    $alpha = [int](200 + 40 * [Math]::Sin([Math]::PI * $k / 26))
    $jit = $rand.NextDouble() * 1.4
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($alpha, $washi)), $w
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
    $g.DrawArc($pen, [single]($x + $jit), [single]($y - $jit), [single]$d, [single]$d, [single]$start, [single]14)
    $pen.Dispose()
  }
}

function Draw-Seal($g, $x, $y, $s, $char) {
  $st = $g.Save()
  $g.TranslateTransform($x + $s / 2, $y + $s / 2); $g.RotateTransform(-4)
  $b = New-Object System.Drawing.SolidBrush $seal
  $g.FillRectangle($b, -$s / 2, -$s / 2, $s, $s)
  $p = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(220, 246, 241, 231)), 1.2
  $g.DrawRectangle($p, -$s / 2 + 3, -$s / 2 + 3, $s - 6, $s - 6)
  $f = New-Object System.Drawing.Font 'Yu Gothic', ($s * 0.42), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $g.DrawString($char, $f, (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(246, 241, 231))), 0, 1, $fmt)
  $g.Restore($st)
}

# ---------- Barra lateral ----------
$bmp, $g = New-Canvas 164 314
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath; $glow.AddEllipse(-60, 20, 280, 280)
$pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $glow
$pgb.CenterColor = [System.Drawing.Color]::FromArgb(30, 233, 228, 216); $pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 18, 17, 16))
$g.FillEllipse($pgb, -60, 20, 280, 280)
Draw-Enso $g 22 70 120 9
$f = New-Object System.Drawing.Font 'Yu Gothic', 34, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$g.DrawString('金庫', $f, (New-Object System.Drawing.SolidBrush $washi), 82, 130, $fmt)
$f2 = New-Object System.Drawing.Font 'Segoe UI', 9, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('C O F R E   P E S S O A L', $f2, (New-Object System.Drawing.SolidBrush $faint), 82, 214, $fmt)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(150, 90, 85, 76)), 1.5
$g.DrawBezier($pen, 30, 236, 70, 232, 100, 240, 134, 234)
Draw-Seal $g 66 258 32 '印'
$f3 = New-Object System.Drawing.Font 'Yu Gothic', 13, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$vfmt = New-Object System.Drawing.StringFormat ([System.Drawing.StringFormatFlags]::DirectionVertical)
$g.DrawString('心を静めて鍵を守る', $f3, (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 233, 228, 216))), 138, 18, $vfmt)
$bmp.Save((Join-Path $out 'sidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $bmp.Dispose()

# ---------- Cabeçalho ----------
$bmp, $g = New-Canvas 150 57
Draw-Enso $g 8 8 40 3.5
$f = New-Object System.Drawing.Font 'Yu Gothic', 18, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('金庫', $f, (New-Object System.Drawing.SolidBrush $washi), 56, 9)
$f2 = New-Object System.Drawing.Font 'Segoe UI', 9, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('COFRE', $f2, (New-Object System.Drawing.SolidBrush $faint), 58, 34)
Draw-Seal $g 120 16 22 '印'
$bmp.Save((Join-Path $out 'header.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $bmp.Dispose()

Get-ChildItem $out | ForEach-Object { "{0}  {1:N0} bytes" -f $_.Name, $_.Length }

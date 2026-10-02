# 非侵入式截图：对正在运行的 ImagoTune 实例（无 CDP 端口）做
# 窗口缩放 + UI Automation 点击导航 + PrintWindow 截屏。
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File tools/capture-running-ui.ps1
param(
  [int[]]$Widths = @(1920, 1450, 1280, 1050, 900, 800, 700, 560),
  [int]$Height = 940,
  [string]$OutDir = ".sisyphus\evidence\mode-cards",
  [string]$ProcessName = "electron"
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Drawing

$out = Resolve-Path . | Join-Path -ChildPath $OutDir
New-Item -ItemType Directory -Force -Path $out | Out-Null

# 1) 找主窗口（ImagoTune 标题，进程 electron.exe）
$proc = Get-Process $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "未找到带窗口的 $ProcessName 进程"; exit 1 }
$hwnd = $proc.MainWindowHandle
Write-Host "target pid=$($proc.Id) hwnd=$hwnd title='$($proc.MainWindowTitle)'"

# 记录原窗口位置，结束后还原
$sig = @'
using System;
using System.Runtime.InteropServices;
public class U32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int ht, uint f);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
}
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
Add-Type -TypeDefinition $sig -ReferencedAssemblies System.Drawing | Out-Null

$orig = New-Object RECT
[U32]::GetWindowRect($hwnd, [ref]$orig) | Out-Null
Write-Host ("orig rect: {0},{1} - {2},{3}" -f $orig.Left, $orig.Top, $orig.Right, $orig.Bottom)

function Capture([string]$name) {
  $r = New-Object RECT
  [U32]::GetWindowRect($hwnd, [ref]$r) | Out-Null
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [U32]::PrintWindow($hwnd, $hdc, 2) | Out-Null   # PW_RENDERFULLCONTENT
  $g.ReleaseHdc($hdc); $g.Dispose()
  $file = Join-Path $out "$name.png"
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "SHOT $name.png (${w}x${h})"
}

function Click-Nav([string]$text) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)
  $btn = $null
  foreach ($b in $buttons) {
    if ($b.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
        $b.Current.Name -and $b.Current.Name.Contains($text)) { $btn = $b; break }
  }
  if (-not $btn) { Write-Host "NAV NOT FOUND: $text"; return $false }
  $ip = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $ip.Invoke()
  return $true
}

$SWP_NOZORDER = 0x0004
$navs = @(@("generate", "创作生成"), @("edit", "图片编辑"), @("outpaint", "智能扩图"))

foreach ($W in $Widths) {
  [U32]::SetWindowPos($hwnd, [IntPtr]::Zero, $orig.Left, $orig.Top, $W, $Height, $SWP_NOZORDER) | Out-Null
  Start-Sleep -Milliseconds 700   # 等 View Transitions 与布局稳定
  foreach ($n in $navs) {
    $ok = Click-Nav $n[1]
    Start-Sleep -Milliseconds 800
    if ($ok) { Capture ("{0}-w{1}" -f $n[0], $W) }
  }
}

# 还原窗口
$ow = $orig.Right - $orig.Left; $oh = $orig.Bottom - $orig.Top
[U32]::SetWindowPos($hwnd, [IntPtr]::Zero, $orig.Left, $orig.Top, $ow, $oh, $SWP_NOZORDER) | Out-Null
Write-Host "window restored"
Write-Host "OUT: $out"

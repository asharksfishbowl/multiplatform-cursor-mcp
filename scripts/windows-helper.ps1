# The server's Windows half, run once a call: a screenshot, Windows.Media.Ocr of a PNG, the windows of a process or title, bringing one forward,
# and whether the focused control is a password field. Every point is a physical desktop pixel (this process is per-monitor DPI aware).
param([string]$Action, [string]$Arg, [string]$Arg2, [string]$Arg3)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class Dk {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@
[Dk]::SetProcessDpiAwarenessContext([IntPtr]-4) | Out-Null

# Every visible, titled top-level window: handle, process, title, rectangle.
function Windows {
  $List = New-Object System.Collections.Generic.List[object]
  [Dk]::EnumWindows({ param($H, $L)
    if ([Dk]::IsWindowVisible($H)) {
      $S = New-Object System.Text.StringBuilder 512; [void][Dk]::GetWindowText($H, $S, 512)
      if ($S.Length) {
        $ProcId = [uint32]0; [void][Dk]::GetWindowThreadProcessId($H, [ref]$ProcId)
        $R = New-Object Dk+RECT; [void][Dk]::GetWindowRect($H, [ref]$R)
        $Name = (Get-Process -Id $ProcId -ErrorAction SilentlyContinue).ProcessName
        $List.Add([pscustomobject]@{ Handle = $H; Process = $Name; Pid = $ProcId; Title = $S.ToString(); L = $R.L; T = $R.T; R = $R.R; B = $R.B; Minimized = [Dk]::IsIconic($H) })
      }
    }
    $true }, [IntPtr]::Zero) | Out-Null
  return $List
}
# A window by process name (exact, no .exe) or by a title that holds the text; the first in Z order.
function WindowOf([string]$Which) {
  $All = Windows
  $W = @($All | Where-Object { $_.Process -eq $Which }) + @($All | Where-Object { $_.Title -like "*$Which*" })
  if (-not $W) { throw "no window of a process or with a title '$Which'" }
  return $W[0]
}
function Line($W) { "$($W.Process) pid=$($W.Pid) rect=$($W.L),$($W.T),$($W.R),$($W.B)$(if ($W.Minimized) { ' minimized' }) '$($W.Title)'" }

switch ($Action) {
  # screenshot <png> [window] [maxWidth]: the whole desktop or one window's rectangle, saved whole at <png>; given maxWidth, a copy at most that wide beside it (<png>.view.png).
  'screenshot' {
    Add-Type -AssemblyName System.Drawing, System.Windows.Forms
    $V = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $X = $V.X; $Y = $V.Y; $Wd = $V.Width; $Ht = $V.Height
    if ($Arg2) { $W = WindowOf $Arg2; $X = $W.L; $Y = $W.T; $Wd = $W.R - $W.L; $Ht = $W.B - $W.T }
    $B = New-Object System.Drawing.Bitmap $Wd, $Ht
    $G = [System.Drawing.Graphics]::FromImage($B); $G.CopyFromScreen($X, $Y, 0, 0, $B.Size); $G.Dispose()
    $B.Save($Arg, [System.Drawing.Imaging.ImageFormat]::Png)
    $Max = if ($Arg3) { [int]$Arg3 } else { 0 }
    $K = if ($Max -gt 0 -and $Wd -gt $Max) { $Wd / $Max } else { 1 }
    if ($K -ne 1) {
      $S = New-Object System.Drawing.Bitmap ([int]($Wd / $K)), ([int]($Ht / $K))
      $G = [System.Drawing.Graphics]::FromImage($S); $G.InterpolationMode = 'HighQualityBicubic'; $G.DrawImage($B, 0, 0, $S.Width, $S.Height); $G.Dispose()
      $S.Save("$Arg.view.png", [System.Drawing.Imaging.ImageFormat]::Png); $S.Dispose()
    } elseif ($Max -gt 0) { Copy-Item $Arg "$Arg.view.png" }
    $B.Dispose()
    "$X $Y $Wd $Ht $K"
  }
  # ocr <png> [offsetX] [offsetY]: one line a text line, 'x,y,right,bottom text', in the image's pixels plus the offset (a window shot's own corner gives desktop pixels).
  'ocr' {
    $OX = if ($Arg2) { [int]$Arg2 } else { 0 }; $OY = if ($Arg3) { [int]$Arg3 } else { 0 }
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
    $AsTask = @([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    function Await($Op, [Type]$T) { $Task = $AsTask.MakeGenericMethod($T).Invoke($null, @($Op)); [void]$Task.Wait(-1); return ,$Task.Result }
    $File = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Arg)) ([Windows.Storage.StorageFile])
    $Stream = Await ($File.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $Dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($Stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $Soft = Await ($Dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $Res = Await ([Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages().RecognizeAsync($Soft)) ([Windows.Media.Ocr.OcrResult])
    $Stream.Dispose()
    foreach ($L in $Res.Lines) { $W = @(foreach ($x in $L.Words) { $x }); $A = $W[0].BoundingRect; $Z = $W[$W.Count - 1].BoundingRect
      "$([int]$A.X + $OX),$([int]$A.Y + $OY),$([int]($Z.X + $Z.Width) + $OX),$([int]($A.Y + $A.Height) + $OY) $($L.Text)" }
  }
  # size: the primary display's width and height in physical pixels.
  'size' {
    Add-Type -AssemblyName System.Windows.Forms
    $S = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    "$($S.Width) $($S.Height)"
  }
  # windows [text]: every visible titled window, or those of a process or with a title holding the text.
  'windows' {
    $All = Windows
    if ($Arg) { $All = @($All | Where-Object { $_.Process -eq $Arg -or $_.Title -like "*$Arg*" }) }
    foreach ($W in $All) { Line $W }
  }
  # foreground: the window that has the input now.
  'foreground' {
    $H = [Dk]::GetForegroundWindow()
    $W = Windows | Where-Object { $_.Handle -eq $H } | Select-Object -First 1
    if ($W) { Line $W } else { 'none' }
  }
  'focus' {
    $W = WindowOf $Arg
    # Restore only a minimized window: a restore on a maximized one un-maximizes it (measured on the user's editor, 2026-11-11).
    if ($W.Minimized) { [Dk]::ShowWindow($W.Handle, 9) | Out-Null }
    # An Alt tap first: Windows refuses the foreground to a process that did not get the last input.
    [Dk]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [Dk]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [Dk]::SetForegroundWindow($W.Handle) | Out-Null
    "focused $(Line (WindowOf $Arg))"
  }
  # password: 'yes <name>' when UI Automation's focused element is a password field, else 'no <name>'.
  'password' {
    Add-Type -AssemblyName UIAutomationClient
    $F = [System.Windows.Automation.AutomationElement]::FocusedElement
    if (-not $F) { 'no (no focused element)'; break }
    $C = $F.Current
    "$(if ($C.IsPassword) { 'yes' } else { 'no' }) '$($C.Name)' $($C.ControlType.ProgrammaticName)"
  }
  default { throw "no action $Action" }
}

# The desktop server's Windows half: a screenshot of every display, Windows.Media.Ocr of a PNG, and a window brought forward. Physical pixels.
param([string]$Action, [string]$Arg)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Dk {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@
[Dk]::SetProcessDpiAwarenessContext([IntPtr]-4) | Out-Null
switch ($Action) {
  'screenshot' {
    Add-Type -AssemblyName System.Drawing, System.Windows.Forms
    $S = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $B = New-Object System.Drawing.Bitmap $S.Width, $S.Height
    $G = [System.Drawing.Graphics]::FromImage($B); $G.CopyFromScreen($S.X, $S.Y, 0, 0, $B.Size); $G.Dispose()
    $B.Save($Arg, [System.Drawing.Imaging.ImageFormat]::Png); $B.Dispose()
    "$Arg $($S.Width)x$($S.Height) at $($S.X),$($S.Y)"
  }
  'ocr' {
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
      "$([int]$A.X),$([int]$A.Y),$([int]($Z.X + $Z.Width)),$([int]($A.Y + $A.Height)) $($L.Text)" }
  }
  'size' {
    Add-Type -AssemblyName System.Windows.Forms
    $S = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    "$($S.Width) $($S.Height)"
  }
  'maximize' {
    $P = Get-Process $Arg -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $P) { throw "no window of the process $Arg" }
    [Dk]::ShowWindow($P.MainWindowHandle, 3) | Out-Null
    "maximized $Arg '$($P.MainWindowTitle)'"
  }
  'focus' {
    $P = Get-Process $Arg -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $P) { throw "no window of the process $Arg" }
    # Restore only a minimized window: a restore on a maximized one un-maximizes it (measured on the user's editor, 2026-11-11).
    if ([Dk]::IsIconic($P.MainWindowHandle)) { [Dk]::ShowWindow($P.MainWindowHandle, 9) | Out-Null }
    [Dk]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [Dk]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [Dk]::SetForegroundWindow($P.MainWindowHandle) | Out-Null
    $R = New-Object Dk+RECT; [Dk]::GetWindowRect($P.MainWindowHandle, [ref]$R) | Out-Null
    "focused $Arg '$($P.MainWindowTitle)' rect=$($R.L),$($R.T),$($R.R),$($R.B)"
  }
}

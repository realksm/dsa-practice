# Saves a PNG of the first visible window whose title contains -Title. Windows only.
# -Width/-Height: resize the window first (physical pixels). PrintWindow with PW_RENDERFULLCONTENT
# captures it even when other windows cover it.
param([Parameter(Mandatory)][string]$Title, [string]$Out, [int]$Width = 0, [int]$Height = 0)
$ErrorActionPreference = "Stop"
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
public static class Shot {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  public struct RECT { public int L, T, R, B; }
  public static IntPtr Find(string part) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      if (sb.ToString().Contains(part)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static void Init() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
  public static void Resize(IntPtr h, int w, int hgt) {
    ShowWindow(h, 9); // SW_RESTORE
    SetWindowPos(h, IntPtr.Zero, 40, 40, w, hgt, 0x0004 | 0x0010); // NOZORDER | NOACTIVATE
  }
  public static void Save(IntPtr h, string file) {
    RECT r; GetWindowRect(h, out r);
    // The visible frame, without the invisible resize border Windows adds around it.
    RECT f;
    if (DwmGetWindowAttribute(h, 9, out f, Marshal.SizeOf(typeof(RECT))) != 0) f = r;
    using (var full = new Bitmap(r.R - r.L, r.B - r.T, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(full)) {
        IntPtr dc = g.GetHdc();
        PrintWindow(h, dc, 2);
        g.ReleaseHdc(dc);
      }
      var crop = new Rectangle(f.L - r.L, f.T - r.T, f.R - f.L, f.B - f.T);
      using (var part = full.Clone(crop, PixelFormat.Format24bppRgb)) part.Save(file, ImageFormat.Png);
    }
  }
}
"@
[Shot]::Init()
$h = [Shot]::Find($Title)
if ($h -eq [IntPtr]::Zero) { Write-Error "no window with '$Title' in its title" }
if ($Width -gt 0) { [Shot]::Resize($h, $Width, $Height) }
if ($Out) { [Shot]::Save($h, $Out) }

using System.Runtime.InteropServices;
using System.Text;

namespace Pokerace.Client.Launcher;

internal static class EmulatorWindows
{
    private delegate bool Callback(IntPtr handle, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr state);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("winmm.dll", EntryPoint = "waveOutGetNumDevs")] internal static extern uint AudioDeviceCount();
    internal static void Close(int processId) => EnumWindows((handle, _) =>
    {
        GetWindowThreadProcessId(handle, out var owner);
        if (owner != processId) return true;
        var title = new StringBuilder(2048); GetWindowText(handle, title, title.Capacity);
        if (title.ToString().EndsWith(" - BizHawk", StringComparison.Ordinal)) PostMessage(handle, 0x0010, IntPtr.Zero, IntPtr.Zero);
        return true;
    }, IntPtr.Zero);
}

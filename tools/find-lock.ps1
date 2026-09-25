param([string]$TargetPath = "D:\Code\image-studio-main\dist\win-unpacked.tmp\resources\default_app.asar")

$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class LockFinder {
    [StructLayout(LayoutKind.Sequential)]
    public struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct RM_PROCESS_INFO {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceShortName;
        public int ApplicationType; public uint AppStatus; public uint TSSessionId; [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
    }
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, [In] RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);
    [DllImport("rstrtmgr.dll")]
    public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
    [DllImport("rstrtmgr.dll")]
    public static extern int RmEndSession(uint pSessionHandle);

    public static List<string> WhoLocks(string path) {
        var result = new List<string>();
        uint handle;
        string key = Guid.NewGuid().ToString();
        if (RmStartSession(out handle, 0, key) != 0) { result.Add("RmStartSession failed"); return result; }
        try {
            string[] resources = new[] { path };
            if (RmRegisterResources(handle, (uint)resources.Length, resources, 0, null, 0, null) != 0) { result.Add("RmRegisterResources failed"); return result; }
            uint needed = 0, count = 0, reasons = 0;
            int res = RmGetList(handle, out needed, ref count, null, ref reasons);
            if (needed > 0) {
                var infos = new RM_PROCESS_INFO[needed];
                count = needed;
                res = RmGetList(handle, out needed, ref count, infos, ref reasons);
                for (uint i = 0; i < count; i++) result.Add(infos[i].Process.dwProcessId + "`t" + infos[i].strAppName);
            } else { result.Add("NO_LOCK_FOUND"); }
        } finally { RmEndSession(handle); }
        return result;
    }
}
'@
Add-Type -TypeDefinition $sig
[LockFinder]::WhoLocks($TargetPath)

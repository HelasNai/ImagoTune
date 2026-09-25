$procs = Get-Process electron -ErrorAction SilentlyContinue
if (-not $procs) { Write-Output "NO_ELECTRON_RUNNING" }
foreach ($p in $procs) {
  $path = try { $p.Path } catch { "(access denied)" }
  Write-Output ("{0}`t{1}" -f $p.Id, $path)
}

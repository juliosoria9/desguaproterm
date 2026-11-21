# Compila desguaproterm y la instala para tu usuario, con accesos directos en el Escritorio y el menú Inicio.
# Uso:  powershell -ExecutionPolicy Bypass -File instalar.ps1
#
# Tus pestañas, favoritos y ajustes viven DENTRO del .exe (flujos de datos NTFS). Reemplazar el .exe
# a pelo los borraría, así que este script los guarda antes de copiar el nuevo y los vuelve a poner.
# También se trae los datos de la versión anterior (Claude Terminal) y la retira.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

if (Get-Process desguaproterm, claude-terminal -ErrorAction SilentlyContinue) {
  Write-Host 'Cierra la app antes de instalar (tus sesiones se reabrirán solas al volver a abrirla).' -ForegroundColor Yellow
  exit 1
}

npx tauri build --no-bundle
if ($LASTEXITCODE) { exit $LASTEXITCODE }

$bytes = if ($PSVersionTable.PSVersion.Major -ge 6) { @{ AsByteStream = $true } } else { @{ Encoding = 'Byte' } }
$streamsOf = { param($f) Get-Item $f -Stream * | Where-Object { $_.Stream -notin ':$DATA', 'Zone.Identifier' } }
$readStreams = { param($f) $r = @{}; if (Test-Path $f) { foreach ($s in & $streamsOf $f) { $r[$s.Stream] = Get-Content $f -Stream $s.Stream -Raw @bytes } }; $r }

$dest = Join-Path $env:LOCALAPPDATA 'Programs\desguaproterm'
$exe = Join-Path $dest 'desguaproterm.exe'
$oldDir = Join-Path $env:LOCALAPPDATA 'Programs\Claude Terminal'
$oldExe = Join-Path $oldDir 'claude-terminal.exe'
New-Item -ItemType Directory -Force $dest | Out-Null

# 1. guarda tus datos (los del .exe instalado o, la primera vez, los de Claude Terminal)
$saved = & $readStreams $exe
$from = 'desguaproterm'
if ($saved.Count -eq 0 -and (Test-Path $oldExe)) { $saved = & $readStreams $oldExe; $from = 'Claude Terminal' }

# 2. copia el .exe nuevo, sin los datos de pruebas que pudiera llevar el de la carpeta de compilación
Copy-Item 'src-tauri\target\release\desguaproterm.exe' $exe -Force
foreach ($s in & $streamsOf $exe) { Remove-Item $exe -Stream $s.Stream }
# 3. vuelve a poner tus datos (los títulos resumidos se regeneran solos)
foreach ($k in $saved.Keys) { if ($saved[$k]) { Set-Content $exe -Stream $k -Value $saved[$k] @bytes } }

# 4. accesos directos
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))
foreach ($dir in $places) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'desguaproterm.lnk'))
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = $dest
  $lnk.IconLocation = "$exe,0"
  $lnk.Description = 'desguaproterm: terminal para trabajar con Claude Code'
  $lnk.Save()
  Remove-Item (Join-Path $dir 'Claude Terminal.lnk') -ErrorAction SilentlyContinue
}

# 5. retira la versión anterior (y su arranque con Windows, que pasa a la nueva)
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$props = Get-ItemProperty $run -ErrorAction SilentlyContinue
foreach ($p in $props.PSObject.Properties) {
  if ("$($p.Value)" -like '*claude-terminal.exe*') {
    Remove-ItemProperty $run -Name $p.Name
    Set-ItemProperty $run -Name 'desguaproterm' -Value "`"$exe`""
  }
}
if (Test-Path $oldDir) { Remove-Item $oldDir -Recurse -Force }

Write-Host "Instalada en $exe ($($saved.Count) datos tuyos conservados, de $from)" -ForegroundColor Green

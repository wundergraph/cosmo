Write-Host "Installing wgc...

__      ____ _  ___
\ \ /\ / / _` |/ __|
 \ V  V / (_| | (__
  \_/\_/ \__, |\___|
         |___/
"

$OS = $env:OS
$URL = ""

if ($OS -eq "Windows_NT") {
    $URL = "https://github.com/wundegraph/cosmo/releases/latest/download/wgc-windows.exe"
} else {
    Write-Host "Unsupported OS: $OS"
    exit 1
}

Invoke-WebRequest -Uri $URL -OutFile $env:ProgramFiles\wgc\wgc.exe
chmod +x $env:ProgramFiles\wgc\wgc.exe

Write-Host "wgc installed successfully!"
chmod +x wgc.exe

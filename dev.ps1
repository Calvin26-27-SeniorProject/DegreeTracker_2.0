$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

npm run build

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command py -ErrorAction SilentlyContinue
}

if (-not $python) {
    Write-Error "Python is required to serve the app locally."
}

if ($python.Name -eq "py.exe") {
    & $python.Source -3 -m http.server 8000 --directory docs
} else {
    & $python.Source -m http.server 8000 --directory docs
}

param([string]$Dotnet, [string]$BizHawkDir)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$output = Join-Path $root 'native/Pokerace.Client/artifacts/launcher-win-x64'
if (!$Dotnet) {
    $local = Join-Path $root '.work/dotnet/dotnet.exe'
    if (Test-Path -LiteralPath $local) { $Dotnet = $local }
    elseif (Get-Command dotnet -ErrorAction SilentlyContinue) { $Dotnet = (Get-Command dotnet).Source }
    else {
        # Portable SDK, no administrator rights and no machine-wide installation.
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Write-Host 'Premier lancement : preparation du SDK .NET portable...'
        $metadata = Invoke-RestMethod 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json'
        $sdk = @($metadata.releases | ForEach-Object { $_.sdks } | Where-Object { $_.version -eq '8.0.425' })[0]
        $file = @($sdk.files | Where-Object { $_.rid -eq 'win-x64' -and $_.name -like '*.zip' })[0]
        if (!$file -or ([uri]$file.url).Scheme -ne 'https' -or ([uri]$file.url).Host -ne 'builds.dotnet.microsoft.com') { throw 'SDK metadata is invalid.' }
        $work = Join-Path $root '.work'
        New-Item -ItemType Directory -Force $work | Out-Null
        $zip = Join-Path $work 'dotnet-sdk-8.0.425.zip'
        Invoke-WebRequest -UseBasicParsing -Uri $file.url -OutFile $zip
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA512).Hash -ne $file.hash) { throw 'SDK checksum mismatch.' }
        Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $work 'dotnet') -Force
        $Dotnet = $local
    }
}
if (!$BizHawkDir) {
    $BizHawkDir = Join-Path $root 'bridges/bizhawk/.runtime'
    & (Join-Path $root 'bridges/bizhawk/e2e/prepare-bizhawk.ps1') -Destination $BizHawkDir
}
& $Dotnet build (Join-Path $root 'bridges/bizhawk/src/Pokerace.BizHawkBridge/Pokerace.BizHawkBridge.csproj') --configuration Release "-p:BizHawkDir=$BizHawkDir"
if ($LASTEXITCODE -ne 0) { throw 'Bridge build failed.' }
& $Dotnet publish (Join-Path $root 'native/Pokerace.Client/src/Pokerace.Client/Pokerace.Client.csproj') --configuration Release --runtime win-x64 --self-contained true '-p:PublishSingleFile=true' '-p:BundleBridge=true' '-p:DebugType=None' -o $output
if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
Write-Host "Pret : $output/Pokerace.Client.exe"

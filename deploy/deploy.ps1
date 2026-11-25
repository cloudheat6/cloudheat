# 빌드해서 리눅스 서버로 배포
#   deploy.cmd                       전체 (가상 ERP → MES API → MES 화면 → 포트폴리오)
#   deploy.cmd -Mes                  MES 화면만      (mes-web → mes.cloudheat.kr)
#   deploy.cmd -Site                 포트폴리오만    (site → cloudheat.kr)
#   deploy.cmd -Api                  MES API 만      (api)
#   deploy.cmd -Erp                  가상 ERP 만     (mock-erp)
#   여러 개 조합 가능: deploy.cmd -Api -Mes
#   deploy.cmd -SkipBuild            빌드 생략
#   deploy.cmd -Rollback [-Mes ...]  이전 버전으로 (선택한 것만, 없으면 전체)
#   deploy.cmd -List                 서버 버전 목록
#   deploy.cmd -ResetData            MES · 가상 ERP 데이터 초기화
#   deploy.cmd -Bump minor           버전 올리고(VERSION · package.json) 커밋 · 태그 → 배포 → GitHub push
#                                    patch: 버그 수정  minor: 기능 · 화면 추가  major: 큰 변경
param(
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump,
    [switch]$Site,
    [switch]$Mes,
    [switch]$Api,
    [switch]$Erp,
    [switch]$SkipBuild,
    [switch]$Rollback,
    [switch]$List,
    [switch]$ResetData
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'config.ps1')

$Root    = Split-Path $PSScriptRoot -Parent
$Target  = "$User@$Server"
$OutDir  = Join-Path $PSScriptRoot '.out'
$SshArgs = @('-p', $Port, '-i', $SshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10')
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# 컴포넌트: 이름 → 빌드 방법 · 결과물 폴더
$Components = [ordered]@{
    erp  = @{ Kind = 'dotnet'; Src = 'mock-erp'; Check = 'Cloudheat.MockErp.dll' }
    api  = @{ Kind = 'dotnet'; Src = 'api';      Check = 'Cloudheat.Api.dll' }
    mes  = @{ Kind = 'vite';   Src = 'mes-web';  Check = 'index.html' }
    site = @{ Kind = 'vite';   Src = 'site';     Check = 'index.html' }
}
$picked = @($Components.Keys | Where-Object { (Get-Variable -Name $_ -ValueOnly).IsPresent })
if ($picked.Count -eq 0) { $picked = @($Components.Keys) }

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what 실패 (exit $LASTEXITCODE)" } }
function OutPath($name) {
    $c = $Components[$name]
    if ($c.Kind -eq 'vite') { Join-Path $Root "$($c.Src)\dist" } else { Join-Path $OutDir $name }
}

# remote.sh 를 stdin 으로 넘겨 서버에서 실행 (Windows PowerShell 이 붙이는 BOM/CR 제거)
function Invoke-Remote([string[]]$arguments) {
    $script = Get-Content (Join-Path $PSScriptRoot 'remote.sh') -Raw -Encoding UTF8
    $script | ssh @SshArgs $Target "tr -d '\r' | sed '1s/^\xEF\xBB\xBF//' > /tmp/$AppName-remote.sh && bash /tmp/$AppName-remote.sh $AppName $KeepReleases $($arguments -join ' '); rc=`$?; rm -f /tmp/$AppName-remote.sh; exit `$rc"
}

Step "서버 연결 확인: $Target"
ssh @SshArgs $Target 'true'
if ($LASTEXITCODE -ne 0) {
    throw "SSH 접속 실패. 서버가 켜져 있는지, setup-server.cmd 를 한 번 실행했는지 확인하세요."
}

if ($List)      { Invoke-Remote @('list');  exit $LASTEXITCODE }
if ($ResetData) { Invoke-Remote @('reset'); exit $LASTEXITCODE }
if ($Rollback)  { Step "이전 버전으로 롤백: $($picked -join ', ')"; Invoke-Remote (@('rollback') + $picked); Check '롤백'; exit 0 }

# ── 버전 ──────────────────────────────────────────────────
function Invoke-Git { git -C $Root @args; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') 실패" } }
$VersionFile = Join-Path $Root 'VERSION'
$Version = (Get-Content $VersionFile -Raw).Trim()
$dirty = [bool](git -C $Root status --porcelain)

if ($Bump) {
    if ($dirty) { throw '커밋하지 않은 변경이 있어요. 먼저 커밋한 뒤 -Bump 하세요. (git status 로 확인)' }
    $v = $Version.Split('.') | ForEach-Object { [int]$_ }
    switch ($Bump) {
        'major' { $v = @($v[0] + 1, 0, 0) }
        'minor' { $v = @($v[0], $v[1] + 1, 0) }
        'patch' { $v = @($v[0], $v[1], $v[2] + 1) }
    }
    $New = $v -join '.'
    Step "버전 올림: $Version → $New"
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($VersionFile, "$New`n", $utf8)
    foreach ($pkg in 'site\package.json', 'mes-web\package.json') {
        $p = Join-Path $Root $pkg
        $s = [regex]::Replace([IO.File]::ReadAllText($p), '"version":\s*"[^"]*"', "`"version`": `"$New`"", 1)
        [IO.File]::WriteAllText($p, $s, $utf8)
    }
    Invoke-Git add VERSION site/package.json mes-web/package.json
    Invoke-Git commit -q -m "release: v$New"
    Invoke-Git tag -a "v$New" -m "v$New"
    $Version = $New
} elseif ($dirty) {
    Write-Warning '커밋하지 않은 변경이 있는 상태로 배포해요. 화면 버전에 -dirty 가 붙어요.'
}
$Sha = (git -C $Root rev-parse --short HEAD) + $(if ($dirty -and -not $Bump) { '-dirty' } else { '' })
Step "배포 버전: v$Version ($Sha)"

$Release = Get-Date -Format 'yyyyMMdd-HHmmss'
$tarballs = @()
try {
    # 1) 빌드
    if (-not $SkipBuild) {
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { $env:Path = "C:\Program Files\nodejs;$env:Path" }
        foreach ($name in $picked) {
            $c = $Components[$name]
            $src = Join-Path $Root $c.Src
            Step "빌드: $name ($($c.Src))"
            if ($c.Kind -eq 'vite') {
                Push-Location $src
                try {
                    if (-not (Test-Path 'node_modules')) { npm install; Check "$name npm install" }
                    npm run build; Check "$name 빌드"
                } finally { Pop-Location }
            } else {
                $out = OutPath $name
                if (Test-Path $out) { Remove-Item -Recurse -Force $out }
                dotnet publish $src -c Release -o $out --nologo -v quiet "-p:Version=$Version"; Check "$name 빌드"
            }
        }
    }

    # 2) 압축 · 업로드
    Step "압축 · 업로드: $Release ($($picked -join ', '))"
    $applyArgs = @('apply', $Release)
    foreach ($name in $picked) {
        $out = OutPath $name
        if (-not (Test-Path (Join-Path $out $Components[$name].Check))) { throw "$name 빌드 결과물이 없습니다: $out" }
        $tar = Join-Path $PSScriptRoot "$name-$Release.tar.gz"
        $tarballs += $tar
        tar -czf $tar -C $out .; Check "tar ($name)"
        $remote = "/tmp/$AppName-$name-$Release.tar.gz"
        scp -P $Port -i $SshKey -o BatchMode=yes -q $tar "${Target}:$remote"; Check "업로드 ($name)"
        $applyArgs += "$name=$remote"
    }

    # 3) 서버 적용: 서비스는 재시작 → 헬스체크 (실패 시 자동 되돌림)
    Step "릴리스 적용: $Release"
    Invoke-Remote $applyArgs
    Check '릴리스 적용'
}
finally {
    Remove-Item $tarballs -ErrorAction SilentlyContinue
}

# 4) 바깥에서 확인
Step "확인"
$checks = @()
if ($picked -contains 'site') { $checks += "http://${Server}/" }
if ($picked -contains 'mes')  { $checks += "http://${Server}:8080/" }
if ($picked -contains 'api' -or $picked -contains 'erp') { $checks += "http://${Server}:8080/api/integration/summary" }
foreach ($url in $checks) {
    try {
        $res = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 10
        Write-Host "$url  HTTP $($res.StatusCode) OK" -ForegroundColor Green
    } catch {
        Write-Warning "$url 응답 확인 실패: $($_.Exception.Message)"
    }
}

# 5) 버전을 올렸으면 GitHub 에 커밋 · 태그 올리기
if ($Bump) {
    Step "GitHub push: v$Version"
    git -C $Root push origin HEAD --follow-tags
    if ($LASTEXITCODE -ne 0) { Write-Warning "push 실패. 나중에 'git push origin HEAD --follow-tags' 를 실행하세요." }
}

Write-Host "`n배포 완료: v$Version ($Sha) · 릴리스 $Release" -ForegroundColor Green

# 서버 최초 1회 설정: SSH 키 등록 + Caddy 설치/설정
#   실행: npm run setup-server   (또는 setup-server.cmd 더블클릭)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'config.ps1')
$Target = "$User@$Server"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what 실패 (exit $LASTEXITCODE)" } }

# 1) SSH 키 만들기 (없을 때만, 암호 없이 — 배포 자동화용)
if (-not (Test-Path "$SshKey.pub")) {
    Step "SSH 키 생성: $SshKey"
    New-Item -ItemType Directory -Force (Split-Path $SshKey) | Out-Null
    ssh-keygen -t ed25519 -f $SshKey -N '""' -C "cloudheat-deploy"
    Check 'ssh-keygen'
}

# 키에 암호가 걸려 있으면 자동 배포가 안 되므로 암호 제거
$ErrorActionPreference = 'Continue'
ssh-keygen -y -P '""' -f $SshKey 2>$null | Out-Null
$encrypted = $LASTEXITCODE -ne 0
$ErrorActionPreference = 'Stop'
if ($encrypted) {
    Step 'SSH 키 암호 제거  (키를 만들 때 정한 기존 암호를 입력하세요)'
    ssh-keygen -p -N '""' -f $SshKey
    Check 'SSH 키 암호 제거'
}

# 2) 공개키를 서버에 등록 → 이후 배포는 비밀번호 없이 동작
Step "서버($Target)에 SSH 키 등록  (Ubuntu 계정 비밀번호를 물으면 입력)"
Get-Content "$SshKey.pub" | ssh -p $Port -i $SshKey -o StrictHostKeyChecking=accept-new $Target 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && tr -d ''\r'' >> ~/.ssh/authorized_keys && sort -u -o ~/.ssh/authorized_keys ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
Check 'SSH 키 등록'

# 3) 설정 파일 업로드
Step '설정 파일 업로드'
scp -P $Port -i $SshKey (Join-Path $PSScriptRoot 'Caddyfile') "${Target}:/tmp/$AppName-Caddyfile"
Check 'Caddyfile 업로드'
scp -P $Port -i $SshKey (Join-Path $PSScriptRoot 'server-setup.sh') "${Target}:/tmp/$AppName-server-setup.sh"
Check 'server-setup.sh 업로드'
$RootDir = Split-Path $PSScriptRoot -Parent
$uploads = [ordered]@{
    'api\db\schema.sql'      = "$AppName-schema.sql"
    'api\db\seed.sql'        = "$AppName-seed.sql"
    'mock-erp\db\schema.sql' = "$AppName-erp-schema.sql"
    'mock-erp\db\seed.sql'   = "$AppName-erp-seed.sql"
}
foreach ($src in $uploads.Keys) {
    scp -P $Port -i $SshKey (Join-Path $RootDir $src) "${Target}:/tmp/$($uploads[$src])"
    Check "$src 업로드"
}
$all = (@("$AppName-server-setup.sh", "$AppName-Caddyfile") + @($uploads.Values) | ForEach-Object { "/tmp/$_" }) -join ' '

# 4) sudo 로 서버 설정 실행
Step 'Caddy · PostgreSQL · .NET · 가상 ERP 설정  (sudo 비밀번호를 물으면 Ubuntu 계정 비밀번호 입력)'
ssh -t -p $Port -i $SshKey $Target "sed -i 's/\r$//' $all && sudo bash /tmp/$AppName-server-setup.sh $User $AppName $Domain"
Check '서버 설정'

Write-Host "`n완료! 이제 deploy.cmd 로 배포하세요. 확인: http://${Server}:8080/ (MES)" -ForegroundColor Green

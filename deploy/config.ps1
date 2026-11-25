# 배포 설정 — 서버 정보가 바뀌면 여기만 고치면 됩니다.
$Server       = '192.168.0.10'        # 리눅스 VM IP
$User         = 'cloudheat'           # Ubuntu 로그인 계정
$Port         = 22                    # SSH 포트
$AppName      = 'cloudheat'           # /var/www/<AppName> 에 배포됨
$Domain       = 'cloudheat.kr'        # Caddy 사이트 주소 (HTTPS 자동 발급 대상)
$KeepReleases = 5                     # 서버에 남겨둘 이전 버전 개수 (롤백용)
$SshKey       = Join-Path $env:USERPROFILE '.ssh\id_ed25519'

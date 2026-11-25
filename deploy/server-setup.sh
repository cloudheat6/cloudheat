#!/usr/bin/env bash
# 서버 설정 (sudo 로 실행됨, 여러 번 실행해도 안전). 사용법: sudo bash server-setup.sh <user> <app> <domain>
#   - Caddy (cloudheat.kr · mes.cloudheat.kr)
#   - PostgreSQL 16 + MES 스키마(mes) + 가상 ERP 스키마(erp)
#   - ASP.NET Core 서비스 2개: MES API(5080) · 가상 ERP(5090)
set -euo pipefail

DEPLOY_USER="$1"
APP="$2"
DOMAIN="$3"
SITE_DIR="/var/www/$APP"
MES_DIR="/var/www/$APP-mes"
API_DIR="/opt/$APP-api"
ERP_DIR="/opt/$APP-erp"
DB_NAME="$APP"
API_ROLE="${APP}_api"
ERP_ROLE="${APP}_erp"
ENV_DIR="/etc/$APP"
API_ENV="$ENV_DIR/api.env"
ERP_ENV="$ENV_DIR/erp.env"
SYSTEMCTL_BIN="$(command -v systemctl)"
cd /tmp   # postgres 계정으로 명령을 돌릴 때 홈 폴더 권한 경고 방지

# ── 패키지 ────────────────────────────────────────────────
if dpkg -s nginx >/dev/null 2>&1 || dpkg -s nginx-common >/dev/null 2>&1; then
  echo "==> 기존 nginx 제거"
  systemctl disable --now nginx 2>/dev/null || true
  DEBIAN_FRONTEND=noninteractive apt-get purge -y nginx nginx-common nginx-core 2>/dev/null || true
  apt-get autoremove -y
fi

if ! command -v caddy >/dev/null; then
  echo "==> Caddy 설치 (공식 저장소)"
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
fi

echo "==> PostgreSQL · ASP.NET Core 런타임"
if ! dpkg -s postgresql >/dev/null 2>&1 || ! dpkg -s aspnetcore-runtime-10.0 >/dev/null 2>&1; then
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql aspnetcore-runtime-10.0 openssl curl
fi
systemctl enable --now postgresql
DOTNET_BIN="$(command -v dotnet)"

# ── 정적 사이트 폴더 ──────────────────────────────────────
for dir in "$SITE_DIR" "$MES_DIR"; do
  mkdir -p "$dir/releases"
  if [ ! -e "$dir/current" ]; then
    mkdir -p "$dir/releases/initial"
    echo "<h1>아직 배포되지 않았습니다</h1>" > "$dir/releases/initial/index.html"
    ln -sfn "$dir/releases/initial" "$dir/current"
  fi
  chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$dir"
  chmod 755 "$dir"
done
chmod 755 /var/www

# ── DB 계정 · 비밀번호 · 연동 키 ──────────────────────────
pg() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -qtA "$@"; }

ensure_role() {   # $1 role
  if [ "$(pg -c "SELECT 1 FROM pg_roles WHERE rolname = '$1'")" != "1" ]; then
    pg -c "CREATE ROLE $1 LOGIN"
  fi
}
new_password() {   # $1 role → 새 비밀번호를 설정하고 출력
  local pw; pw="$(openssl rand -hex 24)"
  echo "ALTER ROLE $1 PASSWORD '$pw';" | runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q
  echo "$pw"
}
env_get() { grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- || true; }   # $1 파일 $2 키

echo "==> DB 계정/데이터베이스: $API_ROLE · $ERP_ROLE / $DB_NAME"
ensure_role "$API_ROLE"
ensure_role "$ERP_ROLE"
if [ "$(pg -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" != "1" ]; then
  runuser -u postgres -- createdb -O "$API_ROLE" "$DB_NAME"
fi
pg -c "GRANT CONNECT, CREATE ON DATABASE $DB_NAME TO $ERP_ROLE"

install -d -m 750 -o root -g "$DEPLOY_USER" "$ENV_DIR"

# MES ↔ ERP 연동 API 키 (한 번 만들면 유지)
ERP_KEY="$(env_get "$ERP_ENV" Erp__ApiKey)"
[ -z "$ERP_KEY" ] && ERP_KEY="$(env_get "$API_ENV" Erp__ApiKey)"
[ -z "$ERP_KEY" ] && ERP_KEY="$(openssl rand -hex 24)"

write_env() {   # $1 파일, 나머지: 줄
  local f="$1"; shift
  ( umask 027; printf '%s\n' "$@" > "$f" )
  chown root:"$DEPLOY_USER" "$f"
  chmod 640 "$f"
}

# MES API 설정: DB 비밀번호는 기존 값 유지, 없으면 새로 생성
API_CS="$(env_get "$API_ENV" ConnectionStrings__Default)"
if [ -z "$API_CS" ]; then
  API_CS="Host=127.0.0.1;Database=$DB_NAME;Username=$API_ROLE;Password=$(new_password "$API_ROLE")"
fi
write_env "$API_ENV" \
  "ConnectionStrings__Default=$API_CS" \
  "ASPNETCORE_URLS=http://127.0.0.1:5080" \
  "ASPNETCORE_ENVIRONMENT=Production" \
  "Erp__BaseUrl=http://127.0.0.1:5090" \
  "Erp__ApiKey=$ERP_KEY"

ERP_CS="$(env_get "$ERP_ENV" ConnectionStrings__Default)"
if [ -z "$ERP_CS" ]; then
  ERP_CS="Host=127.0.0.1;Database=$DB_NAME;Username=$ERP_ROLE;Password=$(new_password "$ERP_ROLE")"
fi
write_env "$ERP_ENV" \
  "ConnectionStrings__Default=$ERP_CS" \
  "ASPNETCORE_URLS=http://127.0.0.1:5090" \
  "ASPNETCORE_ENVIRONMENT=Production" \
  "Erp__ApiKey=$ERP_KEY" \
  "Erp__FailureRate=0.15" \
  "Erp__SlowRate=0.05"
unset API_CS ERP_CS ERP_KEY

# ── 스키마 · 초기 데이터 ─────────────────────────────────
echo "==> 스키마 적용 · 초기 데이터"
for dir in "$API_DIR" "$ERP_DIR"; do
  install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$dir" "$dir/releases"
  install -d -m 755 "$dir/db"
done
install -m 644 "/tmp/$APP-schema.sql"     "$API_DIR/db/schema.sql"
install -m 644 "/tmp/$APP-seed.sql"       "$API_DIR/db/seed.sql"
install -m 644 "/tmp/$APP-erp-schema.sql" "$ERP_DIR/db/schema.sql"
install -m 644 "/tmp/$APP-erp-seed.sql"   "$ERP_DIR/db/seed.sql"

pg -d "$DB_NAME" -c "SET ROLE $API_ROLE" -f "$API_DIR/db/schema.sql"
pg -d "$DB_NAME" -c "SET ROLE $ERP_ROLE" -f "$ERP_DIR/db/schema.sql"
# 처음 설치할 때(품목 마스터가 비어 있을 때)만 초기 데이터. 이후 입력한 데이터는 건드리지 않음
if [ "$(pg -d "$DB_NAME" -c "SELECT count(*) FROM mes.item")" = "0" ]; then
  pg -d "$DB_NAME" -c "SET ROLE $API_ROLE" -f "$API_DIR/db/seed.sql"
fi
if [ "$(pg -d "$DB_NAME" -c "SELECT count(*) FROM erp.item")" = "0" ]; then
  pg -d "$DB_NAME" -c "SET ROLE $ERP_ROLE" -f "$ERP_DIR/db/seed.sql"
fi

# ── systemd 서비스 ────────────────────────────────────────
write_unit() {   # $1 이름 $2 폴더 $3 dll $4 env $5 설명
  cat > "/etc/systemd/system/$1.service" <<EOF
[Unit]
Description=$5
After=network.target postgresql.service

[Service]
User=$DEPLOY_USER
WorkingDirectory=$2/current
ExecStart=$DOTNET_BIN $2/current/$3
EnvironmentFile=$4
Restart=always
RestartSec=5
KillSignal=SIGINT
SyslogIdentifier=$1
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
}
echo "==> 서비스 등록: $APP-api · $APP-erp"
write_unit "$APP-api" "$API_DIR" "Cloudheat.Api.dll"     "$API_ENV" "$APP MES API (ASP.NET Core)"
write_unit "$APP-erp" "$ERP_DIR" "Cloudheat.MockErp.dll" "$ERP_ENV" "$APP Mock ERP (ASP.NET Core)"

echo "==> 데이터 초기화 서비스 (수동 실행 전용: deploy.cmd -ResetData)"
cat > "/etc/systemd/system/$APP-seed.service" <<EOF
[Unit]
Description=$APP demo data reset (MES + Mock ERP)
After=postgresql.service

[Service]
Type=oneshot
User=postgres
WorkingDirectory=/tmp
ExecStart=/usr/bin/psql -d $DB_NAME -v ON_ERROR_STOP=1 -q -c "SET ROLE $ERP_ROLE" -f $ERP_DIR/db/seed.sql
ExecStart=/usr/bin/psql -d $DB_NAME -v ON_ERROR_STOP=1 -q -c "SET ROLE $API_ROLE" -f $API_DIR/db/seed.sql
EOF
# 예전에 만든 매일 04:00 자동 초기화 타이머는 제거
if [ -f "/etc/systemd/system/$APP-seed.timer" ]; then
  systemctl disable --now "$APP-seed.timer" 2>/dev/null || true
  rm -f "/etc/systemd/system/$APP-seed.timer"
fi

systemctl daemon-reload
systemctl enable "$APP-api" "$APP-erp"
for svc in "$APP-erp:$ERP_DIR" "$APP-api:$API_DIR"; do
  name="${svc%%:*}"; dir="${svc#*:}"
  if [ -e "$dir/current" ]; then systemctl restart "$name"; fi
done

# 배포 계정은 비밀번호 없이 서비스 재시작 · 데이터 초기화만 가능
SUDOERS="/etc/sudoers.d/$APP-api"
cat > "$SUDOERS" <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: $SYSTEMCTL_BIN restart $APP-api, $SYSTEMCTL_BIN restart $APP-erp, $SYSTEMCTL_BIN start $APP-seed.service
EOF
chmod 440 "$SUDOERS"
visudo -cf "$SUDOERS" >/dev/null || { rm -f "$SUDOERS"; echo "sudoers 설정 실패"; exit 1; }

# ── Caddy ─────────────────────────────────────────────────
echo "==> Caddy 설정"
sed -e "s/__APP__/$APP/g" -e "s/__DOMAIN__/$DOMAIN/g" "/tmp/$APP-Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  echo "==> 방화벽(ufw)"
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow from 192.168.0.0/16 to any port 8080 proto tcp
fi

rm -f /tmp/$APP-Caddyfile /tmp/$APP-server-setup.sh /tmp/$APP-schema.sql /tmp/$APP-seed.sql /tmp/$APP-erp-schema.sql /tmp/$APP-erp-seed.sql
echo "==> 서버 설정 완료"

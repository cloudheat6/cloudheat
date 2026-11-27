#!/usr/bin/env bash
# 서버에서 실행되는 배포 도우미 (deploy.ps1 이 stdin 으로 넘겨서 실행)
#   remote.sh <app> <keep> apply <release> <component=tar.gz> ...   (component: erp api mes erpweb site)
#   remote.sh <app> <keep> rollback <component> ...
#   remote.sh <app> <keep> list | reset
set -euo pipefail

APP="$1"; KEEP="$2"; CMD="$3"; shift 3

dir_of() {
  case "$1" in
    site) echo "/var/www/$APP" ;;
    mes)  echo "/var/www/$APP-mes" ;;
    erpweb) echo "/var/www/$APP-erp-web" ;;
    api)  echo "/opt/$APP-api" ;;
    erp)  echo "/opt/$APP-erp" ;;
    *) echo "알 수 없는 컴포넌트: $1" >&2; exit 2 ;;
  esac
}
health_of() {
  case "$1" in
    api) echo "http://127.0.0.1:5080/api/health" ;;
    erp) echo "http://127.0.0.1:5090/erp/health" ;;
    *) echo "" ;;
  esac
}

switch_to() { ln -sfn "$2" "$1/current.tmp" && mv -Tf "$1/current.tmp" "$1/current"; }
current_of() { if [ -e "$1/current" ]; then basename "$(readlink -f "$1/current")"; else echo "-"; fi; }
releases_of() { ls -1 "$1/releases" 2>/dev/null | grep -vx initial | sort -r || true; }
previous_of() { local cur; cur="$(current_of "$1")"; releases_of "$1" | awk -v c="$cur" '$0 < c' | head -n 1; }
prune() { (cd "$1/releases" && releases_of "$1" | tail -n +$((KEEP + 1)) | xargs -r rm -rf); }

# 서비스 재시작 후 헬스체크 (정적 사이트는 바로 성공)
restart_ok() {
  local url; url="$(health_of "$1")"
  [ -z "$url" ] && return 0
  sudo -n systemctl restart "$APP-$1"
  for _ in $(seq 1 30); do
    curl -fsS "$url" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

case "$CMD" in
  apply)
    REL="$1"; shift
    # 의존 순서: 가상 ERP → MES API → MES 화면 → ERP 화면 → 포트폴리오
    for comp in erp api mes erpweb site; do
      for arg in "$@"; do
        [ "${arg%%=*}" = "$comp" ] || continue
        tarball="${arg#*=}"
        dir="$(dir_of "$comp")"
        prev="$(current_of "$dir")"
        R="$dir/releases/$REL"
        mkdir -p "$R"
        tar -xzmf "$tarball" -C "$R"
        rm -f "$tarball"
        switch_to "$dir" "$R"
        if restart_ok "$comp"; then
          url="$(health_of "$comp")"
          echo "$comp: current -> $REL ${url:+ $(curl -fsS "$url")}"
          prune "$dir"
        else
          echo "!! $comp 헬스체크 실패. 최근 로그:"
          journalctl -u "$APP-$comp" -n 30 --no-pager 2>/dev/null || echo "(sudo journalctl -u $APP-$comp)"
          if [ "$prev" != "-" ] && [ -d "$dir/releases/$prev" ]; then
            switch_to "$dir" "$dir/releases/$prev"
            restart_ok "$comp" || true
            echo "!! $comp 를 이전 버전($prev)으로 되돌렸어요"
          fi
          exit 1
        fi
      done
    done
    ;;

  rollback)
    for comp in "$@"; do
      dir="$(dir_of "$comp")"
      prev="$(previous_of "$dir")"
      if [ -z "$prev" ]; then echo "$comp: 되돌릴 이전 버전 없음"; continue; fi
      cur="$(current_of "$dir")"
      switch_to "$dir" "$dir/releases/$prev"
      if restart_ok "$comp"; then echo "$comp: $cur -> $prev"; else echo "!! $comp 헬스체크 실패"; exit 1; fi
    done
    ;;

  list)
    for comp in site mes erpweb api erp; do
      dir="$(dir_of "$comp")"
      echo "[$comp] $dir"
      cur="$(current_of "$dir")"
      for r in $(releases_of "$dir"); do
        if [ "$r" = "$cur" ]; then echo "* $r  (current)"; else echo "  $r"; fi
      done
    done
    ;;

  reset)
    sudo -n systemctl start "$APP-seed.service"
    echo "MES · 가상 ERP 데모 데이터를 초기 상태로 되돌렸어요"
    ;;

  *)
    echo "알 수 없는 명령: $CMD"; exit 2 ;;
esac

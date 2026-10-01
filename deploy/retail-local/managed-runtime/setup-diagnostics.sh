#!/usr/bin/env bash
# Sourced by setup entrypoints; never exports transcripts or command arguments.

bms_diagnostics_init() {
  BMS_DIAG_PRODUCT=$1
  BMS_DIAG_STATE=$2
  BMS_DIAG_STAGE=startup
  BMS_DIAG_REASON='Setup command failed; see stage, exit code and source line.'
  BMS_DIAG_LINE=0
  BMS_DIAG_VERSION=unknown
  if [[ -r $3 ]]; then
    IFS= read -r BMS_DIAG_VERSION <"$3" || true
  fi
  trap 'BMS_DIAG_LINE=$LINENO' ERR
}

bms_diagnostic_text() {
  local value=${1:0:4096} identity
  for identity in "${HOME:-}" "${USER:-}" "${SUDO_USER:-}" \
    "${SHOP_NAME:-}" "${ADMIN_NAME:-}" "${ADMIN_PASSWORD:-}" "${ADMIN_PIN:-}" \
    "${shop_name:-}" "${admin_name:-}" "${admin_password:-}" "${admin_pin:-}"; do
    [[ -z $identity ]] || value=${value//"$identity"/[identity removed]}
  done
  # Omit the whole message if it might contain a credential, including multiline values.
  printf '%s\n' "$value" | LC_ALL=C awk '
    { lower=tolower($0)
      if (lower ~ /password|passwd|pwd|pin|token|secret|authorization|cookie|credential|private.?key|api.?key|:\/\/|@|\/home\/|\/Users\/|-----begin/) sensitive=1
      for (i=1;i<=NF;i++) if (length($i)>=64) sensitive=1
      text=text (NR>1 ? " " : "") $0
    }
    END { if (sensitive) print "[sensitive message omitted]"; else print substr(text,1,2048) }
  '
}

bms_diagnostic_probe() {
  local key=$1 file=$2 pid attempt status=0
  shift 2
  "$@" >"$file" 2>/dev/null &
  pid=$!
  for ((attempt=0; attempt<20; attempt++)); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    printf '%s=unavailable (timed out)\n' "$key"
  else
    wait "$pid" || status=$?
    if ((status == 0)); then
      if [[ $key == disk ]]; then
        awk '$2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ && $4 ~ /^[0-9]+$/ {print "diskTotalKiB=" $2 "\ndiskUsedKiB=" $3 "\ndiskFreeKiB=" $4}' "$file"
      else
        printf '%s=%s\n' "$key" "$(bms_diagnostic_text "$(head -c 4096 "$file")")"
      fi
    else
      printf '%s=unavailable (exit %s)\n' "$key" "$status"
    fi
  fi
}

bms_diagnostics_write() (
  trap - EXIT ERR HUP INT TERM
  umask 077
  local status=$1 system folder work archive owner
  system=$(uname -s) || return 1
  if [[ $system == Darwin ]]; then
    mkdir -p "$BMS_DIAG_STATE/diagnostics" || return 1
    folder=$(mktemp -d "$BMS_DIAG_STATE/diagnostics/report.XXXXXXXX") || return 1
  else
    # A separate private directory lets the sudo operator read the report without
    # granting access to the root-owned shop or trusting a user-controlled output path.
    folder=$(mktemp -d /var/tmp/bms-install-report.XXXXXXXX) || return 1
  fi
  work="$folder/content"
  mkdir "$work" || return 1
  trap 'rm -rf -- "$work"; rm -f -- "$folder/report.tar.gz.part" "$folder/probe"' EXIT
  {
    printf 'formatVersion=1\nproduct=%s\ninstallerVersion=%s\n' \
      "$(bms_diagnostic_text "$BMS_DIAG_PRODUCT")" "$(bms_diagnostic_text "$BMS_DIAG_VERSION")"
    printf 'createdAt=%s\nstage=%s\nexitCode=%s\nsourceLine=%s\nerror=%s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$(bms_diagnostic_text "$BMS_DIAG_STAGE")" \
      "$status" "$BMS_DIAG_LINE" "$(bms_diagnostic_text "$BMS_DIAG_REASON")"
    bms_diagnostic_probe kernel "$folder/probe" uname -sr
    bms_diagnostic_probe architecture "$folder/probe" uname -m
    if [[ $system == Darwin ]]; then
      bms_diagnostic_probe osVersion "$folder/probe" /usr/bin/sw_vers -productVersion
      bms_diagnostic_probe osBuild "$folder/probe" /usr/bin/sw_vers -buildVersion
      bms_diagnostic_probe ramBytes "$folder/probe" /usr/sbin/sysctl -n hw.memsize
      bms_diagnostic_probe logicalProcessors "$folder/probe" /usr/sbin/sysctl -n hw.logicalcpu
      bms_diagnostic_probe virtualizationSupported "$folder/probe" /usr/sbin/sysctl -n kern.hv_support
      if [[ -n ${LIMACTL:-} && -x ${LIMACTL:-} && -n ${INSTANCE:-} ]]; then
        bms_diagnostic_probe privateRuntimeState "$folder/probe" "$LIMACTL" list "$INSTANCE" --format '{{.Status}}'
      else
        printf 'privateRuntimeState=unavailable\n'
      fi
    else
      # Parse selected OS fields as data; never source /etc/os-release as shell code.
      awk -F= '$1=="ID" || $1=="VERSION_ID" {print "os." $1 "=" $2}' /etc/os-release 2>/dev/null
      awk '$1=="MemTotal:" {print "ramKiB=" $2}' /proc/meminfo 2>/dev/null
      awk '/^(flags|Features)/ {print "virtualizationCpuFlag=" ($0 ~ / (vmx|svm)( |$)/ ? "present" : "not-reported"); exit}' /proc/cpuinfo 2>/dev/null
      bms_diagnostic_probe logicalProcessors "$folder/probe" getconf _NPROCESSORS_ONLN
      if command -v systemctl >/dev/null 2>&1; then
        bms_diagnostic_probe dockerService "$folder/probe" systemctl show docker.service --property=ActiveState --value
        bms_diagnostic_probe shopService "$folder/probe" systemctl show bms-retail-local.service --property=ActiveState --value
      fi
    fi
    if [[ -d $BMS_DIAG_STATE ]]; then
      bms_diagnostic_probe disk "$folder/probe" df -Pk "$BMS_DIAG_STATE"
    else
      bms_diagnostic_probe disk "$folder/probe" df -Pk /
    fi
  } >"$work/diagnostics.txt"
  rm -f -- "$folder/probe"
  printf '%s\n' \
    'Review diagnostics.txt before sending this archive to BMS support.' \
    'Only selected system fields, setup stage, exit code and a redacted setup reason are included.' \
    'No transcripts, command lines, environment, database, shop files or credentials are included.' \
    'Unavailable fields are unknown, not a successful check. No automatic upload occurs.' \
    'Submit this archive after review: https://bms.jachoei.com/installer-report' \
    'Submission requires consent. Keep the file and retry when the network is available.' \
    >"$work/README.txt"
  archive="$folder/report.tar.gz"
  tar -czf "$archive.part" -C "$work" diagnostics.txt README.txt || return 1
  mv "$archive.part" "$archive" || return 1
  # Finish root-owned cleanup before handing the directory to the operator.
  rm -rf -- "$work" || return 1
  rm -f -- "$folder/probe" || return 1
  trap - EXIT
  if [[ $system != Darwin && $EUID -eq 0 && -n ${SUDO_USER:-} && $SUDO_USER != root ]]; then
    owner=$(id -u "$SUDO_USER") || return 1
    chown "$owner" "$archive" || return 1
    chown "$owner" "$folder" || return 1
  fi
  printf 'Support report (review before sending): %s\n' "$archive" >&2
  printf 'Send report with consent: https://bms.jachoei.com/installer-report\n' >&2
)

bms_diagnostics_finish() {
  local status=$1
  if ((status != 0 && BASH_SUBSHELL == 0)); then
    printf '\nPreparing installation error report...\n' >&2
    bms_diagnostics_write "$status" || printf 'Could not save the support report. The original setup error is unchanged.\n' >&2
  fi
  return 0
}

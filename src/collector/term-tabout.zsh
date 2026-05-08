# src/collector/term-tabout.zsh
# Records terminal session states for the term-tabout CLI.

_term_tabout_record() {
  # 仅交互式 shell 才记录
  [[ $- != *i* ]] && return

  local state_dir="$HOME/.term-tabout/states"
  mkdir -p "$state_dir" 2>/dev/null || return

  local pid=$$
  local ppid=$PPID
  local cwd=$(pwd)
  local cmd=${1:-"idle"}
  local term=${TERM_PROGRAM:-"unknown"}
  local now_ms=$(($(date +%s) * 1000))
  local state_file="$state_dir/$pid.json"

  # startedAt 只在首次记录时写入，后续保持不变（让 UI 算"running"时长）
  local started_ms=""
  if [[ -f "$state_file" ]]; then
    started_ms=$(grep -o '"startedAt"[[:space:]]*:[[:space:]]*[0-9]*' "$state_file" 2>/dev/null \
                  | grep -o '[0-9]*$')
  fi
  : "${started_ms:=$now_ms}"

  # JSON-escape 双引号与反斜杠
  local safe_cwd="${cwd//\\/\\\\}"; safe_cwd="${safe_cwd//\"/\\\"}"
  local safe_term="${term//\\/\\\\}"; safe_term="${safe_term//\"/\\\"}"
  local safe_cmd="${cmd//\\/\\\\}"; safe_cmd="${safe_cmd//\"/\\\"}"
  # 限制命令长度，避免巨型文件
  safe_cmd="${safe_cmd:0:100}"

  # 原子写：tmp + mv，防止 UI 读到半截 JSON
  local tmp="$state_file.tmp.$$"
  cat > "$tmp" <<EOF
{
  "pid": $pid,
  "ppid": $ppid,
  "cwd": "$safe_cwd",
  "term": "$safe_term",
  "lastCmd": "$safe_cmd",
  "startedAt": $started_ms,
  "updatedAt": $now_ms
}
EOF
  mv -f "$tmp" "$state_file" 2>/dev/null
}

_term_tabout_cleanup() {
  rm -f "$HOME/.term-tabout/states/$$.json" 2>/dev/null
}

if [[ -n "$ZSH_VERSION" ]]; then
  autoload -Uz add-zsh-hook
  add-zsh-hook chpwd _term_tabout_record

  # preexec 把命令字符串作为 $1 传过来
  _term_tabout_preexec() {
    _term_tabout_record "$1"
  }
  preexec_functions+=(_term_tabout_preexec)

  # 退出时尽力清理（zshexit 在 kill -9 / 崩溃时不触发；
  # UI 端 SessionManager.purgeStale() 才是权威清理路径）
  add-zsh-hook zshexit _term_tabout_cleanup

  # source 时立刻记录一次，让仪表盘里能立刻看到这个会话
  _term_tabout_record "idle"
fi

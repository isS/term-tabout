#!/usr/bin/env fish
# term-tabout fish collector
#
# 安装：在 ~/.config/fish/config.fish 末尾追加
#   source /path/to/term-tabout/src/collector/term-tabout.fish
#
# 钩子：
#   $PWD 变化（fish_pwd 等价于 zsh chpwd）
#   fish_preexec  - 命令执行前
#   fish_exit     - shell 退出时清理
#
# state 文件：~/.term-tabout/states/{PID}.json

set -g __TT_DIR (test -n "$TERM_TABOUT_DIR"; and echo $TERM_TABOUT_DIR; or echo "$HOME/.term-tabout")
set -g __TT_STATES "$__TT_DIR/states"

function __tt_json_escape
    string replace -a '\\' '\\\\' -- "$argv[1]" | string replace -a '"' '\\"'
end

function __tt_record
    # 必须有控制终端：跳过 GUI 应用探测环境时跑的无 tty `fish -c` shell，
    # 否则它们会堆积成 cwd=/、term=unknown 的"幽灵"会话（详见 zsh collector 注释）。
    isatty stdout; or return
    mkdir -p $__TT_STATES 2>/dev/null
    set -l pid $fish_pid
    set -l state_file "$__TT_STATES/$pid.json"
    set -l now_ms (math (date +%s) "*" 1000)
    set -l started_ms ""

    if test -f $state_file
        set started_ms (grep -o '"startedAt"[[:space:]]*:[[:space:]]*[0-9]*' $state_file 2>/dev/null \
                          | grep -o '[0-9]*$')
    end
    test -z "$started_ms"; and set started_ms $now_ms

    set -l cwd_esc (__tt_json_escape "$PWD")
    set -l term_raw "$TERM_PROGRAM"
    test -z "$term_raw"; and set term_raw unknown
    set -l term_esc (__tt_json_escape "$term_raw")
    set -l cmd_raw "$argv"
    test -z "$cmd_raw"; and set cmd_raw idle
    set -l cmd_esc (__tt_json_escape "$cmd_raw")

    set -l tmp "$state_file.tmp.$pid"
    printf '{
  "pid": %d,
  "cwd": "%s",
  "term": "%s",
  "lastCmd": "%s",
  "startedAt": %d,
  "updatedAt": %d
}\n' $pid $cwd_esc $term_esc $cmd_esc $started_ms $now_ms > $tmp
    mv -f $tmp $state_file 2>/dev/null
end

function __tt_cleanup --on-event fish_exit
    rm -f "$__TT_STATES/$fish_pid.json" 2>/dev/null
end

# chpwd 等价：监听 PWD 变化
function __tt_chpwd --on-variable PWD
    __tt_record
end

# preexec 等价：fish_preexec event 携带命令字符串
function __tt_preexec --on-event fish_preexec
    __tt_record $argv
end

# 启动时立即记录
__tt_record

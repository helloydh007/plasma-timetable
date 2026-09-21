#!/usr/bin/env bash
#
# 安装「课程表」到用户级 plasmoid 目录（无需 root）。
#
# 用法：  ./install.sh
# 卸载：  kpackagetool6 --type Plasma/Applet --remove io.github.helloydh007.timetable
# 自测：  node tests/test-importers.js
# ---------------------------------------------------------------------------

set -euo pipefail

ID="io.github.helloydh007.timetable"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v kpackagetool6 >/dev/null || {
    echo "错误：找不到 kpackagetool6，请先安装 plasma-workspace。" >&2
    exit 1
}

if kpackagetool6 --type Plasma/Applet --list 2>/dev/null | grep -qw "$ID"; then
    echo "检测到已安装，执行升级……"
    kpackagetool6 --type Plasma/Applet --upgrade "$SRC"
    echo "✓ 已升级"
else
    kpackagetool6 --type Plasma/Applet --install "$SRC"
    echo "✓ 已安装"
fi

# 刷新组件索引，让「添加小组件」面板立即能看到它
kbuildsycoca6 --noincremental >/dev/null 2>&1 || true

cat <<'EOF'

接下来：
  桌面右键 → 「添加小组件」→ 搜索「课程表」→ 拖到桌面
  然后右键组件 → 「配置课程表」：
    · 手动录入：直接加课、填星期/节次/周次
    · 导入 ICS：把教务系统导出的 .ics 用文本编辑器打开，全选复制，粘贴进去
    · 导入 WakeUp：把 .wakeup_schedule 备份文件同样打开复制，粘贴进去
    再在「学期与节假日」页填好开学日（导入时会自动填）并点「应用」

说明：本组件只能从剪贴板粘贴导入 —— QML 读不了本地文件
（XMLHttpRequest 的 file:// 被安全策略拦截），所以没做文件选择框。
.ics 与 .wakeup_schedule 都是纯文本，用文本编辑器打开即可复制。

若在「添加小组件」里看不到它，请关闭再重新打开该面板（列表不实时刷新），
或重启 plasmashell：  systemctl --user restart plasma-plasmashell.service
EOF

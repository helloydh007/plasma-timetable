/*
 * 日程时间轴行（卡片布局选「日程时间轴」时用；版式来自画布稿 Direction B）
 *
 * 左边一列固定宽度、右对齐的「日期 / 时间」，中间一条竖向导轨 + 一个课程色圆点，
 * 右边是课名（有空间时下面补一行地点·教师）。
 *
 * 描边不在这一行上，而在整个列表外面（CardList 画的那块面板）—— 这是设计稿的
 * 意思：整条日程是一张卡，不是每行一张。
 *
 * 导轨要看着像一条连续的线，所以竖线是「行高 + 行距 + 圆点半径」那么长：
 * 从本行圆点的中心一直画到下一行圆点的中心，两段正好在圆点处接上。
 * 最后一行只画到自己圆点为止，导轨在那里收尾。
 */

import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

import "coursemodel.js" as CM

Item {
    id: row

    property var entry: null
    property bool current: false
    property string dayText: ""
    property string badge: ""
    property bool showMeta: false
    // 最后一行：竖线只画到圆点，不往行底外延伸
    property bool isLast: false
    // 列表的行距 —— 竖线要靠它跨过间隙接上下一行
    property real rowGap: Kirigami.Units.smallSpacing
    // 版面装饰的不透明度（0..1）。导轨和面板（在 CardList 里）跟着淡；
    // 圆点是「哪门课」的标记，和卡片布局左侧那条色条一样，始终不淡。
    property real cardOpacity: 1.0

    readonly property color fg: row.current
        ? Kirigami.Theme.highlightedTextColor : Kirigami.Theme.textColor
    readonly property int pad: Kirigami.Units.smallSpacing
    readonly property string meta: CM.metaText(row.entry)
    readonly property real alpha: Math.max(0, Math.min(1, row.cardOpacity))

    readonly property real dotSize: Math.max(6, Math.round(Kirigami.Units.gridUnit * 0.45))
    readonly property real dotTop: row.pad
    // 圆点中心离行顶的距离 —— 也是「上一行的竖线该画到哪」
    readonly property real dotMiddle: row.dotTop + row.dotSize / 2
    readonly property color railColor:
        Qt.rgba(row.fg.r, row.fg.g, row.fg.b, 0.12 * row.alpha)

    // 行之间留多少空由列表的 spacing 给，行内不再自己加一份 ——
    // 两边都加的话间距会翻倍，还会凭空多出一条滚动条
    implicitHeight: body.implicitHeight + row.pad * 2

    RowLayout {
        id: body
        // 填满整行（不是只包住内容）：导轨那一列要拿到行高，竖线才能跨到下一行
        anchors.fill: parent
        spacing: row.pad * 1.5

        // ── 日期 / 时间列（贴内容宽度、右对齐）──
        // 宽度按内容算而不是写死 56：设计稿那边是 8px 的字，这里是 8pt（约 10.7px），
        // 写死就会把「14:00–17:40」省略成「14:00–17…」（踩过）。
        ColumnLayout {
            Layout.preferredWidth: implicitWidth
            Layout.minimumWidth: implicitWidth
            Layout.alignment: Qt.AlignTop
            spacing: 0

            PlasmaComponents.Label {
                Layout.fillWidth: true
                visible: row.dayText !== ""
                text: row.dayText
                color: row.fg
                horizontalAlignment: Text.AlignRight
                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
                elide: Text.ElideRight
            }
            PlasmaComponents.Label {
                Layout.fillWidth: true
                text: row.entry ? row.entry.time : ""
                color: row.fg
                opacity: 0.85
                horizontalAlignment: Text.AlignRight
                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
                elide: Text.ElideRight
            }
        }

        // ── 导轨：圆点 + 竖线 ──
        Item {
            Layout.preferredWidth: row.dotSize + 4
            Layout.fillHeight: true

            Rectangle {
                id: railLine
                width: 2
                radius: 1
                anchors.horizontalCenter: parent.horizontalCenter
                // 从本行圆点中心画到「下一行的圆点中心」：跨过行底和行距，
                // 两段在那里接上。最后一行只画到自己的圆点，导轨收尾。
                y: row.isLast ? 0 : row.dotMiddle
                height: row.isLast ? row.dotMiddle : row.height + row.rowGap
                color: row.railColor
            }
            Rectangle {
                width: row.dotSize
                height: row.dotSize
                radius: row.dotSize / 2
                anchors.horizontalCenter: parent.horizontalCenter
                y: row.dotTop
                color: row.entry && row.entry.color ? row.entry.color
                                                    : Kirigami.Theme.highlightColor
            }
        }

        // ── 课名（+ 可选的地点·教师 + 「上课中」）──
        ColumnLayout {
            Layout.fillWidth: true
            Layout.minimumWidth: 0
            Layout.alignment: Qt.AlignTop
            spacing: 0

            PlasmaComponents.Label {
                Layout.fillWidth: true
                text: row.entry ? row.entry.name : ""
                color: row.fg
                font.bold: true
                font.pointSize: Kirigami.Theme.defaultFont.pointSize + 1
                elide: Text.ElideRight
            }
            PlasmaComponents.Label {
                Layout.fillWidth: true
                visible: row.showMeta && text !== ""
                text: row.meta
                color: row.fg
                opacity: 0.7
                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
                elide: Text.ElideRight
            }
            // 「上课中」在时间轴里没有右边可挂，就跟在课名下面
            PlasmaComponents.Label {
                Layout.fillWidth: true
                visible: row.badge !== ""
                text: row.badge
                color: row.fg
                opacity: 0.85
                font.bold: true
                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
            }
        }
    }
}

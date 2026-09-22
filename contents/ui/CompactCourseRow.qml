/*
 * 紧凑行式卡片（「卡片布局」选「紧凑行式」时用；版式来自画布稿 Direction A）
 *
 * 一堂课只占一行：左侧色条 | 课名 …… 日期 时间。设计目标是 240x160 的小组件里
 * 三节课全都能看见 —— 原来的两行卡片在这个尺寸下只能露出两节，第三节要滚动。
 *
 * 地点/教师默认不显示（就是省掉它才换来这一行的高度）；只有当容器给出的高度
 * 够两行时（CardList 传进来的 showMeta）才补在课名下面。
 *
 * 和 CourseCard 一样的两条硬约束：中间那列 Layout.minimumWidth 必须显式写 0，
 * 右侧那组用 Layout.maximumWidth: implicitWidth 钉住，否则长课名会把行撑出容器。
 */

import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

import "coursemodel.js" as CM

Rectangle {
    id: row

    property var entry: null
    property bool current: false
    property string dayText: ""
    property string badge: ""
    // 高度够不够放下第二行（地点 · 教师）——由容器按可用高度决定，不是这里自己量
    property bool showMeta: false
    // 卡面底色不透明度（0..1）。0 = 只剩文字和色条（文字不跟着淡，不然读不清）。
    property real cardOpacity: 1.0

    readonly property color fg: row.current
        ? Kirigami.Theme.highlightedTextColor : Kirigami.Theme.textColor
    readonly property int pad: Kirigami.Units.smallSpacing
    readonly property string meta: CM.metaText(row.entry)
    readonly property real alpha: Math.max(0, Math.min(1, row.cardOpacity))
    readonly property color surface: row.current
        ? Kirigami.Theme.highlightColor : Kirigami.Theme.alternateBackgroundColor

    radius: 8
    color: Qt.rgba(row.surface.r, row.surface.g, row.surface.b, row.alpha)
    border.width: 1
    border.color: Qt.rgba(row.fg.r, row.fg.g, row.fg.b, 0.15 * row.alpha)

    implicitHeight: line.implicitHeight + row.pad * 2

    RowLayout {
        id: line
        anchors.fill: parent
        anchors.leftMargin: row.pad * 1.5
        anchors.rightMargin: row.pad * 1.5
        anchors.topMargin: row.pad
        anchors.bottomMargin: row.pad
        spacing: row.pad * 1.5

        // 左侧色条：圆头小竖条，跟着行高伸缩
        Rectangle {
            Layout.fillHeight: true
            Layout.preferredWidth: Math.max(3, Math.round(Kirigami.Units.smallSpacing * 0.75))
            Layout.minimumHeight: Kirigami.Units.gridUnit * 0.8
            radius: width / 2
            color: row.entry && row.entry.color ? row.entry.color
                                                : Kirigami.Theme.highlightColor
        }

        // 中间：课名（有空间时加一行地点·教师）
        ColumnLayout {
            Layout.fillWidth: true
            Layout.minimumWidth: 0
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
        }

        // 右侧：日期 时间（同行）
        PlasmaComponents.Label {
            Layout.maximumWidth: implicitWidth
            visible: row.badge !== ""
            text: row.badge
            color: row.fg
            font.bold: true
            font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
        }
        PlasmaComponents.Label {
            Layout.maximumWidth: implicitWidth
            visible: row.dayText !== ""
            text: row.dayText
            color: row.fg
            font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
        }
        PlasmaComponents.Label {
            Layout.maximumWidth: implicitWidth
            text: row.entry ? row.entry.time : ""
            color: row.fg
            opacity: 0.85
            font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
        }
    }
}

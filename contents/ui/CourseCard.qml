/*
 * 一门课的卡片。供「今日课程」「接下来」这类列表样式复用。
 *
 * 版式：左侧课程色条 + 课名 / 地点·教师 + 右侧日期·时间。
 * 日期只在跨天的列表里出现（「明天」「下周三 9/30」），当天那几节留空。
 *
 * 两条约束要守住：
 *   1. 中间那列的 Layout.minimumWidth 必须显式写 0。默认的最小宽度会取内容宽度，
 *      课名一长整行就被撑到卡片外面，右边的时间直接跑出框。
 *   2. 右边一列的 Layout.maximumWidth 钉在 implicitWidth 上，只占它该占的宽度。
 */

import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

Rectangle {
    id: card

    // { name, room, teacher, color, time, start, end, ... }
    property var entry: null
    property bool current: false
    // 右上角的日期：「明天」「下周三 9/30」，当天的课为空
    property string dayText: ""
    // 卡片上的小标记（「上课中」），空串不占位置
    property string badge: ""

    readonly property color fg: card.current
        ? Kirigami.Theme.highlightedTextColor : Kirigami.Theme.textColor
    readonly property int pad: Kirigami.Units.smallSpacing

    // 圆角 + 实色卡面 + 细描边，三样凑齐才像一张卡片；
    // 只铺一层淡色的话看上去就是一条横带。
    radius: 8
    color: card.current
        ? Kirigami.Theme.highlightColor
        : Kirigami.Theme.alternateBackgroundColor
    border.width: 1
    border.color: Qt.rgba(card.fg.r, card.fg.g, card.fg.b, 0.15)

    // 高度跟着内容走：列表按这个算，空间富余时再由 Layout.preferredHeight 放大
    implicitHeight: row.implicitHeight + card.pad * 2

    // 「地点 · 教师」，两边都可能没有；都空的时候整行不画
    readonly property string meta: {
        if (!card.entry) {
            return "";
        }
        var parts = [];
        if (card.entry.room && String(card.entry.room).trim() !== "") {
            parts.push(String(card.entry.room).trim());
        }
        if (card.entry.teacher && String(card.entry.teacher).trim() !== "") {
            parts.push(String(card.entry.teacher).trim());
        }
        return parts.join(" · ");
    }

    RowLayout {
        id: row
        anchors.fill: parent
        anchors.leftMargin: card.pad * 1.5
        anchors.rightMargin: card.pad * 1.5
        anchors.topMargin: card.pad
        anchors.bottomMargin: card.pad
        spacing: card.pad

        // 左侧色条：做成圆头小竖条，比直角细条更像卡片上的装饰
        Rectangle {
            Layout.fillHeight: true
            Layout.preferredWidth: Math.max(3, Math.round(Kirigami.Units.smallSpacing * 0.75))
            radius: width / 2
            color: card.entry && card.entry.color
                ? card.entry.color : Kirigami.Theme.highlightColor
        }

        ColumnLayout {
            Layout.fillWidth: true
            // 必须显式给 0：默认最小宽度取内容宽度，长课名会把整行撑出卡片
            Layout.minimumWidth: 0
            spacing: 0

            PlasmaComponents.Label {
                Layout.fillWidth: true
                text: card.entry ? card.entry.name : ""
                color: card.fg
                font.bold: true
                font.pointSize: Kirigami.Theme.defaultFont.pointSize + 1
                elide: Text.ElideRight
            }
            PlasmaComponents.Label {
                Layout.fillWidth: true
                visible: text !== ""
                text: card.meta
                color: card.fg
                opacity: 0.7
                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
                elide: Text.ElideRight
            }
        }

        ColumnLayout {
            Layout.maximumWidth: implicitWidth
            spacing: 0

            // 日期在上、时间在下：右边这列是「什么时候」，一眼扫过去最要紧
            PlasmaComponents.Label {
                Layout.fillWidth: true
                visible: card.dayText !== ""
                text: card.dayText
                color: card.fg
                horizontalAlignment: Text.AlignRight
                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
            }
            PlasmaComponents.Label {
                Layout.fillWidth: true
                visible: card.badge !== ""
                text: card.badge
                color: card.fg
                horizontalAlignment: Text.AlignRight
                font.bold: true
                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
            }
            PlasmaComponents.Label {
                Layout.fillWidth: true
                text: card.entry ? card.entry.time : ""
                color: card.fg
                opacity: 0.85
                horizontalAlignment: Text.AlignRight
                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
            }
        }
    }
}

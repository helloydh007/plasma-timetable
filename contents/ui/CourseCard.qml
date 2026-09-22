/*
 * 一门课的卡片。供「今日课程」「接下来」这类列表样式复用。
 *
 * 左侧一条课程色条 + 课名 + 地点/教师 + 右侧时间。
 * 正在上的那一节用主题高亮色整块点亮，一眼就能找到「现在上的是哪门」。
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
    // 「今天 / 明天 / 周四」这类相对日期，只有跨天的列表样式会用到
    property string dayLabel: ""

    radius: 4
    color: card.current
        ? Kirigami.Theme.highlightColor
        // 没在上的用一层很淡的文字色叠出卡片感，深浅主题都合适
        : Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g,
                  Kirigami.Theme.textColor.b, 0.07)

    readonly property color fg: card.current
        ? Kirigami.Theme.highlightedTextColor : Kirigami.Theme.textColor

    RowLayout {
        anchors.fill: parent
        anchors.margins: Kirigami.Units.smallSpacing
        spacing: Kirigami.Units.smallSpacing

        Rectangle {
            Layout.fillHeight: true
            Layout.preferredWidth: 4
            radius: 2
            color: card.entry && card.entry.color ? card.entry.color : Kirigami.Theme.highlightColor
        }

        // 跨天的列表里才显示「明天 / 周四」，同一天的列表显示它就啰嗦了
        PlasmaComponents.Label {
            Layout.preferredWidth: Kirigami.Units.gridUnit * 2.6
            visible: card.dayLabel !== ""
            text: card.dayLabel
            color: card.fg
            opacity: 0.85
            font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
        }

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 0

            PlasmaComponents.Label {
                Layout.fillWidth: true
                text: card.entry ? card.entry.name : ""
                color: card.fg
                font.bold: true
                elide: Text.ElideRight
            }
            PlasmaComponents.Label {
                Layout.fillWidth: true
                visible: text !== ""
                text: {
                    if (!card.entry) {
                        return "";
                    }
                    var parts = [];
                    if (card.entry.room) {
                        parts.push(card.entry.room);
                    }
                    if (card.entry.teacher) {
                        parts.push(card.entry.teacher);
                    }
                    return parts.join(" · ");
                }
                color: card.fg
                opacity: 0.75
                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
                elide: Text.ElideRight
            }
        }

        PlasmaComponents.Label {
            text: card.entry ? card.entry.time : ""
            color: card.fg
            opacity: 0.85
            font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
        }
    }
}

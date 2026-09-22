/*
 * 显示样式：接下来
 *
 * 从今天起往后排的几节课，跨天的卡片上标出「明天 / 周五 9/25 / 下周三 9/30」。
 * 和「今日课程」的区别是它不等今天上完才往后看，任何时候都能看到
 * 「接下来还有什么」。
 *
 * 日期要连具体日子一起写：同一门课每周都上，只写「周三」的话，
 * 本周三和下周三会变成两张一模一样的卡片（用户报过这个「重复显示」）。
 */

import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

Item {
    id: view

    property var cards: []
    property date now: new Date()
    property string emptyText: ""

    ColumnLayout {
        anchors.fill: parent
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents.Label {
            Layout.fillWidth: true
            Layout.bottomMargin: Kirigami.Units.smallSpacing
            text: "接下来"
            visible: view.cards.length > 0
            font.bold: true
            font.pointSize: Kirigami.Theme.defaultFont.pointSize + 2
            opacity: 0.85
        }

        PlasmaComponents.Label {
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: view.cards.length === 0
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            wrapMode: Text.Wrap
            font.pointSize: Kirigami.Theme.defaultFont.pointSize + 1
            opacity: 0.6
            text: view.emptyText !== "" ? view.emptyText : "后面没有课了"
        }

        CardList {
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: view.cards.length > 0
            cards: view.cards
            now: view.now
        }
    }
}

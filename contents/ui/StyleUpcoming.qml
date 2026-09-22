/*
 * 显示样式：接下来
 *
 * 从今天起往后排的几节课，跨天时在卡片上标出「明天 / 后天 / 周四」。
 * 和「今日课程」的区别是它会往后看 —— 适合想看「接下来还有什么」的时候。
 */

import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

Item {
    id: view

    property var cards: []          // 每项比今日的多一个 dayLabel
    property date now: new Date()
    property string emptyText: ""

    function isCurrent(c) {
        if (!c || !c.sameDay) {
            return false;
        }
        var m = view.now.getHours() * 60 + view.now.getMinutes();
        return c.startMinutes >= 0 && c.endMinutes > c.startMinutes
            && m >= c.startMinutes && m < c.endMinutes;
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: Kirigami.Units.smallSpacing * 1.5

        PlasmaComponents.Label {
            Layout.fillWidth: true
            Layout.bottomMargin: Kirigami.Units.smallSpacing
            text: "接下来"
            font.bold: true
            // 默认字号在标题这个位置偏小，加一档；再和下面的卡片留点距离
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
            opacity: 0.6
            text: view.emptyText !== "" ? view.emptyText : "后面没有课了"
        }

        Repeater {
            model: view.cards

            delegate: CourseCard {
                required property var modelData
                Layout.fillWidth: true
                // 同 StyleToday：给个高度上限，免得课少时被拉满
                Layout.fillHeight: true
                Layout.maximumHeight: Kirigami.Units.gridUnit * 3.4
                Layout.minimumHeight: Kirigami.Units.gridUnit * 1.8
                entry: modelData
                dayLabel: modelData.dayLabel || ""
                current: view.isCurrent(modelData)
            }
        }

        // 剩余空间全给这个占位项，卡片就贴顶排 —— 否则课少时整块会被垂直居中
        Item {
            Layout.fillHeight: true
            visible: view.cards.length > 0
        }
    }
}

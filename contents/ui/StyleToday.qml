/*
 * 显示样式：今日课程
 *
 * 只列今天的课。桌面上要的是「一瞥就知道今天上什么、现在上什么」，
 * 周网格那种密排小字反而不合适。
 *
 * 今天还有课就显示今天的；今天的都上完了，main.qml 会把「接下来最近的一节」
 * 递进来（带「明天」这类日期标签），免得一天课上完之后桌面直接空掉。
 *
 * 卡片用 Layout.fillHeight 平分高度，所以课多课少都塞得下，不会溢出。
 */

import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

Item {
    id: view

    property var cards: []
    property string header: ""
    property date now: new Date()
    // 学期结束 / 尚未开学 / 放假时由外部给一句说明，覆盖默认的「今天没课」
    property string emptyText: ""

    // 正在上的那一节：既要是今天的，也要「现在」落在它的起止时间之间。
    // 少了「是不是今天」这一半，明天同时间的课会被判成正在上（踩过）。
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
            text: view.header
            visible: text !== ""
            font.bold: true
            // 默认字号在标题这个位置偏小，加一档；再和下面的卡片留点距离
            font.pointSize: Kirigami.Theme.defaultFont.pointSize + 2
            opacity: 0.85
            elide: Text.ElideRight
        }

        PlasmaComponents.Label {
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: view.cards.length === 0
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            wrapMode: Text.Wrap
            opacity: 0.6
            text: view.emptyText !== "" ? view.emptyText : "今天没有课"
        }

        Repeater {
            model: view.cards

            delegate: CourseCard {
                required property var modelData
                Layout.fillWidth: true
                // 平分高度：课多的时候每张矮一点，不会溢出到组件外面。
                // 但要有上限 —— 只给 fillHeight 的话，一天只有一门课时那一张卡
                // 会被拉满整个组件，文字孤零零浮在中间。
                Layout.fillHeight: true
                Layout.maximumHeight: Kirigami.Units.gridUnit * 3.4
                Layout.minimumHeight: Kirigami.Units.gridUnit * 1.8
                entry: modelData
                // 今天没有课、退而显示后面那几节时会带日期标签，这里要透出来
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

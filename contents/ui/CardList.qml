/*
 * 课程卡片列表（「今日课程」「接下来」两个样式共用）
 *
 * 卡片之间等高等距。高度先按内容算，有多余空间时平分掉（课少的时候不至于
 * 挤成一条），但不超过 maxCardHeight —— 只上一门课时卡片被拉满整个组件，
 * 文字孤零零浮在中间很难看。
 *
 * 套一层 Flickable：卡片永远不会被压得比内容还矮（那样文字会溢出卡片），
 * 空间不够就滚动，也不会画到组件边框外面去。滚动条只在真需要时出现，
 * 而且要把宽度让出来，否则它会压住卡片最右边的下课时间。
 */

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

Item {
    id: view

    // [{ name, room, teacher, color, time, dayText, startMinutes, endMinutes, sameDay }]
    property var cards: []
    property date now: new Date()
    property real maxCardHeight: Kirigami.Units.gridUnit * 3.4

    // 平分剩余空间：容器高 / 卡片数，再和内容高度取大的那个
    readonly property real share: view.cards.length > 0
        ? flick.height / view.cards.length : 0

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

    Flickable {
        id: flick
        anchors.fill: parent
        clip: true
        contentWidth: width
        contentHeight: col.implicitHeight
        // 回弹会让人以为桌面在跟着动，这里不要
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        // 滚动条浮在内容上层，不留出它的宽度就会盖住卡片最右边的时间
        readonly property real reservedWidth:
            view.scrolls ? scrollBar.width + Kirigami.Units.smallSpacing : 0

        ColumnLayout {
            id: col
            width: flick.width - flick.reservedWidth
            spacing: Kirigami.Units.smallSpacing

            Repeater {
                model: view.cards

                delegate: CourseCard {
                    required property var modelData

                    Layout.fillWidth: true
                    Layout.preferredHeight: Math.min(
                        view.maxCardHeight,
                        Math.max(implicitHeight, view.share))
                    entry: modelData
                    dayText: modelData.dayText || ""
                    // 正在上的那节标出来，不用盯着时间自己算
                    badge: view.isCurrent(modelData) ? "上课中" : ""
                    current: view.isCurrent(modelData)
                }
            }
        }

        QQC2.ScrollBar.vertical: QQC2.ScrollBar {
            id: scrollBar
            policy: view.scrolls ? QQC2.ScrollBar.AsNeeded : QQC2.ScrollBar.AlwaysOff
        }
    }

    // 内容比容器高才需要滚动。按 col 的隐式高度判断，与宽度无关，
    // 不会和上面「让出滚动条宽度」的绑定绕成环。
    readonly property bool scrolls: col.implicitHeight > flick.height + 1
}

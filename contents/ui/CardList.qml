/*
 * 课程列表（「今日课程」「接下来」两个样式共用）
 *
 * 三种布局，由配置项 cardLayout 决定（外观页可切）：
 *   card     —— 两行卡片：色条 + 课名/地点 + 右侧日期·时间（默认）
 *   compact  —— 紧凑行式：一堂课只占一行（版式取自画布稿 Direction A），
 *               240x160 的小组件里三节课都能看见，不用滚动
 *   timeline —— 日程时间轴（Direction B）：整条日程是一张带描边的面板，
 *               左边日期列、中间导轨圆点、右边课名
 *
 * 高度：卡片布局按内容算，容器有富余时平分，但不超过 maxCardHeight ——
 * 只上一门课时卡片被拉满整个组件、文字孤零零浮在中间很难看。
 * 紧凑布局不拉伸（矮才有意义），时间轴布局平分面板高度。
 *
 * 放不下时不压扁，改为滚动（压扁会让文字溢出卡片）；滚动条只在真需要时出现，
 * 而且要给它让出宽度，否则它会盖住卡片最右边的下课时间。
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
    property string layout: "card"
    property real maxCardHeight: Kirigami.Units.gridUnit * 3.4

    readonly property bool compact: view.layout === "compact"
    readonly property bool timeline: view.layout === "timeline"

    // 时间轴：面板内边距随宽度放大（240 下 8，420 下 12，860 下 16）
    readonly property int panelPad: Math.max(Kirigami.Units.smallSpacing * 2,
        Math.min(Math.round(Kirigami.Units.gridUnit * 0.9), Math.round(flick.width * 0.03)))
    // 行距。时间轴要宽一点，导轨靠它留白才不像一条被挤扁的线
    readonly property real rowGap: view.timeline
        ? Kirigami.Units.smallSpacing * 2.5 : Kirigami.Units.smallSpacing

    // 可视高度（不含面板内边距）
    readonly property real availableHeight: Math.max(0,
        flick.height - (view.timeline ? view.panelPad * 2 : 0))
    readonly property real share: view.cards.length > 0
        ? view.availableHeight / view.cards.length : 0

    // 高度够不够放下「地点 · 教师」那一行。由容器按**可视高度**算，
    // 不是让每行自己量 —— 否则「多显示一行 → 变高 → 又有空间多显示一行」会绕成环。
    readonly property bool roomForMeta: view.cards.length > 0
        && view.share >= Kirigami.Units.gridUnit * 2.4

    // 内容比容器高才需要滚动。按 col 的隐式高度判断，与宽度无关，
    // 不会和「让出滚动条宽度」的绑定绕成环。
    readonly property bool scrolls: col.implicitHeight > flick.height + 1

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

    // 时间轴的面板：整条日程一张卡，画在内容下面（所以先声明）
    Rectangle {
        visible: view.timeline
        anchors.fill: parent
        color: Kirigami.Theme.alternateBackgroundColor
        radius: 8
        border.width: 1
        border.color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g,
                              Kirigami.Theme.textColor.b, 0.15)
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

        // 滚动条浮在内容上层，不留出它的宽度就会盖住最右边的时间
        readonly property real reservedWidth:
            view.scrolls ? scrollBar.width + Kirigami.Units.smallSpacing : 0

        ColumnLayout {
            id: col
            x: view.timeline ? view.panelPad : 0
            width: flick.width - flick.reservedWidth - (view.timeline ? view.panelPad * 2 : 0)
            spacing: view.rowGap

            // ── ① 卡片（默认）──
            Repeater {
                model: view.cards

                delegate: CourseCard {
                    required property var modelData

                    // 布局切换靠 visible：布局器会跳过不可见的项，不会留空位
                    visible: view.layout === "card"
                    Layout.fillWidth: true
                    Layout.preferredHeight: Math.min(view.maxCardHeight,
                        Math.max(implicitHeight, view.share))
                    entry: modelData
                    dayText: modelData.dayText || ""
                    badge: view.isCurrent(modelData) ? "上课中" : ""
                    current: view.isCurrent(modelData)
                }
            }

            // ── ② 紧凑行式 ──
            Repeater {
                model: view.cards

                delegate: CompactCourseRow {
                    required property var modelData

                    visible: view.compact
                    Layout.fillWidth: true
                    // 不拉伸：紧凑的意义就是矮，拉高就白省了
                    Layout.preferredHeight: implicitHeight
                    entry: modelData
                    dayText: modelData.dayText || ""
                    badge: view.isCurrent(modelData) ? "上课中" : ""
                    current: view.isCurrent(modelData)
                    showMeta: view.roomForMeta
                }
            }

            // ── ③ 日程时间轴 ──
            Repeater {
                model: view.cards

                delegate: TimelineCourseRow {
                    required property var modelData
                    required property int index

                    visible: view.timeline
                    Layout.fillWidth: true
                    // 不拉伸：设计稿里行是贴顶排的，空气靠行距给
                    Layout.preferredHeight: implicitHeight
                    entry: modelData
                    dayText: modelData.dayText || ""
                    badge: view.isCurrent(modelData) ? "上课中" : ""
                    current: view.isCurrent(modelData)
                    showMeta: view.roomForMeta
                    isLast: index === view.cards.length - 1
                    // 行距要让导轨知道：竖线要跨过它，才和下一行接得上
                    rowGap: view.rowGap
                }
            }
        }

        QQC2.ScrollBar.vertical: QQC2.ScrollBar {
            id: scrollBar
            policy: view.scrolls ? QQC2.ScrollBar.AsNeeded : QQC2.ScrollBar.AlwaysOff
        }
    }
}

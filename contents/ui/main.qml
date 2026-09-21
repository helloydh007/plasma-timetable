/*
 * 课程表组件
 *
 * 数据模型与三个导入器都在独立的 JS 模块里（coursemodel / ics / wakeup），
 * 这个文件只负责画：周网格、面板上的「现在/下一节」、以及和节假日的联动。
 *
 * 周期性的坑（来自月历组件的经验）：
 *   - root 必须是 PlasmoidItem，用 Item 会被 libPlasmaQuick 拒绝加载且静默移除
 *   - 绑定的依赖关系靠"读了哪个属性"建立，所以周次/日期都从 timetable 现算，不缓存
 *   - 失败绑定会让属性停在默认值（Item.visible 默认 true），所以可见性都用显式条件
 */

import QtQuick
import QtQuick.Layouts

import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

import "coursemodel.js" as CM
import "holidays.js" as Holidays
import "holidays-update.js" as HolidaysNet

PlasmoidItem {
    id: root

    // 首次拖到桌面时的默认尺寸。必须写在根上 —— 只写在 fullRepresentation 里
    // 桌面容器不会采用（会按渲染出的最小尺寸给，网格被压成 0 高）。
    // 一周 7 列、一学期十来节，宽 860 高 540 是三行文字都能看清的下限。
    implicitWidth: 860
    implicitHeight: 540

    // ══════════════════ 数据 ══════════════════

    readonly property var timetable: CM.parseModel(Plasmoid.configuration.timetableData)
    property var holidayCache: HolidaysNet.parseCache(Plasmoid.configuration.holidayCache)
    // 调休日的上课安排单独一个配置键（见 configGeneral.qml 的说明）
    readonly property var workAsMap: CM.parseWorkAs(Plasmoid.configuration.workAsData)

    readonly property bool holidaysOn: Plasmoid.configuration.markHolidays
    readonly property bool hasCourses: (timetable.courses || []).length > 0

    // ══════════════════ 时间与周次 ══════════════════

    property date today: new Date()
    // 0 = 跟随今天；>0 = 用户翻到的那一周
    property int shownWeek: 0

    readonly property int weekOfToday: Math.max(1, CM.weekOf(timetable, today))
    readonly property int shownWeekNumber: shownWeek > 0 ? shownWeek : weekOfToday
    readonly property int totalWeeks: Math.max(1, Math.round(Number(timetable.totalWeeks) || 20))
    readonly property int periodRows: Math.max(1, CM.rowCount(timetable))

    readonly property string weekdayHeader: "一二三四五六日"

    Timer {
        // 跨天要换高亮、跨节要换「下一节」，一分钟一次足够
        interval: 60 * 1000
        running: true
        repeat: true
        onTriggered: root.today = new Date()
    }

    // 自动模式下的节假日更新。配置页里手动更新是一次性的，
    // 不在这儿补一个定时器的话，自动模式只有打开设置时才会生效。
    property bool holidayUpdating: false

    Timer {
        interval: 6 * 60 * 60 * 1000
        running: Plasmoid.configuration.holidayUpdateMode === "auto"
        repeat: true
        triggeredOnStart: true
        onTriggered: root.autoUpdateHolidays()
    }

    function autoUpdateHolidays() {
        if (holidayUpdating) {
            return;
        }
        var now = new Date();
        if (!HolidaysNet.shouldAutoCheck(holidayCache, now)) {
            return;
        }
        holidayUpdating = true;
        HolidaysNet.runUpdate(holidayCache, now, Holidays.COVERED_YEARS, null,
            function (result) {
                holidayUpdating = false;
                if (result && result.cache) {
                    Plasmoid.configuration.holidayCache =
                        HolidaysNet.serializeCache(result.cache);
                    root.holidayCache =
                        HolidaysNet.parseCache(Plasmoid.configuration.holidayCache);
                }
            });
    }

    // ══════════════════ 节假日联动 ══════════════════

    // 联网缓存优先，其次内置数据表；两边都没有该年份时返回 null（不显示任何标记）
    function holidayStatus(date) {
        if (!date) {
            return null;
        }
        var y = date.getFullYear();
        var m = date.getMonth() + 1;
        var d = date.getDate();
        var cached = HolidaysNet.statusFromCache(y, m, d, holidayCache);
        return cached ? cached : Holidays.statusFor(y, m, d);
    }

    /*
     * 某周的星期几到底上哪一天的课。
     *   休 → off，当天没课
     *   班 → 按 workAs 指定的星期几上；用户没指定就按当天本身的星期几
     * （国务院通知只说哪天补班，不说补哪天的课 —— 那是各校自己定的，只能让用户填。）
     */
    function resolveDay(week, weekday) {
        var date = CM.dateOf(timetable, week, weekday);
        if (!date || !holidaysOn) {
            return { weekday: weekday, off: false, status: null, date: date };
        }
        var st = holidayStatus(date);
        if (st && st.type === "off") {
            return { weekday: weekday, off: true, status: st, date: date };
        }
        if (st && st.type === "work") {
            var as = CM.workAsFor(workAsMap, CM.isoOf(date));
            if (as === 0) {
                return { weekday: weekday, off: true, status: st, date: date };
            }
            return { weekday: as > 0 ? as : weekday, off: false, status: st, date: date };
        }
        return { weekday: weekday, off: false, status: null, date: date };
    }

    function coursesAt(week, weekday) {
        var r = resolveDay(week, weekday);
        return r.off ? [] : CM.coursesOn(timetable, week, r.weekday);
    }

    // 当前显示的这一周里、所有要画出来的课程块
    readonly property var cellCourses: {
        var out = [];
        for (var wd = 1; wd <= 7; wd++) {
            var list = coursesAt(shownWeekNumber, wd);
            for (var i = 0; i < list.length; i++) {
                out.push({ course: list[i], weekday: wd });
            }
        }
        return out;
    }

    function isToday(date) {
        return !!date && CM.isoOf(date) === CM.isoOf(today);
    }

    // ══════════════════ 面板上的「现在 / 下一节」 ══════════════════

    function nextClass() {
        if (!hasCourses) {
            return { label: "无课表", detail: "", active: false };
        }
        var wd = CM.weekdayOf(today);
        var list = coursesAt(weekOfToday, wd);
        var nowMin = today.getHours() * 60 + today.getMinutes();
        var i;

        for (i = 0; i < list.length; i++) {
            var p0 = CM.periodByNode(timetable, list[i].startPeriod);
            var p1 = CM.periodByNode(timetable, list[i].endPeriod);
            var s = p0 ? CM.minutesOfTime(p0.start) : -1;
            var e = p1 ? CM.minutesOfTime(p1.end) : -1;
            if (s >= 0 && e > s && nowMin >= s && nowMin < e) {
                var left = e - nowMin;
                return {
                    label: list[i].name,
                    detail: (left >= 60 ? Math.floor(left / 60) + " 小时 " + (left % 60) + " 分" : left + " 分钟") + "后下课",
                    active: true
                };
            }
        }
        for (i = 0; i < list.length; i++) {
            var q = CM.periodByNode(timetable, list[i].startPeriod);
            if (!q) {
                continue;
            }
            var qs = CM.minutesOfTime(q.start);
            if (qs > nowMin) {
                var wait = qs - nowMin;
                return {
                    label: list[i].name,
                    detail: q.start + " 开始"
                        + (wait >= 60 ? "（" + Math.floor(wait / 60) + " 小时后）" : "（" + wait + " 分钟后）"),
                    active: false
                };
            }
        }
        var r = resolveDay(weekOfToday, wd);
        if (r.status && r.status.type === "off") {
            return { label: "放假", detail: r.status.name, active: false };
        }
        return { label: "今天没课了", detail: "", active: false };
    }

    readonly property var panelInfo: nextClass()

    compactRepresentation: MouseArea {
        id: compact
        implicitWidth: compactRow.implicitWidth + Kirigami.Units.smallSpacing * 2
        implicitHeight: compactRow.implicitHeight + Kirigami.Units.smallSpacing * 2
        onClicked: root.expanded = !root.expanded

        RowLayout {
            id: compactRow
            anchors.centerIn: parent
            spacing: Kirigami.Units.smallSpacing
            PlasmaComponents.Label {
                text: root.panelInfo.active ? "●" : "○"
                color: root.panelInfo.active ? Kirigami.Theme.positiveTextColor
                                             : Kirigami.Theme.textColor
            }
            PlasmaComponents.Label {
                text: root.panelInfo.label
                font.bold: true
            }
            PlasmaComponents.Label {
                text: root.panelInfo.detail
                opacity: 0.7
                visible: text !== ""
            }
        }
    }

    // ══════════════════ 桌面上的周网格 ══════════════════

    fullRepresentation: Item {
        implicitWidth: Kirigami.Units.gridUnit * 30
        implicitHeight: Kirigami.Units.gridUnit * 21

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing

            // ── 工具条 ──
            RowLayout {
                Layout.fillWidth: true
                spacing: Kirigami.Units.smallSpacing

                PlasmaComponents.ToolButton {
                    icon.name: "go-previous"
                    enabled: root.shownWeekNumber > 1
                    onClicked: root.shownWeek = Math.max(1, root.shownWeekNumber - 1)
                    PlasmaComponents.ToolTip.text: "上一周"
                    PlasmaComponents.ToolTip.visible: hovered
                }

                PlasmaComponents.Label {
                    text: "第 " + root.shownWeekNumber + " 周"
                    font.bold: true
                }

                PlasmaComponents.ToolButton {
                    icon.name: "go-next"
                    enabled: root.shownWeekNumber < root.totalWeeks
                    onClicked: root.shownWeek = Math.min(root.totalWeeks, root.shownWeekNumber + 1)
                    PlasmaComponents.ToolTip.text: "下一周"
                    PlasmaComponents.ToolTip.visible: hovered
                }

                PlasmaComponents.Label {
                    text: root.shownWeekNumber === root.weekOfToday ? "（本周）" : ""
                    opacity: 0.6
                    visible: text !== ""
                }

                Item { Layout.fillWidth: true }

                PlasmaComponents.Button {
                    text: "回到本周"
                    visible: root.shownWeek > 0 && root.shownWeekNumber !== root.weekOfToday
                    onClicked: root.shownWeek = 0
                }
            }

            // ── 网格 ──
            Item {
                id: gridArea
                Layout.fillWidth: true
                Layout.fillHeight: true
                visible: root.hasCourses
                clip: true

                readonly property int labelWidth: Math.max(30, Math.round(Kirigami.Units.gridUnit * 2.2))
                readonly property int headerHeight: Math.max(24, Math.round(Kirigami.Units.gridUnit * 1.7))
                readonly property real colWidth: Math.max(1, (width - labelWidth) / 7)
                readonly property real rowHeight: Math.max(1, (height - headerHeight) / root.periodRows)

                // 节次号 → 行下标；作息表里没有的节次落到第一行，总比画出界强
                function rowFor(node) {
                    var r = CM.rowOfNode(root.timetable, node);
                    if (r < 0) {
                        return 0;
                    }
                    return Math.min(r, root.periodRows - 1);
                }

                // 网格线：每周一条竖线
                Repeater {
                    model: 8
                    delegate: Rectangle {
                        required property int index
                        x: Math.round(gridArea.labelWidth + index * gridArea.colWidth)
                        y: gridArea.headerHeight
                        width: 1
                        height: gridArea.height - gridArea.headerHeight
                        color: Kirigami.Theme.textColor
                        opacity: 0.18
                    }
                }

                // 网格线：每节一条横线
                Repeater {
                    model: root.periodRows + 1
                    delegate: Rectangle {
                        required property int index
                        x: gridArea.labelWidth
                        y: Math.round(gridArea.headerHeight + index * gridArea.rowHeight)
                        width: gridArea.width - gridArea.labelWidth
                        height: 1
                        color: Kirigami.Theme.textColor
                        opacity: 0.18
                    }
                }

                // ── 星期表头 ──
                Repeater {
                    model: 7
                    delegate: Item {
                        id: dayHead
                        required property int index

                        readonly property int weekday: index + 1
                        readonly property var resolved: root.resolveDay(root.shownWeekNumber, weekday)
                        readonly property bool today: root.isToday(resolved.date)

                        x: gridArea.labelWidth + index * gridArea.colWidth
                        y: 0
                        width: gridArea.colWidth
                        height: gridArea.headerHeight

                        Rectangle {
                            anchors.fill: parent
                            anchors.margins: 1
                            radius: 3
                            color: dayHead.today ? Kirigami.Theme.highlightColor : "transparent"
                        }

                        RowLayout {
                            anchors.centerIn: parent
                            spacing: 2
                            PlasmaComponents.Label {
                                text: root.weekdayHeader.charAt(index)
                                font.bold: true
                                color: dayHead.today ? Kirigami.Theme.highlightedTextColor
                                                     : Kirigami.Theme.textColor
                            }
                            PlasmaComponents.Label {
                                text: dayHead.resolved.date
                                      ? String(dayHead.resolved.date.getDate()) : ""
                                opacity: 0.6
                                color: dayHead.today ? Kirigami.Theme.highlightedTextColor
                                                     : Kirigami.Theme.textColor
                            }
                            PlasmaComponents.Label {
                                visible: text !== ""
                                text: {
                                    if (!dayHead.resolved.status) {
                                        return "";
                                    }
                                    return dayHead.resolved.status.type === "off" ? "休" : "班";
                                }
                                font.bold: true
                                color: dayHead.resolved.status
                                       && dayHead.resolved.status.type === "off" ? "#c0392b" : "#6b7280"
                                // Label 没有 hovered 属性（那是 MouseArea / 按钮的），
                                // 要用 HoverHandler 才拿得到悬停状态
                                HoverHandler { id: badgeHover }
                                PlasmaComponents.ToolTip.text: dayHead.resolved.status
                                    ? dayHead.resolved.status.name
                                      + (dayHead.resolved.status.type === "off" ? "（放假）" : "（调休上班）") : ""
                                PlasmaComponents.ToolTip.visible: badgeHover.hovered
                            }
                        }
                    }
                }

                // ── 左侧节次列 ──
                Repeater {
                    model: root.periodRows
                    delegate: Column {
                        required property int index
                        readonly property var period: CM.periodAt(root.timetable, index)

                        x: 0
                        y: gridArea.headerHeight + index * gridArea.rowHeight
                        width: gridArea.labelWidth
                        height: gridArea.rowHeight

                        PlasmaComponents.Label {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: parent.period ? parent.period.node : ""
                            font.bold: true
                            opacity: 0.8
                        }
                        PlasmaComponents.Label {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: parent.period && parent.period.start ? parent.period.start : ""
                            font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize - 2)
                            opacity: 0.5
                            visible: text !== ""
                        }
                    }
                }

                // ── 课程块 ──
                Repeater {
                    model: root.cellCourses

                    delegate: Rectangle {
                        id: block
                        required property var modelData

                        readonly property var course: modelData.course
                        readonly property int firstRow: gridArea.rowFor(course.startPeriod)
                        readonly property int lastRow: Math.max(firstRow, gridArea.rowFor(course.endPeriod))
                        readonly property color blockColor: course.color
                            ? course.color : Kirigami.Theme.highlightColor
                        readonly property color blockText: CM.textColorFor(blockColor)
                        // 去掉上下各 3px 的内边距后真正能放字的高度
                        readonly property real inner: Math.max(0, height - 6)

                        x: gridArea.labelWidth + (modelData.weekday - 1) * gridArea.colWidth + 1
                        y: gridArea.headerHeight + firstRow * gridArea.rowHeight + 1
                        width: Math.max(1, gridArea.colWidth - 2)
                        height: Math.max(1, (lastRow - firstRow + 1) * gridArea.rowHeight - 2)
                        radius: 3
                        color: blockColor
                        clip: true

                        Column {
                            id: blockCol
                            anchors.fill: parent
                            anchors.margins: 3
                            spacing: 0
                            clip: true

                            // 只有一节高的时候放不下三行，按可用高度逐级往下减：
                            // 课名永远留，地点其次，教师最后。硬塞会把字压在块外面。
                            readonly property bool roomFits: block.inner > Kirigami.Units.gridUnit * 2.4
                            readonly property bool teacherFits: block.inner > Kirigami.Units.gridUnit * 3.6

                            PlasmaComponents.Label {
                                width: blockCol.width
                                text: block.course.name
                                color: block.blockText
                                font.bold: true
                                font.pointSize: block.inner < Kirigami.Units.gridUnit * 1.8
                                    ? Math.max(6, Kirigami.Theme.defaultFont.pointSize - 2)
                                    : Kirigami.Theme.defaultFont.pointSize
                                wrapMode: Text.Wrap
                                maximumLineCount: block.inner < Kirigami.Units.gridUnit * 1.8 ? 1 : 2
                                elide: Text.ElideRight
                            }
                            PlasmaComponents.Label {
                                width: blockCol.width
                                text: block.course.room
                                color: block.blockText
                                opacity: 0.85
                                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize - 2)
                                elide: Text.ElideRight
                                visible: text !== "" && blockCol.roomFits
                            }
                            PlasmaComponents.Label {
                                width: blockCol.width
                                text: block.course.teacher
                                color: block.blockText
                                opacity: 0.7
                                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize - 2)
                                elide: Text.ElideRight
                                visible: text !== "" && blockCol.teacherFits
                            }
                        }
                    }
                }
            }

            // ── 空状态 ──
            PlasmaComponents.Label {
                Layout.fillWidth: true
                Layout.fillHeight: true
                visible: !root.hasCourses
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                wrapMode: Text.Wrap
                opacity: 0.7
                text: "还没有课表。\n\n右键这个组件 → 配置课程表，\n" +
                      "可以手动录入，也可以导入 ICS 或 WakeUp 课程表的备份文件。"
            }
        }
    }
}

/*
 * 配置页：课程表与学期
 *
 * 三条录入路径最终都落到同一个模型（coursemodel.js）：
 *   手动编辑  —— 下面的列表，改一格写一格
 *   ICS       —— 教务系统 / 日历导出的 .ics 内容，粘贴进来
 *   WakeUp    —— .wakeup_schedule 备份文件的内容，粘贴进来
 *
 * 为什么学期设置（开学日 / 总周数 / 作息时间表）也在这个页而不是单独一页：
 * 它们和课程存在同一个配置键 timetableData 里。KCM 的每一页各自持有 cfg_ 属性的
 * 副本，两个页同时写同一个键，后写的那页会把另一页的改动整个覆盖掉 ——
 * 比如在课程页导入完课表，再去学期页改一个总周数，导入的课程就没了。
 * 所以凡是导入器会写到的字段，都必须归同一个页所有。
 *
 * 关于"为什么只能粘贴、不能选文件"：
 * QML 没有文件读取能力，XMLHttpRequest 的 file:// 被安全策略挡着，
 * 所以「从文件读取」这条路走不通。备份文件和 .ics 都是纯文本，
 * 用文本编辑器打开、全选复制、粘贴进来即可。宁可要一条一定能用的路，
 * 也不要一个在别人机器上打不开的文件对话框。
 *
 * 编辑时「改字段」是就地改 + 提交，不重建整个数组 —— 否则每敲完一格
 * 列表就重建一次，输入焦点会丢。「增删/导入」才重建。
 */

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kcmutils as KCMUtils
import org.kde.kirigami as Kirigami

import "coursemodel.js" as CM
import "ics.js" as ICS
import "wakeup.js" as WU

KCMUtils.SimpleKCM {
    id: page

    // KCM 框架的约定：配置页自己声明并发出此信号，宿主据此启用「应用」按钮。
    signal configurationChanged()

    property alias cfg_timetableData: dataHolder.text

    property string termStart: ""
    property int totalWeeks: 20
    property var periods: []
    property var courses: []

    // 不展示，仅作为 cfg_ 的载体
    QQC2.TextField { id: dataHolder; visible: false; width: 0; height: 0 }

    property bool alive: true
    Component.onDestruction: alive = false

    property string importStatus: ""
    property bool importHadError: false

    Component.onCompleted: loadFromConfig()

    function loadFromConfig() {
        var m = CM.parseModel(dataHolder.text);
        page.termStart = m.termStart;
        page.totalWeeks = m.totalWeeks;
        page.periods = m.periods;
        page.courses = m.courses;
    }

    function commit() {
        dataHolder.text = CM.serializeModel({
            termStart: page.termStart,
            totalWeeks: page.totalWeeks,
            periods: page.periods,
            courses: page.courses
        });
        page.configurationChanged();
    }

    readonly property string summary: page.courses.length === 0
        ? i18n("还没有课程。用下面的导入，或点「添加一节课」手动录入。")
        : i18n("共 %1 门课 / %2 个时段", CM.courseNames({ courses: page.courses }).length, page.courses.length)

    readonly property var knownNames: CM.courseNames({ courses: page.courses })
    readonly property var weekdayChoices: {
        var n = CM.weekdayNames();
        var out = [];
        for (var i = 0; i < 7; i++) {
            out.push(i18n("周%1", n[i]));
        }
        return out;
    }

    /*
     * 表格列宽固定值。表头那行和各课程行是**各自独立的 GridLayout 实例**，
     * 如果列宽靠内容撑开（Layout.fillWidth 或只给 preferredWidth 而不限制），
     * 每个实例算出来的列宽都不一样，表头就和下面的输入框对不上。
     * 每列在三处都用同一个固定值，就能保证对齐。
     * 加起来可能比配置窗口宽，所以表格外面套了横向滚动。
     */
    readonly property int colName:    Kirigami.Units.gridUnit * 9
    readonly property int colWeekday: Kirigami.Units.gridUnit * 4.5
    readonly property int colPeriod:  Kirigami.Units.gridUnit * 8
    readonly property int colWeeks:   Kirigami.Units.gridUnit * 6
    readonly property int colParity:  Kirigami.Units.gridUnit * 5.5
    readonly property int colRoom:    Kirigami.Units.gridUnit * 8
    readonly property int colTeacher: Kirigami.Units.gridUnit * 5.5
    readonly property int colDelete:  Kirigami.Units.gridUnit * 2

    // ══════════ 学期 ══════════

    readonly property var parsedStart: CM.parseIsoDate(termStartField.text)
    // 0 = 未填写，1 = 格式无效，2 = 有效
    readonly property int startState: termStartField.text.length === 0 ? 0 : (parsedStart ? 2 : 1)
    readonly property int todayWeek: parsedStart ? CM.weekOf({ termStart: termStartField.text }, new Date()) : 0
    readonly property int maxNode: Math.max(CM.rowCount({ periods: page.periods }), 1)

    function setTermStart(d) {
        var iso = CM.isoOf(d);
        termStartField.text = iso;
        // 必须真写进模型：只发 configurationChanged() 只会点亮「应用」按钮，
        // 那个值本身不会被保存，用户会以为设了其实没设。
        page.writeModel(function (m) { m.termStart = iso; });
    }

    // 对当前配置做一次「读—改—写」。所有涉及 timetableData 的改动都走这里，
    // 保证不会漏字段、也不会把一个页的改动带成另一份快照。
    function writeModel(mutate) {
        var m = CM.parseModel(dataHolder.text);
        mutate(m);
        dataHolder.text = CM.serializeModel(m);
        page.termStart = m.termStart;
        page.totalWeeks = m.totalWeeks;
        page.periods = m.periods;
        page.courses = m.courses;
        page.configurationChanged();
    }

    // ══════════ 课程字段编辑 ══════════

    // 就地改一格：不重建列表，所以正在输入的焦点不会丢
    function setField(index, key, value) {
        if (index < 0 || index >= page.courses.length) {
            return;
        }
        page.courses[index][key] = value;
        page.courses[index] = CM.normalizeCourse(page.courses[index], index);
        page.commit();
    }

    function withField(course, key, value) {
        var o = {};
        for (var k in course) {
            if (Object.prototype.hasOwnProperty.call(course, k)) {
                o[k] = course[k];
            }
        }
        o[key] = value;
        return o;
    }

    /*
     * 改周次要重建列表，不能像其他字段那样就地改：
     * 「单双周」下拉框的选中项是从周次推出来的（currentIndex: CM.parityOf(weeks)），
     * 而普通 JS 对象的属性变化不会触发绑定重算，就地改的话下拉框会停在旧值上。
     * 重建委托代价很小，而且这条路径本来就不在输入过程中触发。
     *
     * span 是用户填的起止周（如 1-16），单独存一份，反复切换单双周时范围不会缩水。
     */
    function setWeeksValue(index, weeks, span) {
        if (index < 0 || index >= page.courses.length) {
            return;
        }
        var arr = page.courses.slice();
        var updated = page.withField(arr[index], "weeks", weeks);
        updated = page.withField(updated, "weekSpan", span);
        arr[index] = CM.normalizeCourse(updated, index);
        page.courses = arr;
        page.commit();
    }

    function setWeeks(index, text) {
        var r = CM.parseWeeksText(text);
        if (r.errors.length > 0) {
            page.importStatus = r.errors.join("；");
            page.importHadError = true;
            return;
        }
        page.importHadError = false;
        page.importStatus = "";
        // 用解析出的范围（用户写下的起止），而不是过滤后周次的 min/max
        page.setWeeksValue(index, r.weeks, r.span);
    }

    // 单双周下拉框：0 每周 / 1 仅单周 / 2 仅双周
    function setParity(index, parity) {
        if (index < 0 || index >= page.courses.length) {
            return;
        }
        var c = page.courses[index];
        var span = CM.normalizeSpan(c.weekSpan, c.weeks);
        if (!span) {
            // 新建的课还没有周次，用 1..总周数 起个头
            span = [1, Math.max(1, page.totalWeeks)];
        }
        page.setWeeksValue(index, CM.applyParity(c.weeks, parity, page.totalWeeks, span), span);
    }

    function addCourse() {
        var arr = page.courses.slice();
        var weeks = [];
        for (var w = 1; w <= Math.min(16, page.totalWeeks); w++) {
            weeks.push(w);
        }
        arr.push(CM.normalizeCourse({
            name: i18n("新课程"), weekday: 1,
            startPeriod: 1, endPeriod: 2, weeks: weeks
        }, arr.length));
        page.courses = arr;
        page.commit();
    }

    function removeCourse(index) {
        var arr = page.courses.slice();
        arr.splice(index, 1);
        page.courses = arr;
        page.commit();
    }

    // ══════════ 导入 ══════════

    function doImport(text, mode) {
        if (!text || !text.trim()) {
            page.importStatus = i18n("请先把内容粘贴到上面的框里。");
            page.importHadError = true;
            return;
        }
        var res;
        if (mode === "ics") {
            res = ICS.toModel(ICS.parseIcs(text), CM, {
                termStart: page.termStart, periods: page.periods, totalWeeks: page.totalWeeks
            });
        } else {
            res = WU.parseWakeUp(text);
            if (res && res.model) {
                // wakeup.js 保持自包含（不依赖 coursmodel），合并去重在这一侧做
                res.model.courses = CM.assignColors(CM.mergeSlots(res.model.courses));
            }
        }
        if (!res || !res.model) {
            page.importHadError = true;
            page.importStatus = (res && res.errors && res.errors.length)
                ? res.errors.join("\n")
                : i18n("无法解析这份内容。");
            return;
        }

        var m = res.model;
        page.termStart = m.termStart || page.termStart;
        page.totalWeeks = Math.max(1, m.totalWeeks || page.totalWeeks);
        if (m.periods && m.periods.length) {
            page.periods = m.periods;
        }
        page.courses = m.courses;
        page.commit();

        var lines = [i18n("✓ 导入成功：%1", CM.describeModel(CM.parseModel(dataHolder.text)))];
        if (res.warnings && res.warnings.length) {
            lines = lines.concat(res.warnings);
        }
        page.importHadError = false;
        page.importStatus = lines.join("\n");
    }

    ColumnLayout {
        spacing: Kirigami.Units.smallSpacing

        // ══════════════════ 导入 ══════════════════

        Kirigami.Heading {
            level: 3
            text: i18n("导入课表")
        }

        QQC2.Label {
            Layout.fillWidth: true
            Layout.maximumWidth: Kirigami.Units.gridUnit * 44
            wrapMode: Text.WordWrap
            opacity: 0.75
            text: i18n("导入会替换现有的全部课程。手工加过的课请先留档（页面最下方可以复制当前课表内容）。")
        }

        QQC2.TabBar {
            id: importTabs
            Layout.fillWidth: true
            QQC2.TabButton { text: i18n("ICS 日历") }
            QQC2.TabButton { text: i18n("WakeUp 课程表") }
        }

        QQC2.Label {
            Layout.fillWidth: true
            Layout.maximumWidth: Kirigami.Units.gridUnit * 44
            wrapMode: Text.WordWrap
            opacity: 0.75
            text: importTabs.currentIndex === 0
                ? i18n("教务系统或日历导出的 .ics 文件。用文本编辑器打开，全选复制，粘贴到下面。\n" +
                       "能自动识别开学日、单双周（RRULE INTERVAL）和停课（EXDATE）。")
                : i18n("WakeUp 课程表 → 分享 → 导出备份，得到 .wakeup_schedule 文件。\n" +
                       "用文本编辑器打开（它是纯文本），全选复制，粘贴到下面。\n" +
                       "备份文件自带作息时间表和开学日期，导入后不用再配。")
        }

        QQC2.ScrollView {
            Layout.fillWidth: true
            Layout.preferredHeight: Kirigami.Units.gridUnit * 8

            QQC2.TextArea {
                id: importArea
                placeholderText: importTabs.currentIndex === 0
                    ? "BEGIN:VCALENDAR\nVERSION:2.0\n…"
                    : "1\n[{\"node\":1,\"startTime\":\"08:00\",…"
                wrapMode: TextEdit.WrapAnywhere
                font.family: "monospace"
            }
        }

        RowLayout {
            QQC2.Button {
                text: page.courses.length > 0 ? i18n("导入并替换现有课表") : i18n("导入")
                onClicked: page.doImport(importArea.text, importTabs.currentIndex === 0 ? "ics" : "wakeup")
            }
            QQC2.Button {
                text: i18n("清空粘贴框")
                enabled: importArea.text.length > 0
                onClicked: {
                    importArea.text = "";
                    page.importStatus = "";
                }
            }
            Item { Layout.fillWidth: true }
        }

        QQC2.Label {
            Layout.fillWidth: true
            Layout.maximumWidth: Kirigami.Units.gridUnit * 44
            wrapMode: Text.WordWrap
            visible: page.importStatus !== ""
            text: page.importStatus
            color: page.importHadError ? Kirigami.Theme.negativeTextColor
                                       : Kirigami.Theme.positiveTextColor
        }

        Kirigami.Separator { Layout.fillWidth: true }

        // ══════════════════ 学期 ══════════════════

        Kirigami.Heading {
            level: 3
            text: i18n("学期")
        }

        RowLayout {
            QQC2.Label {
                text: i18n("开学日：")
            }
            QQC2.TextField {
                id: termStartField
                Layout.preferredWidth: Kirigami.Units.gridUnit * 8
                placeholderText: "yyyy-MM-dd"
                text: page.termStart
                inputMethodHints: Qt.ImhDate | Qt.ImhPreferNumbers
                onEditingFinished: {
                    if (page.parsedStart) {
                        page.writeModel(function (m) { m.termStart = CM.isoOf(page.parsedStart); });
                    } else if (text.length === 0) {
                        page.writeModel(function (m) { m.termStart = ""; });
                    }
                    // 格式非法时不写入，下面的提示已经标红
                }
            }
            QQC2.Button {
                text: i18n("今天")
                onClicked: page.setTermStart(new Date())
            }
            QQC2.Button {
                text: i18n("本周一")
                onClicked: {
                    const d = new Date();
                    page.setTermStart(new Date(d.getFullYear(), d.getMonth(),
                                               d.getDate() - (CM.weekdayOf(d) - 1)));
                }
            }
            Item { Layout.fillWidth: true }
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 44
            wrapMode: Text.WordWrap
            color: page.startState === 1 ? Kirigami.Theme.negativeTextColor
                                         : Kirigami.Theme.textColor
            opacity: page.startState === 1 ? 1 : 0.75
            text: {
                if (page.startState === 0) {
                    return i18n("尚未设置开学日，周次无法对应到具体日期。导入 ICS 或 WakeUp 时会自动填上。");
                }
                if (page.startState === 1) {
                    return i18n("日期格式无效，请使用 yyyy-MM-dd，例如 2026-09-07。");
                }
                return page.todayWeek >= 1
                    ? i18n("今天是第 %1 周。第 1 周从 %2 开始（周一为一周之首）。",
                           page.todayWeek, CM.isoOf(CM.dateFromDayIndex(CM.mondayOf(page.parsedStart))))
                    : i18n("距离开学还有 %1 周。", 1 - page.todayWeek);
            }
        }

        RowLayout {
            QQC2.Label { text: i18n("学期总周数：") }
            QQC2.SpinBox {
                id: totalWeeksSpin
                from: 1
                to: 40
                value: page.totalWeeks
                onValueModified: page.writeModel(function (m) { m.totalWeeks = totalWeeksSpin.value; })
            }
            QQC2.Label {
                text: i18n("决定「下一周」按钮能翻到哪一周")
                opacity: 0.6
            }
            Item { Layout.fillWidth: true }
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 44
            wrapMode: Text.WordWrap
            opacity: 0.75
            text: i18n("作息时间表（每行一节，格式「节次号 开始-结束」，# 开头是注释）。" +
                       "网格的行数由这里的节数决定，当前 %1 节。", page.maxNode)
        }

        QQC2.ScrollView {
            Layout.preferredWidth: Kirigami.Units.gridUnit * 24
            Layout.preferredHeight: Kirigami.Units.gridUnit * 8

            QQC2.TextArea {
                id: periodsArea
                text: CM.periodsToText(page.periods)
                wrapMode: TextEdit.WrapAnywhere
                font.family: "monospace"
                onEditingFinished: {
                    const r = CM.parsePeriodsText(text);
                    if (r.errors.length > 0) {
                        periodsStatus.text = r.errors.join("\n");
                        periodsStatus.color = Kirigami.Theme.negativeTextColor;
                        return;
                    }
                    page.writeModel(function (m) { m.periods = r.periods; });
                    periodsStatus.text = i18n("✓ 已解析 %1 节。", r.periods.length);
                    periodsStatus.color = Kirigami.Theme.positiveTextColor;
                }
            }
        }

        QQC2.Label {
            id: periodsStatus
            Layout.maximumWidth: Kirigami.Units.gridUnit * 44
            wrapMode: Text.WordWrap
            visible: text !== ""
            opacity: 0.9
        }

        Kirigami.Separator { Layout.fillWidth: true }

        // ══════════════════ 课程列表 ══════════════════

        RowLayout {
            Layout.fillWidth: true
            Kirigami.Heading {
                level: 3
                text: i18n("课程")
                Layout.fillWidth: true
            }
            QQC2.Button {
                text: i18n("添加一节课")
                icon.name: "list-add"
                onClicked: page.addCourse()
            }
        }

        QQC2.Label {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            opacity: 0.75
            text: page.summary
        }

        QQC2.Label {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            opacity: 0.6
            font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
            text: i18n("周次写法：1-16（连续）、1,3,5（零散）、1-16单 / 1-16双（单双周），可混用。"
                       + "懒得算单双周就用右边的下拉框，它会按当前的起止周自动填。")
        }

        // 表格整体可以横向滚动：列宽是固定值，加起来可能比配置窗口宽
        QQC2.ScrollView {
            id: tableScroll
            Layout.fillWidth: true
            Layout.preferredHeight: tableInner.implicitHeight + Kirigami.Units.gridUnit * 0.8
            visible: page.courses.length > 0
            clip: true

            ColumnLayout {
                id: tableInner
                spacing: Kirigami.Units.smallSpacing

                GridLayout {
                    columns: 8
                    columnSpacing: Kirigami.Units.smallSpacing

                    QQC2.Label { Layout.preferredWidth: page.colName;    text: i18n("课程名"); opacity: 0.6 }
                    QQC2.Label { Layout.preferredWidth: page.colWeekday; text: i18n("星期");   opacity: 0.6 }
                    QQC2.Label { Layout.preferredWidth: page.colPeriod;  text: i18n("节次");   opacity: 0.6 }
                    QQC2.Label { Layout.preferredWidth: page.colWeeks;   text: i18n("周次");   opacity: 0.6 }
                    QQC2.Label { Layout.preferredWidth: page.colParity;  text: i18n("单双周"); opacity: 0.6 }
                    QQC2.Label { Layout.preferredWidth: page.colRoom;    text: i18n("地点");   opacity: 0.6 }
                    QQC2.Label { Layout.preferredWidth: page.colTeacher; text: i18n("教师");   opacity: 0.6 }
                    QQC2.Label { Layout.preferredWidth: page.colDelete;  text: "" }
                }

                Repeater {
                    model: page.courses

                    delegate: GridLayout {
                        id: courseRow
                        required property var modelData
                        required property int index

                        columns: 8
                        columnSpacing: Kirigami.Units.smallSpacing

                        QQC2.ComboBox {
                            Layout.preferredWidth: page.colName
                            editable: true
                            model: page.knownNames
                            currentIndex: Math.max(-1, page.knownNames.indexOf(modelData.name))
                            editText: modelData.name
                            onAccepted: page.setField(courseRow.index, "name", editText)
                            onActivated: page.setField(courseRow.index, "name", editText)
                        }

                        QQC2.ComboBox {
                            Layout.preferredWidth: page.colWeekday
                            model: page.weekdayChoices
                            currentIndex: modelData.weekday - 1
                            onActivated: page.setField(courseRow.index, "weekday", index + 1)
                        }

                        // 节次是一列：起 → 止。两个 SpinBox 都窄，配一个破折号
                        RowLayout {
                            Layout.preferredWidth: page.colPeriod
                            spacing: 2

                            QQC2.SpinBox {
                                Layout.fillWidth: true
                                from: 1
                                // 作息表还没填时也要能录入，所以给个下限，不然 SpinBox 会卡在 1
                                to: Math.max(12, page.periods.length)
                                value: modelData.startPeriod
                                onValueModified: page.setField(courseRow.index, "startPeriod", value)
                            }
                            QQC2.Label { text: "–"; opacity: 0.6 }
                            QQC2.SpinBox {
                                Layout.fillWidth: true
                                from: 1
                                to: Math.max(12, page.periods.length)
                                value: modelData.endPeriod
                                onValueModified: page.setField(courseRow.index, "endPeriod", value)
                            }
                        }

                        QQC2.TextField {
                            Layout.preferredWidth: page.colWeeks
                            text: CM.weeksDisplay(modelData)
                            placeholderText: i18n("1-16")
                            onEditingFinished: page.setWeeks(courseRow.index, text)
                        }

                        // 单双周：纯快捷方式，不另存状态 —— 选项由周次本身推出来，
                        // 选一下就把当前的起止周重排成单周或双周。
                        QQC2.ComboBox {
                            Layout.preferredWidth: page.colParity
                            textRole: "text"
                            model: [
                                { text: i18n("每周"),   value: 0 },
                                { text: i18n("仅单周"), value: 1 },
                                { text: i18n("仅双周"), value: 2 }
                            ]
                            currentIndex: CM.parityOf(modelData.weeks)
                            onActivated: function (index) {
                                page.setParity(courseRow.index, model[index].value);
                            }
                        }

                        QQC2.TextField {
                            Layout.preferredWidth: page.colRoom
                            text: modelData.room
                            placeholderText: i18n("教学楼-教室")
                            onEditingFinished: page.setField(courseRow.index, "room", text)
                        }

                        QQC2.TextField {
                            Layout.preferredWidth: page.colTeacher
                            text: modelData.teacher
                            onEditingFinished: page.setField(courseRow.index, "teacher", text)
                        }

                        QQC2.Button {
                            Layout.preferredWidth: page.colDelete
                            icon.name: "edit-delete"
                            display: QQC2.AbstractButton.IconOnly
                            onClicked: page.removeCourse(courseRow.index)
                            QQC2.ToolTip.text: i18n("删除这一节")
                            QQC2.ToolTip.visible: hovered
                        }
                    }
                }
            }
        }

        Kirigami.Separator { Layout.fillWidth: true }

        // ══════════════════ 当前课表原文（留档） ══════════════════

        Kirigami.Heading {
            level: 4
            text: i18n("当前课表数据")
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 44
            wrapMode: Text.WordWrap
            opacity: 0.75
            text: i18n("可全选复制留档。换机器时把这段贴回「课表」页的任意导入框是导不进来的，"
                       + "建议连同原始 .ics / 备份文件一起保存。")
        }

        QQC2.ScrollView {
            Layout.fillWidth: true
            Layout.preferredHeight: Kirigami.Units.gridUnit * 5

            QQC2.TextArea {
                id: dataView
                readOnly: true
                wrapMode: TextEdit.WrapAnywhere
                font.family: "monospace"
                text: dataHolder.text
            }
        }
    }
}

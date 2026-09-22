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
import org.kde.plasma.core as PlasmaCore
import org.kde.ksvg 1.0 as KSvg
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

import "coursemodel.js" as CM
import "holidays.js" as Holidays
import "holidays-update.js" as HolidaysNet

PlasmoidItem {
    id: root

    /*
     * 背景由组件自己画，所以设成 NoBackground。
     * Plasma 默认那个背景板的不透明度是改不了的，而设置里要给出可调的不透明度，
     * 只能把背景拿过来自己画一层（见 fullRepresentation 里的 bg）。
     * 代价是组件右键菜单里 Plasma 那个「背景」开关不再起作用 —— 配置页里有等效且更细的控制。
     */
    Plasmoid.backgroundHints: PlasmaCore.Types.NoBackground

    /*
     * 色组要显式指定成 Window。
     * widgets/background 那个 SVG 是按颜色方案上色的（里面的 ColorScheme-Background），
     * 不指定色组时 applet 默认落在 View 上，背景会解析成白色 —— 而桌面容器的
     * BasicAppletContainer 用的正是 Kirigami.Theme.Window，两边必须一致才看得出是同一块板。
     */
    Kirigami.Theme.inherit: false
    Kirigami.Theme.colorSet: Kirigami.Theme.Window

    // 首次拖到桌面时的默认尺寸。必须写在根上 —— 只写在 fullRepresentation 里
    // 桌面容器不会采用（会按渲染出的最小尺寸给，网格被压成 0 高）。
    // 一周 7 列、一学期十来节，宽 860 高 540 是三行文字都能看清的下限。
    implicitWidth: 860
    implicitHeight: 540

    // 显示样式。认不出来的值一律当周网格，免得配置被手改坏之后什么都不显示。
    readonly property string viewStyle: {
        var v = Plasmoid.configuration.viewStyle;
        if (v === "today" || v === "upcoming" || v === "next") {
            return v;
        }
        return "week";
    }

    // 列表卡片的布局。同样对认不出来的值兜底 —— 配置被手改坏时退回默认卡片。
    readonly property string cardLayout: {
        var v = Plasmoid.configuration.cardLayout;
        if (v === "compact" || v === "timeline") {
            return v;
        }
        return "card";
    }

    // 课程卡片底色的不透明度（0..1）。
    // 注意这里不能用 `Number(x) || 100`：0 是合法取值，会被 || 吞掉。
    readonly property real cardOpacity: {
        var v = Number(Plasmoid.configuration.cardOpacity);
        if (!isFinite(v)) {
            v = 100;
        }
        return Math.max(0, Math.min(100, Math.round(v))) / 100;
    }


    // ══════════════════ 数据 ══════════════════

    readonly property var timetable: CM.parseModel(Plasmoid.configuration.timetableData)
    property var holidayCache: HolidaysNet.parseCache(Plasmoid.configuration.holidayCache)

    readonly property bool holidaysOn: Plasmoid.configuration.markHolidays
    readonly property bool hasCourses: (timetable.courses || []).length > 0

    // ══════════════════ 时间与周次 ══════════════════

    // 本机时钟的原始读数，定时刷新。显示用的时间见 today。
    property date localNow: new Date()
    // 0 = 跟随今天；>0 = 用户翻到的那一周
    property int shownWeek: 0

    // 联网测出的「本机时钟偏差」（秒）。用户把系统时间改早几周时，
    // 课表仍按真实时间显示，否则看到的会是错的那一周的课。
    readonly property int clockOffsetSec: Plasmoid.configuration.clockOffsetSec
    readonly property bool clockAdjusted: clockOffsetSec !== 0
    readonly property int clockSkewDays: Math.round(clockOffsetSec / 86400)
    property bool clockChecking: false

    // 显示用的「现在」。本机时钟正常时它就是本机时间；
    // 被改过且联网测出了差值时，用本机时间加上差值 —— 本机时钟的走时是准的，
    // 不准的只是偏移量，所以加一次就够了，断网也不会退回错误时间。
    readonly property date today: CM.applyClockOffset(localNow, clockOffsetSec)

    // 今天的实际周次，不夹紧：早于开学 <= 0，学期结束后 > totalWeeks
    readonly property int rawWeekOfToday: CM.weekOf(timetable, today)
    readonly property int totalWeeks: Math.max(1, Math.round(Number(timetable.totalWeeks) || 20))
    // 列表样式里显示多少门课。夹在 1..10：填 0 会什么都不显示，填太大塞不下。
    readonly property int upcomingCount:
        Math.max(1, Math.min(10, Math.round(Number(Plasmoid.configuration.upcomingCount) || 3)))
    readonly property bool termScheduled: timetable.termStart !== ""
    readonly property bool termEnded: termScheduled && rawWeekOfToday > totalWeeks
    readonly property bool termNotStarted: termScheduled && rawWeekOfToday < 1

    /*
     * 显示的周次永远夹在 [1, totalWeeks] 里。
     * 学期结束后「跟随今天」会算出第 25 周这种学期外的周次，网格会是一片空白 ——
     * 夹到最后一周末尾更合理，再配一条「本学期已结束」的说明。
     * 下一周按钮本来就以 totalWeeks 为上限，所以也翻不出去。
     */
    readonly property int defaultWeek: Math.min(Math.max(1, rawWeekOfToday), totalWeeks)
    readonly property int shownWeekNumber: Math.min(
        Math.max(1, shownWeek > 0 ? shownWeek : defaultWeek), totalWeeks)

    // 工具条上跟在「第 N 周」后面的说明
    readonly property string termNotice: {
        if (!termScheduled) {
            return "";
        }
        if (termEnded) {
            return "（本学期已结束）";
        }
        if (termNotStarted) {
            return "（尚未开学）";
        }
        return shownWeekNumber === defaultWeek ? "（本周）" : "";
    }

    readonly property int periodRows: Math.max(1, CM.rowCount(timetable))

    readonly property string weekdayHeader: "一二三四五六日"

    Timer {
        // 跨天要换高亮、跨节要换「下一节」，一分钟一次足够
        interval: 60 * 1000
        running: true
        repeat: true
        onTriggered: root.localNow = new Date()
    }

    // 定期把本机时钟和网络时间对一次。用户改了系统时间、或者这台机器长期
    // 没对过时，靠这个把课表拉回真实时间。
    Timer {
        interval: 6 * 60 * 60 * 1000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.checkClock()
    }

    /*
     * 测一次本机时钟偏差。
     * 偏差小于一天就不动：那多半只是走时漂移，校正反而让人困惑。
     * 断网（serverIso 为空）时维持原先的偏差，不退回本机时间 ——
     * 之前测出来的差值依然成立，本机时钟的走时是准的。
     */
    function checkClock() {
        if (clockChecking) {
            return;
        }
        clockChecking = true;
        HolidaysNet.fetchServerTime(function (serverIso) {
            clockChecking = false;
            // null = 没网，维持原值；不清掉已有校正
            var offset = CM.clockOffsetToStore(serverIso, new Date());
            if (offset !== null) {
                Plasmoid.configuration.clockOffsetSec = offset;
            }
        });
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
        // 用校正后的时间做年份判断，本机时间被改过也不会取错年份
        var now = root.today;
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
     * 某天的节假日状态。
     *   休 → off，当天不排课
     *   班 → status 是 { type: "work" }，只在表头标出来提示，课表照常按当天星期几显示
     */
    function resolveDay(week, weekday) {
        var date = CM.dateOf(timetable, week, weekday);
        if (!date || !holidaysOn) {
            return { off: false, status: null, date: date };
        }
        var st = holidayStatus(date);
        if (st && st.type === "off") {
            return { off: true, status: st, date: date };
        }
        return { off: false, status: st, date: date };
    }

    /*
     * 显示的这一周是不是「本周」。
     * 学期结束后根本不存在本周（今天不在学期里的任何一周），此时为假 ——
     * 于是整张表都会被标成「非本周」，免得那些课看起来还像要去上的。
     */
    readonly property bool viewingCurrentWeek: !termEnded && !termNotStarted
        && shownWeekNumber === defaultWeek

    // 某一格的课。includeOffWeek 为真时连「这一周不上」的课也返回（带 meets 标记）。
    function slotsAt(week, weekday, includeOffWeek) {
        if (resolveDay(week, weekday).off) {
            return [];      // 放假当天不排课
        }
        return CM.slotsOn(timetable, week, weekday, includeOffWeek);
    }

    function coursesAt(week, weekday) {
        var list = slotsAt(week, weekday, false);
        var out = [];
        for (var i = 0; i < list.length; i++) {
            out.push(list[i].course);
        }
        return out;
    }

    // ══════════════════ 列表样式用的数据（今日 / 接下来 / 下一节） ══════════════════

    // 某一天要上的课。学期之外、或者放假当天，都返回空 ——
    // 「不用上课」这件事在列表样式里表现为「那天没课」，不需要另外标灰。
    function dayCards(date) {
        var week = CM.weekOf(timetable, date);
        if (week < 1 || week > totalWeeks) {
            return [];
        }
        var wd = CM.weekdayOf(date);
        if (resolveDay(week, wd).off) {
            return [];
        }
        return CM.cardsForDay(timetable, week, wd);
    }

    // 从今天起往后找 limit 节，跨天。今天已经上完的不算。
    function upcomingCards(limit) {
        var out = [];
        var nowMin = today.getHours() * 60 + today.getMinutes();
        var base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        for (var step = 0; step < 21 && out.length < limit; step++) {
            var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + step);
            var list = dayCards(d);
            for (var i = 0; i < list.length; i++) {
                var c = list[i];
                if (step === 0 && c.endMinutes >= 0 && c.endMinutes <= nowMin) {
                    continue;
                }
                // 逐字段抄出来，不用 for-in 反射 —— QML 把对象转成 QVariantMap 之后，
                // hasOwnProperty 那类判断会静默失效（这个坑踩过一次）。
                // tagCards 顺手把 sameDay / dayLabel / 日期补齐，样式组件不用猜字段在不在。
                out.push(CM.tagCards([c], base, d)[0]);
                if (out.length >= limit) {
                    break;
                }
            }
        }
        return out;
    }

    /*
     * 「今日课程」的数据。
     * 今天还有没上的课就平铺今天的；今天的都上完了就退而显示最近的三门
     * （不一定是明天 —— 明天可能也没课），一天课上完之后恰恰是最想知道
     * 「接下来还有什么」的时候，这时候把组件空掉反而不合适。
     * 往后这几节都带日期（「明天」「下周三 9/30」），同一门课的相邻两次
     * 不会再看混。
     *
     * 到了那天会自动变成当天的课表：这里依赖 today，而 today 每分钟刷新，
     * 所以跨天后 dayCards(today) 自然就非空了。
     */
    readonly property var todayView: {
        var nowMin = today.getHours() * 60 + today.getMinutes();
        var remaining = CM.remainingCards(dayCards(today), nowMin);
        if (remaining.length > 0) {
            return {
                mode: "today",
                cards: CM.tagCards(remaining, today, today),
                header: CM.dayTitle(today),
                subheader: ""
            };
        }
        var next = upcomingCards(upcomingCount);
        if (next.length > 0) {
            return {
                mode: "future",
                cards: next,
                header: "今天没有课了",
                subheader: "接下来的课"
            };
        }
        return { mode: "empty", cards: [], header: CM.dayTitle(today), subheader: "" };
    }

    readonly property var upcomingList: upcomingCards(upcomingCount)

    readonly property var nextUp: upcomingCards(1)
    readonly property var nextCard: nextUp.length > 0 ? nextUp[0] : null
    readonly property bool nextActive: {
        var c = nextCard;
        if (!c || !c.sameDay) {
            return false;
        }
        var m = today.getHours() * 60 + today.getMinutes();
        return c.startMinutes >= 0 && c.endMinutes > c.startMinutes
            && m >= c.startMinutes && m < c.endMinutes;
    }
    readonly property string nextCountdown: {
        var c = nextCard;
        if (!c) {
            return "";
        }
        var m = today.getHours() * 60 + today.getMinutes();
        var mins = 0;
        var tail = "";
        if (nextActive) {
            mins = c.endMinutes - m;
            tail = "后下课";
        } else if (c.sameDay && c.startMinutes > m) {
            mins = c.startMinutes - m;
            tail = "后开始";
        } else {
            // 跨天的课带上日期：「下周三」和「周三」只差一个「下」字，
            // 光看星期几分不清是这周的课还是下周的
            var when = (c.sameDay ? "今天" : c.dayLabel) + " " + c.dateText;
            return c.start !== "" ? when + " " + c.start + " 开始" : when + " 有课";
        }
        var txt = mins >= 60
            ? (Math.floor(mins / 60) + " 小时 " + (mins % 60) + " 分")
            : (mins + " 分钟");
        return txt + tail;
    }

    // 列表样式没课可显示时的说明：要区分「今天没课」和「整个学期都没课」
    readonly property string listEmptyText: {
        if (!hasCourses) {
            return "还没有课程\n右键组件 → 配置课程表";
        }
        if (termNotStarted) {
            return "尚未开学";
        }
        if (termEnded) {
            return "本学期已结束";
        }
        var r = resolveDay(defaultWeek, CM.weekdayOf(today));
        if (r.status && r.status.type === "off") {
            return "放假：" + r.status.name;
        }
        return "今天没有课";
    }

    // 当前显示的这一周里、所有要画出来的课程块
    readonly property var cellCourses: {
        var out = [];
        var withOffWeek = Plasmoid.configuration.showOffWeekCourses;
        for (var wd = 1; wd <= 7; wd++) {
            var list = slotsAt(shownWeekNumber, wd, withOffWeek);
            for (var i = 0; i < list.length; i++) {
                out.push({
                    course: list[i].course,
                    weekday: wd,
                    // 灰显的两种情形：这一周不上这门课，或者现在看的压根不是本周
                    dim: !list[i].meets || !viewingCurrentWeek
                });
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
        if (termNotStarted) {
            // 差得太多就不报数字了：本机时间被改早几年会算出「还有 350 周」这种
            var weeks = 1 - rawWeekOfToday;
            return {
                label: "尚未开学",
                detail: weeks > 52 ? "开学日期或本机时间可能有误" : "开学还有 " + weeks + " 周",
                active: false
            };
        }
        if (termEnded) {
            return { label: "本学期已结束", detail: "", active: false };
        }
        // 面板回答的是「现在上什么」，所以永远按今天所在的那一周算，不跟
        // 桌面上的「第 N 周」浏览状态走 —— 翻到别的周时会把那周的同一时段
        // 的课报成「正在上」，那是假的
        var wd = CM.weekdayOf(today);
        var list = coursesAt(defaultWeek, wd);
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
        var r = resolveDay(defaultWeek, wd);
        if (r.status && r.status.type === "off") {
            return { label: "放假", detail: r.status.name, active: false };
        }
        // 今天没课了就把往后最近的一节报出来 —— 桌面上的列表就是这么做的，
        // 面板只说一句「今天没课了」会让两边对不上，看着像有一个坏了
        var up = upcomingCards(1);
        if (up.length > 0) {
            var n = up[0];
            return {
                label: n.name,
                detail: (n.sameDay ? "今天" : n.dayLabel) + " " + n.start,
                active: false
            };
        }
        return { label: "今天没课了", detail: "", active: false };
    }

    readonly property var panelInfo: nextClass()

    compactRepresentation: Item {
        id: compact

        // 面板取尺寸用的是 Layout.* 附加属性，不是 implicitWidth/Height ——
        // 内置的 showdesktop / systemtray / 数字时钟都是这么声明的。
        // 只写 implicit 的话面板会按默认的小方块（28×28）给它，内容全挤没了。
        readonly property real contentWidth: compactRow.implicitWidth + Kirigami.Units.smallSpacing * 2
        Layout.minimumWidth: Kirigami.Units.gridUnit * 4
        Layout.preferredWidth: contentWidth
        Layout.minimumHeight: compactRow.implicitHeight
        Layout.preferredHeight: compactRow.implicitHeight
        implicitWidth: contentWidth
        implicitHeight: compactRow.implicitHeight

        // 被压窄时内容跟着缩，文字的 elide 才生效；用 anchors.centerIn 保持原宽居中
        // 会让内容溢到面板外面去。
        RowLayout {
            id: compactRow
            anchors.fill: parent
            spacing: Kirigami.Units.smallSpacing

            PlasmaComponents.Label {
                text: root.panelInfo.active ? "●" : "○"
                color: root.panelInfo.active ? Kirigami.Theme.positiveTextColor
                                             : Kirigami.Theme.textColor
            }
            PlasmaComponents.Label {
                Layout.fillWidth: true
                text: root.panelInfo.label
                font.bold: true
                elide: Text.ElideRight
            }
            PlasmaComponents.Label {
                Layout.maximumWidth: implicitWidth
                text: root.panelInfo.detail
                opacity: 0.7
                elide: Text.ElideRight
                visible: text !== ""
            }
        }

        MouseArea {
            anchors.fill: parent
            onClicked: root.expanded = !root.expanded
            // 面板上位置小，时间被校正过这件事放提示里说
            PlasmaComponents.ToolTip.text: root.clockAdjusted
                ? ("本机时间与网络时间相差约 " + root.clockSkewDays
                   + " 天，课表已按网络时间显示。建议校正系统时间。")
                : ""
            PlasmaComponents.ToolTip.visible: containsMouse && text !== ""
        }
    }

    // ══════════════════ 桌面上的周网格 ══════════════════

    fullRepresentation: Item {
        implicitWidth: Kirigami.Units.gridUnit * 30
        implicitHeight: Kirigami.Units.gridUnit * 21

        /*
         * 自己画的背景，用桌面主题的 widgets/background 边框 —— 桌面容器画的
         * applet 背景就是它（desktopcontainment 的 ConfigOverlay 里用的同一个），
         * 所以外观和原来一致。用普通 Rectangle 配 Kirigami.Theme.backgroundColor
         * 会画出一块浅色板，和主题对不上。
         *
         * 这里用 opacity 是安全的：这个项没有子项，不像 Item.opacity 会把内容一起变淡。
         */
        KSvg.FrameSvgItem {
            id: bg
            anchors.fill: parent
            imagePath: "widgets/background"
            opacity: Math.max(0, Math.min(100, Plasmoid.configuration.backgroundOpacity)) / 100
        }

        // 列表类样式。「周网格」内联在下面（它和工具条、网格共用一套状态，
        // 拆出去反而要来回传一堆函数）。
        // 留白比周网格大一档：卡片是独立的一块块，贴着组件边框会显得憋。
        // 主题给的 largeSpacing 只有 8（units 是随字号缩的），再放大一半。
        Loader {
            anchors.fill: parent
            anchors.margins: Kirigami.Units.largeSpacing * 1.5
            active: root.viewStyle !== "week"
            visible: active
            sourceComponent: {
                switch (root.viewStyle) {
                case "today":
                    return styleTodayComponent;
                case "upcoming":
                    return styleUpcomingComponent;
                case "next":
                    return styleNextComponent;
                }
                return null;
            }
        }

        Component {
            id: styleTodayComponent
            StyleToday {
                mode: root.todayView.mode
                cards: root.todayView.cards
                header: root.todayView.header
                subheader: root.todayView.subheader
                cardLayout: root.cardLayout
                cardOpacity: root.cardOpacity
                now: root.today
                emptyText: root.listEmptyText
            }
        }

        Component {
            id: styleUpcomingComponent
            StyleUpcoming {
                cards: root.upcomingList
                cardLayout: root.cardLayout
                cardOpacity: root.cardOpacity
                now: root.today
                emptyText: root.listEmptyText
            }
        }

        Component {
            id: styleNextComponent
            StyleNext {
                card: root.nextCard
                countdown: root.nextCountdown
                active: root.nextActive
                cardOpacity: root.cardOpacity
                emptyText: root.listEmptyText
            }
        }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing
            visible: root.viewStyle === "week"

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
                    text: root.termNotice
                    opacity: root.termEnded || root.termNotStarted ? 0.9 : 0.6
                    visible: text !== ""
                }

                // 时间被校正过就明确说出来：否则用户会觉得「组件显示的日期和系统时钟对不上」
                PlasmaComponents.Label {
                    visible: root.clockAdjusted
                    text: "⚠ 时间已校正"
                    color: Kirigami.Theme.neutralTextColor
                    HoverHandler { id: clockHover }
                    PlasmaComponents.ToolTip.text:
                        "本机时间与网络时间相差约 " + root.clockSkewDays + " 天，"
                        + "课表已按网络时间显示。建议校正系统时间。"
                    PlasmaComponents.ToolTip.visible: clockHover.hovered
                }

                Item { Layout.fillWidth: true }

                PlasmaComponents.Button {
                    // 学期结束后「本周」不存在了，这个按钮的落点变成最后一周
                    text: root.termEnded ? "回到最后一周" : "回到本周"
                    visible: root.shownWeek > 0 && root.shownWeekNumber !== root.defaultWeek
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
                        readonly property bool dim: modelData.dim === true
                        readonly property int firstRow: gridArea.rowFor(course.startPeriod)
                        readonly property int lastRow: Math.max(firstRow, gridArea.rowFor(course.endPeriod))
                        readonly property color blockColor: {
                            var c = course.color ? course.color : Kirigami.Theme.highlightColor;
                            return dim ? CM.dimColor(c) : c;
                        }
                        readonly property color blockText: CM.textColorFor(blockColor)
                        // 去掉上下各 3px 的内边距后真正能放字的高度
                        readonly property real inner: Math.max(0, height - 6)

                        x: gridArea.labelWidth + (modelData.weekday - 1) * gridArea.colWidth + 1
                        y: gridArea.headerHeight + firstRow * gridArea.rowHeight + 1
                        width: Math.max(1, gridArea.colWidth - 2)
                        height: Math.max(1, (lastRow - firstRow + 1) * gridArea.rowHeight - 2)
                        radius: 3
                        color: blockColor
                        // 灰显的块整体再压一点，跟「本周要上」的分得更开
                        opacity: dim ? 0.75 : 1
                        clip: true

                        Column {
                            id: blockCol
                            anchors.fill: parent
                            anchors.margins: 3
                            spacing: 0
                            clip: true

                            /*
                             * 「非本周」占掉一整行，所以正文可用的高度要先扣掉它，
                             * 下面「放不下就省略」的判断都按扣完的高度算。
                             * 早先把它做成右下角浮层，结果和地点/教师叠在一起糊成一片 ——
                             * 一节高的块里根本挤不下第四行。
                             */
                            readonly property bool showBadge:
                                block.dim && block.width >= badgeLabel.implicitWidth + 6
                            readonly property real badgeHeight:
                                showBadge ? Kirigami.Units.gridUnit * 0.85 : 0
                            readonly property real textHeight:
                                Math.max(0, block.inner - badgeHeight)
                            readonly property bool roomFits: textHeight > Kirigami.Units.gridUnit * 2.4
                            readonly property bool teacherFits: textHeight > Kirigami.Units.gridUnit * 3.6

                            // 用标签自己的宽度判定，别拍脑袋算阈值 ——
                            // 各主题的 gridUnit 和字号都不一样，猜出来的数只会让角标
                            // 在某些主题下莫名消失。放不下就不显示，靠灰显本身表达；
                            // 也不写「【非本周】」的方括号，五个字在窄块里会省略成「【非本…」。
                            PlasmaComponents.Label {
                                id: badgeLabel
                                width: blockCol.width
                                visible: blockCol.showBadge
                                text: "非本周"
                                color: block.blockText
                                opacity: 0.8
                                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize - 2)
                                elide: Text.ElideRight
                            }
                            PlasmaComponents.Label {
                                width: blockCol.width
                                text: block.course.name
                                color: block.blockText
                                font.bold: true
                                font.pointSize: blockCol.textHeight < Kirigami.Units.gridUnit * 1.8
                                    ? Math.max(6, Kirigami.Theme.defaultFont.pointSize - 2)
                                    : Kirigami.Theme.defaultFont.pointSize
                                wrapMode: Text.Wrap
                                maximumLineCount: blockCol.textHeight < Kirigami.Units.gridUnit * 1.8 ? 1 : 2
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

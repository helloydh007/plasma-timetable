/*
 * 配置页：节假日
 *
 * 只管节假日本身：标记开关、数据来源与更新、以及**调休上班日按哪天的课表上课**。
 *
 * 为什么调休安排在这一页而不在课程页：
 * 调休日的清单来自节假日数据（内置表 + 联网缓存），只有这一页看得到；
 * 而它又不能和课表模型共用一个配置键 —— KCM 的每一页各自持有 cfg_ 属性的副本，
 * 两个页写同一个键会互相覆盖。所以它单独存成 workAsData。
 *
 * 国务院通知只说哪天补班，不说补哪天的课（那是各校自己定的），
 * 所以这里必须让用户逐个指定，默认按当天本身的星期几。
 */

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kcmutils as KCMUtils
import org.kde.kirigami as Kirigami

import "coursemodel.js" as CM
import "holidays.js" as Holidays
import "holidays-update.js" as HolidaysNet

KCMUtils.SimpleKCM {
    id: page

    signal configurationChanged()

    property alias cfg_markHolidays: markSwitch.checked
    property alias cfg_holidayUpdateMode: modeHolder.text
    property alias cfg_holidayCache: cacheHolder.text
    property alias cfg_workAsData: workAsHolder.text

    QQC2.TextField { id: modeHolder; visible: false; width: 0; height: 0 }
    QQC2.TextField { id: cacheHolder; visible: false; width: 0; height: 0 }
    QQC2.TextField { id: workAsHolder; visible: false; width: 0; height: 0 }

    property bool alive: true
    Component.onDestruction: alive = false

    property bool updating: false
    property string updateStatus: ""
    property bool updateHadError: false

    readonly property var workAs: CM.parseWorkAs(workAsHolder.text)

    readonly property string coverageText: {
        const builtin = Holidays.COVERED_YEARS;
        const cached = Object.keys(HolidaysNet.parseCache(cacheHolder.text).years).sort();
        let t = i18n("内置数据：%1", builtin.length
            ? builtin[0] + "–" + builtin[builtin.length - 1] : i18n("无"));
        t += cached.length ? i18n("；联网获取：%1", cached.join("、")) : i18n("；联网获取：无");
        return t;
    }

    // 内置表 + 联网缓存里所有的补班日
    function collectWorkDays() {
        var out = [];
        var seen = {};
        function add(map) {
            for (var k in (map || {})) {
                if (Object.prototype.hasOwnProperty.call(map, k) && !seen[k]) {
                    seen[k] = true;
                    out.push({ date: k, name: map[k] });
                }
            }
        }
        add(Holidays.WORK);
        const cache = HolidaysNet.parseCache(cacheHolder.text);
        for (var y in cache.years) {
            add((cache.years[y] || {}).work);
        }
        out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        return out;
    }

    readonly property var workDays: collectWorkDays()

    function setWorkAs(isoDate, value) {
        var cur = CM.parseWorkAs(workAsHolder.text);
        var m = {};
        for (var k in cur) {
            if (Object.prototype.hasOwnProperty.call(cur, k)) {
                m[k] = cur[k];
            }
        }
        if (value < 0) {
            delete m[isoDate];      // -1 = 未设置，不写进配置，省得攒一堆无意义的条目
        } else {
            m[isoDate] = value;
        }
        workAsHolder.text = CM.serializeWorkAs(m);
        page.configurationChanged();
    }

    function startUpdate() {
        page.updating = true;
        page.updateStatus = i18n("正在检查…");
        const cache = HolidaysNet.parseCache(cacheHolder.text);
        HolidaysNet.runUpdate(cache, new Date(), Holidays.COVERED_YEARS,
            function (msg) {
                if (page.alive) {
                    page.updateStatus = msg;
                }
            },
            function (result) {
                if (!page.alive) {
                    return;
                }
                page.updating = false;
                page.updateHadError = result.failed.length > 0;
                let txt = result.messages.join("\n");
                if (result.fetched.length === 0 && result.failed.length === 0) {
                    txt += "\n" + i18n("当前数据已是最新，无需处理。");
                }
                if (result.fetched.length > 0) {
                    cacheHolder.text = HolidaysNet.serializeCache(result.cache);
                    page.configurationChanged();
                    txt += "\n" + i18n("✓ 已获取 %1 年数据，请点「应用」保存后生效。",
                                        result.fetched.join("、"));
                }
                page.updateStatus = txt;
            });
    }

    Kirigami.FormLayout {
        QQC2.Switch {
            id: markSwitch
            Kirigami.FormData.label: i18n("法定节假日：")
            text: i18n("放假不排课，调休日标记「班」")
            onToggled: page.configurationChanged()
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 34
            wrapMode: Text.WordWrap
            opacity: 0.75
            text: i18n("放假安排由国务院逐年发文规定（含调休），无法由历法推算，故使用数据表。")
        }

        QQC2.ComboBox {
            id: modeCombo

            Kirigami.FormData.label: i18n("更新方式：")
            textRole: "text"
            model: [
                { text: i18n("手动（默认）"), value: "manual" },
                { text: i18n("自动（每 30 天检查一次）"), value: "auto" }
            ]
            currentIndex: Math.max(0, model.findIndex(function (x) {
                return x.value === modeHolder.text;
            }))
            onActivated: function (index) {
                modeHolder.text = model[index].value;
                page.configurationChanged();
            }
        }

        RowLayout {
            Kirigami.FormData.label: i18n("节假日数据：")

            QQC2.Button {
                text: page.updating ? i18n("更新中…") : i18n("立即更新")
                enabled: !page.updating
                onClicked: page.startUpdate()
            }
            QQC2.BusyIndicator {
                running: page.updating
                visible: running
                implicitWidth: Kirigami.Units.iconSizes.small
                implicitHeight: Kirigami.Units.iconSizes.small
            }
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 34
            wrapMode: Text.WordWrap
            opacity: 0.75
            text: page.coverageText
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 36
            wrapMode: Text.WordWrap
            visible: page.updateStatus !== ""
            text: page.updateStatus
            color: page.updateHadError ? Kirigami.Theme.negativeTextColor
                 : (text.indexOf("✓") >= 0 ? Kirigami.Theme.positiveTextColor
                                           : Kirigami.Theme.textColor)
        }

        Kirigami.Separator {
            Layout.fillWidth: true
            Kirigami.FormData.isSection: true
            Kirigami.FormData.label: i18n("调休日上课安排")
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 36
            wrapMode: Text.WordWrap
            opacity: 0.75
            visible: page.workDays.length > 0
            text: i18n("国家只规定哪天补班，不规定补哪天的课，各校不同，所以需要你指定。"
                       + "默认按当天本身的星期几上课。")
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 36
            wrapMode: Text.WordWrap
            opacity: 0.75
            visible: page.workDays.length === 0
            text: i18n("当前数据里没有调休上班日。")
        }

        Repeater {
            model: page.workDays

            delegate: RowLayout {
                id: workRow
                required property var modelData

                Kirigami.FormData.label: modelData.date

                QQC2.Label {
                    text: i18n("补 %1 的班", workRow.modelData.name)
                    opacity: 0.7
                }

                QQC2.ComboBox {
                    textRole: "text"
                    model: {
                        var m = [
                            { text: i18n("按当天（%1）",
                              CM.weekdayLabel(CM.weekdayOf(CM.parseIsoDate(workRow.modelData.date)))), value: -1 },
                            { text: i18n("不排课"), value: 0 }
                        ];
                        for (var i = 1; i <= 7; i++) {
                            m.push({ text: i18n("按周%1的课表", CM.weekdayNames()[i - 1]), value: i });
                        }
                        return m;
                    }
                    currentIndex: {
                        var cur = Object.prototype.hasOwnProperty.call(page.workAs, workRow.modelData.date)
                            ? page.workAs[workRow.modelData.date] : -1;
                        for (var i = 0; i < model.length; i++) {
                            if (model[i].value === cur) {
                                return i;
                            }
                        }
                        return 0;
                    }
                    onActivated: function (index) {
                        page.setWorkAs(workRow.modelData.date, model[index].value);
                    }
                }
            }
        }
    }
}

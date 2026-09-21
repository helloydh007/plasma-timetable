/*
 * 配置页：节假日
 *
 * 三件事：节假日标记开关、数据来源与更新、数据覆盖情况。
 *
 * 「休」日不排课；「班」日只在表头标出来提示，课表照常按当天本身的星期几显示 ——
 * 调休到底补哪一天的课各校不同，不做猜测。课表本身的设置（开学日、作息时间表、
 * 课程）都在课程页，因为那些字段和课程存在同一个配置键里（详见 configCourses.qml）。
 */

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kcmutils as KCMUtils
import org.kde.kirigami as Kirigami

import "holidays.js" as Holidays
import "holidays-update.js" as HolidaysNet

KCMUtils.SimpleKCM {
    id: page

    signal configurationChanged()

    property alias cfg_markHolidays: markSwitch.checked
    property alias cfg_holidayUpdateMode: modeHolder.text
    property alias cfg_holidayCache: cacheHolder.text

    QQC2.TextField { id: modeHolder; visible: false; width: 0; height: 0 }
    QQC2.TextField { id: cacheHolder; visible: false; width: 0; height: 0 }

    property bool alive: true
    Component.onDestruction: alive = false

    property bool updating: false
    property string updateStatus: ""
    property bool updateHadError: false

    readonly property string coverageText: {
        const builtin = Holidays.COVERED_YEARS;
        const cached = Object.keys(HolidaysNet.parseCache(cacheHolder.text).years).sort();
        let t = i18n("内置数据：%1", builtin.length
            ? builtin[0] + "–" + builtin[builtin.length - 1] : i18n("无"));
        t += cached.length ? i18n("；联网获取：%1", cached.join("、")) : i18n("；联网获取：无");
        return t;
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
            text: i18n("放假安排由国务院逐年发文规定（含调休），无法由历法推算，故使用数据表。\n"
                       + "「休」日不排课；「班」日只在表头标出来提示，课表仍按当天本身的星期几显示 —— "
                       + "调休补哪一天的课各校不同，不做猜测。")
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
    }
}

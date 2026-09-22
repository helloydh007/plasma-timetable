/*
 * 配置页：外观
 *
 * 显示样式和背景不透明度。都是纯显示选项，和课表数据无关，
 * 所以单独一页，也不会和别的页抢同一个配置键。
 */

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kcmutils as KCMUtils
import org.kde.kirigami as Kirigami

KCMUtils.SimpleKCM {
    id: page

    signal configurationChanged()

    property alias cfg_viewStyle: styleHolder.text
    property alias cfg_backgroundOpacity: opacitySlider.value

    // 不展示，仅作为 cfg_ 的载体
    QQC2.TextField { id: styleHolder; visible: false; width: 0; height: 0 }

    // 每种样式配一句说明，选的时候就知道长什么样
    readonly property var styles: [
        { value: "week",     name: i18n("周网格"),
          hint: i18n("七列 × 节次的整周课表。要一眼看全一周、或者排计划时用它。") },
        { value: "today",    name: i18n("今日课程"),
          hint: i18n("只列今天的课，一行一门、字号大。桌面上一瞥就够用。") },
        { value: "upcoming", name: i18n("接下来"),
          hint: i18n("从今天起往后排的几节课，跨天时标出「明天」「后天」。") },
        { value: "next",     name: i18n("下一节"),
          hint: i18n("只显示当前或接下来那一节，大字加倒计时。占地方最小。") }
    ]

    readonly property int styleIndex: {
        for (var i = 0; i < styles.length; i++) {
            if (styles[i].value === styleHolder.text) {
                return i;
            }
        }
        return 0;
    }

    Kirigami.FormLayout {
        QQC2.ComboBox {
            id: styleCombo

            Kirigami.FormData.label: i18n("显示样式：")
            textRole: "name"
            model: page.styles
            currentIndex: page.styleIndex
            onActivated: function (index) {
                styleHolder.text = page.styles[index].value;
                page.configurationChanged();
            }
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 34
            wrapMode: Text.WordWrap
            opacity: 0.75
            text: page.styles[page.styleIndex] ? page.styles[page.styleIndex].hint : ""
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 34
            wrapMode: Text.WordWrap
            opacity: 0.6
            font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
            text: i18n("面板上的小视图不受这里影响 —— 那里位置太窄，固定显示「现在 / 下一节」。")
        }

        Kirigami.Separator {
            Layout.fillWidth: true
            Kirigami.FormData.isSection: true
            Kirigami.FormData.label: i18n("背景")
        }

        RowLayout {
            Kirigami.FormData.label: i18n("不透明度：")

            QQC2.Slider {
                id: opacitySlider
                Layout.preferredWidth: Kirigami.Units.gridUnit * 16
                from: 0
                to: 100
                stepSize: 5
                snapMode: QQC2.Slider.SnapAlways
                onMoved: page.configurationChanged()
            }
            QQC2.Label {
                Layout.preferredWidth: Kirigami.Units.gridUnit * 3
                text: Math.round(opacitySlider.value) + "%"
            }
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 34
            wrapMode: Text.WordWrap
            opacity: 0.75
            text: i18n("调到 0 就只剩内容浮在桌面上，完全没有背景板。")
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 34
            wrapMode: Text.WordWrap
            opacity: 0.6
            font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize)
            text: i18n("背景由组件自己绘制，所以这里的不透明度是准的；"
                       + "组件右键菜单里 Plasma 那个「背景」开关不再起作用。")
        }
    }
}

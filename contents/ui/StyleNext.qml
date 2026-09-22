/*
 * 显示样式：下一节
 *
 * 只显示当前上的或接下来那一节，大字 + 倒计时。占地方最小，
 * 适合把组件做得不大、只想瞄一眼「下一节是什么」的用法。
 *
 * 和面板上的小视图看的是同一份数据（panelInfo），只是排得开、字大。
 */

import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

import "coursemodel.js" as CM

Item {
    id: view

    // { name, room, teacher, color, time, startMinutes, endMinutes } 或 null
    property var card: null
    property string countdown: ""
    property bool active: false        // true = 正在上，false = 还没开始
    // 学期结束 / 未开学 / 放假时的一句话
    property string emptyText: ""

    ColumnLayout {
        anchors.fill: parent
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents.Label {
            Layout.fillWidth: true
            text: view.active ? "正在上课" : "下一节"
            font.bold: true
            font.pointSize: Kirigami.Theme.defaultFont.pointSize + 2
            opacity: 0.85
            visible: view.card !== null
        }

        PlasmaComponents.Label {
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: view.card === null
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            wrapMode: Text.Wrap
            font.pointSize: Kirigami.Theme.defaultFont.pointSize + 1
            opacity: 0.6
            text: view.emptyText !== "" ? view.emptyText : "没有课了"
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: view.card !== null
            radius: 6
            color: view.card && view.card.color
                ? view.card.color : Kirigami.Theme.highlightColor

            readonly property color fg:
                view.card ? CM.textColorFor(view.card.color) : Kirigami.Theme.textColor

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Kirigami.Units.largeSpacing
                spacing: 2

                PlasmaComponents.Label {
                    Layout.fillWidth: true
                    text: view.card ? view.card.name : ""
                    color: parent.parent.fg
                    font.bold: true
                    font.pointSize: Kirigami.Theme.defaultFont.pointSize + 4
                    wrapMode: Text.Wrap
                    maximumLineCount: 2
                    elide: Text.ElideRight
                }
                PlasmaComponents.Label {
                    Layout.fillWidth: true
                    visible: text !== ""
                    text: view.card ? view.card.time : ""
                    color: parent.parent.fg
                    opacity: 0.9
                    elide: Text.ElideRight
                }
                PlasmaComponents.Label {
                    Layout.fillWidth: true
                    visible: text !== ""
                    text: {
                        if (!view.card) {
                            return "";
                        }
                        var parts = [];
                        if (view.card.room) {
                            parts.push(view.card.room);
                        }
                        if (view.card.teacher) {
                            parts.push(view.card.teacher);
                        }
                        return parts.join(" · ");
                    }
                    color: parent.parent.fg
                    opacity: 0.8
                    elide: Text.ElideRight
                }
                Item { Layout.fillHeight: true }
                PlasmaComponents.Label {
                    Layout.fillWidth: true
                    visible: text !== ""
                    text: view.countdown
                    color: parent.parent.fg
                    font.bold: true
                    // 倒计时是这个样式里唯一会变的数字，比正文大一点才像「一眼可见」
                    font.pointSize: Kirigami.Theme.defaultFont.pointSize + 2
                    elide: Text.ElideRight
                }
            }
        }
    }
}

/*
 * 显示样式：今日课程
 *
 * 只列今天的课。桌面上要的是「一瞥就知道今天上什么、现在上什么」，
 * 周网格那种密排小字反而不合适。
 *
 * 今天还有没上的课就平铺今天的；今天的都上完了，main.qml 会把「接下来最近几节」
 * 递进来（mode = future，卡片上带「明天」「下周三 9/30」这类日期），免得一天课上
 * 完之后桌面直接空掉 —— 那恰恰是最想知道「接下来还有什么」的时候。
 */

import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

Item {
    id: view

    // "today" = 今天的课；"future" = 往后几节；"empty" = 都没有
    property string mode: "empty"
    property var cards: []
    property string header: ""
    property string subheader: ""
    property date now: new Date()
    // 卡片布局：card / compact / timeline（外观页可切）
    property string cardLayout: "card"
    // 学期结束 / 尚未开学 / 放假时由外部给一句说明，覆盖默认的「今天没课」
    property string emptyText: ""

    ColumnLayout {
        anchors.fill: parent
        spacing: Kirigami.Units.smallSpacing

        // ── 标题区：主标题说现在什么情况，副标题接着说下面这块是什么 ──
        // 两行竖着排更好看，但桌面上这个组件常常只有 240x160，多一行就少
        // 大半张卡片，所以并排放：小字副标题跟在主标题后面。
        RowLayout {
            Layout.fillWidth: true
            Layout.bottomMargin: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing * 1.5

            PlasmaComponents.Label {
                text: view.header
                visible: text !== ""
                font.bold: true
                // 默认字号在标题这个位置偏小，加一档
                font.pointSize: Kirigami.Theme.defaultFont.pointSize + 2
                opacity: 0.85
                elide: Text.ElideRight
                Layout.maximumWidth: implicitWidth
                // 和副标题的底边对齐，两行字看起来才像一行
                Layout.alignment: Qt.AlignBottom
            }
            PlasmaComponents.Label {
                Layout.fillWidth: true
                Layout.alignment: Qt.AlignBottom
                text: view.subheader
                visible: text !== ""
                font.pointSize: Math.max(6, Kirigami.Theme.smallFont.pointSize + 1)
                opacity: 0.6
                elide: Text.ElideRight
            }
            // 没有副标题时把主标题留在左边
            Item {
                Layout.fillWidth: true
                visible: view.subheader === ""
            }
        }

        PlasmaComponents.Label {
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: view.cards.length === 0
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            wrapMode: Text.Wrap
            font.pointSize: Kirigami.Theme.defaultFont.pointSize + 1
            opacity: 0.6
            text: view.emptyText !== "" ? view.emptyText : "今天没有课"
        }

        CardList {
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: view.cards.length > 0
            cards: view.cards
            layout: view.cardLayout
            now: view.now
        }
    }
}

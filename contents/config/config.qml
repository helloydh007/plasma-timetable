import QtQuick
import org.kde.plasma.configuration

ConfigModel {
    ConfigCategory {
        name: i18n("课程表")
        icon: "view-calendar-day"
        source: "configCourses.qml"
    }
    ConfigCategory {
        name: i18n("学期与节假日")
        icon: "view-calendar"
        source: "configGeneral.qml"
    }
}

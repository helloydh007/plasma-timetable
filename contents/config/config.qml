import QtQuick
import org.kde.plasma.configuration

ConfigModel {
    ConfigCategory {
        name: i18n("课程表")
        icon: "view-calendar-day"
        source: "configCourses.qml"
    }
    ConfigCategory {
        name: i18n("外观")
        icon: "preferences-desktop-theme"
        source: "configAppearance.qml"
    }
    ConfigCategory {
        name: i18n("节假日")
        icon: "view-calendar"
        source: "configGeneral.qml"
    }
}

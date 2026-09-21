/*
 * 学期周数计算 —— 组件本体与配置页共用（.pragma library 为无状态单例）。
 *
 * 「第 1 周」由用户指定的起始日决定：包含该起始日的那一整周即第 1 周，
 * 之后每 7 天递增一周。周的起止按系统 locale 的每周首日（zh_CN 为周一）。
 *
 * 所有天数运算都在 UTC 归一化后进行（把年月日折成"日序号"再相减），
 * 避免夏令时导致的 23/25 小时误差。
 */

.pragma library

// 解析 "yyyy-MM-dd"；非法或不存在（如 2026-02-30）返回 null
function parseIsoDate(s) {
    if (!s) {
        return null;
    }
    var m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(String(s));
    if (!m) {
        return null;
    }
    var y = Number(m[1]);
    var mo = Number(m[2]) - 1;
    var da = Number(m[3]);
    var d = new Date(y, mo, da);
    // Date 会把 2026-02-30 自动进位成 3 月 2 日，这里回读校验
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== da) {
        return null;
    }
    return d;
}

// 把日期折成"日序号"（UTC 归一化，跨夏令时也准确）
function dayIndex(d) {
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

// d 所在周的起始日的日序号
function weekStartDayIndex(d, firstDayOfWeek) {
    var dow = d.getDay();                              // 0=周日 … 6=周六
    var back = (dow - firstDayOfWeek + 7) % 7;
    return dayIndex(d) - back;
}

// d 落在「以 termStart 为第 1 周」的序列中的周次。
// 返回值 < 1 表示该日期早于第 1 周（尚未开学）。
function termWeekOf(d, termStart, firstDayOfWeek) {
    if (!d || !termStart) {
        return 0;
    }
    var a = weekStartDayIndex(termStart, firstDayOfWeek);
    var b = weekStartDayIndex(d, firstDayOfWeek);
    return Math.floor((b - a) / 7) + 1;
}

// 便于界面显示：把日序号折回日期
function dateFromDayIndex(n) {
    return new Date(n * 86400000);
}

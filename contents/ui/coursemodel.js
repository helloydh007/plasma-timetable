/*
 * 课表数据模型 —— 三个导入器（手动 / ICS / WakeUp）共同的落点。
 *
 * 内部模型只认「星期几 + 第几节 + 哪些周」，因为网格是按这个画的。
 * 具体日期由 termStart 现算，不存。
 *
 * 约定（全组件统一，其他地方不要再自己算）：
 *   weekday   1=周一 … 7=周日        （不是 JS 的 0=周日）
 *   node      节次号，1 起，对应 periods[].node
 *   week      第几周，1 起，第 1 周 = 包含 termStart 的那一周
 *   一周从周一开始 —— 课表就是周一打头的，不跟 locale 走，
 *   免得和月历组件那边的周数对不上时让人怀疑哪个错了。
 */

.pragma library

// 课程色板：都是中深色，浅色/深色主题下配白字都能看清
var PALETTE = [
    "#3f51b5", "#00897b", "#c2185b", "#ef6c00",
    "#5e35b1", "#00838f", "#2e7d32", "#ad1457",
    "#4527a0", "#00695c", "#d84315", "#283593"
];

function emptyModel() {
    return { version: 1, termStart: "", totalWeeks: 20, periods: [], courses: [] };
}

// 周次文本 ←→ 数组。"1-16"、"1,3,5-7"、"1-16单" 这类写法都能认。
function parseWeeksText(text) {
    var weeks = [];
    var errors = [];
    var s = String(text == null ? "" : text).trim();
    if (!s) {
        return { weeks: weeks, span: null, errors: errors };
    }
    // 允许写作 "1-16单周" / "1-16(单)"，末尾的单双标记单独处理
    var parity = 0;
    var mParity = /(单|双)\s*周?\s*$/.exec(s);
    if (mParity) {
        parity = (mParity[1] === "单") ? 1 : 2;
        s = s.substring(0, mParity.index);
    }
    var parts = s.split(/[,，、\s]+/);
    // 用户写下的数字里最小和最大的两个，就是这段周次的起止。
    // 要在单双周过滤**之前**记下来，否则 "1-18双" 会变成 2..18，
    // 之后切回单周就少了第 1 周。
    var lo = 0;
    var hi = 0;
    function note(v) {
        if (lo === 0 || v < lo) {
            lo = v;
        }
        if (v > hi) {
            hi = v;
        }
    }
    for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (!p) {
            continue;
        }
        var m = /^(\d{1,2})\s*[-~—]\s*(\d{1,2})$/.exec(p);
        if (m) {
            var a = Number(m[1]);
            var b = Number(m[2]);
            if (a < 1 || b > 60 || b < a) {
                errors.push("区间不合法：" + p);
                continue;
            }
            note(a);
            note(b);
            for (var w = a; w <= b; w++) {
                if (weeks.indexOf(w) < 0) {
                    weeks.push(w);
                }
            }
            continue;
        }
        if (/^\d{1,2}$/.test(p)) {
            var n = Number(p);
            if (n < 1 || n > 60) {
                errors.push("周次超出范围：" + p);
                continue;
            }
            note(n);
            if (weeks.indexOf(n) < 0) {
                weeks.push(n);
            }
            continue;
        }
        errors.push("看不懂：" + p);
    }
    if (parity > 0) {
        weeks = weeks.filter(function (w) {
            return parity === 1 ? (w % 2 === 1) : (w % 2 === 0);
        });
    }
    weeks.sort(function (x, y) { return x - y; });
    return { weeks: weeks, span: lo >= 1 ? [lo, hi] : null, errors: errors };
}

// 反过来：连续区间压成 "1-4"，零散的逐个列出
function weeksToText(weeks) {
    var list = (weeks || []).slice().sort(function (a, b) { return a - b; });
    if (list.length === 0) {
        return "";
    }

    // 全是单周或全是双周、且步长正好是 2 时，写成 "1-15单" / "2-16双"。
    // 这比 "1,3,5,7,9,11,13,15" 短得多，而且 parseWeeksText 能原样读回来。
    if (list.length >= 3) {
        var allOdd = true;
        var allEven = true;
        var byTwo = true;
        for (var i = 0; i < list.length; i++) {
            if (list[i] % 2 === 0) {
                allOdd = false;
            } else {
                allEven = false;
            }
            if (i > 0 && list[i] !== list[i - 1] + 2) {
                byTwo = false;
            }
        }
        if (byTwo && (allOdd || allEven)) {
            return list[0] + "-" + list[list.length - 1] + (allOdd ? "单" : "双");
        }
    }

    var out = [];
    var start = list[0];
    var prev = list[0];
    for (var j = 1; j <= list.length; j++) {
        var w = list[j];
        if (j < list.length && w === prev + 1) {
            prev = w;
            continue;
        }
        out.push(start === prev ? String(start) : (start + "-" + prev));
        start = w;
        prev = w;
    }
    return out.join(",");
}

// 0 = 单双周混排（即每周）、1 = 仅单周、2 = 仅双周
function parityOf(weeks) {
    var list = weeks || [];
    if (list.length === 0) {
        return 0;
    }
    var odd = 0;
    var even = 0;
    for (var i = 0; i < list.length; i++) {
        if (list[i] % 2 === 0) {
            even++;
        } else {
            odd++;
        }
    }
    if (odd > 0 && even === 0) {
        return 1;
    }
    if (even > 0 && odd === 0) {
        return 2;
    }
    return 0;
}

/*
 * 课程的「周次范围」。
 *
 * 为什么不直接用周次列表的 min/max：列表可能已经被单双周过滤过，
 * [1,3,5] 的 min/max 是 1 和 5，但它的区间原本可能是 1-6。
 * 反复切换单双周时，如果每次都用过滤后的 min/max 当区间，范围会一轮轮缩水
 * （1-16 → 单周 1-15 → 双周 2-14 → 每周 2-14，1、15、16 就丢了）。
 * 所以把用户填的区间单独记下来。span 缺失时退回按周次列表推。
 */
function normalizeSpan(span, weeks) {
    var list = (weeks || []).slice().sort(function (a, b) { return a - b; });
    var lo = 0;
    var hi = 0;
    var ok = false;
    if (isArrayLike(span) && span.length >= 2) {
        lo = Math.round(Number(span[0]));
        hi = Math.round(Number(span[1]));
        ok = (lo >= 1 && hi >= lo);
    }
    if (!ok && list.length > 0) {
        // 没记录范围（或记录坏了）就退回按周次列表推
        lo = list[0];
        hi = list[list.length - 1];
        ok = (lo >= 1 && hi >= lo);
    }
    return ok ? [lo, hi] : null;
}

/*
 * 按单双周重排周次。取课程记录的范围（没有就退回 1..totalWeeks）里的
 * 全部单周（或双周），所以反复切换不会缩水。
 */
function applyParity(weeks, parity, totalWeeks, span) {
    var sp = normalizeSpan(span, weeks);
    var lo;
    var hi;
    if (sp) {
        lo = sp[0];
        hi = sp[1];
    } else {
        lo = 1;
        hi = Math.max(1, Math.round(Number(totalWeeks) || 1));
    }
    var out = [];
    for (var w = lo; w <= hi; w++) {
        if (parity === 1 && w % 2 === 0) {
            continue;
        }
        if (parity === 2 && w % 2 === 1) {
            continue;
        }
        out.push(w);
    }
    return out;
}

/*
 * 周次的显示文本。单双周要带上真实起止，否则一门 1-16 周的单周课
 * 会显示成 "1-15单"，用户会以为第 16 周没排。
 */
function weeksDisplay(course) {
    var weeks = (course && course.weeks) || [];
    var p = parityOf(weeks);
    var sp = normalizeSpan(course && course.weekSpan, weeks);
    if (p !== 0 && sp) {
        return sp[0] + "-" + sp[1] + (p === 1 ? "单" : "双");
    }
    return weeksToText(weeks);
}

// ── 时间与星期的换算 ──

/*
 * 判断一段文本是不是「编码没对上」。
 *
 * 典型场景：教务系统导出的 .ics / .wakeup_schedule 是 GBK/GB18030，
 * 用户用按 UTF-8 打开的编辑器复制出来，每个字节变成一个 U+0080–U+00FF 的字符，
 * 中文全变成 "é«æ°å¦A" 这种。
 *
 * 这种情况必须拦住：解析器根本不会报错 —— BEGIN/END、属性名这些都是 ASCII，
 * 结构照样解析得出来，只是课名、教师、地点全成了乱码。用户拿到的是一份
 * 看起来正常、内容全错的课表，比直接失败糟糕得多。
 */
function looksMisDecoded(text) {
    var s = String(text || "");
    if (s.length === 0) {
        return false;
    }
    var cjk = 0;
    var latin1 = 0;
    var bad = 0;
    var limit = Math.min(s.length, 20000);      // 看开头一段就够判断了
    for (var i = 0; i < limit; i++) {
        var c = s.charCodeAt(i);
        if (c === 0xFFFD) {
            bad++;
        } else if (c >= 0x4E00 && c <= 0x9FFF) {
            cjk++;
        } else if (c >= 0x80 && c <= 0xFF) {
            latin1++;
        }
    }
    if (bad > 0) {
        return true;                            // 解码时就已经丢字符了
    }
    // 正常的中文课表不会出现成片的 U+0080–U+00FF 字符
    return cjk === 0 && latin1 > 20;
}


/*
 * 时钟校正。
 *
 * 课表的「今天是第几周」完全依赖本机时间：把系统时间改早几周，看到的就是
 * 错的那一周的课；改早几年，还会显示成「尚未开学」。这里用联网取到的
 * 服务端时间算出差值，显示时加上去 —— 本机时钟的**走时**是准的，
 * 不准的只是偏移量，所以加一次就够，之后断网也不会退回错误时间。
 */

// 本机时钟与网络时间的差值（秒）。取不到网络时间返回 null。
function clockSkewSec(serverIso, localNow) {
    if (!serverIso) {
        return null;
    }
    var serverMs = new Date(serverIso).getTime();
    if (isNaN(serverMs) || !localNow) {
        return null;
    }
    return Math.round((serverMs - localNow.getTime()) / 1000);
}

/*
 * 某一天要上的课，按时间排好，附上起止时间和时间文本。
 * 给「今日课程」「接下来」这类列表样式用 —— 它们不该自己算时间，
 * 否则节次表和课块两处逻辑各写一遍，早晚对不上。
 */
function cardsForDay(model, week, weekday) {
    var out = [];
    var list = slotsOn(model, week, weekday, false);
    for (var i = 0; i < list.length; i++) {
        var c = list[i].course;
        var p0 = periodByNode(model, c.startPeriod);
        var p1 = periodByNode(model, c.endPeriod);
        var s = p0 && p0.start ? p0.start : "";
        var e = p1 && p1.end ? p1.end : "";
        out.push({
            name: c.name,
            room: c.room,
            teacher: c.teacher,
            color: c.color,
            start: s,
            end: e,
            time: s && e ? (s + "–" + e) : (s || e),
            startMinutes: p0 ? minutesOfTime(p0.start) : -1,
            endMinutes: p1 ? minutesOfTime(p1.end) : -1
        });
    }
    return out;
}

/*
 * 给卡片补上「是不是今天」和日期标签。
 *
 * 两种来源（今天的课 / 往后找的课）字段本来不一样，样式组件就得猜
 * 「sameDay 在不在」—— 漏判一次就会出现「明天的课被当成正在上」这种错。
 * 统一在这里补齐，样式只管读。
 */
function tagCards(cards, sameDay, dayLabel) {
    var out = [];
    for (var i = 0; i < (cards || []).length; i++) {
        var c = cards[i];
        out.push({
            name: c.name,
            room: c.room,
            teacher: c.teacher,
            color: c.color,
            start: c.start,
            end: c.end,
            time: c.time,
            startMinutes: c.startMinutes,
            endMinutes: c.endMinutes,
            dayLabel: dayLabel || "",
            sameDay: sameDay === true
        });
    }
    return out;
}

// 「今天」标题栏：今天 · 9月22日 周二
function dayTitle(date) {
    var names = ["日", "一", "二", "三", "四", "五", "六"];
    return "今天 · " + (date.getMonth() + 1) + "月" + date.getDate() + "日 周" + names[date.getDay()];
}

// 还没上完的课（结束时间晚于 nowMinutes）。没有作息表（endMinutes < 0）时一律保留，
// 否则会把课全滤掉 —— 宁可多显示也不要莫名空着。
function remainingCards(cards, nowMinutes) {
    var out = [];
    for (var i = 0; i < (cards || []).length; i++) {
        var c = cards[i];
        if (c.endMinutes < 0 || c.endMinutes > nowMinutes) {
            out.push(c);
        }
    }
    return out;
}

// 「今天 / 明天 / 后天 / 周三」这样的相对日期标签
function dayLabel(from, to) {
    var diff = dayIndex(to) - dayIndex(from);
    if (diff === 0) {
        return "今天";
    }
    if (diff === 1) {
        return "明天";
    }
    if (diff === 2) {
        return "后天";
    }
    return weekdayLabel(weekdayOf(to));
}


/*
 * 该存进配置的偏移量。
 * 偏差小于一天就不动：那多半只是走时漂移，校正反而让人困惑
 * （而且校正常常会和技术上正确的显示差几秒，用户会以为是 bug）。
 * 取不到网络时间时返回 null，表示「维持原值」，不要清掉已有的校正。
 */
function clockOffsetToStore(serverIso, localNow) {
    var skew = clockSkewSec(serverIso, localNow);
    if (skew === null) {
        return null;
    }
    return Math.abs(skew) >= 86400 ? skew : 0;
}

// 显示用的「现在」
function applyClockOffset(localNow, offsetSec) {
    var off = Number(offsetSec);
    if (!isFinite(off)) {
        off = 0;
    }
    return new Date(localNow.getTime() + off * 1000);
}


/*
 * 判断是不是数组。
 *
 * 不能用 Object.prototype.toString.call(v) === "[object Array]"：
 * QML 会把 property var 里的数组转成 QVariantList，它在 JS 引擎里
 * 不是真正的 Array（toString 给的是 "[object Object]"），但 .length 和下标照常可用。
 * 这个坑很隐蔽 —— modelData 里的数组就是这种，用它会让判定静默失败、逻辑退化成默认分支。
 * 所以按行为判断（有 length 和下标），不按类型。
 */
function isArrayLike(v) {
    return v !== null && v !== undefined
        && typeof v === "object"
        && typeof v.length === "number";
}

function pad2(n) {
    return (n < 10 ? "0" : "") + n;
}

// "08:00" → 480；解析不出来返回 -1
function minutesOfTime(s) {
    var m = /^\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*$/.exec(String(s || ""));
    if (!m) {
        return -1;
    }
    var h = Number(m[1]);
    var mi = Number(m[2]);
    if (h > 23 || mi > 59) {
        return -1;
    }
    return h * 60 + mi;
}

function timeOfMinutes(n) {
    var v = Number(n);
    if (!(v >= 0)) {
        return "";
    }
    return pad2(Math.floor(v / 60)) + ":" + pad2(Math.round(v % 60));
}

// JS 的 getDay()（0=周日）→ 本模型的 weekday（1=周一 … 7=周日）
function weekdayOf(date) {
    return ((date.getDay() + 6) % 7) + 1;
}

// UTC 归一化的"日序号"，跨夏令时也准确
function dayIndex(date) {
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function dateFromDayIndex(n) {
    return new Date(n * 86400000);
}

// date 所在周的周一
function mondayOf(date) {
    return dayIndex(date) - (weekdayOf(date) - 1);
}

// 把 "yyyy-MM-dd" 解析成 Date；非法返回 null
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
    // Date 会把 2026-02-30 进位成 3 月 2 日，回读校验挡掉
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== da) {
        return null;
    }
    return d;
}

function isoOf(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

// 第 1 周的周一（日序号）。termStart 为空返回 null
function termMondayIndex(model) {
    var d = parseIsoDate(model && model.termStart);
    return d ? mondayOf(d) : null;
}

// date 落在第几周。早于第 1 周返回 <= 0
function weekOf(model, date) {
    var base = termMondayIndex(model);
    if (base === null) {
        return 0;
    }
    return Math.floor((mondayOf(date) - base) / 7) + 1;
}

// 第 week 周、星期 weekday 的具体日期；未设开学日返回 null
function dateOf(model, week, weekday) {
    var base = termMondayIndex(model);
    if (base === null) {
        return null;
    }
    return dateFromDayIndex(base + (week - 1) * 7 + (weekday - 1));
}

function weekdayNames() {
    return ["一", "二", "三", "四", "五", "六", "日"];
}

function weekdayLabel(weekday) {
    var n = weekdayNames();
    return "周" + (n[weekday - 1] || "?");
}

// ── 作息时间表 ──

/*
 * 文本 ←→ periods 互转。每行一节："1 08:00-08:45"，# 开头是注释。
 * 用文本而不是一堆输入框：批量改作息、从教务系统复制过来都方便。
 */
function parsePeriodsText(text) {
    var out = [];
    var errors = [];
    var lines = String(text || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/#.*$/, "").trim();
        if (!line) {
            continue;
        }
        var m = /^(\d{1,2})\s+(\d{1,2}[:：]\d{2})\s*[-~—]\s*(\d{1,2}[:：]\d{2})$/.exec(line);
        if (!m) {
            errors.push("第 " + (i + 1) + " 行看不懂：" + line + "（应形如 1 08:00-08:45）");
            continue;
        }
        var s = minutesOfTime(m[2]);
        var e = minutesOfTime(m[3]);
        if (s < 0 || e < 0 || e <= s) {
            errors.push("第 " + (i + 1) + " 行时间不合法：" + line);
            continue;
        }
        out.push({ node: Number(m[1]), start: timeOfMinutes(s), end: timeOfMinutes(e) });
    }
    out.sort(function (a, b) { return a.node - b.node; });
    return { periods: out, errors: errors };
}

function periodsToText(periods) {
    var out = [];
    for (var i = 0; i < (periods || []).length; i++) {
        var p = periods[i];
        out.push(p.node + " " + p.start + "-" + p.end);
    }
    return out.join("\n");
}

// 网格行数：节次号的最大值（作息表可能缺号，但仍按最大号排行）
function rowCount(model) {
    var max = 0;
    var list = (model && model.periods) || [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].node > max) {
            max = list[i].node;
        }
    }
    return max;
}

// 节次号 → 行下标（0 起）。作息表按 node 升序，所以就是位置
function rowOfNode(model, node) {
    var list = (model && model.periods) || [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].node === node) {
            return i;
        }
    }
    return -1;
}

function periodAt(model, row) {
    var list = (model && model.periods) || [];
    return (row >= 0 && row < list.length) ? list[row] : null;
}

function periodByNode(model, node) {
    var list = (model && model.periods) || [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].node === node) {
            return list[i];
        }
    }
    return null;
}

/*
 * 课程块上的文字颜色。
 * 色板都是中深色配白字没问题，但 WakeUp / ICS 里带的颜色是用户自己在手机上调的，
 * 可能是亮黄亮绿，白字就糊了。按 WCAG 相对亮度挑黑或白。
 */
function textColorFor(hex) {
    var m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));
    if (!m) {
        return "#ffffff";
    }
    var v = m[1];
    function lin(c) {
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    var L = 0.2126 * lin(parseInt(v.substring(0, 2), 16) / 255)
          + 0.7152 * lin(parseInt(v.substring(2, 4), 16) / 255)
          + 0.0722 * lin(parseInt(v.substring(4, 6), 16) / 255);
    return L > 0.45 ? "#1d1d1d" : "#ffffff";
}

// 从若干「时间段」推导作息表：按开始时间排序，去重。ICS 导入用
function periodsFromIntervals(intervals) {
    var seen = {};
    var uniq = [];
    for (var i = 0; i < (intervals || []).length; i++) {
        var iv = intervals[i];
        var k = iv.start + "-" + iv.end;
        if (!seen[k]) {
            seen[k] = true;
            uniq.push({ start: iv.start, end: iv.end });
        }
    }
    uniq.sort(function (a, b) { return a.start - b.start; });
    var out = [];
    for (var j = 0; j < uniq.length; j++) {
        out.push({ node: j + 1, start: timeOfMinutes(uniq[j].start), end: timeOfMinutes(uniq[j].end) });
    }
    return out;
}

// 把一段真实时间落到作息表的节次区间上（按包含关系匹配）
function mapTimeToPeriods(periods, startMin, endMin) {
    var first = -1;
    var last = -1;
    for (var i = 0; i < (periods || []).length; i++) {
        var p = periods[i];
        var ps = minutesOfTime(p.start);
        var pe = minutesOfTime(p.end);
        if (ps < 0 || pe < 0) {
            continue;
        }
        if (ps <= startMin && startMin < pe && first < 0) {
            first = p.node;
        }
        if (ps < endMin && endMin <= pe) {
            last = p.node;
        }
    }
    if (first < 0) {
        return null;
    }
    if (last < first) {
        last = first;
    }
    return { startPeriod: first, endPeriod: last };
}

/*
 * 事件时间 → 节次区间。先试"时间完全一致"，再退回包含匹配。
 *
 * 为什么要分两步：ICS 里的课往往是"08:00-09:40 连上两小节"，
 * 它不告诉你 08:45 那里有小节边界。如果作息表就是从这份 ICS 推出来的，
 * 那每一行的起止就是 08:00-09:40，此时必须整体占一行，
 * 硬套包含关系会把它摊到两行上（一行 45 分钟、一行 100 分钟），看着就错了。
 */
function mapEvent(periods, startMin, endMin) {
    for (var i = 0; i < (periods || []).length; i++) {
        var p = periods[i];
        if (minutesOfTime(p.start) === startMin && minutesOfTime(p.end) === endMin) {
            return { startPeriod: p.node, endPeriod: p.node };
        }
    }
    return mapTimeToPeriods(periods, startMin, endMin);
}

// ── 课程 ──

function colorFor(index) {
    return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

// 补全字段、夹紧取值。任何脏数据都不应该让界面画出格子外面去
function normalizeCourse(c, index) {
    var weekday = Math.round(Number(c && c.weekday));
    if (!(weekday >= 1 && weekday <= 7)) {
        weekday = 1;
    }
    var sp = Math.round(Number(c && c.startPeriod));
    var ep = Math.round(Number(c && c.endPeriod));
    if (!(sp >= 1)) {
        sp = 1;
    }
    if (!(ep >= sp)) {
        ep = sp;
    }
    var weeks = [];
    var src = (c && c.weeks) || [];
    for (var i = 0; i < src.length; i++) {
        var w = Math.round(Number(src[i]));
        if (w >= 1 && weeks.indexOf(w) < 0) {
            weeks.push(w);
        }
    }
    weeks.sort(function (a, b) { return a - b; });
    return {
        name: String((c && c.name) || "未命名"),
        teacher: String((c && c.teacher) || ""),
        room: String((c && c.room) || ""),
        weekday: weekday,
        startPeriod: sp,
        endPeriod: ep,
        weeks: weeks,
        weekSpan: normalizeSpan(c && c.weekSpan, weeks),
        color: String((c && c.color) || colorFor(index || 0))
    };
}

function colorKey(c) {
    return ((c.name || "") + "").trim();
}

/*
 * 同一门课的多个时段合并周次。
 * 判等用的是「名字+教师+地点+星期几+节次区间」：
 *   - 单双周在 ICS 里是两条同地点的事件，合并后周次并集 = 每周，正确；
 *   - 单周理论课 / 双周实验课地点不同，不会合并，各自保留周次，也正确。
 */
function mergeSlots(slots) {
    var order = [];
    var map = {};
    for (var i = 0; i < (slots || []).length; i++) {
        var s = slots[i];
        var key = [s.name, s.teacher, s.room, s.weekday, s.startPeriod, s.endPeriod].join("\u0001");
        if (!map[key]) {
            map[key] = {
                name: s.name, teacher: s.teacher, room: s.room,
                weekday: s.weekday, startPeriod: s.startPeriod, endPeriod: s.endPeriod,
                weeks: [],
                color: s.color || ""
            };
            order.push(key);
        }
        var t = map[key];
        for (var w = 0; w < (s.weeks || []).length; w++) {
            if (t.weeks.indexOf(s.weeks[w]) < 0) {
                t.weeks.push(s.weeks[w]);
            }
        }
    }
    var out = [];
    for (var k = 0; k < order.length; k++) {
        var c = map[order[k]];
        c.weeks.sort(function (a, b) { return a - b; });
        out.push(c);
    }
    return out;
}

/*
 * 给每一门课分配稳定的颜色：同一门课的所有时段同色，不同课尽量不同色。
 *
 * 不能只用一个"下一个色板下标"计数器：带颜色的课（WakeUp / ICS 里自带的）
 * 不占计数器，后面没颜色的课就会从色板头开始取，正好撞上前面已经用掉的色。
 * 所以先把已有颜色登记成"已占用"，再从剩余色板里取。
 */
function assignColors(courses) {
    var list = courses || [];
    var byName = {};
    var used = {};
    var i, k;

    for (i = 0; i < list.length; i++) {
        var c0 = list[i];
        if (c0.color) {
            k = colorKey(c0);
            if (!byName[k]) {
                byName[k] = c0.color;
            }
            used[String(c0.color).toLowerCase()] = true;
        }
    }

    var cursor = 0;
    for (i = 0; i < list.length; i++) {
        var c = list[i];
        k = colorKey(c);
        if (byName[k]) {
            c.color = byName[k];
            continue;
        }
        var pick = "";
        for (var t = 0; t < PALETTE.length; t++) {
            var cand = PALETTE[(cursor + t) % PALETTE.length];
            if (!used[cand]) {
                pick = cand;
                cursor = (cursor + t + 1) % PALETTE.length;
                break;
            }
        }
        if (!pick) {
            pick = PALETTE[cursor % PALETTE.length];   // 课比色板还多，循环取用
            cursor = (cursor + 1) % PALETTE.length;
        }
        used[pick] = true;
        byName[k] = pick;
        c.color = pick;
    }
    return list;
}

// 某周、星期几的课，按开始节次排序
function coursesOn(model, week, weekday) {
    var out = [];
    var list = (model && model.courses) || [];
    for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.weekday !== weekday) {
            continue;
        }
        if ((c.weeks || []).indexOf(week) < 0) {
            continue;
        }
        out.push(c);
    }
    out.sort(function (a, b) {
        if (a.startPeriod !== b.startPeriod) {
            return a.startPeriod - b.startPeriod;
        }
        return (a.name < b.name) ? -1 : (a.name > b.name ? 1 : 0);
    });
    return out;
}

/*
 * 某一格的课，附带「这一周上不上」。
 *
 * includeOffWeek 为真时，把「这个时段有排课、但这一周不上」的课也一并返回
 * （meets=false），由界面决定灰显并标注。默认不返回 —— 空着比画一堆灰块干净。
 */
function slotsOn(model, week, weekday, includeOffWeek) {
    var out = [];
    var list = (model && model.courses) || [];
    for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.weekday !== weekday) {
            continue;
        }
        var meets = (c.weeks || []).indexOf(week) >= 0;
        if (!meets && !includeOffWeek) {
            continue;
        }
        out.push({ course: c, meets: meets });
    }
    out.sort(function (a, b) {
        if (a.course.startPeriod !== b.course.startPeriod) {
            return a.course.startPeriod - b.course.startPeriod;
        }
        // 本周要上的排在前面，这样叠在一起时灰块不会挡住真课
        if (a.meets !== b.meets) {
            return a.meets ? -1 : 1;
        }
        return 0;
    });
    return out;
}

/*
 * 课块的灰暗版配色。
 * 往中性灰里混七成、保留三成原色：既能一眼看出「不用上课」，
 * 又还认得出是哪一门课（课程表上一片全灰反而看不出区别）。
 */
function dimColor(hex) {
    var m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));
    if (!m) {
        return "#5a5f66";
    }
    var v = m[1];
    var r = parseInt(v.substring(0, 2), 16);
    var g = parseInt(v.substring(2, 4), 16);
    var b = parseInt(v.substring(4, 6), 16);
    var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    function mix(c) {
        var n = Math.round(c * 0.3 + lum * 0.7);
        if (n < 0) {
            n = 0;
        }
        if (n > 255) {
            n = 255;
        }
        return (n < 16 ? "0" : "") + n.toString(16);
    }
    return "#" + mix(r) + mix(g) + mix(b);
}

// 整周（周一到周日）的课，便于"上一周/下一周"预览和统计
function coursesInWeek(model, week) {
    var out = [];
    for (var d = 1; d <= 7; d++) {
        var day = coursesOn(model, week, d);
        for (var i = 0; i < day.length; i++) {
            out.push(day[i]);
        }
    }
    return out;
}

// 同名课程去重后的名字列表，供手动编辑时下拉选择
function courseNames(model) {
    var seen = {};
    var out = [];
    var list = (model && model.courses) || [];
    for (var i = 0; i < list.length; i++) {
        var n = colorKey(list[i]);
        if (n && !seen[n]) {
            seen[n] = true;
            out.push(n);
        }
    }
    out.sort();
    return out;
}

/*
 * 反序列化。任何字段缺失、类型不对都退回默认值 ——
 * 配置里的 JSON 是用户能手改的，不能因为一个括号就让整个组件画不出来。
 */
function parseModel(json) {
    var m = emptyModel();
    if (!json) {
        return m;
    }
    var raw;
    try {
        raw = JSON.parse(String(json));
    } catch (e) {
        return m;
    }
    if (!raw || typeof raw !== "object") {
        return m;
    }
    if (typeof raw.termStart === "string" && parseIsoDate(raw.termStart)) {
        m.termStart = raw.termStart;
    }
    var tw = Math.round(Number(raw.totalWeeks));
    if (tw >= 1 && tw <= 60) {
        m.totalWeeks = tw;
    }
    if (Object.prototype.toString.call(raw.periods) === "[object Array]") {
        for (var i = 0; i < raw.periods.length; i++) {
            var p = raw.periods[i] || {};
            var node = Math.round(Number(p.node));
            var s = minutesOfTime(p.start);
            var e = minutesOfTime(p.end);
            if (node >= 1 && s >= 0 && e > s) {
                m.periods.push({ node: node, start: timeOfMinutes(s), end: timeOfMinutes(e) });
            }
        }
        m.periods.sort(function (a, b) { return a.node - b.node; });
    }
    if (Object.prototype.toString.call(raw.courses) === "[object Array]") {
        for (var j = 0; j < raw.courses.length; j++) {
            if (raw.courses[j] && typeof raw.courses[j] === "object") {
                m.courses.push(normalizeCourse(raw.courses[j], j));
            }
        }
    }
    // 有课却没有作息表（手改配置、或导入源本身没有节次时间）：
    // 按课程用到的节次号补出空壳，否则网格会退化成一整行把所有课叠在一起。
    if (m.periods.length === 0 && m.courses.length > 0) {
        var nodes = [];
        for (var q = 0; q < m.courses.length; q++) {
            var c = m.courses[q];
            for (var node = c.startPeriod; node <= c.endPeriod; node++) {
                if (nodes.indexOf(node) < 0) {
                    nodes.push(node);
                }
            }
        }
        nodes.sort(function (a, b) { return a - b; });
        for (var t = 0; t < nodes.length; t++) {
            m.periods.push({ node: nodes[t], start: "", end: "" });
        }
    }

    return m;
}

function serializeModel(m) {
    return JSON.stringify({
        version: 1,
        termStart: m.termStart || "",
        totalWeeks: m.totalWeeks || 20,
        periods: m.periods || [],
        courses: m.courses || []
    });
}

// 导入结果的一句话摘要，配置页和错误提示都用它
function describeModel(m) {
    var n = (m.courses || []).length;
    if (n === 0) {
        return "课表是空的";
    }
    var maxWeek = 0;
    for (var i = 0; i < m.courses.length; i++) {
        var w = m.courses[i].weeks || [];
        for (var j = 0; j < w.length; j++) {
            if (w[j] > maxWeek) {
                maxWeek = w[j];
            }
        }
    }
    var names = courseNames(m).length;
    return names + " 门课 / " + n + " 个时段 / 最长到第 " + maxWeek + " 周"
        + (m.termStart ? "（开学 " + m.termStart + "）" : "（未设开学日）");
}

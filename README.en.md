# Class Timetable for KDE Plasma 6

[中文](README.md) | **English**

A desktop **class timetable / course schedule widget (plasmoid)** for **KDE Plasma 6**.
The default view is a weekly grid (7 days × class periods) with today and the current
class highlighted; it can also be switched to three list views — *Today*, *Upcoming*,
*Next class*. Timetables can be typed in by hand, imported from an **`.ics` / iCalendar**
file, or imported from **WakeUp** (a popular Chinese course-schedule app). It knows about
Chinese public holidays and the make-up working days around them, and both the panel
background and the course cards have their own opacity setting.

![Screenshot](screenshot.png)

> Rendered with the sample timetable from `tests/sample.ics` — top row: weekly grid
> (default), Today · Cards; middle row: Today · Compact rows, Today · Agenda timeline;
> bottom row: Upcoming, Next class.
> The list views fall back to the next few classes once today's are over, and a card for
> a future day always carries a date (`明天` = tomorrow, `后天` = day after tomorrow,
> `下周三 9/30` = next Wed, Sep 30) — the same course repeats every week, so a bare
> weekday name cannot tell two occurrences apart.

## Why this exists

There is no timetable widget on KDE Store (`timetable`, `schedule`, `class` and `课程表`
all searched; only bus timetables and a Plasma 4-era single-school tool turned up).
ClassIsland is X11-only, and Class Widgets is a standalone PyQt application rather than a
Plasma widget. So for Wayland + Plasma 6 there was genuinely nothing usable.

## Three ways to add a timetable

Importing **replaces** all existing courses, so copy your hand-made data somewhere first
(the config page can copy the current data out).

### 1. Type it in

Config page → *Add a class*, then fill in name, weekday, first/last period, weeks,
room and teacher.

The week field accepts several notations, and they can be mixed:

| Notation | Meaning |
|----------|---------|
| `1-16` | weeks 1 through 16 |
| `1,3,5` | only these weeks |
| `1-16单` | odd weeks within 1–16 |
| `1-16双` | even weeks within 1–16 |

If you would rather not work out odd/even weeks by hand, use the **parity dropdown** next
to the week field (Every week / Odd weeks only / Even weeks only) — it fills the notation
in for you. Range endpoints are remembered separately, so toggling parity back and forth
never shrinks the range (`1-16 → odd → even → every week` still gives you `1-16`, not `2-14`).

### 2. Import an ICS calendar (recommended)

Export an `.ics` from your university system or calendar app, **open it in a text editor,
select all, copy, and paste it into the “ICS calendar” box** on the config page.

Handled automatically: term start date (inferred from the earliest class), odd/even weeks
(`RRULE` with `INTERVAL=2`), cancelled dates (`EXDATE`), all-day events (exams etc. are
skipped), line folding, quoting and escaping. The period timetable is inferred from the
ICS too (one row per distinct time slot) and can be edited afterwards.

This path works with the converters commonly used by Chinese universities — zju-ical,
fzu-ics, uestc-coursetable-parser, Class2ICS, GTMD 青果, the Renmin University browser
extension, and so on.

### 3. Import a WakeUp schedule

In WakeUp: Share → Export backup, which gives a `.wakeup_schedule` file. Open it, select
all, paste it, and pick the “WakeUp” tab.

That format **carries its own period timetable and term start date**, so nothing else needs
configuring after the import. Its `type` field maps directly (0 = every week, 1 = odd,
2 = even), and classes with a custom `ownTime` are skipped.

### Why paste text instead of picking a file

QML cannot read local files — `XMLHttpRequest` with `file://` is blocked by the security
policy and there is no other entry point. Rather than ship a file dialog that fails on
other people's machines, there is a single path that always works. Both `.ics` and
`.wakeup_schedule` are plain text, so a text editor is all you need.

### Chinese text and encodings

Chinese content is a first-class case: Chinese course names, teachers and rooms, Chinese
`TZID` values, full-width parentheses and full-width colons in descriptions are all
handled. Two very common cases are also covered:

- **Full-width colons.** Copying an ICS out of a web page or chat log often turns `:` into
  `：`, which used to break the whole file. Both are now accepted (the first one wins, so a
  full-width colon inside `DESCRIPTION:教师：张三` is preserved as text).
- **Files with a BOM** can be pasted as-is.

**A wrong encoding is rejected rather than silently imported as mojibake.** Exports from
university systems are often GBK / GB18030; copied out through a UTF-8 editor they turn
into things like `é«æ°å¦`. Such a file **does not fail to parse** (`BEGIN`/`END` and the
property names are ASCII, so the structure comes through fine) — you would end up with a
timetable that looks valid but has garbage course names, which is far worse than an error.
So the import checks first, and says exactly what to do:

> The Chinese part of this content is already mojibake … open the original file in a text
> editor as GBK or GB18030, check that the Chinese looks right, then copy and paste again.

## Term handling

- During the term, the toolbar shows “第 N 周（本周）” (week N — this week).
- After the term ends it shows “第 N 周（本学期已结束）”, clamps to the last week, disables
  the *next week* button, and the panel reports “本学期已结束” — you cannot page into
  empty weeks beyond the term. The *back to this week* button becomes *back to the last week*.

### Weeks you are not in are dimmed

Right after the term ends the grid looks exactly like it did while classes were running,
which makes it easy to think you still have to go. So:

- When the displayed week is **not the current week** (you paged to another week, or the
  term is over), every course block turns dim grey and is marked `非本周` (not this week).
- Classes that **do not meet in the displayed week** (a one-off lecture in week 11 while
  you are looking at week 3) are hidden by default; with “show classes not in this week”
  enabled they are drawn dim and marked the same way.

Dimming mixes the original colour 70% towards neutral grey, keeping 30% of the hue — enough
to read as “no class”, while you can still tell which course it is (all-grey would not).

## When the system clock is wrong

“Which week is it” depends entirely on local time: set the clock two weeks early and you see
the wrong week; set it years early and it says the term has not started. So the widget
**periodically compares the local clock against network time**:

- Every 6 hours (and at startup) it reads the `Date` header of a server response and takes
  the difference.
- Only a difference of more than a day triggers a correction, which is stored in the config
  (displayed time = local time + offset).
- The toolbar then shows **⚠ 时间已校正**, and hovering explains how far off it is.

Deliberate trade-offs:

- **Under one day is not corrected.** That is almost always drift, and “correcting” it would
  leave you permanently a few seconds off — which looks like a bug.
- **Being offline does not clear an existing correction.** The local clock's *rate* is fine;
  only its offset was wrong, so one measurement is enough. Offline it keeps the old value
  instead of falling back to the wrong time.
- **Only the response header is read, nothing is uploaded.** The two URLs requested are the
  holiday-data ones.
- **Local time stays in charge.** Display is only changed when a real >1-day offset was
  measured — this is a timetable widget, not a time service.

## Holidays and make-up working days

Holiday data comes from the same source as the
[lunar calendar widget](https://github.com/helloydh007/plasma-lunar-calendar): a built-in
table plus optional network updates (manual, or automatic every 30 days). Chinese holiday
arrangements are published year by year by the State Council and cannot be derived from a
calendar, hence the data table.

- **休 (rest)**: no classes that day, the cell is marked in red.
- **班 (work)**: a make-up working day, marked in grey.

`班` is only a hint and **does not change the timetable** — that day still shows whatever
classes fall on its actual weekday. Which classes a make-up day replaces differs per school
and is not regulated nationally, so nothing is guessed; if you do have classes, add an entry
for that weekday.

## Display styles

Four styles, switchable on the *Appearance* page:

| Style | What it looks like | When to use it |
|-------|--------------------|----------------|
| **Weekly grid** (default) | 7 columns × periods for the whole week | Planning, seeing the whole week |
| **Today** | Today's classes, one per row | A glance at the desktop; continues with the next class once today is over (see below) |
| **Upcoming** | The next few classes from today, future days labelled `明天` / `下周三 9/30` | “What is coming up?” |
| **Next class** | Just the current or next class, large, with a countdown | Takes up the least room |

The class currently in progress is filled with the theme highlight colour and marked
`上课中` in the corner (the test is “is today **and** is now inside its start–end window” —
time alone would misjudge tomorrow's class at the same hour as being in progress). Finished
classes are not listed.

**A card for a future day always carries a date.** Since the same course repeats every week,
looking two weeks ahead puts this Wednesday and next Wednesday right next to each other with
identical names and times; a bare `周三` cannot tell them apart — this was a real reported
bug (“the same course appears twice”). Within a week it writes `明天 / 后天 / 周四 9/25`, and
for the following week `下周三 9/30`.

**Today falls back to upcoming classes**: if today still has classes they are listed; if not
(today's are done), the header becomes `今天没有课了 接下来的课` and the list continues with the
**next three** classes (configurable). Not necessarily tomorrow — if tomorrow is free it
looks further ahead, and if there are fewer than three, that is what you get.

On the day itself it becomes that day's timetable automatically (everything is computed from
“now”, nothing to switch manually). Once the term is over it shows `本学期已结束`.

When more cards than fit are configured, the list scrolls (a scrollbar appears) — cards are
never squashed, and nothing is ever drawn outside the widget's border.

### Card layouts

The class list in *Today* and *Upcoming* has three layouts, switchable on the *Appearance*
page. They affect only those two styles; the weekly grid has no list, and *Next class* is a
single card.

| Layout | What it looks like | When to use it |
|--------|--------------------|----------------|
| **Cards** (default) | Two lines: name on top, room · teacher below, date and time right-aligned | General use, most information |
| **Compact rows** | One line per class (name + date + time) | Small widgets: **three classes fit in 240×160**, no scrolling |
| **Agenda timeline** | One panel for the whole agenda: date and time on the left, a rail with one dot per class, name on the right | Fast scanning; shows one class fewer at the same height |

In the timeline layout the `上课中` marker sits under the course name (there is no right-hand
column to attach it to).

The small panel view is not affected by any of this — it is too narrow, so it always shows
“now / next class”; once today's classes are done it reports the next upcoming one, matching
the desktop list.

### Opacity: panel and cards separately

Two independent 0–100% sliders on the *Appearance* page:

- **Background opacity** — the widget's own panel. At 0 only the content floats on the
  desktop.
- **Card opacity** — the fill of the course cards (the whole agenda panel in the timeline
  layout). At 0 the cards are invisible and only the text and the course colour bar remain,
  which suits “just some text on a panel” or “no panel at all, text straight on the
  wallpaper”.

**Text and the course colour bar always stay opaque** — only the surface fades. Fading the
text too would smear course names across a light wallpaper and make them unreadable; this is
deliberate. The weekly grid ignores card opacity, since its blocks *are* colour swatches.

The panel is drawn by the widget itself (using the desktop theme's `widgets/background`
frame, the same element the desktop containment draws), so the opacity is exact. The
trade-off: Plasma's own “Background” toggle in the widget's context menu no longer applies —
the config page has an equivalent but finer control.

## Settings

- **Term start date** — decides week numbers. Filled in automatically by the ICS / WakeUp
  imports.
- **Total weeks in the term** — how far the *next week* button can go.
- **Period timetable** — one line per period, `node start-end`, `#` starts a comment. It
  determines the number of rows in the grid.

## Install

```bash
./install.sh
```

Then right-click the desktop → *Add Widgets* → search for “课程表” (or “Timetable”).

Sizing: it opens at 860×540, which is comfortable for the weekly grid (smaller and course
names wrap, and room/teacher are elided as space runs out). It also works at **240×160** if
you switch the list styles to the **compact rows** layout, where all three classes remain
visible; the weekly grid is not recommended at that size.

Uninstall:

```bash
kpackagetool6 --type Plasma/Applet --remove io.github.helloydh007.timetable
```

## Development and tests

The data layer (model + both importers) is plain JavaScript and runs without Plasma:

```bash
node tests/test-importers.js
```

229 assertions: ICS folding/TZID/odd-even weeks/UNTIL/EXDATE, WakeUp's `type` and `ownTime`
skipping, grid queries after both paths land in the same model, date labels and
cross-week disambiguation, malformed input, and degradation when the config JSON is
hand-edited into garbage.

### Two design decisions worth knowing

**Matching happens by date; week numbers are only a display label.** The importers expand a
course into “week N + weekday”, but whether a given day has class is decided by date. That
way a wrong term start date does not move classes to other days — only the week number in
the corner is wrong.

**`timetableData` is owned by exactly one config page.** Each KCM page holds its own copies
of the `cfg_` properties, and if two pages write the same key, whichever is written last
overwrites the other's changes entirely — import a timetable on one page, change a setting
on the other, and the import is gone. So the term start date, total weeks and period
timetable (all of which the importers write) live on the same page as the courses.

## License

GPL-2.0+, see [LICENSE](LICENSE).

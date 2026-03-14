"use strict";

var WEEKS = 6;
var DAYS = WEEKS * 7;
var WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Returns the Sunday on or before the 1st of the given month.
function getGridStart(year, month) {
    var first = new Date(year, month, 1);
    var dow = first.getDay();
    var start = new Date(first);
    start.setDate(start.getDate() - dow);
    return start;
}

// Check if two dates are the same calendar day.
function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

// Build an array of day objects for the 6-week grid.
function buildDays(year, month) {
    var start = getGridStart(year, month);
    var today = new Date();
    var days = [];
    for (var i = 0; i < DAYS; i++) {
        var d = new Date(start);
        d.setDate(start.getDate() + i);
        days.push({
            date: d,
            label: d.getDate(),
            inMonth: d.getMonth() === month && d.getFullYear() === year,
            isToday: isSameDay(d, today),
            annotation: getDayAnnotation(d)
        });
    }
    return days;
}

// Render day cells into a grid layer element, optionally with stagger.
function renderGrid(layer, days, stagger) {
    layer.innerHTML = "";
    days.forEach(function(day, i) {
        var cell = document.createElement("div");
        cell.className = "day" +
            (day.inMonth ? " in-month" : " out-month") +
            (day.isToday ? " today" : "");
        cell.dataset.date = day.date.getFullYear() + "-" +
            String(day.date.getMonth() + 1).padStart(2, "0") + "-" +
            String(day.date.getDate()).padStart(2, "0");
        var label = document.createElement("span");
        label.className = "day-label";
        label.textContent = day.label;
        cell.appendChild(label);

        var annWrap = document.createElement("span");
        annWrap.className = "day-annotation";
        cell.appendChild(annWrap);

        if (day.annotation) {
            var dot = document.createElement("span");
            dot.className = "ann-" + day.annotation.shape +
                " ann-" + day.annotation.color;
            annWrap.appendChild(dot);
        }

        if (stagger) {
            cell.classList.add("cell-enter");
            var row = Math.floor(i / 7);
            var col = i % 7;
            var delay = (row * 7 + col) * cssVar("--stagger-step");
            cell.style.animationDelay = delay + "ms";
        }

        layer.appendChild(cell);
    });
}

// Finalize a grid layer as the current one (DOM cleanup only).
function finalizeGrid(gridViewport, state, layer) {
    layer.classList.remove(
        "slide-out-left", "slide-out-right",
        "slide-in-left", "slide-in-right"
    );
    layer.classList.add("current");
    layer.querySelectorAll(".cell-enter").forEach(function(cell) {
        cell.classList.remove("cell-enter");
        cell.style.animationDelay = "";
    });

    Array.from(gridViewport.querySelectorAll(".grid-layer")).forEach(
        function(el) {
            if (el !== layer) el.remove();
        }
    );

    state.grid = layer;
    gridViewport.style.height = layer.offsetHeight + "px";
}

// Transition the calendar grid to a new month. Returns the incoming layer.
function transitionGrid(gridViewport, state, year, month, direction) {
    var newDays = buildDays(year, month);
    var outgoing = state.grid;

    var incoming = document.createElement("div");
    incoming.className = "grid-layer";
    renderGrid(incoming, newDays, true);
    gridViewport.appendChild(incoming);

    var outClass = direction > 0 ? "slide-out-left" : "slide-out-right";
    var inClass = direction > 0 ? "slide-in-right" : "slide-in-left";

    requestAnimationFrame(function() {
        outgoing.classList.add(outClass);
        incoming.classList.add(inClass);
    });

    return incoming;
}

// Initialize the calendar: build weekday headers and render the first month.
function initCalendar(weekdaysRow, state, year, month) {
    WEEKDAY_LABELS.forEach(function(label) {
        var span = document.createElement("span");
        span.textContent = label;
        weekdaysRow.appendChild(span);
    });

    var days = buildDays(year, month);
    renderGrid(state.grid, days, true);
}

// Bind keyboard, wheel and touch navigation to the calendar element.
function bindCalendarNavigation(calendarEl, onPrev, onNext) {
    // Keyboard navigation.
    document.addEventListener("keydown", function(e) {
        if (e.key === "ArrowLeft") onPrev();
        else if (e.key === "ArrowRight") onNext();
    });

    // Scroll wheel navigation (debounced).
    var wheelAccum = 0;
    var wheelTimer = null;
    var WHEEL_THRESHOLD = 60;

    calendarEl.addEventListener("wheel", function(e) {
        e.preventDefault();
        wheelAccum += e.deltaY;

        if (Math.abs(wheelAccum) >= WHEEL_THRESHOLD) {
            if (wheelAccum > 0) onNext();
            else onPrev();
            wheelAccum = 0;
        }

        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(function() {
            wheelAccum = 0;
        }, 200);
    }, {passive: false});

    // Touch swipe support.
    var touchStartX = 0;
    var touchStartY = 0;

    calendarEl.addEventListener("touchstart", function(e) {
        touchStartX = e.changedTouches[0].clientX;
        touchStartY = e.changedTouches[0].clientY;
    }, {passive: true});

    // Prevent vertical scrolling during touch on iOS Safari.
    calendarEl.addEventListener("touchmove", function(e) {
        e.preventDefault();
    }, {passive: false});

    calendarEl.addEventListener("touchend", function(e) {
        var dx = e.changedTouches[0].clientX - touchStartX;
        var dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx < 0) onNext();
            else onPrev();
        }
    }, {passive: true});
}

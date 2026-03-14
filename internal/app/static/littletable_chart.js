"use strict";

// Maximum cycle length displayed. Values above this show as "40+".
var MAX_CYCLE = 40;

// Build chart data for the last 12 cycles whose start date is on or before
// the last day of the given (year, month).
function buildChartData(year, month) {
    var endDate = new Date(year, month + 1, 0); // last day of the month

    // Collect every cycle that starts on or before endDate.
    var eligible = [];
    var lastEligibleDate = null;
    for (var i = 0; i < cycleData.length; i++) {
        if (cycleData[i] <= endDate) {
            var len = cycleLength(i);
            var projected = false;
            if (len === null) {
                // Ongoing cycle — use the average as the projected length.
                len = getAvgCycleLength();
                projected = true;
            }
            var s = cycleData[i];
            eligible.push({
                key: s.getFullYear() + "-" +
                    String(s.getMonth() + 1).padStart(2, "0") + "-" +
                    String(s.getDate()).padStart(2, "0"),
                label: SHORT_MONTHS[s.getMonth()],
                value: len,
                projected: projected
            });
            lastEligibleDate = s;
        }
    }

    // Take the last 12.
    var last = eligible.slice(-12);

    // If the viewed month is past the last cycle's start month, shift bars
    // left by one per extra month so the chart scrolls into the future.
    if (lastEligibleDate) {
        var futureOffset = (year - lastEligibleDate.getFullYear()) * 12 +
            (month - lastEligibleDate.getMonth());
        if (futureOffset > 1) {
            var shift = Math.min(futureOffset - 1, last.length);
            last = last.slice(shift);
            for (var j = 0; j < shift; j++) {
                last.push({
                    key: "future-" + j,
                    label: "",
                    value: null,
                    projected: false
                });
            }
        }
    }

    // Pad with empty slots at the front if needed.
    while (last.length < 12) {
        last.unshift({
            key: "empty-" + last.length,
            label: "",
            value: null,
            projected: false
        });
    }
    return last;
}

// Compute bar height percentage (capped at MAX_CYCLE).
function barPct(value) {
    return (Math.min(value, MAX_CYCLE) / MAX_CYCLE) * 85;
}

// Format a value label.
function formatValue(value) {
    return value > MAX_CYCLE ? MAX_CYCLE + "+" : String(value);
}

// Compute average from bars (excluding projected). Returns { pct, label } or null.
function computeAvg(bars) {
    var values = bars
        .filter(function(b) {return b.value !== null && !b.projected;})
        .map(function(b) {return b.value;});
    if (!values.length) return null;
    var avg = Math.round(
        values.reduce(function(a, b) {return a + b;}, 0) / values.length
    );
    var capped = Math.min(avg, MAX_CYCLE);
    var pct = (capped / MAX_CYCLE) * 85;
    var label = avg > MAX_CYCLE ? "avg " + MAX_CYCLE + "+" : "avg " + avg;
    return {pct: pct, label: label};
}

// Create a single bar-slot element.
function createBarSlot(bar, stagger, index) {
    var slot = document.createElement("div");
    slot.className = "bar-slot";

    if (bar.value !== null) {
        var barEl = document.createElement("div");
        barEl.className = "bar" + (bar.projected ? " projected" : "");
        barEl.style.height = barPct(bar.value) + "%";
        barEl.style.transformOrigin = "bottom";

        var valEl = document.createElement("div");
        valEl.className = "bar-value";
        valEl.textContent = formatValue(bar.value);
        barEl.appendChild(valEl);

        if (stagger) {
            barEl.classList.add("bar-enter");
            barEl.style.animationDelay = (index * 30) + "ms";
        }

        slot.appendChild(barEl);
    } else {
        var spacer = document.createElement("div");
        spacer.style.flex = "1";
        slot.appendChild(spacer);
    }

    return slot;
}

// Render a chart layer with bars and average line.
function renderChart(layer, bars, stagger) {
    layer.innerHTML = "";

    var avgData = computeAvg(bars);

    var barArea = document.createElement("div");
    barArea.className = "chart-bar-area";

    var barTrack = document.createElement("div");
    barTrack.className = "bar-track";

    bars.forEach(function(bar, i) {
        barTrack.appendChild(createBarSlot(bar, stagger, i));
    });

    barArea.appendChild(barTrack);

    // Average line and label — in a separate overlay so they don't
    // collide with bars during slide transitions.
    if (avgData) {
        var avgOverlay = document.createElement("div");
        avgOverlay.className = "chart-avg-overlay";

        var line = document.createElement("div");
        line.className = "avg-line";
        line.style.bottom = avgData.pct + "%";
        avgOverlay.appendChild(line);

        var label = document.createElement("div");
        label.className = "avg-label";
        label.style.bottom = avgData.pct + "%";
        label.textContent = avgData.label;
        avgOverlay.appendChild(label);

        layer.appendChild(avgOverlay);
    }

    layer.appendChild(barArea);
}

// Finalize a chart transition by re-rendering to the clean state.
function finalizeChart(chartViewport, state, transition) {
    if (transition.skip) return;
    renderChart(
        state.chart,
        buildChartData(transition.year, transition.month),
        false
    );
}

// Transition the chart with a conveyor-belt effect.
function transitionChart(chartViewport, state, year, month, direction, oldYear, oldMonth) {
    var oldBars = buildChartData(oldYear, oldMonth);
    var newBars = buildChartData(year, month);

    // Compare only non-empty (real cycle) keys so that padding slots
    // don't interfere with the diff.
    var oldRealKeys = oldBars
        .filter(function(b) {return b.value !== null;})
        .map(function(b) {return b.key;});
    var newRealKeys = newBars
        .filter(function(b) {return b.value !== null;})
        .map(function(b) {return b.key;});

    if (oldRealKeys.join(",") === newRealKeys.join(",")) {
        // Same set of cycles — nothing to slide.
        return {skip: true};
    }

    // Count non-empty keys added and removed.
    var oldRealKeySet = {};
    oldRealKeys.forEach(function(k) {oldRealKeySet[k] = true;});
    var newRealKeySet = {};
    newRealKeys.forEach(function(k) {newRealKeySet[k] = true;});

    var added = newRealKeys.filter(function(k) {return !oldRealKeySet[k];}).length;
    var removed = oldRealKeys.filter(function(k) {return !newRealKeySet[k];}).length;
    var absDiff = Math.max(added, removed);

    // For large jumps or degenerate cases, re-render immediately.
    if (absDiff === 0 || absDiff > 12) {
        renderChart(state.chart, newBars, false);
        return {skip: true};
    }

    var layer = state.chart;
    var barTrack = layer.querySelector(".bar-track");
    var barArea = layer.querySelector(".chart-bar-area");
    var avgOverlay = layer.querySelector(".chart-avg-overlay");
    var avgLine = avgOverlay ? avgOverlay.querySelector(".avg-line") : null;
    var avgLabel = avgOverlay ? avgOverlay.querySelector(".avg-label") : null;
    var slots = Array.from(barTrack.querySelectorAll(".bar-slot"));

    // Measure sub-pixel slot width and pitch from the live layout.
    var firstRect = slots[0].getBoundingClientRect();
    var slotW = firstRect.width;
    var pitch = slots.length > 1
        ? slots[1].getBoundingClientRect().left - firstRect.left
        : slotW + 6;

    // Record where the first slot actually sits before layout change.
    var origLeft = firstRect.left;

    // Fix widths using sub-pixel values so nothing shifts on reflow.
    var fixedW = slotW + "px";
    slots.forEach(function(s) {s.style.width = fixedW; s.style.flex = "none";});

    // Switch to left-aligned so prepend/append does not shift existing items.
    barTrack.style.justifyContent = "flex-start";

    // Force reflow and measure how far slot[0] moved.
    void barTrack.offsetWidth;
    var movedLeft = slots[0].getBoundingClientRect().left;
    var centerOffset = origLeft - movedLeft;

    // Apply compensating transform so bars stay visually in place.
    barTrack.style.transform = "translateX(" + centerOffset + "px)";

    // Build new data and compute new average.
    var newAvg = computeAvg(newBars);

    var trans = "transform var(--transition-duration) cubic-bezier(0.4, 0, 0.2, 1)";

    if (direction > 0) {
        // Forward: append new bars at right, slide left.
        for (var i = 12 - absDiff; i < 12; i++) {
            var ns = createBarSlot(newBars[i], false, 0);
            ns.style.width = fixedW;
            ns.style.flex = "none";
            barTrack.appendChild(ns);
        }

        var targetX = centerOffset - absDiff * pitch;

        // Force reflow so the browser commits the appended items.
        void barTrack.offsetWidth;

        barTrack.style.transition = trans;
        barTrack.style.transform = "translateX(" + targetX + "px)";

        // Animate average line to new position.
        if (newAvg && avgLine && avgLabel) {
            avgLine.style.bottom = newAvg.pct + "%";
            avgLabel.style.bottom = newAvg.pct + "%";
            avgLabel.textContent = newAvg.label;
        }
    } else {
        // Backward: prepend new bars at left, slide right.
        for (var i = absDiff - 1; i >= 0; i--) {
            var ns = createBarSlot(newBars[i], false, 0);
            ns.style.width = fixedW;
            ns.style.flex = "none";
            barTrack.insertBefore(ns, barTrack.firstChild);
        }

        // Shift left to keep old bars visually in place after prepend.
        var startX = centerOffset - absDiff * pitch;
        barTrack.style.transform = "translateX(" + startX + "px)";

        // Force reflow so the browser commits the start position.
        void barTrack.offsetWidth;

        barTrack.style.transition = trans;
        barTrack.style.transform = "translateX(" + centerOffset + "px)";

        // Animate average line to new position.
        if (newAvg && avgLine && avgLabel) {
            avgLine.style.bottom = newAvg.pct + "%";
            avgLabel.style.bottom = newAvg.pct + "%";
            avgLabel.textContent = newAvg.label;
        }
    }

    return {year: year, month: month, skip: false};
}

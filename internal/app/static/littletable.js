"use strict";

// Month name constants derived from the browser's locale.
var MONTH_NAMES = Array.from({length: 12}, function(_, i) {
    return new Date(2000, i).toLocaleString(undefined, {month: "long"});
});

var SHORT_MONTHS = Array.from({length: 12}, function(_, i) {
    return new Date(2000, i).toLocaleString(undefined, {month: "short"});
});

// Read a CSS custom property value as a number.
function cssVar(name) {
    return parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(name)
    );
}

// Cycle data — a sorted array of Dates, each marking the start of a cycle.
// Populated from the API at startup.
var cycleData = [];

// Strategy for the current token. Populated from the API at startup.
var cycleStrategy = "";

// Extract the token from the current page URL.
function getToken() {
    return new URLSearchParams(window.location.search).get("token") || "";
}

// Format a Date as YYYY-MM-DD.
function formatDate(d) {
    return d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
}

// Parse a YYYY-MM-DD string into a local Date.
function parseDate(s) {
    var parts = s.split("-");
    return new Date(
        parseInt(parts[0], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[2], 10)
    );
}

// Load cycle data from the API.
function loadCycleData(callback, options) {
    options = options || {};
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/cycles?token=" + encodeURIComponent(getToken()));
    if (options.forceNetwork) {
        xhr.setRequestHeader("X-Littletable-Network-Only", "1");
    }
    xhr.onload = function() {
        if (xhr.status !== 200) {
            callback(false, false);
            return;
        }

        try {
            var resp = JSON.parse(xhr.responseText);
            cycleStrategy = resp.strategy;
            cycleData = resp.dates.map(parseDate);
            callback(
                true,
                xhr.getResponseHeader("X-Littletable-Cycles-Source") === "cache"
            );
        } catch (_) {
            callback(false, false);
        }
    };
    xhr.onerror = function() {callback(false, false);};
    xhr.send();
}

// Add a cycle start date via the API.
function addCycleStart(date, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/start?token=" + encodeURIComponent(getToken()));
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = function() {
        callback(xhr.status >= 200 && xhr.status < 300);
    };
    xhr.onerror = function() {callback(false);};
    xhr.send(JSON.stringify(formatDate(date)));
}

// Remove a cycle start date via the API.
function removeCycleStart(date, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("DELETE", "/start?token=" + encodeURIComponent(getToken()));
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = function() {
        callback(xhr.status >= 200 && xhr.status < 300);
    };
    xhr.onerror = function() {callback(false);};
    xhr.send(JSON.stringify(formatDate(date)));
}

// Return the length (in days) of cycle at index i, or null if ongoing/invalid.
function cycleLength(i) {
    if (i < 0 || i >= cycleData.length - 1) return null;
    return Math.round((cycleData[i + 1] - cycleData[i]) / 86400000);
}

var DEFAULT_CYCLE_LENGTH = 28;

// Compute the average cycle length from the last 12 completed cycles.
function getAvgCycleLength() {
    var sum = 0;
    var count = 0;
    // All cycles except the last (ongoing) are completed.
    var start = Math.max(0, cycleData.length - 1 - 12);
    for (var i = start; i < cycleData.length - 1; i++) {
        var len = cycleLength(i);
        if (len !== null) {
            sum += len;
            count++;
        }
    }
    return count > 0 ? Math.round(sum / count) : DEFAULT_CYCLE_LENGTH;
}

// Return the projected next cycle: { start, len } or null.
function getProjectedCycle() {
    if (cycleData.length < 1) return null;
    var avg = getAvgCycleLength();
    // Current (last) cycle's projected end = its start + avg.
    var currentStart = cycleData[cycleData.length - 1];
    var nextStart = new Date(currentStart);
    nextStart.setDate(nextStart.getDate() + avg);
    return {start: nextStart, len: avg};
}

// Look up the cycle length for the cycle that starts in a given month.
// Returns { value, projected } or { value: null }.
function getCycleLengthForMonth(year, month) {
    for (var i = 0; i < cycleData.length; i++) {
        var s = cycleData[i];
        if (s.getFullYear() === year && s.getMonth() === month) {
            var len = cycleLength(i);
            if (len !== null) {
                return {value: len, projected: false};
            }
            // Ongoing cycle — use the average as the projected length.
            var avg = getAvgCycleLength();
            return {value: avg, projected: true};
        }
    }
    return {value: null, projected: false};
}

// Get the annotation for a date based on cycle data and strategy.
// Returns { color: "red"|"yellow"|"green", shape: "dot"|"rect"|"drop" } or null.
function getDayAnnotation(date) {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Find the cycle that contains this date (search backwards).
    for (var i = cycleData.length - 1; i >= 0; i--) {
        if (cycleData[i] <= date) {
            var len = cycleLength(i); // null for the last (ongoing) cycle.
            var isCompleted = (len !== null);

            // For the ongoing cycle, use the average as the expected length.
            if (!isCompleted) {
                len = getAvgCycleLength();
            }

            var dayInCycle = Math.floor((date - cycleData[i]) / 86400000);
            if (dayInCycle >= len) break; // Past the end of this cycle.

            var color = getDayColor(dayInCycle, len, cycleStrategy);

            // Mark the cycle start with a drop; keep legacy shapes for other days.
            var shape = dayInCycle === 0 ? "drop" : (isCompleted ? "rect" : "dot");
            return {color: color, shape: shape};
        }
    }

    return null;
}

// Determine the color for a day based on its position in the cycle and the
// active strategy.
function getDayColor(dayInCycle, cycleLen, strategy) {
    if (dayInCycle < 7) return "red";

    // Mid-cycle window parameters depend on the strategy.
    var midWindowSize;
    if (strategy === "avoid-pregnancy-zealous") {
        midWindowSize = 14;
    } else {
        midWindowSize = 6;
    }

    var midStart = Math.floor(cycleLen / 2) - Math.floor(midWindowSize / 2);
    if (midStart < 7) midStart = 7;
    var midEnd = midStart + midWindowSize;

    var inMidWindow = dayInCycle >= midStart && dayInCycle < midEnd;

    if (strategy === "pregnancy") {
        // Mid-cycle is fertile (green), rest is yellow.
        return inMidWindow ? "green" : "yellow";
    }
    // avoid-pregnancy and avoid-pregnancy-zealous.
    // Mid-cycle is risky (yellow), rest is safe (green).
    return inMidWindow ? "yellow" : "green";
}

// Application initialization — called after all other scripts are loaded.
function initApp() {
    initUI();
}

function initUI() {
    var LOAD_ERROR_MESSAGE = "✖ Error loading cycles";
    var SAVE_ERROR_MESSAGE = "✖ Error saving cycle";
    var LOADING_TEXT = "Loading...";
    var SAVING_TEXT = "Saving...";
    var OFFLINE_ERROR_MESSAGE =
        "Cycle dates cannot be changed when you are offline.";

    // State.
    var currentYear;
    var currentMonth;
    var targetYear;
    var targetMonth;
    var transitionCleanup = null;
    var mutationInFlight = false;
    var touchTapCount = 0;
    var touchTapLastAt = 0;
    var touchTapLastDate = "";
    var suppressClickUntil = 0;

    var TOUCH_TAP_WINDOW_MS = 420;
    var TOUCH_CLICK_SUPPRESS_MS = 700;

    // DOM references.
    var monthLabel = document.getElementById("monthLabel");
    var yearLabel = document.getElementById("yearLabel");
    var gridViewport = document.getElementById("gridViewport");
    var chartViewport = document.getElementById("chartViewport");
    var headerStatus = document.getElementById("headerStatus");
    var headerStatusText = document.getElementById("headerStatusText");
    var startupOverlay = document.getElementById("startupOverlay");
    var startupOverlayText = document.getElementById("startupOverlayText");
    var mutationErrorDialog = document.getElementById("mutationErrorDialog");
    var mutationErrorTitle = document.getElementById("mutationErrorTitle");
    var mutationErrorCloseBtn = document.getElementById("mutationErrorCloseBtn");

    // Mutable reference to the active grid and chart layers.
    var state = {
        grid: document.getElementById("gridCurrent"),
        chart: document.getElementById("chartCurrent")
    };

    var cyclesLoadInFlight = false;
    var headerStatusClearTimer = null;
    var initialAssetsReady = document.readyState === "complete";
    var initialCyclesReady = false;

    if (startupOverlayText) {
        startupOverlayText.textContent = LOADING_TEXT;
    }

    function maybeHideStartupOverlay() {
        if (!startupOverlay) return;
        if (!initialAssetsReady || !initialCyclesReady) return;
        startupOverlay.classList.add("hidden");
    }

    function cancelHeaderStatusClear() {
        if (headerStatusClearTimer !== null) {
            clearTimeout(headerStatusClearTimer);
            headerStatusClearTimer = null;
        }
    }

    function clearHeaderStatus() {
        if (!headerStatus || !headerStatusText) return;
        cancelHeaderStatusClear();
        headerStatus.classList.remove("visible");
        headerStatusClearTimer = setTimeout(function() {
            headerStatus.classList.remove("error");
            headerStatusText.textContent = "";
            headerStatusClearTimer = null;
        }, 130);
    }

    function showHeaderLoading(text) {
        if (!headerStatus || !headerStatusText) return;
        cancelHeaderStatusClear();
        headerStatus.classList.add("visible");
        headerStatus.classList.remove("error");
        headerStatusText.textContent = text || LOADING_TEXT;
    }

    function showHeaderError(message) {
        if (!headerStatus || !headerStatusText) return;
        cancelHeaderStatusClear();
        headerStatus.classList.add("visible");
        headerStatus.classList.add("error");
        headerStatusText.textContent = message;
    }

    function updateHeader(year, month) {
        monthLabel.textContent = MONTH_NAMES[month];
        yearLabel.textContent = year;
        monthLabel.style.opacity = "1";
        yearLabel.style.opacity = "1";
    }

    function syncGridHeight() {
        gridViewport.style.height = state.grid.offsetHeight + "px";
    }

    function setActiveMonth(year, month) {
        currentYear = year;
        currentMonth = month;
        targetYear = year;
        targetMonth = month;
        updateHeader(year, month);
    }

    function renderCurrentViews() {
        var days = buildDays(currentYear, currentMonth);
        renderGrid(state.grid, days, false);
        var bars = buildChartData(currentYear, currentMonth);
        renderChart(state.chart, bars, false);
        syncGridHeight();
    }

    function showMutationErrorDialog(message) {
        if (mutationErrorTitle && message) {
            mutationErrorTitle.textContent = message;
        }
        if (mutationErrorDialog && !mutationErrorDialog.open) {
            mutationErrorDialog.showModal();
        }
    }

    function showBusyShake() {
        document.body.classList.remove("page-busy-shake");
        // Force reflow so repeated interactions can replay the animation.
        void document.body.offsetWidth;
        document.body.classList.add("page-busy-shake");
    }

    function parseCellDate(cell) {
        var parts = cell.dataset.date.split("-");
        return new Date(
            parseInt(parts[0], 10),
            parseInt(parts[1], 10) - 1,
            parseInt(parts[2], 10)
        );
    }

    function findCycleStartIndex(date) {
        for (var i = 0; i < cycleData.length; i++) {
            if (cycleData[i].getTime() === date.getTime()) {
                return i;
            }
        }
        return -1;
    }

    function applyOptimisticMutation(newStart) {
        var foundIndex = findCycleStartIndex(newStart);
        var found = foundIndex !== -1;

        if (found) {
            cycleData.splice(foundIndex, 1);
        } else {
            cycleData.push(newStart);
            cycleData.sort(function(a, b) {return a - b;});
        }

        renderCurrentViews();
        return {found: found, foundIndex: foundIndex};
    }

    function rollbackOptimisticMutation(newStart, mutation) {
        if (mutation.found) {
            cycleData.splice(mutation.foundIndex, 0, newStart);
        } else {
            var rollbackIndex = findCycleStartIndex(newStart);
            if (rollbackIndex !== -1) {
                cycleData.splice(rollbackIndex, 1);
            }
        }

        renderCurrentViews();
    }

    function wireErrorDialog() {
        if (mutationErrorCloseBtn && mutationErrorDialog) {
            mutationErrorCloseBtn.addEventListener("click", function() {
                mutationErrorDialog.close();
            });
        }
    }

    // Cancel any running transition and snap to its target state.
    function cancelTransition() {
        if (!transitionCleanup) return;
        transitionCleanup();
        transitionCleanup = null;
    }

    // Navigate to a given month with a directional slide animation.
    function goTo(year, month, direction) {
        if (year === targetYear && month === targetMonth) return;

        if (transitionCleanup) {
            cancelTransition();
        }

        targetYear = year;
        targetMonth = month;

        // Start chart transition.
        var chartTransition = transitionChart(
            chartViewport, state, year, month, direction,
            currentYear, currentMonth
        );

        // Start calendar transition.
        var calIncoming = transitionGrid(
            gridViewport, state, year, month, direction
        );

        monthLabel.style.opacity = "0";
        yearLabel.style.opacity = "0";

        var cssDuration = cssVar("--transition-duration");
        var cssStagger = cssVar("--stagger-step");

        // Track timers so they can be cancelled.
        var headerTimer = null;
        var finishTimer = null;
        var cancelled = false;

        requestAnimationFrame(function() {
            if (cancelled) return;

            headerTimer = setTimeout(function() {
                if (cancelled) return;
                monthLabel.textContent = MONTH_NAMES[month];
                yearLabel.textContent = year;
                monthLabel.style.opacity = "1";
                yearLabel.style.opacity = "1";
            }, cssDuration * 0.4);
        });

        var totalDuration = cssDuration + DAYS * cssStagger;

        finishTimer = setTimeout(function() {
            if (cancelled) return;
            finalizeGrid(gridViewport, state, calIncoming);
            finalizeChart(chartViewport, state, chartTransition);
            setActiveMonth(year, month);
            transitionCleanup = null;
        }, totalDuration + 60);

        // Store cleanup so this transition can be interrupted.
        transitionCleanup = function() {
            cancelled = true;
            clearTimeout(headerTimer);
            clearTimeout(finishTimer);
            finalizeGrid(gridViewport, state, calIncoming);
            finalizeChart(chartViewport, state, chartTransition);
            setActiveMonth(year, month);
        };
    }

    function goToPrev() {
        var y = targetYear;
        var m = targetMonth - 1;
        if (m < 0) {m = 11; y--;}
        goTo(y, m, -1);
    }

    function goToNext() {
        var y = targetYear;
        var m = targetMonth + 1;
        if (m > 11) {m = 0; y++;}
        goTo(y, m, 1);
    }

    function goToToday() {
        var now = new Date();
        var y = now.getFullYear();
        var m = now.getMonth();
        if (y === targetYear && m === targetMonth) return;
        var direction = (y * 12 + m) > (targetYear * 12 + targetMonth)
            ? 1 : -1;
        goTo(y, m, direction);
    }

    function wireNavigation() {
        // Button events.
        document.getElementById("prevBtn").addEventListener("click", goToPrev);
        document.getElementById("nextBtn").addEventListener("click", goToNext);
        document.getElementById("todayBtn").addEventListener("click", goToToday);

        // Keyboard, wheel and touch navigation.
        bindCalendarNavigation(
            document.getElementById("calendar"), goToPrev, goToNext
        );
    }

    function initCurrentMonth() {
        var now = new Date();
        currentYear = now.getFullYear();
        currentMonth = now.getMonth();
        targetYear = currentYear;
        targetMonth = currentMonth;
    }

    function renderInitialUI() {
        initCalendar(
            document.getElementById("weekdays"), state, currentYear, currentMonth
        );
        updateHeader(currentYear, currentMonth);

        var initialBars = buildChartData(currentYear, currentMonth);
        renderChart(state.chart, initialBars, true);

        setTimeout(function() {
            syncGridHeight();
            document.getElementById("prevBtn").classList.remove("nav-btn-loading");
            document.getElementById("nextBtn").classList.remove("nav-btn-loading");
        }, cssVar("--transition-duration"));
    }

    function wireResizeSync() {
        window.addEventListener("resize", function() {
            syncGridHeight();
        });
    }

    function loadAndRenderCycles(allowRefreshFromCache) {
        if (cyclesLoadInFlight) return;

        cyclesLoadInFlight = true;
        showHeaderLoading();

        loadCycleData(function(ok, fromCache) {
            if (!ok) {
                cyclesLoadInFlight = false;
                showHeaderError(LOAD_ERROR_MESSAGE);
                return;
            }

            renderCurrentViews();
            initialCyclesReady = true;
            maybeHideStartupOverlay();

            if (allowRefreshFromCache && fromCache) {
                loadCycleData(function(refreshOK) {
                    cyclesLoadInFlight = false;
                    if (!refreshOK) {
                        showHeaderError(LOAD_ERROR_MESSAGE);
                        return;
                    }

                    renderCurrentViews();
                    clearHeaderStatus();
                }, {forceNetwork: true});
                return;
            }

            cyclesLoadInFlight = false;
            clearHeaderStatus();
        });
    }

    function onMutationDone(newStart, mutation, ok) {
        mutationInFlight = false;
        if (ok) {
            // Re-fetch cycles so the service worker caches the updated data.
            loadAndRenderCycles(false);
            return;
        }

        rollbackOptimisticMutation(newStart, mutation);
        showHeaderError(SAVE_ERROR_MESSAGE);
    }

    function applyCycleStartMutation(cell) {
        if (navigator.onLine === false) {
            showMutationErrorDialog(OFFLINE_ERROR_MESSAGE);
            return;
        }

        if (mutationInFlight) {
            showBusyShake();
            return;
        }

        var newStart = parseCellDate(cell);
        var mutation = applyOptimisticMutation(newStart);
        mutationInFlight = true;
        showHeaderLoading(SAVING_TEXT);

        var done = function(ok) {
            onMutationDone(newStart, mutation, ok);
        };

        if (mutation.found) {
            removeCycleStart(newStart, done);
        } else {
            addCycleStart(newStart, done);
        }
    }

    function resetTouchTapSequence() {
        touchTapCount = 0;
        touchTapLastAt = 0;
        touchTapLastDate = "";
    }

    function getTouchEndCell(e) {
        if (!e.changedTouches || e.changedTouches.length === 0) return null;
        var touch = e.changedTouches[0];
        var el = document.elementFromPoint(touch.clientX, touch.clientY);
        return el ? el.closest(".day") : null;
    }

    function handleTripleTapTouch(e) {
        var cell = getTouchEndCell(e);
        if (!cell || !cell.dataset.date) {
            resetTouchTapSequence();
            return;
        }

        var now = Date.now();
        var dateKey = cell.dataset.date;
        var isSameCell = dateKey === touchTapLastDate;
        var isWithinWindow = (now - touchTapLastAt) <= TOUCH_TAP_WINDOW_MS;

        suppressClickUntil = now + TOUCH_CLICK_SUPPRESS_MS;

        if (isSameCell && isWithinWindow) {
            touchTapCount++;
        } else {
            touchTapCount = 1;
        }

        touchTapLastDate = dateKey;
        touchTapLastAt = now;

        if (touchTapCount === 3) {
            resetTouchTapSequence();
            applyCycleStartMutation(cell);
        }
    }

    function handleTripleClick(e) {
        if (Date.now() < suppressClickUntil) return;
        if (e.detail !== 3) return;

        var cell = e.target.closest(".day");
        if (!cell || !cell.dataset.date) return;

        applyCycleStartMutation(cell);
    }

    function setupServiceWorker() {
        if (!("serviceWorker" in navigator)) return;

        function cacheAppURLs() {
            var urls = [
                window.location.href,
                "/cycles?token=" + encodeURIComponent(getToken()),
            ];
            var sw = navigator.serviceWorker.controller;
            if (sw) {
                urls.forEach(function(u) {
                    sw.postMessage({type: "cache-page", url: u});
                });
            } else {
                navigator.serviceWorker.addEventListener("controllerchange", function() {
                    urls.forEach(function(u) {
                        navigator.serviceWorker.controller.postMessage(
                            {type: "cache-page", url: u}
                        );
                    });
                }, {once: true});
            }
        }

        function registerServiceWorker() {
            navigator.serviceWorker.register("/static/sw.js", {scope: "/"})
                .then(cacheAppURLs)
                .catch(function(err) {
                    console.warn("Service worker registration failed:", err);
                });
        }

        if (document.readyState === "complete") {
            registerServiceWorker();
            return;
        }

        window.addEventListener("load", registerServiceWorker, {once: true});
    }

    wireNavigation();
    initCurrentMonth();
    renderInitialUI();
    wireResizeSync();
    wireErrorDialog();
    setupServiceWorker();
    loadAndRenderCycles(true);

    if (!initialAssetsReady) {
        window.addEventListener("load", function() {
            initialAssetsReady = true;
            maybeHideStartupOverlay();
        }, {once: true});
    } else {
        maybeHideStartupOverlay();
    }

    // Triple-click/triple-tap on a day cell to mark that date as a new cycle start.
    gridViewport.addEventListener("click", handleTripleClick);
    gridViewport.addEventListener("touchend", handleTripleTapTouch, {passive: true});
}

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

// --- UI constants ---

var LOAD_ERROR_MESSAGE = "✖︎ Error loading cycles";
var SAVE_ERROR_MESSAGE = "✖︎ Error saving cycle";
var LOADING_TEXT = "Loading...";
var SAVING_TEXT = "Saving...";
var OFFLINE_ERROR_MESSAGE =
    "Cycle dates cannot be changed when you are offline.";
var TOUCH_TAP_WINDOW_MS = 420;
var TOUCH_CLICK_SUPPRESS_MS = 700;

// Shared UI state — populated by initUI().
var ui = null;

function createUIState() {
    return {
        currentYear: 0,
        currentMonth: 0,
        targetYear: 0,
        targetMonth: 0,
        transitionCleanup: null,
        mutationInFlight: false,
        touchTapCount: 0,
        touchTapLastAt: 0,
        touchTapLastDate: "",
        suppressClickUntil: 0,
        cyclesLoadInFlight: false,
        headerStatusClearTimer: null,
        pendingCyclesReload: null,
        mutationVersion: 0,
        initialAssetsReady: document.readyState === "complete",
        initialCyclesReady: false,
        // DOM references.
        monthLabel: document.getElementById("monthLabel"),
        yearLabel: document.getElementById("yearLabel"),
        gridViewport: document.getElementById("gridViewport"),
        chartViewport: document.getElementById("chartViewport"),
        headerStatus: document.getElementById("headerStatus"),
        headerStatusText: document.getElementById("headerStatusText"),
        startupOverlay: document.getElementById("startupOverlay"),
        startupOverlayText: document.getElementById("startupOverlayText"),
        mutationErrorDialog: document.getElementById("mutationErrorDialog"),
        mutationErrorTitle: document.getElementById("mutationErrorTitle"),
        mutationErrorCloseBtn: document.getElementById("mutationErrorCloseBtn"),
        // Mutable reference to active grid/chart layers.
        state: {
            grid: document.getElementById("gridCurrent"),
            chart: document.getElementById("chartCurrent")
        }
    };
}

// --- Startup overlay ---

function maybeHideStartupOverlay() {
    if (!ui.startupOverlay) return;
    if (!ui.initialAssetsReady || !ui.initialCyclesReady) return;
    ui.startupOverlay.classList.add("hidden");
}

function onAssetsLoadComplete() {
    ui.initialAssetsReady = true;
    maybeHideStartupOverlay();
}

// --- Header status ---

function cancelHeaderStatusClear() {
    if (ui.headerStatusClearTimer !== null) {
        clearTimeout(ui.headerStatusClearTimer);
        ui.headerStatusClearTimer = null;
    }
}

function clearHeaderStatus() {
    if (!ui.headerStatus || !ui.headerStatusText) return;
    cancelHeaderStatusClear();
    ui.headerStatus.classList.remove("visible");
    ui.headerStatusClearTimer = setTimeout(function() {
        ui.headerStatus.classList.remove("error");
        ui.headerStatusText.textContent = "";
        ui.headerStatusClearTimer = null;
    }, 130);
}

function showHeaderLoading(text) {
    if (!ui.headerStatus || !ui.headerStatusText) return;
    cancelHeaderStatusClear();
    ui.headerStatus.classList.add("visible");
    ui.headerStatus.classList.remove("error");
    ui.headerStatusText.textContent = text || LOADING_TEXT;
}

function showHeaderError(message) {
    if (!ui.headerStatus || !ui.headerStatusText) return;
    cancelHeaderStatusClear();
    ui.headerStatus.classList.add("visible");
    ui.headerStatus.classList.add("error");
    ui.headerStatusText.textContent = message;
}

function updateHeader(year, month) {
    ui.monthLabel.textContent = MONTH_NAMES[month];
    ui.yearLabel.textContent = year;
    ui.monthLabel.style.opacity = "1";
    ui.yearLabel.style.opacity = "1";
}

// --- Grid/view helpers ---

function syncGridHeight() {
    ui.gridViewport.style.height = ui.state.grid.offsetHeight + "px";
}

function setActiveMonth(year, month) {
    ui.currentYear = year;
    ui.currentMonth = month;
    ui.targetYear = year;
    ui.targetMonth = month;
    updateHeader(year, month);
}

function renderCurrentViews() {
    var days = buildDays(ui.currentYear, ui.currentMonth);
    renderGrid(ui.state.grid, days, false);
    var bars = buildChartData(ui.currentYear, ui.currentMonth);
    renderChart(ui.state.chart, bars, false);
    syncGridHeight();
}

// --- Error dialog ---

function showMutationErrorDialog(message) {
    if (ui.mutationErrorTitle && message) {
        ui.mutationErrorTitle.textContent = message;
    }
    if (ui.mutationErrorDialog && !ui.mutationErrorDialog.open) {
        ui.mutationErrorDialog.showModal();
    }
}

function showBusyShake() {
    document.body.classList.remove("page-busy-shake");
    // Force reflow so repeated interactions can replay the animation.
    void document.body.offsetWidth;
    document.body.classList.add("page-busy-shake");
}

// --- Cycle mutation helpers ---

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

// --- Navigation ---

// Cancel any running transition and snap to its target state.
function cancelTransition() {
    if (!ui.transitionCleanup) return;
    ui.transitionCleanup();
    ui.transitionCleanup = null;
}

// Navigate to a given month with a directional slide animation.
function goTo(year, month, direction) {
    if (year === ui.targetYear && month === ui.targetMonth) return;

    if (ui.transitionCleanup) {
        cancelTransition();
    }

    ui.targetYear = year;
    ui.targetMonth = month;

    // Start chart transition.
    var chartTransition = transitionChart(
        ui.chartViewport, ui.state, year, month, direction,
        ui.currentYear, ui.currentMonth
    );

    // Start calendar transition.
    var calIncoming = transitionGrid(
        ui.gridViewport, ui.state, year, month, direction
    );

    ui.monthLabel.style.opacity = "0";
    ui.yearLabel.style.opacity = "0";

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
            ui.monthLabel.textContent = MONTH_NAMES[month];
            ui.yearLabel.textContent = year;
            ui.monthLabel.style.opacity = "1";
            ui.yearLabel.style.opacity = "1";
        }, cssDuration * 0.4);
    });

    var totalDuration = cssDuration + DAYS * cssStagger;

    finishTimer = setTimeout(function() {
        if (cancelled) return;
        finalizeGrid(ui.gridViewport, ui.state, calIncoming);
        finalizeChart(ui.chartViewport, ui.state, chartTransition);
        setActiveMonth(year, month);
        ui.transitionCleanup = null;
    }, totalDuration + 60);

    // Store cleanup so this transition can be interrupted.
    ui.transitionCleanup = function() {
        cancelled = true;
        clearTimeout(headerTimer);
        clearTimeout(finishTimer);
        finalizeGrid(ui.gridViewport, ui.state, calIncoming);
        finalizeChart(ui.chartViewport, ui.state, chartTransition);
        setActiveMonth(year, month);
    };
}

function goToPrev() {
    var y = ui.targetYear;
    var m = ui.targetMonth - 1;
    if (m < 0) {m = 11; y--;}
    goTo(y, m, -1);
}

function goToNext() {
    var y = ui.targetYear;
    var m = ui.targetMonth + 1;
    if (m > 11) {m = 0; y++;}
    goTo(y, m, 1);
}

function goToToday() {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth();
    if (y === ui.targetYear && m === ui.targetMonth) return;
    var direction = (y * 12 + m) > (ui.targetYear * 12 + ui.targetMonth)
        ? 1 : -1;
    goTo(y, m, direction);
}

// --- Cycle loading ---

function queueCyclesReload(options) {
    ui.pendingCyclesReload = {
        allowRefreshFromCache: !!options.allowRefreshFromCache,
        forceNetwork: !!options.forceNetwork,
        loadingText: options.loadingText || LOADING_TEXT,
    };
}

function runPendingCyclesReload() {
    if (!ui.pendingCyclesReload || ui.cyclesLoadInFlight) return;
    var options = ui.pendingCyclesReload;
    ui.pendingCyclesReload = null;
    loadAndRenderCycles(options);
}

function loadAndRenderCycles(options) {
    options = options || {};
    var allowRefreshFromCache = !!options.allowRefreshFromCache;
    var forceNetwork = !!options.forceNetwork;
    var loadingText = options.loadingText || LOADING_TEXT;

    if (ui.cyclesLoadInFlight) {
        queueCyclesReload({
            allowRefreshFromCache: allowRefreshFromCache,
            forceNetwork: forceNetwork,
            loadingText: loadingText,
        });
        return;
    }

    ui.cyclesLoadInFlight = true;
    showHeaderLoading(loadingText);
    var loadVersion = ui.mutationVersion;

    loadCycleData(function(ok, fromCache) {
        if (!ok) {
            ui.cyclesLoadInFlight = false;
            showHeaderError(LOAD_ERROR_MESSAGE);
            runPendingCyclesReload();
            return;
        }

        // Ignore stale loads that started before a newer mutation.
        if (loadVersion !== ui.mutationVersion) {
            ui.cyclesLoadInFlight = false;
            runPendingCyclesReload();
            return;
        }

        renderCurrentViews();
        ui.initialCyclesReady = true;
        maybeHideStartupOverlay();

        if (allowRefreshFromCache && fromCache) {
            loadCycleData(function(refreshOK) {
                ui.cyclesLoadInFlight = false;
                if (!refreshOK) {
                    showHeaderError(LOAD_ERROR_MESSAGE);
                    runPendingCyclesReload();
                    return;
                }

                // Ignore stale refreshes that started before a newer mutation.
                if (loadVersion !== ui.mutationVersion) {
                    runPendingCyclesReload();
                    return;
                }

                renderCurrentViews();
                clearHeaderStatus();
                runPendingCyclesReload();
            }, {forceNetwork: true});
            return;
        }

        ui.cyclesLoadInFlight = false;
        clearHeaderStatus();
        runPendingCyclesReload();
    }, {forceNetwork: forceNetwork});
}

// --- Mutation handling ---

function onMutationDone(newStart, mutation, ok) {
    ui.mutationInFlight = false;
    if (ok) {
        // Re-fetch cycles from network only after save/delete confirmation.
        loadAndRenderCycles({
            allowRefreshFromCache: false,
            forceNetwork: true,
            loadingText: SAVING_TEXT,
        });
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

    if (ui.mutationInFlight) {
        showBusyShake();
        return;
    }

    var newStart = parseCellDate(cell);
    var mutation = applyOptimisticMutation(newStart);
    ui.mutationInFlight = true;
    ui.mutationVersion++;
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

// --- Touch/click handlers ---

function resetTouchTapSequence() {
    ui.touchTapCount = 0;
    ui.touchTapLastAt = 0;
    ui.touchTapLastDate = "";
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
    var isSameCell = dateKey === ui.touchTapLastDate;
    var isWithinWindow = (now - ui.touchTapLastAt) <= TOUCH_TAP_WINDOW_MS;

    ui.suppressClickUntil = now + TOUCH_CLICK_SUPPRESS_MS;

    if (isSameCell && isWithinWindow) {
        ui.touchTapCount++;
    } else {
        ui.touchTapCount = 1;
    }

    ui.touchTapLastDate = dateKey;
    ui.touchTapLastAt = now;

    if (ui.touchTapCount === 3) {
        resetTouchTapSequence();
        applyCycleStartMutation(cell);
    }
}

function handleTripleClick(e) {
    if (Date.now() < ui.suppressClickUntil) return;
    if (e.detail !== 3) return;

    var cell = e.target.closest(".day");
    if (!cell || !cell.dataset.date) return;

    applyCycleStartMutation(cell);
}

// --- Logo export ---

var logoExportClicks = 0;
var logoExportTimer = null;

function handleLogoExportClick(e) {
    e.preventDefault();
    logoExportClicks++;
    if (logoExportTimer) clearTimeout(logoExportTimer);
    if (logoExportClicks >= 3) {
        logoExportClicks = 0;
        var data = JSON.stringify({
            strategy: cycleStrategy,
            dates: cycleData.map(formatDate)
        }, null, 2);
        var blob = new Blob([data], {type: "application/json"});
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = formatDate(new Date()) + ".json";
        a.click();
        URL.revokeObjectURL(url);
        return;
    }
    logoExportTimer = setTimeout(function() { logoExportClicks = 0; }, 2000);
}

// --- Service worker ---

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

// --- Event wiring ---

function wireNavigation() {
    document.getElementById("prevBtn").addEventListener("click", goToPrev);
    document.getElementById("nextBtn").addEventListener("click", goToNext);
    document.getElementById("todayBtn").addEventListener("click", goToToday);
    bindCalendarNavigation(
        document.getElementById("calendar"), goToPrev, goToNext
    );
}

function wireResizeSync() {
    window.addEventListener("resize", syncGridHeight);
}

function wireErrorDialog() {
    if (ui.mutationErrorCloseBtn && ui.mutationErrorDialog) {
        ui.mutationErrorCloseBtn.addEventListener("click", function() {
            ui.mutationErrorDialog.close();
        });
    }
}

function wireGridMutationHandlers() {
    // Triple-click/triple-tap on a day cell to mark that date as a new cycle start.
    ui.gridViewport.addEventListener("click", handleTripleClick);
    ui.gridViewport.addEventListener("touchend", handleTripleTapTouch, {passive: true});
}

function wireLogoExport() {
    // Triple-click on the logo to export cycle data as JSON.
    document.getElementById("logo").addEventListener("click", handleLogoExportClick);
}

function wireAssetsReady() {
    if (!ui.initialAssetsReady) {
        window.addEventListener("load", onAssetsLoadComplete, {once: true});
    } else {
        maybeHideStartupOverlay();
    }
}

// --- Initialization ---

function initCurrentMonth() {
    var now = new Date();
    ui.currentYear = now.getFullYear();
    ui.currentMonth = now.getMonth();
    ui.targetYear = ui.currentYear;
    ui.targetMonth = ui.currentMonth;
}

function renderInitialUI() {
    initCalendar(
        document.getElementById("weekdays"), ui.state, ui.currentYear, ui.currentMonth
    );
    updateHeader(ui.currentYear, ui.currentMonth);

    var initialBars = buildChartData(ui.currentYear, ui.currentMonth);
    renderChart(ui.state.chart, initialBars, true);

    setTimeout(function() {
        syncGridHeight();
        document.getElementById("prevBtn").classList.remove("nav-btn-loading");
        document.getElementById("nextBtn").classList.remove("nav-btn-loading");
    }, cssVar("--transition-duration"));
}

// Application initialization — called after all other scripts are loaded.
function initApp() {
    initUI();
}

function initUI() {
    ui = createUIState();
    if (ui.startupOverlayText) {
        ui.startupOverlayText.textContent = LOADING_TEXT;
    }

    wireNavigation();
    initCurrentMonth();
    renderInitialUI();
    wireResizeSync();
    wireErrorDialog();
    wireGridMutationHandlers();
    wireLogoExport();
    setupServiceWorker();
    loadAndRenderCycles({allowRefreshFromCache: true, forceNetwork: false});
    wireAssetsReady();
}

const CACHE_NAME = "littletable-cache-v4";

const OFFLINE_URLS = [
    "/static/icon16.png",
    "/static/icon192.png",
    "/static/icon320.png",
    "/static/icon48.png",
    "/static/icon.svg",
    "/static/littletable_calendar.css",
    "/static/littletable_calendar.js",
    "/static/littletable_chart.css",
    "/static/littletable_chart.js",
    "/static/littletable.css",
    "/static/littletable.js",
    "/static/logo.svg",
    "/static/sw.js",
    "/static/today.svg",
];

self.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(OFFLINE_URLS);
    }));
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener("message", event => {
    if (event.data && event.data.type === "cache-page") {
        event.waitUntil(
            caches.open(CACHE_NAME).then(cache => cache.add(event.data.url))
        );
    }
});

function isSameOrigin(url) {
    return url.origin === self.location.origin;
}

function isCyclesRequest(request) {
    const url = new URL(request.url);
    return isSameOrigin(url) && url.pathname === "/cycles";
}

function isStaticRequest(request) {
    const url = new URL(request.url);
    return isSameOrigin(url) && url.pathname.startsWith("/static/");
}

function cacheResponse(request, response) {
    if (!response || !response.ok) {
        return;
    }

    caches.open(CACHE_NAME).then(cache => {
        cache.put(request, response.clone());
    });
}

function fetchAndCache(request) {
    return fetch(request).then(response => {
        cacheResponse(request, response);
        return response;
    });
}

function withCyclesSourceHeader(response, source) {
    const headers = new Headers(response.headers);
    headers.set("X-Littletable-Cycles-Source", source);
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function shouldBypassCyclesCache(request) {
    return request.headers.get("X-Littletable-Network-Only") === "1";
}

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;

    if (isCyclesRequest(event.request)) {
        if (shouldBypassCyclesCache(event.request)) {
            event.respondWith(fetchAndCache(event.request));
            return;
        }

        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) {
                    event.waitUntil(fetchAndCache(event.request));
                    return withCyclesSourceHeader(cached, "cache");
                }

                return fetchAndCache(event.request).then(response => {
                    if (!response || !response.ok) {
                        return response;
                    }
                    return withCyclesSourceHeader(response, "network");
                })
            }).catch(() => {
                return Response.error();
            })
        );
        return;
    }

    if (isStaticRequest(event.request)) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) {
                    event.waitUntil(fetchAndCache(event.request));
                    return cached;
                }

                return fetchAndCache(event.request);
            }).catch(() => {
                return Response.error();
            })
        );
        return;
    }

    event.respondWith(
        fetchAndCache(event.request)
            .then(response => {
                return response;
            })
            .catch(() => {
                return caches.match(event.request).then(cached => {
                    if (cached) return cached;
                    return Response.error();
                });
            })
    );
});

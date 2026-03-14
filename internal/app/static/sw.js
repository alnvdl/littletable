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

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;

    if (isCyclesRequest(event.request)) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response && response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    return caches.match(event.request);
                })
        );
        return;
    }

    event.respondWith(
        // Try the network first.
        fetch(event.request)
            .then(response => {
                // Update the cache if there's a hit.
                const responseClone = response.clone();
                const requestURL = new URL(event.request.url);
                if (response && response.ok && isSameOrigin(requestURL)) {
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Cannot fetch, fallback to cache.
                return caches.match(event.request).then(cached => {
                    if (cached) return cached;
                    return Response.error();
                });
            })
    );
});

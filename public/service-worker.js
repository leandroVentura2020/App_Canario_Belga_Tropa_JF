const CACHE_NAME = 'tropa-dos-belgas-v10'
const APP_SHELL = ['', 'index.html', 'manifest.json', 'icon.svg', 'logo.svg', 'canary-icon.png', 'canary-icon-transparent.png']

function fromScope(path) {
  return new URL(path, self.registration.scope).toString()
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL.map(fromScope)))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  event.respondWith(
    fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          return response
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match(fromScope('index.html'))))
  )
})

const CACHE_NAME = 'phase-1a-shell-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/history',
  '/history.html',
  '/main.css',
  '/main.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];
const DB_NAME = 'phase-1a-offline';
const STORE_NAME = 'log-queue';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/log') {
    event.respondWith(handleLogPost(request));
    return;
  }

  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-log-queue') {
    event.waitUntil(replayQueuedLogs());
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'REPLAY_LOGS' || event.data?.type === 'REPLAY_LOG_QUEUE') {
    event.waitUntil(replayQueuedLogs());
  }
});

async function handleLogPost(request) {
  try {
    return await fetch(request.clone());
  } catch {
    const body = await request.clone().json();
    await queueLog(body);
    const registration = self.registration;
    if ('sync' in registration) {
      await registration.sync.register('sync-log-queue');
    }
    return new Response(JSON.stringify({ queued: true }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function queueLog(body) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({ body, created_at: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getQueuedLogs() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function deleteQueuedLog(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function replayQueuedLogs() {
  const queued = await getQueuedLogs();
  for (const item of queued) {
    try {
      const response = await fetch('/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.body),
      });
      if (response.ok) {
        await deleteQueuedLog(item.id);
      }
    } catch {
      return;
    }
  }
}

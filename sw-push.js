// Service Worker für Helfenberger's Library.
//
// Zwei Aufgaben:
//   1. Web-Push-Erinnerungen anzeigen (wie bisher).
//   2. Offline-Betrieb: die App-Hülle (index.html, Bilder, Schriften, das
//      Firebase-SDK) liegt in einem Cache, damit die App auch ohne Netz
//      startet. Die Übungsinhalte selbst kommen aus dem Firestore-Offline-
//      Cache (persistentLocalCache in index.html) — der Service Worker fasst
//      Firestore-Verkehr bewusst NICHT an.
//
// Beim Ändern dieser Datei CACHE hochzählen, sonst behalten bereits
// installierte Geräte ihre alte Dateiliste. Der Name steht auch in index.html
// (NEU_CACHE) — beide gleich halten.
//
// Ladezeit (seit 08.10.2026): Die App-Hülle index.html (über 2,5 MB) kommt
// SOFORT aus dem Cache und wird im Hintergrund neu geholt. Ist die geholte
// Fassung eine andere, erfährt die Seite das (postMessage + Eintrag
// «hl-version» im Cache) und lädt sich neu, solange noch niemand etwas getan
// hat — sonst erscheint ein kleiner Hinweis «Neue Version». Vorher wartete
// jeder Start auf den ganzen Download.

var CACHE = 'hl-app-v2';
var SHELL = 'index.html';

var PRECACHE = [
  'index.html',
  'manifest.json',
  'assets/logo.png',
  'assets/background.jpg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-180.png'
];

// Fremde Hosts, von denen gecacht werden darf. Alles andere (vor allem
// firestore.googleapis.com und die Auth-Endpunkte) läuft unangetastet durch —
// ein zwischengespeicherter Firestore-Aufruf wäre schlicht falsch.
// Schriften und Bibliotheken liegen seit 08.10.2026 im eigenen Ordner
// (assets/vendor/), fremd bleibt nur das Firebase-SDK.
var CACHEABLE_HOSTS = [
  'www.gstatic.com'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE).then(function(cache){
      // Einzeln statt addAll: fehlt eine Datei, soll trotzdem der Rest landen.
      return Promise.all(PRECACHE.map(function(url){
        return cache.add(new Request(url, {cache:'reload'})).catch(function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){ return k === CACHE ? null : caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

function networkFirst(request){
  return fetch(request).then(function(res){
    if(res && res.ok){
      var copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(request, copy); });
    }
    return res;
  }).catch(function(){
    return caches.match(request).then(function(hit){
      return hit || caches.match(SHELL);
    });
  });
}

// Woran eine neue Fassung erkannt wird (GitHub Pages liefert einen ETag).
function stempel(res){
  return res.headers.get('etag') || res.headers.get('last-modified') || res.headers.get('content-length') || '';
}
function meldeNeu(neu){
  return caches.open(CACHE).then(function(c){
    return c.put('hl-version', new Response(JSON.stringify({ stempel: neu, at: Date.now() }), { headers: { 'content-type': 'application/json' } }));
  }).then(function(){
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  }).then(function(list){
    list.forEach(function(c){ c.postMessage({ hlNeueVersion: true, stempel: neu }); });
  }).catch(function(){});
}
// App-Hülle: aus dem Cache antworten und im Hintergrund auffrischen.
function shellAusCache(event){
  return caches.open(CACHE).then(function(cache){
    return cache.match(SHELL).then(function(hit){
      var netz = fetch(SHELL, { cache: 'no-cache' }).then(function(res){
        if(!res || !res.ok || res.redirected) return res;
        var neu = stempel(res), alt = hit ? stempel(hit) : '';
        return cache.put(SHELL, res.clone()).then(function(){
          if(hit && neu && neu !== alt) return meldeNeu(neu);
        }).then(function(){ return res; });
      });
      if(hit){ event.waitUntil(netz.catch(function(){})); return hit; }
      return netz;
    });
  });
}

function cacheFirst(request){
  return caches.match(request).then(function(hit){
    if(hit){
      // Im Hintergrund auffrischen, damit neue Bilder/Skripte nachrücken.
      fetch(request).then(function(res){
        if(res && (res.ok || res.type === 'opaque')){
          caches.open(CACHE).then(function(c){ c.put(request, res.clone()); });
        }
      }).catch(function(){});
      return hit;
    }
    return fetch(request).then(function(res){
      if(res && (res.ok || res.type === 'opaque')){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(request, copy); });
      }
      return res;
    });
  });
}

self.addEventListener('fetch', function(event){
  var req = event.request;
  if(req.method !== 'GET') return;

  var url;
  try{ url = new URL(req.url); }catch(e){ return; }
  if(url.protocol !== 'http:' && url.protocol !== 'https:') return;

  var sameOrigin = url.origin === self.location.origin;

  // Die App-Hülle (Startadresse bzw. index.html im eigenen Ordner): sofort aus
  // dem Cache, im Hintergrund auffrischen — siehe oben.
  var basis = new URL(self.registration.scope).pathname;
  if(sameOrigin && (url.pathname === basis || url.pathname === basis + SHELL)){
    event.respondWith(shellAusCache(event));
    return;
  }
  // Andere Seiten (Anleitung, SVA-Werkstatt …) zuerst aus dem Netz, nur ohne
  // Netz aus dem Cache.
  if(req.mode === 'navigate'){
    event.respondWith(networkFirst(req));
    return;
  }

  if(sameOrigin){
    event.respondWith(cacheFirst(req));
    return;
  }

  if(CACHEABLE_HOSTS.indexOf(url.hostname) >= 0){
    event.respondWith(cacheFirst(req));
  }
  // alles Übrige (Firestore, Auth, Push) bleibt unberührt
});

/* ---------- Push-Erinnerungen ---------- */

self.addEventListener('push', function(event){
  var payload = {};
  try{ payload = event.data ? event.data.json() : {}; }catch(e){}
  var title = payload.title || "Helfenberger's Library";
  var options = {
    body: payload.body || 'Du hast morgen etwas fällig.',
    icon: 'assets/logo.png',
    badge: 'assets/logo.png',
    data: { url: payload.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      for(var i=0;i<list.length;i++){
        if('focus' in list[i]) return list[i].focus();
      }
      if(clients.openWindow) return clients.openWindow(url);
    })
  );
});

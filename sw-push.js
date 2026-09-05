// Service Worker für Web-Push-Erinnerungen (Helfenberger's Library).
// Zeigt eingehende Push-Nachrichten als Systembenachrichtigung an und öffnet
// beim Antippen die App (bzw. holt ein bereits offenes Tab in den Vordergrund).

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

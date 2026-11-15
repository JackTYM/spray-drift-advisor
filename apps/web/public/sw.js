self.addEventListener('push', event => {
  const d = event.data ? event.data.json() : { title: 'Spray Drift Advisor', body: '' }
  event.waitUntil(self.registration.showNotification(d.title, { body: d.body, tag: d.tag, requireInteraction: true }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(clients.openWindow('/'))
})

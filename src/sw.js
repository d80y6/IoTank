import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

// @ts-ignore
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

// Push Notification Handler
self.addEventListener('push', function(event) {
    if (event.data) {
        try {
            const data = event.data.json();
            const options = {
                body: data.body,
                icon: data.icon || '/favicon.ico',
                badge: data.badge || '/favicon.ico',
                vibrate: [100, 50, 100],
                data: data.data,
                actions: [
                    { action: 'view', title: 'View Alert' }
                ]
            };
            event.waitUntil(
                // @ts-ignore
                self.registration.showNotification(data.title, options)
            );
        } catch (err) {
            console.error('Push event error:', err);
        }
    }
});

self.addEventListener('notificationclick', function(event) {
    // @ts-ignore
    event.notification.close();
    
    const urlToOpen = new URL('/dashboard', self.location.origin).href;

    const promiseChain = clients.matchAll({
        type: 'window',
        includeUncontrolled: true
    }).then((windowClients) => {
        let matchingClient = null;

        for (let i = 0; i < windowClients.length; i++) {
            const windowClient = windowClients[i];
            if (windowClient.url === urlToOpen) {
                matchingClient = windowClient;
                break;
            }
        }

        if (matchingClient) {
            return matchingClient.focus();
        } else {
            return clients.openWindow(urlToOpen);
        }
    });

    // @ts-ignore
    event.waitUntil(promiseChain);
});

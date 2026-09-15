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
                self.registration.showNotification(data.title, options)
            );
        } catch (err) {
            console.error('Push event error:', err);
        }
    }
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    // Default action: Open dashboard
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

    event.waitUntil(promiseChain);
});

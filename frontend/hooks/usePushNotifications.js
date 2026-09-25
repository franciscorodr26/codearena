import { useState, useEffect, useCallback } from 'react';
import { config } from '../config/env';

/**
 * Hook for managing push notification subscriptions
 */
export function usePushNotifications(token) {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState('default');
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Check if push notifications are supported
  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window;
    setIsSupported(supported);

    if (supported && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  // Check for existing subscription when component mounts
  useEffect(() => {
    if (!isSupported) return;

    const checkSubscription = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const existingSub = await registration.pushManager.getSubscription();
        setSubscription(existingSub);
      } catch (err) {
        console.error('Error checking subscription:', err);
      }
    };

    checkSubscription();
  }, [isSupported]);

  // Get VAPID public key from server
  const getVapidKey = async () => {
    try {
      const res = await fetch(`${config.backend_url}/api/activity/vapid-key`);
      const data = await res.json();
      return data.publicKey;
    } catch (err) {
      console.error('Error getting VAPID key:', err);
      return null;
    }
  };

  // Convert URL-safe base64 to Uint8Array
  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    if (!isSupported || !token) return null;

    setLoading(true);
    setError(null);

    try {
      // Request notification permission
      const notificationPermission = await Notification.requestPermission();
      setPermission(notificationPermission);

      if (notificationPermission !== 'granted') {
        throw new Error('Notification permission denied');
      }

      // Register service worker if not already registered
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // Get VAPID public key
      const vapidPublicKey = await getVapidKey();
      if (!vapidPublicKey) {
        throw new Error('Could not get VAPID key');
      }

      // Subscribe to push
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

      // Send subscription to backend
      const res = await fetch(`${config.backend_url}/api/activity/push/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ subscription: sub.toJSON() })
      });

      if (!res.ok) {
        throw new Error('Failed to save subscription');
      }

      setSubscription(sub);
      return sub;
    } catch (err) {
      console.error('Push subscription error:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [isSupported, token]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    if (!subscription || !token) return false;

    setLoading(true);
    setError(null);

    try {
      // Unsubscribe from browser
      await subscription.unsubscribe();

      // Remove from backend
      await fetch(`${config.backend_url}/api/activity/push/unsubscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ endpoint: subscription.endpoint })
      });

      setSubscription(null);
      return true;
    } catch (err) {
      console.error('Push unsubscription error:', err);
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [subscription, token]);

  return {
    isSupported,
    permission,
    isSubscribed: !!subscription,
    loading,
    error,
    subscribe,
    unsubscribe
  };
}

export default usePushNotifications;

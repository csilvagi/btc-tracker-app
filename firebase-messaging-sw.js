/**
 * firebase-messaging-sw.js
 * ------------------------------------------------------------------
 * Service worker que recibe las notificaciones push de Firebase Cloud
 * Messaging cuando la app está cerrada o en segundo plano.
 *
 * IMPORTANTE: los valores de FIREBASE_CONFIG deben coincidir exactamente
 * con los de firebase-config.js (los service workers no pueden importar
 * ese archivo directamente, así que se repiten aquí).
 * ------------------------------------------------------------------
 */
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBGdzqjPeVhX6OhXgWu6Vbrp080wpbmVFU",
  authDomain: "btc-tracker-app.firebaseapp.com",
  projectId: "btc-tracker-app",
  storageBucket: "btc-tracker-app.firebasestorage.app",
  messagingSenderId: "1016507017245",
  appId: "1:1016507017245:web:fd7bf9a35343d5664c7ef4",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || "Bitcoin Tracker", {
    body: body || "Tienes una alerta de gatillo.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
  });
});

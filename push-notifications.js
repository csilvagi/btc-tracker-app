/**
 * push-notifications.js
 * ------------------------------------------------------------------
 * 1. Pide permiso de notificaciones y obtiene el token FCM del dispositivo.
 * 2. Sube ese token a Supabase (para que el cron job en Render sepa a quién
 *    notificar).
 * 3. Cada vez que cambia el saldo relevante (compras, retiros, gatillos
 *    ejecutados, minería), sube el saldo actualizado a Supabase, para que
 *    el cron job calcule bien cuánto BTC hay que vender en cada gatillo.
 * ------------------------------------------------------------------
 */

let firebaseMessaging = null;

async function inicializarNotificaciones() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    console.warn("Este navegador no soporta notificaciones push.");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("firebase-messaging-sw.js");

    firebase.initializeApp(FIREBASE_CONFIG);
    firebaseMessaging = firebase.messaging();

    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") {
      toast("Sin permiso de notificaciones: no podré avisarte de los gatillos.");
      return;
    }

    const token = await firebaseMessaging.getToken({
      vapidKey: FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (token) {
      await subirTokenASupabase(token);
      toast("Notificaciones activadas.");
    }
  } catch (err) {
    console.error("Error inicializando notificaciones push:", err);
  }
}

async function subirTokenASupabase(token) {
  await fetch(`${SUPABASE_URL}/rest/v1/btc_tracker_state?id=eq.1`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ fcm_token: token, updated_at: new Date().toISOString() }),
  });
}

/**
 * Llamada desde app.js cada vez que se guarda el estado local.
 * "Debounced" con un pequeño timeout para no golpear la API en cada tecla.
 */
let _syncTimeout = null;
window.sincronizarEstadoConSupabase = function (mpBtcBalance, goMiningTotalBalance) {
  clearTimeout(_syncTimeout);
  _syncTimeout = setTimeout(async () => {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/btc_tracker_state?id=eq.1`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          mp_btc_balance: mpBtcBalance,
          gomining_total_balance: goMiningTotalBalance,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.error("Error sincronizando estado con Supabase:", err);
    }
  }, 1500);
};

// Recibir mensajes push mientras la app está ABIERTA en primer plano
// (cuando está cerrada o en segundo plano, el service worker se encarga).
window.addEventListener("load", () => {
  inicializarNotificaciones().then(() => {
    if (firebaseMessaging) {
      firebaseMessaging.onMessage((payload) => {
        toast(payload.notification?.title || "Nueva alerta de gatillo");
      });
    }
  });
});

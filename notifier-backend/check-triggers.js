/**
 * check-triggers.js
 * ------------------------------------------------------------------
 * Cron job (Render) para el Bitcoin DCA & Cycle Tracker.
 *
 * Cada vez que corre:
 *   1. Obtiene el precio BTC/USD (CoinGecko) y el tipo de cambio USD/CLP (mindicador.cl)
 *   2. Calcula un precio de venta implícito en CLP (aproximación al precio de
 *      liquidación real en Mercado Pago, que no tiene API pública)
 *   3. Lee el estado guardado en Supabase (token FCM, saldo BTC en MP, qué
 *      gatillos ya se notificaron)
 *   4. Evalúa los 3 gatillos y envía una notificación push (FCM) cuando uno
 *      se cumple por primera vez desde la última vez que NO se cumplía
 *   5. Actualiza en Supabase qué se notificó, para no repetir el aviso
 * ------------------------------------------------------------------
 */

import { createClient } from "@supabase/supabase-js";
import admin from "firebase-admin";

/* -------------------- CONFIG -------------------- */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

const GATILLO_2_CLP = 84_000_000;
const GATILLO_2_PCT = 0.15;
const GATILLO_3_CLP = 93_400_000;
const GATILLO_3_PCT = 0.20;
const GATILLO_ENTRADA_CLP = 45_000_000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !FIREBASE_SERVICE_ACCOUNT_JSON) {
  console.error(
    "Faltan variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIREBASE_SERVICE_ACCOUNT_JSON"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * FIREBASE_SERVICE_ACCOUNT_JSON puede venir como JSON crudo o como base64
 * (base64 es más seguro para pegar en GitHub Secrets: un salto de línea
 * real colado en el JSON crudo lo rompe, base64 no tiene ese problema).
 */
function parseServiceAccount(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  return JSON.parse(Buffer.from(trimmed, "base64").toString("utf8"));
}

admin.initializeApp({
  credential: admin.credential.cert(parseServiceAccount(FIREBASE_SERVICE_ACCOUNT_JSON)),
});

/* -------------------- FUENTES DE PRECIO -------------------- */
async function obtenerPrecioBtcUsd() {
  const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
  if (!r.ok) throw new Error(`CoinGecko respondió ${r.status}`);
  const data = await r.json();
  return data.bitcoin.usd;
}

async function obtenerUsdClp() {
  const r = await fetch("https://mindicador.cl/api/dolar");
  if (!r.ok) throw new Error(`mindicador.cl respondió ${r.status}`);
  const data = await r.json();
  return data.serie[0].valor;
}

/* -------------------- LOGICA DE GATILLOS -------------------- */
function evaluarGatillos(precioVentaMp, mpBtcBalance) {
  const btcVenderG2 = mpBtcBalance * GATILLO_2_PCT;
  const btcVenderG3 = mpBtcBalance * GATILLO_3_PCT;

  return {
    gatillo2: {
      cumplido: precioVentaMp >= GATILLO_2_CLP,
      titulo: "Gatillo 2 cumplido",
      cuerpo: `Precio ≥ $${GATILLO_2_CLP.toLocaleString("es-CL")} CLP. Vende ${btcVenderG2.toFixed(8)} BTC (~$${Math.round(btcVenderG2 * precioVentaMp).toLocaleString("es-CL")} CLP).`,
    },
    gatillo3: {
      cumplido: precioVentaMp >= GATILLO_3_CLP,
      titulo: "Gatillo 3 cumplido — hito 100k USD",
      cuerpo: `Precio ≥ $${GATILLO_3_CLP.toLocaleString("es-CL")} CLP. Vende ${btcVenderG3.toFixed(8)} BTC (~$${Math.round(btcVenderG3 * precioVentaMp).toLocaleString("es-CL")} CLP).`,
    },
    gatillo_entrada: {
      cumplido: precioVentaMp < GATILLO_ENTRADA_CLP,
      titulo: "Zona de entrada — bono mayo 2027",
      cuerpo: `Precio bajo $${GATILLO_ENTRADA_CLP.toLocaleString("es-CL")} CLP. Considera desplegar el bono en compras escalonadas.`,
    },
  };
}

/* -------------------- ENVIO DE PUSH -------------------- */
async function enviarNotificacion(fcmToken, titulo, cuerpo) {
  await admin.messaging().send({
    token: fcmToken,
    notification: { title: titulo, body: cuerpo },
    webpush: {
      notification: { icon: "/icons/icon-192.png" },
      fcmOptions: { link: "/" },
    },
  });
}

/* -------------------- MAIN -------------------- */
async function main() {
  console.log(`[${new Date().toISOString()}] Iniciando revisión de gatillos...`);

  const [btcUsd, usdClp] = await Promise.all([obtenerPrecioBtcUsd(), obtenerUsdClp()]);
  const precioVentaMp = btcUsd * usdClp;
  console.log(`BTC/USD: $${btcUsd} | USD/CLP: $${usdClp} | Precio implícito MP: $${Math.round(precioVentaMp).toLocaleString("es-CL")} CLP`);

  const { data: row, error } = await supabase
    .from("btc_tracker_state")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) throw error;
  if (!row.fcm_token) {
    console.log("Sin token FCM registrado todavía (la app no se ha abierto/registrado en este dispositivo). Nada que notificar.");
    return;
  }

  const gatillos = evaluarGatillos(precioVentaMp, Number(row.mp_btc_balance));
  const lastNotified = row.last_notified || {};
  const nuevoEstado = { ...lastNotified };
  let huboEnvios = false;

  for (const [id, g] of Object.entries(gatillos)) {
    const yaNotificado = !!lastNotified[id];

    if (g.cumplido && !yaNotificado) {
      console.log(`-> Enviando notificación: ${id}`);
      await enviarNotificacion(row.fcm_token, g.titulo, g.cuerpo);
      nuevoEstado[id] = true;
      huboEnvios = true;
    } else if (!g.cumplido && yaNotificado) {
      // El precio volvió a salir de la zona del gatillo: se rearma para poder
      // volver a notificar si lo cruza de nuevo en el futuro.
      nuevoEstado[id] = false;
    }
  }

  if (huboEnvios || JSON.stringify(nuevoEstado) !== JSON.stringify(lastNotified)) {
    const { error: updateError } = await supabase
      .from("btc_tracker_state")
      .update({ last_notified: nuevoEstado, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (updateError) throw updateError;
  }

  console.log(huboEnvios ? "Revisión completa: se enviaron notificaciones." : "Revisión completa: sin cambios.");
}

main().catch((err) => {
  console.error("Error en check-triggers.js:", err);
  process.exit(1);
});

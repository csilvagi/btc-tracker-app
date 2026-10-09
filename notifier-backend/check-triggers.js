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

// Gatillos por defecto, usados solo si el usuario aún no sincronizó ninguno
// personalizado desde la app (fila sin gatillos_custom en Supabase).
const GATILLOS_DEFAULT = [
  { id: "gatillo2", tipo: "venta", nombre: "Gatillo 2", precio_clp: 84_000_000, pct: 0.15 },
  { id: "gatillo3", tipo: "venta", nombre: "Gatillo 3 — hito 100k USD", precio_clp: 93_400_000, pct: 0.20 },
  { id: "gatillo_entrada", tipo: "alerta_baja", nombre: "Zona de entrada — bono mayo 2027", precio_clp: 45_000_000, pct: null },
];

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
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function fetchJsonConReintentos(url, intentos = 3) {
  let ultimoError;
  for (let i = 1; i <= intentos; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      ultimoError = err;
      if (i < intentos) await sleep(2000 * i);
    }
  }
  throw ultimoError;
}

/** Prueba cada fuente en orden y devuelve el primer valor válido. */
async function primeraFuenteValida(nombre, fuentes) {
  const errores = [];
  for (const { fuente, fn } of fuentes) {
    try {
      const valor = await fn();
      if (typeof valor === "number" && isFinite(valor) && valor > 0) return valor;
      throw new Error("valor inválido");
    } catch (err) {
      errores.push(`${fuente}: ${err.message}`);
      console.warn(`[${nombre}] ${fuente} falló: ${err.message}`);
    }
  }
  throw new Error(`Todas las fuentes de ${nombre} fallaron (${errores.join(" | ")})`);
}

function obtenerPrecioBtcUsd() {
  return primeraFuenteValida("BTC/USD", [
    {
      fuente: "CoinGecko",
      fn: async () =>
        (await fetchJsonConReintentos("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd")).bitcoin.usd,
    },
    {
      fuente: "Coinbase",
      fn: async () =>
        Number((await fetchJsonConReintentos("https://api.coinbase.com/v2/prices/BTC-USD/spot")).data.amount),
    },
  ]);
}

function obtenerUsdClp() {
  return primeraFuenteValida("USD/CLP", [
    {
      fuente: "mindicador.cl",
      fn: async () => (await fetchJsonConReintentos("https://mindicador.cl/api/dolar")).serie[0].valor,
    },
    {
      fuente: "open.er-api.com",
      fn: async () => (await fetchJsonConReintentos("https://open.er-api.com/v6/latest/USD")).rates.CLP,
    },
  ]);
}

/** Devuelve el precio de mercado en CLP, o null si no se pudo obtener. */
async function obtenerPrecioMercadoClp() {
  try {
    const [btcUsd, usdClp] = await Promise.all([obtenerPrecioBtcUsd(), obtenerUsdClp()]);
    console.log(`BTC/USD: $${btcUsd} | USD/CLP: $${usdClp}`);
    return btcUsd * usdClp;
  } catch (err) {
    console.warn(`No se pudo obtener el precio de mercado: ${err.message}`);
    return null;
  }
}

/* -------------------- LOGICA DE GATILLOS -------------------- */
function evaluarGatillos(precioVentaMp, mpBtcBalance, gatillosCustom) {
  const defs = Array.isArray(gatillosCustom) && gatillosCustom.length > 0 ? gatillosCustom : GATILLOS_DEFAULT;
  const resultado = {};

  for (const cfg of defs) {
    if (cfg.tipo === "venta") {
      const btcVender = mpBtcBalance * cfg.pct;
      resultado[cfg.id] = {
        cumplido: precioVentaMp >= cfg.precio_clp,
        titulo: `${cfg.nombre} cumplido`,
        cuerpo: `Precio ≥ $${cfg.precio_clp.toLocaleString("es-CL")} CLP. Vende ${btcVender.toFixed(8)} BTC (~$${Math.round(btcVender * precioVentaMp).toLocaleString("es-CL")} CLP).`,
      };
    } else {
      // alerta_baja
      resultado[cfg.id] = {
        cumplido: precioVentaMp < cfg.precio_clp,
        titulo: cfg.nombre,
        cuerpo: `Precio bajo $${cfg.precio_clp.toLocaleString("es-CL")} CLP. Zona de entrada.`,
      };
    }
  }

  return resultado;
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

  const precioMercado = await obtenerPrecioMercadoClp();
  if (precioMercado !== null) {
    console.log(`Precio de mercado (auto): $${Math.round(precioMercado).toLocaleString("es-CL")} CLP`);
  }

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

  // Igual que en el frontend (precioEfectivo()): si hay un precio manual
  // guardado, ese manda sobre el de mercado, para que el cron notifique
  // en base a lo mismo que el usuario ve en el dashboard.
  const precioManual = row.precio_venta_manual != null ? Number(row.precio_venta_manual) : null;
  const precioVentaMp = precioManual ?? precioMercado;
  if (precioVentaMp === null) {
    // Ninguna fuente respondió (tras reintentos y fuentes alternativas) y no hay precio manual.
    throw new Error("Sin precio disponible: fallaron todas las fuentes de mercado y no hay precio manual.");
  }
  console.log(
    precioManual
      ? `Usando precio MANUAL guardado: $${Math.round(precioManual).toLocaleString("es-CL")} CLP`
      : `Sin precio manual: usando el de mercado.`
  );

  const gatillos = evaluarGatillos(precioVentaMp, Number(row.mp_btc_balance), row.gatillos_custom);
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

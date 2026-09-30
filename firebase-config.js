/**
 * firebase-config.js
 * ------------------------------------------------------------------
 * RELLENA ESTOS VALORES con los de tu propio proyecto Firebase.
 * Los sacas de: Firebase Console -> ⚙️ Configuración del proyecto ->
 * General -> "Tus apps" -> app web -> "SDK setup and configuration".
 *
 * El VAPID_KEY se saca de: Configuración del proyecto -> Cloud Messaging
 * -> "Web Push certificates" -> "Generate key pair".
 * ------------------------------------------------------------------
 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBGdzqjPeVhX6OhXgWu6Vbrp080wpbmVFU",
  authDomain: "btc-tracker-app.firebaseapp.com",
  projectId: "btc-tracker-app",
  storageBucket: "btc-tracker-app.firebasestorage.app",
  messagingSenderId: "1016507017245",
  appId: "1:1016507017245:web:fd7bf9a35343d5664c7ef4",
};

const FIREBASE_VAPID_KEY = "TU_VAPID_KEY"; // falta: pestaña Cloud Messaging -> Web Push certificates

/**
 * Conexión a Supabase (ya está lista, no necesitas cambiar esto —
 * son las credenciales públicas del proyecto que ya desplegué).
 */
const SUPABASE_URL = "https://dwevdycxbhmyxqssifwv.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3ZXZkeWN4YmhteXhxc3NpZnd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NzI5NzMsImV4cCI6MjA5OTU0ODk3M30.aMYnD89c2UsWGC0MFlER3Ws0_-uUrpNnGkB8bMDNP_Y";

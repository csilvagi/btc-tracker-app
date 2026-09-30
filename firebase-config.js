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
const SUPABASE_URL = "https://rhwgweovguvsrbqthrnr.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJod2d3ZW92Z3V2c3JicXRocm5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5NDU0NDgsImV4cCI6MjEwNTUyMTQ0OH0.xzftxy4bvDKPN1p1hjJLdkMoZwAMZTYJf9BQyfiSIFA";

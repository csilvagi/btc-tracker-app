# Notifier backend — Bitcoin DCA & Cycle Tracker

Cron job que corre en Render. Cada vez que se ejecuta:

1. Consulta el precio BTC/USD (CoinGecko) y USD/CLP (mindicador.cl)
2. Calcula el precio de venta implícito en CLP
3. Lee de Supabase el token FCM del celular y el saldo actual de BTC en Mercado Pago
4. Evalúa los 3 gatillos (venta 15%, venta 20%, entrada bajo $45M)
5. Envía una notificación push (Firebase Cloud Messaging) si algún gatillo se
   cumple por primera vez desde la última vez que no se cumplía
6. Actualiza Supabase para no repetir el mismo aviso

## Variables de entorno requeridas (configurar en Render)

| Variable | De dónde sale |
|---|---|
| `SUPABASE_URL` | `https://rhwgweovguvsrbqthrnr.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` key (secreta, NO la `anon`) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Console → ⚙️ Configuración → Cuentas de servicio → Generar nueva clave privada → pega el contenido completo del `.json` descargado como valor de esta variable |

## Correr localmente (para probar antes de desplegar)

```bash
cd notifier-backend
npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... FIREBASE_SERVICE_ACCOUNT_JSON='{...}' npm start
```

## Frecuencia recomendada del cron

Cada 15 minutos (`*/15 * * * *`) es un buen balance entre "te enteras rápido"
y no gastar de más las cuotas gratuitas de las APIs públicas que consulta.

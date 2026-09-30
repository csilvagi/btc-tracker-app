# Bitcoin DCA & Cycle Tracker (MP + GoMining)

App web (PWA) para monitorear tu estrategia de acumulación de Bitcoin,
rendimientos pasivos de GoMining y gatillos de venta por ciclos.

**Stack:** HTML5 + CSS + JavaScript vanilla (sin build, sin frameworks) + Chart.js (CDN).
No requiere `npm install` ni compilación — abre `index.html` y funciona.

## Cómo ponerla en marcha

### Opción A — Abrir directamente
Doble clic en `index.html`. Listo. (Algunos navegadores limitan `localStorage`
en archivos `file://`; si notas que no guarda, usa la Opción B.)

### Opción B — Servidor local (recomendado, especialmente para instalar como PWA)
Con Python instalado:
```bash
cd btc-tracker
python3 -m http.server 8000
```
Abre `http://localhost:8000` en tu navegador (o en el Chrome de tu celular,
si está en la misma red Wi-Fi que tu computador: `http://<ip-de-tu-pc>:8000`).

Con Node (si prefieres):
```bash
npx serve btc-tracker
```

### Instalar como app en el celular
Con el servidor corriendo, abre la URL en Chrome (Android) → menú ⋮ →
**"Añadir a pantalla de inicio"**. Queda instalada como app, en modo oscuro,
con ícono propio.

## Estructura de archivos

```
btc-tracker/
├── index.html     # Layout y estilos (todo el diseño vive aquí)
├── app.js         # Toda la lógica: estado, cálculos, gatillos, render
└── manifest.json  # Metadata PWA (nombre, colores, modo standalone)
```

## Cómo funciona el estado

Todo el estado (saldos, compras, gatillos ejecutados) vive en
`localStorage`, bajo la clave `btc_tracker_state`, como un único objeto JSON.
**No hay backend ni base de datos** — todo corre en tu navegador.

La app arranca precargada con los datos "ground truth" al 30/09/2026 que
me diste (saldo MP, GoMining, inversión neta, etc.), definidos en la función
`estadoInicial()` dentro de `app.js`. Si quieres cambiar esos valores de
partida, edítalos ahí directamente antes de usar la app por primera vez
(una vez que ya generaste datos en `localStorage`, editar esa función no
tiene efecto — usa el formulario de importar/exportar en su lugar).

### Respaldo y portabilidad
Botón **"Exportar / Importar"** en el header:
- **Exportar** descarga un `.json` con todo tu estado actual.
- **Importar** reemplaza el estado actual por el contenido de un `.json`
  que hayas exportado antes (útil para pasar tus datos de un dispositivo
  a otro, o restaurar un respaldo).

## Notas sobre las decisiones de cálculo

- **Intereses de GoMining:** se recalculan automáticamente cada vez que
  abres la app (comparando la fecha/hora actual contra
  `gomining_last_update`) y además cada 5 minutos mientras la dejas abierta.
  También puedes forzar el recálculo con el botón "Recalcular intereses ahora".
- **Retiros y ejecución de gatillos:** ambos descuentan el costo base y la
  inversión neta **proporcionalmente** al % de tu saldo de Mercado Pago que
  se está retirando o vendiendo — es un método simple y transparente, no un
  FIFO/LIFO estricto por posición individual.
- **Precio de venta MP y dólar:** son 100% manuales (los ingresas en el
  Dashboard). El prompt original mencionaba conectarse a una API de
  cotización — no lo automaticé porque el "precio de liquidación en
  Mercado Pago" no tiene una API pública confiable; si más adelante quieres
  automatizar el tipo de cambio USD/CLP (por ejemplo con la API de
  Mindicador.cl), es un cambio acotado a una función nueva en `app.js`.
- **Notificaciones del navegador:** cuando el Gatillo 2 está a ≤1% de
  distancia, la app pide permiso de notificaciones (`Notification API`) y
  dispara un aviso. Esto solo funciona con la app abierta en una pestaña
  activa — no hay notificaciones en segundo plano sin un backend/service
  worker con push real.

## Próximos pasos sugeridos (no implementados aún)

1. Service worker para uso 100% offline y notificaciones en segundo plano.
2. Automatizar el tipo de cambio USD/CLP vía Mindicador.cl.
3. Gráfico de evolución del patrimonio en el tiempo (requiere ir guardando
   snapshots históricos, no solo el estado actual).
4. Editar/eliminar compras individuales desde la tabla de Historial.

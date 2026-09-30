/* ==========================================================================
   BITCOIN DCA & CYCLE TRACKER — lógica de la aplicación
   Persistencia: localStorage (clave "btc_tracker_state")
   Todo el cálculo financiero vive aquí; index.html solo contiene el layout.
   ========================================================================== */

const STORAGE_KEY = "btc_tracker_state";
const SATS_POR_BTC = 100_000_000;

/* -------------------- ESTADO INICIAL (GROUND TRUTH al 30/09/2026) -------------------- */
function estadoInicial() {
  return {
    version: 1,
    inversion_neta_bolsillo: 414629,
    efectivo_asegurado_banco: 82483,

    mp_btc_balance: 0.00406424,
    mp_costo_base_acumulado: 272279,

    gomining_base_deposit: 0.00104909,
    gomining_apr: 0.0303,
    gomining_intereses_acumulados: 0.00000685,
    gomining_mineria_acumulada: 0.00000751,
    gomining_last_update: "2026-09-30T00:00:00.000Z",

    precio_venta_mp: null,   // CLP por BTC, ingresado manualmente
    usd_clp: null,
    precio_actualizado_en: null,

    // Precio de mercado obtenido automáticamente (CoinGecko + mindicador.cl),
    // usado como referencia/fallback cuando no hay precio manual ingresado.
    precio_mercado_referencia: null,
    precio_mercado_actualizado_en: null,

    compras: [
      // Se precarga como una única posición-resumen del ground truth.
      // Compras nuevas se agregan como filas independientes.
      {
        id: "seed",
        fecha: "2026-09-30",
        btc_original: 0.00406424,
        btc_remanente: 0.00406424,
        inversion_clp: 272279,
        precio_compra_clp: 272279 / 0.00406424,
      },
    ],

    gatillos_ejecutados: [],
  };
}

let state = cargarEstado();

function cargarEstado() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return estadoInicial();
    const parsed = JSON.parse(raw);
    return { ...estadoInicial(), ...parsed };
  } catch (e) {
    console.error("Error cargando estado, se usa el inicial:", e);
    return estadoInicial();
  }
}

function guardarEstado() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  // Sincroniza el saldo relevante (para que el cron job en la nube pueda
  // calcular los gatillos) definido en push-notifications.js, si está cargado.
  if (typeof window.sincronizarEstadoConSupabase === "function") {
    window.sincronizarEstadoConSupabase(state.mp_btc_balance, goMiningTotalBalance());
  }
}

/* ==========================================================================
   PRECIO DE MERCADO DE REFERENCIA (automático, fallback cuando no hay
   precio manual ingresado). Fuente: CoinGecko (BTC/USD) + mindicador.cl (USD/CLP).
   No es el precio real de Mercado Pago (que tiene su propio spread), solo
   una referencia de mercado para no dejar la app "ciega" sin ingreso manual.
   ========================================================================== */
async function actualizarPrecioMercado() {
  try {
    const [btcRes, clpRes] = await Promise.all([
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"),
      fetch("https://mindicador.cl/api/dolar"),
    ]);
    if (!btcRes.ok || !clpRes.ok) throw new Error("Respuesta no OK de alguna API de precios.");

    const btcData = await btcRes.json();
    const clpData = await clpRes.json();
    const btcUsd = btcData?.bitcoin?.usd;
    const usdClp = clpData?.serie?.[0]?.valor;

    if (!btcUsd || !usdClp) throw new Error("Datos incompletos en la respuesta.");

    state.precio_mercado_referencia = btcUsd * usdClp;
    state.precio_mercado_actualizado_en = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); // guarda sin re-sincronizar saldo
    render();
  } catch (err) {
    console.warn("No se pudo actualizar el precio de mercado de referencia:", err);
  }
}

/**
 * Precio a usar en todos los cálculos: el manual si existe, si no el de
 * mercado (referencia), si no null.
 */
function precioEfectivo() {
  return state.precio_venta_mp ?? state.precio_mercado_referencia ?? null;
}
function precioEsManual() {
  return state.precio_venta_mp !== null && state.precio_venta_mp !== undefined;
}

/* -------------------- UTILIDADES DE FORMATO -------------------- */
function fmtCLP(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "$" + Math.round(n).toLocaleString("es-CL");
}
function fmtBTC(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toFixed(8) + " BTC";
}
function fmtSats(btc) {
  if (btc === null || btc === undefined || isNaN(btc)) return "—";
  return Math.round(btc * SATS_POR_BTC).toLocaleString("es-CL") + " sats";
}
function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return sign + n.toFixed(2) + "%";
}
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ==========================================================================
   MÓDULO 2: MOTOR AUTOMÁTICO DE GOMINING
   ========================================================================== */
function actualizarInteresesGoMining() {
  const ahora = new Date();
  const ultimo = new Date(state.gomining_last_update);
  const msTranscurridos = ahora - ultimo;
  if (msTranscurridos <= 0) return;

  const diasTranscurridos = msTranscurridos / (1000 * 60 * 60 * 24);
  // Sats diarios = base_deposit * APR / 365
  const satsDiarios = (state.gomining_base_deposit * state.gomining_apr) / 365;
  const nuevosSats = satsDiarios * diasTranscurridos;
  const nuevosBtc = nuevosSats / SATS_POR_BTC;

  state.gomining_intereses_acumulados += nuevosBtc;
  state.gomining_last_update = ahora.toISOString();
  guardarEstado();
}

function goMiningTotalBalance() {
  return (
    state.gomining_base_deposit +
    state.gomining_intereses_acumulados +
    state.gomining_mineria_acumulada
  );
}

function registrarMineriaSemanal(sats) {
  if (!sats || sats <= 0) return;
  state.gomining_mineria_acumulada += sats / SATS_POR_BTC;
  guardarEstado();
}

/* ==========================================================================
   MÓDULO 3: TRANSACCIONES (MERCADO PAGO)
   ========================================================================== */
function registrarCompraDCA(fecha, montoClp, btcRecibidos) {
  if (!fecha || !montoClp || !btcRecibidos || montoClp <= 0 || btcRecibidos <= 0) {
    toast("Completa fecha, monto y BTC recibidos.");
    return false;
  }
  const precioImplicito = montoClp / btcRecibidos;

  state.compras.push({
    id: "c_" + Date.now(),
    fecha,
    btc_original: btcRecibidos,
    btc_remanente: btcRecibidos,
    inversion_clp: montoClp,
    precio_compra_clp: precioImplicito,
  });

  state.mp_btc_balance += btcRecibidos;
  state.mp_costo_base_acumulado += montoClp;
  state.inversion_neta_bolsillo += montoClp;

  guardarEstado();
  return true;
}

function registrarRetiroMP(btcRetirados) {
  if (!btcRetirados || btcRetirados <= 0) {
    toast("Ingresa un monto de BTC válido.");
    return false;
  }
  if (btcRetirados > state.mp_btc_balance) {
    toast("No puedes retirar más BTC del que tienes en Mercado Pago.");
    return false;
  }

  const porcentajeRetiro = btcRetirados / state.mp_btc_balance;
  const costoBaseDescontado = state.mp_costo_base_acumulado * porcentajeRetiro;

  // Descontar proporcionalmente de cada posición histórica (FIFO proporcional simple)
  let restante = btcRetirados;
  for (const c of state.compras) {
    if (restante <= 0) break;
    if (c.btc_remanente <= 0) continue;
    const aRestar = Math.min(c.btc_remanente, restante * (c.btc_original / btcRetirados) || 0);
  }
  // Método simplificado y transparente: descuenta proporcionalmente el mismo % de CADA posición
  for (const c of state.compras) {
    c.btc_remanente = c.btc_remanente * (1 - porcentajeRetiro);
  }

  state.mp_btc_balance -= btcRetirados;
  state.mp_costo_base_acumulado -= costoBaseDescontado;
  state.inversion_neta_bolsillo -= costoBaseDescontado;

  guardarEstado();
  return true;
}

/* ==========================================================================
   MÓDULO 4: GATILLOS DE PRECIO
   ========================================================================== */
const GATILLO_2_CLP = 84_000_000;
const GATILLO_2_PCT = 0.15;
const GATILLO_3_CLP = 93_400_000;
const GATILLO_3_PCT = 0.20;
const GATILLO_ENTRADA_CLP = 45_000_000;
const BONO_MAYO_2027_CLP = 1_000_000;

function definicionesGatillos() {
  const precio = precioEfectivo();
  const yaEjecutado2 = state.gatillos_ejecutados.some((g) => g.id === "gatillo2");
  const yaEjecutado3 = state.gatillos_ejecutados.some((g) => g.id === "gatillo3");

  const btcVenderG2 = state.mp_btc_balance * GATILLO_2_PCT;
  const efectivoG2 = precio ? btcVenderG2 * precio : null;

  const btcVenderG3 = state.mp_btc_balance * GATILLO_3_PCT;
  const efectivoG3 = precio ? btcVenderG3 * precio : null;

  let distanciaG2 = null;
  if (precio) distanciaG2 = ((GATILLO_2_CLP - precio) / precio) * 100;

  return [
    {
      id: "gatillo2",
      nombre: "Gatillo 2 — Activo y próximo",
      condicionTexto: `Precio venta MP ≥ ${fmtCLP(GATILLO_2_CLP)} (~$90.000 USD)`,
      cumplido: precio !== null && precio >= GATILLO_2_CLP,
      cerca: precio !== null && distanciaG2 !== null && distanciaG2 <= 1.0 && distanciaG2 > 0,
      ejecutado: yaEjecutado2,
      accionTexto: `Vender ${(GATILLO_2_PCT * 100).toFixed(0)}% del saldo MP: ${fmtBTC(btcVenderG2)} → ${fmtCLP(efectivoG2)}`,
      distancia: distanciaG2,
      btcVender: btcVenderG2,
      efectivo: efectivoG2,
      ejecutable: !yaEjecutado2 && precio !== null && precio >= GATILLO_2_CLP,
    },
    {
      id: "gatillo3",
      nombre: "Gatillo 3 — Hito 100k USD",
      condicionTexto: `Precio venta MP ≥ ${fmtCLP(GATILLO_3_CLP)} (~$100.000 USD)`,
      cumplido: precio !== null && precio >= GATILLO_3_CLP,
      cerca: false,
      ejecutado: yaEjecutado3,
      accionTexto: `Vender ${(GATILLO_3_PCT * 100).toFixed(0)}% del remanente MP: ${fmtBTC(btcVenderG3)} → ${fmtCLP(efectivoG3)}`,
      distancia: null,
      btcVender: btcVenderG3,
      efectivo: efectivoG3,
      ejecutable: !yaEjecutado3 && precio !== null && precio >= GATILLO_3_CLP,
    },
    {
      id: "gatillo_entrada",
      nombre: "Gatillo de entrada — Bono mayo 2027",
      condicionTexto: `Alerta si precio venta MP cae bajo ${fmtCLP(GATILLO_ENTRADA_CLP)} (~$42k–$46k USD)`,
      cumplido: precio !== null && precio < GATILLO_ENTRADA_CLP,
      cerca: false,
      ejecutado: false,
      accionTexto: `Desplegar liquidez del bono (${fmtCLP(BONO_MAYO_2027_CLP)}) en compras escalonadas.`,
      distancia: null,
      noEjecutable: true,
    },
  ];
}

function ejecutarGatillo(id) {
  const defs = definicionesGatillos();
  const g = defs.find((d) => d.id === id);
  if (!g || !g.ejecutable) return;

  state.mp_btc_balance -= g.btcVender;
  state.efectivo_asegurado_banco += g.efectivo;

  // Descontar proporcionalmente el costo base vendido (igual criterio que el retiro)
  const porcentaje = g.btcVender / (state.mp_btc_balance + g.btcVender);
  const costoBaseVendido = state.mp_costo_base_acumulado * porcentaje;
  state.mp_costo_base_acumulado -= costoBaseVendido;
  for (const c of state.compras) {
    c.btc_remanente = c.btc_remanente * (1 - porcentaje);
  }

  state.gatillos_ejecutados.push({
    id,
    fecha: new Date().toISOString(),
    btc_vendido: g.btcVender,
    efectivo_recibido: g.efectivo,
    precio_venta: precioEfectivo(),
  });

  guardarEstado();
  toast(`${g.nombre} ejecutado y archivado.`);
  render();
}

/* ==========================================================================
   CÁLCULOS DERIVADOS (DASHBOARD)
   ========================================================================== */
function calcularTotales() {
  const goTotal = goMiningTotalBalance();
  const totalBtc = state.mp_btc_balance + goTotal;
  const precio = precioEfectivo();

  const valorMpClp = precio ? state.mp_btc_balance * precio : null;
  const valorGoClp = precio ? goTotal * precio : null;
  const valorTotalBtcClp = precio ? totalBtc * precio : null;

  const patrimonioTotal =
    valorTotalBtcClp !== null ? valorTotalBtcClp + state.efectivo_asegurado_banco : null;

  const gananciaNeta =
    patrimonioTotal !== null ? patrimonioTotal - state.inversion_neta_bolsillo : null;
  const gananciaPct =
    gananciaNeta !== null && state.inversion_neta_bolsillo > 0
      ? (gananciaNeta / state.inversion_neta_bolsillo) * 100
      : null;

  const capitalEnRiesgo = state.inversion_neta_bolsillo - state.efectivo_asegurado_banco;

  return {
    goTotal,
    totalBtc,
    valorMpClp,
    valorGoClp,
    valorTotalBtcClp,
    patrimonioTotal,
    gananciaNeta,
    gananciaPct,
    capitalEnRiesgo,
  };
}

/* ==========================================================================
   RENDER: DASHBOARD
   ========================================================================== */
let donutChart = null;

function renderDashboard() {
  const t = calcularTotales();

  document.getElementById("kpiPatrimonio").textContent =
    t.patrimonioTotal !== null ? fmtCLP(t.patrimonioTotal) : "Ingresa el precio";
  document.getElementById("kpiGanancia").textContent =
    t.gananciaNeta !== null ? fmtCLP(t.gananciaNeta) : "—";
  document.getElementById("kpiGanancia").className =
    "value " + (t.gananciaNeta > 0 ? "pos" : t.gananciaNeta < 0 ? "neg" : "");
  document.getElementById("kpiGananciaPct").textContent =
    t.gananciaPct !== null ? fmtPct(t.gananciaPct) : "";
  document.getElementById("kpiGananciaPct").className =
    "sub " + (t.gananciaPct > 0 ? "pos" : t.gananciaPct < 0 ? "neg" : "");

  const totalSats = Math.round(t.totalBtc * SATS_POR_BTC);
  document.getElementById("kpiSats").textContent = totalSats.toLocaleString("es-CL");
  document.getElementById("kpiSatsSplit").textContent =
    `MP ${fmtSats(state.mp_btc_balance)} · GoMining ${fmtSats(t.goTotal)}`;

  document.getElementById("kpiRiesgo").textContent = fmtCLP(t.capitalEnRiesgo);

  const metaSats = 100_000_000;
  const progresoPct = Math.min((totalSats / metaSats) * 100, 100);
  document.getElementById("progresoPct").textContent = progresoPct.toFixed(3) + "%";
  document.getElementById("progresoFill").style.width = progresoPct + "%";

  // Donut
  const pctMp = t.totalBtc > 0 ? (state.mp_btc_balance / t.totalBtc) * 100 : 0;
  const pctGo = t.totalBtc > 0 ? (t.goTotal / t.totalBtc) * 100 : 0;
  document.getElementById("chipMp").textContent = pctMp.toFixed(1) + "%";
  document.getElementById("chipGo").textContent = pctGo.toFixed(1) + "%";

  const ctx = document.getElementById("donutChart");
  if (donutChart) donutChart.destroy();
  donutChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Mercado Pago", "GoMining"],
      datasets: [
        {
          data: [pctMp, pctGo],
          backgroundColor: ["#f7931a", "#10b981"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      cutout: "70%",
      plugins: { legend: { display: false } },
    },
  });

  // Precio guardado
  if (state.precio_venta_mp) document.getElementById("inPrecioVenta").value = state.precio_venta_mp;
  if (state.usd_clp) document.getElementById("inUsdClp").value = state.usd_clp;
  document.getElementById("precioActualizadoHace").textContent = precioEsManual()
    ? "Usando precio MANUAL. Actualizado: " + new Date(state.precio_actualizado_en).toLocaleString("es-CL")
    : "Usando precio de MERCADO (automático) porque no hay precio manual ingresado.";

  document.getElementById("precioMercadoValor").textContent = state.precio_mercado_referencia
    ? fmtCLP(state.precio_mercado_referencia)
    : "Cargando...";
  document.getElementById("precioMercadoActualizadoHace").textContent = state.precio_mercado_actualizado_en
    ? "Actualizado: " + new Date(state.precio_mercado_actualizado_en).toLocaleString("es-CL") + " · BTC/USD × USD/CLP (no es el precio exacto de MP, que tiene su propio spread)"
    : "Obteniendo precio de mercado...";
}

/* ==========================================================================
   RENDER: GOMINING
   ========================================================================== */
function renderGoMining() {
  document.getElementById("goBase").textContent = fmtBTC(state.gomining_base_deposit);
  document.getElementById("goTotal").textContent = fmtBTC(goMiningTotalBalance());
  document.getElementById("goIntereses").textContent = fmtSats(state.gomining_intereses_acumulados);
  document.getElementById("goMineria").textContent = fmtSats(state.gomining_mineria_acumulada);
  document.getElementById("goUltimaActualizacion").textContent =
    "Última actualización de intereses: " + new Date(state.gomining_last_update).toLocaleString("es-CL");
}

/* ==========================================================================
   RENDER: TRANSACCIONES (previews en vivo)
   ========================================================================== */
function actualizarPreviewCompra() {
  const monto = parseFloat(document.getElementById("inCompraMonto").value);
  const btc = parseFloat(document.getElementById("inCompraBtc").value);
  const el = document.getElementById("compraPrecioImplicito");
  if (monto > 0 && btc > 0) {
    el.textContent = `Precio implícito: ${fmtCLP(monto / btc)} / BTC`;
  } else {
    el.textContent = "";
  }
}

function actualizarPreviewRetiro() {
  const btc = parseFloat(document.getElementById("inRetiroBtc").value);
  const el = document.getElementById("retiroPreview");
  if (btc > 0 && state.mp_btc_balance > 0) {
    const pct = (btc / state.mp_btc_balance) * 100;
    const costoDescontado = state.mp_costo_base_acumulado * (btc / state.mp_btc_balance);
    el.textContent = `Representa ${pct.toFixed(2)}% del saldo MP · se descuentan ${fmtCLP(costoDescontado)} de tu inversión neta`;
  } else {
    el.textContent = "";
  }
}

/* ==========================================================================
   RENDER: GATILLOS
   ========================================================================== */
function renderGatillos() {
  const defs = definicionesGatillos();
  const cont = document.getElementById("triggersList");
  cont.innerHTML = "";

  for (const g of defs) {
    const div = document.createElement("div");
    div.className = "trigger" + (g.cumplido ? " hit" : g.cerca ? " near" : "");

    let badge = "";
    if (g.ejecutado) badge = '<span class="badge on">Ejecutado</span>';
    else if (g.cumplido) badge = '<span class="badge on">Cumplido</span>';
    else if (g.cerca) badge = '<span class="badge">Cerca</span>';

    let distanciaTxt = "";
    if (g.distancia !== null && !g.cumplido) {
      distanciaTxt = `<div class="muted" style="margin-top:6px;">Distancia al gatillo: ${g.distancia.toFixed(2)}%</div>`;
    }

    let btnHtml = "";
    if (g.ejecutable) {
      btnHtml = `<button class="primary" data-ejecutar="${g.id}">Ejecutar ${g.nombre.split(" — ")[0]}</button>`;
    }

    div.innerHTML = `
      <div class="title">${g.nombre} ${badge}</div>
      <div class="desc">${g.condicionTexto}<br/>${g.accionTexto}</div>
      ${distanciaTxt}
      ${btnHtml}
    `;
    cont.appendChild(div);
  }

  cont.querySelectorAll("[data-ejecutar]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm("¿Confirmas que ya realizaste esta venta real en Mercado Pago? Esto actualizará tus saldos.")) {
        ejecutarGatillo(btn.dataset.ejecutar);
      }
    });
  });

  if (!precioEfectivo()) {
    cont.insertAdjacentHTML(
      "afterbegin",
      '<div class="empty" style="padding-bottom:16px;">Esperando el precio de mercado (automático) o ingresa uno manual en el Dashboard.</div>'
    );
  }
}

/* ==========================================================================
   RENDER: HISTORIAL
   ========================================================================== */
function renderHistorial() {
  const precio = precioEfectivo();
  const tbody = document.getElementById("tablaHistorialBody");
  tbody.innerHTML = "";

  const activas = state.compras.filter((c) => c.btc_remanente > 0.00000001);

  if (activas.length === 0) {
    document.getElementById("historialVacio").style.display = "block";
  } else {
    document.getElementById("historialVacio").style.display = "none";
  }

  for (const c of activas) {
    const inversionAsignada = c.precio_compra_clp * c.btc_remanente;
    const valorActual = precio ? c.btc_remanente * precio : null;
    const gp = valorActual !== null ? valorActual - inversionAsignada : null;
    const rend = gp !== null && inversionAsignada > 0 ? (gp / inversionAsignada) * 100 : null;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.fecha}</td>
      <td>${c.btc_original.toFixed(8)}</td>
      <td>${c.btc_remanente.toFixed(8)}</td>
      <td>${fmtCLP(inversionAsignada)}</td>
      <td>${fmtCLP(c.precio_compra_clp)}</td>
      <td>${valorActual !== null ? fmtCLP(valorActual) : "—"}</td>
      <td class="${gp > 0 ? "pos" : gp < 0 ? "neg" : ""}">${gp !== null ? fmtCLP(gp) : "—"}</td>
      <td class="${rend > 0 ? "pos" : rend < 0 ? "neg" : ""}">${rend !== null ? fmtPct(rend) : "—"}</td>
    `;
    tbody.appendChild(tr);
  }

  // Gatillos ejecutados
  const listEl = document.getElementById("ejecutadosList");
  listEl.innerHTML = "";
  if (state.gatillos_ejecutados.length === 0) {
    document.getElementById("ejecutadosVacio").style.display = "block";
  } else {
    document.getElementById("ejecutadosVacio").style.display = "none";
    for (const g of state.gatillos_ejecutados.slice().reverse()) {
      const div = document.createElement("div");
      div.className = "trigger hit";
      div.innerHTML = `
        <div class="title">${g.id === "gatillo2" ? "Gatillo 2" : "Gatillo 3"} <span class="badge on">Ejecutado</span></div>
        <div class="desc">
          ${new Date(g.fecha).toLocaleString("es-CL")}<br/>
          Vendido: ${fmtBTC(g.btc_vendido)} a ${fmtCLP(g.precio_venta)}/BTC → ${fmtCLP(g.efectivo_recibido)} asegurados
        </div>
      `;
      listEl.appendChild(div);
    }
  }
}

/* ==========================================================================
   RENDER GENERAL
   ========================================================================== */
function render() {
  renderDashboard();
  renderGoMining();
  renderGatillos();
  renderHistorial();
}

/* ==========================================================================
   NAVEGACIÓN POR TABS
   ========================================================================== */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "gatillos") renderGatillos();
    if (btn.dataset.tab === "historial") renderHistorial();
  });
});

/* ==========================================================================
   EVENTOS
   ========================================================================== */
document.getElementById("btnGuardarPrecio").addEventListener("click", () => {
  const precio = parseFloat(document.getElementById("inPrecioVenta").value);
  const usd = parseFloat(document.getElementById("inUsdClp").value);
  if (!precio || precio <= 0) {
    toast("Ingresa un precio de venta válido.");
    return;
  }
  state.precio_venta_mp = precio;
  state.usd_clp = usd || state.usd_clp;
  state.precio_actualizado_en = new Date().toISOString();
  guardarEstado();
  render();
  checarProximidadGatillo2();
  toast("Precio manual guardado.");
});

document.getElementById("btnLimpiarPrecio").addEventListener("click", () => {
  state.precio_venta_mp = null;
  state.precio_actualizado_en = null;
  document.getElementById("inPrecioVenta").value = "";
  guardarEstado();
  render();
  toast("Precio manual quitado. Usando el de mercado.");
});

document.getElementById("btnRecalcularIntereses").addEventListener("click", () => {
  actualizarInteresesGoMining();
  render();
  toast("Intereses recalculados.");
});

document.getElementById("btnRegistrarMineria").addEventListener("click", () => {
  const sats = parseFloat(document.getElementById("inMineriaSats").value);
  if (!sats || sats <= 0) {
    toast("Ingresa un valor de satoshis válido.");
    return;
  }
  registrarMineriaSemanal(sats);
  document.getElementById("inMineriaSats").value = "";
  render();
  toast(`+${sats} sats agregados a GoMining.`);
});

document.getElementById("inCompraMonto").addEventListener("input", actualizarPreviewCompra);
document.getElementById("inCompraBtc").addEventListener("input", actualizarPreviewCompra);
document.getElementById("inRetiroBtc").addEventListener("input", actualizarPreviewRetiro);

document.getElementById("btnRegistrarCompra").addEventListener("click", () => {
  const fecha = document.getElementById("inCompraFecha").value || new Date().toISOString().slice(0, 10);
  const monto = parseFloat(document.getElementById("inCompraMonto").value);
  const btc = parseFloat(document.getElementById("inCompraBtc").value);
  if (registrarCompraDCA(fecha, monto, btc)) {
    document.getElementById("inCompraMonto").value = "";
    document.getElementById("inCompraBtc").value = "";
    document.getElementById("compraPrecioImplicito").textContent = "";
    render();
    toast("Compra registrada.");
  }
});

document.getElementById("btnRegistrarRetiro").addEventListener("click", () => {
  const btc = parseFloat(document.getElementById("inRetiroBtc").value);
  if (confirm(`¿Confirmas el retiro de ${btc} BTC? Esto descuenta proporcionalmente tu inversión neta.`)) {
    if (registrarRetiroMP(btc)) {
      document.getElementById("inRetiroBtc").value = "";
      document.getElementById("retiroPreview").textContent = "";
      render();
      toast("Retiro registrado.");
    }
  }
});

/* -------------------- EXPORTAR / IMPORTAR JSON -------------------- */
document.getElementById("btnExport").addEventListener("click", () => {
  const opcion = confirm(
    "Aceptar = Exportar respaldo JSON.\nCancelar = Importar respaldo JSON."
  );
  if (opcion) {
    exportarJSON();
  } else {
    document.getElementById("fileImport").click();
  }
});

function exportarJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `btc-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Respaldo exportado.");
}

document.getElementById("fileImport").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      state = { ...estadoInicial(), ...imported };
      guardarEstado();
      render();
      toast("Respaldo importado correctamente.");
    } catch (err) {
      toast("Archivo inválido.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

/* -------------------- NOTIFICACIÓN DE PROXIMIDAD AL GATILLO 2 -------------------- */
function checarProximidadGatillo2() {
  const defs = definicionesGatillos();
  const g2 = defs.find((d) => d.id === "gatillo2");
  if (!g2 || g2.distancia === null) return;
  if (g2.distancia > 0 && g2.distancia <= 1.0) {
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification("BTC Tracker: Gatillo 2 cerca", {
          body: `Faltan ${g2.distancia.toFixed(2)}% para alcanzar ${fmtCLP(GATILLO_2_CLP)}.`,
        });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission();
      }
    }
  }
}

/* -------------------- INICIALIZACIÓN -------------------- */
actualizarInteresesGoMining();
render();
actualizarPrecioMercado();

// Recalcular intereses automáticamente cada 5 minutos mientras la app está abierta
setInterval(() => {
  actualizarInteresesGoMining();
  render();
}, 5 * 60 * 1000);

// Refrescar el precio de mercado cada 5 minutos también
setInterval(actualizarPrecioMercado, 5 * 60 * 1000);

// Fecha por defecto en el formulario de compra
document.getElementById("inCompraFecha").value = new Date().toISOString().slice(0, 10);

/**********************************************************
 * Planner de Jornadas — app.js (PRO)
 * - Más rápido (Map por fecha, menos loops, menos find())
 * - Parseo robusto (headers o fallback por índice)
 * - Cache TSV (offline friendly)
 * - Render móvil inteligente (grid normal + lista en pantallas muy pequeñas)
 **********************************************************/

/**********************************************************
 * CONFIG
 **********************************************************/
const CFG = {
  TSV_URL:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLTq9ULbDXOOu4zULhyAVkUuq12Te36kwu-bPGgC4ZgvfwvLRk5jipXc7qLfwp_QrPYotp4gijN5MK/pub?gid=0&single=true&output=tsv",
  YEAR: 2026,

  DAYS: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
  MONTHS: [
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
  ],

  // Si el viewport está MUY pequeño, el calendario grid se vuelve ilegible.
  // En ese caso renderizamos una vista lista para el mes (mucho mejor en móvil pequeño).
  LIST_VIEW_MAX_WIDTH: 420,

  // Cache TSV
  CACHE_KEY: "planner_tsv_cache_v1",
  CACHE_TTL_MS: 1000 * 60 * 60 * 24 * 3 // 3 días
};

/**********************************************************
 * DOM
 **********************************************************/
const byId = (id) => document.getElementById(id);

/**********************************************************
 * STATE
 **********************************************************/
let allDays = [];                  // array de records
let dayByISO = new Map();          // iso -> record (lookup rápido)
let monthWeeks = [];
let currentMonth = 0;
let currentWeekIndex = 0;

let lastLayoutMode = null;         // "grid" o "list" (para re-render en resize)

/**********************************************************
 * HELPERS (General)
 **********************************************************/
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function safeSetText(id, text){
  const el = byId(id);
  if(el) el.textContent = text;
}

function pad2(n){ return String(n).padStart(2,"0"); }

function toISODateKey(date){
  return `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
}

function sameDay(a,b){
  return a.getFullYear()===b.getFullYear()
    && a.getMonth()===b.getMonth()
    && a.getDate()===b.getDate();
}

function fmtDM(date){
  return `${pad2(date.getDate())}/${pad2(date.getMonth()+1)}`;
}
function fmtDMY(date){
  return `${pad2(date.getDate())}/${pad2(date.getMonth()+1)}/${date.getFullYear()}`;
}

function inRange(date, start, end){
  return date >= start && date <= end;
}

/* ===== Fechas y semanas (lunes-domingo) ===== */
function startOfWeekMonday(date){
  const d = new Date(date);
  const wd = (d.getDay() + 6) % 7; // lun=0
  d.setDate(d.getDate() - wd);
  d.setHours(0,0,0,0);
  return d;
}
function endOfWeekSunday(date){
  const s = startOfWeekMonday(date);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  e.setHours(23,59,59,999);
  return e;
}

function getWeeksForMonth(year, month){
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);

  let cursor = startOfWeekMonday(first);
  const weeks = [];

  while(cursor <= last){
    const start = new Date(cursor);
    const end   = endOfWeekSunday(cursor);

    if(end >= first && start <= last){
      weeks.push({ start, end });
    }
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function getWeeksForYear(year){
  const first = new Date(year, 0, 1);
  const last  = new Date(year, 11, 31);

  let cursor = startOfWeekMonday(first);
  const weeks = [];

  while(cursor <= last){
    const start = new Date(cursor);
    const end   = endOfWeekSunday(cursor);
    weeks.push({ start, end });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

/**********************************************************
 * HELPERS (TSV / Parsing)
 **********************************************************/
function tsvToRows(tsv){
  return String(tsv || "")
    .replace(/\r/g,"")
    .split("\n")
    .filter(l => l.trim())
    .map(l => l.split("\t").map(v => (v ?? "").trim()));
}

function parseDMY(str){
  if(!str) return null;
  const s = String(str).trim();
  const parts = s.split("/");
  if(parts.length < 3) return null;
  const d = Number(parts[0]);
  const m = Number(parts[1]);
  const y = Number(parts[2]);
  if(!d || !m || !y) return null;
  return new Date(y, m-1, d);
}

function parseTime(str){
  if(!str || str === "-") return null;
  const s = String(str).toLowerCase().trim();

  // soporta: "08:00", "8:00", "8:00am", "8:00 pm"
  const cleaned = s.replace(/\s+/g,"");
  const isPM = cleaned.includes("pm");
  const isAM = cleaned.includes("am");

  const base = cleaned.replace(/am|pm/g,"");
  const parts = base.split(":");
  if(!parts[0]) return null;

  let h = Number(parts[0]);
  let m = Number(parts[1] || 0);

  if(Number.isNaN(h) || Number.isNaN(m)) return null;

  if(isPM && h !== 12) h += 12;
  if(isAM && h === 12) h = 0;

  return h*60 + m;
}

function minToHHMM(min){
  const h = Math.floor(min/60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/* ===== Almuerzo =====
   Regla: si rawHours > 6h, entonces 1h es almuerzo (no cuenta).
*/
function lunchDeduction(rawHours){
  return rawHours > 6 ? 1 : 0;
}
function effectiveHours(rawHours){
  const lunch = lunchDeduction(rawHours);
  return Math.max(0, rawHours - lunch);
}

/**********************************************************
 * CACHE (TSV)
 **********************************************************/
function cacheWrite(tsvText){
  try{
    const payload = { t: Date.now(), v: String(tsvText || "") };
    localStorage.setItem(CFG.CACHE_KEY, JSON.stringify(payload));
  }catch(e){}
}

function cacheRead(){
  try{
    const raw = localStorage.getItem(CFG.CACHE_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(!parsed?.v || !parsed?.t) return null;
    if(Date.now() - parsed.t > CFG.CACHE_TTL_MS) return null;
    return String(parsed.v);
  }catch(e){
    return null;
  }
}

async function fetchTSV(){
  const url = CFG.TSV_URL + "&t=" + Date.now();
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const tsv = await res.text();
  cacheWrite(tsv);
  return tsv;
}

/**********************************************************
 * DATA BUILD
 **********************************************************/
function buildFromTSV(tsvText){
  const rows = tsvToRows(tsvText);
  if(!rows.length) return;

  // Intento de header mapping (si hay encabezados)
  const headerRow = rows[0].map(x => String(x || "").toLowerCase());
  const hasHeader = headerRow.some(h => h.includes("fecha") || h.includes("día") || h.includes("inicio") || h.includes("fin"));

  // Fallback por índices (tu suposición original):
  // r[1] fecha, r[2] inicio, r[3] fin, r[4]/r[5] nota
  let idxFecha = 1, idxIni = 2, idxFin = 3, idxNotaA = 4, idxNotaB = 5;

  if(hasHeader){
    const findIdx = (pred) => headerRow.findIndex(pred);

    const fFecha = findIdx(h => h.includes("fecha"));
    const fIni   = findIdx(h => h.includes("inicio") || h.includes("entrada") || h.includes("hora inicio"));
    const fFin   = findIdx(h => h.includes("fin") || h.includes("salida") || h.includes("hora fin"));
    const fNota  = findIdx(h => h.includes("nota") || h.includes("observ") || h.includes("coment"));

    if(fFecha >= 0) idxFecha = fFecha;
    if(fIni >= 0) idxIni = fIni;
    if(fFin >= 0) idxFin = fFin;
    if(fNota >= 0){
      idxNotaA = fNota;
      idxNotaB = fNota;
    }
  }

  const start = hasHeader ? 1 : 0;

  allDays = [];
  dayByISO = new Map();

  for(let i=start; i<rows.length; i++){
    const r = rows[i];

    const date = parseDMY(r[idxFecha]);
    if(!date || date.getFullYear() !== CFG.YEAR) continue;

    const startMin = parseTime(r[idxIni]);
    const endMin   = parseTime(r[idxFin]);
    const hasJornada = startMin !== null && endMin !== null;

    const nota = (r[idxNotaB] || r[idxNotaA] || "").trim();

    const rawHours = hasJornada ? Math.max(0, (endMin - startMin) / 60) : 0;
    const lunchHours = hasJornada ? lunchDeduction(rawHours) : 0;
    const hours = hasJornada ? effectiveHours(rawHours) : 0;

    const weekday = (date.getDay()+6)%7; // lunes=0
    const iso = toISODateKey(date);

    const rec = {
      date,
      iso,
      y: date.getFullYear(),
      m: date.getMonth(),
      d: date.getDate(),
      weekday,

      hasJornada,
      startMin,
      endMin,

      rawHours,
      lunchHours,
      hours,

      label: hasJornada
        ? `${minToHHMM(startMin)} – ${minToHHMM(endMin)}`
        : (nota || "Sin jornada"),

      nota
    };

    allDays.push(rec);
    dayByISO.set(iso, rec);
  }
}

/**********************************************************
 * INIT MONTH
 **********************************************************/
function initMonth(){
  const now = new Date();
  currentMonth = (now.getFullYear() === CFG.YEAR) ? now.getMonth() : 0;
  currentWeekIndex = 0;
}

/**********************************************************
 * RENDER MAIN
 **********************************************************/
function getLayoutMode(){
  const w = window.innerWidth || 9999;
  return (w <= CFG.LIST_VIEW_MAX_WIDTH) ? "list" : "grid";
}

function render(){
  const monthLabel = byId("monthLabel");
  if(monthLabel) monthLabel.textContent = `${CFG.MONTHS[currentMonth]} ${CFG.YEAR}`;

  monthWeeks = getWeeksForMonth(CFG.YEAR, currentMonth);
  currentWeekIndex = clamp(currentWeekIndex, 0, Math.max(0, monthWeeks.length - 1));

  const mode = getLayoutMode();
  lastLayoutMode = mode;

  if(mode === "list") renderCalendarList();
  else renderCalendarGrid();

  renderWeekBars();
  renderTotals();
  renderKPIs();
  renderYearKPIs();
}

/**********************************************************
 * CALENDAR (GRID) - EFECTIVAS
 **********************************************************/
function renderCalendarGrid(){
  const grid = byId("calendarGrid");
  if(!grid) return;

  grid.innerHTML = "";

  const first = new Date(CFG.YEAR, currentMonth, 1);
  const offset = (first.getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(CFG.YEAR, currentMonth + 1, 0).getDate();

  const totalCells = 42;

  for(let i=0; i<totalCells; i++){
    const cell = document.createElement("div");
    cell.className = "calCell";

    const dayNumber = i - offset + 1;

    if(dayNumber < 1 || dayNumber > daysInMonth){
      cell.classList.add("off");
      cell.innerHTML = `<div class="calDate"></div><div class="calHours"></div>`;
      grid.appendChild(cell);
      continue;
    }

    const date = new Date(CFG.YEAR, currentMonth, dayNumber);
    const iso = toISODateKey(date);
    const data = dayByISO.get(iso) || null;

    const top = document.createElement("div");
    top.className = "calDate";
    top.textContent = dayNumber;

    const bottom = document.createElement("div");
    bottom.className = "calHours";

    if(data && data.hasJornada){
      cell.classList.add("on");
      const lunchMark = data.lunchHours ? " 🍽️" : "";
      bottom.textContent = `${data.hours.toFixed(1)}h · ${data.label}${lunchMark}`;
    } else if(data && !data.hasJornada){
      bottom.textContent = data.label;
    } else {
      bottom.textContent = "Sin jornada";
    }

    cell.appendChild(top);
    cell.appendChild(bottom);
    grid.appendChild(cell);
  }
}

/**********************************************************
 * CALENDAR (LIST) - MÓVIL PEQUEÑO
 * - Mucho más legible cuando 7 columnas se vuelven mini.
 **********************************************************/
function renderCalendarList(){
  const grid = byId("calendarGrid");
  if(!grid) return;

  grid.innerHTML = "";

  // en modo lista usamos una sola columna
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "1fr";
  grid.style.gap = "10px";

  const daysInMonth = new Date(CFG.YEAR, currentMonth + 1, 0).getDate();

  for(let day=1; day<=daysInMonth; day++){
    const date = new Date(CFG.YEAR, currentMonth, day);
    const iso = toISODateKey(date);
    const data = dayByISO.get(iso) || null;

    const cell = document.createElement("div");
    cell.className = "calCell";
    cell.style.minHeight = "auto";

    const header = document.createElement("div");
    header.className = "calDate";
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "baseline";
    header.style.gap = "10px";

    const left = document.createElement("div");
    left.textContent = `${CFG.DAYS[(date.getDay()+6)%7]} ${day}`;

    const right = document.createElement("div");
    right.style.fontWeight = "950";
    right.style.color = "rgba(100,116,139,.95)";
    right.style.fontSize = ".85rem";
    right.textContent = fmtDM(date);

    header.appendChild(left);
    header.appendChild(right);

    const body = document.createElement("div");
    body.className = "calHours";
    body.style.marginTop = "6px";
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "6px";
    body.style.webkitLineClamp = "unset";
    body.style.overflow = "visible";

    if(data && data.hasJornada){
      cell.classList.add("on");
      const lunchMark = data.lunchHours ? " 🍽️" : "";
      const line1 = document.createElement("div");
      line1.textContent = `${data.hours.toFixed(1)}h efectivas${lunchMark}`;
      line1.style.fontWeight = "950";

      const line2 = document.createElement("div");
      line2.textContent = `${data.label}`;
      line2.style.color = "rgba(71,85,105,.95)";
      line2.style.fontWeight = "850";

      if(data.nota){
        const line3 = document.createElement("div");
        line3.textContent = `Nota: ${data.nota}`;
        line3.style.color = "rgba(100,116,139,.95)";
        line3.style.fontWeight = "800";
        body.appendChild(line1);
        body.appendChild(line2);
        body.appendChild(line3);
      } else {
        body.appendChild(line1);
        body.appendChild(line2);
      }
    } else if(data && !data.hasJornada){
      body.textContent = data.label;
    } else {
      body.textContent = "Sin jornada";
    }

    cell.appendChild(header);
    cell.appendChild(body);
    grid.appendChild(cell);
  }

  // Al salir de modo lista, el grid normal vuelve a 7 cols en renderCalendarGrid()
}

/**********************************************************
 * WEEK BARS (Semana seleccionada) - EFECTIVAS
 **********************************************************/
function renderWeekBars(){
  const week = monthWeeks[currentWeekIndex] || null;
  const weekLabel = byId("weekLabel");
  if(!week || !weekLabel) return;

  weekLabel.textContent =
    `Semana ${currentWeekIndex+1} · Del ${fmtDM(week.start)} al ${fmtDM(week.end)}`;

  const totals = [0,0,0,0,0,0,0];

  // Sumamos jornadas del rango
  for(const d of allDays){
    if(!d.hasJornada) continue;
    if(d.m !== currentMonth) {
      // OJO: una semana puede cruzar meses, pero la sección "Carga por semana"
      // para el mes normalmente se entiende como la semana mostrada del calendario.
      // Aun así, tu lógica original incluía todo el rango sin filtrar mes.
      // Mantenemos eso: solo revisamos rango.
    }
    if(inRange(d.date, week.start, week.end)){
      totals[d.weekday] += d.hours;
    }
  }

  const max = Math.max(...totals, 1);

  const map = [
    ["lun",0],["mar",1],["mie",2],["jue",3],
    ["vie",4],["sab",5],["dom",6]
  ];

  map.forEach(([id,i])=>{
    const bar = byId("bar-"+id);
    const h = byId("hours-"+id);
    if(!bar || !h) return;

    bar.innerHTML = "";
    const fill = document.createElement("div");
    fill.className = "barFill";
    fill.style.height = `${(totals[i]/max)*100}%`;
    bar.appendChild(fill);

    h.textContent = `${totals[i].toFixed(1)}h`;
  });
}

/**********************************************************
 * TOTALS - EFECTIVAS
 **********************************************************/
function renderTotals(){
  const totalsGrid = byId("totalsGrid");
  if(!totalsGrid) return;

  const monthData = allDays.filter(d => d.m === currentMonth);
  const jornadaDays = monthData.filter(d => d.hasJornada);

  // Totales por día de semana (mes)
  const monthDayTotals = [0,0,0,0,0,0,0];
  for(const d of jornadaDays){
    monthDayTotals[d.weekday] += d.hours;
  }

  // Totales por semana (mes) usando monthWeeks (rango real)
  const weekTotals = monthWeeks.map(w => {
    let sum = 0;
    for(const d of allDays){
      if(!d.hasJornada) continue;
      if(inRange(d.date, w.start, w.end)) sum += d.hours;
    }
    return sum;
  });

  const monthTotal = weekTotals.reduce((a,b)=>a+b,0);

  totalsGrid.innerHTML = "";

  const box1 = document.createElement("div");
  box1.className = "totalsBox";
  box1.innerHTML = `
    <div class="totalsTitle">Totales por día (mes) · efectivas</div>
    <div class="totalsList">
      ${CFG.DAYS.map((d,i)=>`
        <div class="totalsRow"><span>${d}</span><span>${monthDayTotals[i].toFixed(1)}h</span></div>
      `).join("")}
    </div>
  `;

  const box2 = document.createElement("div");
  box2.className = "totalsBox";
  box2.innerHTML = `
    <div class="totalsTitle">Totales por semana (mes) · efectivas</div>
    <div class="totalsList">
      ${weekTotals.map((h,i)=>`
        <div class="totalsRow"><span>Semana ${i+1}</span><span>${h.toFixed(1)}h</span></div>
      `).join("")}
      <div class="totalsRow" style="margin-top:8px; font-weight:950; color: rgba(15,23,42,.88);">
        <span>Total mes</span><span>${monthTotal.toFixed(1)}h</span>
      </div>
    </div>
  `;

  totalsGrid.appendChild(box1);
  totalsGrid.appendChild(box2);
}

/**********************************************************
 * KPIs - mensuales EFECTIVOS
 **********************************************************/
function renderKPIs(){
  const monthData = allDays.filter(d => d.m === currentMonth);
  const jornadaDays = monthData.filter(d => d.hasJornada);

  // Almuerzo (solo reporte)
  const lunchDays = jornadaDays.filter(d => d.lunchHours > 0);
  const lunchDaysCount = lunchDays.length;
  const lunchHoursTotal = lunchDays.reduce((a,d)=>a + d.lunchHours, 0);

  // Totales mes
  const rawTotal = jornadaDays.reduce((a,d)=>a + d.rawHours, 0);     // informativo
  const effectiveTotal = jornadaDays.reduce((a,d)=>a + d.hours, 0);  // real

  // KPI: Día con mayor jornada EFECTIVA
  let topDay = null;
  for(const d of jornadaDays){
    if(!topDay || d.hours > topDay.hours) topDay = d;
  }

  // KPI: Semana más cargada (EFECTIVA)
  const weekTotals = monthWeeks.map(w => {
    let sum = 0;
    for(const d of allDays){
      if(!d.hasJornada) continue;
      if(inRange(d.date, w.start, w.end)) sum += d.hours;
    }
    return sum;
  });

  let topWeekIndex = 0;
  for(let i=1;i<weekTotals.length;i++){
    if(weekTotals[i] > weekTotals[topWeekIndex]) topWeekIndex = i;
  }

  // KPI: Promedio semanal
  const weekAvg = weekTotals.length
    ? (weekTotals.reduce((a,b)=>a+b,0) / weekTotals.length)
    : 0;

  // KPI: Día de semana más pesado
  const weekdayTotals = [0,0,0,0,0,0,0];
  for(const d of jornadaDays) weekdayTotals[d.weekday] += d.hours;

  let topWeekday = 0;
  for(let i=1;i<7;i++){
    if(weekdayTotals[i] > weekdayTotals[topWeekday]) topWeekday = i;
  }

  // === PINTAR ===
  if(topDay){
    safeSetText("kpiTopDay", `${pad2(topDay.d)}/${pad2(topDay.m+1)}`);
    const lunchMark = topDay.lunchHours ? " 🍽️" : "";
    safeSetText("kpiTopDayHint", `${topDay.hours.toFixed(1)}h · ${topDay.label}${lunchMark}`);
  } else {
    safeSetText("kpiTopDay", "--");
    safeSetText("kpiTopDayHint", "No hay jornadas en este mes");
  }

  safeSetText("kpiTopWeek", `Semana ${topWeekIndex+1}`);
  const w = monthWeeks[topWeekIndex];
  safeSetText(
    "kpiTopWeekHint",
    w ? `${weekTotals[topWeekIndex].toFixed(1)}h · Del ${fmtDM(w.start)} al ${fmtDM(w.end)}` : `${weekTotals[topWeekIndex].toFixed(1)}h`
  );

  safeSetText("kpiMonthTotal", `${effectiveTotal.toFixed(1)}h`);
  safeSetText("kpiMonthTotalHint", "Horas efectivas (almuerzo ya descontado)");

  safeSetText("kpiWeekAvg", `${weekAvg.toFixed(1)}h`);
  safeSetText("kpiWeekAvgHint", "Promedio semanal efectivo");

  safeSetText("kpiTopWeekday", CFG.DAYS[topWeekday]);
  safeSetText("kpiTopWeekdayHint", `${weekdayTotals[topWeekday].toFixed(1)}h acumuladas`);

  safeSetText("kpiDaysWithJornada", `${jornadaDays.length}`);
  safeSetText("kpiDaysWithJornadaHint", `Días con horario asignado en ${CFG.MONTHS[currentMonth]}`);

  safeSetText("kpiLunchDays", `${lunchDaysCount}`);
  safeSetText("kpiLunchDaysHint", "Jornadas > 6h (se descuenta 1h)");

  safeSetText("kpiLunchHours", `${lunchHoursTotal.toFixed(1)}h`);
  safeSetText("kpiLunchHoursHint", "Horas descontadas (NO suman a nada)");

  safeSetText("kpiRawTotal", `${rawTotal.toFixed(1)}h`);
  safeSetText("kpiRawTotalHint", "Informativo: horas sin descuento");

  renderLunchDaysList(lunchDays);
}

/**********************************************************
 * KPIs ANUALES
 **********************************************************/
function renderYearKPIs(){
  const guard = byId("kpiYearTotal");
  if(!guard) return;

  // Conteo de días del año (si no hay registro, cuenta como sin jornada)
  const yearStart = new Date(CFG.YEAR, 0, 1);
  const yearEnd = new Date(CFG.YEAR, 11, 31);

  let daysWithJornadaYear = 0;
  let daysWithoutJornadaYear = 0;

  for(let dt = new Date(yearStart); dt <= yearEnd; dt.setDate(dt.getDate() + 1)){
    const iso = toISODateKey(dt);
    const rec = dayByISO.get(iso);
    if(rec && rec.hasJornada) daysWithJornadaYear++;
    else daysWithoutJornadaYear++;
  }

  const jornadaYear = allDays.filter(d => d.y === CFG.YEAR && d.hasJornada);

  const effectiveYearTotal = jornadaYear.reduce((a,d)=>a + d.hours, 0);
  const rawYearTotal = jornadaYear.reduce((a,d)=>a + d.rawHours, 0);
  const lunchHoursYear = jornadaYear.reduce((a,d)=>a + d.lunchHours, 0);

  const monthTotals = Array(12).fill(0);
  const monthRawTotals = Array(12).fill(0);

  for(const d of jornadaYear){
    monthTotals[d.m] += d.hours;
    monthRawTotals[d.m] += d.rawHours;
  }

  const monthAvg = monthTotals.reduce((a,b)=>a+b,0) / 12;

  // Mes más cargado
  let topMonth = 0;
  for(let m=1;m<12;m++){
    if(monthTotals[m] > monthTotals[topMonth]) topMonth = m;
  }

  // Día de semana más pesado del año
  const weekdayTotalsYear = [0,0,0,0,0,0,0];
  for(const d of jornadaYear) weekdayTotalsYear[d.weekday] += d.hours;

  let topWeekdayYear = 0;
  for(let i=1;i<7;i++){
    if(weekdayTotalsYear[i] > weekdayTotalsYear[topWeekdayYear]) topWeekdayYear = i;
  }

  // Semana más cargada del año
  const yearWeeks = getWeeksForYear(CFG.YEAR);
  const yearWeekTotals = yearWeeks.map(w=>{
    let sum = 0;
    for(const d of jornadaYear){
      if(inRange(d.date, w.start, w.end)) sum += d.hours;
    }
    return sum;
  });

  let topWeekYearIndex = 0;
  for(let i=1;i<yearWeekTotals.length;i++){
    if(yearWeekTotals[i] > yearWeekTotals[topWeekYearIndex]) topWeekYearIndex = i;
  }

  const topWeekObj = yearWeeks[topWeekYearIndex];

  safeSetText("kpiYearTotal", `${effectiveYearTotal.toFixed(1)}h`);
  safeSetText("kpiYearTotalHint", "Horas efectivas del año (almuerzo ya descontado)");

  safeSetText("kpiYearMonthAvg", `${monthAvg.toFixed(1)}h`);
  safeSetText("kpiYearMonthAvgHint", "Promedio mensual efectivo (12 meses)");

  safeSetText("kpiTopMonth", `${CFG.MONTHS[topMonth]}`);
  safeSetText("kpiTopMonthHint", `${monthTotals[topMonth].toFixed(1)}h efectivas · ${monthRawTotals[topMonth].toFixed(1)}h sin descuento`);

  safeSetText("kpiTopWeekYear", `Semana ${topWeekYearIndex+1}`);
  safeSetText(
    "kpiTopWeekYearHint",
    topWeekObj
      ? `${yearWeekTotals[topWeekYearIndex].toFixed(1)}h · Del ${fmtDM(topWeekObj.start)} al ${fmtDM(topWeekObj.end)}`
      : `${yearWeekTotals[topWeekYearIndex].toFixed(1)}h`
  );

  safeSetText("kpiTopWeekdayYear", `${CFG.DAYS[topWeekdayYear]}`);
  safeSetText("kpiTopWeekdayYearHint", `${weekdayTotalsYear[topWeekdayYear].toFixed(1)}h acumuladas`);

  safeSetText("kpiLunchHoursYear", `${lunchHoursYear.toFixed(1)}h`);
  safeSetText("kpiLunchHoursYearHint", "Horas descontadas por la regla (>6h) en el año");

  safeSetText("kpiDaysWithJornadaYear", `${daysWithJornadaYear}`);
  safeSetText("kpiDaysWithJornadaYearHint", "Días con horario asignado en el año");

  safeSetText("kpiDaysWithoutJornadaYear", `${daysWithoutJornadaYear}`);
  safeSetText("kpiDaysWithoutJornadaYearHint", "Días sin jornada (incluye días sin registro)");

  safeSetText("kpiYearRawTotal", `${rawYearTotal.toFixed(1)}h`);
  safeSetText("kpiYearRawTotalHint", "Informativo: horas del año sin descuento de almuerzo");
}

/**********************************************************
 * Lista “Días donde aplicó almuerzo”
 **********************************************************/
function renderLunchDaysList(lunchDays){
  const list = byId("lunchDaysList");
  if(!list) return;

  list.innerHTML = "";

  if(!lunchDays.length){
    const empty = document.createElement("div");
    empty.className = "sub";
    empty.textContent = "Este mes no hay días que requieran almuerzo según la regla (> 6h).";
    list.appendChild(empty);
    return;
  }

  const sorted = [...lunchDays].sort((a,b)=>a.date - b.date);

  sorted.forEach(d=>{
    const chip = document.createElement("div");
    chip.className = "chip chip--on";
    chip.style.display = "inline-flex";
    chip.style.margin = "4px 6px 0 0";
    chip.style.gap = "8px";
    chip.style.alignItems = "center";

    chip.textContent = `${CFG.DAYS[d.weekday]} ${fmtDM(d.date)} · ${d.hours.toFixed(1)}h (−${d.lunchHours}h 🍽️)`;

    list.appendChild(chip);
  });
}

/**********************************************************
 * NAV (Mes y Semana)
 **********************************************************/
function wireNav(){
  const prevMonth = byId("prevMonth");
  const nextMonth = byId("nextMonth");
  const prevWeek = byId("prevWeek");
  const nextWeek = byId("nextWeek");

  if(prevMonth) prevMonth.addEventListener("click", ()=>{
    currentMonth = (currentMonth + 11) % 12;
    currentWeekIndex = 0;
    render();
  });

  if(nextMonth) nextMonth.addEventListener("click", ()=>{
    currentMonth = (currentMonth + 1) % 12;
    currentWeekIndex = 0;
    render();
  });

  if(prevWeek) prevWeek.addEventListener("click", ()=>{
    currentWeekIndex = Math.max(currentWeekIndex - 1, 0);
    render();
  });

  if(nextWeek) nextWeek.addEventListener("click", ()=>{
    currentWeekIndex = Math.min(currentWeekIndex + 1, monthWeeks.length - 1);
    render();
  });
}

/**********************************************************
 * RESIZE (re-render solo si cambia modo)
 **********************************************************/
function rafThrottle(fn){
  let ticking = false;
  return function(...args){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{
      ticking = false;
      fn.apply(this, args);
    });
  };
}

const onResize = rafThrottle(()=>{
  const mode = getLayoutMode();
  if(mode !== lastLayoutMode){
    // Si estábamos en modo lista, el calendarGrid quedó en 1 columna.
    // Al volver a grid, el renderGrid reconstruye completo.
    render();
  }
});

/**********************************************************
 * START
 **********************************************************/
async function start(){
  wireNav();
  window.addEventListener("resize", onResize, { passive: true });

  initMonth();

  // Intentamos red primero, si falla caemos al cache.
  try{
    const tsv = await fetchTSV();
    buildFromTSV(tsv);
    render();
  }catch(err){
    console.error("[Planner] fetchTSV failed:", err);

    const cached = cacheRead();
    if(cached){
      buildFromTSV(cached);
      render();
      // Aviso suave (sin drama)
      // Si no quieres alert, bórralo.
      setTimeout(()=>{
        console.warn("[Planner] usando datos en cache por falla de red.");
      }, 0);
    } else {
      alert("Error cargando datos. Revisa la URL TSV, permisos del Sheet o tu conexión.");
    }
  }
}

start();
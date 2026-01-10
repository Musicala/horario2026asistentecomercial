/**********************************************************
 * CONFIG
 **********************************************************/
const TSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLTq9ULbDXOOu4zULhyAVkUuq12Te36kwu-bPGgC4ZgvfwvLRk5jipXc7qLfwp_QrPYotp4gijN5MK/pub?gid=0&single=true&output=tsv";

const YEAR = 2026;

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];

/**********************************************************
 * DOM
 **********************************************************/
const byId = (id) => document.getElementById(id);

/**********************************************************
 * STATE
 **********************************************************/
let allDays = [];
let currentMonth = 0;
let currentWeekIndex = 0;
let monthWeeks = [];

/**********************************************************
 * HELPERS
 **********************************************************/
function tsvToRows(tsv){
  return tsv
    .replace(/\r/g,"")
    .split("\n")
    .filter(l => l.trim())
    .map(l => l.split("\t").map(v => (v ?? "").trim()));
}

function parseDMY(str){
  if(!str) return null;
  const [d,m,y] = str.split("/").map(Number);
  if(!d || !m || !y) return null;
  return new Date(y, m-1, d);
}

function parseTime(str){
  if(!str || str === "-" ) return null;
  const s = String(str).toLowerCase().trim();
  let [h,m] = s.replace(/am|pm/g,"").split(":");
  h = Number(h);
  m = Number(m || 0);
  if(Number.isNaN(h) || Number.isNaN(m)) return null;

  if(s.includes("pm") && h !== 12) h += 12;
  if(s.includes("am") && h === 12) h = 0;

  return h*60 + m;
}

function minToHHMM(min){
  const h = Math.floor(min/60);
  const m = min % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function sameDay(a,b){
  return a.getFullYear()===b.getFullYear()
    && a.getMonth()===b.getMonth()
    && a.getDate()===b.getDate();
}

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

function inRange(date, start, end){
  return date >= start && date <= end;
}

function fmtDM(date){
  const d = String(date.getDate()).padStart(2,"0");
  const m = String(date.getMonth()+1).padStart(2,"0");
  return `${d}/${m}`;
}

function fmtDMY(date){
  const d = String(date.getDate()).padStart(2,"0");
  const m = String(date.getMonth()+1).padStart(2,"0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function daysInYear(year){
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const ms = end - start;
  return Math.floor(ms / (24*60*60*1000)) + 1;
}

/* ===== Almuerzo =====
   Regla: si rawHours > 6h, entonces 1h es almuerzo (no cuenta como trabajo).
*/
function lunchDeduction(rawHours){
  return rawHours > 6 ? 1 : 0;
}
function effectiveHours(rawHours){
  const lunch = lunchDeduction(rawHours);
  return Math.max(0, rawHours - lunch);
}

function safeSetText(id, text){
  const el = byId(id);
  if(el) el.textContent = text;
}

/**********************************************************
 * LOAD DATA
 **********************************************************/
async function load(){
  const res = await fetch(TSV_URL + "&t=" + Date.now());
  const tsv = await res.text();
  const rows = tsvToRows(tsv);

  // Header detect
  const start = (rows[0]?.[0] || "").toLowerCase().includes("día") ? 1 : 0;

  allDays = [];

  for(let i=start;i<rows.length;i++){
    const r = rows[i];

    // Asumimos:
    // r[1] = fecha (dd/mm/yyyy)
    // r[2] = hora inicio
    // r[3] = hora fin
    // r[4]/r[5] = nota
    const date = parseDMY(r[1]);
    if(!date || date.getFullYear() !== YEAR) continue;

    const startMin = parseTime(r[2]);
    const endMin   = parseTime(r[3]);
    const hasJornada = startMin !== null && endMin !== null;

    const nota = r[5] || r[4] || "";

    const rawHours = hasJornada ? Math.max(0, (endMin - startMin) / 60) : 0;
    const lunchHours = hasJornada ? lunchDeduction(rawHours) : 0;
    const hours = hasJornada ? effectiveHours(rawHours) : 0;

    allDays.push({
      date,
      y: date.getFullYear(),
      m: date.getMonth(),
      d: date.getDate(),
      weekday: (date.getDay()+6)%7, // lunes = 0

      hasJornada,
      startMin,
      endMin,

      // DATA (para cálculos)
      rawHours,     // solo informativo
      lunchHours,   // 0 o 1
      hours,        // EFECTIVAS (esto es lo que se usa en todo)

      // UI
      label: hasJornada
        ? `${minToHHMM(startMin)} – ${minToHHMM(endMin)}`
        : (nota || "Sin jornada")
    });
  }

  // Mes inicial
  const now = new Date();
  currentMonth = (now.getFullYear() === YEAR) ? now.getMonth() : 0;
  currentWeekIndex = 0;

  render();
}

/**********************************************************
 * RENDER
 **********************************************************/
function render(){
  const monthLabel = byId("monthLabel");
  if(monthLabel) monthLabel.textContent = `${MONTHS[currentMonth]} ${YEAR}`;

  monthWeeks = getWeeksForMonth(YEAR, currentMonth);
  currentWeekIndex = clamp(currentWeekIndex, 0, Math.max(0, monthWeeks.length - 1));

  renderCalendar();
  renderWeekBars();
  renderTotals();
  renderKPIs();
  renderYearKPIs(); // ✅ NUEVO
}

/**********************************************************
 * CALENDAR (Grid) - SOLO EFECTIVAS
 **********************************************************/
function renderCalendar(){
  const grid = byId("calendarGrid");
  if(!grid) return;

  grid.innerHTML = "";

  const first = new Date(YEAR, currentMonth, 1);
  const offset = (first.getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(YEAR, currentMonth + 1, 0).getDate();

  // 6 semanas (42 celdas)
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

    const date = new Date(YEAR, currentMonth, dayNumber);
    const data = allDays.find(d => sameDay(d.date, date));

    const top = document.createElement("div");
    top.className = "calDate";
    top.textContent = dayNumber;

    const bottom = document.createElement("div");
    bottom.className = "calHours";

    if(data && data.hasJornada){
      cell.classList.add("on");

      // SOLO EFECTIVAS en UI
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
 * WEEK BARS (Semana seleccionada) - EFECTIVAS
 **********************************************************/
function renderWeekBars(){
  const week = monthWeeks[currentWeekIndex] || null;
  const weekLabel = byId("weekLabel");
  if(!week || !weekLabel) return;

  weekLabel.textContent =
    `Semana ${currentWeekIndex+1} · Del ${fmtDM(week.start)} al ${fmtDM(week.end)}`;

  const totals = [0,0,0,0,0,0,0];

  allDays
    .filter(d => d.hasJornada && inRange(d.date, week.start, week.end))
    .forEach(d => { totals[d.weekday] += d.hours; }); // EFECTIVAS

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

  // Totales por día de semana (mes completo) - EFECTIVAS
  const monthDayTotals = [0,0,0,0,0,0,0];
  const monthJornadaDays = allDays.filter(d => d.m === currentMonth && d.hasJornada);

  monthJornadaDays.forEach(d => {
    monthDayTotals[d.weekday] += d.hours;
  });

  // Totales por semana - EFECTIVAS
  const weekTotals = monthWeeks.map(w => {
    let sum = 0;
    allDays
      .filter(d => d.hasJornada && inRange(d.date, w.start, w.end))
      .forEach(d => sum += d.hours);
    return sum;
  });

  const monthTotal = weekTotals.reduce((a,b)=>a+b,0);

  totalsGrid.innerHTML = "";

  const box1 = document.createElement("div");
  box1.className = "totalsBox";
  box1.innerHTML = `
    <div class="totalsTitle">Totales por día (mes) · efectivas</div>
    <div class="totalsList">
      ${DAYS.map((d,i)=>`
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
    allDays
      .filter(d => d.hasJornada && inRange(d.date, w.start, w.end))
      .forEach(d => sum += d.hours);
    return sum;
  });

  let topWeekIndex = 0;
  for(let i=1;i<weekTotals.length;i++){
    if(weekTotals[i] > weekTotals[topWeekIndex]) topWeekIndex = i;
  }

  // KPI: Promedio semanal (EFECTIVO)
  const weekAvg = weekTotals.length
    ? (weekTotals.reduce((a,b)=>a+b,0) / weekTotals.length)
    : 0;

  // KPI: Día de semana más pesado (EFECTIVO)
  const weekdayTotals = [0,0,0,0,0,0,0];
  jornadaDays.forEach(d => weekdayTotals[d.weekday] += d.hours);

  let topWeekday = 0;
  for(let i=1;i<7;i++){
    if(weekdayTotals[i] > weekdayTotals[topWeekday]) topWeekday = i;
  }

  // === PINTAR ===
  const elTopDay = byId("kpiTopDay");
  const elTopDayHint = byId("kpiTopDayHint");
  const elTopWeek = byId("kpiTopWeek");
  const elTopWeekHint = byId("kpiTopWeekHint");
  const elMonthTotal = byId("kpiMonthTotal");
  const elMonthTotalHint = byId("kpiMonthTotalHint");
  const elWeekAvg = byId("kpiWeekAvg");
  const elWeekAvgHint = byId("kpiWeekAvgHint");
  const elTopWeekday = byId("kpiTopWeekday");
  const elTopWeekdayHint = byId("kpiTopWeekdayHint");
  const elDaysWith = byId("kpiDaysWithJornada");
  const elDaysWithHint = byId("kpiDaysWithJornadaHint");

  const elLunchDays = byId("kpiLunchDays");
  const elLunchDaysHint = byId("kpiLunchDaysHint");
  const elLunchHours = byId("kpiLunchHours");
  const elLunchHoursHint = byId("kpiLunchHoursHint");

  const elRawTotal = byId("kpiRawTotal");
  const elRawTotalHint = byId("kpiRawTotalHint");

  if(elTopDay){
    if(topDay){
      elTopDay.textContent = `${String(topDay.d).padStart(2,"0")}/${String(topDay.m+1).padStart(2,"0")}`;
      if(elTopDayHint){
        const lunchMark = topDay.lunchHours ? " 🍽️" : "";
        elTopDayHint.textContent = `${topDay.hours.toFixed(1)}h · ${topDay.label}${lunchMark}`;
      }
    } else {
      elTopDay.textContent = "--";
      if(elTopDayHint) elTopDayHint.textContent = "No hay jornadas en este mes";
    }
  }

  if(elTopWeek){
    elTopWeek.textContent = `Semana ${topWeekIndex+1}`;
    const w = monthWeeks[topWeekIndex];
    if(elTopWeekHint){
      elTopWeekHint.textContent = w
        ? `${weekTotals[topWeekIndex].toFixed(1)}h · Del ${fmtDM(w.start)} al ${fmtDM(w.end)}`
        : `${weekTotals[topWeekIndex].toFixed(1)}h`;
    }
  }

  if(elMonthTotal) elMonthTotal.textContent = `${effectiveTotal.toFixed(1)}h`;
  if(elMonthTotalHint) elMonthTotalHint.textContent = "Horas efectivas (almuerzo ya descontado)";

  if(elWeekAvg) elWeekAvg.textContent = `${weekAvg.toFixed(1)}h`;
  if(elWeekAvgHint) elWeekAvgHint.textContent = "Promedio semanal efectivo";

  if(elTopWeekday) elTopWeekday.textContent = DAYS[topWeekday];
  if(elTopWeekdayHint) elTopWeekdayHint.textContent = `${weekdayTotals[topWeekday].toFixed(1)}h acumuladas`;

  if(elDaysWith) elDaysWith.textContent = `${jornadaDays.length}`;
  if(elDaysWithHint) elDaysWithHint.textContent = `Días con horario asignado en ${MONTHS[currentMonth]}`;

  if(elLunchDays) elLunchDays.textContent = `${lunchDaysCount}`;
  if(elLunchDaysHint) elLunchDaysHint.textContent = "Jornadas > 6h (se descuenta 1h)";

  if(elLunchHours) elLunchHours.textContent = `${lunchHoursTotal.toFixed(1)}h`;
  if(elLunchHoursHint) elLunchHoursHint.textContent = "Horas descontadas (NO suman a nada)";

  if(elRawTotal) elRawTotal.textContent = `${rawTotal.toFixed(1)}h`;
  if(elRawTotalHint) elRawTotalHint.textContent = "Informativo: horas sin descuento";

  renderLunchDaysList(lunchDays);
}

/**********************************************************
 * ✅ KPIs ANUALES (NUEVO)
 * Llenan IDs del panel anual del index.html
 **********************************************************/
function renderYearKPIs(){
  // Si el index todavía no tiene los IDs, no rompemos nada:
  const guard = byId("kpiYearTotal");
  if(!guard) return;

  // Map rápido por fecha para saber si ese día existe en TSV
  const mapByISO = new Map();
  for(const d of allDays){
    const iso = `${d.y}-${String(d.m+1).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
    mapByISO.set(iso, d);
  }

  // Recorremos TODOS los días del año para contar "sin jornada" de forma consistente.
  const yearStart = new Date(YEAR, 0, 1);
  const yearEnd = new Date(YEAR, 11, 31);

  let daysWithJornadaYear = 0;
  let daysWithoutJornadaYear = 0;

  for(let dt = new Date(yearStart); dt <= yearEnd; dt.setDate(dt.getDate() + 1)){
    const iso = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    const rec = mapByISO.get(iso);
    if(rec && rec.hasJornada) daysWithJornadaYear++;
    else daysWithoutJornadaYear++;
  }

  // Totales anuales (desde registros con jornada)
  const jornadaYear = allDays.filter(d => d.y === YEAR && d.hasJornada);
  const effectiveYearTotal = jornadaYear.reduce((a,d)=>a + d.hours, 0);
  const rawYearTotal = jornadaYear.reduce((a,d)=>a + d.rawHours, 0);

  // Almuerzo anual (solo reporte)
  const lunchHoursYear = jornadaYear.reduce((a,d)=>a + d.lunchHours, 0);

  // Promedio mensual efectivo (12 meses)
  const monthTotals = Array(12).fill(0);
  const monthRawTotals = Array(12).fill(0);
  const monthLunch = Array(12).fill(0);

  jornadaYear.forEach(d=>{
    monthTotals[d.m] += d.hours;
    monthRawTotals[d.m] += d.rawHours;
    monthLunch[d.m] += d.lunchHours;
  });

  const monthAvg = monthTotals.reduce((a,b)=>a+b,0) / 12;

  // Mes más cargado
  let topMonth = 0;
  for(let m=1;m<12;m++){
    if(monthTotals[m] > monthTotals[topMonth]) topMonth = m;
  }

  // Día de semana más pesado del año
  const weekdayTotalsYear = [0,0,0,0,0,0,0];
  jornadaYear.forEach(d => weekdayTotalsYear[d.weekday] += d.hours);

  let topWeekdayYear = 0;
  for(let i=1;i<7;i++){
    if(weekdayTotalsYear[i] > weekdayTotalsYear[topWeekdayYear]) topWeekdayYear = i;
  }

  // Semana más cargada del año (lun-dom)
  const yearWeeks = getWeeksForYear(YEAR);
  const yearWeekTotals = yearWeeks.map(w=>{
    let sum = 0;
    jornadaYear
      .filter(d => inRange(d.date, w.start, w.end))
      .forEach(d => sum += d.hours);
    return sum;
  });

  let topWeekYearIndex = 0;
  for(let i=1;i<yearWeekTotals.length;i++){
    if(yearWeekTotals[i] > yearWeekTotals[topWeekYearIndex]) topWeekYearIndex = i;
  }

  const topWeekObj = yearWeeks[topWeekYearIndex];

  // PINTAR
  safeSetText("kpiYearTotal", `${effectiveYearTotal.toFixed(1)}h`);
  safeSetText("kpiYearTotalHint", "Horas efectivas del año (almuerzo ya descontado)");

  safeSetText("kpiYearMonthAvg", `${monthAvg.toFixed(1)}h`);
  safeSetText("kpiYearMonthAvgHint", "Promedio mensual efectivo (12 meses)");

  safeSetText("kpiTopMonth", `${MONTHS[topMonth]}`);
  safeSetText("kpiTopMonthHint", `${monthTotals[topMonth].toFixed(1)}h efectivas · (${rawYearTotal ? (monthRawTotals[topMonth].toFixed(1) + "h sin descuento") : ""})`.trim());

  safeSetText("kpiTopWeekYear", `Semana ${topWeekYearIndex+1}`);
  safeSetText(
    "kpiTopWeekYearHint",
    topWeekObj
      ? `${yearWeekTotals[topWeekYearIndex].toFixed(1)}h · Del ${fmtDM(topWeekObj.start)} al ${fmtDM(topWeekObj.end)}`
      : `${yearWeekTotals[topWeekYearIndex].toFixed(1)}h`
  );

  safeSetText("kpiTopWeekdayYear", `${DAYS[topWeekdayYear]}`);
  safeSetText("kpiTopWeekdayYearHint", `${weekdayTotalsYear[topWeekdayYear].toFixed(1)}h acumuladas`);

  safeSetText("kpiLunchHoursYear", `${lunchHoursYear.toFixed(1)}h`);
  safeSetText("kpiLunchHoursYearHint", "Total de horas descontadas por la regla (>6h) en el año");

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

  // Ordena por fecha
  const sorted = [...lunchDays].sort((a,b)=>a.date - b.date);

  sorted.forEach(d=>{
    const chip = document.createElement("div");
    chip.className = "chip chip--on";
    chip.style.display = "inline-flex";
    chip.style.margin = "4px 6px 0 0";
    chip.style.gap = "8px";
    chip.style.alignItems = "center";

    chip.textContent =
      `${DAYS[d.weekday]} ${fmtDM(d.date)} · ${d.hours.toFixed(1)}h (−${d.lunchHours}h 🍽️)`;

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
 * START
 **********************************************************/
wireNav();
load().catch(err=>{
  console.error(err);
  alert("Error cargando datos. Revisa la URL TSV o permisos del Sheet.");
});

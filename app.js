"use strict";

/* ==========================================
   TRADELEDGER - COMPLETE REPLACEMENT
   Existing IndexedDB data preserved
========================================== */

const $ = id => document.getElementById(id);

const DB_NAME = "TradeLedgerDB";
const SETTINGS_KEY = "TradeLedgerColumnSettings";
const DRIVE_CONNECTION_KEY = "TradeLedgerDriveConnection";
const REPORTS_KEY = "TradeLedgerReports";
const REPORT_SETTINGS_KEY = "TradeLedgerReportSettings";

const GOOGLE_CLIENT_ID =
  "396461936533-pofda319pj3k3rr9iundh7nnnnnjtt6u5.apps.googleusercontent.com";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER_NAME = "TradeLedger Backups";
const DRIVE_BACKUP_NAME = "TradeLedger-Backup.json";

let db = null;
let trades = [];
let fields = [];
let currentMode = "intraday";
let currentSection = "dashboardSection";
let editingTradeId = null;
let currentAttachments = [];

let currentReportPeriod = "daily";
let selectedReportCell = null;
let selectedReportColumn = null;
let reportData = {};
let reportSettings = {};

let driveAccessToken = null;
let driveTokenClient = null;
let driveFolderId = null;
let driveBackupFileId = null;
let drivePendingResolve = null;
let drivePendingReject = null;

let eventsInitialized = false;
let databaseReady = false;
let databaseReadyPromise = null;
let tradeLedgerBooted = false;

const STANDARD_FIELDS = [
  {key:"date",label:"Date",section:"basic",type:"date"},
  {key:"voucherNumber",label:"Voucher Number",section:"basic",type:"text"},
  {key:"stockName",label:"Stock Name",section:"basic",type:"text"},
  {key:"capital",label:"Capital",section:"basic",type:"number"},
  {key:"leverage",label:"Leverage",section:"basic",type:"number"},
  {key:"strategy",label:"Strategy",section:"basic",type:"text"},
  {key:"riskReward",label:"Risk / Reward",section:"basic",type:"text"},
  {key:"tradeResult",label:"Trade Result",section:"basic",type:"text"},
  {key:"buyQty",label:"Buy Quantity",section:"buy",type:"number"},
  {key:"buyPrice",label:"Buy Price",section:"buy",type:"number"},
  {key:"buyStockValue",label:"Buy Stock Value",section:"buy",type:"number"},
  {key:"buyCharge",label:"Buy Charges",section:"buy",type:"number"},
  {key:"extraBuyCharge",label:"Extra Buy Charges",section:"buy",type:"number"},
  {key:"totalBuyCharges",label:"Total Buy Charges",section:"buy",type:"number"},
  {key:"totalBuyValue",label:"Total Buy Value",section:"buy",type:"number"},
  {key:"sellQty",label:"Sell Quantity",section:"sell",type:"number"},
  {key:"sellPrice",label:"Sell Price",section:"sell",type:"number"},
  {key:"sellStockValue",label:"Sell Stock Value",section:"sell",type:"number"},
  {key:"sellCharge",label:"Sell Charges",section:"sell",type:"number"},
  {key:"extraSellCharge",label:"Extra Sell Charges",section:"sell",type:"number"},
  {key:"totalSellCharges",label:"Total Sell Charges",section:"sell",type:"number"},
  {key:"totalSellValue",label:"Total Sell Value",section:"sell",type:"number"},
  {key:"priceMovement",label:"Price Movement",section:"pl",type:"number"},
  {key:"grossPL",label:"Gross Profit / Loss",section:"pl",type:"number"},
  {key:"totalCharges",label:"Total Charges",section:"pl",type:"number"},
  {key:"netPL",label:"Net Profit / Loss",section:"pl",type:"number"},
  {key:"notes",label:"Notes",section:"attachments",type:"textarea"}
];

const REPORT_HEADINGS = {
  daily:["Voucher Number","Date","Gross Profit","Charges","Net Profit"],
  weekly:["Voucher Number","Weeks","Gross Profit","Charges","Net Profit"],
  monthly:["Voucher Number","Month","Gross Profit","Charges","Net Profit"],
  yearly:["Voucher Number","Year","Gross Profit","Charges","Net Profit"]
};

const SECTION_INFO = {
  basic:{container:"basicFieldsContainer",custom:"customBasicFields"},
  buy:{container:"buyFieldsContainer",custom:"customBuyFields"},
  sell:{container:"sellFieldsContainer",custom:"customSellFields"},
  pl:{container:"plFieldsContainer",custom:"customPLFields"},
  attachments:{container:"attachmentFieldsContainer",custom:"customAttachmentFields"}
};

/* ==========================================
   UTILITIES
========================================== */

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[char]);
}

function numberValue(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function money(value) {
  return "₹" + numberValue(value).toFixed(2);
}

function makeId() {
  return "TL-" + Date.now().toString(36) +
    "-" + Math.random().toString(36).slice(2,8);
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"),2800);
}

function readJSON(key,fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch(error) {
    console.error("JSON read error:",key,error);
    return fallback;
  }
}

function writeJSON(key,value) {
  localStorage.setItem(key,JSON.stringify(value));
}

function getFormValue(id) {
  return $(id)?.value ?? "";
}

function requireDatabase() {
  if (!db || !databaseReady) throw new Error("Database is not ready.");
}

async function waitForDatabase() {
  if (databaseReady && db) return;
  if (databaseReadyPromise) await databaseReadyPromise;
  requireDatabase();
}

/* ==========================================
   INDEXED DB
   Existing stores are never deleted.
========================================== */

function requestResult(request) {
  return new Promise((resolve,reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error || new Error("IndexedDB request failed.")
    );
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve,reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error || new Error("Database transaction failed.")
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("Database transaction aborted.")
    );
  });
}

function createMissingStores(database) {
  if (!database.objectStoreNames.contains("trades")) {
    database.createObjectStore("trades",{keyPath:"id"});
  }
  if (!database.objectStoreNames.contains("fields")) {
    database.createObjectStore("fields",{keyPath:"id"});
  }
  if (!database.objectStoreNames.contains("reports")) {
    database.createObjectStore("reports",{keyPath:"id"});
  }
}

async function openDatabase() {
  databaseReady = false;
  const first = await requestResult(indexedDB.open(DB_NAME));
  const required = ["trades","fields","reports"];
  const missing = required.some(name => !first.objectStoreNames.contains(name));

  if (!missing) {
    db = first;
  } else {
    const oldVersion = first.version;
    first.close();

    db = await new Promise((resolve,reject) => {
      const request = indexedDB.open(DB_NAME,oldVersion + 1);
      request.onupgradeneeded = event => createMissingStores(event.target.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(
        request.error || new Error("Database upgrade failed.")
      );
      request.onblocked = () => reject(
        new Error("Database upgrade is blocked. Close other TradeLedger tabs.")
      );
    });
  }

  for (const name of required) {
    if (!db.objectStoreNames.contains(name)) {
      db.close();
      db = null;
      throw new Error("Required database store missing: " + name);
    }
  }

  db.onversionchange = () => {
    databaseReady = false;
    db.close();
    showToast("Database updated. Reload TradeLedger.");
  };

  return db;
}

async function getAllFromStore(storeName) {
  if (!db || !db.objectStoreNames.contains(storeName)) {
    throw new Error("Database store unavailable: " + storeName);
  }
  const transaction = db.transaction(storeName,"readonly");
  return requestResult(transaction.objectStore(storeName).getAll());
}

async function putIntoStore(storeName,value) {
  await waitForDatabase();
  if (!db.objectStoreNames.contains(storeName)) {
    throw new Error("Database store unavailable: " + storeName);
  }
  const transaction = db.transaction(storeName,"readwrite");
  const done = transactionComplete(transaction);
  transaction.objectStore(storeName).put(value);
  await done;
}

async function deleteFromStore(storeName,id) {
  await waitForDatabase();
  if (!db.objectStoreNames.contains(storeName)) {
    throw new Error("Database store unavailable: " + storeName);
  }
  const transaction = db.transaction(storeName,"readwrite");
  const done = transactionComplete(transaction);
  transaction.objectStore(storeName).delete(id);
  await done;
}

async function loadDatabaseData() {
  trades = await getAllFromStore("trades");
  fields = await getAllFromStore("fields");
  reportData = readJSON(REPORTS_KEY,{});
  reportSettings = readJSON(REPORT_SETTINGS_KEY,{});

  ["daily","weekly","monthly","yearly"].forEach(period => {
    if (!Array.isArray(reportData[period])) reportData[period] = [];
  });
}

/* ==========================================
   REPORT STORAGE
========================================== */

function saveReportsLocally() {
  writeJSON(REPORTS_KEY,reportData);
  writeJSON(REPORT_SETTINGS_KEY,reportSettings);
}

async function saveReportToDatabase() {
  await putIntoStore("reports",{
    id:"main-reports",
    data:reportData,
    settings:reportSettings,
    updatedAt:new Date().toISOString()
  });
  saveReportsLocally();
}

async function loadReportsFromDatabase() {
  const records = await getAllFromStore("reports");
  const saved = records.find(item => item.id === "main-reports");

  if (saved) {
    reportData = saved.data || reportData;
    reportSettings = saved.settings || reportSettings;
  }

  ["daily","weekly","monthly","yearly"].forEach(period => {
    if (!Array.isArray(reportData[period])) reportData[period] = [];
  });

  saveReportsLocally();
}

/* ==========================================
   TRADING MODE / NAVIGATION
========================================== */

function setTradingMode(mode) {
  if (!["intraday","swing","longterm","backup"].includes(mode)) return;

  currentMode = mode;
  document.querySelectorAll(".mode-btn").forEach(button => {
    button.classList.toggle("active",button.dataset.mode === mode);
  });

  [
    "intradayWorkspace","swingWorkspace",
    "longtermWorkspace","backupWorkspace"
  ].forEach(id => $(id)?.classList.add("hidden"));

  const map = {
    intraday:"intradayWorkspace",
    swing:"swingWorkspace",
    longterm:"longtermWorkspace",
    backup:"backupWorkspace"
  };

  $(map[mode])?.classList.remove("hidden");

  if (mode === "swing" || mode === "longterm") renderModeWorkspace();
  if (mode === "backup") updateDriveStatus();

  if (mode !== "backup") {
    renderDashboard();
    renderJournal();
  }
}

function renderModeWorkspace() {
  const id = currentMode === "swing" ? "swingWorkspace" : "longtermWorkspace";
  $(id)?.replaceChildren();
}

function showSection(sectionId) {
  const target = $(sectionId);
  if (!target) {
    console.warn("TradeLedger section not found:",sectionId);
    return;
  }

  currentSection = sectionId;

  document.querySelectorAll(".page-section").forEach(section => {
    section.classList.toggle("active",section.id === sectionId);
  });

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle("active",button.dataset.section === sectionId);
  });

  if (sectionId === "reportsSection") renderReportTable();
  if (sectionId === "fieldManagerSection") renderFieldList();
  if (sectionId === "tradeJournalSection") renderJournal();
  if (sectionId === "periodOverviewSection") renderPeriodOverview();
}

/* ==========================================
   TRADE CALCULATIONS
========================================== */

function calculateTrade() {
  const buyQty = numberValue($("buyQty")?.value);
  const buyPrice = numberValue($("buyPrice")?.value);
  const buyCharge = numberValue($("buyCharge")?.value);
  const extraBuyCharge = numberValue($("extraBuyCharge")?.value);
  const sellQty = numberValue($("sellQty")?.value);
  const sellPrice = numberValue($("sellPrice")?.value);
  const sellCharge = numberValue($("sellCharge")?.value);
  const extraSellCharge = numberValue($("extraSellCharge")?.value);

  const buyStockValue = buyQty * buyPrice;
  const sellStockValue = sellQty * sellPrice;
  const totalBuyCharges = buyCharge + extraBuyCharge;
  const totalSellCharges = sellCharge + extraSellCharge;
  const totalBuyValue = buyStockValue + totalBuyCharges;
  const totalSellValue = sellStockValue - totalSellCharges;
  const matchedQty = Math.min(buyQty,sellQty);
  const grossPL = matchedQty * (sellPrice - buyPrice);
  const totalCharges = totalBuyCharges + totalSellCharges;
  const netPL = grossPL - totalCharges;
  const priceMovement = sellPrice - buyPrice;

  const values = {
    buyStockValue,totalBuyCharges,totalBuyValue,
    sellStockValue,totalSellCharges,totalSellValue,
    priceMovement,grossPL,totalCharges,netPL
  };

  Object.entries(values).forEach(([id,value]) => {
    const target = $(
      id === "grossPL" ? "grossPLInput" :
      id === "totalCharges" ? "totalChargesInput" :
      id === "netPL" ? "netPLInput" : id
    );
    if (target) target.value = value.toFixed(2);
  });

  return values;
}

/* ==========================================
   TRADE FORM / CUSTOM FIELD VALUES
========================================== */

function getCustomFieldValues() {
  const values = {};
  fields.forEach(field => {
    const element = $("custom_" + field.id);
    if (element) values[field.id] = element.value;
  });
  return values;
}

function collectTradeData() {
  const calculated = calculateTrade();

  return {
    id:editingTradeId || makeId(),
    mode:currentMode,
    date:getFormValue("tradeDate"),
    voucherNumber:getFormValue("voucherNumber"),
    stockName:getFormValue("stockName"),
    capital:numberValue(getFormValue("capital")),
    leverage:numberValue(getFormValue("leverage")),
    strategy:getFormValue("strategy"),
    riskReward:getFormValue("riskReward"),
    tradeResult:getFormValue("tradeResult"),
    buyQty:numberValue(getFormValue("buyQty")),
    buyPrice:numberValue(getFormValue("buyPrice")),
    buyStockValue:calculated.buyStockValue,
    buyCharge:numberValue(getFormValue("buyCharge")),
    extraBuyCharge:numberValue(getFormValue("extraBuyCharge")),
    totalBuyCharges:calculated.totalBuyCharges,
    totalBuyValue:calculated.totalBuyValue,
    sellQty:numberValue(getFormValue("sellQty")),
    sellPrice:numberValue(getFormValue("sellPrice")),
    sellStockValue:calculated.sellStockValue,
    sellCharge:numberValue(getFormValue("sellCharge")),
    extraSellCharge:numberValue(getFormValue("extraSellCharge")),
    totalSellCharges:calculated.totalSellCharges,
    totalSellValue:calculated.totalSellValue,
    priceMovement:calculated.priceMovement,
    grossPL:calculated.grossPL,
    totalCharges:calculated.totalCharges,
    netPL:calculated.netPL,
    notes:getFormValue("notes"),
    customValues:getCustomFieldValues(),
    attachments:currentAttachments,
    updatedAt:new Date().toISOString()
  };
}

async function saveTrade(event) {
  event.preventDefault();

  if (!getFormValue("stockName").trim()) {
    showToast("Please enter stock name.");
    return;
  }

  const trade = collectTradeData();

  if (!trade.date) {
    showToast("Please select trade date.");
    return;
  }
  if (trade.buyQty < 0 || trade.sellQty < 0) {
    showToast("Quantity cannot be negative.");
    return;
  }
  if (trade.sellQty > trade.buyQty) {
    showToast("Sell quantity cannot exceed buy quantity.");
    return;
  }

  try {
    const index = trades.findIndex(item => item.id === trade.id);
    if (index < 0) trade.createdAt = new Date().toISOString();

    await putIntoStore("trades",trade);

    if (index >= 0) trades[index] = trade;
    else trades.push(trade);

    showToast(index >= 0 ? "Trade updated." : "Trade saved.");
    resetForm();
    await renderEverything();
    showSection("tradeJournalSection");
  } catch(error) {
    console.error(error);
    showToast("Unable to save trade: " + error.message);
  }
}

function resetForm() {
  $("tradeForm")?.reset();
  editingTradeId = null;
  currentAttachments = [];

  if ($("tradeId")) $("tradeId").value = "";
  if ($("leverage")) $("leverage").value = "1";

  ["buyCharge","extraBuyCharge","sellCharge","extraSellCharge"].forEach(id => {
    if ($(id)) $(id).value = "0";
  });

  if ($("tradeFormTitle")) $("tradeFormTitle").textContent = "Add Trade";
  if ($("saveTradeBtn")) $("saveTradeBtn").textContent = "Save Trade";
  if ($("attachmentInfo")) $("attachmentInfo").textContent = "";

  renderCustomFormFields();
  calculateTrade();
}

function editTrade(id) {
  const trade = trades.find(item => item.id === id);
  if (!trade) return;

  editingTradeId = id;
  currentMode = trade.mode || "intraday";
  setTradingMode(currentMode);

  const mapping = {
    tradeDate:trade.date,
    voucherNumber:trade.voucherNumber,
    stockName:trade.stockName,
    capital:trade.capital,
    leverage:trade.leverage,
    strategy:trade.strategy,
    riskReward:trade.riskReward,
    tradeResult:trade.tradeResult,
    buyQty:trade.buyQty,
    buyPrice:trade.buyPrice,
    buyCharge:trade.buyCharge,
    extraBuyCharge:trade.extraBuyCharge,
    sellQty:trade.sellQty,
    sellPrice:trade.sellPrice,
    sellCharge:trade.sellCharge,
    extraSellCharge:trade.extraSellCharge,
    notes:trade.notes
  };

  Object.entries(mapping).forEach(([key,value]) => {
    if ($(key)) $(key).value = value ?? "";
  });

  if ($("tradeId")) $("tradeId").value = trade.id;

  currentAttachments = Array.isArray(trade.attachments)
    ? [...trade.attachments] : [];

  renderCustomFormFields();

  fields.forEach(field => {
    const element = $("custom_" + field.id);
    if (element) element.value = trade.customValues?.[field.id] ?? "";
  });

  calculateTrade();
  if ($("tradeFormTitle")) $("tradeFormTitle").textContent = "Edit Trade";
  if ($("saveTradeBtn")) $("saveTradeBtn").textContent = "Update Trade";
  showSection("tradeFormSection");
}

async function removeTrade(id) {
  const trade = trades.find(item => item.id === id);
  if (!trade) return;
  if (!confirm("Delete trade " + (trade.stockName || "") + "?")) return;

  try {
    await deleteFromStore("trades",id);
    trades = trades.filter(item => item.id !== id);
    showToast("Trade deleted.");
    await renderEverything();
  } catch(error) {
    showToast("Delete failed: " + error.message);
  }
}

function viewTrade(id) {
  const trade = trades.find(item => item.id === id);
  const content = $("viewTradeContent");
  if (!trade || !content) return;

  const rows = [
    ["Date",trade.date],["Voucher Number",trade.voucherNumber],
    ["Stock Name",trade.stockName],["Mode",trade.mode],
    ["Capital",money(trade.capital)],["Leverage",trade.leverage],
    ["Buy Quantity",trade.buyQty],["Buy Price",money(trade.buyPrice)],
    ["Buy Value",money(trade.buyStockValue)],
    ["Buy Charges",money(trade.totalBuyCharges)],
    ["Sell Quantity",trade.sellQty],["Sell Price",money(trade.sellPrice)],
    ["Sell Value",money(trade.sellStockValue)],
    ["Sell Charges",money(trade.totalSellCharges)],
    ["Gross P&L",money(trade.grossPL)],
    ["Total Charges",money(trade.totalCharges)],
    ["Net P&L",money(trade.netPL)],
    ["Strategy",trade.strategy],["Risk / Reward",trade.riskReward],
    ["Result",trade.tradeResult],["Notes",trade.notes]
  ];

  content.innerHTML = `<div class="table-wrap"><table><tbody>
    ${rows.map(([label,value]) =>
      `<tr><th>${safeText(label)}</th><td>${safeText(value ?? "")}</td></tr>`
    ).join("")}
  </tbody></table></div>`;

  $("viewModal")?.classList.remove("hidden");
}

/* ==========================================
   JOURNAL
========================================== */

function getVisibleTrades() {
  return trades.filter(trade => (trade.mode || "intraday") === currentMode);
}

function renderJournal() {
  const head = $("journalHead");
  const body = $("journalBody");
  if (!head || !body) return;

  const search = getFormValue("journalSearch").toLowerCase().trim();
  const settings = getFieldSettings();
  const columns = [
    {key:"date",label:"Date"},
    {key:"voucherNumber",label:"Voucher"},
    {key:"stockName",label:"Stock"},
    {key:"buyQty",label:"Buy Qty"},
    {key:"buyPrice",label:"Buy Price"},
    {key:"sellQty",label:"Sell Qty"},
    {key:"sellPrice",label:"Sell Price"},
    {key:"grossPL",label:"Gross P&L"},
    {key:"totalCharges",label:"Charges"},
    {key:"netPL",label:"Net P&L"}
  ].filter(column => !settings[column.key]?.hidden);

  head.innerHTML = `<tr>${columns.map(column => `<th>${safeText(settings[column.key]?.label || column.label)}</th>`).join("")}<th>Actions</th></tr>`;

  const visible = getVisibleTrades().filter(trade => {
    const searchable = [trade.stockName,trade.voucherNumber,trade.notes,trade.strategy]
      .join(" ").toLowerCase();
    return searchable.includes(search);
  }).sort((a,b) => String(b.date || "").localeCompare(String(a.date || "")));

  if ($("journalTradeCount")) $("journalTradeCount").textContent = visible.length + " trades";
  if (!visible.length) {
    body.innerHTML = `<tr><td colspan="${columns.length + 1}" class="empty-cell">No trades found.</td></tr>`;
    return;
  }

  body.innerHTML = visible.map(trade => `<tr>
    ${columns.map(column => {
      const value = trade[column.key];
      return `<td>${["grossPL","totalCharges","netPL","buyPrice","sellPrice"].includes(column.key) ? money(value) : safeText(value ?? "")}</td>`;
    }).join("")}
    <td><div class="table-action">
      <button class="small-btn" data-view-trade="${safeText(trade.id)}">View</button>
      <button class="small-btn" data-edit-trade="${safeText(trade.id)}">Edit</button>
      <button class="small-btn" data-delete-trade="${safeText(trade.id)}">Delete</button>
    </div></td>
  </tr>`).join("");
}

/* ==========================================
   DASHBOARD - EXACTLY 8 METRICS
   Eight dashboard metrics only
========================================== */

function renderDashboard() {
  const list = getVisibleTrades();
  const total = list.length;
  const gross = list.reduce((s,t) => s + numberValue(t.grossPL),0);
  const charges = list.reduce((s,t) => s + numberValue(t.totalCharges),0);
  const net = list.reduce((s,t) => s + numberValue(t.netPL),0);
  const wins = list.filter(t => numberValue(t.netPL) > 0).length;
  const losses = list.filter(t => numberValue(t.netPL) < 0).length;
  const winRate = total ? wins / total * 100 : 0;
  const lossRate = total ? losses / total * 100 : 0;

  const values = {
    dashTotalTrades:total,
    dashWins:wins,
    dashLosses:losses,
    dashWinRate:winRate.toFixed(1) + "%",
    dashLossRate:lossRate.toFixed(1) + "%",
    dashGrossPL:money(gross),
    dashCharges:money(charges),
    dashNetPL:money(net)
  };

  Object.entries(values).forEach(([id,value]) => {
    if ($(id)) $(id).textContent = value;
  });

  if ($("dashNetPL")) {
    $("dashNetPL").className = net >= 0 ? "profit" : "loss";
  }
}

/* ==========================================
   PERIOD OVERVIEW
========================================== */

function renderPeriodOverview() {
  const start = getFormValue("periodStartDate");
  const end = getFormValue("periodEndDate");

  const filtered = getVisibleTrades().filter(trade => {
    if (start && trade.date < start) return false;
    if (end && trade.date > end) return false;
    return true;
  });

  const gross = filtered.reduce((s,t) => s + numberValue(t.grossPL),0);
  const charges = filtered.reduce((s,t) => s + numberValue(t.totalCharges),0);
  const net = filtered.reduce((s,t) => s + numberValue(t.netPL),0);

  if ($("periodGrossPL")) $("periodGrossPL").textContent = money(gross);
  if ($("periodTotalCharges")) $("periodTotalCharges").textContent = money(charges);
  if ($("periodNetPL")) $("periodNetPL").textContent = money(net);
  if ($("periodMessage")) {
    $("periodMessage").textContent =
      filtered.length + " trades in selected period.";
  }
}

/* ==========================================
   CSV EXPORT
========================================== */

function csvEscape(value) {
  return '"' + String(value ?? "").replace(/"/g,'""') + '"';
}

function downloadFile(filename,content,type) {
  const blob = new Blob([content],{type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

function exportJournalCSV() {
  const columns = [
    ["Date","date"],["Voucher Number","voucherNumber"],
    ["Stock Name","stockName"],["Buy Quantity","buyQty"],
    ["Buy Price","buyPrice"],["Sell Quantity","sellQty"],
    ["Sell Price","sellPrice"],["Gross P&L","grossPL"],
    ["Total Charges","totalCharges"],["Net P&L","netPL"],
    ["Notes","notes"]
  ];

  const rows = [
    columns.map(c => csvEscape(c[0])).join(","),
    ...getVisibleTrades().map(trade =>
      columns.map(c => csvEscape(trade[c[1]])).join(",")
    )
  ];

  downloadFile(
    "TradeLedger-Journal.csv",
    "\uFEFF" + rows.join("\r\n"),
    "text/csv;charset=utf-8"
  );
}

/* ==========================================
   FIELD MANAGER
========================================== */

function getFieldSettings() {
  return readJSON(SETTINGS_KEY,{});
}

function saveFieldSettings(settings) {
  writeJSON(SETTINGS_KEY,settings);
}

function renderFieldList() {
  const container = $("fieldManagerList");
  if (!container) return;
  const settings = getFieldSettings();

  const standardHTML = STANDARD_FIELDS.map(field => {
    const saved = settings[field.key] || {};
    const hidden = Boolean(saved.hidden);
    return `<div class="field-manager-item">
      <div class="field-manager-info">
        <strong>${safeText(saved.label || field.label)}</strong>
        <small>ID: <code>${safeText(field.key)}</code> · Standard field · ${safeText(field.section)} · ${safeText(field.type)}${hidden ? " · Hidden from Journal" : ""}</small>
      </div>
      <div class="field-manager-actions">
        <button type="button" data-edit-standard="${safeText(field.key)}">Edit</button>
        <button type="button" class="${hidden ? "restore-field-btn" : "delete-field-btn"}" data-toggle-standard="${safeText(field.key)}">${hidden ? "Show" : "Delete"}</button>
      </div>
    </div>`;
  }).join("");

  const customHTML = fields.map(field => `
    <div class="field-manager-item">
      <div class="field-manager-info">
        <strong>${safeText(field.label || field.name || "Custom Field")}</strong>
        <small>ID: <code>${safeText(field.id)}</code> · Custom field · ${safeText(field.section || "basic")} · ${safeText(field.type || "text")}${field.hidden ? " · Hidden" : ""}</small>
      </div>
      <div class="field-manager-actions">
        <button type="button" data-edit-custom="${safeText(field.id)}">Edit</button>
        <button type="button" data-toggle-field="${safeText(field.id)}">${field.hidden ? "Show" : "Hide"}</button>
        <button type="button" class="delete-field-btn" data-delete-field="${safeText(field.id)}">Delete</button>
      </div>
    </div>`).join("");

  container.innerHTML = `<h3>Standard Fields</h3>
    <p class="muted-text field-manager-note">Standard field Delete hides that Journal column only. Core trade data and calculations are preserved.</p>
    ${standardHTML}<div class="divider"></div><h3>Custom Fields</h3>
    ${customHTML || '<p class="muted-text">No custom fields created.</p>'}`;
}

async function toggleStandardField(key) {
  const standard = STANDARD_FIELDS.find(item => item.key === key);
  if (!standard) return;
  const settings = getFieldSettings();
  const current = settings[key] || {};
  const hiding = !current.hidden;
  if (hiding && !confirm("Hide '" + (current.label || standard.label) + "' from the Journal? The original trade data and calculations will be preserved.")) return;
  settings[key] = {...current,hidden:hiding};
  saveFieldSettings(settings);
  renderFieldList();
  renderJournal();
  showToast(hiding ? "Standard Journal column hidden; data preserved." : "Standard Journal column shown.");
}

function openFieldModal() {
  $("fieldManagerModal")?.classList.remove("hidden");
}

function closeFieldModal() {
  $("fieldManagerModal")?.classList.add("hidden");
  $("fieldForm")?.reset();

  if ($("fieldId")) $("fieldId").value = "";
  if ($("fieldModalTitle")) $("fieldModalTitle").textContent = "Add Custom Field";
  if ($("fieldType")) $("fieldType").disabled = false;
  if ($("fieldSection")) $("fieldSection").disabled = false;
}

function editStandardField(key) {
  const field = STANDARD_FIELDS.find(item => item.key === key);
  if (!field) return;

  const current = getFieldSettings()[key] || {};

  if ($("fieldId")) $("fieldId").value = "standard:" + key;
  if ($("fieldName")) $("fieldName").value = current.label || field.label;
  if ($("fieldPlaceholder")) $("fieldPlaceholder").value = current.placeholder || "";
  if ($("fieldType")) {
    $("fieldType").value = field.type;
    $("fieldType").disabled = true;
  }
  if ($("fieldSection")) {
    $("fieldSection").value = field.section;
    $("fieldSection").disabled = true;
  }
  if ($("fieldModalTitle")) $("fieldModalTitle").textContent = "Edit Standard Field";

  openFieldModal();
}

function editCustomField(id) {
  const field = fields.find(item => String(item.id) === String(id));
  if (!field) return;

  if ($("fieldId")) $("fieldId").value = field.id;
  if ($("fieldName")) $("fieldName").value = field.label || field.name || "";
  if ($("fieldPlaceholder")) $("fieldPlaceholder").value = field.placeholder || "";
  if ($("fieldType")) {
    $("fieldType").value = field.type || "text";
    $("fieldType").disabled = false;
  }
  if ($("fieldSection")) {
    $("fieldSection").value = field.section || "basic";
    $("fieldSection").disabled = false;
  }
  if ($("fieldOptions")) $("fieldOptions").value = (field.options || []).join(", ");
  if ($("fieldPosition")) $("fieldPosition").value = field.position || 1;
  if ($("fieldInForm")) $("fieldInForm").checked = field.inForm !== false;
  if ($("fieldRequired")) $("fieldRequired").checked = Boolean(field.required);

  if ($("fieldModalTitle")) $("fieldModalTitle").textContent = "Edit Custom Field";
  openFieldModal();
}

async function saveField(event) {
  event.preventDefault();

  const id = $("fieldId")?.value || "";
  const label = $("fieldName")?.value.trim() || "";
  const placeholder = $("fieldPlaceholder")?.value.trim() || "";

  if (!label) {
    showToast("Enter a field heading.");
    return;
  }

  try {
    if (id.startsWith("standard:")) {
      const key = id.slice(9);
      const standard = STANDARD_FIELDS.find(item => item.key === key);
      if (!standard) return;

      const settings = getFieldSettings();
      settings[key] = {
        ...(settings[key] || {}),
        label,
        placeholder
      };
      saveFieldSettings(settings);
      showToast("Standard field updated.");

    } else {
      const original = id
        ? fields.find(item => String(item.id) === String(id))
        : null;

      if (id && !original) {
        throw new Error("Custom field was not found.");
      }

      const field = {
        ...(original || {}),
        id:original ? original.id : makeId(),
        label,
        name:label,
        placeholder,
        type:$("fieldType")?.value || "text",
        section:$("fieldSection")?.value || "basic",
        options:($("fieldOptions")?.value || "")
          .split(",").map(x => x.trim()).filter(Boolean),
        position:numberValue($("fieldPosition")?.value) || 1,
        inForm:$("fieldInForm")?.checked !== false,
        required:Boolean($("fieldRequired")?.checked),
        hidden:original ? Boolean(original.hidden) : false
      };

      await putIntoStore("fields",field);

      if (original) {
        fields = fields.map(item =>
          String(item.id) === String(id) ? field : item
        );
        showToast("Custom field updated.");
      } else {
        fields.push(field);
        showToast("Custom field added.");
      }
    }

    closeFieldModal();
    renderFieldList();
    renderCustomFormFields();
    renderJournal();

  } catch(error) {
    console.error(error);
    showToast("Unable to save field: " + error.message);
  }
}

async function toggleCustomField(id) {
  const original = fields.find(item => String(item.id) === String(id));
  if (!original) return;

  const field = {...original,hidden:!original.hidden};

  try {
    await putIntoStore("fields",field);
    fields = fields.map(item =>
      String(item.id) === String(id) ? field : item
    );
    renderFieldList();
    renderCustomFormFields();
    showToast(field.hidden ? "Field hidden." : "Field shown.");
  } catch(error) {
    showToast("Unable to update field: " + error.message);
  }
}

async function deleteCustomField(id) {
  const field = fields.find(item => String(item.id) === String(id));
  if (!field) return;

  if (!confirm("Delete custom field " + (field.label || field.name) + "?")) return;

  try {
    await deleteFromStore("fields",field.id);
    fields = fields.filter(item => String(item.id) !== String(id));
    renderFieldList();
    renderCustomFormFields();
    showToast("Custom field deleted.");
  } catch(error) {
    showToast("Unable to delete field: " + error.message);
  }
}

function renderCustomFormFields() {
  Object.values(SECTION_INFO).forEach(info => {
    const container = $(info.custom);
    if (container) container.innerHTML = "";
  });

  fields
    .filter(field => field.inForm !== false && !field.hidden)
    .sort((a,b) => numberValue(a.position) - numberValue(b.position))
    .forEach(field => {
      const info = SECTION_INFO[field.section || "basic"];
      const container = info ? $(info.custom) : null;
      if (!container) return;

      const wrapper = document.createElement("label");
      wrapper.textContent = field.label || field.name || "Custom Field";

      let input;

      if (field.type === "textarea") {
        input = document.createElement("textarea");
        input.rows = 2;
      } else if (field.type === "select") {
        input = document.createElement("select");
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "Select";
        input.appendChild(blank);

        (field.options || []).forEach(option => {
          const item = document.createElement("option");
          item.value = option;
          item.textContent = option;
          input.appendChild(item);
        });
      } else {
        input = document.createElement("input");
        input.type = ["text","number","date"].includes(field.type)
          ? field.type : "text";
      }

      input.id = "custom_" + field.id;
      input.placeholder = field.placeholder || "";
      input.required = Boolean(field.required);
      wrapper.appendChild(input);
      container.appendChild(wrapper);
    });
}

/* ==========================================
   REPORTS & ANALYTICS
========================================== */

function getReportRows(period = currentReportPeriod) {
  if (!Array.isArray(reportData[period])) reportData[period] = [];
  return reportData[period];
}

function getReportConfig(period = currentReportPeriod) {
  if (!reportSettings[period]) {
    reportSettings[period] = {
      headings:[...REPORT_HEADINGS[period]],
      widths:[170,150,150,130,150],
      rowHeights:{},
      cells:{},
      columnStyles:{}
    };
  }

  const config = reportSettings[period];

  if (!Array.isArray(config.headings)) {
    config.headings = [...REPORT_HEADINGS[period]];
  }

  if (!Array.isArray(config.widths)) config.widths = [];

  if (!config.rowHeights) config.rowHeights = {};
  if (!config.cells) config.cells = {};
  if (!config.columnStyles) config.columnStyles = {};

  while (config.headings.length < 5) {
    config.headings.push(REPORT_HEADINGS[period][config.headings.length]);
  }

  while (config.widths.length < config.headings.length) {
    config.widths.push(150);
  }

  // Ensure old report rows are extended for additional columns.
  getReportRows(period).forEach(row => {
    while (row.length < config.headings.length) row.push("");
  });

  return config;
}

function setReportPeriod(period) {
  if (!REPORT_HEADINGS[period]) return;

  captureReportInputs();
  currentReportPeriod = period;
  selectedReportCell = null;
  selectedReportColumn = null;

  document.querySelectorAll(".report-tab").forEach(button => {
    button.classList.toggle("active",button.dataset.reportPeriod === period);
  });

  renderReportTable();
}

/* Add/Edit/Delete controls are inserted into the existing Reports section. */
function ensureReportColumnToolbar(container) {
  let toolbar = $("reportColumnToolbar");

  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = "reportColumnToolbar";
    toolbar.className = "report-column-toolbar";
    toolbar.style.cssText =
      "display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;";

    container.parentElement?.insertBefore(toolbar,container);
  }

  toolbar.innerHTML = `
    <button type="button" id="reportAddColumnBtn" class="primary-btn">+ Add Column</button>
    <button type="button" id="reportEditColumnBtn" class="secondary-btn">Edit Selected Column</button>
    <button type="button" id="reportDeleteColumnBtn" class="danger-btn">Delete Selected Column</button>
  `;

  $("reportAddColumnBtn").addEventListener("click",addReportColumn);
  $("reportEditColumnBtn").addEventListener("click",editReportColumn);
  $("reportDeleteColumnBtn").addEventListener("click",deleteReportColumn);
}

function renderReportTable() {
  const container = $("reportTableContainer");
  if (!container) return;

  ensureReportColumnToolbar(container);

  const rows = getReportRows();
  const config = getReportConfig();
  const count = config.headings.length;

  const headerHTML = config.headings.map((heading,column) => `
    <th data-report-select-column="${column}"
      style="width:${numberValue(config.widths[column]) || 150}px">
      <div class="report-header-content">
        <input class="report-heading-input"
          data-report-heading="${column}"
          value="${safeText(heading)}"
          aria-label="Column heading ${column + 1}">
        <button type="button" class="report-save-column"
          data-save-column="${column}">Save Column</button>
      </div>
      <span class="report-resize-handle" data-resize-column="${column}"></span>
    </th>
  `).join("");

  const bodyHTML = rows.map((row,rowIndex) => {
    const height = numberValue(config.rowHeights[rowIndex]) || 44;

    const cells = config.headings.map((heading,column) => {
      const key = rowIndex + ":" + column;
      const style = config.cells[key] || {};
      const columnStyle = config.columnStyles[column] || {};
      const merged = {...columnStyle,...style};

      const css = [
        merged.color ? "color:" + merged.color : "",
        merged.background ? "background:" + merged.background : "",
        merged.fontSize ? "font-size:" + merged.fontSize + "px" : "",
        merged.fontFamily ? "font-family:" + merged.fontFamily : "",
        merged.bold ? "font-weight:bold" : "",
        merged.italic ? "font-style:italic" : "",
        merged.align ? "text-align:" + merged.align : "",
        merged.vertical ? "vertical-align:" + merged.vertical : "",
        merged.wrap === false ? "white-space:nowrap" : "white-space:pre-wrap"
      ].filter(Boolean).join(";");

      return `<td style="${css};height:${height}px"
        data-report-cell="${rowIndex}:${column}">
        <textarea class="report-cell-input"
          data-report-input="${rowIndex}:${column}"
          aria-label="${safeText(heading)} row ${rowIndex + 1}"
          style="${css}">${safeText(row[column] || "")}</textarea>
      </td>`;
    }).join("");

    return `<tr data-report-row="${rowIndex}" style="height:${height}px">
      <td class="report-row-number">${rowIndex + 1}</td>
      ${cells}
      <td>
        <button type="button" class="small-btn"
          data-delete-report-row="${rowIndex}">Delete</button>
        <span class="report-row-resize" data-resize-row="${rowIndex}"></span>
      </td>
    </tr>`;
  }).join("");

  container.innerHTML = `
    <table class="report-table">
      <thead><tr>
        <th class="report-row-number">#</th>
        ${headerHTML}
        <th>Action</th>
      </tr></thead>
      <tbody>
        ${bodyHTML || `<tr><td colspan="${count + 2}" class="empty-cell">
          No report rows. Click Add Row to begin.
        </td></tr>`}
      </tbody>
    </table>
  `;

  attachReportCellEvents();
}

/* ==========================================
   REPORT COLUMN MANAGEMENT
========================================== */

async function addReportColumn() {
  const heading = prompt("Enter new column heading:");
  if (heading === null) return;

  const name = heading.trim();
  if (!name) {
    showToast("Column heading cannot be empty.");
    return;
  }

  captureReportInputs();

  const config = getReportConfig();
  const rows = getReportRows();

  config.headings.push(name);
  config.widths.push(150);
  rows.forEach(row => row.push(""));

  try {
    await saveReportToDatabase();
    renderReportTable();
    showToast("New column added.");
  } catch(error) {
    config.headings.pop();
    config.widths.pop();
    rows.forEach(row => row.pop());
    showToast("Column add failed: " + error.message);
  }
}

async function editReportColumn() {
  if (selectedReportColumn === null) {
    showToast("Select a column heading first.");
    return;
  }

  const config = getReportConfig();
  const index = selectedReportColumn;

  if (index < 0 || index >= config.headings.length) return;

  const updated = prompt("Edit column heading:",config.headings[index]);
  if (updated === null) return;

  if (!updated.trim()) {
    showToast("Column heading cannot be empty.");
    return;
  }

  captureReportInputs();
  config.headings[index] = updated.trim();

  try {
    await saveReportToDatabase();
    renderReportTable();
    selectedReportColumn = index;
    showToast("Column heading updated.");
  } catch(error) {
    showToast("Column edit failed: " + error.message);
  }
}

async function deleteReportColumn() {
  if (selectedReportColumn === null) {
    showToast("Select a column heading first.");
    return;
  }

  const config = getReportConfig();
  const index = selectedReportColumn;

  if (config.headings.length <= 1) {
    showToast("At least one report column must remain.");
    return;
  }

  if (!confirm("Delete column '" + config.headings[index] +
      "' and all its values from this report period?")) return;

  captureReportInputs();

  config.headings.splice(index,1);
  config.widths.splice(index,1);

  getReportRows().forEach(row => row.splice(index,1));

  const remapped = {};
  Object.entries(config.cells).forEach(([key,value]) => {
    const [row,column] = key.split(":").map(Number);
    if (column < index) remapped[key] = value;
    if (column > index) remapped[row + ":" + (column - 1)] = value;
  });
  config.cells = remapped;

  const newStyles = {};
  Object.entries(config.columnStyles).forEach(([key,value]) => {
    const column = Number(key);
    if (column < index) newStyles[column] = value;
    if (column > index) newStyles[column - 1] = value;
  });
  config.columnStyles = newStyles;

  selectedReportColumn = null;
  selectedReportCell = null;

  try {
    await saveReportToDatabase();
    renderReportTable();
    showToast("Column deleted.");
  } catch(error) {
    showToast("Column delete failed: " + error.message);
  }
}

/* ==========================================
   REPORT DATA SAVING
========================================== */

function saveReportCell(rowIndex,column,value) {
  const rows = getReportRows();
  const config = getReportConfig();

  while (rows.length <= rowIndex) {
    rows.push(Array(config.headings.length).fill(""));
  }

  while (rows[rowIndex].length < config.headings.length) {
    rows[rowIndex].push("");
  }

  rows[rowIndex][column] = value;
}

function captureReportInputs() {
  document.querySelectorAll("[data-report-input]").forEach(input => {
    const [row,column] = input.dataset.reportInput.split(":").map(Number);
    saveReportCell(row,column,input.value);
  });

  document.querySelectorAll("[data-report-heading]").forEach(input => {
    const column = Number(input.dataset.reportHeading);
    const config = getReportConfig();
    if (column < 5) {
      config.headings[column] =
        input.value.trim() || REPORT_HEADINGS[currentReportPeriod][column];
    } else {
      config.headings[column] = input.value.trim() || "New Column";
    }
  });
}

async function addReportRow() {
  captureReportInputs();
  const rows = getReportRows();
  const config = getReportConfig();
  const oldLength = rows.length;

  rows.push(Array(config.headings.length).fill(""));

  try {
    await saveReportToDatabase();
    renderReportTable();
    showToast("Report row added.");
  } catch(error) {
    rows.splice(oldLength,1);
    renderReportTable();
    showToast("Save failed: " + error.message);
  }
}

async function deleteReportRow(index) {
  if (!confirm("Delete report row " + (index + 1) + "?")) return;

  captureReportInputs();
  getReportRows().splice(index,1);

  const config = getReportConfig();
  const newCells = {};

  Object.entries(config.cells).forEach(([key,value]) => {
    const [row,column] = key.split(":").map(Number);
    if (row < index) newCells[key] = value;
    if (row > index) newCells[(row - 1) + ":" + column] = value;
  });
  config.cells = newCells;

  const newHeights = {};
  Object.entries(config.rowHeights).forEach(([key,value]) => {
    const row = Number(key);
    if (row < index) newHeights[row] = value;
    if (row > index) newHeights[row - 1] = value;
  });
  config.rowHeights = newHeights;

  await saveReportToDatabase();
  renderReportTable();
}

async function saveReportColumn(column) {
  captureReportInputs();
  await saveReportToDatabase();
  showToast("Column saved.");
}

async function saveAllReportData() {
  captureReportInputs();
  await saveReportToDatabase();

  if ($("reportMessage")) {
    $("reportMessage").textContent = "Report saved successfully.";
  }
  showToast("Report saved.");
}

/* ==========================================
   REPORT CELL EVENTS
========================================== */

function attachReportCellEvents() {
  document.querySelectorAll("[data-report-input]").forEach(input => {
    input.addEventListener("focus",() => {
      selectedReportCell = input.dataset.reportInput;
      selectedReportColumn = null;

      document.querySelectorAll(".report-selected-cell").forEach(cell => {
        cell.classList.remove("report-selected-cell");
      });

      input.closest("td")?.classList.add("report-selected-cell");
    });

    input.addEventListener("input",() => {
      const [row,column] = input.dataset.reportInput.split(":").map(Number);
      saveReportCell(row,column,input.value);
    });
  });

  document.querySelectorAll("[data-report-select-column]").forEach(header => {
    header.addEventListener("click",event => {
      if (event.target.closest("button,input")) return;

      selectedReportColumn = Number(header.dataset.reportSelectColumn);
      selectedReportCell = null;

      document.querySelectorAll(".report-selected-cell").forEach(cell => {
        cell.classList.remove("report-selected-cell");
      });

      showToast("Column selected.");
    });
  });

  document.querySelectorAll("[data-report-heading]").forEach(input => {
    input.addEventListener("focus",() => {
      selectedReportColumn = Number(input.dataset.reportHeading);
      selectedReportCell = null;
    });

    input.addEventListener("change",async () => {
      const column = Number(input.dataset.reportHeading);
      const config = getReportConfig();

      config.headings[column] = input.value.trim() ||
        (column < 5
          ? REPORT_HEADINGS[currentReportPeriod][column]
          : "New Column");

      try {
        await saveReportToDatabase();
      } catch(error) {
        showToast("Heading save failed: " + error.message);
      }
    });
  });

  document.querySelectorAll("[data-save-column]").forEach(button => {
    button.addEventListener("click",() => {
      saveReportColumn(Number(button.dataset.saveColumn))
        .catch(error => showToast("Column save failed: " + error.message));
    });
  });

  document.querySelectorAll("[data-delete-report-row]").forEach(button => {
    button.addEventListener("click",() => {
      deleteReportRow(Number(button.dataset.deleteReportRow))
        .catch(error => showToast("Row delete failed: " + error.message));
    });
  });

  attachColumnResizeEvents();
  attachRowResizeEvents();
}

/* ==========================================
   REPORT RESIZING
========================================== */

function attachColumnResizeEvents() {
  document.querySelectorAll("[data-resize-column]").forEach(handle => {
    handle.addEventListener("pointerdown",event => {
      event.preventDefault();

      const column = Number(handle.dataset.resizeColumn);
      const config = getReportConfig();
      const startX = event.clientX;
      const startWidth = numberValue(config.widths[column]) || 150;

      const move = moveEvent => {
        config.widths[column] = Math.max(
          80,startWidth + moveEvent.clientX - startX
        );

        const header = $("reportTableContainer")
          ?.querySelectorAll("thead th")[column + 1];

        if (header) header.style.width = config.widths[column] + "px";
      };

      const end = async () => {
        document.removeEventListener("pointermove",move);
        document.removeEventListener("pointerup",end);
        try {
          await saveReportToDatabase();
        } catch(error) {
          showToast("Column width save failed: " + error.message);
        }
      };

      document.addEventListener("pointermove",move);
      document.addEventListener("pointerup",end);
    });
  });
}

function attachRowResizeEvents() {
  document.querySelectorAll("[data-resize-row]").forEach(handle => {
    handle.addEventListener("pointerdown",event => {
      event.preventDefault();

      const rowIndex = Number(handle.dataset.resizeRow);
      const row = handle.closest("tr");
      const startY = event.clientY;
      const startHeight = row?.getBoundingClientRect().height || 44;
      const config = getReportConfig();

      const move = moveEvent => {
        const height = Math.max(32,startHeight + moveEvent.clientY - startY);
        config.rowHeights[rowIndex] = height;
        if (row) row.style.height = height + "px";
      };

      const end = async () => {
        document.removeEventListener("pointermove",move);
        document.removeEventListener("pointerup",end);
        try {
          await saveReportToDatabase();
        } catch(error) {
          showToast("Row height save failed: " + error.message);
        }
      };

      document.addEventListener("pointermove",move);
      document.addEventListener("pointerup",end);
    });
  });
}

/* ==========================================
   REPORT FORMATTING
========================================== */

function getSelectedReportCells() {
  if (!selectedReportCell) return [];
  const [row,column] = selectedReportCell.split(":").map(Number);
  return [{row,column}];
}

function applyReportFormatting(property,value) {
  const config = getReportConfig();
  const selected = getSelectedReportCells();

  if (selected.length) {
    selected.forEach(({row,column}) => {
      const key = row + ":" + column;
      config.cells[key] = config.cells[key] || {};
      config.cells[key][property] = value;
    });
  } else if (selectedReportColumn !== null) {
    const column = selectedReportColumn;
    config.columnStyles[column] = config.columnStyles[column] || {};
    config.columnStyles[column][property] = value;
  } else {
    showToast("Select a cell or column first.");
    return;
  }

  saveReportToDatabase()
    .then(renderReportTable)
    .catch(error => showToast("Formatting save failed: " + error.message));
}

function toggleReportFormatting(property) {
  const config = getReportConfig();
  const selected = getSelectedReportCells();

  if (selected.length) {
    const {row,column} = selected[0];
    const key = row + ":" + column;
    config.cells[key] = config.cells[key] || {};
    config.cells[key][property] = !config.cells[key][property];
  } else if (selectedReportColumn !== null) {
    const column = selectedReportColumn;
    config.columnStyles[column] = config.columnStyles[column] || {};
    config.columnStyles[column][property] =
      !config.columnStyles[column][property];
  } else {
    showToast("Select a cell or column first.");
    return;
  }

  saveReportToDatabase()
    .then(renderReportTable)
    .catch(error => showToast(error.message));
    }
/* ==========================================
   GOOGLE DRIVE CONNECTION
========================================== */

function getDriveConnection() {
  return readJSON(DRIVE_CONNECTION_KEY,null);
}

function saveDriveConnection(data) {
  writeJSON(DRIVE_CONNECTION_KEY,data);
}

function updateDriveStatus() {
  const saved = getDriveConnection();
  const connected = Boolean(saved?.connected);

  if ($("driveStatus")) {
    $("driveStatus").textContent = connected
      ? "Connected to Google Drive"
      : "Not connected";
  }

  if ($("connectDriveBtn")) {
    $("connectDriveBtn").disabled = false;
    $("connectDriveBtn").textContent = connected
      ? "Reconnect Google Drive"
      : "Connect Google Drive";
  }

  if ($("disconnectDriveBtn")) {
    $("disconnectDriveBtn").disabled = !connected;
  }
  if ($("driveBackupBtn")) {
    $("driveBackupBtn").disabled = !connected;
  }
  if ($("restoreDriveBackupBtn")) {
    $("restoreDriveBackupBtn").disabled = !connected;
  }

  driveFolderId = connected ? saved.folderId || null : null;
  driveBackupFileId = connected ? saved.backupFileId || null : null;
}

function showDriveMessage(message,isError = false) {
  const element = $("driveMessage");
  if (!element) return;
  element.textContent = message;
  element.style.color = isError ? "#ef4444" : "#22c55e";
}

/* ==========================================
   GOOGLE OAUTH - GIS TOKEN CLIENT
========================================== */

function initializeDriveTokenClient() {
  if (!window.google?.accounts?.oauth2) {
    showDriveMessage("Google Identity Services is unavailable.",true);
    return false;
  }

  if (driveTokenClient) return true;

  driveTokenClient = google.accounts.oauth2.initTokenClient({
    client_id:GOOGLE_CLIENT_ID,
    scope:DRIVE_SCOPE,

    callback:response => {
      if (response.error || !response.access_token) {
        const error = new Error(
          response.error || "Google authorization failed."
        );

        drivePendingReject?.(error);
        drivePendingResolve = null;
        drivePendingReject = null;
        showDriveMessage(error.message,true);
        return;
      }

      driveAccessToken = response.access_token;
      drivePendingResolve?.(driveAccessToken);
      drivePendingResolve = null;
      drivePendingReject = null;
    }
  });

  return true;
}

function requestDriveToken(promptValue) {
  if (!initializeDriveTokenClient()) {
    return Promise.reject(
      new Error("Google Identity Services unavailable.")
    );
  }

  return new Promise((resolve,reject) => {
    drivePendingResolve = resolve;
    drivePendingReject = reject;

    try {
      driveTokenClient.requestAccessToken({prompt:promptValue});
    } catch(error) {
      drivePendingResolve = null;
      drivePendingReject = null;
      reject(error);
    }
  });
}

async function connectGoogleDrive() {
  try {
    showDriveMessage("Waiting for Google authorization...");
    await requestDriveToken("consent");
    await finishDriveConnection();
  } catch(error) {
    showDriveMessage(error.message,true);
  }
}

async function refreshDriveToken() {
  if (driveAccessToken) return driveAccessToken;

  try {
    return await requestDriveToken("");
  } catch(error) {
    throw new Error(
      "Drive session expired. Tap Reconnect Google Drive and authorize again."
    );
  }
}

function getDriveHeaders() {
  if (!driveAccessToken) {
    throw new Error("Google Drive session expired. Reconnect Google Drive.");
  }
  return {Authorization:"Bearer " + driveAccessToken};
}

/* ==========================================
   DRIVE API REQUESTS
========================================== */

async function driveRequest(url,options = {}) {
  const response = await fetch(url,{
    ...options,
    headers:{
      ...getDriveHeaders(),
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    driveAccessToken = null;
    throw new Error("Google Drive session expired. Reconnect Google Drive.");
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error("Google Drive error " + response.status + ": " + detail);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function findDriveFolder() {
  const query = encodeURIComponent(
    "name='" + DRIVE_FOLDER_NAME +
    "' and mimeType='application/vnd.google-apps.folder' and trashed=false"
  );

  const result = await driveRequest(
    "https://www.googleapis.com/drive/v3/files?q=" +
    query + "&fields=files(id,name,mimeType)"
  );

  return result.files?.[0] || null;
}

async function createDriveFolder() {
  return driveRequest("https://www.googleapis.com/drive/v3/files",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      name:DRIVE_FOLDER_NAME,
      mimeType:"application/vnd.google-apps.folder"
    })
  });
}

async function findDriveBackupFile(folderId) {
  const query = encodeURIComponent(
    "'" + folderId + "' in parents and name='" +
    DRIVE_BACKUP_NAME + "' and trashed=false"
  );

  const result = await driveRequest(
    "https://www.googleapis.com/drive/v3/files?q=" +
    query + "&fields=files(id,name,mimeType,modifiedTime)"
  );

  return result.files?.[0] || null;
}

async function ensureDriveFolder() {
  let folder = driveFolderId ? {id:driveFolderId} : null;
  if (!folder) folder = await findDriveFolder();
  if (!folder) folder = await createDriveFolder();

  driveFolderId = folder.id;
  return folder.id;
}

async function ensureDriveBackupFile() {
  const folderId = await ensureDriveFolder();
  const file = await findDriveBackupFile(folderId);
  driveBackupFileId = file?.id || null;
  return file;
}

async function finishDriveConnection() {
  showDriveMessage("Checking Google Drive...");

  const folderId = await ensureDriveFolder();
  const file = await findDriveBackupFile(folderId);

  driveFolderId = folderId;
  driveBackupFileId = file?.id || null;

  saveDriveConnection({
    connected:true,
    folderId,
    backupFileId:driveBackupFileId,
    connectedAt:new Date().toISOString()
  });

  updateDriveStatus();
  showDriveMessage("Google Drive connected successfully.");
}

/* ==========================================
   DISCONNECT GOOGLE DRIVE
========================================== */

function disconnectGoogleDrive() {
  if (!confirm("Disconnect Google Drive from this browser?")) return;

  const token = driveAccessToken;

  driveAccessToken = null;
  driveFolderId = null;
  driveBackupFileId = null;
  driveTokenClient = null;
  drivePendingResolve = null;
  drivePendingReject = null;

  localStorage.removeItem(DRIVE_CONNECTION_KEY);

  if (token && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(token,() => {});
  }

  updateDriveStatus();
  showDriveMessage("Google Drive disconnected.");
}

/* ==========================================
   BACKUP DATA
========================================== */

async function createDriveBackupData() {
  captureReportInputs();
  await saveReportToDatabase();

  return {
    app:"TradeLedger",
    version:7,
    backupDate:new Date().toISOString(),
    trades,
    fields,
    columnSettings:getFieldSettings(),
    reports:reportData,
    reportSettings,
    metadata:{
      reportStorage:"IndexedDB + localStorage",
      tradeModes:["intraday","swing","longterm"]
    }
  };
}

function validateBackup(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid backup file.");
  }
  if (!Array.isArray(data.trades)) {
    throw new Error("Backup does not contain a valid trades list.");
  }
  if (!Array.isArray(data.fields)) {
    throw new Error("Backup does not contain a valid fields list.");
  }
  if (data.reports !== undefined &&
      (!data.reports || typeof data.reports !== "object" ||
       Array.isArray(data.reports))) {
    throw new Error("Invalid reports data.");
  }
  if (data.reportSettings !== undefined &&
      (!data.reportSettings || typeof data.reportSettings !== "object" ||
       Array.isArray(data.reportSettings))) {
    throw new Error("Invalid report settings.");
  }

  data.trades.forEach((trade,index) => {
    if (!trade || typeof trade !== "object" || trade.id == null) {
      throw new Error("Invalid trade record at row " + (index + 1));
    }
  });

  data.fields.forEach((field,index) => {
    if (!field || typeof field !== "object" || field.id == null) {
      throw new Error("Invalid custom field at row " + (index + 1));
    }
  });

  return true;
}

/* ==========================================
   RESUMABLE DRIVE UPLOAD
========================================== */

async function startDriveResumableUpload(fileId,folderId,jsonText) {
  const metadata = fileId
    ? {name:DRIVE_BACKUP_NAME}
    : {name:DRIVE_BACKUP_NAME,parents:[folderId]};

  const startUrl = fileId
    ? "https://www.googleapis.com/upload/drive/v3/files/" +
      fileId + "?uploadType=resumable"
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";

  const startResponse = await fetch(startUrl,{
    method:fileId ? "PATCH" : "POST",
    headers:{
      ...getDriveHeaders(),
      "Content-Type":"application/json; charset=UTF-8",
      "X-Upload-Content-Type":"application/json"
    },
    body:JSON.stringify(metadata)
  });

  if (startResponse.status === 401) {
    driveAccessToken = null;
    throw new Error("Drive session expired. Reconnect Google Drive.");
  }

  if (!startResponse.ok) {
    throw new Error(
      "Could not start Google Drive upload: " +
      await startResponse.text()
    );
  }

  const uploadUrl = startResponse.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("Google Drive upload session URL is missing.");
  }

  const uploadResponse = await fetch(uploadUrl,{
    method:"PUT",
    headers:{
      Authorization:"Bearer " + driveAccessToken,
      "Content-Type":"application/json"
    },
    body:new Blob([jsonText],{type:"application/json"})
  });

  if (uploadResponse.status === 401) {
    driveAccessToken = null;
    throw new Error("Drive session expired. Reconnect Google Drive.");
  }

  if (!uploadResponse.ok) {
    throw new Error(
      "Backup upload failed: HTTP " +
      uploadResponse.status + " " +
      await uploadResponse.text()
    );
  }

  return uploadResponse.json();
}

/* ==========================================
   BACKUP TO GOOGLE DRIVE
========================================== */

async function backupToGoogleDrive() {
  try {
    showDriveMessage("Preparing backup...");
    await refreshDriveToken();

    const folderId = await ensureDriveFolder();
    const existingFile = await findDriveBackupFile(folderId);
    const backup = await createDriveBackupData();
    const jsonText = JSON.stringify(backup,null,2);

    const result = await startDriveResumableUpload(
      existingFile?.id || null,
      folderId,
      jsonText
    );

    driveBackupFileId = result.id;
    const oldConnection = getDriveConnection();

    saveDriveConnection({
      connected:true,
      folderId,
      backupFileId:driveBackupFileId,
      connectedAt:oldConnection?.connectedAt || new Date().toISOString()
    });

    if ($("driveBackupInfo")) {
      $("driveBackupInfo").textContent =
        "Last backup: " + new Date().toLocaleString();
    }

    updateDriveStatus();
    showDriveMessage("Backup completed successfully.");
    showToast("Google Drive backup completed.");

  } catch(error) {
    console.error(error);
    showDriveMessage(error.message,true);
  }
}

/* ==========================================
   DOWNLOAD DRIVE BACKUP
========================================== */

async function downloadDriveBackup() {
  await refreshDriveToken();

  const file = await ensureDriveBackupFile();
  if (!file) {
    throw new Error("TradeLedger-Backup.json was not found in Google Drive.");
  }

  const response = await fetch(
    "https://www.googleapis.com/drive/v3/files/" +
    file.id + "?alt=media",
    {headers:getDriveHeaders()}
  );

  if (response.status === 401) {
    driveAccessToken = null;
    throw new Error("Google Drive session expired. Reconnect Google Drive.");
  }

  if (!response.ok) {
    throw new Error("Could not download backup from Google Drive.");
  }

  return {file,data:await response.json()};
}

/* ==========================================
   RESTORE VALIDATION
========================================== */

function validateStoreRecords(store,records,storeName) {
  const keyPath = store.keyPath;

  records.forEach((record,index) => {
    if (!record || typeof record !== "object") {
      throw new Error(
        "Invalid " + storeName + " record at row " + (index + 1)
      );
    }

    if (typeof keyPath === "string") {
      if (record[keyPath] === undefined || record[keyPath] === null) {
        throw new Error(storeName + " record is missing key: " + keyPath);
      }
    } else if (Array.isArray(keyPath)) {
      if (keyPath.some(key =>
        record[key] === undefined || record[key] === null
      )) {
        throw new Error(storeName + " record does not match database key structure.");
      }
    } else if (record.id === undefined || record.id === null) {
      throw new Error(storeName + " record is missing its ID.");
    }
  });
}

function putRestoreRecord(store,record) {
  if (store.keyPath === null) store.put(record,record.id);
  else store.put(record);
}

/* ==========================================
   FULL RESTORE
========================================== */

async function applyFullBackupToDatabase(data) {
  validateBackup(data);
  await waitForDatabase();

  const requiredStores = ["trades","fields","reports"];

  for (const name of requiredStores) {
    if (!db.objectStoreNames.contains(name)) {
      throw new Error("Required database store is missing: " + name);
    }
  }

  const backupTrades = data.trades;
  const backupFields = data.fields;

  const restoredReports = data.reports || {
    daily:[],weekly:[],monthly:[],yearly:[]
  };

  const restoredSettings = data.reportSettings || {};
  const restoredColumnSettings = data.columnSettings || {};

  const checkTransaction = db.transaction(requiredStores,"readonly");
  const checkDone = transactionComplete(checkTransaction);

  try {
    validateStoreRecords(
      checkTransaction.objectStore("trades"),backupTrades,"trades"
    );
    validateStoreRecords(
      checkTransaction.objectStore("fields"),backupFields,"fields"
    );
    validateStoreRecords(
      checkTransaction.objectStore("reports"),
      [{id:"main-reports",data:restoredReports,settings:restoredSettings}],
      "reports"
    );
    await checkDone;
  } catch(error) {
    try { checkTransaction.abort(); } catch(ignore) {}
    await checkDone.catch(() => {});
    throw error;
  }

  const transaction = db.transaction(requiredStores,"readwrite");
  const done = transactionComplete(transaction);

  const tradeStore = transaction.objectStore("trades");
  const fieldStore = transaction.objectStore("fields");
  const reportStore = transaction.objectStore("reports");

  tradeStore.clear();
  fieldStore.clear();
  reportStore.clear();

  backupTrades.forEach(record => putRestoreRecord(tradeStore,record));
  backupFields.forEach(record => putRestoreRecord(fieldStore,record));

  putRestoreRecord(reportStore,{
    id:"main-reports",
    data:restoredReports,
    settings:restoredSettings,
    updatedAt:new Date().toISOString()
  });

  await done;

  trades = backupTrades;
  fields = backupFields;
  reportData = restoredReports;
  reportSettings = restoredSettings;

  saveFieldSettings(restoredColumnSettings);
  saveReportsLocally();

  await renderEverything();
}

async function restoreFromGoogleDrive() {
  if (!confirm(
    "Full Restore will replace current Trades, Fields and Reports " +
    "with the Google Drive backup. Continue?"
  )) return;

  try {
    showDriveMessage("Downloading backup...");
    const {data} = await downloadDriveBackup();

    validateBackup(data);
    showDriveMessage("Validating backup...");

    await applyFullBackupToDatabase(data);

    showDriveMessage("Full Restore completed successfully.");
    showToast("TradeLedger restored from Google Drive.");
  } catch(error) {
    console.error(error);
    showDriveMessage(error.message,true);
  }
}

/* ==========================================
   ATTACHMENTS
========================================== */

function readFileAsDataURL(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve({
      name:file.name,
      type:file.type,
      data:reader.result
    });

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleAttachmentChange() {
  try {
    const chartFiles = Array.from($("chartImages")?.files || []);
    const contractFiles = Array.from($("contractNote")?.files || []);

    const files = [
      ...chartFiles.map(file => ({file,category:"chart"})),
      ...contractFiles.map(file => ({file,category:"contract"}))
    ];

    const loaded = await Promise.all(files.map(async item => ({
      ...(await readFileAsDataURL(item.file)),
      category:item.category
    })));

    currentAttachments = [
      ...currentAttachments.filter(item =>
        !files.some(file => file.category === item.category)
      ),
      ...loaded
    ];

    if ($("attachmentInfo")) {
      $("attachmentInfo").textContent =
        currentAttachments.length + " attachment(s) ready.";
    }
  } catch(error) {
    showToast("Could not read attachment: " + error.message);
  }
}

/* ==========================================
   REPORT TOOLBAR
========================================== */

function setupReportToolbar() {
  $("reportTextColor")?.addEventListener("change",event => {
    applyReportFormatting("color",event.target.value);
  });

  $("reportCellColor")?.addEventListener("change",event => {
    applyReportFormatting("background",event.target.value);
  });

  $("reportFontSize")?.addEventListener("change",event => {
    applyReportFormatting("fontSize",event.target.value);
  });

  $("reportFontFamily")?.addEventListener("change",event => {
    applyReportFormatting("fontFamily",event.target.value);
  });

  $("reportHAlign")?.addEventListener("change",event => {
    applyReportFormatting("align",event.target.value);
  });

  $("reportVAlign")?.addEventListener("change",event => {
    applyReportFormatting("vertical",event.target.value);
  });

  $("reportBoldBtn")?.addEventListener("click",() => {
    toggleReportFormatting("bold");
  });

  $("reportItalicBtn")?.addEventListener("click",() => {
    toggleReportFormatting("italic");
  });

  $("reportWrapBtn")?.addEventListener("click",() => {
    const config = getReportConfig();
    const selected = getSelectedReportCells();

    if (selected.length) {
      const {row,column} = selected[0];
      const key = row + ":" + column;
      config.cells[key] = config.cells[key] || {};
      config.cells[key].wrap = config.cells[key].wrap === false;
    } else if (selectedReportColumn !== null) {
      const column = selectedReportColumn;
      config.columnStyles[column] = config.columnStyles[column] || {};
      config.columnStyles[column].wrap =
        config.columnStyles[column].wrap === false;
    } else {
      showToast("Select a cell or column first.");
      return;
    }

    saveReportToDatabase()
      .then(renderReportTable)
      .catch(error => showToast(error.message));
  });
}

/* ==========================================
   PERIOD OVERVIEW EVENTS
========================================== */

function setupPeriodOverview() {
  $("periodApplyBtn")?.addEventListener("click",renderPeriodOverview);

  $("periodResetBtn")?.addEventListener("click",() => {
    if ($("periodStartDate")) $("periodStartDate").value = "";
    if ($("periodEndDate")) $("periodEndDate").value = "";
    renderPeriodOverview();
  });
}

/* ==========================================
   EVENT BINDINGS
========================================== */

function setupEventListeners() {
  if (eventsInitialized) return;

  document.querySelectorAll(".mode-btn").forEach(button => {
    button.addEventListener("click",() => {
      setTradingMode(button.dataset.mode);
    });
  });

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.addEventListener("click",() => {
      showSection(button.dataset.section);
    });
  });

  document.querySelectorAll(".report-tab").forEach(button => {
    button.addEventListener("click",() => {
      setReportPeriod(button.dataset.reportPeriod);
    });
  });

  $("newTradeBtn")?.addEventListener("click",() => {
    resetForm();
    showSection("tradeFormSection");
  });

  document.querySelectorAll("[data-open-trade]").forEach(button => {
    button.addEventListener("click",() => {
      resetForm();
      showSection("tradeFormSection");
    });
  });

  $("tradeForm")?.addEventListener("submit",saveTrade);
  $("resetTradeBtn")?.addEventListener("click",resetForm);

  [
    "buyQty","buyPrice","buyCharge","extraBuyCharge",
    "sellQty","sellPrice","sellCharge","extraSellCharge"
  ].forEach(id => {
    $(id)?.addEventListener("input",calculateTrade);
  });

  $("journalSearch")?.addEventListener("input",renderJournal);
  $("exportJournalCsvBtn")?.addEventListener("click",exportJournalCSV);

  $("addFieldBtn")?.addEventListener("click",() => {
    closeFieldModal();
    if ($("fieldModalTitle")) {
      $("fieldModalTitle").textContent = "Add Custom Field";
    }
    openFieldModal();
  });

  $("fieldForm")?.addEventListener("submit",saveField);
  $("closeFieldManagerModal")?.addEventListener("click",closeFieldModal);
  $("cancelFieldEdit")?.addEventListener("click",closeFieldModal);

  $("closeViewBtn")?.addEventListener("click",() => {
    $("viewModal")?.classList.add("hidden");
  });

  $("chartImages")?.addEventListener("change",handleAttachmentChange);
  $("contractNote")?.addEventListener("change",handleAttachmentChange);

  $("connectDriveBtn")?.addEventListener("click",connectGoogleDrive);
  $("disconnectDriveBtn")?.addEventListener("click",disconnectGoogleDrive);
  $("driveBackupBtn")?.addEventListener("click",backupToGoogleDrive);
  $("restoreDriveBackupBtn")?.addEventListener("click",restoreFromGoogleDrive);

  $("reportAddRowBtn")?.addEventListener("click",addReportRow);

  $("reportSaveAllBtn")?.addEventListener("click",() => {
    saveAllReportData().catch(error => {
      showToast("Report save failed: " + error.message);
    });
  });

  $("reportDeleteRowBtn")?.addEventListener("click",() => {
    if (!selectedReportCell) {
      showToast("Select a cell in the row first.");
      return;
    }
    const rowIndex = Number(selectedReportCell.split(":")[0]);
    deleteReportRow(rowIndex).catch(error => {
      showToast("Row delete failed: " + error.message);
    });
  });

  setupReportToolbar();
  setupPeriodOverview();

  // Delegated actions: remain active after dynamic HTML rendering.
  document.addEventListener("click",event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const viewButton = target.closest("[data-view-trade]");
    if (viewButton) {
      viewTrade(viewButton.dataset.viewTrade);
      return;
    }

    const editButton = target.closest("[data-edit-trade]");
    if (editButton) {
      editTrade(editButton.dataset.editTrade);
      return;
    }

    const deleteButton = target.closest("[data-delete-trade]");
    if (deleteButton) {
      removeTrade(deleteButton.dataset.deleteTrade);
      return;
    }

    const standardEdit = target.closest("[data-edit-standard]");
    if (standardEdit) {
      editStandardField(standardEdit.dataset.editStandard);
      return;
    }

    const standardToggle = target.closest("[data-toggle-standard]");
    if (standardToggle) {
      toggleStandardField(standardToggle.dataset.toggleStandard);
      return;
    }

    const customEdit = target.closest("[data-edit-custom]");
    if (customEdit) {
      editCustomField(customEdit.dataset.editCustom);
      return;
    }

    const toggleField = target.closest("[data-toggle-field]");
    if (toggleField) {
      toggleCustomField(toggleField.dataset.toggleField);
      return;
    }

    const deleteField = target.closest("[data-delete-field]");
    if (deleteField) {
      deleteCustomField(deleteField.dataset.deleteField);
    }
  });

  eventsInitialized = true;
}

/* ==========================================
   RENDER EVERYTHING
========================================== */

async function renderEverything() {
  renderDashboard();
  renderJournal();
  renderPeriodOverview();
  renderFieldList();
  renderCustomFormFields();
  renderReportTable();
  updateDriveStatus();
}

/* ==========================================
   APPLICATION STARTUP
========================================== */

async function initializeDatabaseAndData() {
  await openDatabase();
  await loadDatabaseData();
  await loadReportsFromDatabase();
  databaseReady = true;
}

async function startApp() {
  try {
    setupEventListeners();

    setTradingMode("intraday");
    showSection("dashboardSection");
    updateDriveStatus();

    // Create the shared promise immediately so button actions can await it.
    databaseReadyPromise = initializeDatabaseAndData();

    await databaseReadyPromise;

    if ($("tradeDate") && !$("tradeDate").value) {
      $("tradeDate").value = new Date().toISOString().slice(0,10);
    }

    updateDriveStatus();
    setTradingMode(currentMode);
    showSection(currentSection);
    calculateTrade();

    await renderEverything();

    console.log("TradeLedger started successfully.");
    showToast("TradeLedger is ready.");

  } catch(error) {
    databaseReady = false;
    console.error("TradeLedger startup error:",error);

    showToast("Database loading failed: " + error.message);

    alert(
      "TradeLedger database could not be loaded.\n\n" +
      error.message +
      "\n\nYour existing data has not been intentionally deleted. " +
      "Do not clear browser data or IndexedDB."
    );
  }
}

/* ==========================================
   APPLICATION BOOT
========================================== */

function bootTradeLedger() {
  if (tradeLedgerBooted) return;
  tradeLedgerBooted = true;
  startApp();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded",bootTradeLedger,{once:true});
} else {
  bootTradeLedger();
        }

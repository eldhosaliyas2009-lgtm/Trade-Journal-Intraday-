"use strict";

/* TRADELEDGER - Offline Trading Journal */

const $ = (id) => document.getElementById(id);

const DB_NAME = "TradeLedgerDB";
const DB_VERSION = 1;
const STORE_NAME = "trades";

let db;
let currentAttachments = [];

/* ---------------- DATABASE ---------------- */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, {
          keyPath: "id"
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllTrades() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveToDatabase(trade) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");

    transaction.objectStore(STORE_NAME).put(trade);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function deleteFromDatabase(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");

    transaction.objectStore(STORE_NAME).delete(id);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/* ---------------- CALCULATIONS ---------------- */

function number(id) {
  return Number($(id).value) || 0;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function calculate() {
  const buyQty = number("buyQty");
  const buyPrice = number("buyPrice");
  const sellQty = number("sellQty");
  const sellPrice = number("sellPrice");

  const buyStockValue = buyQty * buyPrice;
  const sellStockValue = sellQty * sellPrice;

  const totalBuyCharges =
    number("buyCharge") + number("extraBuyCharge");

  const totalSellCharges =
    number("sellCharge") + number("extraSellCharge");

  const totalCharges = totalBuyCharges + totalSellCharges;

  const grossPL = sellStockValue - buyStockValue;
  const netPL = grossPL - totalCharges;

  const totalBuyValue = buyStockValue + totalBuyCharges;
  const totalSellValue = sellStockValue - totalSellCharges;

  const priceMovement = sellPrice - buyPrice;

  $("buyStockValue").value = money(buyStockValue);
  $("sellStockValue").value = money(sellStockValue);

  $("totalBuyCharges").value = money(totalBuyCharges);
  $("totalSellCharges").value = money(totalSellCharges);

  $("totalBuyValue").value = money(totalBuyValue);
  $("totalSellValue").value = money(totalSellValue);

  $("priceMovement").value = money(priceMovement);

  $("grossPLInput").value = money(grossPL);
  $("totalChargesInput").value = money(totalCharges);
  $("netPLInput").value = money(netPL);

  return {
    buyStockValue,
    sellStockValue,
    totalBuyCharges,
    totalSellCharges,
    totalCharges,
    totalBuyValue,
    totalSellValue,
    priceMovement,
    grossPL,
    netPL
  };
}

/* ---------------- FILE ATTACHMENTS ---------------- */

async function readAttachments(files) {
  const results = [];

  for (const file of Array.from(files || [])) {
    results.push({
      name: file.name,
      type: file.type,
      blob: file
    });
  }

  return results;
}

async function getSelectedAttachments() {
  const chartFiles = await readAttachments($("chartImages").files);
  const contractFiles = await readAttachments(
    $("contractNote").files
  );

  return [
    ...currentAttachments,
    ...chartFiles,
    ...contractFiles
  ];
}

/* ---------------- FORM DATA ---------------- */

function collectTrade(calculations, attachments) {
  const id = $("tradeId").value || crypto.randomUUID();

  return {
    id,

    date: $("tradeDate").value,
    voucherNumber: $("voucherNumber").value.trim(),
    stockName: $("stockName").value.trim().toUpperCase(),

    capital: number("capital"),
    leverage: number("leverage"),

    strategy: $("strategy").value,
    riskReward: $("riskReward").value.trim(),
    tradeResult: $("tradeResult").value,
    tradeType: $("tradeType").value,

    notes: $("notes").value.trim(),

    buyQty: number("buyQty"),
    buyPrice: number("buyPrice"),
    buyStockValue: calculations.buyStockValue,
    buyCharge: number("buyCharge"),
    extraBuyCharge: number("extraBuyCharge"),
    totalBuyCharges: calculations.totalBuyCharges,
    totalBuyValue: calculations.totalBuyValue,

    sellQty: number("sellQty"),
    sellPrice: number("sellPrice"),
    sellStockValue: calculations.sellStockValue,
    sellCharge: number("sellCharge"),
    extraSellCharge: number("extraSellCharge"),
    totalSellCharges: calculations.totalSellCharges,
    totalSellValue: calculations.totalSellValue,

    priceMovement: calculations.priceMovement,
    grossPL: calculations.grossPL,
    totalCharges: calculations.totalCharges,
    netPL: calculations.netPL,

    attachments,
    updatedAt: new Date().toISOString()
  };
}

/* ---------------- DASHBOARD ---------------- */

function updateDashboard(trades) {
  const total = trades.length;
  const wins = trades.filter(t => t.netPL > 0).length;
  const losses = trades.filter(t => t.netPL < 0).length;
  const gross = trades.reduce((sum, t) => sum + t.grossPL, 0);
  const charges = trades.reduce((sum, t) => sum + t.totalCharges, 0);
  const net = trades.reduce((sum, t) => sum + t.netPL, 0);

  $("totalTrades").textContent = total;
  $("winningTrades").textContent = wins;
  $("losingTrades").textContent = losses;

  $("winRate").textContent =
    total ? ((wins / total) * 100).toFixed(1) + "%" : "0%";

  $("grossPL").textContent = "₹" + money(gross);
  $("totalCharges").textContent = "₹" + money(charges);
  $("netPL").textContent = "₹" + money(net);

  $("grossPL").className = gross >= 0 ? "positive" : "negative";
  $("netPL").className = net >= 0 ? "positive" : "negative";
}

/* ---------------- FILTERS ---------------- */

function isInPeriod(dateString, period) {
  const date = new Date(dateString + "T00:00:00");
  const now = new Date();

  if (period === "all") return true;

  if (period === "day") {
    return date.toDateString() === now.toDateString();
  }

  if (period === "week") {
    const start = new Date(now);
    const day = (now.getDay() + 6) % 7;
    start.setDate(now.getDate() - day);
    start.setHours(0, 0, 0, 0);

    return date >= start && date <= now;
  }

  if (period === "month") {
    return (
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()
    );
  }

  if (period === "year") {
    return date.getFullYear() === now.getFullYear();
  }

  return true;
}

/* ---------------- TRADE HISTORY ---------------- */

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

async function renderTrades() {
  const allTrades = await getAllTrades();

  updateDashboard(allTrades);

  const period = $("periodFilter").value;
  const search = $("searchStock").value.trim().toUpperCase();

  const trades = allTrades
    .filter(t => isInPeriod(t.date, period))
    .filter(t => t.stockName.includes(search))
    .sort((a, b) => b.date.localeCompare(a.date));

  const tbody = $("tradeHistory");

  if (!trades.length) {
    tbody.innerHTML =
      '<tr><td colspan="7">No trades found.</td></tr>';
    return;
  }

  tbody.innerHTML = trades.map(t => `
    <tr>
      <td>${safeText(t.date)}</td>
      <td>${safeText(t.voucherNumber || "-")}</td>
      <td>${safeText(t.stockName)}</td>
      <td>${safeText(t.strategy || "-")}</td>
      <td>${safeText(t.tradeResult || "-")}</td>
      <td class="${t.netPL >= 0 ? "positive" : "negative"}">
        ₹${money(t.netPL)}
      </td>
      <td>
        <button type="button" data-edit="${safeText(t.id)}">Edit</button>
        <button type="button" data-delete="${safeText(t.id)}">Delete</button>
        <button type="button" data-view="${safeText(t.id)}">Files</button>
      </td>
    </tr>
  `).join("");
}

/* ---------------- EDIT TRADE ---------------- */

async function editTrade(id) {
  const trades = await getAllTrades();
  const trade = trades.find(t => t.id === id);

  if (!trade) return;

  $("tradeId").value = trade.id;

  const fields = [
    "tradeDate", "voucherNumber", "stockName", "capital",
    "leverage", "strategy", "riskReward", "tradeResult",
    "tradeType", "notes", "buyQty", "buyPrice",
    "buyCharge", "extraBuyCharge", "sellQty", "sellPrice",
    "sellCharge", "extraSellCharge"
  ];

  const keys = [
    "date", "voucherNumber", "stockName", "capital",
    "leverage", "strategy", "riskReward", "tradeResult",
    "tradeType", "notes", "buyQty", "buyPrice",
    "buyCharge", "extraBuyCharge", "sellQty", "sellPrice",
    "sellCharge", "extraSellCharge"
  ];

  fields.forEach((field, index) => {
    $(field).value = trade[keys[index]] ?? "";
  });

  currentAttachments = trade.attachments || [];

  calculate();

  window.scrollTo({
    top: $("tradeForm").getBoundingClientRect().top + window.scrollY - 20,
    behavior: "smooth"
  });

  $("saveTradeBtn").textContent = "Update Trade";
}

/* ---------------- ATTACHMENT VIEW ---------------- */

async function viewAttachments(id) {
  const trades = await getAllTrades();
  const trade = trades.find(t => t.id === id);

  if (!trade || !trade.attachments?.length) {
    alert("No attachments found.");
    return;
  }

  const message = trade.attachments.map((file, index) =>
    `${index + 1}. ${file.name}`
  ).join("\n");

  alert("Attachments:\n" + message +
    "\n\nFiles are stored in this browser's offline database.");
}

/* ---------------- BACKUP & RESTORE ---------------- */

async function exportBackup() {
  const trades = await getAllTrades();

  const serialized = [];

  for (const trade of trades) {
    const attachments = [];

    for (const file of trade.attachments || []) {
      const data = await blobToBase64(file.blob);

      attachments.push({
        name: file.name,
        type: file.type,
        data
      });
    }

    serialized.push({
      ...trade,
      attachments
    });
  }

  const backup = {
    app: "TradeLedger",
    version: 1,
    exportedAt: new Date().toISOString(),
    trades: serialized
  };

  const blob = new Blob(
    [JSON.stringify(backup)],
    { type: "application/json" }
  );

  downloadBlob(
    blob,
    "TradeLedger-Backup-" + new Date().toISOString().slice(0, 10) + ".json"
  );
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(reader.result);
    };

    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(data, type) {
  const parts = data.split(",");
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: type || "" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    if (
      backup.app !== "TradeLedger" ||
      !Array.isArray(backup.trades)
    ) {
      throw new Error("Invalid TradeLedger backup file.");
    }

    if (!confirm(
      "Restore " + backup.trades.length +
      " trades? Existing trades with the same IDs will be replaced."
    )) return;

    for (const trade of backup.trades) {
      const attachments = (trade.attachments || []).map(file => ({
        name: file.name,
        type: file.type,
        blob: base64ToBlob(file.data, file.type)
      }));

      await saveToDatabase({
        ...trade,
        attachments
      });
    }

    await renderTrades();
    alert("Backup restored successfully.");

  } catch (error) {
    alert("Restore failed: " + error.message);
  }

  $("importFile").value = "";
}

/* ---------------- THEME ---------------- */

function toggleTheme() {
  const light = document.body.classList.toggle("light-theme");

  localStorage.setItem("tradeledger-theme", light ? "light" : "dark");

  $("themeBtn").textContent = light ? "☀️" : "🌙";
}

function loadTheme() {
  const theme = localStorage.getItem("tradeledger-theme");

  if (theme === "light") {
    document.body.classList.add("light-theme");
    $("themeBtn").textContent = "☀️";
  }
}

/* ---------------- EVENT LISTENERS ---------------- */

function setupEvents() {
  const calculationFields = [
    "buyQty", "buyPrice", "buyCharge", "extraBuyCharge",
    "sellQty", "sellPrice", "sellCharge", "extraSellCharge"
  ];

  calculationFields.forEach(id => {
    $(id).addEventListener("input", calculate);
  });

  $("tradeForm").addEventListener("submit", async event => {
    event.preventDefault();

    const calculations = calculate();

    const buyQty = number("buyQty");
    const sellQty = number("sellQty");

    if (buyQty !== sellQty) {
      alert(
        "Buy Quantity and Sell Quantity must match in this version. " +
        "Partial exits are not yet supported."
      );
      return;
    }

    if (buyQty <= 0 || sellQty <= 0) {
      alert("Enter valid Buy and Sell quantities.");
      return;
    }

    if (number("buyPrice") <= 0 || number("sellPrice") <= 0) {
      alert("Enter valid Buy and Sell prices.");
      return;
    }

    const attachments = await getSelectedAttachments();
    const trade = collectTrade(calculations, attachments);

    await saveToDatabase(trade);

    alert("Trade saved successfully.");

    $("tradeForm").reset();
    $("tradeId").value = "";
    $("leverage").value = "1";
    $("tradeDate").value = new Date().toISOString().slice(0, 10);

    currentAttachments = [];
    $("saveTradeBtn").textContent = "Save Trade";

    calculate();
    await renderTrades();
  });

  $("tradeHistory").addEventListener("click", async event => {
    const editId = event.target.dataset.edit;
    const deleteId = event.target.dataset.delete;
    const viewId = event.target.dataset.view;

    if (editId) {
      await editTrade(editId);
    }

    if (deleteId) {
      if (confirm("Delete this trade permanently?")) {
        await deleteFromDatabase(deleteId);
        await renderTrades();
      }
    }

    if (viewId) {
      await viewAttachments(viewId);
    }
  });

  $("periodFilter").addEventListener("change", renderTrades);
  $("searchStock").addEventListener("input", renderTrades);

  $("newTradeBtn").addEventListener("click", () => {
    $("tradeForm").reset();
    $("tradeId").value = "";
    currentAttachments = [];
    $("leverage").value = "1";
    $("tradeDate").value = new Date().toISOString().slice(0, 10);
    $("saveTradeBtn").textContent = "Save Trade";
    calculate();
    $("tradeForm").scrollIntoView({ behavior: "smooth" });
  });

  $("resetTradeBtn").addEventListener("click", () => {
    $("tradeId").value = "";
    currentAttachments = [];
    $("saveTradeBtn").textContent = "Save Trade";
    setTimeout(calculate, 0);
  });

  $("exportBtn").addEventListener("click", exportBackup);

  $("importFile").addEventListener("change", event => {
    importBackup(event.target.files[0]);
  });

  $("themeBtn").addEventListener("click", toggleTheme);
}

/* ---------------- START APP ---------------- */

async function startApp() {
  try {
    db = await openDatabase();

    loadTheme();
    setupEvents();

    $("tradeDate").value = new Date().toISOString().slice(0, 10);

    calculate();
    await renderTrades();

    $("storageStatus").textContent = "Offline Storage Ready";

  } catch (error) {
    console.error(error);
    $("storageStatus").textContent = "Storage Error";
    alert("Unable to start TradeLedger database.");
  }
}

startApp();

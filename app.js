
"use strict";

/* ==========================================
   TRADELEDGER - PROFESSIONAL TRADING JOURNAL
   Database: IndexedDB
   Dashboard: Day / Week / Month / Year / Overall
   Dynamic Field Manager included
========================================== */

const $ = (id) => document.getElementById(id);

const DB_NAME = "TradeLedgerDB";
const DB_VERSION = 2;

let db;
let trades = [];
let fields = [];
let currentAttachments = [];
let existingCustomFields = {};
let editingTradeId = null;

const money = (value) =>
  "₹" + (Number(value) || 0).toFixed(2);

const number = (id) =>
  Number($(id)?.value) || 0;

const today = () => {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
};

const makeId = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

/* ==========================================
   DATABASE
========================================== */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains("trades")) {
        database.createObjectStore("trades", {
          keyPath: "id"
        });
      }

      if (!database.objectStoreNames.contains("fields")) {
        database.createObjectStore("fields", {
          keyPath: "id"
        });
      }
    };

    request.onsuccess = () => {
      db = request.result;

      db.onversionchange = () => {
        db.close();
      };

      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function saveRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(record);

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
}

function deleteRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(id);

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
}

/* ==========================================
   CALCULATIONS
========================================== */

function calculateTrade() {
  const buyQty = number("buyQty");
  const sellQty = number("sellQty");
  const buyPrice = number("buyPrice");
  const sellPrice = number("sellPrice");

  const buyValue = buyQty * buyPrice;
  const sellValue = sellQty * sellPrice;

  const buyCharges =
    number("buyCharge") + number("extraBuyCharge");

  const sellCharges =
    number("sellCharge") + number("extraSellCharge");

  const totalCharges = buyCharges + sellCharges;

  // Cost basis of the shares sold.
  const costBasis = sellQty * buyPrice;

  const grossPL = sellValue - costBasis;
  const netPL = grossPL - totalCharges;

  $("buyStockValue").value = buyValue.toFixed(2);
  $("totalBuyCharges").value = buyCharges.toFixed(2);
  $("totalBuyValue").value = (buyValue + buyCharges).toFixed(2);

  $("sellStockValue").value = sellValue.toFixed(2);
  $("totalSellCharges").value = sellCharges.toFixed(2);
  $("totalSellValue").value = (sellValue - sellCharges).toFixed(2);

  $("priceMovement").value =
    (sellPrice - buyPrice).toFixed(2);

  $("grossPLInput").value = grossPL.toFixed(2);
  $("totalChargesInput").value = totalCharges.toFixed(2);
  $("netPLInput").value = netPL.toFixed(2);
}

function getTradeResult(netPL) {
  if (netPL > 0) return "Win";
  if (netPL < 0) return "Loss";
  return "Break Even";
}

/* ==========================================
   DASHBOARD PERIOD SELECTOR
========================================== */

function createDashboardSelector() {
  const heading = document.querySelector("#dashboard .section-heading");
  if (!heading || $("dashboardPeriod")) return;

  const wrapper = document.createElement("div");
  wrapper.className = "dashboard-period";

  wrapper.innerHTML = `
    <label for="dashboardPeriod">Overview Period</label>
    <select id="dashboardPeriod">
      <option value="day">Day</option>
      <option value="week">Week</option>
      <option value="month">Month</option>
      <option value="year">Year</option>
      <option value="overall" selected>Overall</option>
    </select>
  `;

  heading.appendChild(wrapper);

  $("dashboardPeriod").addEventListener("change", renderDashboard);
}

function isInPeriod(dateValue, period) {
  if (period === "overall") return true;

  if (!dateValue) return false;

  const date = new Date(dateValue + "T12:00:00");
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  const startToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  if (period === "day") {
    return date.toDateString() === startToday.toDateString();
  }

  if (period === "week") {
    const day = (startToday.getDay() + 6) % 7;
    const startWeek = new Date(startToday);
    startWeek.setDate(startToday.getDate() - day);

    return date >= startWeek && date <= now;
  }

  if (period === "month") {
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth()
    );
  }

  if (period === "year") {
    return date.getFullYear() === now.getFullYear();
  }

  return true;
}

function renderDashboard() {
  const period = $("dashboardPeriod")?.value || "overall";

  const selectedTrades = trades.filter((trade) =>
    isInPeriod(trade.date, period)
  );

  const total = selectedTrades.length;

  const wins = selectedTrades.filter(
    (t) => Number(t.netPL) > 0
  ).length;

  const losses = selectedTrades.filter(
    (t) => Number(t.netPL) < 0
  ).length;

  const gross = selectedTrades.reduce(
    (sum, t) => sum + Number(t.grossPL || 0), 0
  );

  const charges = selectedTrades.reduce(
    (sum, t) => sum + Number(t.totalCharges || 0), 0
  );

  const net = selectedTrades.reduce(
    (sum, t) => sum + Number(t.netPL || 0), 0
  );

  const winRate = total ? (wins / total) * 100 : 0;

  $("totalTrades").textContent = total;
  $("winningTrades").textContent = wins;
  $("losingTrades").textContent = losses;
  $("winRate").textContent = winRate.toFixed(1) + "%";

  $("grossPL").textContent = money(gross);
  $("totalCharges").textContent = money(charges);
  $("netPL").textContent = money(net);

  $("grossPL").style.color = gross >= 0 ? "#22c55e" : "#ef4444";
  $("netPL").style.color = net >= 0 ? "#22c55e" : "#ef4444";
}

/* ==========================================
   DYNAMIC FIELD MANAGER
========================================== */

async function loadFields() {
  fields = await getAll("fields");
  renderFieldList();
  renderCustomInputs();
}

function renderCustomInputs() {
  const container = $("customFieldsContainer");
  if (!container) return;

  container.innerHTML = "";

  fields
    .filter((field) => field.active !== false && field.showForm)
    .forEach((field) => {
      const label = document.createElement("label");
      label.textContent = field.name;

      let input;

      if (field.type === "dropdown") {
        input = document.createElement("select");

        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "Select " + field.name;
        input.appendChild(blank);

        (field.options || []).forEach((option) => {
          const item = document.createElement("option");
          item.value = option;
          item.textContent = option;
          input.appendChild(item);
        });
      } else {
        input = document.createElement("input");
        input.type = field.type || "text";

        if (field.type === "number") {
          input.step = "any";
        }
      }

      input.dataset.customField = field.id;
      input.value = existingCustomFields[field.id] ?? "";
      input.required = Boolean(field.required);

      label.appendChild(input);
      container.appendChild(label);
    });
}

function collectCustomValues() {
  const values = { ...existingCustomFields };

  document
    .querySelectorAll("[data-custom-field]")
    .forEach((input) => {
      values[input.dataset.customField] = input.value;
    });

  return values;
}

function fillCustomValues(values = {}) {
  existingCustomFields = { ...values };
  renderCustomInputs();
}

function historyCustomText(values = {}) {
  return fields
    .filter((field) =>
      field.active !== false && field.showHistory
    )
    .map((field) => {
      const value = values[field.id];
      return value !== undefined && value !== ""
        ? field.name + ": " + value
        : "";
    })
    .filter(Boolean)
    .join(" | ");
}

async function saveField(event) {
  event.preventDefault();

  const name = $("fieldName").value.trim();
  if (!name) return;

  const id = $("fieldId").value || makeId();

  const field = {
    id,
    name,
    type: $("fieldType").value,
    options: $("fieldOptions").value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    showForm: $("fieldInForm").checked,
    showHistory: $("fieldInHistory").checked,
    required: $("fieldRequired").checked,
    active: true,
    updatedAt: new Date().toISOString()
  };

  const old = fields.find((item) => item.id === id);

  if (old) {
    field.createdAt = old.createdAt;
  } else {
    field.createdAt = new Date().toISOString();
  }

  await saveRecord("fields", field);

  $("fieldForm").reset();
  $("fieldId").value = "";
  $("fieldOptions").disabled = true;
  await loadFields();

  alert("Field saved successfully.");
}

function renderFieldList() {
  const list = $("fieldList");
  if (!list) return;

  list.innerHTML = "";

  if (!fields.length) {
    list.textContent = "No custom fields created yet.";
    return;
  }

  fields.forEach((field) => {
    const item = document.createElement("div");
    item.className = "field-manager-item";

    const info = document.createElement("div");

    const title = document.createElement("strong");
    title.textContent = field.name;

    const details = document.createElement("small");
    details.textContent =
      "Type: " + field.type +
      " | Form: " + (field.showForm ? "Yes" : "No") +
      " | History: " + (field.showHistory ? "Yes" : "No") +
      " | " + (field.active === false ? "Hidden" : "Active");

    info.append(title, details);

    const actions = document.createElement("div");
    actions.className = "field-manager-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.onclick = () => editField(field.id);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = field.active === false ? "Show" : "Hide";
    toggle.onclick = () => toggleField(field);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.onclick = () => removeField(field.id);

    actions.append(edit, toggle, remove);
    item.append(info, actions);
    list.appendChild(item);
  });
}

function editField(id) {
  const field = fields.find((item) => item.id === id);
  if (!field) return;

  $("fieldId").value = field.id;
  $("fieldName").value = field.name;
  $("fieldType").value = field.type;
  $("fieldOptions").value = (field.options || []).join(", ");
  $("fieldInForm").checked = Boolean(field.showForm);
  $("fieldInHistory").checked = Boolean(field.showHistory);
  $("fieldRequired").checked = Boolean(field.required);

  $("fieldOptions").disabled = field.type !== "dropdown";

  $("adminPanel").hidden = false;
  $("adminPanel").scrollIntoView({ behavior: "smooth" });
}

async function toggleField(field) {
  field.active = field.active === false;
  await saveRecord("fields", field);
  await loadFields();
}

async function removeField(id) {
  if (!confirm(
    "Delete this field definition? Existing trade values will be preserved."
  )) return;

  await deleteRecord("fields", id);
  await loadFields();
}

function setupFieldManager() {
  $("fieldForm")?.addEventListener("submit", saveField);

  $("fieldType")?.addEventListener("change", () => {
    $("fieldOptions").disabled =
      $("fieldType").value !== "dropdown";
  });

  $("cancelFieldEdit")?.addEventListener("click", () => {
    $("fieldForm").reset();
    $("fieldId").value = "";
    $("fieldOptions").disabled = true;
  });

  $("adminBtn")?.addEventListener("click", () => {
    $("adminPanel").hidden = !$("adminPanel").hidden;
    if (!$("adminPanel").hidden) {
      $("adminPanel").scrollIntoView({ behavior: "smooth" });
    }
  });

  $("closeAdminBtn")?.addEventListener("click", () => {
    $("adminPanel").hidden = true;
  });
}

/* ==========================================
   ATTACHMENTS
========================================== */

function readFiles() {
  const imageFiles = Array.from($("chartImages")?.files || []);
  const contractFiles = Array.from($("contractNote")?.files || []);

  return [...currentAttachments, ...imageFiles, ...contractFiles];
}

/* ==========================================
   TRADE FORM
========================================== */

function collectTrade() {
  calculateTrade();

  const buyQty = number("buyQty");
  const sellQty = number("sellQty");
  const grossPL = number("grossPLInput");
  const totalCharges = number("totalChargesInput");
  const netPL = number("netPLInput");

  const existing = trades.find((t) => t.id === editingTradeId);

  return {
    id: editingTradeId || makeId(),

    date: $("tradeDate").value || today(),
    voucherNumber: $("voucherNumber").value.trim(),
    stockName: $("stockName").value.trim(),
    capital: number("capital"),
    leverage: number("leverage"),
    strategy: $("strategy").value,
    riskReward: $("riskReward").value.trim(),

    tradeResult: getTradeResult(netPL),
    tradeType: $("tradeType").value,
    notes: $("notes").value.trim(),

    buyQty,
    buyPrice: number("buyPrice"),
    buyStockValue: number("buyStockValue"),
    buyCharge: number("buyCharge"),
    extraBuyCharge: number("extraBuyCharge"),
    totalBuyCharges: number("totalBuyCharges"),
    totalBuyValue: number("totalBuyValue"),

    sellQty,
    sellPrice: number("sellPrice"),
    sellStockValue: number("sellStockValue"),
    sellCharge: number("sellCharge"),
    extraSellCharge: number("extraSellCharge"),
    totalSellCharges: number("totalSellCharges"),
    totalSellValue: number("totalSellValue"),
    priceMovement: number("priceMovement"),

    grossPL,
    totalCharges,
    netPL,

    customFields: collectCustomValues(),
    attachments: readFiles(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function handleTradeSubmit(event) {
  event.preventDefault();

  const stockName = $("stockName").value.trim();

  if (!stockName) {
    alert("Please enter the stock name.");
    return;
  }

  calculateTrade();

  const trade = collectTrade();

  try {
    await saveRecord("trades", trade);

    alert(editingTradeId ? "Trade updated." : "Trade saved.");

    resetTradeForm();
    await refreshTrades();
  } catch (error) {
    console.error(error);
    alert("Could not save trade. Please try again.");
  }
}

function resetTradeForm() {
  $("tradeForm").reset();

  editingTradeId = null;
  existingCustomFields = {};
  currentAttachments = [];

  $("tradeId").value = "";
  $("tradeDate").value = today();
  $("leverage").value = "1";

  $("saveTradeBtn").textContent = "Save Trade";

  calculateTrade();
  renderCustomInputs();
}

async function editTrade(id) {
  const trade = trades.find((item) => item.id === id);
  if (!trade) return;

  editingTradeId = id;
  existingCustomFields = { ...(trade.customFields || {}) };
  currentAttachments = trade.attachments || [];

  const values = {
    tradeDate: trade.date,
    voucherNumber: trade.voucherNumber,
    stockName: trade.stockName,
    capital: trade.capital,
    leverage: trade.leverage,
    strategy: trade.strategy,
    riskReward: trade.riskReward,
    tradeResult: trade.tradeResult,
    tradeType: trade.tradeType,
    notes: trade.notes,

    buyQty: trade.buyQty,
    buyPrice: trade.buyPrice,
    buyCharge: trade.buyCharge,
    extraBuyCharge: trade.extraBuyCharge,

    sellQty: trade.sellQty,
    sellPrice: trade.sellPrice,
    sellCharge: trade.sellCharge,
    extraSellCharge: trade.extraSellCharge
  };

  Object.entries(values).forEach(([id, value]) => {
    if ($(id)) $(id).value = value ?? "";
  });

  $("tradeId").value = trade.id;
  $("saveTradeBtn").textContent = "Update Trade";

  fillCustomValues(trade.customFields || {});
  calculateTrade();

  $("tradeSection").scrollIntoView({ behavior: "smooth" });
}

async function deleteTrade(id) {
  if (!confirm("Are you sure you want to delete this trade?")) return;

  await deleteRecord("trades", id);
  await refreshTrades();
}

/* ==========================================
   TRADE HISTORY
========================================== */

function renderTrades() {
  const tbody = $("tradeHistory");
  if (!tbody) return;

  const search = ($("searchStock")?.value || "").toLowerCase();
  const period = $("periodFilter")?.value || "all";

  const filtered = trades.filter((trade) => {
    const matchesSearch =
      (trade.stockName || "").toLowerCase().includes(search);

    let matchesPeriod = true;

    if (period === "day") {
      matchesPeriod = isInPeriod(trade.date, "day");
    } else if (period === "week") {
      matchesPeriod = isInPeriod(trade.date, "week");
    } else if (period === "month") {
      matchesPeriod = isInPeriod(trade.date, "month");
    } else if (period === "year") {
      matchesPeriod = isInPeriod(trade.date, "year");
    }

    return matchesSearch && matchesPeriod;
  });

  if (!filtered.length) {
    tbody.innerHTML =
      '<tr><td colspan="8">No trades found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .map((trade) => {
      const resultClass =
        Number(trade.netPL) > 0 ? "profit" :
        Number(trade.netPL) < 0 ? "loss" : "";

      return `
        <tr>
          <td>${safeText(trade.date)}</td>
          <td>${safeText(trade.voucherNumber || "-")}</td>
          <td>${safeText(trade.stockName)}</td>
          <td>${safeText(trade.strategy || "-")}</td>
          <td>${safeText(trade.tradeResult || "-")}</td>
          <td class="${resultClass}">
            ${money(trade.netPL)}
          </td>
          <td>${safeText(historyCustomText(trade.customFields || {}) || "-")}</td>
          <td>
            <button type="button" data-edit="${safeText(trade.id)}">Edit</button>
            <button type="button" data-delete="${safeText(trade.id)}">Delete</button>
          </td>
        </tr>
      `;
    }).join("");

  tbody.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () =>
      editTrade(button.dataset.edit)
    );
  });

  tbody.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () =>
      deleteTrade(button.dataset.delete)
    );
  });
}

/* ==========================================
   BACKUP AND RESTORE
========================================== */

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function prepareBackup() {
  const backupTrades = [];

  for (const trade of trades) {
    const copy = { ...trade, attachments: [] };

    for (const attachment of (trade.attachments || [])) {
      if (attachment instanceof Blob) {
        copy.attachments.push({
          name: attachment.name || "attachment",
          type: attachment.type || "application/octet-stream",
          data: await blobToDataURL(attachment)
        });
      } else if (attachment?.blob instanceof Blob) {
        copy.attachments.push({
          name: attachment.name || "attachment",
          type: attachment.type || "application/octet-stream",
          data: await blobToDataURL(attachment.blob)
        });
      } else {
        copy.attachments.push(attachment);
      }
    }

    backupTrades.push(copy);
  }

  return {
    app: "TradeLedger",
    version: 2,
    exportedAt: new Date().toISOString(),
    trades: backupTrades,
    fields
  };
}

function dataURLToBlob(dataURL) {
  const parts = dataURL.split(",");
  const mime = parts[0].match(/:(.*?);/)?.[1] || "";
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

async function exportBackup() {
  try {
    const backup = await prepareBackup();

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "TradeLedger-Backup-" + today() + ".json";
    link.click();

    URL.revokeObjectURL(url);
  } catch (error) {
    console.error(error);
    alert("Backup failed.");
  }
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!confirm(
    "Restore this backup? Matching trade IDs will be replaced."
  )) {
    event.target.value = "";
    return;
  }

  try {
    const backup = JSON.parse(await file.text());

    if (!Array.isArray(backup.trades)) {
      throw new Error("Invalid backup file");
    }

    for (const trade of backup.trades) {
      trade.attachments = (trade.attachments || []).map((item) => {
        if (item?.data) {
          return {
            name: item.name,
            type: item.type,
            blob: dataURLToBlob(item.data)
          };
        }
        return item;
      });

      await saveRecord("trades", trade);
    }

    if (Array.isArray(backup.fields)) {
      for (const field of backup.fields) {
        await saveRecord("fields", field);
      }
    }

    await loadFields();
    await refreshTrades();

    alert("Backup restored successfully.");
  } catch (error) {
    console.error(error);
    alert("Invalid backup or restore failed.");
  }

  event.target.value = "";
}

/* ==========================================
   THEME
========================================== */

function setupTheme() {
  const savedTheme = localStorage.getItem("tradeledger-theme");

  if (savedTheme === "light") {
    document.body.classList.add("light-theme");
    $("themeBtn").textContent = "☀️";
  }

  $("themeBtn")?.addEventListener("click", () => {
    document.body.classList.toggle("light-theme");

    const isLight =
      document.body.classList.contains("light-theme");

    localStorage.setItem(
      "tradeledger-theme",
      isLight ? "light" : "dark"
    );

    $("themeBtn").textContent = isLight ? "☀️" : "🌙";
  });
}

/* ==========================================
   REFRESH
========================================== */

async function refreshTrades() {
  trades = await getAll("trades");

  trades.sort((a, b) =>
    (b.date || "").localeCompare(a.date || "")
  );

  renderDashboard();
  renderTrades();
}

/* ==========================================
   INITIALIZATION
========================================== */

async function startApp() {
  try {
    await openDatabase();

    $("storageStatus").textContent = "● Offline Storage Ready";
    $("storageStatus").style.color = "#22c55e";

    createDashboardSelector();
    setupTheme();
    setupFieldManager();

    await loadFields();
    await refreshTrades();

    $("tradeDate").value = today();

    $("tradeForm").addEventListener(
      "submit",
      handleTradeSubmit
    );

    $("tradeForm").addEventListener("reset", () => {
      setTimeout(resetTradeForm, 0);
    });

    $("newTradeBtn")?.addEventListener("click", resetTradeForm);
    $("resetTradeBtn")?.addEventListener("click", resetTradeForm);

    $("periodFilter")?.addEventListener("change", renderTrades);
    $("searchStock")?.addEventListener("input", renderTrades);

    $("exportBtn")?.addEventListener("click", exportBackup);
    $("importFile")?.addEventListener("change", importBackup);

    [
      "buyQty", "buyPrice", "buyCharge", "extraBuyCharge",
      "sellQty", "sellPrice", "sellCharge", "extraSellCharge"
    ].forEach((id) => {
      $(id)?.addEventListener("input", calculateTrade);
    });

    calculateTrade();

  } catch (error) {
    console.error(error);

    if ($("storageStatus")) {
      $("storageStatus").textContent = "Storage Error";
      $("storageStatus").style.color = "#ef4444";
    }

    alert("TradeLedger could not open its database. Please check the app.");
  }
}

document.addEventListener("DOMContentLoaded", startApp);

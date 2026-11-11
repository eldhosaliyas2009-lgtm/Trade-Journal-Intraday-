
"use strict";

/* =====================================================
   TRADELEDGER - OFFLINE TRADING JOURNAL
   Dynamic Field Manager Integrated
===================================================== */

const $ = id => document.getElementById(id);

const DB_NAME = "TradeLedgerDB";
const DB_VERSION = 2;
const STORE_NAME = "trades";
const FIELD_STORE = "fields";

let db;
let currentAttachments = [];
let existingCustomFields = {};

/* =====================================================
   DATABASE
===================================================== */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, {
          keyPath: "id"
        });
      }

      if (!database.objectStoreNames.contains(FIELD_STORE)) {
        database.createObjectStore(FIELD_STORE, {
          keyPath: "id"
        });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

function getAllTrades() {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME).getAll();

    request.onsuccess = () => resolve(request.result || []);
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

function getAllCustomFields() {
  return new Promise((resolve, reject) => {
    const request = db.transaction(FIELD_STORE, "readonly")
      .objectStore(FIELD_STORE).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function saveCustomField(field) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(FIELD_STORE, "readwrite");

    transaction.objectStore(FIELD_STORE).put(field);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function deleteCustomField(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(FIELD_STORE, "readwrite");

    transaction.objectStore(FIELD_STORE).delete(id);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/* =====================================================
   BASIC HELPERS
===================================================== */

function number(id) {
  return Number($(id).value) || 0;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function newId() {
  return crypto.randomUUID();
}

/* =====================================================
   CALCULATIONS
===================================================== */

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

/* =====================================================
   DYNAMIC FIELD MANAGER
===================================================== */

async function renderFieldForm() {
  const fields = await getAllCustomFields();
  const container = $("customFieldsContainer");

  container.innerHTML = "";

  fields
    .filter(field => field.active !== false && field.showForm)
    .forEach(field => {
      const wrapper = document.createElement("label");
      wrapper.textContent = field.name;

      let input;

      if (field.type === "dropdown") {
        input = document.createElement("select");

        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "Select " + field.name;
        input.appendChild(blank);

        (field.options || []).forEach(option => {
          const item = document.createElement("option");
          item.value = option;
          item.textContent = option;
          input.appendChild(item);
        });

      } else {
        input = document.createElement("input");
        input.type = ["text", "number", "date"].includes(field.type)
          ? field.type : "text";

        if (input.type === "number") {
          input.step = "any";
        }
      }

      input.dataset.customFieldId = field.id;

      if (field.required) {
        input.required = true;
      }

      input.value = existingCustomFields[field.id] ?? "";

      wrapper.appendChild(input);
      container.appendChild(wrapper);
    });
}

async function collectCustomFieldValues() {
  const values = { ...existingCustomFields };
  const fields = await getAllCustomFields();

  fields
    .filter(field => field.active !== false && field.showForm)
    .forEach(field => {
      const input = document.querySelector(
        `[data-custom-field-id="${CSS.escape(field.id)}"]`
      );

      if (input) {
        values[field.id] = input.value;
      }
    });

  return values;
}

async function fillCustomFieldValues(values = {}) {
  existingCustomFields = { ...values };

  await renderFieldForm();
}

async function renderFieldList() {
  const fields = await getAllCustomFields();
  const list = $("fieldList");

  list.innerHTML = "";

  if (!fields.length) {
    list.textContent = "No custom fields created yet.";
    return;
  }

  fields.forEach(field => {
    const item = document.createElement("div");
    item.className = "field-manager-item";

    const info = document.createElement("div");

    const title = document.createElement("strong");
    title.textContent = field.name;

    const details = document.createElement("small");
    details.textContent =
      `${field.type} | Form: ${field.showForm ? "Yes" : "No"} | History: ${field.showHistory ? "Yes" : "No"} | ${field.active === false ? "Hidden" : "Active"}`;

    info.append(title, details);

    const actions = document.createElement("div");
    actions.className = "field-manager-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => editField(field.id));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = field.active === false ? "Show" : "Hide";
    toggle.addEventListener("click", async () => {
      field.active = field.active === false;
      field.updatedAt = new Date().toISOString();

      await saveCustomField(field);
      await refreshCustomFields();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm(
        "Delete this field definition? Existing trade values will be preserved."
      )) return;

      await deleteCustomField(field.id);
      await refreshCustomFields();
    });

    actions.append(edit, toggle, remove);
    item.append(info, actions);
    list.appendChild(item);
  });
}

function resetFieldForm() {
  $("fieldForm").reset();
  $("fieldId").value = "";
  $("fieldInForm").checked = true;
  $("fieldOptions").disabled = true;
}

async function editField(id) {
  const fields = await getAllCustomFields();
  const field = fields.find(item => item.id === id);

  if (!field) return;

  $("fieldId").value = field.id;
  $("fieldName").value = field.name;
  $("fieldType").value = field.type;
  $("fieldOptions").value = (field.options || []).join(", ");
  $("fieldInForm").checked = !!field.showForm;
  $("fieldInHistory").checked = !!field.showHistory;
  $("fieldRequired").checked = !!field.required;

  $("fieldOptions").disabled = field.type !== "dropdown";

  $("adminPanel").hidden = false;
  $("fieldForm").scrollIntoView({ behavior: "smooth" });
}

async function refreshCustomFields() {
  await renderFieldForm();
  await renderFieldList();
  await renderTrades();
}

async function setupFieldManager() {
  $("fieldType").addEventListener("change", () => {
    $("fieldOptions").disabled =
      $("fieldType").value !== "dropdown";
  });

  $("fieldForm").addEventListener("submit", async event => {
    event.preventDefault();

    const name = $("fieldName").value.trim();

    if (!name) {
      alert("Enter a field name.");
      return;
    }

    const fields = await getAllCustomFields();
    const id = $("fieldId").value || newId();

    const duplicate = fields.some(field =>
      field.id !== id &&
      field.name.toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      alert("A field with this name already exists.");
      return;
    }

    const type = $("fieldType").value;

    const options = type === "dropdown"
      ? $("fieldOptions").value.split(",")
          .map(item => item.trim())
          .filter(Boolean)
      : [];

    if (type === "dropdown" && !options.length) {
      alert("Enter at least one dropdown option.");
      return;
    }

    const old = fields.find(field => field.id === id);

    const field = {
      id,
      name,
      type,
      options,
      showForm: $("fieldInForm").checked,
      showHistory: $("fieldInHistory").checked,
      required: $("fieldRequired").checked,
      active: old ? old.active !== false : true,
      createdAt: old?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await saveCustomField(field);

    resetFieldForm();
    await refreshCustomFields();

    alert("Custom field saved.");
  });

  $("cancelFieldEdit").addEventListener("click", resetFieldForm);

  $("adminBtn").addEventListener("click", () => {
    $("adminPanel").hidden = !$("adminPanel").hidden;

    if (!$("adminPanel").hidden) {
      $("adminPanel").scrollIntoView({ behavior: "smooth" });
    }
  });

  $("closeAdminBtn").addEventListener("click", () => {
    $("adminPanel").hidden = true;
  });

  await renderFieldForm();
  await renderFieldList();
}

/* =====================================================
   ATTACHMENTS
===================================================== */

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

/* =====================================================
   FORM DATA
===================================================== */

async function collectTrade(calculations, attachments) {
  const id = $("tradeId").value || newId();

  const customFields = await collectCustomFieldValues();

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

    customFields,
    attachments,
    updatedAt: new Date().toISOString()
  };
}

/* =====================================================
   DASHBOARD
===================================================== */

function updateDashboard(trades) {
  const total = trades.length;
  const wins = trades.filter(t => Number(t.netPL) > 0).length;
  const losses = trades.filter(t => Number(t.netPL) < 0).length;

  const gross = trades.reduce(
    (sum, t) => sum + Number(t.grossPL || 0), 0
  );

  const charges = trades.reduce(
    (sum, t) => sum + Number(t.totalCharges || 0), 0
  );

  const net = trades.reduce(
    (sum, t) => sum + Number(t.netPL || 0), 0
  );

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

/* =====================================================
   FILTERS
===================================================== */

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
    return date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();
  }

  if (period === "year") {
    return date.getFullYear() === now.getFullYear();
  }

  return true;
}

/* =====================================================
   TRADE HISTORY
===================================================== */

async function renderTrades() {
  const allTrades = await getAllTrades();
  const fields = await getAllCustomFields();

  updateDashboard(allTrades);

  const period = $("periodFilter").value;
  const search = $("searchStock").value.trim().toUpperCase();

  const trades = allTrades
    .filter(t => isInPeriod(t.date || "", period))
    .filter(t => String(t.stockName || "").includes(search))
    .sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    );

  const historyFields = fields.filter(field =>
    field.active !== false && field.showHistory
  );

  const headerRow = document.querySelector("#historySection thead tr");

  headerRow.innerHTML = "";

  [
    "Date",
    "Voucher",
    "Stock",
    "Strategy",
    "Result",
    "Net P&L"
  ].forEach(name => {
    const th = document.createElement("th");
    th.textContent = name;
    headerRow.appendChild(th);
  });

  historyFields.forEach(field => {
    const th = document.createElement("th");
    th.textContent = field.name;
    headerRow.appendChild(th);
  });

  const actionHeader = document.createElement("th");
  actionHeader.textContent = "Actions";
  headerRow.appendChild(actionHeader);

  const tbody = $("tradeHistory");

  if (!trades.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 7 + historyFields.length;
    cell.textContent = "No trades found.";

    row.appendChild(cell);
    tbody.replaceChildren(row);
    return;
  }

  tbody.innerHTML = trades.map(t => {
    const customCells = historyFields.map(field => `
      <td>${safeText(
        t.customFields?.[field.id] ?? "-"
      )}</td>
    `).join("");

    return `
      <tr>
        <td>${safeText(t.date)}</td>
        <td>${safeText(t.voucherNumber || "-")}</td>
        <td>${safeText(t.stockName || "-")}</td>
        <td>${safeText(t.strategy || "-")}</td>
        <td>${safeText(t.tradeResult || "-")}</td>
        <td class="${Number(t.netPL) >= 0 ? "positive" : "negative"}">
          ₹${money(t.netPL)}
        </td>
        ${customCells}
        <td>
          <button type="button" data-edit="${safeText(t.id)}">Edit</button>
          <button type="button" data-delete="${safeText(t.id)}">Delete</button>
          <button type="button" data-view="${safeText(t.id)}">Files</button>
        </td>
      </tr>
    `;
  }).join("");
}

/* =====================================================
   EDIT TRADE
===================================================== */

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

  existingCustomFields = { ...(trade.customFields || {}) };

  await renderFieldForm();

  calculate();

  window.scrollTo({
    top: $("tradeForm").getBoundingClientRect().top +
      window.scrollY - 20,
    behavior: "smooth"
  });

  $("saveTradeBtn").textContent = "Update Trade";
}

/* =====================================================
   ATTACHMENT VIEW
===================================================== */

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

  alert(
    "Attachments:\n" + message +
    "\n\nFiles are stored in this browser's offline database."
  );
}

/* =====================================================
   BACKUP & RESTORE
===================================================== */

async function exportBackup() {
  const trades = await getAllTrades();
  const customFields = await getAllCustomFields();

  const serialized = [];

  for (const trade of trades) {
    const attachments = [];

    for (const file of trade.attachments || []) {
      const data = file.blob
        ? await blobToBase64(file.blob)
        : file.data || "";

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
    version: 2,
    exportedAt: new Date().toISOString(),
    trades: serialized,
    customFields
  };

  const blob = new Blob(
    [JSON.stringify(backup)],
    { type: "application/json" }
  );

  downloadBlob(
    blob,
    "TradeLedger-Backup-" +
      new Date().toISOString().slice(0, 10) + ".json"
  );
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(data, type) {
  if (!data) return new Blob([], { type: type || "" });

  const parts = data.split(",");
  const binary = atob(parts[1] || "");
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
      " trades? Existing trades with the same IDs will be replaced. " +
      "Custom field definitions will also be imported."
    )) return;

    for (const trade of backup.trades) {
      const attachments = (trade.attachments || []).map(file => ({
        name: file.name,
        type: file.type,
        blob: file.data
          ? base64ToBlob(file.data, file.type)
          : new Blob([], { type: file.type || "" })
      }));

      await saveToDatabase({
        ...trade,
        attachments
      });
    }

    for (const field of backup.customFields || []) {
      await saveCustomField(field);
    }

    await refreshCustomFields();

    alert("Backup restored successfully.");

  } catch (error) {
    alert("Restore failed: " + error.message);
  }

  $("importFile").value = "";
}

/* =====================================================
   THEME
===================================================== */

function toggleTheme() {
  const light = document.body.classList.toggle("light-theme");

  localStorage.setItem(
    "tradeledger-theme",
    light ? "light" : "dark"
  );

  $("themeBtn").textContent = light ? "☀️" : "🌙";
}

function loadTheme() {
  const theme = localStorage.getItem("tradeledger-theme");

  if (theme === "light") {
    document.body.classList.add("light-theme");
    $("themeBtn").textContent = "☀️";
  }
}

/* =====================================================
   EVENT LISTENERS
===================================================== */

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

    try {
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

      if (!$("tradeDate").value || !$("stockName").value.trim()) {
        alert("Enter Trade Date and Stock Name.");
        return;
      }

      const attachments = await getSelectedAttachments();

      const trade = await collectTrade(calculations, attachments);

      await saveToDatabase(trade);

      alert("Trade saved successfully.");

      $("tradeForm").reset();
      $("tradeId").value = "";
      $("leverage").value = "1";
      $("tradeDate").value = new Date().toISOString().slice(0, 10);

      currentAttachments = [];
      existingCustomFields = {};

      $("saveTradeBtn").textContent = "Save Trade";

      await renderFieldForm();

      calculate();
      await renderTrades();

    } catch (error) {
      console.error(error);
      alert("Unable to save trade: " + error.message);
    }
  });

  $("tradeHistory").addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;

    const editId = button.dataset.edit;
    const deleteId = button.dataset.delete;
    const viewId = button.dataset.view;

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

  $("newTradeBtn").addEventListener("click", async () => {
    $("tradeForm").reset();
    $("tradeId").value = "";

    currentAttachments = [];
    existingCustomFields = {};

    $("leverage").value = "1";
    $("tradeDate").value = new Date().toISOString().slice(0, 10);
    $("saveTradeBtn").textContent = "Save Trade";

    await renderFieldForm();

    calculate();
    $("tradeForm").scrollIntoView({ behavior: "smooth" });
  });

  $("resetTradeBtn").addEventListener("click", () => {
    $("tradeId").value = "";
    currentAttachments = [];
    existingCustomFields = {};

    $("saveTradeBtn").textContent = "Save Trade";

    setTimeout(async () => {
      await renderFieldForm();
      calculate();
    }, 0);
  });

  $("exportBtn").addEventListener("click", exportBackup);

  $("importFile").addEventListener("change", event => {
    importBackup(event.target.files[0]);
  });

  $("themeBtn").addEventListener("click", toggleTheme);
}

/* =====================================================
   START APP
===================================================== */

async function startApp() {
  try {
    db = await openDatabase();

    loadTheme();
    setupEvents();

    await setupFieldManager();

    $("tradeDate").value = new Date().toISOString().slice(0, 10);

    calculate();
    await renderTrades();

    $("storageStatus").textContent = "Offline Storage Ready";

  } catch (error) {
    console.error(error);

    $("storageStatus").textContent = "Storage Error";

    alert(
      "Unable to start TradeLedger. " + error.message
    );
  }
}

startApp();


"use strict";

/* ==========================================
   TRADELEDGER - SPREADSHEET JOURNAL
   Existing TradeLedgerDB is preserved.
========================================== */

const $ = id => document.getElementById(id);
const DB_NAME = "TradeLedgerDB";

let db;
let trades = [];
let fields = [];
let editingTradeId = null;
let currentAttachments = [];

const STANDARD_COLUMNS = [
  ["date", "Date"],
  ["voucherNumber", "Voucher Number"],
  ["stockName", "Stock Name"],
  ["capital", "Capital"],
  ["leverage", "Leverage"],
  ["strategy", "Strategy"],
  ["riskReward", "Risk Reward"],
  ["tradeType", "Trade Type"],
  ["tradeResult", "Trade Result"],
  ["buyQty", "Buy Qty"],
  ["buyPrice", "Buy Price"],
  ["buyStockValue", "Buy Stock Value"],
  ["buyCharge", "Buy Charges"],
  ["extraBuyCharge", "Extra Buy Charges"],
  ["totalBuyCharges", "Total Buy Charges"],
  ["totalBuyValue", "Total Buy Value"],
  ["sellQty", "Sell Qty"],
  ["sellPrice", "Sell Price"],
  ["sellStockValue", "Sell Stock Value"],
  ["sellCharge", "Sell Charges"],
  ["extraSellCharge", "Extra Sell Charges"],
  ["totalSellCharges", "Total Sell Charges"],
  ["totalSellValue", "Total Sell Value"],
  ["priceMovement", "Price Movement"],
  ["grossPL", "Gross P&L"],
  ["totalCharges", "Total Charges"],
  ["netPL", "Net P&L"],
  ["notes", "Notes"],
  ["attachments", "Attachments"]
];

const num = value => Number(value) || 0;
const money = value => "₹" + num(value).toFixed(2);
const makeId = () => "trade_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  })[char]);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------------- DATABASE ---------------- */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains("trades")) {
        database.createObjectStore("trades", {
          keyPath: "id",
          autoIncrement: true
        });
      }

      if (!database.objectStoreNames.contains("fields")) {
        database.createObjectStore("fields", {
          keyPath: "id",
          autoIncrement: true
        });
      }
    };

    request.onsuccess = () => {
      db = request.result;

      if (!db.objectStoreNames.contains("trades") ||
          !db.objectStoreNames.contains("fields")) {
        reject(new Error("Required database stores are missing. Existing database was not reset."));
        return;
      }

      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other TradeLedger tabs and reload."));
  });
}

function readAll(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function saveRecord(storeName, record, existingKey) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const keyPath = store.keyPath;
    const item = { ...record };

    let request;

    if (keyPath) {
      const keyName = Array.isArray(keyPath) ? keyPath[0] : keyPath;

      if (existingKey !== undefined && existingKey !== null) {
        item[keyName] = existingKey;
      }

      if (item[keyName] === undefined || item[keyName] === null || item[keyName] === "") {
        delete item[keyName];
      }

      request = store.put(item);
    } else {
      if (existingKey !== undefined && existingKey !== null) {
        request = store.put(item, existingKey);
      } else {
        request = store.add(item);
      }
    }

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function loadData() {
  trades = await readAll("trades");
  fields = await readAll("fields");

  trades.sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || ""))
  );

  renderEverything();
}

/* ---------------- NAVIGATION ---------------- */

function showSection(sectionId) {
  document.querySelectorAll(".section").forEach(section => {
    section.classList.toggle("active", section.id === sectionId);
  });

  document.querySelectorAll(".nav-btn[data-section]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.section === sectionId
    );
  });
}

document.querySelectorAll(".nav-btn[data-section]").forEach(button => {
  button.addEventListener("click", () => showSection(button.dataset.section));
});

$("newTradeBtn").addEventListener("click", () => {
  resetForm();
  showSection("tradeFormSection");
});

$("adminOpenBtn").addEventListener("click", openAdmin);
$("closeAdminBtn").addEventListener("click", closeAdmin);
$("closeViewBtn").addEventListener("click", closeView);

/* ---------------- CALCULATIONS ---------------- */

const calculationInputs = [
  "buyQty", "buyPrice", "buyCharge", "extraBuyCharge",
  "sellQty", "sellPrice", "sellCharge", "extraSellCharge"
];

function calculateTrade() {
  const buyQty = num($("buyQty").value);
  const buyPrice = num($("buyPrice").value);
  const sellQty = num($("sellQty").value);
  const sellPrice = num($("sellPrice").value);

  const buyValue = buyQty * buyPrice;
  const sellValue = sellQty * sellPrice;

  const buyCharges = num($("buyCharge").value) +
                     num($("extraBuyCharge").value);

  const sellCharges = num($("sellCharge").value) +
                      num($("extraSellCharge").value);

  const totalCharges = buyCharges + sellCharges;
  const grossPL = sellValue - (sellQty * buyPrice);
  const netPL = grossPL - totalCharges;

  $("buyStockValue").value = buyValue.toFixed(2);
  $("totalBuyCharges").value = buyCharges.toFixed(2);
  $("totalBuyValue").value = (buyValue + buyCharges).toFixed(2);

  $("sellStockValue").value = sellValue.toFixed(2);
  $("totalSellCharges").value = sellCharges.toFixed(2);
  $("totalSellValue").value = (sellValue - sellCharges).toFixed(2);

  $("priceMovement").value = (sellPrice - buyPrice).toFixed(2);
  $("grossPLInput").value = grossPL.toFixed(2);
  $("totalChargesInput").value = totalCharges.toFixed(2);
  $("netPLInput").value = netPL.toFixed(2);
}

calculationInputs.forEach(id => {
  $(id).addEventListener("input", calculateTrade);
});

/* ---------------- ATTACHMENTS ---------------- */

function fileToData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve({
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: reader.result
    });

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function collectAttachments() {
  const images = Array.from($("chartImages").files || []);
  const documents = Array.from($("contractNote").files || []);

  const newImages = await Promise.all(images.map(fileToData));
  const newDocuments = await Promise.all(documents.map(fileToData));

  return [
    ...currentAttachments,
    ...newImages.map(file => ({ ...file, category: "Chart Image" })),
    ...newDocuments.map(file => ({ ...file, category: "Contract Note" }))
  ];
}

function attachmentCount(trade) {
  const list = trade.attachments || [];
  const oldImages = trade.chartImages || [];
  const oldDocuments = trade.contractNote || [];
  return list.length + oldImages.length + oldDocuments.length;
}

/* ---------------- FORM DATA ---------------- */

function getFormValue(id) {
  return $(id).value;
}

function collectTradeData() {
  calculateTrade();

  const data = {
    date: getFormValue("tradeDate"),
    voucherNumber: getFormValue("voucherNumber"),
    stockName: getFormValue("stockName").trim(),
    capital: num(getFormValue("capital")),
    leverage: getFormValue("leverage"),
    strategy: getFormValue("strategy"),
    riskReward: getFormValue("riskReward"),
    tradeType: getFormValue("tradeType"),
    tradeResult: getFormValue("tradeResult"),

    buyQty: num(getFormValue("buyQty")),
    buyPrice: num(getFormValue("buyPrice")),
    buyStockValue: num(getFormValue("buyStockValue")),
    buyCharge: num(getFormValue("buyCharge")),
    extraBuyCharge: num(getFormValue("extraBuyCharge")),
    totalBuyCharges: num(getFormValue("totalBuyCharges")),
    totalBuyValue: num(getFormValue("totalBuyValue")),

    sellQty: num(getFormValue("sellQty")),
    sellPrice: num(getFormValue("sellPrice")),
    sellStockValue: num(getFormValue("sellStockValue")),
    sellCharge: num(getFormValue("sellCharge")),
    extraSellCharge: num(getFormValue("extraSellCharge")),
    totalSellCharges: num(getFormValue("totalSellCharges")),
    totalSellValue: num(getFormValue("totalSellValue")),

    priceMovement: num(getFormValue("priceMovement")),
    grossPL: num(getFormValue("grossPLInput")),
    totalCharges: num(getFormValue("totalChargesInput")),
    netPL: num(getFormValue("netPLInput")),

    notes: getFormValue("notes"),
    customFields: {},
    attachments: []
  };

  fields.forEach(field => {
    const input = document.getElementById("custom_" + field.id);
    if (input) {
      data.customFields[field.id] =
        field.type === "checkbox" ? input.checked : input.value;
    }
  });

  return data;
}

async function saveTrade(event) {
  event.preventDefault();

  const button = $("saveTradeBtn");
  button.disabled = true;

  try {
    const data = collectTradeData();

    if (!data.stockName) {
      alert("Please enter Stock Name.");
      return;
    }

    data.attachments = await collectAttachments();

    const existing = editingTradeId !== null
      ? trades.find(trade => String(trade.id) === String(editingTradeId))
      : null;

    if (existing) {
      data.id = existing.id;
      data.createdAt = existing.createdAt || new Date().toISOString();
      data.updatedAt = new Date().toISOString();
    } else {
      data.createdAt = new Date().toISOString();
      data.updatedAt = new Date().toISOString();
    }

    const key = await saveRecord("trades", data, existing?.id);

    if (data.id === undefined || data.id === null) {
      data.id = key;
    }

    resetForm();
    await loadData();
    showSection("tradeJournalSection");
    alert(existing ? "Trade updated successfully." : "Trade saved successfully.");
  } catch (error) {
    console.error(error);
    alert("Could not save trade: " + (error.message || error));
  } finally {
    button.disabled = false;
  }
}

$("tradeForm").addEventListener("submit", saveTrade);

function resetForm() {
  $("tradeForm").reset();
  $("tradeDate").value = today();
  $("tradeId").value = "";
  editingTradeId = null;
  currentAttachments = [];
  $("attachmentInfo").textContent = "";
  $("formHeading").textContent = "Add New Trade";
  $("saveTradeBtn").textContent = "Save Trade";
  renderCustomFormFields({});
  calculateTrade();
}

$("resetTradeBtn").addEventListener("click", resetForm);

/* ---------------- CUSTOM FIELDS ---------------- */

function renderCustomFormFields(values = {}) {
  const container = $("customFieldsContainer");
  container.innerHTML = "";

  fields.filter(field => field.active !== false && field.showForm !== false)
    .forEach(field => {
      const label = document.createElement("label");
      label.textContent = field.name;

      let input;

      if (field.type === "dropdown" || field.type === "select") {
        input = document.createElement("select");
        input.innerHTML = '<option value="">Select</option>';

        (field.options || []).forEach(option => {
          const item = document.createElement("option");
          item.value = option;
          item.textContent = option;
          input.appendChild(item);
        });
      } else if (field.type === "checkbox") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(values[field.id]);
      } else {
        input = document.createElement("input");
        input.type = ["text", "number", "date"].includes(field.type)
          ? field.type : "text";
        input.value = values[field.id] ?? "";
      }

      input.id = "custom_" + field.id;
      if (field.required) input.required = true;

      if (field.type === "checkbox") {
        label.appendChild(input);
      } else {
        label.appendChild(input);
      }

      container.appendChild(label);
    });
}

/* ---------------- JOURNAL SPREADSHEET ---------------- */

function getColumns() {
  const customColumns = fields
    .filter(field => field.active !== false)
    .map(field => ({
      key: "custom_" + field.id,
      label: field.name,
      customId: field.id
    }));

  return [
    ...STANDARD_COLUMNS.map(([key, label]) => ({ key, label })),
    ...customColumns,
    { key: "actions", label: "Actions" }
  ];
}

function cellValue(trade, column) {
  if (column.key === "attachments") {
    return attachmentCount(trade);
  }

  if (column.key.startsWith("custom_")) {
    return trade.customFields?.[column.customId] ?? "";
  }

  const value = trade[column.key];

  if ([
    "capital", "buyPrice", "buyStockValue", "buyCharge",
    "extraBuyCharge", "totalBuyCharges", "totalBuyValue",
    "sellPrice", "sellStockValue", "sellCharge",
    "extraSellCharge", "totalSellCharges", "totalSellValue",
    "priceMovement", "grossPL", "totalCharges", "netPL"
  ].includes(column.key)) {
    return money(value);
  }

  return value ?? "";
}

function renderJournal() {
  const query = $("journalSearch").value.trim().toLowerCase();
  const columns = getColumns();

  const filtered = trades.filter(trade =>
    String(trade.stockName || "").toLowerCase().includes(query) ||
    String(trade.voucherNumber || "").toLowerCase().includes(query)
  );

  $("journalTradeCount").textContent =
    filtered.length + (filtered.length === 1 ? " Trade" : " Trades");

  $("journalHead").innerHTML =
    "<tr>" + columns.map(column =>
      `<th>${safeText(column.label)}</th>`
    ).join("") + "</tr>";

  if (!filtered.length) {
    $("journalBody").innerHTML =
      `<tr><td class="empty" colspan="${columns.length}">No trades found.</td></tr>`;
    return;
  }

  $("journalBody").innerHTML = filtered.map(trade => {
    const cells = columns.map(column => {
      if (column.key === "actions") {
        return `<td>
          <div class="action-cell">
            <button class="btn secondary small-btn" data-action="view" data-id="${safeText(trade.id)}">View</button>
            <button class="btn secondary small-btn" data-action="edit" data-id="${safeText(trade.id)}">Edit</button>
            <button class="btn danger small-btn" data-action="delete" data-id="${safeText(trade.id)}">Delete</button>
          </div>
        </td>`;
      }

      const value = cellValue(trade, column);
      let className = "";

      if (column.key === "netPL" || column.key === "grossPL") {
        className = num(value) > 0 ? "profit" : num(value) < 0 ? "loss" : "neutral";
      }

      if (column.key === "tradeResult") {
        className = value === "Win" ? "profit" :
                    value === "Lose" ? "loss" : "neutral";
      }

      return `<td class="${className}">${safeText(value)}</td>`;
    }).join("");

    return `<tr>${cells}</tr>`;
  }).join("");
}

$("journalSearch").addEventListener("input", renderJournal);

$("journalBody").addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const trade = trades.find(item =>
    String(item.id) === button.dataset.id
  );

  if (!trade) return;

  if (button.dataset.action === "view") viewTrade(trade);
  if (button.dataset.action === "edit") editTrade(trade);
  if (button.dataset.action === "delete") await removeTrade(trade);
});

/* ---------------- EDIT / DELETE / VIEW ---------------- */

function editTrade(trade) {
  editingTradeId = trade.id;
  $("tradeId").value = trade.id;

  const map = {
    tradeDate: "date", voucherNumber: "voucherNumber",
    stockName: "stockName", capital: "capital",
    leverage: "leverage", strategy: "strategy",
    riskReward: "riskReward", tradeType: "tradeType",
    tradeResult: "tradeResult", buyQty: "buyQty",
    buyPrice: "buyPrice", buyCharge: "buyCharge",
    extraBuyCharge: "extraBuyCharge", sellQty: "sellQty",
    sellPrice: "sellPrice", sellCharge: "sellCharge",
    extraSellCharge: "extraSellCharge", notes: "notes"
  };

  Object.entries(map).forEach(([elementId, key]) => {
    $(elementId).value = trade[key] ?? "";
  });

  currentAttachments = [
    ...(trade.attachments || [])
  ];

  $("attachmentInfo").textContent =
    currentAttachments.length + " existing attachment(s) retained.";

  renderCustomFormFields(trade.customFields || {});
  calculateTrade();

  $("formHeading").textContent = "Edit Trade";
  $("saveTradeBtn").textContent = "Update Trade";
  showSection("tradeFormSection");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function removeTrade(trade) {
  if (!confirm(`Delete trade ${trade.stockName || ""}? This cannot be undone.`)) return;

  try {
    await deleteRecord("trades", trade.id);
    await loadData();
  } catch (error) {
    alert("Delete failed: " + error.message);
  }
}

function viewTrade(trade) {
  const details = [
    ...STANDARD_COLUMNS.filter(([key]) => key !== "attachments"),
    ...fields.map(field => [
      "custom_" + field.id, field.name
    ])
  ];

  const html = details.map(([key, label]) => {
    let value = key.startsWith("custom_")
      ? trade.customFields?.[key.replace("custom_", "")] ?? ""
      : trade[key] ?? "";

    if ([
      "capital", "buyPrice", "buyStockValue", "buyCharge",
      "extraBuyCharge", "totalBuyCharges", "totalBuyValue",
      "sellPrice", "sellStockValue", "sellCharge",
      "extraSellCharge", "totalSellCharges", "totalSellValue",
      "priceMovement", "grossPL", "totalCharges", "netPL"
    ].includes(key)) value = money(value);

    return `<div class="detail-item">
      <small>${safeText(label)}</small>
      <strong>${safeText(value)}</strong>
    </div>`;
  }).join("");

  const attachmentList = [
    ...(trade.attachments || []),
    ...(trade.chartImages || []),
    ...(trade.contractNote || [])
  ];

  const attachmentHtml = attachmentList.map(file => {
    const name = file.name || "Attachment";
    const url = file.dataUrl || file.url || "";

    if (url) {
      return `<div class="detail-item">
        <small>${safeText(file.category || "Attachment")}</small>
        <a href="${safeText(url)}" target="_blank" rel="noopener">${safeText(name)}</a>
      </div>`;
    }

    return `<div class="detail-item">${safeText(name)} (stored attachment)</div>`;
  }).join("");

  $("viewTradeContent").innerHTML = `
    <div class="detail-grid">${html}</div>
    <h3 style="margin-top:20px">Attachments</h3>
    <div class="detail-grid">${attachmentHtml || "<p>No attachments.</p>"}</div>
    <h3 style="margin-top:20px">Notes</h3>
    <div class="detail-item">${safeText(trade.notes || "No notes")}</div>
  `;

  $("viewModal").classList.add("open");
  $("viewModal").setAttribute("aria-hidden", "false");
}

function closeView() {
  $("viewModal").classList.remove("open");
  $("viewModal").setAttribute("aria-hidden", "true");
}

/* ---------------- DASHBOARD ---------------- */

function renderDashboard() {
  const total = trades.length;
  const wins = trades.filter(t => t.tradeResult === "Win").length;
  const losses = trades.filter(t => t.tradeResult === "Lose").length;
  const gross = trades.reduce((sum, t) => sum + num(t.grossPL), 0);
  const charges = trades.reduce((sum, t) => sum + num(t.totalCharges), 0);
  const net = trades.reduce((sum, t) => sum + num(t.netPL), 0);
  const rate = total ? (wins / total) * 100 : 0;

  $("totalTrades").textContent = total;
  $("winningTrades").textContent = wins;
  $("losingTrades").textContent = losses;
  $("winRate").textContent = rate.toFixed(1) + "%";

  $("grossPL").textContent = money(gross);
  $("totalCharges").textContent = money(charges);
  $("netPL").textContent = money(net);

  $("grossPL").className = gross >= 0 ? "profit" : "loss";
  $("netPL").className = net >= 0 ? "profit" : "loss";

  const recent = trades.slice(0, 5);

  $("recentTrades").innerHTML = recent.length
    ? recent.map(trade => `
      <tr>
        <td>${safeText(trade.date || "")}</td>
        <td>${safeText(trade.stockName || "")}</td>
        <td>${safeText(trade.tradeType || "")}</td>
        <td>${safeText(trade.tradeResult || "")}</td>
        <td class="${num(trade.netPL) >= 0 ? "profit" : "loss"}">${money(trade.netPL)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="5" class="empty">No trades saved yet.</td></tr>`;
}

function renderEverything() {
  renderDashboard();
  renderJournal();
  renderCustomFormFields({});
  renderFieldList();
}

/* ---------------- FIELD MANAGER ---------------- */

function openAdmin() {
  $("adminPanel").classList.add("open");
  $("adminPanel").setAttribute("aria-hidden", "false");
  renderFieldList();
}

function closeAdmin() {
  $("adminPanel").classList.remove("open");
  $("adminPanel").setAttribute("aria-hidden", "true");
}

function resetFieldForm() {
  $("fieldForm").reset();
  $("fieldId").value = "";
  $("fieldInForm").checked = true;
  $("fieldRequired").checked = false;
}

$("cancelFieldEdit").addEventListener("click", resetFieldForm);

$("fieldForm").addEventListener("submit", async event => {
  event.preventDefault();

  const id = $("fieldId").value;
  const existing = fields.find(field => String(field.id) === String(id));

  const field = {
    name: $("fieldName").value.trim(),
    type: $("fieldType").value,
    options: $("fieldOptions").value
      .split(",").map(item => item.trim()).filter(Boolean),
    showForm: $("fieldInForm").checked,
    required: $("fieldRequired").checked,
    active: true,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!field.name) return;

  try {
    if (existing) {
      field.id = existing.id;
      await saveRecord("fields", field, existing.id);
    } else {
      const newId = await saveRecord("fields", field);
      field.id = newId;
    }

    resetFieldForm();
    await loadData();
    alert("Custom field saved.");
  } catch (error) {
    alert("Could not save field: " + error.message);
  }
});

function renderFieldList() {
  $("fieldList").innerHTML = fields.length
    ? fields.map(field => `
      <div class="field-item">
        <span>
          <strong>${safeText(field.name)}</strong>
          <small class="muted"> — ${safeText(field.type || "text")}</small>
        </span>
        <span class="action-cell">
          <button class="btn secondary small-btn" data-field-edit="${safeText(field.id)}">Edit</button>
          <button class="btn danger small-btn" data-field-delete="${safeText(field.id)}">Delete</button>
        </span>
      </div>
    `).join("")
    : `<p class="muted">No custom fields created.</p>`;
}

$("fieldList").addEventListener("click", async event => {
  const editButton = event.target.closest("[data-field-edit]");
  const deleteButton = event.target.closest("[data-field-delete]");

  if (editButton) {
    const field = fields.find(item =>
      String(item.id) === editButton.dataset.fieldEdit
    );
    if (!field) return;

    $("fieldId").value = field.id;
    $("fieldName").value = field.name || "";
    $("fieldType").value = field.type || "text";
    $("fieldOptions").value = (field.options || []).join(", ");
    $("fieldInForm").checked = field.showForm !== false;
    $("fieldRequired").checked = Boolean(field.required);
  }

  if (deleteButton) {
    const field = fields.find(item =>
      String(item.id) === deleteButton.dataset.fieldDelete
    );
    if (!field || !confirm(`Delete custom field "${field.name}"?`)) return;

    await deleteRecord("fields", field.id);
    await loadData();
  }
});

/* ---------------- BACKUP / RESTORE ---------------- */

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

$("exportBtn").addEventListener("click", async () => {
  try {
    const backup = {
      app: "TradeLedger",
      version: 1,
      exportedAt: new Date().toISOString(),
      trades: await readAll("trades"),
      fields: await readAll("fields")
    };

    downloadFile(
      "TradeLedger-Backup-" + today() + ".json",
      JSON.stringify(backup, null, 2),
      "application/json"
    );

    $("backupMessage").textContent = "Backup downloaded.";
  } catch (error) {
    alert("Backup failed: " + error.message);
  }
});

$("importBtn").addEventListener("click", async () => {
  const file = $("importFile").files[0];

  if (!file) {
    alert("Select a backup JSON file first.");
    return;
  }

  if (!confirm("Import this backup? Records with matching IDs may be updated.")) {
    return;
  }

  try {
    const backup = JSON.parse(await file.text());

    if (!Array.isArray(backup.trades) || !Array.isArray(backup.fields)) {
      throw new Error("Invalid TradeLedger backup file.");
    }

    for (const trade of backup.trades) {
      await saveRecord("trades", trade, trade.id);
    }

    for (const field of backup.fields) {
      await saveRecord("fields", field, field.id);
    }

    await loadData();
    $("backupMessage").textContent = "Backup imported successfully.";
  } catch (error) {
    alert("Import failed: " + error.message);
  }
});

/* ---------------- CSV EXPORT ---------------- */

function csvEscape(value) {
  const text = String(value ?? "");
  return '"' + text.replace(/"/g, '""') + '"';
}

$("exportJournalCsvBtn").addEventListener("click", () => {
  const columns = getColumns().filter(column => column.key !== "actions");
  const rows = [columns.map(column => csvEscape(column.label)).join(",")];

  trades.forEach(trade => {
    rows.push(columns.map(column =>
      csvEscape(cellValue(trade, column))
    ).join(","));
  });

  downloadFile(
    "TradeLedger-Journal-" + today() + ".csv",
    "\uFEFF" + rows.join("\n"),
    "text/csv;charset=utf-8"
  );
});

/* ---------------- START APP ---------------- */

async function startApp() {
  try {
    await openDatabase();
    await loadData();
    $("tradeDate").value = today();
    calculateTrade();
  } catch (error) {
    console.error(error);
    alert(
      "TradeLedger could not open its database.\n\n" +
      error.message +
      "\n\nDo not delete your browser data or IndexedDB."
    );
  }
}

startApp();

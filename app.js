
"use strict";

/* ==========================================
   TRADELEDGER
   Intraday + Swing + Long Term Navigation
   Google Drive Single-File Cloud Backup
   Existing IndexedDB database preserved
========================================== */

const $ = id => document.getElementById(id);
const DB_NAME = "TradeLedgerDB";
const SETTINGS_KEY = "TradeLedgerColumnSettings";
const DRIVE_CONNECTION_KEY = "TradeLedgerDriveConnection";

let db;
let trades = [];
let fields = [];
let editingTradeId = null;
let currentAttachments = [];
let currentTradingMode = "intraday";
let columnSettings;

const SECTION_INFO = {
  basic: { label:"Basic Details", container:"basicStandardFields", custom:"customBasicFields" },
  buy: { label:"Buy Details", container:"buyStandardFields", custom:"customBuyFields" },
  sell: { label:"Sell Details", container:"sellStandardFields", custom:"customSellFields" },
  pl: { label:"Profit & Loss", container:"plStandardFields", custom:"customPLFields" },
  attachments: { label:"Notes & Attachments", container:"attachmentsStandardFields", custom:"customAttachmentFields" }
};

const STANDARD_COLUMNS = [
  {key:"date",label:"Date",section:"basic",input:"tradeDate"},
  {key:"voucherNumber",label:"Voucher Number",section:"basic",input:"voucherNumber"},
  {key:"stockName",label:"Stock Name",section:"basic",input:"stockName"},
  {key:"capital",label:"Capital",section:"basic",input:"capital"},
  {key:"leverage",label:"Leverage",section:"basic",input:"leverage"},
  {key:"strategy",label:"Strategy",section:"basic",input:"strategy"},
  {key:"riskReward",label:"Risk Reward",section:"basic",input:"riskReward"},
  {key:"tradeResult",label:"Trade Result",section:"basic",input:"tradeResult"},

  {key:"buyQty",label:"Buy Qty",section:"buy",input:"buyQty"},
  {key:"buyPrice",label:"Buy Price",section:"buy",input:"buyPrice"},
  {key:"buyStockValue",label:"Buy Stock Value",section:"buy",input:"buyStockValue"},
  {key:"buyCharge",label:"Buy Charges",section:"buy",input:"buyCharge"},
  {key:"extraBuyCharge",label:"Extra Buy Charges",section:"buy",input:"extraBuyCharge"},
  {key:"totalBuyCharges",label:"Total Buy Charges",section:"buy",input:"totalBuyCharges"},
  {key:"totalBuyValue",label:"Total Buy Value",section:"buy",input:"totalBuyValue"},

  {key:"sellQty",label:"Sell Qty",section:"sell",input:"sellQty"},
  {key:"sellPrice",label:"Sell Price",section:"sell",input:"sellPrice"},
  {key:"sellStockValue",label:"Sell Stock Value",section:"sell",input:"sellStockValue"},
  {key:"sellCharge",label:"Sell Charges",section:"sell",input:"sellCharge"},
  {key:"extraSellCharge",label:"Extra Sell Charges",section:"sell",input:"extraSellCharge"},
  {key:"totalSellCharges",label:"Total Sell Charges",section:"sell",input:"totalSellCharges"},
  {key:"totalSellValue",label:"Total Sell Value",section:"sell",input:"totalSellValue"},
  {key:"priceMovement",label:"Price Movement",section:"sell",input:"priceMovement"},

  {key:"grossPL",label:"Gross P&L",section:"pl",input:"grossPLInput"},
  {key:"totalCharges",label:"Total Charges",section:"pl",input:"totalChargesInput"},
  {key:"netPL",label:"Net P&L",section:"pl",input:"netPLInput"},

  {key:"notes",label:"Trade Notes",section:"attachments",input:"notes"},
  {key:"attachments",label:"Attachments",section:"attachments",input:null}
];

const NUMERIC_KEYS = [
  "capital","buyPrice","buyStockValue","buyCharge",
  "extraBuyCharge","totalBuyCharges","totalBuyValue",
  "sellPrice","sellStockValue","sellCharge",
  "extraSellCharge","totalSellCharges","totalSellValue",
  "priceMovement","grossPL","totalCharges","netPL"
];

const num = value => Number(value) || 0;
const money = value => "₹" + num(value).toFixed(2);

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  })[character]);
}

function today() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0,10);
}

/* ---------------- COLUMN SETTINGS ---------------- */

function defaultSettings() {
  const result = {};

  STANDARD_COLUMNS.forEach((field,index) => {
    result[field.key] = {
      visible:true,
      showForm:true,
      section:field.section,
      order:index
    };
  });

  return result;
}

function getSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {...defaultSettings(),...saved};
  } catch {
    return defaultSettings();
  }
}

columnSettings = getSettings();

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY,JSON.stringify(columnSettings));
}

function getStandardSetting(field) {
  return columnSettings[field.key] || {
    visible:true,
    showForm:true,
    section:field.section,
    order:0
  };
}

function isStandardVisible(field) {
  return getStandardSetting(field).visible !== false;
}

function isStandardInForm(field) {
  return getStandardSetting(field).showForm !== false;
}

/* ---------------- DATABASE ---------------- */

function openDatabase() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(DB_NAME);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains("trades")) {
        database.createObjectStore("trades",{keyPath:"id",autoIncrement:true});
      }

      if (!database.objectStoreNames.contains("fields")) {
        database.createObjectStore("fields",{keyPath:"id",autoIncrement:true});
      }
    };

    request.onsuccess = () => {
      db = request.result;

      if (
        !db.objectStoreNames.contains("trades") ||
        !db.objectStoreNames.contains("fields")
      ) {
        reject(new Error("Required database stores are missing. Database was not reset."));
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
  return new Promise((resolve,reject) => {
    const tx = db.transaction(storeName,"readonly");
    const req = tx.objectStore(storeName).getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function saveRecord(storeName,record,existingKey) {
  return new Promise((resolve,reject) => {
    const tx = db.transaction(storeName,"readwrite");
    const store = tx.objectStore(storeName);
    const item = {...record};
    const keyPath = store.keyPath;
    let req;

    if (keyPath) {
      const keyName = Array.isArray(keyPath) ? keyPath[0] : keyPath;

      if (existingKey !== undefined && existingKey !== null) {
        item[keyName] = existingKey;
      }

      if (
        item[keyName] === undefined ||
        item[keyName] === null ||
        item[keyName] === ""
      ) {
        delete item[keyName];
      }

      req = store.put(item);
    } else {
      req = existingKey !== undefined && existingKey !== null
        ? store.put(item,existingKey)
        : store.add(item);
    }

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteRecord(storeName,id) {
  return new Promise((resolve,reject) => {
    const tx = db.transaction(storeName,"readwrite");
    const req = tx.objectStore(storeName).delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function loadData() {
  trades = await readAll("trades");
  fields = await readAll("fields");

  trades.sort((a,b) =>
    String(b.date || "").localeCompare(String(a.date || ""))
  );

  renderEverything();
}

/* ---------------- NAVIGATION ---------------- */

function showSection(sectionId) {
  document.querySelectorAll("#intradayWorkspace .section").forEach(section => {
    section.classList.toggle("active",section.id === sectionId);
  });

  document.querySelectorAll("#mainNavigation .nav-btn[data-section]").forEach(button => {
    button.classList.toggle("active",button.dataset.section === sectionId);
  });

  if (sectionId === "periodOverviewSection") {
    renderPeriodOverview();
  }
}

function setTradingMode(mode) {
  currentTradingMode = mode;

  const intradayWorkspace = $("intradayWorkspace");
  const swingWorkspace = $("swingWorkspace");
  const longtermWorkspace = $("longtermWorkspace");
  const backupWorkspace = $("backupWorkspace");
  const mainNavigation = $("mainNavigation");

  document.querySelectorAll("#modeNavigation [data-mode]").forEach(button => {
    button.classList.toggle("active",button.dataset.mode === mode);
  });

  intradayWorkspace.style.display = mode === "intraday" ? "" : "none";
  mainNavigation.style.display = mode === "intraday" ? "" : "none";

  swingWorkspace.classList.toggle("active",mode === "swing");
  longtermWorkspace.classList.toggle("active",mode === "longterm");
  backupWorkspace.classList.toggle("active",mode === "backup");

  if (mode === "intraday") {
    showSection("dashboardSection");
  }

  if (mode === "backup") {
    updateDriveConnectionDisplay();
  }
}

document.querySelectorAll("#modeNavigation [data-mode]").forEach(button => {
  button.addEventListener("click",() => setTradingMode(button.dataset.mode));
});

document.querySelectorAll("#mainNavigation .nav-btn[data-section]").forEach(button => {
  button.addEventListener("click",() => {
    if (currentTradingMode === "intraday") {
      showSection(button.dataset.section);
    }
  });
});

$("newTradeBtn").addEventListener("click",() => {
  setTradingMode("intraday");
  resetForm();
  showSection("tradeFormSection");
});

$("adminOpenBtn").addEventListener("click",() => {
  if (currentTradingMode === "intraday") openAdmin();
});

$("closeAdminBtn").addEventListener("click",closeAdmin);
$("closeViewBtn").addEventListener("click",closeView);

if ($("dashboardAddTradeBtn")) {
  $("dashboardAddTradeBtn").addEventListener("click",() => {
    resetForm();
    showSection("tradeFormSection");
  });
}

if ($("dashboardJournalBtn")) {
  $("dashboardJournalBtn").addEventListener("click",() => {
    showSection("tradeJournalSection");
  });
}

/* ---------------- CALCULATIONS ---------------- */

const calculationInputs = [
  "buyQty","buyPrice","buyCharge","extraBuyCharge",
  "sellQty","sellPrice","sellCharge","extraSellCharge"
];

function calculateTrade() {
  const buyQty = num($("buyQty").value);
  const buyPrice = num($("buyPrice").value);
  const sellQty = num($("sellQty").value);
  const sellPrice = num($("sellPrice").value);

  const buyValue = buyQty * buyPrice;
  const sellValue = sellQty * sellPrice;

  const buyCharges = num($("buyCharge").value) + num($("extraBuyCharge").value);
  const sellCharges = num($("sellCharge").value) + num($("extraSellCharge").value);
  const totalCharges = buyCharges + sellCharges;

  // Existing calculation retained.
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
  $(id).addEventListener("input",calculateTrade);
});

/* ---------------- PERIOD OVERVIEW ---------------- */

function renderPeriodOverview() {
  const start = $("periodStartDate").value;
  const end = $("periodEndDate").value;

  const grossEl = $("periodGrossPL");
  const chargeEl = $("periodTotalCharges");
  const netEl = $("periodNetPL");
  const message = $("periodMessage");

  grossEl.textContent = money(0);
  chargeEl.textContent = money(0);
  netEl.textContent = money(0);

  grossEl.className = "";
  chargeEl.className = "";
  netEl.className = "";

  if (!start || !end) {
    message.className = "period-message muted";
    message.textContent = "Select both Starting Date and Ending Date to view your results.";
    return;
  }

  if (start > end) {
    message.className = "period-message error";
    message.textContent = "Invalid date range. Starting Date cannot be after Ending Date.";
    return;
  }

  const selected = trades.filter(t =>
    t.date && t.date >= start && t.date <= end
  );

  const gross = selected.reduce((s,t) => s + num(t.grossPL),0);
  const charges = selected.reduce((s,t) => s + num(t.totalCharges),0);
  const net = selected.reduce((s,t) => s + num(t.netPL),0);

  grossEl.textContent = money(gross);
  chargeEl.textContent = money(charges);
  netEl.textContent = money(net);

  grossEl.className = gross > 0 ? "profit" : gross < 0 ? "loss" : "neutral";
  netEl.className = net > 0 ? "profit" : net < 0 ? "loss" : "neutral";

  message.className = "period-message muted";
  message.textContent =
    selected.length + (selected.length === 1 ? " trade" : " trades") +
    " found between " + start + " and " + end + ".";
}

$("periodStartDate").addEventListener("change",renderPeriodOverview);
$("periodEndDate").addEventListener("change",renderPeriodOverview);

/* ---------------- ATTACHMENTS ---------------- */

function fileToData(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve({
      name:file.name,
      type:file.type,
      size:file.size,
      dataUrl:reader.result
    });

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function collectAttachments() {
  const images = Array.from($("chartImages").files || []);
  const docs = Array.from($("contractNote").files || []);

  const newImages = await Promise.all(images.map(fileToData));
  const newDocs = await Promise.all(docs.map(fileToData));

  return [
    ...currentAttachments,
    ...newImages.map(f => ({...f,category:"Chart Image"})),
    ...newDocs.map(f => ({...f,category:"Contract Note"}))
  ];
}

function attachmentCount(trade) {
  return (trade.attachments || []).length +
    (trade.chartImages || []).length +
    (trade.contractNote || []).length;
}

/* ---------------- FIELD ORDER HELPERS ---------------- */

function getFieldSection(field) {
  return SECTION_INFO[field.section] ? field.section : "basic";
}

function tokenForStandard(key) {
  return "s:" + key;
}

function tokenForCustom(id) {
  return "c:" + id;
}

function getSectionEntries(section) {
  const entries = [];

  STANDARD_COLUMNS.forEach(field => {
    const setting = getStandardSetting(field);
    const assignedSection = SECTION_INFO[setting.section]
      ? setting.section
      : field.section;

    if (assignedSection === section) {
      entries.push({
        kind:"standard",
        key:field.key,
        label:field.label,
        section,
        token:tokenForStandard(field.key),
        order:Number(setting.order) || 0,
        visible:setting.visible !== false,
        showForm:setting.showForm !== false,
        definition:field
      });
    }
  });

  fields.forEach(field => {
    if (getFieldSection(field) !== section) return;

    entries.push({
      kind:"custom",
      id:field.id,
      key:"custom_" + field.id,
      label:field.name || "Custom Field",
      section,
      token:tokenForCustom(field.id),
      order:Number(field.order) || 0,
      visible:field.active !== false,
      showForm:field.showForm !== false,
      definition:field
    });
  });

  return entries.sort((a,b) => a.order - b.order);
}

function getAllEntries() {
  return Object.keys(SECTION_INFO).flatMap(section => getSectionEntries(section));
}

async function saveSectionOrder(section,entries) {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (entry.kind === "standard") {
      const setting = getStandardSetting(entry.definition);
      columnSettings[entry.key] = {...setting,section,order:i};
    } else {
      const field = fields.find(f => String(f.id) === String(entry.id));
      if (field) {
        field.section = section;
        field.order = i;
        await saveRecord("fields",field,field.id);
      }
    }
  }

  saveSettings();
}

async function saveAllSectionOrders() {
  for (const section of Object.keys(SECTION_INFO)) {
    await saveSectionOrder(section,getSectionEntries(section));
  }
}

/* ---------------- PRICE MOVEMENT LOCATION ---------------- */

async function normalizePriceMovementLocation() {
  const field = STANDARD_COLUMNS.find(f => f.key === "priceMovement");
  if (!field) return;

  const setting = getStandardSetting(field);

  columnSettings.priceMovement = {
    ...setting,
    section:"sell",
    order:999999
  };

  const entries = getSectionEntries("sell");
  const movement = entries.find(e => e.token === tokenForStandard("priceMovement"));
  const others = entries.filter(e => e.token !== tokenForStandard("priceMovement"));

  if (movement) others.push(movement);

  await saveSectionOrder("sell",others);
}

/* ---------------- DYNAMIC FORM LAYOUT ---------------- */

function makeCustomInput(field,value) {
  let input;

  if (field.type === "dropdown" || field.type === "select") {
    input = document.createElement("select");

    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Select";
    input.appendChild(first);

    (field.options || []).forEach(option => {
      const opt = document.createElement("option");
      opt.value = option;
      opt.textContent = option;
      input.appendChild(opt);
    });

    input.value = value ?? "";

  } else if (field.type === "checkbox") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(value);
  } else {
    input = document.createElement("input");
    input.type = ["text","number","date"].includes(field.type)
      ? field.type
      : "text";
    input.value = value ?? "";
    input.placeholder = field.placeholder || "";
  }

  input.id = "custom_" + field.id;
  if (field.required) input.required = true;

  return input;
}

function getStandardLabel(field) {
  if (field.key === "attachments") {
    return [
      $("chartImages").closest("label"),
      $("contractNote").closest("label")
    ];
  }

  const input = $(field.input);
  return input ? [input.closest("label")] : [];
}

function renderFormLayout(values = {}) {
  const containers = {};
  const customContainers = {};

  Object.keys(SECTION_INFO).forEach(section => {
    containers[section] = $(SECTION_INFO[section].container);
    customContainers[section] = $(SECTION_INFO[section].custom);
    customContainers[section].innerHTML = "";
  });

  Object.keys(SECTION_INFO).forEach(section => {
    const entries = getSectionEntries(section);

    entries.forEach(entry => {
      if (entry.kind === "standard") {
        const labels = getStandardLabel(entry.definition);

        labels.forEach(label => {
          if (!label) return;

          if (!entry.showForm) {
            label.style.display = "none";
          } else {
            label.style.display = "";
            containers[section].appendChild(label);
          }
        });

      } else {
        const field = fields.find(f => String(f.id) === String(entry.id));

        if (!field || field.active === false || field.showForm === false) return;

        const label = document.createElement("label");
        label.appendChild(document.createTextNode(field.name || "Custom Field"));
        label.appendChild(makeCustomInput(field,values[field.id]));

        customContainers[section].appendChild(label);
      }
    });
  });

  STANDARD_COLUMNS.forEach(field => {
    if (isStandardInForm(field)) return;

    getStandardLabel(field).forEach(label => {
      if (label) label.style.display = "none";
    });
  });
}

function renderCustomFormFields(values = {}) {
  renderFormLayout(values);
}

/* ---------------- FORM DATA ---------------- */

function getFormValue(id) {
  const element = $(id);
  return element ? element.value : "";
}

function collectTradeData() {
  calculateTrade();

  const data = {
    date:getFormValue("tradeDate"),
    voucherNumber:getFormValue("voucherNumber"),
    stockName:getFormValue("stockName").trim(),
    capital:num(getFormValue("capital")),
    leverage:getFormValue("leverage"),
    strategy:getFormValue("strategy"),
    riskReward:getFormValue("riskReward"),
    tradeResult:getFormValue("tradeResult"),

    buyQty:num(getFormValue("buyQty")),
    buyPrice:num(getFormValue("buyPrice")),
    buyStockValue:num(getFormValue("buyStockValue")),
    buyCharge:num(getFormValue("buyCharge")),
    extraBuyCharge:num(getFormValue("extraBuyCharge")),
    totalBuyCharges:num(getFormValue("totalBuyCharges")),
    totalBuyValue:num(getFormValue("totalBuyValue")),

    sellQty:num(getFormValue("sellQty")),
    sellPrice:num(getFormValue("sellPrice")),
    sellStockValue:num(getFormValue("sellStockValue")),
    sellCharge:num(getFormValue("sellCharge")),
    extraSellCharge:num(getFormValue("extraSellCharge")),
    totalSellCharges:num(getFormValue("totalSellCharges")),
    totalSellValue:num(getFormValue("totalSellValue")),

    priceMovement:num(getFormValue("priceMovement")),
    grossPL:num(getFormValue("grossPLInput")),
    totalCharges:num(getFormValue("totalChargesInput")),
    netPL:num(getFormValue("netPLInput")),

    notes:getFormValue("notes"),
    customFields:{},
    attachments:[]
  };

  fields.forEach(field => {
    const input = $("custom_" + field.id);

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
    data.attachments = await collectAttachments();

    const existing = editingTradeId !== null
      ? trades.find(t => String(t.id) === String(editingTradeId))
      : null;

    if (existing) {
      data.id = existing.id;
      data.createdAt = existing.createdAt || new Date().toISOString();
    } else {
      data.createdAt = new Date().toISOString();
    }

    data.updatedAt = new Date().toISOString();

    const key = await saveRecord("trades",data,existing?.id);

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

$("tradeForm").addEventListener("submit",saveTrade);

function resetForm() {
  $("tradeForm").reset();
  $("tradeDate").value = today();
  $("tradeId").value = "";

  editingTradeId = null;
  currentAttachments = [];

  $("attachmentInfo").textContent = "";
  $("formHeading").textContent = "Add New Trade";
  $("saveTradeBtn").textContent = "Save Trade";

  renderFormLayout({});
  calculateTrade();
}

$("resetTradeBtn").addEventListener("click",resetForm);

/* ---------------- JOURNAL COLUMNS ---------------- */

function getColumns() {
  const columns = [];

  Object.keys(SECTION_INFO).forEach(section => {
    getSectionEntries(section).forEach(entry => {
      if (!entry.visible) return;

      if (entry.kind === "standard") {
        columns.push({
          key:entry.key,
          label:entry.label,
          section
        });
      } else {
        columns.push({
          key:entry.key,
          label:entry.label,
          customId:entry.id,
          section
        });
      }
    });
  });

  columns.push({key:"actions",label:"Actions"});
  return columns;
}

function cellValue(trade,column) {
  if (column.key === "attachments") {
    return attachmentCount(trade);
  }

  if (column.key.startsWith("custom_")) {
    return trade.customFields?.[column.customId] ?? "";
  }

  const value = trade[column.key];

  return NUMERIC_KEYS.includes(column.key)
    ? money(value)
    : value ?? "";
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
    "<tr>" +
    columns.map(c => `<th>${safeText(c.label)}</th>`).join("") +
    "</tr>";

  if (!filtered.length) {
    $("journalBody").innerHTML =
      `<tr><td class="empty" colspan="${columns.length}">No trades found.</td></tr>`;
    return;
  }

  $("journalBody").innerHTML = filtered.map(trade => {
    const cells = columns.map(column => {
      if (column.key === "actions") {
        return `
          <td>
            <div class="action-cell">
              <button class="btn secondary small-btn" data-action="view" data-id="${safeText(trade.id)}">View</button>
              <button class="btn secondary small-btn" data-action="edit" data-id="${safeText(trade.id)}">Edit</button>
              <button class="btn danger small-btn" data-action="delete" data-id="${safeText(trade.id)}">Delete</button>
            </div>
          </td>`;
      }

      const value = cellValue(trade,column);
      let cls = "";

      if (column.key === "netPL" || column.key === "grossPL") {
        const amount = num(trade[column.key]);
        cls = amount > 0 ? "profit" : amount < 0 ? "loss" : "neutral";
      }

      if (column.key === "tradeResult") {
        cls = value === "Win" ? "profit" : value === "Lose" ? "loss" : "neutral";
      }

      return `<td class="${cls}">${safeText(value)}</td>`;
    }).join("");

    return `<tr>${cells}</tr>`;
  }).join("");
}

$("journalSearch").addEventListener("input",renderJournal);

$("journalBody").addEventListener("click",async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const trade = trades.find(t => String(t.id) === button.dataset.id);
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
    tradeDate:"date",
    voucherNumber:"voucherNumber",
    stockName:"stockName",
    capital:"capital",
    leverage:"leverage",
    strategy:"strategy",
    riskReward:"riskReward",
    tradeResult:"tradeResult",
    buyQty:"buyQty",
    buyPrice:"buyPrice",
    buyCharge:"buyCharge",
    extraBuyCharge:"extraBuyCharge",
    sellQty:"sellQty",
    sellPrice:"sellPrice",
    sellCharge:"sellCharge",
    extraSellCharge:"extraSellCharge",
    notes:"notes"
  };

  Object.entries(map).forEach(([elementId,key]) => {
    $(elementId).value = trade[key] ?? "";
  });

  currentAttachments = [...(trade.attachments || [])];

  $("attachmentInfo").textContent =
    currentAttachments.length + " existing attachment(s) retained.";

  renderFormLayout(trade.customFields || {});
  calculateTrade();

  $("formHeading").textContent = "Edit Trade";
  $("saveTradeBtn").textContent = "Update Trade";

  setTradingMode("intraday");
  showSection("tradeFormSection");

  window.scrollTo({top:0,behavior:"smooth"});
}

async function removeTrade(trade) {
  if (!confirm(
    `Delete trade ${trade.stockName || ""}? This cannot be undone.`
  )) return;

  try {
    await deleteRecord("trades",trade.id);
    await loadData();
  } catch (error) {
    alert("Delete failed: " + error.message);
  }
}

function viewTrade(trade) {
  const details = [];

  getColumns().filter(c =>
    c.key !== "actions" && c.key !== "attachments"
  ).forEach(column => {
    let value = column.key.startsWith("custom_")
      ? trade.customFields?.[column.customId] ?? ""
      : trade[column.key] ?? "";

    if (NUMERIC_KEYS.includes(column.key)) {
      value = money(value);
    }

    details.push(`
      <div class="detail-item">
        <small>${safeText(column.label)}</small>
        <strong>${safeText(value)}</strong>
      </div>
    `);
  });

  const attachments = [
    ...(trade.attachments || []),
    ...(trade.chartImages || []),
    ...(trade.contractNote || [])
  ];

  const attachmentHtml = attachments.map(file => {
    const url = file.dataUrl || file.url || "";
    const name = file.name || "Attachment";

    return `
      <div class="detail-item">
        <small>${safeText(file.category || "Attachment")}</small>
        ${
          url
            ? `<a href="${safeText(url)}" target="_blank" rel="noopener">${safeText(name)}</a>`
            : safeText(name)
        }
      </div>
    `;
  }).join("");

  $("viewTradeContent").innerHTML = `
    <div class="detail-grid">${details.join("")}</div>
    <h3 style="margin-top:20px">Attachments</h3>
    <div class="detail-grid">${attachmentHtml || "<p>No attachments.</p>"}</div>
    <h3 style="margin-top:20px">Notes</h3>
    <div class="detail-item">${safeText(trade.notes || "No notes")}</div>
  `;

  $("viewModal").classList.add("open");
  $("viewModal").setAttribute("aria-hidden","false");
}

function closeView() {
  $("viewModal").classList.remove("open");
  $("viewModal").setAttribute("aria-hidden","true");
}

/* ---------------- DASHBOARD ---------------- */

function renderDashboard() {
  const total = trades.length;
  const wins = trades.filter(t => t.tradeResult === "Win").length;
  const losses = trades.filter(t => t.tradeResult === "Lose").length;

  const gross = trades.reduce((s,t) => s + num(t.grossPL),0);
  const charges = trades.reduce((s,t) => s + num(t.totalCharges),0);
  const net = trades.reduce((s,t) => s + num(t.netPL),0);

  const rate = total ? wins / total * 100 : 0;

  $("totalTrades").textContent = total;
  $("winningTrades").textContent = wins;
  $("losingTrades").textContent = losses;
  $("winRate").textContent = rate.toFixed(1) + "%";

  $("grossPL").textContent = money(gross);
  $("totalCharges").textContent = money(charges);
  $("netPL").textContent = money(net);

  $("grossPL").className = gross >= 0 ? "profit" : "loss";
  $("netPL").className = net >= 0 ? "profit" : "loss";
}

function renderEverything() {
  renderDashboard();
  renderJournal();
  renderPeriodOverview();
  renderFormLayout({});
  renderFieldList();
}

/* ---------------- FIELD MANAGER ---------------- */

function openAdmin() {
  $("adminPanel").classList.add("open");
  $("adminPanel").setAttribute("aria-hidden","false");
  renderFieldList();
}

function closeAdmin() {
  $("adminPanel").classList.remove("open");
  $("adminPanel").setAttribute("aria-hidden","true");
}

function resetFieldForm() {
  $("fieldForm").reset();
  $("fieldId").value = "";
  $("fieldInForm").checked = true;
  $("fieldRequired").checked = false;
  $("fieldPosition").value = "1";
  $("fieldSection").value = "basic";
}

$("cancelFieldEdit").addEventListener("click",resetFieldForm);

$("fieldForm").addEventListener("submit",async event => {
  event.preventDefault();

  const id = $("fieldId").value;
  const existing = fields.find(f => String(f.id) === String(id));
  const section = $("fieldSection").value;

  const field = {
    ...(existing || {}),
    name:$("fieldName").value.trim(),
    placeholder:$("fieldPlaceholder").value.trim(),
    type:$("fieldType").value,
    section,
    options:$("fieldOptions").value.split(",").map(x => x.trim()).filter(Boolean),
    showForm:$("fieldInForm").checked,
    required:$("fieldRequired").checked,
    active:true,
    createdAt:existing?.createdAt || new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };

  if (!field.name) return alert("Please enter a Field Name.");

  try {
    if (existing) {
      field.id = existing.id;
      await saveRecord("fields",field,existing.id);
      fields = fields.map(f =>
        String(f.id) === String(field.id) ? field : f
      );
    } else {
      field.id = await saveRecord("fields",field);
      fields.push(field);
    }

    const oldSection = existing ? getFieldSection(existing) : null;

    if (oldSection && oldSection !== section) {
      await saveSectionOrder(
        oldSection,
        getSectionEntries(oldSection).filter(e =>
          e.token !== tokenForCustom(field.id)
        )
      );
    }

    const target = getSectionEntries(section).filter(e =>
      e.token !== tokenForCustom(field.id)
    );

    const position = Math.max(
      1,
      Number($("fieldPosition").value) || target.length + 1
    );

    target.splice(Math.min(position - 1,target.length),0,{
      kind:"custom",
      id:field.id,
      token:tokenForCustom(field.id),
      definition:field
    });

    await saveSectionOrder(section,target);
    resetFieldForm();
    await loadData();

    alert(existing ? "Custom field updated." : "Custom field added.");

  } catch (error) {
    console.error(error);
    alert("Could not save field: " + (error.message || error));
  }
});

function renderFieldList() {
  const list = $("fieldList");
  let html = "";

  Object.keys(SECTION_INFO).forEach(section => {
    const entries = getSectionEntries(section);

    html += `<h3 class="field-section-heading">${safeText(SECTION_INFO[section].label)}</h3>`;

    if (!entries.length) {
      html += `<p class="muted small">No fields in this section.</p>`;
      return;
    }

    html += entries.map(entry => {
      const hidden = !entry.visible;
      const kind = entry.kind === "standard" ? "Standard Column" : "Custom Field";
      const pos = getFieldPosition(entry);

      return `
        <div class="field-item ${hidden ? "hidden-field" : ""}">
          <div class="field-item-info">
            <strong>${safeText(entry.label)}</strong>
            <small>${kind} · Position ${pos} · ${hidden ? "Hidden" : "Visible"}</small>
            <span class="field-kind">${entry.showForm ? "Form: Shown" : "Form: Hidden"}</span>
          </div>
          <div class="field-item-actions">
            ${entry.kind === "custom" ? `
              <button class="btn secondary small-btn" data-edit-custom="${safeText(entry.id)}">Edit</button>
            ` : ""}
            <button class="btn secondary small-btn" data-move="top" data-token="${safeText(entry.token)}">⇈</button>
            <button class="btn secondary small-btn" data-move="up" data-token="${safeText(entry.token)}">↑</button>
            <button class="btn secondary small-btn" data-move="down" data-token="${safeText(entry.token)}">↓</button>
            <button class="btn secondary small-btn" data-move="bottom" data-token="${safeText(entry.token)}">⇊</button>
            <button class="btn ${hidden ? "primary" : "danger"} small-btn" data-toggle-field="${safeText(entry.token)}">
              ${hidden ? "Restore" : "Delete / Hide"}
            </button>
          </div>
        </div>
      `;
    }).join("");
  });

  list.innerHTML = html;
}

function getFieldPosition(entry) {
  const entries = getSectionEntries(entry.section);
  return entries.findIndex(e => e.token === entry.token) + 1;
}

function findEntry(token) {
  return getAllEntries().find(entry => entry.token === token);
}

async function moveEntry(token,direction) {
  const entry = findEntry(token);
  if (!entry) return;

  const section = entry.section;
  const entries = getSectionEntries(section);
  const index = entries.findIndex(e => e.token === token);
  if (index < 0) return;

  const [moving] = entries.splice(index,1);
  let newIndex = index;

  if (direction === "top") newIndex = 0;
  if (direction === "bottom") newIndex = entries.length;
  if (direction === "up") newIndex = Math.max(0,index - 1);
  if (direction === "down") newIndex = Math.min(entries.length,index + 1);

  entries.splice(newIndex,0,moving);

  try {
    await saveSectionOrder(section,entries);
    await loadData();
  } catch (error) {
    alert("Could not change position: " + error.message);
  }
}

async function toggleEntry(token) {
  const entry = findEntry(token);
  if (!entry) return;

  const hide = entry.visible;

  if (
    hide &&
    !confirm(
      `Hide "${entry.label}"?\n\nIt will disappear from the form and journal. Previously saved trade values will be retained.`
    )
  ) return;

  if (entry.kind === "standard") {
    const setting = getStandardSetting(entry.definition);

    columnSettings[entry.key] = {
      ...setting,
      visible:!hide,
      showForm:!hide ? true : false
    };

    saveSettings();

  } else {
    const field = fields.find(f => String(f.id) === String(entry.id));
    if (!field) return;

    field.active = !hide;
    field.showForm = !hide;
    field.updatedAt = new Date().toISOString();

    await saveRecord("fields",field,field.id);
  }

  await loadData();
}

$("fieldList").addEventListener("click",async event => {
  const move = event.target.closest("[data-move]");
  const toggle = event.target.closest("[data-toggle-field]");
  const edit = event.target.closest("[data-edit-custom]");

  if (move) {
    await moveEntry(move.dataset.token,move.dataset.move);
    return;
  }

  if (toggle) {
    await toggleEntry(toggle.dataset.toggleField);
    return;
  }

  if (edit) {
    const field = fields.find(f => String(f.id) === edit.dataset.editCustom);
    if (!field) return;

    $("fieldId").value = field.id;
    $("fieldName").value = field.name || "";
    $("fieldPlaceholder").value = field.placeholder || "";
    $("fieldType").value = field.type || "text";
    $("fieldSection").value = getFieldSection(field);

    $("fieldPosition").value =
      getSectionEntries(getFieldSection(field))
        .findIndex(e => e.token === tokenForCustom(field.id)) + 1;

    $("fieldOptions").value = (field.options || []).join(", ");
    $("fieldInForm").checked = field.showForm !== false;
    $("fieldRequired").checked = Boolean(field.required);
    $("fieldName").focus();
  }
});

/* ---------------- FILE DOWNLOAD HELPER ---------------- */

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

/* ---------------- CSV EXPORT ---------------- */

function csvEscape(value) {
  return '"' + String(value ?? "").replace(/"/g,'""') + '"';
}

$("exportJournalCsvBtn").addEventListener("click",() => {
  const columns = getColumns().filter(c => c.key !== "actions");

  const rows = [
    columns.map(c => csvEscape(c.label)).join(",")
  ];

  trades.forEach(trade => {
    rows.push(
      columns.map(c => csvEscape(cellValue(trade,c))).join(",")
    );
  });

  downloadFile(
    "TradeLedger-Journal-" + today() + ".csv",
    "\uFEFF" + rows.join("\n"),
    "text/csv;charset=utf-8"
  );
});

/* ---------------- BACKUP DATA ---------------- */

async function createDriveBackupData() {
  return {
    app:"TradeLedger",
    version:3,
    exportedAt:new Date().toISOString(),
    trades:await readAll("trades"),
    fields:await readAll("fields"),
    columnSettings:JSON.parse(JSON.stringify(columnSettings))
  };
}

function validateBackup(backup) {
  if (
    !backup ||
    backup.app !== "TradeLedger" ||
    !Array.isArray(backup.trades) ||
    !Array.isArray(backup.fields)
  ) {
    throw new Error("Invalid TradeLedger backup file.");
  }

  return true;
}

/*
  Full Restore:
  - Clears and restores existing trades and fields stores.
  - Does NOT delete or recreate the IndexedDB database.
  - Keeps the existing database and its object stores.
*/

function applyFullBackupToDatabase(backup) {
  return new Promise((resolve,reject) => {
    try {
      validateBackup(backup);
    } catch (error) {
      reject(error);
      return;
    }

    let tx;

    try {
      tx = db.transaction(["trades","fields"],"readwrite");

      const tradeStore = tx.objectStore("trades");
      const fieldStore = tx.objectStore("fields");

      tradeStore.clear();
      fieldStore.clear();

      backup.trades.forEach(record => {
        tradeStore.put({...record});
      });

      backup.fields.forEach(record => {
        fieldStore.put({...record});
      });

    } catch (error) {
      reject(error);
      return;
    }

    tx.oncomplete = () => {
      try {
        if (
          backup.columnSettings &&
          typeof backup.columnSettings === "object" &&
          !Array.isArray(backup.columnSettings)
        ) {
          columnSettings = {
            ...defaultSettings(),
            ...backup.columnSettings
          };
        } else {
          columnSettings = defaultSettings();
        }

        saveSettings();
        resolve();

      } catch (error) {
        reject(error);
      }
    };

    tx.onerror = () => {
      reject(tx.error || new Error("Restore transaction failed."));
    };

    tx.onabort = () => {
      reject(tx.error || new Error("Restore transaction was cancelled."));
    };
  });
}

/* ==========================================
   GOOGLE DRIVE CLOUD BACKUP
========================================== */

const GOOGLE_CLIENT_ID =
  "396461936533-pofda319pj3k3rr9iundh7nnnnjtt6u5.apps.googleusercontent.com";

const GOOGLE_DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

const DRIVE_FOLDER_NAME = "TradeLedger Backups";
const DRIVE_BACKUP_FILENAME = "TradeLedger-Backup.json";

let driveTokenClient = null;
let driveAccessToken = null;
let driveFolderId = null;
let driveBackupFileId = null;
let driveScriptPromise = null;

/* ---------- CONNECTION METADATA ---------- */

function getDriveConnection() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(DRIVE_CONNECTION_KEY) || "null"
    );

    return saved && saved.connected === true ? saved : null;
  } catch {
    return null;
  }
}

function saveDriveConnection(data) {
  const connection = {
    connected:true,
    folderId:data.folderId || null,
    backupFileId:data.backupFileId || null,
    connectedAt:data.connectedAt || new Date().toISOString()
  };

  localStorage.setItem(
    DRIVE_CONNECTION_KEY,
    JSON.stringify(connection)
  );

  return connection;
}

function updateDriveConnectionDisplay() {
  const connection = getDriveConnection();

  if (connection) {
    driveFolderId = connection.folderId || null;
    driveBackupFileId = connection.backupFileId || null;

    $("driveStatus").textContent =
      "Connected on this device. Google Drive sign-in may be required for the next backup or restore.";

    $("driveBackupInfo").textContent = driveBackupFileId
      ? "Backup file: " + DRIVE_BACKUP_FILENAME
      : "No TradeLedger backup file has been created yet.";

  } else {
    $("driveStatus").textContent = "Google Drive not connected.";
    $("driveBackupInfo").textContent = "Connect Google Drive to begin.";
  }
}

/* ---------- LOAD GOOGLE SIGN-IN LIBRARY ---------- */

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (driveScriptPromise) {
    return driveScriptPromise;
  }

  driveScriptPromise = new Promise((resolve,reject) => {
    const existingScript = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]'
    );

    const script = existingScript || document.createElement("script");

    script.onload = () => {
      if (window.google?.accounts?.oauth2) {
        resolve();
      } else {
        driveScriptPromise = null;
        reject(new Error("Google authentication library did not load."));
      }
    };

    script.onerror = () => {
      driveScriptPromise = null;
      reject(new Error("Could not load Google authentication."));
    };

    if (!existingScript) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  return driveScriptPromise;
}

/* ---------- REQUEST ACCESS TOKEN ---------- */

async function requestDriveAccessToken(promptValue = "") {
  await loadGoogleIdentityScript();

  return new Promise((resolve,reject) => {
    try {
      driveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id:GOOGLE_CLIENT_ID,
        scope:GOOGLE_DRIVE_SCOPE,

        callback:response => {
          if (response.error || !response.access_token) {
            driveAccessToken = null;

            reject(new Error(
              response.error_description ||
              response.error ||
              "Google authentication failed."
            ));

            return;
          }

          driveAccessToken = response.access_token;
          resolve(response.access_token);
        },

        error_callback:error => {
          reject(new Error(
            error.message || "Google authentication was cancelled."
          ));
        }
      });

      driveTokenClient.requestAccessToken({
        prompt:promptValue
      });

    } catch (error) {
      reject(error);
    }
  });
}

/* ---------- ENSURE TOKEN BEFORE DRIVE ACTION ---------- */

async function ensureDriveAccess() {
  if (driveAccessToken) return driveAccessToken;

  if (!getDriveConnection()) {
    throw new Error("Connect Google Drive first.");
  }

  $("driveStatus").textContent =
    "Refreshing Google Drive session...";

  try {
    await requestDriveAccessToken("");

    $("driveStatus").textContent =
      "Google Drive session ready.";

    return driveAccessToken;

  } catch (error) {
    $("driveStatus").textContent =
      "Google Drive session expired. Please click Connect Google Drive.";

    throw new Error(
      "Google Drive needs reconnection. Click Connect Google Drive and try again."
    );
  }
}

/* ---------- CONNECT GOOGLE DRIVE ---------- */

async function connectGoogleDrive() {
  const status = $("driveStatus");
  const message = $("driveMessage");
  const button = $("connectDriveBtn");

  button.disabled = true;
  status.textContent = "Connecting to Google Drive...";
  message.textContent = "";

  try {
    await requestDriveAccessToken("");

    const folderId = await getDriveBackupFolder();

    const oldConnection = getDriveConnection();

    saveDriveConnection({
      folderId,
      backupFileId:oldConnection?.backupFileId || driveBackupFileId,
      connectedAt:oldConnection?.connectedAt || new Date().toISOString()
    });

    status.textContent = "Google Drive connected on this device.";
    message.textContent =
      "Connection saved. You can now back up or restore your journal.";

    await findCanonicalBackupFile();

  } catch (error) {
    console.error(error);

    status.textContent = "Google Drive connection failed.";
    message.textContent = error.message;

  } finally {
    button.disabled = false;
  }
}

/* ---------- DISCONNECT GOOGLE DRIVE ---------- */

function disconnectGoogleDrive() {
  const oldToken = driveAccessToken;

  if (oldToken && window.google?.accounts?.oauth2) {
    try {
      google.accounts.oauth2.revoke(oldToken,() => {});
    } catch (error) {
      console.warn("Token revoke was not completed:",error);
    }
  }

  driveAccessToken = null;
  driveFolderId = null;
  driveBackupFileId = null;
  driveTokenClient = null;

  localStorage.removeItem(DRIVE_CONNECTION_KEY);

  $("driveStatus").textContent = "Google Drive disconnected.";
  $("driveBackupInfo").textContent = "Connect Google Drive to begin.";
  $("driveMessage").textContent = "";
  $("driveBackupList").value = "";

}

/* ---------- GOOGLE DRIVE API REQUEST ---------- */

async function driveRequest(url,options = {},retry = true) {
  if (!driveAccessToken) {
    await ensureDriveAccess();
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization","Bearer " + driveAccessToken);

  const response = await fetch(url,{
    ...options,
    headers
  });

  if (response.status === 401 && retry) {
    driveAccessToken = null;

    await ensureDriveAccess();

    return driveRequest(url,options,false);
  }

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = errorText;

    try {
      const parsed = JSON.parse(errorText);
      errorMessage = parsed.error?.message || errorText;
    } catch {}

    throw new Error(
      "Drive API error (" + response.status + "): " + errorMessage
    );
  }

  return response;
}

/* ---------- FIND OR CREATE DRIVE FOLDER ---------- */

async function getDriveBackupFolder() {
  if (driveFolderId) return driveFolderId;

  const saved = getDriveConnection();

  if (saved?.folderId) {
    driveFolderId = saved.folderId;
    return driveFolderId;
  }

  const query =
    "name = '" + DRIVE_FOLDER_NAME + "'" +
    " and mimeType = 'application/vnd.google-apps.folder'" +
    " and trashed = false";

  const searchUrl =
    "https://www.googleapis.com/drive/v3/files" +
    "?q=" + encodeURIComponent(query) +
    "&fields=files(id,name)" +
    "&pageSize=100";

  const searchResponse = await driveRequest(searchUrl);
  const searchData = await searchResponse.json();

  if (searchData.files?.length) {
    driveFolderId = searchData.files[0].id;
    return driveFolderId;
  }

  const createResponse = await driveRequest(
    "https://www.googleapis.com/drive/v3/files",
    {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        name:DRIVE_FOLDER_NAME,
        mimeType:"application/vnd.google-apps.folder"
      })
    }
  );

  const folder = await createResponse.json();

  if (!folder.id) {
    throw new Error("Could not create the backup folder.");
  }

  driveFolderId = folder.id;
  return driveFolderId;
}

/* ---------- FIND CANONICAL BACKUP FILE ---------- */

async function findCanonicalBackupFile() {
  const folderId = await getDriveBackupFolder();

  const query =
    "'" + folderId + "' in parents" +
    " and name = '" + DRIVE_BACKUP_FILENAME + "'" +
    " and trashed = false";

  const url =
    "https://www.googleapis.com/drive/v3/files" +
    "?q=" + encodeURIComponent(query) +
    "&pageSize=100" +
    "&fields=files(id,name,modifiedTime,size)";

  const response = await driveRequest(url);
  const data = await response.json();

  const file = data.files?.[0] || null;

  driveBackupFileId = file?.id || null;

  const oldConnection = getDriveConnection();

  saveDriveConnection({
    folderId,
    backupFileId:driveBackupFileId,
    connectedAt:oldConnection?.connectedAt || new Date().toISOString()
  });

  $("driveBackupList").value = driveBackupFileId || "";

  if (file) {
    const modified = file.modifiedTime
      ? new Date(file.modifiedTime).toLocaleString()
      : "Date unavailable";

    $("driveBackupInfo").textContent =
      DRIVE_BACKUP_FILENAME + " · Last modified: " + modified;
  } else {
    $("driveBackupInfo").textContent =
      "No backup file found yet. Use Backup to Drive to create it.";
  }

  return file;
}

/* ---------- CREATE OR UPDATE SINGLE BACKUP FILE ---------- */

async function uploadDriveBackup() {
  const button = $("driveBackupBtn");
  const message = $("driveMessage");

  button.disabled = true;
  message.textContent = "Preparing backup...";

  try {
    await ensureDriveAccess();

    const folderId = await getDriveBackupFolder();
    const existingFile = await findCanonicalBackupFile();

    const backup = await createDriveBackupData();
    const json = JSON.stringify(backup);
    const blob = new Blob([json],{type:"application/json"});

    message.textContent =
      "Uploading backup (" +
      (blob.size / 1024 / 1024).toFixed(2) +
      " MB)...";

    let uploadStartUrl;
    let metadata;

    if (existingFile) {
      // Update the same existing backup file.
      uploadStartUrl =
        "https://www.googleapis.com/upload/drive/v3/files/" +
        encodeURIComponent(existingFile.id) +
        "?uploadType=resumable";

      metadata = {
        name:DRIVE_BACKUP_FILENAME,
        mimeType:"application/json"
      };

    } else {
      // Create the canonical file only if it does not exist.
      uploadStartUrl =
        "https://www.googleapis.com/upload/drive/v3/files" +
        "?uploadType=resumable";

      metadata = {
        name:DRIVE_BACKUP_FILENAME,
        mimeType:"application/json",
        parents:[folderId]
      };
    }

    const startResponse = await driveRequest(
      uploadStartUrl,
      {
        method:existingFile ? "PATCH" : "POST",
        headers:{
          "Content-Type":"application/json; charset=UTF-8",
          "X-Upload-Content-Type":"application/json",
          "X-Upload-Content-Length":String(blob.size)
        },
        body:JSON.stringify(metadata)
      }
    );

    const uploadUrl = startResponse.headers.get("Location");

    if (!uploadUrl) {
      throw new Error("Google Drive did not return an upload URL.");
    }

    const uploadResponse = await driveRequest(
      uploadUrl,
      {
        method:"PUT",
        headers:{
          "Content-Type":"application/json"
        },
        body:blob
      }
    );

    const uploadedFile = await uploadResponse.json();

    if (!uploadedFile.id) {
      throw new Error("Drive did not confirm the uploaded backup.");
    }

    driveBackupFileId = uploadedFile.id;

    const oldConnection = getDriveConnection();

    saveDriveConnection({
      folderId,
      backupFileId:uploadedFile.id,
      connectedAt:oldConnection?.connectedAt || new Date().toISOString()
    });

    $("driveBackupList").value = uploadedFile.id;

    const modified = uploadedFile.modifiedTime
      ? new Date(uploadedFile.modifiedTime).toLocaleString()
      : new Date().toLocaleString();

    $("driveBackupInfo").textContent =
      DRIVE_BACKUP_FILENAME + " · Last modified: " + modified;

    message.textContent =
      "Backup completed successfully. The same Google Drive backup file was updated.";

  } catch (error) {
    console.error(error);
    message.textContent = "Drive backup failed: " + error.message;

  } finally {
    button.disabled = false;
  }
}

/* ---------- RESTORE FROM GOOGLE DRIVE ---------- */

async function downloadDriveBackup(fileId) {
  if (!fileId) {
    throw new Error("No TradeLedger backup file was found.");
  }

  const url =
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(fileId) +
    "?alt=media";

  const response = await driveRequest(url);
  const text = await response.text();

  let backup;

  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error("The Drive backup file is not valid JSON.");
  }

  validateBackup(backup);
  return backup;
}

async function restoreDriveBackup() {
  const message = $("driveMessage");
  const button = $("restoreDriveBackupBtn");

  if (!getDriveConnection()) {
    alert("Connect Google Drive first.");
    return;
  }

  const confirmation = confirm(
    "FULL RESTORE WARNING\n\n" +
    "This will replace all current local trades, custom fields and column settings " +
    "with the data from Google Drive.\n\n" +
    "Your current local data will be overwritten.\n\n" +
    "Do you want to continue?"
  );

  if (!confirmation) return;

  button.disabled = true;
  message.textContent = "Checking Google Drive backup...";

  try {
    await ensureDriveAccess();

    const file = await findCanonicalBackupFile();

    if (!file) {
      throw new Error(
        "No " + DRIVE_BACKUP_FILENAME + " file was found in TradeLedger Backups."
      );
    }

    message.textContent = "Downloading backup...";

    const backup = await downloadDriveBackup(file.id);

    message.textContent = "Restoring your TradeLedger data...";

    await applyFullBackupToDatabase(backup);

    await loadData();
    await normalizePriceMovementLocation();
    await loadData();

    message.textContent =
      "Full Restore completed successfully.";

    alert("TradeLedger Full Restore completed successfully.");

  } catch (error) {
    console.error(error);

    message.textContent = "Restore failed: " + error.message;
    alert("Restore failed: " + error.message);

  } finally {
    button.disabled = false;
  }
}

/* ---------- GOOGLE DRIVE BUTTON EVENTS ---------- */

$("connectDriveBtn").addEventListener("click",connectGoogleDrive);
$("disconnectDriveBtn").addEventListener("click",disconnectGoogleDrive);
$("driveBackupBtn").addEventListener("click",uploadDriveBackup);
$("restoreDriveBackupBtn").addEventListener("click",restoreDriveBackup);

/* ==========================================
   START APP
========================================== */

async function startApp() {
  try {
    await openDatabase();

    columnSettings = {
      ...defaultSettings(),
      ...columnSettings
    };

    saveSettings();

    await loadData();

    await normalizePriceMovementLocation();

    await loadData();

    $("tradeDate").value = today();

    calculateTrade();
    renderPeriodOverview();

    updateDriveConnectionDisplay();

    setTradingMode("intraday");

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

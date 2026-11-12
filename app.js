
"use strict";

/* ==========================================
   TRADELEDGER - COMPLETE APP
   Trade Journal + Trade History
   Existing IndexedDB database preserved
========================================== */

const $ = id => document.getElementById(id);

const DB_NAME = "TradeLedgerDB";
const DB_VERSION = 2;

let db;
let trades = [];
let fields = [];
let editingTradeId = null;
let existingCustomFields = {};
let currentAttachments = [];

const money = n => "₹" + (Number(n) || 0).toFixed(2);

const num = id => Number($(id)?.value) || 0;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

const makeId = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  })[c]);
}

/* ==========================================
   DATABASE
========================================== */

function openDatabase() {
  return new Promise((resolve,reject) => {
    const req = indexedDB.open(DB_NAME,DB_VERSION);

    req.onupgradeneeded = e => {
      const database = e.target.result;

      if (!database.objectStoreNames.contains("trades")) {
        database.createObjectStore("trades",{keyPath:"id"});
      }

      if (!database.objectStoreNames.contains("fields")) {
        database.createObjectStore("fields",{keyPath:"id"});
      }
    };

    req.onsuccess = () => {
      db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };

    req.onerror = () => reject(req.error);
  });
}

function getAll(store) {
  return new Promise((resolve,reject) => {
    const req = db.transaction(store,"readonly")
      .objectStore(store)
      .getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function saveRecord(store,record) {
  return new Promise((resolve,reject) => {
    const tx = db.transaction(store,"readwrite");
    tx.objectStore(store).put(record);

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

function deleteRecord(store,id) {
  return new Promise((resolve,reject) => {
    const tx = db.transaction(store,"readwrite");
    tx.objectStore(store).delete(id);

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* ==========================================
   TRADE CALCULATIONS
========================================== */

function calculateTrade() {
  const bq = num("buyQty");
  const sq = num("sellQty");
  const bp = num("buyPrice");
  const sp = num("sellPrice");

  const buyValue = bq * bp;
  const sellValue = sq * sp;

  const buyCharges =
    num("buyCharge") + num("extraBuyCharge");

  const sellCharges =
    num("sellCharge") + num("extraSellCharge");

  const charges = buyCharges + sellCharges;

  // Existing long-position calculation preserved.
  const gross = sellValue - (sq * bp);
  const net = gross - charges;

  $("buyStockValue").value = buyValue.toFixed(2);
  $("totalBuyCharges").value = buyCharges.toFixed(2);
  $("totalBuyValue").value = (buyValue + buyCharges).toFixed(2);

  $("sellStockValue").value = sellValue.toFixed(2);
  $("totalSellCharges").value = sellCharges.toFixed(2);
  $("totalSellValue").value = (sellValue - sellCharges).toFixed(2);

  $("priceMovement").value = (sp - bp).toFixed(2);

  $("grossPLInput").value = gross.toFixed(2);
  $("totalChargesInput").value = charges.toFixed(2);
  $("netPLInput").value = net.toFixed(2);

  $("tradeResult").value =
    net > 0 ? "Win" : net < 0 ? "Loss" : "Break Even";
}

/* ==========================================
   DATE PERIODS
========================================== */

function isInPeriod(dateValue,period) {
  if (period === "overall" || period === "all") return true;
  if (!dateValue) return false;

  const d = new Date(dateValue + "T12:00:00");
  if (Number.isNaN(d.getTime())) return false;

  const now = new Date();

  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  if (period === "day") {
    return d.toDateString() === todayStart.toDateString();
  }

  if (period === "week") {
    const start = new Date(todayStart);
    start.setDate(start.getDate() - ((start.getDay()+6)%7));
    return d >= start && d <= now;
  }

  if (period === "month") {
    return d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth();
  }

  if (period === "year") {
    return d.getFullYear() === now.getFullYear();
  }

  return true;
}

/* ==========================================
   DASHBOARD
========================================== */

function renderDashboard() {
  const period = $("dashboardPeriod")?.value || "overall";

  const selected = trades.filter(t =>
    isInPeriod(t.date,period)
  );

  const total = selected.length;

  const wins = selected.filter(t =>
    Number(t.netPL) > 0
  ).length;

  const losses = selected.filter(t =>
    Number(t.netPL) < 0
  ).length;

  const gross = selected.reduce(
    (s,t) => s + Number(t.grossPL || 0),0
  );

  const charges = selected.reduce(
    (s,t) => s + Number(t.totalCharges || 0),0
  );

  const net = selected.reduce(
    (s,t) => s + Number(t.netPL || 0),0
  );

  $("totalTrades").textContent = total;
  $("winningTrades").textContent = wins;
  $("losingTrades").textContent = losses;

  $("winRate").textContent =
    (total ? wins/total*100 : 0).toFixed(1) + "%";

  $("grossPL").textContent = money(gross);
  $("totalCharges").textContent = money(charges);
  $("netPL").textContent = money(net);

  $("grossPL").style.color =
    gross >= 0 ? "#22c55e" : "#ef4444";

  $("netPL").style.color =
    net >= 0 ? "#22c55e" : "#ef4444";
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
    .filter(f => f.active !== false && f.showForm)
    .forEach(field => {
      const label = document.createElement("label");
      label.textContent = field.name;

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
  const values = {...existingCustomFields};

  document.querySelectorAll("[data-custom-field]")
    .forEach(input => {
      values[input.dataset.customField] = input.value;
    });

  return values;
}

function historyCustomText(values = {}) {
  return fields
    .filter(f => f.active !== false && f.showHistory)
    .map(f => {
      const value = values[f.id];

      return value !== undefined && value !== ""
        ? f.name + ": " + value
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
  const old = fields.find(f => f.id === id);

  const field = {
    id,
    name,
    type: $("fieldType").value,
    options: $("fieldOptions").value
      .split(",")
      .map(x => x.trim())
      .filter(Boolean),

    showForm: $("fieldInForm").checked,
    showHistory: $("fieldInHistory").checked,
    required: $("fieldRequired").checked,

    active: true,
    createdAt: old?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await saveRecord("fields",field);

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

  fields.forEach(field => {
    const item = document.createElement("div");
    item.className = "field-manager-item";

    const info = document.createElement("div");

    const title = document.createElement("strong");
    title.textContent = field.name;

    const details = document.createElement("small");

    details.textContent =
      `Type: ${field.type} | Form: ${field.showForm ? "Yes":"No"} | History: ${field.showHistory ? "Yes":"No"} | ${field.active === false ? "Hidden":"Active"}`;

    info.append(title,details);

    const actions = document.createElement("div");
    actions.className = "field-manager-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.onclick = () => editField(field.id);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent =
      field.active === false ? "Show" : "Hide";

    toggle.onclick = () => toggleField(field);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.onclick = () => removeField(field.id);

    actions.append(edit,toggle,remove);
    item.append(info,actions);
    list.appendChild(item);
  });
}

function editField(id) {
  const f = fields.find(x => x.id === id);
  if (!f) return;

  $("fieldId").value = f.id;
  $("fieldName").value = f.name;
  $("fieldType").value = f.type;
  $("fieldOptions").value = (f.options || []).join(", ");

  $("fieldInForm").checked = Boolean(f.showForm);
  $("fieldInHistory").checked = Boolean(f.showHistory);
  $("fieldRequired").checked = Boolean(f.required);

  $("fieldOptions").disabled = f.type !== "dropdown";

  $("adminPanel").hidden = false;
  $("adminPanel").scrollIntoView({behavior:"smooth"});
}

async function toggleField(field) {
  field.active = field.active === false;
  await saveRecord("fields",field);
  await loadFields();
}

async function removeField(id) {
  if (!confirm(
    "Delete field definition? Existing trade values will be preserved."
  )) return;

  await deleteRecord("fields",id);
  await loadFields();
}

function setupFieldManager() {
  $("fieldForm")?.addEventListener("submit",saveField);

  $("fieldType")?.addEventListener("change",() => {
    $("fieldOptions").disabled =
      $("fieldType").value !== "dropdown";
  });

  $("cancelFieldEdit")?.addEventListener("click",() => {
    $("fieldForm").reset();
    $("fieldId").value = "";
    $("fieldOptions").disabled = true;
  });

  $("adminBtn")?.addEventListener("click",() => {
    $("adminPanel").hidden = !$("adminPanel").hidden;

    if (!$("adminPanel").hidden) {
      $("adminPanel").scrollIntoView({behavior:"smooth"});
    }
  });

  $("closeAdminBtn")?.addEventListener("click",() => {
    $("adminPanel").hidden = true;
  });
}

/* ==========================================
   ATTACHMENT HELPERS
========================================== */

// Supports old File/Blob records and newer tagged attachments.
function attachmentBlob(item) {
  if (!item) return null;

  if (item instanceof Blob) return item;

  if (item.blob instanceof Blob) return item.blob;

  return null;
}

function attachmentName(item,index) {
  return item?.name ||
    attachmentBlob(item)?.name ||
    `Attachment ${index + 1}`;
}

function attachmentType(item) {
  return item?.type ||
    attachmentBlob(item)?.type ||
    "application/octet-stream";
}

function attachmentKind(item) {
  if (item?.kind) return item.kind;

  // Older attachments did not store their category.
  // PDFs are treated as contract notes; old images as chart images.
  const type = attachmentType(item);

  if (type === "application/pdf") return "contract";
  if (type.startsWith("image/")) return "image";

  return "other";
}

function getTradeAttachments(trade,kind) {
  return (trade.attachments || []).filter(item =>
    attachmentKind(item) === kind
  );
}

/* ==========================================
   TRADE RECORD
========================================== */

function collectTrade() {
  calculateTrade();

  const old = trades.find(t => t.id === editingTradeId);

  const newImages = Array.from(
    $("chartImages")?.files || []
  ).map(file => ({
    name:file.name,
    type:file.type,
    kind:"image",
    blob:file
  }));

  const newNotes = Array.from(
    $("contractNote")?.files || []
  ).map(file => ({
    name:file.name,
    type:file.type,
    kind:"contract",
    blob:file
  }));

  return {
    id: editingTradeId || makeId(),

    date: $("tradeDate").value || today(),
    voucherNumber: $("voucherNumber").value.trim(),
    stockName: $("stockName").value.trim(),

    capital: num("capital"),
    leverage: num("leverage"),
    strategy: $("strategy").value,
    riskReward: $("riskReward").value,

    tradeResult: $("tradeResult").value,
    tradeType: $("tradeType").value,

    notes: $("notes").value,

    buyQty: num("buyQty"),
    buyPrice: num("buyPrice"),
    buyStockValue: num("buyStockValue"),
    buyCharge: num("buyCharge"),
    extraBuyCharge: num("extraBuyCharge"),
    totalBuyCharges: num("totalBuyCharges"),
    totalBuyValue: num("totalBuyValue"),

    sellQty: num("sellQty"),
    sellPrice: num("sellPrice"),
    sellStockValue: num("sellStockValue"),
    sellCharge: num("sellCharge"),
    extraSellCharge: num("extraSellCharge"),
    totalSellCharges: num("totalSellCharges"),
    totalSellValue: num("totalSellValue"),

    priceMovement: num("priceMovement"),

    grossPL: num("grossPLInput"),
    totalCharges: num("totalChargesInput"),
    netPL: num("netPLInput"),

    customFields: collectCustomValues(),

    attachments: [
      ...currentAttachments,
      ...newImages,
      ...newNotes
    ],

    createdAt: old?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function handleTradeSubmit(event) {
  event.preventDefault();

  if (!$("stockName").value.trim()) {
    alert("Please enter stock name.");
    return;
  }

  try {
    const wasEditing = Boolean(editingTradeId);
    const trade = collectTrade();

    await saveRecord("trades",trade);

    alert(wasEditing ? "Trade updated." : "Trade saved.");

    resetTradeForm();
    await refreshTrades();

  } catch(error) {
    console.error(error);
    alert("Could not save trade.");
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
  const t = trades.find(x => x.id === id);
  if (!t) return;

  editingTradeId = id;

  existingCustomFields = {...(t.customFields || {})};
  currentAttachments = [...(t.attachments || [])];

  const values = {
    tradeDate:t.date,
    voucherNumber:t.voucherNumber,
    stockName:t.stockName,
    capital:t.capital,
    leverage:t.leverage,
    strategy:t.strategy,
    riskReward:t.riskReward,
    tradeType:t.tradeType,
    notes:t.notes,

    buyQty:t.buyQty,
    buyPrice:t.buyPrice,
    buyCharge:t.buyCharge,
    extraBuyCharge:t.extraBuyCharge,

    sellQty:t.sellQty,
    sellPrice:t.sellPrice,
    sellCharge:t.sellCharge,
    extraSellCharge:t.extraSellCharge
  };

  Object.entries(values).forEach(([id,value]) => {
    if ($(id)) $(id).value = value ?? "";
  });

  $("tradeId").value = t.id;
  $("saveTradeBtn").textContent = "Update Trade";

  renderCustomInputs();
  calculateTrade();

  $("tradeSection").scrollIntoView({behavior:"smooth"});
}

async function deleteTrade(id) {
  if (!confirm("Delete this trade?")) return;

  await deleteRecord("trades",id);
  await refreshTrades();
}

/* ==========================================
   TRADE JOURNAL
========================================== */

function journalField(label,value) {
  return `
    <div class="journal-detail">
      <span class="journal-label">${safe(label)}</span>
      <strong class="journal-value">${safe(
        value === undefined || value === null || value === ""
          ? "-"
          : value
      )}</strong>
    </div>
  `;
}

function journalMoneyField(label,value) {
  return journalField(label,money(value));
}

function journalSection(title,content) {
  return `
    <div class="journal-section">
      <h4>${safe(title)}</h4>
      <div class="journal-details-grid">
        ${content}
      </div>
    </div>
  `;
}

function journalAttachmentSummary(trade) {
  const attachments = trade.attachments || [];

  if (!attachments.length) {
    return `
      <div class="journal-attachments-empty">
        No attachments added
      </div>
    `;
  }

  return `
    <div class="journal-attachment-list">
      ${attachments.map((item,index) => `
        <div class="journal-attachment-item">
          <span>${safe(attachmentName(item,index))}</span>
          <small>${safe(attachmentKind(item))}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderJournalCard(trade) {
  const result = Number(trade.netPL || 0);
  const resultClass =
    result > 0 ? "profit" : result < 0 ? "loss" : "";

  let general = "";

  general += journalField("Date",trade.date);
  general += journalField("Voucher Number",trade.voucherNumber);
  general += journalField("Stock Name",trade.stockName);
  general += journalMoneyField("Capital",trade.capital);
  general += journalField("Leverage",trade.leverage);
  general += journalField("Strategy",trade.strategy);
  general += journalField("Risk Reward Ratio",trade.riskReward);
  general += journalField("Trade Type",trade.tradeType);
  general += journalField("Trade Result",trade.tradeResult);

  let buy = "";

  buy += journalField("Buy Quantity",trade.buyQty);
  buy += journalMoneyField("Buy Price Per Share",trade.buyPrice);
  buy += journalMoneyField("Buy Stock Value",trade.buyStockValue);
  buy += journalMoneyField("Buy Charges",trade.buyCharge);
  buy += journalMoneyField("Extra Buy Charges",trade.extraBuyCharge);
  buy += journalMoneyField("Total Buy Charges",trade.totalBuyCharges);
  buy += journalMoneyField("Total Buy Value",trade.totalBuyValue);

  let sell = "";

  sell += journalField("Sell Quantity",trade.sellQty);
  sell += journalMoneyField("Sell Price Per Share",trade.sellPrice);
  sell += journalMoneyField("Sell Stock Value",trade.sellStockValue);
  sell += journalMoneyField("Sell Charges",trade.sellCharge);
  sell += journalMoneyField("Extra Sell Charges",trade.extraSellCharge);
  sell += journalMoneyField("Total Sell Charges",trade.totalSellCharges);
  sell += journalMoneyField("Total Sell Value",trade.totalSellValue);
  sell += journalMoneyField("Price Movement",trade.priceMovement);

  let pnl = "";

  pnl += journalMoneyField("Gross P&L",trade.grossPL);
  pnl += journalMoneyField("Total Charges",trade.totalCharges);

  pnl += `
    <div class="journal-detail journal-net-result ${resultClass}">
      <span class="journal-label">Net Profit / Loss</span>
      <strong class="journal-value">${money(trade.netPL)}</strong>
    </div>
  `;

  let custom = "";
  const customValues = trade.customFields || {};
  const customEntries = Object.entries(customValues);

  if (customEntries.length) {
    custom = customEntries.map(([id,value]) => {
      const field = fields.find(f => f.id === id);
      const label = field?.name || id;

      return journalField(label,value);
    }).join("");
  } else {
    custom = `
      <div class="journal-empty">
        No custom fields saved
      </div>
    `;
  }

  return `
    <article class="journal-card" data-journal-id="${safe(trade.id)}">

      <div class="journal-card-header">
        <div>
          <h3>${safe(trade.stockName || "Unnamed Trade")}</h3>
          <p>${safe(trade.date || "-")} · ${safe(trade.voucherNumber || "No Voucher")}</p>
        </div>

        <span class="journal-result ${resultClass}">
          ${safe(trade.tradeResult || "Not Set")}
        </span>
      </div>

      ${journalSection("Trade Details",general)}

      ${journalSection("BUY Details",buy)}

      ${journalSection("SELL Details",sell)}

      ${journalSection("Profit & Loss",pnl)}

      <div class="journal-section">
        <h4>Custom Fields</h4>
        <div class="journal-details-grid">
          ${custom}
        </div>
      </div>

      <div class="journal-section">
        <h4>Attachments</h4>
        ${journalAttachmentSummary(trade)}
      </div>

      <div class="journal-card-actions">
        <button type="button" class="journal-delete-btn"
          data-journal-delete="${safe(trade.id)}">
          Delete
        </button>

        <button type="button" class="journal-view-btn"
          data-journal-view="${safe(trade.id)}">
          View
        </button>

        <button type="button" class="journal-edit-btn"
          data-journal-edit="${safe(trade.id)}">
          Edit
        </button>
      </div>

    </article>
  `;
}

function renderJournal() {
  const container = $("journalCards");
  if (!container) return;

  const count = $("journalTradeCount");

  if (count) {
    count.textContent =
      `${trades.length} ${trades.length === 1 ? "Trade" : "Trades"}`;
  }

  if (!trades.length) {
    container.innerHTML = `
      <div class="journal-empty-state">
        <h3>No trades in your journal yet</h3>
        <p>Save a trade to see its complete details here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = [...trades]
    .sort((a,b) => (b.date || "").localeCompare(a.date || ""))
    .map(renderJournalCard)
    .join("");

  container.querySelectorAll("[data-journal-edit]")
    .forEach(button => {
      button.addEventListener("click",() =>
        editTrade(button.dataset.journalEdit)
      );
    });

  container.querySelectorAll("[data-journal-delete]")
    .forEach(button => {
      button.addEventListener("click",() =>
        deleteTrade(button.dataset.journalDelete)
      );
    });

  container.querySelectorAll("[data-journal-view]")
    .forEach(button => {
      button.addEventListener("click",() =>
        openJournalView(button.dataset.journalView)
      );
    });
}

/* ==========================================
   JOURNAL VIEW OPTIONS
========================================== */

let selectedJournalTradeId = null;
let activeObjectUrls = [];

function openJournalView(id) {
  const trade = trades.find(t => t.id === id);
  if (!trade) return;

  selectedJournalTradeId = id;

  const modal = $("journalViewModal");
  if (!modal) {
    alert("Journal view window is not available.");
    return;
  }

  const notes = getTradeAttachments(trade,"contract");
  const images = getTradeAttachments(trade,"image");

  const noteButton = $("viewContactNoteBtn");
  const imageButton = $("viewImageBtn");

  if (noteButton) {
    noteButton.disabled = notes.length === 0;
    noteButton.textContent =
      notes.length ? `Contact Note (${notes.length})` : "Contact Note (None)";
  }

  if (imageButton) {
    imageButton.disabled = images.length === 0;
    imageButton.textContent =
      images.length ? `Image (${images.length})` : "Image (None)";
  }

  modal.hidden = false;
}

function closeJournalView() {
  if ($("journalViewModal")) {
    $("journalViewModal").hidden = true;
  }

  selectedJournalTradeId = null;
}

function clearAttachmentUrls() {
  activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
  activeObjectUrls = [];
}

function openAttachmentViewer(title,attachments) {
  const modal = $("attachmentViewer");
  const content = $("attachmentViewerContent");

  if (!modal || !content) {
    alert("Attachment viewer is not available.");
    return;
  }

  clearAttachmentUrls();

  $("attachmentViewerTitle").textContent = title;
  content.innerHTML = "";

  if (!attachments.length) {
    content.textContent = "No attachment available.";
    modal.hidden = false;
    return;
  }

  attachments.forEach((item,index) => {
    const blob = attachmentBlob(item);

    if (!blob) {
      const message = document.createElement("p");
      message.textContent =
        `${attachmentName(item,index)} — Cannot open this attachment.`;

      content.appendChild(message);
      return;
    }

    const url = URL.createObjectURL(blob);
    activeObjectUrls.push(url);

    const wrapper = document.createElement("div");
    wrapper.className = "attachment-view-item";

    const name = document.createElement("p");
    name.textContent = attachmentName(item,index);
    wrapper.appendChild(name);

    const type = attachmentType(item);

    if (type.startsWith("image/")) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = attachmentName(item,index);
      image.className = "attachment-preview-image";
      wrapper.appendChild(image);

    } else if (type === "application/pdf") {
      const frame = document.createElement("iframe");
      frame.src = url;
      frame.title = attachmentName(item,index);
      frame.className = "attachment-preview-pdf";
      wrapper.appendChild(frame);

    } else {
      const link = document.createElement("a");
      link.href = url;
      link.download = attachmentName(item,index);
      link.textContent = "Open / Download Attachment";
      link.target = "_blank";
      wrapper.appendChild(link);
    }

    content.appendChild(wrapper);
  });

  modal.hidden = false;
}

function viewJournalContactNote() {
  const trade = trades.find(t =>
    t.id === selectedJournalTradeId
  );

  if (!trade) return;

  openAttachmentViewer(
    "Contact Note",
    getTradeAttachments(trade,"contract")
  );
}

function viewJournalImages() {
  const trade = trades.find(t =>
    t.id === selectedJournalTradeId
  );

  if (!trade) return;

  openAttachmentViewer(
    "Images",
    getTradeAttachments(trade,"image")
  );
}

function setupJournalViewer() {
  $("closeJournalViewBtn")?.addEventListener(
    "click",closeJournalView
  );

  $("viewContactNoteBtn")?.addEventListener(
    "click",viewJournalContactNote
  );

  $("viewImageBtn")?.addEventListener(
    "click",viewJournalImages
  );

  $("closeAttachmentViewerBtn")?.addEventListener(
    "click",() => {
      if ($("attachmentViewer")) {
        $("attachmentViewer").hidden = true;
      }

      clearAttachmentUrls();
    }
  );

  $("journalViewModal")?.addEventListener("click",event => {
    if (event.target === $("journalViewModal")) {
      closeJournalView();
    }
  });

  $("attachmentViewer")?.addEventListener("click",event => {
    if (event.target === $("attachmentViewer")) {
      $("attachmentViewer").hidden = true;
      clearAttachmentUrls();
    }
  });
}

/* ==========================================
   TRADE HISTORY
========================================== */

function renderTrades() {
  const tbody = $("tradeHistory");
  if (!tbody) return;

  const search =
    ($("searchStock")?.value || "").toLowerCase();

  const period =
    $("periodFilter")?.value || "all";

  const filtered = trades.filter(t =>
    (t.stockName || "").toLowerCase().includes(search) &&
    isInPeriod(t.date,period)
  );

  if (!filtered.length) {
    tbody.innerHTML =
      '<tr><td colspan="8">No trades found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .sort((a,b) => (b.date || "").localeCompare(a.date || ""))
    .map(t => {
      const cls =
        Number(t.netPL) > 0
          ? "profit"
          : Number(t.netPL) < 0
            ? "loss"
            : "";

      return `
        <tr>
          <td>${safe(t.date)}</td>
          <td>${safe(t.voucherNumber || "-")}</td>
          <td>${safe(t.stockName)}</td>
          <td>${safe(t.strategy || "-")}</td>
          <td>${safe(t.tradeResult || "-")}</td>
          <td class="${cls}">${money(t.netPL)}</td>
          <td>${safe(historyCustomText(t.customFields || {}) || "-")}</td>
          <td>
            <button type="button" data-edit="${safe(t.id)}">
              Edit
            </button>
            <button type="button" data-delete="${safe(t.id)}">
              Delete
            </button>
          </td>
        </tr>
      `;
    }).join("");

  tbody.querySelectorAll("[data-edit]")
    .forEach(btn => {
      btn.addEventListener("click",() =>
        editTrade(btn.dataset.edit)
      );
    });

  tbody.querySelectorAll("[data-delete]")
    .forEach(btn => {
      btn.addEventListener("click",() =>
        deleteTrade(btn.dataset.delete)
      );
    });
}

/* ==========================================
   BACKUP
========================================== */

function blobToDataURL(blob) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataURL) {
  const parts = dataURL.split(",");
  const mime = parts[0].match(/:(.*?);/)?.[1] || "";

  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);

  for (let i=0;i<binary.length;i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes],{type:mime});
}

async function exportBackup() {
  try {
    const backupTrades = [];

    for (const t of trades) {
      const copy = {...t,attachments:[]};

      for (const attachment of (t.attachments || [])) {
        const blob = attachmentBlob(attachment);

        if (blob) {
          copy.attachments.push({
            name:attachmentName(attachment,copy.attachments.length),
            type:attachmentType(attachment),
            kind:attachmentKind(attachment),
            data:await blobToDataURL(blob)
          });
        } else {
          copy.attachments.push(attachment);
        }
      }

      backupTrades.push(copy);
    }

    const backup = {
      app:"TradeLedger",
      version:2,
      exportedAt:new Date().toISOString(),
      trades:backupTrades,
      fields
    };

    const blob = new Blob(
      [JSON.stringify(backup)],
      {type:"application/json"}
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "TradeLedger-Backup-" + today() + ".json";
    link.click();

    setTimeout(() => URL.revokeObjectURL(url),1000);

  } catch(error) {
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

    // Accept both legacy array backups and object backups.
    const backupTrades =
      Array.isArray(backup) ? backup : backup.trades;

    if (!Array.isArray(backupTrades)) {
      throw new Error("Invalid backup");
    }

    for (const t of backupTrades) {
      t.attachments = (t.attachments || []).map(item => {
        if (item?.data) {
          return {
            name:item.name,
            type:item.type,
            kind:item.kind,
            blob:dataURLToBlob(item.data)
          };
        }

        return item;
      });

      await saveRecord("trades",t);
    }

    if (Array.isArray(backup.fields)) {
      for (const field of backup.fields) {
        await saveRecord("fields",field);
      }
    }

    await loadFields();
    await refreshTrades();

    alert("Backup restored successfully.");

  } catch(error) {
    console.error(error);
    alert("Backup restore failed. Check the JSON file.");
  }

  event.target.value = "";
}

/* ==========================================
   THEME
========================================== */

function setupTheme() {
  const saved = localStorage.getItem("tradeledger-theme");

  if (saved === "light") {
    document.body.classList.add("light-theme");
    $("themeBtn").textContent = "☀️";
  }

  $("themeBtn")?.addEventListener("click",() => {
    document.body.classList.toggle("light-theme");

    const light =
      document.body.classList.contains("light-theme");

    localStorage.setItem(
      "tradeledger-theme",
      light ? "light" : "dark"
    );

    $("themeBtn").textContent =
      light ? "☀️" : "🌙";
  });
}

/* ==========================================
   NAVIGATION
========================================== */

function setupNavigation() {
  document.querySelectorAll("[data-section]")
    .forEach(button => {
      button.addEventListener("click",() => {
        const target = $(button.dataset.section);
        target?.scrollIntoView({behavior:"smooth"});
      });
    });
}

/* ==========================================
   REFRESH
========================================== */

async function refreshTrades() {
  trades = await getAll("trades");

  trades.sort((a,b) =>
    (b.date || "").localeCompare(a.date || "")
  );

  renderDashboard();
  renderTrades();
  renderJournal();
}

/* ==========================================
   START APP
========================================== */

async function startApp() {
  try {
    await openDatabase();

    $("storageStatus").textContent =
      "● Offline Storage Ready";

    $("storageStatus").style.color = "#22c55e";

    setupTheme();
    setupNavigation();
    setupFieldManager();
    setupJournalViewer();

    await loadFields();
    await refreshTrades();

    $("tradeDate").value = today();

    $("dashboardPeriod")?.addEventListener(
      "change",renderDashboard
    );

    $("tradeForm")?.addEventListener(
      "submit",handleTradeSubmit
    );

    $("newTradeBtn")?.addEventListener(
      "click",resetTradeForm
    );

    $("resetTradeBtn")?.addEventListener(
      "click",resetTradeForm
    );

    $("periodFilter")?.addEventListener(
      "change",renderTrades
    );

    $("searchStock")?.addEventListener(
      "input",renderTrades
    );

    $("exportBtn")?.addEventListener(
      "click",exportBackup
    );

    $("importFile")?.addEventListener(
      "change",importBackup
    );

    [
      "buyQty",
      "buyPrice",
      "buyCharge",
      "extraBuyCharge",
      "sellQty",
      "sellPrice",
      "sellCharge",
      "extraSellCharge"
    ].forEach(id => {
      $(id)?.addEventListener("input",calculateTrade);
    });

    calculateTrade();

  } catch(error) {
    console.error(error);

    if ($("storageStatus")) {
      $("storageStatus").textContent = "Storage Error";
      $("storageStatus").style.color = "#ef4444";
    }

    alert("TradeLedger database could not be opened.");
  }
}

document.addEventListener("DOMContentLoaded",startApp);

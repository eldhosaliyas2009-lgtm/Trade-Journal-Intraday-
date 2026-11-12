
"use strict";

/* ==========================================
   TRADELEDGER
   Journal + Dashboard + Dynamic Fields
   Existing IndexedDB database preserved
========================================== */

const $ = id => document.getElementById(id);

const DB_NAME = "TradeLedgerDB";
const DB_VERSION = 2;

const TRADE_STORE = "trades";
const FIELD_STORE = "fields";

let db;
let trades = [];
let fields = [];
let editingTradeId = null;
let currentViewTrade = null;
let currentAttachments = [];

const money = value =>
  "₹" + (Number(value) || 0).toFixed(2);

const number = value => Number(value) || 0;

const escapeHTML = value =>
  String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));

const makeId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ==========================================
   DATABASE
========================================== */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(TRADE_STORE)) {
        database.createObjectStore(TRADE_STORE, {
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

function storeRequest(storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = action(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllRecords(storeName) {
  return storeRequest(storeName, "readonly", store => store.getAll());
}

function saveRecord(storeName, record) {
  return storeRequest(storeName, "readwrite", store => store.put(record));
}

function deleteRecord(storeName, id) {
  return storeRequest(storeName, "readwrite", store => store.delete(id));
}

async function loadData() {
  trades = await getAllRecords(TRADE_STORE);
  fields = await getAllRecords(FIELD_STORE);

  trades.sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")) ||
    number(b.updatedAt) - number(a.updatedAt)
  );

  renderDashboard();
  renderJournal();
}

/* ==========================================
   NAVIGATION
========================================== */

function setupNavigation() {
  document.querySelectorAll(".nav-btn").forEach(button => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.section;

      document.querySelectorAll(".nav-btn").forEach(item =>
        item.classList.remove("active")
      );

      button.classList.add("active");

      document.querySelectorAll(
        "#dashboardSection, #tradeFormSection, #tradeJournalSection, #backupSection"
      ).forEach(section => {
        section.hidden = section.id !== targetId;
      });

      if (targetId === "tradeJournalSection") {
        renderJournal();
      }

      if (targetId === "dashboardSection") {
        renderDashboard();
      }

      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  document.querySelectorAll(
    "#dashboardSection, #tradeFormSection, #tradeJournalSection, #backupSection"
  ).forEach(section => {
    section.hidden = section.id !== "dashboardSection";
  });
}

function showSection(sectionId) {
  const button = document.querySelector(
    `.nav-btn[data-section="${sectionId}"]`
  );

  if (button) button.click();
}

/* ==========================================
   THEME
========================================== */

function setupTheme() {
  const themeBtn = $("themeBtn");
  if (!themeBtn) return;

  const savedTheme = localStorage.getItem("tradeLedgerTheme");

  if (savedTheme === "light") {
    document.body.classList.add("light-theme");
  }

  updateThemeButton();

  themeBtn.addEventListener("click", () => {
    document.body.classList.toggle("light-theme");

    localStorage.setItem(
      "tradeLedgerTheme",
      document.body.classList.contains("light-theme")
        ? "light"
        : "dark"
    );

    updateThemeButton();
  });
}

function updateThemeButton() {
  const themeBtn = $("themeBtn");
  if (!themeBtn) return;

  themeBtn.textContent =
    document.body.classList.contains("light-theme") ? "☀️" : "🌙";
}

/* ==========================================
   CALCULATIONS
========================================== */

function calculateTrade() {
  const buyQty = number($("buyQty")?.value);
  const buyPrice = number($("buyPrice")?.value);
  const sellQty = number($("sellQty")?.value);
  const sellPrice = number($("sellPrice")?.value);

  const buyCharge = number($("buyCharge")?.value);
  const extraBuyCharge = number($("extraBuyCharge")?.value);
  const sellCharge = number($("sellCharge")?.value);
  const extraSellCharge = number($("extraSellCharge")?.value);

  const buyValue = buyQty * buyPrice;
  const sellValue = sellQty * sellPrice;

  const totalBuyCharges = buyCharge + extraBuyCharge;
  const totalSellCharges = sellCharge + extraSellCharge;
  const totalCharges = totalBuyCharges + totalSellCharges;

  const gross = sellValue - (sellQty * buyPrice);
  const net = gross - totalCharges;

  setValue("buyStockValue", buyValue);
  setValue("totalBuyCharges", totalBuyCharges);
  setValue("totalBuyValue", buyValue + totalBuyCharges);

  setValue("sellStockValue", sellValue);
  setValue("totalSellCharges", totalSellCharges);
  setValue("totalSellValue", sellValue - totalSellCharges);

  setValue("priceMovement", sellPrice - buyPrice);

  setValue("grossPLInput", gross);
  setValue("totalChargesInput", totalCharges);
  setValue("netPLInput", net);

  // Trade Result is intentionally selected manually.
}

function setValue(id, value) {
  const element = $(id);
  if (element) element.value = number(value).toFixed(2);
}

function setupCalculations() {
  const ids = [
    "buyQty", "buyPrice", "sellQty", "sellPrice",
    "buyCharge", "extraBuyCharge",
    "sellCharge", "extraSellCharge"
  ];

  ids.forEach(id => {
    $(id)?.addEventListener("input", calculateTrade);
  });
}

/* ==========================================
   FILE ATTACHMENTS
========================================== */

function fileToData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve({
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      data: reader.result
    });

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function readAttachments() {
  const images = Array.from($("chartImages")?.files || []);
  const contract = Array.from($("contractNote")?.files || []);

  const chartFiles = await Promise.all(images.map(fileToData));
  const contractFiles = await Promise.all(contract.map(fileToData));

  return {
    chartImages: [
      ...currentAttachments.filter(item =>
        item.kind === "chart" || item.kind === "image"
      ),
      ...chartFiles.map(item => ({ ...item, kind: "chart" }))
    ],
    contractNote: [
      ...currentAttachments.filter(item =>
        item.kind === "contract"
      ),
      ...contractFiles.map(item => ({ ...item, kind: "contract" }))
    ]
  };
}

function getTradeAttachments(trade) {
  const chartImages = Array.isArray(trade.chartImages)
    ? trade.chartImages
    : [];

  let contractNote = trade.contractNote || [];

  if (!Array.isArray(contractNote)) {
    contractNote = contractNote ? [contractNote] : [];
  }

  const normalizedCharts = chartImages.map(item =>
    typeof item === "string"
      ? { name: "Chart Image", data: item, type: "image/*", kind: "chart" }
      : { ...item, kind: item.kind || "chart" }
  );

  const normalizedContracts = contractNote.map(item =>
    typeof item === "string"
      ? { name: "Contract Note", data: item, type: "application/pdf", kind: "contract" }
      : { ...item, kind: "contract" }
  );

  return [...normalizedCharts, ...normalizedContracts];
}

/* ==========================================
   CUSTOM FIELDS
========================================== */

function isDropdownType(type) {
  return type === "dropdown" || type === "select";
}

function renderCustomFields(values = {}) {
  const container = $("customFieldsContainer");
  if (!container) return;

  container.innerHTML = "";

  fields
    .filter(field => field.active !== false && field.showForm !== false)
    .forEach(field => {
      const label = document.createElement("label");
      label.textContent = field.name;

      let input;

      if (field.type === "textarea") {
        input = document.createElement("textarea");
        input.rows = 3;
      } else if (field.type === "checkbox") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(values[field.id]);
      } else if (isDropdownType(field.type)) {
        input = document.createElement("select");

        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "Select " + field.name;
        input.appendChild(empty);

        (field.options || []).forEach(optionText => {
          const option = document.createElement("option");
          option.value = optionText;
          option.textContent = optionText;
          input.appendChild(option);
        });
      } else {
        input = document.createElement("input");
        input.type = ["text", "number", "date"].includes(field.type)
          ? field.type
          : "text";
      }

      input.id = "custom_" + field.id;
      input.dataset.customFieldId = field.id;

      if (field.type !== "checkbox") {
        input.value = values[field.id] ?? "";
      }

      if (field.required) input.required = true;

      label.appendChild(input);
      container.appendChild(label);
    });
}

function collectCustomValues() {
  const result = {};

  fields.forEach(field => {
    const input = $("custom_" + field.id);
    if (!input) return;

    result[field.id] = field.type === "checkbox"
      ? input.checked
      : input.value;
  });

  return result;
}

/* ==========================================
   COLLECT TRADE
========================================== */

async function collectTrade() {
  const attachments = await readAttachments();

  const id = editingTradeId || makeId();

  const existing = trades.find(trade =>
    String(trade.id) === String(id)
  );

  return {
    ...(existing || {}),
    id,

    date: $("tradeDate").value,
    voucherNumber: $("voucherNumber").value.trim(),
    stockName: $("stockName").value.trim(),
    capital: number($("capital").value),
    leverage: number($("leverage").value),
    strategy: $("strategy").value.trim(),
    riskReward: $("riskReward").value.trim(),
    tradeType: $("tradeType").value,
    tradeResult: $("tradeResult").value,

    buyQty: number($("buyQty").value),
    buyPrice: number($("buyPrice").value),
    buyStockValue: number($("buyStockValue").value),
    buyCharge: number($("buyCharge").value),
    extraBuyCharge: number($("extraBuyCharge").value),
    totalBuyCharges: number($("totalBuyCharges").value),
    totalBuyValue: number($("totalBuyValue").value),

    sellQty: number($("sellQty").value),
    sellPrice: number($("sellPrice").value),
    sellStockValue: number($("sellStockValue").value),
    sellCharge: number($("sellCharge").value),
    extraSellCharge: number($("extraSellCharge").value),
    totalSellCharges: number($("totalSellCharges").value),
    totalSellValue: number($("totalSellValue").value),
    priceMovement: number($("priceMovement").value),

    grossPL: number($("grossPLInput").value),
    totalCharges: number($("totalChargesInput").value),
    netPL: number($("netPLInput").value),

    customFields: collectCustomValues(),
    chartImages: attachments.chartImages,
    contractNote: attachments.contractNote,
    notes: $("notes").value,

    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
}

/* ==========================================
   SAVE TRADE
========================================== */

async function handleTradeSubmit(event) {
  event.preventDefault();

  try {
    calculateTrade();

    const trade = await collectTrade();

    if (!trade.stockName) {
      alert("Please enter Stock Name.");
      return;
    }

    await saveRecord(TRADE_STORE, trade);

    alert(editingTradeId ? "Trade updated successfully." : "Trade saved successfully.");

    resetTradeForm();
    await loadData();

    showSection("tradeJournalSection");
  } catch (error) {
    console.error(error);
    alert("Unable to save trade. Please check available storage space.");
  }
}

/* ==========================================
   RESET FORM
========================================== */

function resetTradeForm() {
  $("tradeForm").reset();

  $("tradeId").value = "";
  $("leverage").value = "1";
  $("tradeDate").value = new Date().toISOString().slice(0, 10);

  editingTradeId = null;
  currentAttachments = [];

  $("saveTradeBtn").textContent = "Save Trade";

  renderCustomFields();
  calculateTrade();
}

function setupFormButtons() {
  $("tradeForm")?.addEventListener("submit", handleTradeSubmit);

  $("newTradeBtn")?.addEventListener("click", () => {
    resetTradeForm();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("resetTradeBtn")?.addEventListener("click", resetTradeForm);
}

/* ==========================================
   DASHBOARD
========================================== */

function renderDashboard() {
  const total = trades.length;
  const wins = trades.filter(t => t.tradeResult === "Win").length;
  const losses = trades.filter(t => t.tradeResult === "Loss").length;

  const gross = trades.reduce((sum, t) => sum + number(t.grossPL), 0);
  const charges = trades.reduce((sum, t) => sum + number(t.totalCharges), 0);
  const net = trades.reduce((sum, t) => sum + number(t.netPL), 0);

  const winRate = total ? (wins / total) * 100 : 0;

  setText("totalTrades", total);
  setText("winningTrades", wins);
  setText("losingTrades", losses);
  setText("winRate", winRate.toFixed(1) + "%");

  setText("grossPL", money(gross));
  setText("totalCharges", money(charges));
  setText("netPL", money(net));

  setProfitClass("grossPL", gross);
  setProfitClass("netPL", net);
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function setProfitClass(id, value) {
  const element = $(id);
  if (!element) return;

  element.classList.remove("profit", "loss");

  if (value > 0) element.classList.add("profit");
  if (value < 0) element.classList.add("loss");
}

/* ==========================================
   JOURNAL DISPLAY HELPERS
========================================== */

function journalField(label, value) {
  return `
    <div class="journal-detail">
      <span class="journal-label">${escapeHTML(label)}</span>
      <strong class="journal-value">${escapeHTML(
        value === "" || value === null || value === undefined
          ? "—"
          : value
      )}</strong>
    </div>
  `;
}

function journalMoneyField(label, value, extraClass = "") {
  const amount = number(value);

  const resultClass = amount > 0
    ? "profit"
    : amount < 0
      ? "loss"
      : "";

  return `
    <div class="journal-detail ${extraClass} ${resultClass}">
      <span class="journal-label">${escapeHTML(label)}</span>
      <strong class="journal-value">${money(amount)}</strong>
    </div>
  `;
}

function journalSection(title, content) {
  return `
    <div class="journal-section">
      <h4>${escapeHTML(title)}</h4>
      <div class="journal-details-grid">
        ${content}
      </div>
    </div>
  `;
}

function formatDate(date) {
  if (!date) return "—";

  const parsed = new Date(date + "T00:00:00");

  if (Number.isNaN(parsed.getTime())) return date;

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getCustomFieldName(id) {
  const field = fields.find(item =>
    String(item.id) === String(id)
  );

  return field?.name || "Custom Field";
}

/* ==========================================
   JOURNAL CARD
========================================== */

function renderJournalCard(trade) {
  const general = [
    journalField("Stock Name", trade.stockName),
    journalField("Capital", money(trade.capital)),
    journalField("Leverage", trade.leverage),
    journalField("Risk Reward Ratio", trade.riskReward),
    journalField("Trade Type", trade.tradeType),
    journalField("Trade Result", trade.tradeResult)
  ].join("");

  const buy = [
    journalField("Buy Quantity", trade.buyQty),
    journalMoneyField("Buy Price", trade.buyPrice),
    journalMoneyField("Buy Stock Value", trade.buyStockValue),
    journalMoneyField("Buy Charges", trade.buyCharge),
    journalMoneyField("Extra Buy Charges", trade.extraBuyCharge),
    journalMoneyField("Total Buy Charges", trade.totalBuyCharges),
    journalMoneyField("Total Buy Value", trade.totalBuyValue)
  ].join("");

  const sell = [
    journalField("Sell Quantity", trade.sellQty),
    journalMoneyField("Sell Price", trade.sellPrice),
    journalMoneyField("Sell Stock Value", trade.sellStockValue),
    journalMoneyField("Sell Charges", trade.sellCharge),
    journalMoneyField("Extra Sell Charges", trade.extraSellCharge),
    journalMoneyField("Total Sell Charges", trade.totalSellCharges),
    journalMoneyField("Total Sell Value", trade.totalSellValue),
    journalMoneyField("Price Movement", trade.priceMovement)
  ].join("");

  const pnl = [
    journalMoneyField("Gross P&L", trade.grossPL),
    journalMoneyField("Total Charges", trade.totalCharges),
    journalMoneyField("Net P&L", trade.netPL, "journal-net-result")
  ].join("");

  const customValues = trade.customFields || {};
  const custom = Object.entries(customValues)
    .map(([id, value]) => {
      const displayValue = typeof value === "boolean"
        ? (value ? "Yes" : "No")
        : value;

      return journalField(getCustomFieldName(id), displayValue);
    })
    .join("");

  const attachmentItems = getTradeAttachments(trade);

  const attachments = attachmentItems.length
    ? `
      <div class="journal-attachment-list">
        ${attachmentItems.map((item, index) => `
          <div class="journal-attachment-item">
            <div>
              <strong>${escapeHTML(item.name || "Attachment")}</strong>
              <small>${escapeHTML(item.kind || "File")}</small>
            </div>
            <button type="button"
              class="journal-view-attachment"
              data-trade-id="${escapeHTML(trade.id)}"
              data-attachment-index="${index}">
              View
            </button>
          </div>
        `).join("")}
      </div>
    `
    : `<p class="journal-attachments-empty">No attachments added.</p>`;

  const resultClass = trade.tradeResult === "Win"
    ? "profit"
    : trade.tradeResult === "Loss"
      ? "loss"
      : "";

  const notes = trade.notes
    ? `<div class="journal-notes">${escapeHTML(trade.notes)}</div>`
    : `<p class="journal-attachments-empty">No notes added.</p>`;

  return `
    <article class="journal-card" data-trade-id="${escapeHTML(trade.id)}">

      <div class="journal-card-header">
        <div class="journal-top-meta">
          <div class="journal-meta-item">
            <span>Date</span>
            <strong>${escapeHTML(formatDate(trade.date))}</strong>
          </div>
          <div class="journal-meta-item">
            <span>Voucher Number</span>
            <strong>${escapeHTML(trade.voucherNumber || "—")}</strong>
          </div>
          <div class="journal-meta-item">
            <span>Strategy</span>
            <strong>${escapeHTML(trade.strategy || "—")}</strong>
          </div>
        </div>

        <span class="journal-result ${resultClass}">
          ${escapeHTML(trade.tradeResult || "Not Selected")}
        </span>
      </div>

      ${journalSection("General", general)}
      ${journalSection("BUY Details", buy)}
      ${journalSection("SELL Details", sell)}
      ${journalSection("Profit & Loss", pnl)}

      ${custom ? journalSection("Additional Details", custom) : ""}

      <div class="journal-section">
        <h4>Notes</h4>
        ${notes}
      </div>

      <div class="journal-section">
        <h4>Attachments</h4>
        ${attachments}
      </div>

      <div class="journal-card-actions">
        <button type="button" class="journal-delete-btn"
          data-action="delete" data-id="${escapeHTML(trade.id)}">
          Delete
        </button>
        <button type="button" class="journal-view-btn"
          data-action="view" data-id="${escapeHTML(trade.id)}">
          View
        </button>
        <button type="button" class="journal-edit-btn"
          data-action="edit" data-id="${escapeHTML(trade.id)}">
          Edit
        </button>
      </div>

    </article>
  `;
}

function renderJournal() {
  const container = $("journalCards");
  if (!container) return;

  setText("journalTradeCount", trades.length + " Trades");

  if (!trades.length) {
    container.innerHTML = `
      <div class="journal-empty-state">
        <h3>No Journal Entries</h3>
        <p>Save your first trade to see it here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = trades.map(renderJournalCard).join("");
}

/* ==========================================
   JOURNAL ACTIONS
========================================== */

async function handleJournalAction(event) {
  const button = event.target.closest("button");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  if (button.classList.contains("journal-view-attachment")) {
    const trade = trades.find(t => String(t.id) === String(button.dataset.tradeId));
    const attachments = trade ? getTradeAttachments(trade) : [];
    const attachment = attachments[number(button.dataset.attachmentIndex)];

    if (attachment) openSingleAttachment(attachment);
    return;
  }

  if (!id || !action) return;

  const trade = trades.find(t => String(t.id) === String(id));
  if (!trade) return;

  if (action === "delete") {
    if (!confirm("Delete this trade permanently?")) return;

    await deleteRecord(TRADE_STORE, trade.id);
    await loadData();
  }

  if (action === "edit") {
    editTrade(trade);
  }

  if (action === "view") {
    openJournalView(trade);
  }
}

function editTrade(trade) {
  editingTradeId = trade.id;

  const fieldsToRestore = {
    tradeId: trade.id,
    tradeDate: trade.date,
    voucherNumber: trade.voucherNumber,
    stockName: trade.stockName,
    capital: trade.capital,
    leverage: trade.leverage,
    strategy: trade.strategy,
    riskReward: trade.riskReward,
    tradeType: trade.tradeType,
    tradeResult: trade.tradeResult,

    buyQty: trade.buyQty,
    buyPrice: trade.buyPrice,
    buyStockValue: trade.buyStockValue,
    buyCharge: trade.buyCharge,
    extraBuyCharge: trade.extraBuyCharge,
    totalBuyCharges: trade.totalBuyCharges,
    totalBuyValue: trade.totalBuyValue,

    sellQty: trade.sellQty,
    sellPrice: trade.sellPrice,
    sellStockValue: trade.sellStockValue,
    sellCharge: trade.sellCharge,
    extraSellCharge: trade.extraSellCharge,
    totalSellCharges: trade.totalSellCharges,
    totalSellValue: trade.totalSellValue,
    priceMovement: trade.priceMovement,

    grossPLInput: trade.grossPL,
    totalChargesInput: trade.totalCharges,
    netPLInput: trade.netPL,
    notes: trade.notes
  };

  Object.entries(fieldsToRestore).forEach(([id, value]) => {
    if ($(id)) $(id).value = value ?? "";
  });

  currentAttachments = getTradeAttachments(trade);

  renderCustomFields(trade.customFields || {});

  $("saveTradeBtn").textContent = "Update Trade";

  showSection("tradeFormSection");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ==========================================
   VIEW ATTACHMENTS MODAL
========================================== */

function openJournalView(trade) {
  currentViewTrade = trade;

  $("journalViewModal").hidden = false;

  const attachments = getTradeAttachments(trade);

  $("viewContactNoteBtn").disabled =
    !attachments.some(item => item.kind === "contract");

  $("viewImageBtn").disabled =
    !attachments.some(item => item.kind === "chart" || item.kind === "image");
}

function closeJournalView() {
  $("journalViewModal").hidden = true;
  currentViewTrade = null;
}

function showAttachmentList(kind) {
  if (!currentViewTrade) return;

  const attachments = getTradeAttachments(currentViewTrade)
    .filter(item => kind === "contract"
      ? item.kind === "contract"
      : item.kind !== "contract"
    );

  $("attachmentViewerTitle").textContent =
    kind === "contract" ? "Contract Note" : "Chart Images";

  $("attachmentViewerContent").innerHTML = attachments.length
    ? attachments.map(renderAttachmentPreview).join("")
    : "<p>No attachments available.</p>";

  $("attachmentViewer").hidden = false;
}

function renderAttachmentPreview(item) {
  const data = item.data || item.url || "";

  if (!data) {
    return `<div class="attachment-view-item">
      <p>${escapeHTML(item.name || "Attachment")} cannot be previewed.</p>
    </div>`;
  }

  const isImage = (item.type || "").startsWith("image/") ||
    String(data).startsWith("data:image/");

  const isPDF = item.type === "application/pdf" ||
    String(data).startsWith("data:application/pdf");

  let preview = "";

  if (isImage) {
    preview = `<img class="attachment-preview-image"
      src="${data}" alt="${escapeHTML(item.name || "Image")}">`;
  } else if (isPDF) {
    preview = `<iframe class="attachment-preview-pdf"
      src="${data}" title="PDF preview"></iframe>`;
  } else {
    preview = `<p>Preview is not available for this file type.</p>`;
  }

  return `
    <div class="attachment-view-item">
      <strong>${escapeHTML(item.name || "Attachment")}</strong>
      ${preview}
    </div>
  `;
}

function openSingleAttachment(item) {
  $("attachmentViewerTitle").textContent = item.name || "Attachment";
  $("attachmentViewerContent").innerHTML = renderAttachmentPreview(item);
  $("attachmentViewer").hidden = false;
}

function setupJournalViewer() {
  $("journalCards")?.addEventListener("click", handleJournalAction);

  $("closeJournalViewBtn")?.addEventListener("click", closeJournalView);

  $("journalViewModal")?.addEventListener("click", event => {
    if (event.target === $("journalViewModal")) closeJournalView();
  });

  $("viewContactNoteBtn")?.addEventListener("click", () =>
    showAttachmentList("contract")
  );

  $("viewImageBtn")?.addEventListener("click", () =>
    showAttachmentList("chart")
  );

  $("closeAttachmentViewerBtn")?.addEventListener("click", () => {
    $("attachmentViewer").hidden = true;
  });

  $("attachmentViewer")?.addEventListener("click", event => {
    if (event.target === $("attachmentViewer")) {
      $("attachmentViewer").hidden = true;
    }
  });
}

/* ==========================================
   DYNAMIC FIELD MANAGER
========================================== */

function setupFieldManager() {
  $("adminBtn")?.addEventListener("click", () => {
    $("adminPanel").hidden = false;
    renderFieldList();
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  });

  $("closeAdminBtn")?.addEventListener("click", () => {
    $("adminPanel").hidden = true;
  });

  $("fieldForm")?.addEventListener("submit", saveField);

  $("cancelFieldEdit")?.addEventListener("click", resetFieldForm);
}

async function saveField(event) {
  event.preventDefault();

  const id = $("fieldId").value || makeId();
  const old = fields.find(field => String(field.id) === String(id));

  const field = {
    ...(old || {}),
    id,
    name: $("fieldName").value.trim(),
    type: $("fieldType").value,
    options: $("fieldOptions").value
      .split(",")
      .map(item => item.trim())
      .filter(Boolean),
    showForm: $("fieldInForm").checked,
    showHistory: true,
    required: $("fieldRequired").checked,
    active: true,
    createdAt: old?.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  if (!field.name) {
    alert("Enter a field name.");
    return;
  }

  await saveRecord(FIELD_STORE, field);

  await refreshFields();
  resetFieldForm();
}

async function refreshFields() {
  fields = await getAllRecords(FIELD_STORE);
  renderCustomFields();
  renderFieldList();
}

function resetFieldForm() {
  $("fieldForm").reset();
  $("fieldId").value = "";
  $("fieldInForm").checked = true;
  $("fieldRequired").checked = false;
}

function renderFieldList() {
  const container = $("fieldList");
  if (!container) return;

  if (!fields.length) {
    container.innerHTML = "<p>No custom fields created.</p>";
    return;
  }

  container.innerHTML = fields.map(field => `
    <div class="field-manager-item">
      <div>
        <strong>${escapeHTML(field.name)}</strong>
        <small>
          Type: ${escapeHTML(field.type)}
          · Form: ${field.showForm === false ? "No" : "Yes"}
          · Required: ${field.required ? "Yes" : "No"}
        </small>
      </div>
      <div class="field-manager-actions">
        <button type="button" data-field-action="edit"
          data-field-id="${escapeHTML(field.id)}">Edit</button>
        <button type="button" data-field-action="toggle"
          data-field-id="${escapeHTML(field.id)}">
          ${field.active === false ? "Enable" : "Disable"}
        </button>
        <button type="button" data-field-action="delete"
          data-field-id="${escapeHTML(field.id)}">Delete</button>
      </div>
    </div>
  `).join("");

  container.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () =>
      handleFieldAction(button.dataset.fieldAction, button.dataset.fieldId)
    );
  });
}

async function handleFieldAction(action, id) {
  const field = fields.find(item => String(item.id) === String(id));
  if (!field) return;

  if (action === "edit") {
    $("fieldId").value = field.id;
    $("fieldName").value = field.name;
    $("fieldType").value = isDropdownType(field.type) ? "dropdown" : field.type;
    $("fieldOptions").value = (field.options || []).join(",");
    $("fieldInForm").checked = field.showForm !== false;
    $("fieldRequired").checked = Boolean(field.required);

    $("fieldName").focus();
    return;
  }

  if (action === "toggle") {
    field.active = field.active === false;
    field.updatedAt = Date.now();
    await saveRecord(FIELD_STORE, field);
    await refreshFields();
    return;
  }

  if (action === "delete") {
    if (!confirm("Delete this custom field? Existing saved trade values will remain in the database.")) {
      return;
    }

    await deleteRecord(FIELD_STORE, field.id);
    await refreshFields();
  }
}

/* ==========================================
   BACKUP AND RESTORE
========================================== */

async function exportBackup() {
  const backupTrades = await getAllRecords(TRADE_STORE);
  const backupFields = await getAllRecords(FIELD_STORE);

  const backup = {
    app: "TradeLedger",
    version: 2,
    exportedAt: new Date().toISOString(),
    trades: backupTrades,
    fields: backupFields
  };

  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "TradeLedger-Backup-" +
    new Date().toISOString().slice(0, 10) + ".json";

  link.click();
  URL.revokeObjectURL(url);
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const content = await file.text();
    const backup = JSON.parse(content);

    if (!Array.isArray(backup.trades) || !Array.isArray(backup.fields)) {
      throw new Error("Invalid backup file.");
    }

    if (!confirm(
      "Import this backup? Matching IDs will be updated. Existing records with different IDs will remain."
    )) {
      event.target.value = "";
      return;
    }

    for (const trade of backup.trades) {
      if (trade && trade.id !== undefined) {
        await saveRecord(TRADE_STORE, trade);
      }
    }

    for (const field of backup.fields) {
      if (field && field.id !== undefined) {
        await saveRecord(FIELD_STORE, field);
      }
    }

    await loadData();
    await refreshFields();

    alert("Backup imported successfully.");
  } catch (error) {
    console.error(error);
    alert("Could not import this backup. Please select a valid TradeLedger backup.");
  }

  event.target.value = "";
}

function setupBackup() {
  $("exportBtn")?.addEventListener("click", exportBackup);
  $("importFile")?.addEventListener("change", importBackup);
}

/* ==========================================
   START APPLICATION
========================================== */

async function startApp() {
  try {
    await openDatabase();

    if ($("storageStatus")) {
      $("storageStatus").textContent = "● Offline Storage Ready";
    }

    setupTheme();
    setupNavigation();
    setupFieldManager();
    setupJournalViewer();
    setupFormButtons();
    setupCalculations();
    setupBackup();

    await refreshFields();
    await loadData();

    if (!$("tradeDate").value) {
      $("tradeDate").value = new Date().toISOString().slice(0, 10);
    }

    calculateTrade();

  } catch (error) {
    console.error("TradeLedger startup error:", error);

    if ($("storageStatus")) {
      $("storageStatus").textContent = "Storage Error";
    }

    alert("TradeLedger could not open its local database. Do not clear browser data. Please check the browser's storage permissions.");
  }
}

document.addEventListener("DOMContentLoaded", startApp);

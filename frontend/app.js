// Only thing you should need to change when pointing this at a different backend.
const API_BASE_URL = "http://localhost:4000";

// ---------- navigation ----------

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.hidden = el.id !== id;
  });
}

document.getElementById("btn-open-data").addEventListener("click", () => showScreen("screen-data"));
document.querySelectorAll(".btn-back").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.backTo));
});

// ---------- helpers ----------

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = body?.message || res.statusText;
    const code = body?.code ? ` (${body.code})` : "";
    throw new Error(`${message}${code}`);
  }
  return body;
}

function formatMoney(minorUnits) {
  return `$${(minorUnits / 100).toFixed(2)}`;
}

function setMessage(el, text, kind) {
  el.textContent = text;
  el.className = `form-message ${kind}`;
  el.hidden = !text;
}

// ---------- new order form: reference data ----------

let customers = [];
let addresses = [];
let products = [];

async function loadReferenceData() {
  const customerSelect = document.getElementById("field-customer");
  const addressSelect = document.getElementById("field-address");

  try {
    customers = await apiFetch("/customers");
    customerSelect.innerHTML = customers.length
      ? customers.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")
      : `<option value="" disabled selected>No customers found</option>`;
  } catch (err) {
    customerSelect.innerHTML = `<option value="" disabled selected>Failed to load</option>`;
    setMessage(document.getElementById("order-form-message"), `Could not load customers: ${err.message}`, "error");
  }

  try {
    addresses = await apiFetch("/addresses");
    addressSelect.innerHTML = addresses.length
      ? addresses.map((a) => `<option value="${a.address}">${a.address}</option>`).join("")
      : `<option value="" disabled selected>No addresses found</option>`;
  } catch (err) {
    addressSelect.innerHTML = `<option value="" disabled selected>Failed to load</option>`;
    setMessage(document.getElementById("order-form-message"), `Could not load addresses: ${err.message}`, "error");
  }

  try {
    products = await apiFetch("/products");
  } catch (err) {
    setMessage(document.getElementById("order-form-message"), `Could not load products: ${err.message}`, "error");
  }
}

// ---------- new order form: item rows ----------

const itemsList = document.getElementById("items-list");

function productOptionsHtml(selectedId) {
  if (!products.length) return `<option value="" disabled selected>No products found</option>`;
  return products
    .map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${p.name} — $${p.price}</option>`)
    .join("");
}

function addItemRow() {
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <select class="item-product" required>${productOptionsHtml()}</select>
    <input type="number" class="item-quantity" min="1" step="1" value="1" required />
    <button type="button" class="btn-remove-item" aria-label="Remove item">&times;</button>
  `;
  row.querySelector(".btn-remove-item").addEventListener("click", () => {
    if (itemsList.children.length > 1) row.remove();
  });
  itemsList.appendChild(row);
}

document.getElementById("btn-add-item").addEventListener("click", addItemRow);

// ---------- new order form: idempotency key ----------

const idempotencyKeyField = document.getElementById("field-idempotency-key");

function autofillIdempotencyKey() {
  idempotencyKeyField.value = crypto.randomUUID();
}

// ---------- new order form: submit ----------

const orderForm = document.getElementById("order-form");
const orderFormMessage = document.getElementById("order-form-message");

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const customerId = document.getElementById("field-customer").value;
  const shippingAddress = document.getElementById("field-address").value;
  const idempotencyKey = idempotencyKeyField.value.trim() || crypto.randomUUID();

  const items = Array.from(itemsList.querySelectorAll(".item-row")).map((row) => ({
    productId: row.querySelector(".item-product").value,
    quantity: Number(row.querySelector(".item-quantity").value),
  }));

  if (!customerId || !shippingAddress || items.some((i) => !i.productId)) {
    setMessage(orderFormMessage, "Please fill in all fields before submitting.", "error");
    return;
  }

  const submitBtn = document.getElementById("btn-submit-order");
  submitBtn.disabled = true;
  setMessage(orderFormMessage, "Creating order…", "info");

  try {
    const order = await apiFetch("/orders", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ customerId, shippingAddress, items }),
    });
    setMessage(orderFormMessage, `Order created: ${order.orderId} (${order.status})`, "success");
    autofillIdempotencyKey();
    await loadOrders();
  } catch (err) {
    setMessage(orderFormMessage, `Failed to create order: ${err.message}`, "error");
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- orders list ----------

const ordersList = document.getElementById("orders-list");
const ordersMessage = document.getElementById("orders-message");

function statusClass(status) {
  return `status-badge status-${status.toLowerCase().replace(/_/g, "-")}`;
}

async function loadOrders() {
  setMessage(ordersMessage, "", "info");
  try {
    const page = await apiFetch("/orders");
    renderOrders(page.items);
  } catch (err) {
    setMessage(ordersMessage, `Could not load orders: ${err.message}`, "error");
  }
}

function renderOrders(orders) {
  ordersList.innerHTML = "";
  if (!orders.length) {
    setMessage(ordersMessage, "No orders yet.", "info");
    return;
  }
  setMessage(ordersMessage, "", "info");

  orders.forEach((order) => {
    const li = document.createElement("li");
    li.className = "order-row";
    li.innerHTML = `
      <div class="order-row-summary">
        <span class="order-id">${order.orderId}</span>
        <span class="${statusClass(order.status)}">${order.status}</span>
        <span>${formatMoney(order.totalAmount)}</span>
      </div>
      <div class="order-detail" hidden></div>
    `;
    li.addEventListener("click", () => toggleOrderDetail(li, order.orderId));
    ordersList.appendChild(li);
  });
}

async function toggleOrderDetail(li, orderId) {
  const detail = li.querySelector(".order-detail");
  if (!detail.hidden) {
    detail.hidden = true;
    return;
  }
  detail.hidden = false;
  detail.textContent = "Loading…";
  try {
    const order = await apiFetch(`/orders/${orderId}`);
    detail.textContent = JSON.stringify(order, null, 2);
  } catch (err) {
    detail.textContent = `Failed to load details: ${err.message}`;
  }
}

document.getElementById("btn-refresh-orders").addEventListener("click", loadOrders);

// ---------- data screen ----------

function coordKey(latitude, longitude) {
  return `${String(latitude)},${String(longitude)}`;
}

async function loadWarehouseAddressContext() {
  const locations = await apiFetch(DATA_ENTITIES.locations.endpoint);
  const addressByCoords = new Map();
  for (const location of locations) {
    addressByCoords.set(coordKey(location.latitude, location.longitude), location.address);
  }
  return { addressByCoords };
}

function warehouseLabel(item, context) {
  const address = context?.addressByCoords.get(coordKey(item.latitude, item.longitude));
  return `${item.id} — ${address ? `${address} — ` : ""}(${item.latitude}, ${item.longitude})`;
}

const DATA_ENTITIES = {
  products: {
    label: "Products",
    endpoint: "/products",
    canDelete: false,
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "description", label: "Description", type: "text", required: false },
      { name: "price", label: "Price", type: "number", required: true },
    ],
    renderRow: (item) => `${item.name} — $${item.price}${item.description ? ` — ${item.description}` : ""}`,
  },
  locations: {
    label: "Locations",
    endpoint: "/addresses",
    canDelete: true,
    fields: [
      { name: "address", label: "Address", type: "text", required: true },
      { name: "latitude", label: "Latitude", type: "number", required: true },
      { name: "longitude", label: "Longitude", type: "number", required: true },
    ],
    renderRow: (item) => `${item.address} (${item.latitude}, ${item.longitude})`,
  },
  warehouses: {
    label: "Warehouses",
    endpoint: "/warehouses",
    canDelete: true,
    fields: [
      {
        name: "locationId",
        label: "Location",
        type: "select",
        required: true,
        source: "locations",
        optionValue: "id",
        optionLabel: "address",
        mapToFields: (item) => ({ latitude: item.latitude, longitude: item.longitude }),
      },
    ],
    loadRowContext: loadWarehouseAddressContext,
    renderRow: warehouseLabel,
  },
  stock: {
    label: "Stock",
    endpoint: "/stock",
    canDelete: false,
    fields: [
      {
        name: "warehouseId",
        label: "Warehouse",
        type: "select",
        required: true,
        source: "warehouses",
        optionValue: "id",
        optionLabel: warehouseLabel,
        loadOptionContext: loadWarehouseAddressContext,
      },
      { name: "productId", label: "Product", type: "select", required: true, source: "products", optionValue: "id", optionLabel: "name" },
      { name: "quantity", label: "Quantity", type: "number", required: true },
    ],
    renderRow: (item) => `Warehouse ${item.warehouseId} — Product ${item.productId} — qty ${item.quantity}`,
  },
  customers: {
    label: "Customers",
    endpoint: "/customers",
    canDelete: true,
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "creditCard", label: "Credit card", type: "select", required: true, source: "credit-cards", optionValue: "cardNumber", optionLabel: "cardNumber" },
    ],
    renderRow: (item) => `${item.name} — card ${item.creditCard}`,
  },
  "credit-cards": {
    label: "Credit Cards",
    endpoint: "/credit-cards",
    canDelete: true,
    fields: [
      { name: "cardNumber", label: "Card number", type: "text", required: true },
      { name: "status", label: "Status", type: "select", required: true, options: ["APPROVE", "DECLINE"] },
      { name: "declineReason", label: "Decline reason", type: "text", required: false },
    ],
    renderRow: (item) => `${item.cardNumber} — ${item.status}${item.declineReason ? ` (${item.declineReason})` : ""}`,
  },
};

function dataFieldId(tabKey, fieldName) {
  return `data-field-${tabKey}-${fieldName}`;
}

function entitySingularLabel(entity) {
  return entity.label.replace(/s$/, "");
}

async function renderDataForm(tabKey) {
  const entity = DATA_ENTITIES[tabKey];
  const container = document.getElementById("data-tab-content");

  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = `<h2>Add ${entitySingularLabel(entity)}</h2><form id="data-form-${tabKey}"></form>`;
  container.appendChild(card);

  const form = card.querySelector("form");
  const sourceItemsByField = {};

  for (const field of entity.fields) {
    const label = document.createElement("label");
    label.setAttribute("for", dataFieldId(tabKey, field.name));
    label.textContent = field.label;
    form.appendChild(label);

    if (field.type === "select") {
      const select = document.createElement("select");
      select.id = dataFieldId(tabKey, field.name);
      select.name = field.name;
      if (field.required) select.required = true;
      form.appendChild(select);

      if (field.options) {
        select.innerHTML = field.options.map((opt) => `<option value="${opt}">${opt}</option>`).join("");
      } else if (field.source) {
        select.innerHTML = `<option value="" disabled selected>Loading&hellip;</option>`;
        try {
          const items = await apiFetch(DATA_ENTITIES[field.source].endpoint);
          sourceItemsByField[field.name] = items;
          let optionContext;
          if (field.loadOptionContext) {
            try {
              optionContext = await field.loadOptionContext();
            } catch (err) {
              optionContext = undefined;
            }
          }
          const getOptionLabel =
            typeof field.optionLabel === "function"
              ? (it) => field.optionLabel(it, optionContext)
              : (it) => it[field.optionLabel];
          select.innerHTML = items.length
            ? items.map((it) => `<option value="${it[field.optionValue]}">${getOptionLabel(it)}</option>`).join("")
            : `<option value="" disabled selected>No options found</option>`;
        } catch (err) {
          select.innerHTML = `<option value="" disabled selected>Failed to load</option>`;
        }
      }
    } else {
      const input = document.createElement("input");
      input.type = field.type;
      input.id = dataFieldId(tabKey, field.name);
      input.name = field.name;
      if (field.required) input.required = true;
      if (field.type === "number") input.step = "any";
      form.appendChild(input);
    }
  }

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "primary-btn";
  submitBtn.textContent = `Add ${entitySingularLabel(entity)}`;
  form.appendChild(submitBtn);

  const message = document.createElement("p");
  message.className = "form-message";
  message.hidden = true;
  form.appendChild(message);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {};
    for (const field of entity.fields) {
      const value = document.getElementById(dataFieldId(tabKey, field.name)).value;
      if (!value) continue;
      if (field.mapToFields) {
        const items = sourceItemsByField[field.name] || [];
        const selected = items.find((it) => String(it[field.optionValue]) === value);
        if (selected) Object.assign(body, field.mapToFields(selected));
      } else {
        body[field.name] = field.type === "number" ? Number(value) : value;
      }
    }
    submitBtn.disabled = true;
    setMessage(message, "Saving…", "info");
    try {
      await apiFetch(entity.endpoint, { method: "POST", body: JSON.stringify(body) });
      setMessage(message, "Saved.", "success");
      form.reset();
      await fetchAndRenderDataList(tabKey);
    } catch (err) {
      setMessage(message, `Failed to save: ${err.message}`, "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function loadDataList(tabKey) {
  const entity = DATA_ENTITIES[tabKey];
  const container = document.getElementById("data-tab-content");

  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = `
    <div class="section-header">
      <h2>Existing ${entity.label}</h2>
      <button type="button" class="secondary-btn" id="data-refresh-${tabKey}">Refresh</button>
    </div>
    <p class="form-message" id="data-list-message-${tabKey}" hidden></p>
    <ul class="data-list" id="data-list-${tabKey}">LOADING</ul>
  `;
  container.appendChild(card);

  document.getElementById(`data-refresh-${tabKey}`).addEventListener("click", () => fetchAndRenderDataList(tabKey));

  await fetchAndRenderDataList(tabKey);
}

async function fetchAndRenderDataList(tabKey) {
  const entity = DATA_ENTITIES[tabKey];
  const list = document.getElementById(`data-list-${tabKey}`);
  const message = document.getElementById(`data-list-message-${tabKey}`);
  if (!list) return;
  list.textContent = "LOADING";
  setMessage(message, "", "info");

  try {
    const items = await apiFetch(entity.endpoint);
    let context;
    if (entity.loadRowContext) {
      try {
        context = await entity.loadRowContext();
      } catch (err) {
        context = undefined;
      }
    }
    list.innerHTML = "";
    if (!items.length) {
      setMessage(message, `No ${entity.label.toLowerCase()} yet.`, "info");
      return;
    }
    setMessage(message, "", "info");
    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "data-row";
      li.innerHTML = `
        <span class="data-row-info">${entity.renderRow(item, context)}</span>
        ${entity.canDelete ? `<button type="button" class="btn-remove-item" aria-label="Delete">&times;</button>` : ""}
      `;
      if (entity.canDelete) {
        li.querySelector(".btn-remove-item").addEventListener("click", async () => {
          try {
            await apiFetch(`${entity.endpoint}/${item.id}`, { method: "DELETE" });
            await fetchAndRenderDataList(tabKey);
          } catch (err) {
            setMessage(message, `Failed to delete: ${err.message}`, "error");
          }
        });
      }
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = "";
    setMessage(message, `Could not load ${entity.label.toLowerCase()}: ${err.message}`, "error");
  }
}

async function selectDataTab(tabKey) {
  document.querySelectorAll("#data-tabs .tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabKey);
  });
  const container = document.getElementById("data-tab-content");
  container.innerHTML = "";
  await renderDataForm(tabKey);
  await loadDataList(tabKey);
}

document.querySelectorAll("#data-tabs .tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => selectDataTab(btn.dataset.tab));
});

// ---------- init ----------

async function init() {
  autofillIdempotencyKey();
  await loadReferenceData();
  addItemRow();
  await loadOrders();
}

init();

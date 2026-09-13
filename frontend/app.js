// Only thing you should need to change when pointing this at a different backend.
const API_BASE_URL = "http://localhost:4000";

// ---------- navigation ----------

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.hidden = el.id !== id;
  });
}

document.getElementById("btn-open-settings").addEventListener("click", () => showScreen("screen-settings"));
document.getElementById("btn-open-testlab").addEventListener("click", () => showScreen("screen-testlab"));
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

// ---------- init ----------

autofillIdempotencyKey();
addItemRow();
loadReferenceData();
loadOrders();

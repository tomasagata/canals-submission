# Orders Service

An order-processing service built around three properties: a retried request
never creates a second order, a redelivered background job never charges a card
or decrements stock twice, and no order can be stranded in a half-finished state
by a crash.

There is no application-level distributed lock anywhere. Every guarantee below
comes from atomic database operations — unique indexes, compare-and-swap
updates, and transactions — which is what makes the system safe across any
number of instances without coordination.

---

## Prerequisites

**MongoDB must run as a replica set.** Every write path uses a multi-document
transaction, and MongoDB only offers transactions on a replica set. One node is
enough:

```bash
mongod --replSet rs0 --dbpath /your/data/path
mongosh --eval 'rs.initiate()'
mongosh --eval 'rs.status()'      # confirm before starting the app
```

Then point `MONGO_URI` at it with `?replicaSet=rs0&directConnection=true`. The
app verifies this at boot and refuses to start with an explicit message, rather
than failing cryptically on the first request.

Redis is also required (BullMQ). See `.env.example` for every setting.

```bash
npm install
cp .env.example .env
npm run start:dev
```

---

## Architecture

```
POST /orders ──txn{ Order:PENDING , Outbox:NEW }──> 202 Accepted
                              │                     { orderId, status, self }
                 OutboxRelayService (polls, 1s)
                 claimNext() ──> queue.add() ──> markDispatched()
                              │
                 OrderSagaProcessor (BullMQ)
                 reserve stock ──> authorize payment ──> complete
                              │
                 OrderReconciliationService (@Cron, 30s)
                 claim stale order ──> ask the PSP what really happened
```

The request path does no third-party work at all. It validates, prices, and
durably records the order — then returns. Everything else happens behind it.

### Status machine

```
            ┌─ FAILED (terminal; nothing was reserved)
PENDING ────┤
            └─ STOCK_RESERVED ─┬─ PAYMENT_AUTHORIZED ── COMPLETED (terminal)
                               └─ COMPENSATING ── COMPENSATED (terminal)
```

Every transition is a compare-and-swap conditioned on the exact expected prior
status (`OrdersRepository.transition`). A `null` result means another actor —
another delivery, or the sweeper — already advanced this order and now owns
finishing it, so the caller stops without side effects. This single primitive is
what lets the worker and the sweeper both act on the same order at the same time
without a lock.

`COMPENSATING` is a state rather than an implicit property of `FAILED`, so
"a release is owed" is explicit, indexable, and survives a crash mid-release.

---

## 1. Idempotency at the API layer

`POST /orders` requires an `Idempotency-Key` header.

| Case | Response |
|---|---|
| Missing or blank key | `400 IDEMPOTENCY_KEY_REQUIRED` |
| Invalid body | `400` (global `ValidationPipe`) |
| Unknown customer / product / address | `422` with a specific code |
| New key | `202` — `{ orderId, status: PENDING, self }` |
| Duplicate key, same body | `202` — the same order, in whatever state it has reached |
| Duplicate key, different body | `422 IDEMPOTENCY_KEY_REUSED` |
| Duplicate key, winner still committing | `409 REQUEST_IN_PROGRESS` (rare; always resolves on retry) |

**Why 202 for both the new and the duplicate case, and never 409 for a settled
duplicate.** The contract of an idempotency key is that a retry is
indistinguishable from the original. The moment a replay returns a different
status code, every client must branch on the path it tests least. `200` on a
terminal duplicate would be worse still: it implies the body is the settled
resource, which it is not — `GET /orders/:id` is.

**Enforcement is a unique index, not a check.** `{customerId, idempotencyKey}`
is unique. A read-then-write check cannot work here, because ten concurrent
requests can all pass it; only the database can arbitrate. The insert is
attempted, `E11000` is caught, and the winner's order is returned.

Two details in that path are easy to get wrong and are handled explicitly:

- The duplicate-key check is **narrowed to the index** (`isDuplicateKeyError(err,
  'idempotencyKey')`). The accept transaction writes to two collections, and a
  collision on the outbox index means something entirely different — it must not
  be quietly reinterpreted as "someone else won".
- A unique index rejects a duplicate as soon as the winning transaction *holds*
  the key, which is **before** that transaction commits. Reading immediately
  after catching `E11000` can therefore legitimately find nothing. `awaitWinner`
  waits out that commit window with a short bounded backoff; only if the order
  never appears — meaning the winner aborted — does the caller get a `409`
  telling them to retry.

**Request fingerprinting.** A sha256 of the canonicalised body is stored on the
order. Without it, a key replayed with different content silently returns an
unrelated order — a data-integrity bug wearing an idempotency costume. Item
order and key order don't affect the hash, so a genuine retry still matches.

---

## 2. Transactional outbox

The order and an `ORDER_CREATED` outbox event are written in **one transaction**
(`OrdersService.acceptOrder`). They commit together or not at all, which closes
both failure modes: there is no window where an order exists that nothing will
process, and none where an event announces an order that was rolled back.

`OutboxRelayService` polls, claims a row atomically (`claimNext` — one
`findOneAndUpdate`, so exactly one relay wins each row), enqueues the job, and
marks it dispatched. Failures back off on the row itself; a row that exhausts
`ORDER_OUTBOX_MAX_ATTEMPTS` is marked `FAILED` and is an alertable condition.

**Polling rather than a change stream**, deliberately: the relay must retry with
backoff and must pick up rows written while it was down. A change stream gives
neither — it needs a persisted resume token and *still* needs a polling fallback
for the window where that token ages out of the oplog. That's two mechanisms to
do one job, and a change stream needs a replica set anyway.

---

## 3. The saga worker

`OrderSagaProcessor` drives the order forward, re-reading it between every step
because the sweeper (or another delivery) may have advanced it mid-flight.

**Our internal `orderId` is passed as the idempotency key to both the warehouse
and the PSP.** That is what makes redelivery free:

| Step | At-least-once hazard | Defence |
|---|---|---|
| reserve | double decrement | unique `{orderId, RESERVE}` written in the same transaction as the `$inc` |
| authorize | double charge | PSP ledger unique on `idempotencyKey = orderId`; a replay returns the original result |
| complete | none | CAS from `PAYMENT_AUTHORIZED` |
| release | double credit | unique `{orderId, RELEASE}` written in the same transaction as the `$inc` |
| any | acting on a settled order | terminal check at the top of the loop + CAS on every write |

### The reservation ledger

`$inc` is not idempotent and a queue redelivers, so the **decision** to move
stock is recorded as a uniquely-indexed `stock_movements` document written
inside the same transaction as the quantity change. A replayed job collides with
that index, which aborts its transaction before any quantity moves. Stock and
ledger can never disagree, and every quantity change in the system has exactly
one row explaining which order caused it.

One subtlety worth flagging: a duplicate-key error raised *inside* an open
transaction aborts it server-side and cannot be caught and recovered from there.
`releaseForOrder` therefore reads first inside the transaction and handles a
genuine race as an abort caught outside it.

### When retries are exhausted

Nothing special happens — deliberately. A job that has failed five times with
backoff has failed against a backend we evidently cannot reach, which makes the
worker the component *least* qualified to decide the order's fate. The order is
left non-terminal for reconciliation to resolve against the PSP's actual record.

`jobId` deduplication is an optimisation only, never relied on for correctness:
`removeOnComplete` eventually frees the id.

---

## 4. Active reconciliation

`@Cron` every 30 seconds, scanning each non-terminal state for orders untouched
for longer than `ORDER_STALE_AFTER_MS` (default 5 minutes):

- **`PENDING`** → `FAILED`. Nothing was reserved or charged. A defensive
  `releaseForOrder` follows, which is a no-op unless a worker's reservation
  committed in the instant before the CAS landed.
- **`STOCK_RESERVED`** → ask the PSP via `getByIdempotencyKey(orderId)`.
  A recorded success means the worker charged the card and died before recording
  it, so the order is driven forward to `COMPLETED`. A decline, or no record at
  all, means the stock is owed back: `COMPENSATING` → release → `COMPENSATED`.
- **`PAYMENT_AUTHORIZED`** → `COMPLETED`. Money taken, stock reserved, nothing
  left to decide.
- **`COMPENSATING`** → release (idempotent) → `COMPENSATED`.

That second case is the one the whole architecture exists for, and it is why the
mock PSP grew both an idempotency key and a status lookup. Without the lookup the
only safe assumption for a stuck order is failure — which would release stock for
an order the customer has already paid for.

**Running on every instance is safe.** Each order is claimed by a single atomic
`findOneAndUpdate`, and every state change is a CAS. Even if a claim were
bypassed entirely — clock skew, a lease expiring mid-work — the ledgers make the
duplicated work a no-op. **The lease is rate limiting and defence in depth; it is
not the correctness boundary.**

---

## Testing

```bash
npm test         # unit — fast, no I/O
npm run test:int # integration — real transactions against an in-memory replica set
npm run lint
```

The integration suite is where the real guarantees are proven, because every one
of them is a *database* behaviour; asserting them against mocked models would
only prove the mocks behave as written. It boots a `MongoMemoryReplSet` and
covers, among others:

- ten concurrent requests with one key → exactly one order, one outbox event;
- a key reused with a different body → `422`, nothing created;
- three redeliveries of one job → one charge, one decrement, `COMPLETED`;
- a declined payment replayed twice then swept → stock back to its original
  level, *not above it*, and exactly one `RELEASE` movement;
- two orders competing for the last three units → one `COMPLETED`, one `FAILED`,
  stock exactly `0`;
- sweeper and worker racing the same order → one settles it, no duplicated
  side effect, stock consistent with whichever won;
- **a successful charge whose response is lost** → the order strands in
  `STOCK_RESERVED` with no `paymentResult`, and the sweeper recovers it to
  `COMPLETED` with the *same* `transactionId` and exactly one charge.

Tests invoke `OrderSagaProcessor.process()`, `OutboxRelayService.tick()` and
`OrderReconciliationService.sweep()` directly rather than waiting on timers and
a broker — more precise, and no Redis needed.

---

## Trade-offs and known gaps

- **Stale `PENDING` orders are failed at the 5-minute mark.** This is a
  deliberate choice of a single deadline. The cost is that a worker outage or
  queue backlog longer than `ORDER_STALE_AFTER_MS` will fail orders that nothing
  was actually wrong with, so that value must stay comfortably above the
  worker's whole retry budget. Failing closed is the safe direction — nothing
  was reserved or charged, and the customer can retry. An alternative worth
  considering under sustained load is to re-drive at 5 minutes and only fail at
  a separate, longer hard deadline.
- **Reserve-before-charge holds stock hostage to queue latency.** A backlog ties
  up inventory, and the sweeper deadline is effectively a reservation TTL. The
  alternative — charging first — means refunds, which are strictly worse to
  operate than restocks.
- **Idempotency-key scoping is nominal.** There is no authentication, so
  `customerId` is caller-supplied. With real auth the unique index would be
  `{principalId, idempotencyKey}`.
- **Idempotency keys never expire.** The `orders` collection doubles as an
  idempotency store and grows unbounded; a real system would TTL it at ~24h.
- **`PAYMENT_AUTHORIZED → COMPENSATING` would imply a refund** the mock PSP
  cannot perform. It should be unreachable in the current design; it is logged
  loudly as manual intervention rather than faked.
- **The relay and sweeper run on every instance**, which is safe but multiplies
  the polling load. `ORDER_SAGA_WORKER_ENABLED=false` already allows API-only
  processes; the same treatment for the relay and sweeper is the fix at scale.
- **Money is stored in integer minor units.** The previous float `totalAmount`
  was a rounding bug waiting to happen.

### Fixed along the way

Three latent defects prevented the application from booting at all and were
fixed first, before any refactoring: `CustomersModule` declared no providers and
no exports, `InventoryModule` never exported `InventoryService`, and
`ConfigModule` was not global while `GeocodingService` injected `ConfigService`.
`$geoNear` was also being executed inside a multi-document transaction, which
MongoDB rejects; warehouse ranking is now a read-only query outside the
transaction, where it belongs — all of the safety lives in the conditional
decrement.

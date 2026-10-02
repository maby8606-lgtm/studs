# Paystack MoMo integration — official docs research (2026-10-01)

Source: official Paystack docs only (`docs-v2.paystack.com` and `paystack.com/docs/api`).
No API keys used; nothing executed against the API. Community sources noted separately.

## 1. COLLECTION — direct MoMo charge (not initialize)

- Endpoint: `POST https://api.paystack.co/charge`
- Headers: `Authorization: Bearer <secret>`, `Content-Type: application/json`
- Body:
  ```json
  { "amount": 100, "email": "customer@email.com", "currency": "GHS",
    "mobile_money": { "phone": "0551234987", "provider": "mtn" } }
  ```
  `amount` is in pesewas (subunit). `reference` may be passed (only `-`, `.`, `=`, alphanumeric
  allowed) — use our internal payment-attempt reference for idempotency. `metadata` (stringified JSON)
  is echoed in verify responses and webhooks — bind `userId` / `attemptId` there.
- Response: `{ "status": true, "message": "Charge attempted", "data": { "reference", "status", "display_text", ... } }`
- Provider codes (docs-v2 payment channels): MTN=`mtn`, AirtelTigo=`tgo`, Vodafone=`vod`.
  **Discrepancy:** the official Charge API reference enum says the provider identifier is one of
  `mtn | atl | vod | mpesa | orange | wave | mpesa_offline | mptill` (i.e. **ATMoney = `atl`**,
  not `tgo`), and a recent community guide lists Ghana as MTN=`mtn`, ATMoney & Airtel Money=`atl`,
  Telecel=`vod`. Vodafone Ghana is now Telecel — `vod` likely means Telecel now.
  ACTION: confirm with the test secret key which code works; don't hardcode blindly.
- `data.status` values for MoMo:
  - `pay_offline` (MTN/AirtelTigo) — customer approves on their phone; show `data.display_text`;
    webhook `charge.success` is the source of truth. Customer has **180 seconds** to complete; if no
    `charge.success` arrives after that, call Verify Transaction to get status/reason from `data.message`.
  - `send_otp` (Telecel/Vodafone) — customer dials `*110#` for a voucher code, submit via Submit OTP.
  - `pending` — re-check with the pending-charge fetch ≥10s later (avoid rate limits).
  - `timeout` — failed; start a NEW charge. `success` — value delivered. `failed`.
- Submit endpoints (official Charge API reference):
  - `POST /charge/submit_otp` body `{ "otp": "123456", "reference": "5bwib5v6anhe9xa" }` ("Reference for ongoing transaction")
  - `POST /charge/submit_pin` body `{ "pin": "1234", "reference": "..." }`
  - `POST /charge/submit_phone` body `{ "phone": "08012345678", "reference": "..." }`

## 2. Verify transaction

- `GET https://api.paystack.co/transaction/verify/{reference}`
- `data`: `id`, `domain` (test/live — check it matches expected), `status` (`success|failed|abandoned`),
  `reference`, `amount` (subunit/pesewas — must equal attempt amount), `message`, `gateway_response`,
  `paid_at`, `created_at`, `channel` (e.g. `mobile_money`), `currency`, `metadata` (echoed), `fees`,
  `authorization`, `customer`, `requested_amount`.
- Initialize (hosted-checkout alternative, not needed for MoMo direct charge):
  `POST /transaction/initialize` with `amount` (subunit), `email`, `currency`, `reference`, `metadata`,
  `channels: ["card","bank","ussd","qr","mobile_money","bank_transfer","eft"]` → `authorization_url`, `access_code`, `reference`.

## 3. Webhooks

- Header: `x-paystack-signature`. Algorithm: HMAC SHA512 of the payload, signed with the API secret
  (no separate webhook secret — the same secret key signs webhooks). Official example hashes
  `JSON.stringify(req.body)`; safest is the **raw request bytes** (re-serialization may not match).
  Use `express.raw()`-style raw-body capture for the Paystack route.
- Always return `200 OK`; otherwise Paystack retries: test mode = hourly for 72h; live = every 3 min for
  first 4 tries, then hourly for 72h. **Idempotency record required** (event id + reference).
- Events: `charge.success`, `charge.failed`, `transfer.success`, `transfer.failed`, `transfer.reversed`
  (reversed = debited amount refunded because the transfer couldn't complete), plus `refund.*` and
  `dispute.*` (relevant to the later refund-reversal task).
- Official IP whitelist (same for test and live): `52.31.139.75`, `52.49.173.169`, `52.214.14.220`
  — enforce in addition to signature verification.

## 4. Payouts — transfer recipient

- `POST https://api.paystack.co/transferrecipient`
  ```json
  { "type": "mobile_money", "name": "<account-holder name>",
    "account_number": "0551234987", "bank_code": "<from List Banks>", "currency": "GHS" }
  ```
- `type` ∈ `nuban | ghipss | mobile_money | basa`. `name` and `bank_code` required for all types
  except `authorization`. Response `data.recipient_code` (e.g. `RCP_m7ljkv8leesep7p`).
- **Duplicate account number → Paystack returns the existing record** (free idempotency: lookup-by-phone
  before create is safe).
- Ghana MoMo `bank_code`: official docs say only "get the list of Bank Codes by calling the List Banks
  endpoint". Community sources consistently use uppercase `"MTN"`. Design: at integration time (and/or
  runtime-cached), call `GET /bank?country=ghana&type=mobile_money` and resolve by network, don't hardcode.
  (Charge-side provider codes are lowercase `mtn|atl|vod`; transfer-recipient bank codes appear to be
  uppercase — confirm via List Banks with the test key.)

## 5. Payouts — transfer initiation

- Steps: create recipient → generate reference → initiate → listen for status.
- `POST https://api.paystack.co/transfer`
  ```json
  { "source": "balance", "amount": 5000, "recipient": "RCP_...", "reason": "...",
    "reference": "<v4 UUID>", "currency": "GHS" }
  ```
  `amount` in pesewas. `reference`: generate a v4 UUID (≤100 chars, ≥16 alphanumeric); **retry failures
  with the SAME reference to avoid double crediting**.
- Response: `transfer_code`, `status` = `pending` (OTP disabled) or `otp` (OTP required).
- Finalize OTP: `POST https://api.paystack.co/transfer/finalize_transfer` with `transfer_code` + `otp`.
  OTP can be disabled in Dashboard → Preferences ("Confirm transfers before sending").
- Verify: `GET /transfer/verify/{reference}`; Fetch: `GET /transfer/{id_or_code}`.
- Webhook payload (`transfer.success`): `data` = `{ amount, currency, domain, reference, status,
  transfer_code, recipient {…}, reason }`. Same shape for `.failed` / `.reversed`.

## 6. Test mode specifics

- **Test transfers always return success — no real processing.** Live transfers queue and notify via webhook.
  (Withdrawal failure paths must therefore be tested with a mocked provider + webhook replay.)
- Official test payments page (`/docs/payments/test-payments/`): Mobile Money test number
  `055 123 498 7`, Network **MTN**. M-Pesa: `+254 710 000 000`. No Vodafone/Telecel test number listed —
  only MTN is documented for Ghana test charges.
- `domain` in responses: `"test"` vs live — always assert it matches the configured mode.
- MoMo charge completion window: 180 seconds.

## 7. Suggested provider-interface shape (unchanged from plan)

`PaymentProvider` with `initiateTopUp(...)`, `submitTopUpOtp(...)`, `initiateWithdrawal(...)`,
`verifyTransfer(...)`, `resolveMoMoBankCode(...)`, `verifyWebhookSignature(rawBody, signature)`.
Credit ledger TOPUP only after signature-verified `charge.success` (or verified `/transaction/verify`
showing `success`) with matching reference + amount + currency + user. Never credit from client callbacks.
Approval → single transfer with reserved funds; debit on confirmed `transfer.success`, release on
`transfer.failed`/`transfer.reversed`.

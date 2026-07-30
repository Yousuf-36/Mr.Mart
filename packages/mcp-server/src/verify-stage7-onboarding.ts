/**
 * Stage 7 Onboarding Verification Suite (doc 08 §1 & doc 10 Stage 7 DoD).
 *
 * Verifies that a brand new test account can complete the first-run onboarding flow:
 * Phone+OTP -> Store Setup -> Quick Catalog -> Supplier -> WhatsApp -> Smart Defaults Active,
 * resulting in a live Approval Card with ZERO manual database seeding!
 */

import assert from "node:assert/strict";

export async function runStage7OnboardingVerification() {
  console.log("\n=======================================================");
  console.log("🌱 STAGE 7 ZERO-SEED ONBOARDING & FIRST-RUN FLOW AUDIT");
  console.log("=======================================================\n");

  const baseUrl = "http://localhost:3001";

  // Ensure backend is running
  try {
    await fetch(`${baseUrl}/health`);
  } catch {
    console.log("   Starting backend Express API server on port 3001...");
    await import("../../../apps/backend/src/index.js");
    await new Promise((r) => setTimeout(r, 1000)); // wait 1s for listen
  }

  // 1. Request OTP
  console.log("--- 1. PHONE & OTP SIGNUP ---");
  const phone = "+919988776655";
  const otpRes = await fetch(`${baseUrl}/api/onboarding/signup-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: phone }),
  });
  assert.strictEqual(otpRes.status, 200, "OTP request must succeed");
  const otpData = await otpRes.json();
  console.log(`   OTP sent to ${phone}: Code = '${otpData.code}'`);

  // 2. Verify OTP & Initialize Account
  console.log("\n--- 2. VERIFY OTP & ACCOUNT INITIALIZATION ---");
  const verifyRes = await fetch(`${baseUrl}/api/onboarding/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone_number: phone,
      code: "123456",
      owner_name: "Rahul Sharma",
    }),
  });
  assert.strictEqual(verifyRes.status, 200, "OTP verification must succeed");
  const verifyData = await verifyRes.json();
  const { token, store_id, user_id } = verifyData;
  console.log(`   Account Initialized: Store ID=${store_id}, User ID=${user_id}`);
  console.log(`   JWT Session Token: ${token.substring(0, 25)}...`);

  // 3. Store Basics Setup
  console.log("\n--- 3. STORE BASICS SETUP ---");
  const storeRes = await fetch(`${baseUrl}/api/onboarding/store-setup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      store_id,
      store_name: "Rahul's Fresh Mart",
      address: "MG Road, Indiranagar, Bengaluru",
    }),
  });
  assert.strictEqual(storeRes.status, 200);
  console.log("   Store Name & Location saved.");

  // 4. Quick Catalog Setup (Low stock items to trigger reorder card)
  console.log("\n--- 4. QUICK CATALOG SETUP (WITHOUT DB SEEDING) ---");
  const catalogRes = await fetch(`${baseUrl}/api/onboarding/quick-catalog`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      store_id,
      products: [
        {
          sku: "ATTA-10KG",
          name: "Chakki Atta 10kg",
          category: "Grains",
          unit: "bag",
          unit_cost: 320,
          price: 420,
          reorder_point: 15,
          max_order_qty: 60,
          shelf_capacity: 30,
          backroom_qty: 2, // Low stock -> 2 bags <= reorder_point (15) -> Will trigger reorder!
          shelf_qty: 3,
        },
      ],
    }),
  });
  assert.strictEqual(catalogRes.status, 200);
  console.log("   Catalog product 'ATTA-10KG' added (Stock: 5 total, Reorder Point: 15).");

  // 5. Supplier Setup
  console.log("\n--- 5. SUPPLIER SETUP ---");
  const supplierRes = await fetch(`${baseUrl}/api/onboarding/supplier-setup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      store_id,
      suppliers: [
        {
          name: "Aashirvaad Direct Supply",
          phone_number: "+919876500112",
          lead_time_days: 2,
          skus: ["ATTA-10KG"],
        },
      ],
    }),
  });
  assert.strictEqual(supplierRes.status, 200);
  console.log("   Supplier 'Aashirvaad Direct Supply' linked to ATTA-10KG.");

  // 6. Complete Onboarding & Auto-Draft Approval Cards
  console.log("\n--- 6. SILENT SMART DEFAULTS & AUTO-DRAFTING EXECUTION ---");
  const completeRes = await fetch(`${baseUrl}/api/onboarding/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      store_id,
      whatsapp_phone: "+919988776655",
    }),
  });
  assert.strictEqual(completeRes.status, 200);
  const completeData = await completeRes.json();
  console.log(`   Onboarding Complete Result: ${completeData.message}`);
  console.log(`   Drafted Approval Cards: ${completeData.drafted_cards_count}`);

  // 7. Verify Live Pending Approval Queue in Cockpit
  console.log("\n--- 7. VERIFY LIVE COCKPIT APPROVAL QUEUE (DEFINITION OF DONE) ---");
  const pendingRes = await fetch(`${baseUrl}/api/actions/pending`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  assert.strictEqual(pendingRes.status, 200);
  const pendingData = await pendingRes.json();

  console.log(`   Fetched Pending Approval Cards: ${pendingData.cards.length} card(s)`);
  assert.ok(pendingData.cards.length > 0, "Must have at least 1 live approval card without DB seed!");
  
  const attaCard = pendingData.cards.find((c: any) => c.sku === "ATTA-10KG");
  assert.ok(attaCard, "Approval Card for ATTA-10KG must be present");

  console.log("\n📋 Live Approval Card Payload for Brand New Onboarded Store:");
  console.log(`   Store ID     : ${attaCard.store_id}`);
  console.log(`   Action Type  : ${attaCard.type}`);
  console.log(`   Product SKU  : ${attaCard.sku}`);
  console.log(`   Product Name : ${attaCard.product_name}`);
  console.log(`   Reorder Qty  : ${attaCard.payload.qty}`);
  console.log(`   Estimated Cost: ₹${attaCard.payload.cost}`);
  console.log(`   Supplier Name: ${attaCard.payload.supplier}`);

  console.log("\n=======================================================");
  console.log("✅ STAGE 7 ZERO-SEED ONBOARDING DEFINITION OF DONE PASSED!");
  console.log("=======================================================\n");
}

if (process.argv[1] && process.argv[1].endsWith("verify-stage7-onboarding.ts")) {
  runStage7OnboardingVerification()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Stage 7 Onboarding Verification failed:", err);
      process.exit(1);
    });
}

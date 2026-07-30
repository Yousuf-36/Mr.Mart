/**
 * Computer Vision & Camera Ingestion Adapter (Stage 7).
 * Ingests camera telemetry for shelf stockouts and checkout queue congestion.
 * Ref: doc 01 §10 & doc 10 Stage 7 (Note: docs/07 is Testing & QA Plan).
 */

import {
  createShelfFlagDb,
  hasUnclearedShelfFlag,
  createPendingActionDb,
  hasPendingAction,
  DEFAULT_STORE_ID,
} from "../store/pg-store.js";

export interface ShelfCameraPayload {
  store_id?: string;
  camera_id?: string;
  sku: string;
  detected_qty: number;
  location?: string;
  timestamp?: string;
}

export interface CheckoutCameraPayload {
  store_id?: string;
  active_lanes: number;
  people_in_queue: number;
  timestamp?: string;
}

export class VisionAdapter {
  /** Ingests shelf camera telemetry and inserts shelf_flags when stock is depleted */
  async processShelfCameraPayload(payload: ShelfCameraPayload): Promise<{
    status: "flagged" | "already_flagged" | "ok";
    flag_id?: string;
    sku: string;
    detected_qty: number;
    reason?: string;
  }> {
    const storeId = payload.store_id || DEFAULT_STORE_ID;
    const sku = payload.sku;
    const detectedQty = payload.detected_qty;

    if (detectedQty <= 2) {
      const exists = await hasUnclearedShelfFlag(sku, storeId);
      if (exists) {
        console.log(`[Vision Adapter] Camera ${payload.camera_id || "CAM-01"} reported low stock on ${sku} (${detectedQty} units) — flag already active.`);
        return {
          status: "already_flagged",
          sku,
          detected_qty: detectedQty,
          reason: "Uncleared shelf flag already active",
        };
      }

      const flag = await createShelfFlagDb(sku, storeId, payload.location || "Aisle Shelf", "camera");
      console.log(`[Vision Adapter] Camera ${payload.camera_id || "CAM-01"} triggered shelf flag for ${sku} (detected: ${detectedQty} units) [Flag ID: ${flag.id}]`);
      return {
        status: "flagged",
        flag_id: flag.id,
        sku,
        detected_qty: detectedQty,
      };
    }

    return {
      status: "ok",
      sku,
      detected_qty: detectedQty,
      reason: "Shelf stock level sufficient",
    };
  }

  /** Ingests checkout queue camera telemetry and drafts queue_alert staffing actions */
  async processCheckoutCameraPayload(payload: CheckoutCameraPayload): Promise<{
    status: "alert_drafted" | "already_alerted" | "ok";
    action_id?: string;
    ratio: number;
    active_lanes: number;
    people_in_queue: number;
  }> {
    const storeId = payload.store_id || DEFAULT_STORE_ID;
    const activeLanes = Math.max(payload.active_lanes, 1);
    const peopleInQueue = payload.people_in_queue;
    const ratio = parseFloat((peopleInQueue / activeLanes).toFixed(2));

    // Threshold: ratio > 4.0 people per open lane triggers staffing alert
    if (ratio > 4.0) {
      const exists = await hasPendingAction(null, "queue_alert", storeId);
      if (exists) {
        console.log(`[Vision Adapter] Checkout queue ratio high (${ratio}) — queue alert already pending.`);
        return {
          status: "already_alerted",
          ratio,
          active_lanes: activeLanes,
          people_in_queue: peopleInQueue,
        };
      }

      const action = await createPendingActionDb(
        "queue_alert",
        null,
        {
          active_lanes: activeLanes,
          people_in_queue: peopleInQueue,
          ratio,
          alert: `High checkout congestion detected (${ratio} customer/lane) — open additional checkout lane`,
        },
        storeId
      );

      console.log(`[Vision Adapter] Checkout queue alert drafted: ${peopleInQueue} people across ${activeLanes} lanes (ratio ${ratio}) [Action ID: ${action.id}]`);
      return {
        status: "alert_drafted",
        action_id: action.id,
        ratio,
        active_lanes: activeLanes,
        people_in_queue: peopleInQueue,
      };
    }

    return {
      status: "ok",
      ratio,
      active_lanes: activeLanes,
      people_in_queue: peopleInQueue,
    };
  }
}

export const visionAdapter = new VisionAdapter();

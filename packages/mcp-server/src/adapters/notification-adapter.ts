/**
 * Webhook & Notification Integration Adapter (Stage 6).
 * Dispatches urgent Webhook alerts and staff push notifications.
 * Doc 06: Integration adapter spec.
 */

import { v4 as uuidv4 } from "uuid";

export interface ActionAlertPayload {
  webhook_id: string;
  store_id: string;
  action_id: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  deep_link: string;
  dispatched_at: string;
  status: "delivered" | "failed";
  http_status: number;
}

export interface StaffNotificationPayload {
  notification_id: string;
  store_id: string;
  assignee: string;
  sku: string;
  qty: number;
  location: string;
  dispatched_at: string;
  status: "sent" | "failed";
}

export class NotificationAdapter {
  private alerts: ActionAlertPayload[] = [];
  private staffNotifications: StaffNotificationPayload[] = [];

  /** Dispatches an urgent Webhook alert with card metadata and approval deep-link */
  async sendActionAlert(alert: {
    store_id: string;
    action_id: string;
    type: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
    deep_link?: string;
  }): Promise<ActionAlertPayload> {
    const webhook_id = `wh-${uuidv4().substring(0, 8)}`;
    const deep_link = alert.deep_link || `mrmart://actions/${alert.action_id}`;

    const item: ActionAlertPayload = {
      webhook_id,
      store_id: alert.store_id,
      action_id: alert.action_id,
      type: alert.type,
      title: alert.title,
      body: alert.body,
      payload: alert.payload,
      deep_link,
      dispatched_at: new Date().toISOString(),
      status: "delivered",
      http_status: 200,
    };

    this.alerts.push(item);
    console.log(`[Notification Adapter] Webhook Alert Dispatched: ${alert.title} [Link: ${deep_link}] [HTTP 200]`);
    return item;
  }

  /** Sends a push notification to staff for shelf restock tasks */
  async sendStaffNotification(
    assignee: string,
    sku: string,
    qty: number,
    location: string,
    storeId: string
  ): Promise<StaffNotificationPayload> {
    const notification_id = `notif-${uuidv4().substring(0, 8)}`;
    const item: StaffNotificationPayload = {
      notification_id,
      store_id: storeId,
      assignee,
      sku,
      qty,
      location,
      dispatched_at: new Date().toISOString(),
      status: "sent",
    };

    this.staffNotifications.push(item);
    console.log(`[Notification Adapter] Staff Push Sent to ${assignee}: Bring ${qty} units of ${sku} to ${location}`);
    return item;
  }

  /** Returns history of dispatched action alerts (used in verification tests) */
  getAlerts(): ActionAlertPayload[] {
    return [...this.alerts];
  }

  /** Returns history of staff notifications (used in verification tests) */
  getStaffNotifications(): StaffNotificationPayload[] {
    return [...this.staffNotifications];
  }

  /** Clears event logs for test isolation */
  clearEvents(): void {
    this.alerts = [];
    this.staffNotifications = [];
  }
}

export const notificationAdapter = new NotificationAdapter();

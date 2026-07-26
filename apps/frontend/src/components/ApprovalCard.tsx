/**
 * Approval Card Component — doc 01 §4, §7.
 *
 * Visual-first: product name, qty, cost, supplier visible on closed card.
 * Touch targets: minimum 56dp for Approve & Reject buttons.
 * Palette: Cherry Bold (#990011 brand red, #D7263D alert red).
 * Two-tap confirm for requires_second_confirmation.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { COLORS, LAYOUT } from "../theme/colors";

export interface CardAction {
  id: string;
  type: string;
  sku: string | null;
  product_name: string;
  photo_url: string | null;
  placeholder_category_icon: string;
  payload: {
    qty?: number;
    cost?: number;
    unit?: string;
    supplier?: string;
    supplier_phone?: string;
    reorder_point?: number;
    qty_on_hand?: number;
    capped_by_storage_limit?: boolean;
    requires_second_confirmation?: boolean;
  };
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  escalated?: boolean;
  created_at: string;
}

interface ApprovalCardProps {
  action: CardAction;
  onApprove: (actionId: string) => Promise<void>;
  onReject: (actionId: string) => Promise<void>;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({
  action,
  onApprove,
  onReject,
}) => {
  const [confirming, setConfirming] = useState(false);
  const [loadingApprove, setLoadingApprove] = useState(false);
  const [loadingReject, setLoadingReject] = useState(false);

  const payload = action.payload || {};
  const isEscalated = action.escalated ?? false;
  const isFailed = action.status === "failed";
  const isApproved = action.status === "approved" || action.status === "executed";
  const isRejected = action.status === "rejected";
  const isCapped = payload.capped_by_storage_limit ?? false;
  const needsSecondConfirm = payload.requires_second_confirmation ?? false;

  const handleApproveTap = async () => {
    if (needsSecondConfirm && !confirming) {
      setConfirming(true);
      return;
    }

    setLoadingApprove(true);
    try {
      await onApprove(action.id);
    } finally {
      setLoadingApprove(false);
      setConfirming(false);
    }
  };

  const handleRejectTap = async () => {
    setLoadingReject(true);
    try {
      await onReject(action.id);
    } finally {
      setLoadingReject(false);
    }
  };

  // Border color based on state
  const borderColor = isEscalated || isFailed
    ? COLORS.alertRed
    : isApproved
    ? COLORS.statusGreen
    : COLORS.brandRed;

  return (
    <View style={[styles.card, { borderColor }]}>
      {/* Header Badges */}
      <View style={styles.badgeRow}>
        {isEscalated && (
          <View style={[styles.badge, { backgroundColor: COLORS.statusRedBg }]}>
            <Text style={[styles.badgeText, { color: COLORS.alertRed }]}>⚠ ESCALATED</Text>
          </View>
        )}
        {isFailed && (
          <View style={[styles.badge, { backgroundColor: COLORS.statusRedBg }]}>
            <Text style={[styles.badgeText, { color: COLORS.alertRed }]}>❌ EXECUTION FAILED</Text>
          </View>
        )}
        {isCapped && (
          <View style={[styles.badge, { backgroundColor: COLORS.statusYellowBg }]}>
            <Text style={[styles.badgeText, { color: COLORS.statusYellow }]}>📦 CAPPED BY STORAGE LIMIT</Text>
          </View>
        )}
        {needsSecondConfirm && (
          <View style={[styles.badge, { backgroundColor: "#FFF3E0" }]}>
            <Text style={[styles.badgeText, { color: "#E65100" }]}>💰 LARGE ORDER CONFIRMATION</Text>
          </View>
        )}
      </View>

      {/* Main Content */}
      <View style={styles.contentRow}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>{action.placeholder_category_icon}</Text>
        </View>

        <View style={styles.infoBlock}>
          <Text style={styles.productTitle}>{action.product_name}</Text>
          <Text style={styles.supplierText}>{payload.supplier || "Supplier Order"}</Text>

          <View style={styles.statRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>QTY</Text>
              <Text style={styles.statValue}>
                {payload.qty} {payload.unit || "units"}
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>TOTAL COST</Text>
              <Text style={[styles.statValue, { color: COLORS.brandRed }]}>
                ₹{payload.cost ? payload.cost.toLocaleString("en-IN") : "0"}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Action Buttons (Only if pending) */}
      {action.status === "pending" && (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.rejectBtn, { minHeight: LAYOUT.minTouchTarget }]}
            onPress={handleRejectTap}
            disabled={loadingApprove || loadingReject}
            activeOpacity={0.7}
          >
            {loadingReject ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.rejectBtnText}>✕ Reject</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.approveBtn,
              { minHeight: LAYOUT.minTouchTarget },
              confirming && styles.approveConfirmingBtn,
            ]}
            onPress={handleApproveTap}
            disabled={loadingApprove || loadingReject}
            activeOpacity={0.7}
          >
            {loadingApprove ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : confirming ? (
              <Text style={styles.approveBtnText}>
                Confirm ₹{payload.cost?.toLocaleString("en-IN")} Order?
              </Text>
            ) : (
              <Text style={styles.approveBtnText}>✓ Approve</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Resolved Status Indicator */}
      {isApproved && (
        <View style={[styles.resolvedBanner, { backgroundColor: COLORS.statusGreenBg }]}>
          <Text style={[styles.resolvedText, { color: COLORS.statusGreen }]}>✓ Approved · Sending to Supplier</Text>
        </View>
      )}
      {isRejected && (
        <View style={[styles.resolvedBanner, { backgroundColor: "#F0F0F0" }]}>
          <Text style={[styles.resolvedText, { color: COLORS.inkMuted }]}>✕ Action Rejected</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: LAYOUT.borderRadius,
    borderWidth: 2,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: 12,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  iconText: {
    fontSize: 28,
  },
  infoBlock: {
    flex: 1,
  },
  productTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.ink,
    marginBottom: 2,
  },
  supplierText: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.inkMuted,
    marginBottom: 8,
  },
  statRow: {
    flexDirection: "row",
    gap: 16,
  },
  statBox: {
    justifyContent: "center",
  },
  statLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.inkMuted,
    marginBottom: 1,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: COLORS.ink,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  rejectBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  approveBtn: {
    flex: 2,
    backgroundColor: COLORS.statusGreen,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  approveConfirmingBtn: {
    backgroundColor: COLORS.alertRed,
  },
  approveBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  resolvedBanner: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  resolvedText: {
    fontSize: 14,
    fontWeight: "700",
  },
});

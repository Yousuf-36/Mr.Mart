/**
 * Approval Queue Screen (Home Screen) — doc 01 §4, §6.
 * Renders pending Approval Cards, handles approve/reject taps,
 * two-tap confirm, escalated cards, and failed execution states.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { COLORS } from "../theme/colors";
import { ApprovalCard, CardAction } from "../components/ApprovalCard";
import { EmptyQueue } from "../components/EmptyQueue";
import { SkeletonLoader } from "../components/SkeletonLoader";

interface ApprovalQueueScreenProps {
  backendUrl?: string;
  testActions?: CardAction[]; // Optional test actions override for Dodd verification
}

export const ApprovalQueueScreen: React.FC<ApprovalQueueScreenProps> = ({
  backendUrl = "http://localhost:3001",
  testActions,
}) => {
  const [actions, setActions] = useState<CardAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchPendingActions = useCallback(async () => {
    if (testActions) {
      setActions(testActions);
      setLoading(false);
      return;
    }

    try {
      setErrorMsg(null);
      const res = await fetch(`${backendUrl}/api/actions/pending`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();
      setActions(data.cards || []);
    } catch (err) {
      console.warn("[Queue] Fetch error:", (err as Error).message);
      setErrorMsg("Unable to connect to Mr. Mart Backend server");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [backendUrl, testActions]);

  useEffect(() => {
    fetchPendingActions();
  }, [fetchPendingActions]);

  const handleApprove = async (actionId: string) => {
    try {
      const res = await fetch(`${backendUrl}/api/actions/${actionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      // Optimistically update card status in UI
      setActions((prev) =>
        prev.map((a) =>
          a.id === actionId ? { ...a, status: "approved" as const } : a
        )
      );

      // Re-fetch after brief delay to confirm database state
      setTimeout(fetchPendingActions, 1500);
    } catch (err) {
      console.error("[Queue] Approve error:", err);
      // Mark as failed in UI
      setActions((prev) =>
        prev.map((a) =>
          a.id === actionId ? { ...a, status: "failed" as const } : a
        )
      );
    }
  };

  const handleReject = async (actionId: string) => {
    try {
      const res = await fetch(`${backendUrl}/api/actions/${actionId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Rejected via Cockpit UI" }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      setActions((prev) =>
        prev.map((a) =>
          a.id === actionId ? { ...a, status: "rejected" as const } : a
        )
      );

      setTimeout(fetchPendingActions, 1500);
    } catch (err) {
      console.error("[Queue] Reject error:", err);
    }
  };

  const pendingCount = actions.filter((a) => a.status === "pending").length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.brandTitle}>Mr. Mart</Text>
          <Text style={styles.headerSub}>Approval Queue</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{pendingCount}</Text>
        </View>
      </View>

      {/* Main Content */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchPendingActions();
            }}
            tintColor={COLORS.brandRed}
          />
        }
      >
        {errorMsg && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMsg}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={fetchPendingActions}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <SkeletonLoader />
        ) : actions.length === 0 ? (
          <EmptyQueue />
        ) : (
          actions.map((action) => (
            <ApprovalCard
              key={action.id}
              action={action}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    backgroundColor: COLORS.brandRed,
    paddingTop: 44,
    paddingBottom: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  headerSub: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFCDD2",
    marginTop: 2,
  },
  countBadge: {
    backgroundColor: COLORS.alertRed,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  countText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  errorBox: {
    backgroundColor: COLORS.statusRedBg,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  errorText: {
    color: COLORS.alertRed,
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  retryBtn: {
    backgroundColor: COLORS.alertRed,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  retryText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
});

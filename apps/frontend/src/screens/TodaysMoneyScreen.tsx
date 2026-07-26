/**
 * Today's Money Screen — doc 01 §6.
 * Read-only monitoring screen displaying sales revenue, cash vs digital breakdown,
 * and transaction counts.
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { COLORS, LAYOUT } from "../theme/colors";

export interface MoneySummary {
  period: string;
  total_sales: number;
  cash_sales: number;
  digital_sales: number;
  txn_count: number;
}

interface TodaysMoneyScreenProps {
  backendUrl?: string;
  initialData?: MoneySummary;
}

export const TodaysMoneyScreen: React.FC<TodaysMoneyScreenProps> = ({
  backendUrl = "http://localhost:3001",
  initialData,
}) => {
  const [data, setData] = useState<MoneySummary | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData);

  useEffect(() => {
    if (initialData) return;
    fetch(`${backendUrl}/api/monitoring/sales-summary`)
      .then((res) => res.json())
      .then((resData) => setData(resData))
      .catch((err) => console.warn("[Today's Money] Fetch error:", err))
      .finally(() => setLoading(false));
  }, [backendUrl, initialData]);

  const total = data?.total_sales ?? 0;
  const cash = data?.cash_sales ?? 0;
  const digital = data?.digital_sales ?? 0;
  const cashPct = total > 0 ? Math.round((cash / total) * 100) : 50;
  const digitalPct = 100 - cashPct;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Today's Money</Text>
        <Text style={styles.sub}>Revenue & Payment Method Breakdown</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.brandRed} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.card}>
            {/* Total Revenue Hero */}
            <Text style={styles.heroLabel}>TOTAL REVENUE ({data?.period || "14 days"})</Text>
            <Text style={styles.heroAmount}>₹{total.toLocaleString("en-IN")}</Text>

            <View style={styles.divider} />

            {/* Split Bar */}
            <Text style={styles.sectionTitle}>PAYMENT SPLIT</Text>
            <View style={styles.splitBar}>
              <View style={[styles.cashSegment, { flex: cashPct }]} />
              <View style={[styles.digitalSegment, { flex: digitalPct }]} />
            </View>

            {/* Split Details */}
            <View style={styles.splitRow}>
              <View style={styles.splitBox}>
                <View style={styles.labelWithDot}>
                  <View style={[styles.dot, { backgroundColor: COLORS.brandRed }]} />
                  <Text style={styles.paymentTypeLabel}>💵 CASH</Text>
                </View>
                <Text style={styles.paymentAmount}>₹{cash.toLocaleString("en-IN")}</Text>
                <Text style={styles.paymentPct}>{cashPct}%</Text>
              </View>

              <View style={styles.splitBox}>
                <View style={styles.labelWithDot}>
                  <View style={[styles.dot, { backgroundColor: COLORS.accentNavy }]} />
                  <Text style={styles.paymentTypeLabel}>💳 DIGITAL (UPI)</Text>
                </View>
                <Text style={styles.paymentAmount}>₹{digital.toLocaleString("en-IN")}</Text>
                <Text style={styles.paymentPct}>{digitalPct}%</Text>
              </View>
            </View>

            <View style={styles.divider} />

            {/* Transaction Counter */}
            <View style={styles.txnRow}>
              <Text style={styles.txnLabel}>TOTAL TRANSACTIONS</Text>
              <Text style={styles.txnValue}>{data?.txn_count ?? 0} Sales</Text>
            </View>
          </View>
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
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  sub: {
    fontSize: 12,
    color: "#FFCDD2",
    marginTop: 2,
  },
  scroll: {
    padding: 16,
  },
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: LAYOUT.borderRadius,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.inkMuted,
    letterSpacing: 0.5,
  },
  heroAmount: {
    fontSize: 36,
    fontWeight: "900",
    color: COLORS.brandRed,
    marginTop: 4,
    marginBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.borderLight,
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.inkMuted,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  splitBar: {
    height: 16,
    borderRadius: 8,
    flexDirection: "row",
    overflow: "hidden",
    marginBottom: 16,
  },
  cashSegment: {
    backgroundColor: COLORS.brandRed,
  },
  digitalSegment: {
    backgroundColor: COLORS.accentNavy,
  },
  splitRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  splitBox: {
    flex: 1,
  },
  labelWithDot: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  paymentTypeLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.ink,
  },
  paymentAmount: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.ink,
  },
  paymentPct: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.inkMuted,
  },
  txnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  txnLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.inkMuted,
  },
  txnValue: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.ink,
  },
});

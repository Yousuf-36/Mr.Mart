/**
 * Sales Pulse Screen — doc 01 §6.
 * Read-only monitoring screen displaying top selling products and sales velocity.
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

export interface SalesItem {
  sku: string;
  name: string;
  category: string;
  units_sold: number;
  revenue: number;
  trend: "up" | "down";
}

interface SalesPulseScreenProps {
  backendUrl?: string;
  initialItems?: SalesItem[];
}

export const SalesPulseScreen: React.FC<SalesPulseScreenProps> = ({
  backendUrl = "http://localhost:3001",
  initialItems,
}) => {
  const [items, setItems] = useState<SalesItem[]>(initialItems || []);
  const [loading, setLoading] = useState(!initialItems);

  useEffect(() => {
    if (initialItems) return;
    fetch(`${backendUrl}/api/monitoring/top-sellers`)
      .then((res) => res.json())
      .then((data) => setItems(data.items || []))
      .catch((err) => console.warn("[Sales Pulse] Fetch error:", err))
      .finally(() => setLoading(false));
  }, [backendUrl, initialItems]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Sales Pulse</Text>
        <Text style={styles.sub}>Best Sellers & Sales Velocity</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.brandRed} style={{ marginTop: 40 }} />
        ) : (
          items.map((item, idx) => (
            <View key={item.sku} style={styles.card}>
              <View style={styles.rankBadge}>
                <Text style={styles.rankText}>#{idx + 1}</Text>
              </View>

              <View style={styles.info}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.subText}>{item.category}</Text>
              </View>

              <View style={styles.trendBox}>
                <Text style={[styles.trendArrow, { color: item.trend === "up" ? COLORS.statusGreen : COLORS.alertRed }]}>
                  {item.trend === "up" ? "▲" : "▼"}
                </Text>
              </View>

              <View style={styles.statBlock}>
                <Text style={styles.unitsNum}>{item.units_sold}</Text>
                <Text style={styles.statLabel}>units sold</Text>
              </View>

              <View style={styles.revenueBlock}>
                <Text style={styles.revNum}>₹{item.revenue.toLocaleString("en-IN")}</Text>
                <Text style={styles.statLabel}>revenue</Text>
              </View>
            </View>
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
    gap: 12,
  },
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: LAYOUT.borderRadius,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: COLORS.brandRed,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  rankText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.ink,
  },
  subText: {
    fontSize: 11,
    color: COLORS.inkMuted,
  },
  trendBox: {
    marginHorizontal: 8,
  },
  trendArrow: {
    fontSize: 18,
    fontWeight: "900",
  },
  statBlock: {
    alignItems: "flex-end",
    marginRight: 12,
  },
  unitsNum: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.ink,
  },
  revenueBlock: {
    alignItems: "flex-end",
  },
  revNum: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.statusGreen,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: COLORS.inkMuted,
  },
});

/**
 * Mr. Mart Cockpit App — Stage 2
 * Bottom Tab Navigation between Approval Queue and 3 Monitoring Screens.
 * Visual-First, Cherry Bold Design System (doc 01 §4, §6, §7).
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from "react-native";
import { COLORS } from "./src/theme/colors";
import { ApprovalQueueScreen } from "./src/screens/ApprovalQueueScreen";
import { StockPulseScreen } from "./src/screens/StockPulseScreen";
import { SalesPulseScreen } from "./src/screens/SalesPulseScreen";
import { TodaysMoneyScreen } from "./src/screens/TodaysMoneyScreen";

type TabType = "queue" | "stock" | "sales" | "money";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("queue");

  const renderScreen = () => {
    switch (activeTab) {
      case "queue":
        return <ApprovalQueueScreen />;
      case "stock":
        return <StockPulseScreen />;
      case "sales":
        return <SalesPulseScreen />;
      case "money":
        return <TodaysMoneyScreen />;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor={COLORS.brandRed} barStyle="light-content" />

      {/* Screen Body */}
      <View style={styles.screenContainer}>{renderScreen()}</View>

      {/* Bottom Navigation Tab Bar (doc 01 §6) */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab("queue")}
          activeOpacity={0.7}
        >
          <Text style={styles.tabIcon}>📋</Text>
          <Text style={[styles.tabLabel, activeTab === "queue" && styles.activeTabLabel]}>
            Queue
          </Text>
          {activeTab === "queue" && <View style={styles.activeIndicator} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab("stock")}
          activeOpacity={0.7}
        >
          <Text style={styles.tabIcon}>🔋</Text>
          <Text style={[styles.tabLabel, activeTab === "stock" && styles.activeTabLabel]}>
            Stock
          </Text>
          {activeTab === "stock" && <View style={styles.activeIndicator} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab("sales")}
          activeOpacity={0.7}
        >
          <Text style={styles.tabIcon}>📈</Text>
          <Text style={[styles.tabLabel, activeTab === "sales" && styles.activeTabLabel]}>
            Sales
          </Text>
          {activeTab === "sales" && <View style={styles.activeIndicator} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => setActiveTab("money")}
          activeOpacity={0.7}
        >
          <Text style={styles.tabIcon}>💰</Text>
          <Text style={[styles.tabLabel, activeTab === "money" && styles.activeTabLabel]}>
            Money
          </Text>
          {activeTab === "money" && <View style={styles.activeIndicator} />}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  screenContainer: {
    flex: 1,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    height: 64,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.inkMuted,
  },
  activeTabLabel: {
    color: COLORS.brandRed,
    fontWeight: "900",
  },
  activeIndicator: {
    position: "absolute",
    top: 0,
    width: 24,
    height: 3,
    backgroundColor: COLORS.brandRed,
    borderRadius: 2,
  },
});

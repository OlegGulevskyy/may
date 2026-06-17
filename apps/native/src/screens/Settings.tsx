import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import {
  Check,
  ChevronRight,
  CloudUpload,
  HardDrive,
  LogOut,
  MailCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react-native";

import type { GoogleDeliveryConnection } from "@may/core";

import { Surface } from "../ui/Glass";
import { HapticPressable as Pressable } from "../ui/HapticPressable";
import type { FamilyMembership } from "../state/AppState";
import {
  clearImageCache,
  getImageCacheSizeBytes,
} from "../services/imageCache";
import { palette, radius } from "../theme";

export function SettingsPanel({
  activeFamilyId,
  childName,
  familyMemberships,
  googleDeliveryConnection,
  onConnectGoogleDelivery,
  onInvite,
  onJoinFamily,
  onSignOut,
  onSwitchFamily,
}: {
  activeFamilyId: string;
  childName: string;
  familyMemberships: FamilyMembership[];
  googleDeliveryConnection?: GoogleDeliveryConnection;
  onConnectGoogleDelivery: () => Promise<unknown>;
  onInvite: () => void;
  onJoinFamily: () => void;
  onSignOut: () => void;
  onSwitchFamily: (familyId: string) => Promise<unknown>;
}) {
  const [cacheSizeBytes, setCacheSizeBytes] = useState<number | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [switchingFamilyId, setSwitchingFamilyId] = useState<string | null>(
    null,
  );
  const deliveryConnected = googleDeliveryConnection?.status === "connected";
  const deliveryNeedsReconnect =
    googleDeliveryConnection?.status === "needs_reconnect";

  const loadCacheSize = useCallback(async () => {
    try {
      const bytes = await getImageCacheSizeBytes();
      setCacheSizeBytes(bytes);
    } catch (error) {
      console.warn("[MaySync] image cache size failed", {
        error: getErrorMessage(error),
      });
      setCacheSizeBytes(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    getImageCacheSizeBytes()
      .then((bytes) => {
        if (!cancelled) {
          setCacheSizeBytes(bytes);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[MaySync] image cache size failed", {
            error: getErrorMessage(error),
          });
          setCacheSizeBytes(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const confirmClearImageCache = useCallback(() => {
    Alert.alert(
      "Clear application cache?",
      "Cached wall images will download again when needed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            setCacheBusy(true);
            clearImageCache()
              .then(loadCacheSize)
              .catch((error) =>
                Alert.alert("Could not clear cache", getErrorMessage(error)),
              )
              .finally(() => setCacheBusy(false));
          },
        },
      ],
    );
  }, [loadCacheSize]);

  const connectGoogleDelivery = useCallback(() => {
    setDeliveryBusy(true);
    onConnectGoogleDelivery()
      .then(() =>
        Alert.alert(
          "Google delivery connected",
          "Dinomay can now send emails and upload files with this Google account.",
        ),
      )
      .catch((error) =>
        Alert.alert(
          "Could not connect Google delivery",
          getErrorMessage(error),
        ),
      )
      .finally(() => setDeliveryBusy(false));
  }, [onConnectGoogleDelivery]);

  const switchFamily = useCallback(
    (familyId: string) => {
      if (familyId === activeFamilyId || switchingFamilyId) {
        return;
      }

      setSwitchingFamilyId(familyId);
      onSwitchFamily(familyId)
        .catch((error) =>
          Alert.alert("Could not switch walls", getErrorMessage(error)),
        )
        .finally(() => setSwitchingFamilyId(null));
    },
    [activeFamilyId, onSwitchFamily, switchingFamilyId],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>For {childName}&apos;s wall</Text>
      </View>

      <Section title="Memories wall">
        <Surface style={styles.group}>
          {familyMemberships.map((membership, index) => {
            const selected = activeFamilyId === membership.familyId;
            const switching = switchingFamilyId === membership.familyId;

            return (
              <Pressable
                accessibilityLabel={`Open ${membership.childName}'s wall`}
                accessibilityRole="button"
                key={membership.familyId}
                onPress={() => switchFamily(membership.familyId)}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 ? styles.rowDivider : null,
                  switchingFamilyId ? styles.rowDisabled : null,
                  pressed ? styles.rowPressed : null,
                ]}
              >
                <View
                  style={[
                    styles.wallIcon,
                    selected ? styles.wallIconActive : null,
                  ]}
                >
                  <Users
                    color={selected ? "#fff" : palette.inkMuted}
                    size={19}
                  />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>
                    {membership.childName}&apos;s wall
                  </Text>
                  <Text style={styles.rowMeta}>
                    {membership.role === "creator"
                      ? "Your family"
                      : "Joined family"}
                  </Text>
                </View>
                {switching ? (
                  <Text style={styles.rowValue}>Switching</Text>
                ) : null}
                {selected ? (
                  <View style={styles.activePill}>
                    <Check color={palette.moss} size={15} />
                    <Text style={styles.activePillText}>Active</Text>
                  </View>
                ) : !switching ? (
                  <ChevronRight color={palette.inkFaint} size={18} />
                ) : null}
              </Pressable>
            );
          })}
          <Row
            divider={familyMemberships.length > 0}
            icon={<UserPlus color={palette.berry} size={20} />}
            label="Invite someone else"
            onPress={onInvite}
            showChevron
          />
          <Row
            divider
            icon={<UserPlus color={palette.berry} size={20} />}
            label="Use invite code"
            onPress={onJoinFamily}
            showChevron
          />
        </Surface>
      </Section>

      <Section title="Delivery">
        <Surface style={styles.group}>
          <Row
            disabled={deliveryBusy}
            detail={deliveryConnectionEmail(googleDeliveryConnection)}
            icon={
              deliveryConnected ? (
                <MailCheck color={palette.moss} size={20} />
              ) : (
                <CloudUpload color={palette.berry} size={20} />
              )
            }
            label="Google delivery"
            onPress={connectGoogleDelivery}
            showChevron
            trailingAccessory={
              deliveryConnected && !deliveryBusy ? (
                <Check color={palette.moss} size={18} />
              ) : undefined
            }
            value={
              deliveryBusy
                ? "Connecting"
                : deliveryConnected
                  ? undefined
                  : deliveryNeedsReconnect
                    ? "Reconnect"
                    : "Connect"
            }
          />
        </Surface>
      </Section>

      <Section title="This device">
        <Surface style={styles.group}>
          <Row
            icon={<HardDrive color={palette.moss} size={20} />}
            label="Application cache"
            onPress={loadCacheSize}
            value={
              cacheBusy
                ? "Clearing"
                : cacheSizeBytes === null
                  ? "Calculating"
                  : formatCacheSize(cacheSizeBytes)
            }
          />
          <Row
            destructive
            disabled={cacheBusy}
            divider
            icon={<Trash2 color={palette.berry} size={20} />}
            label="Clear application cache"
            onPress={confirmClearImageCache}
            showChevron
          />
          <Row
            destructive
            divider
            icon={<LogOut color={palette.berry} size={20} />}
            label="Sign out"
            onPress={onSignOut}
            showChevron
          />
        </Surface>
      </Section>
    </View>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({
  disabled,
  destructive,
  detail,
  divider,
  icon,
  label,
  onPress,
  showChevron,
  trailingAccessory,
  value,
}: {
  disabled?: boolean;
  destructive?: boolean;
  detail?: string;
  divider?: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
  showChevron?: boolean;
  trailingAccessory?: ReactNode;
  value?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        divider ? styles.rowDivider : null,
        disabled ? styles.rowDisabled : null,
        pressed ? styles.rowPressed : null,
      ]}
    >
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={[styles.rowLabel, destructive ? styles.rowLabelDanger : null]}
        >
          {label}
        </Text>
        {detail ? (
          <Text selectable style={styles.rowDetail}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text numberOfLines={1} style={styles.rowValue}>
          {value}
        </Text>
      ) : null}
      {trailingAccessory}
      {showChevron ? <ChevronRight color={palette.inkFaint} size={18} /> : null}
    </Pressable>
  );
}

function deliveryConnectionEmail(
  connection: GoogleDeliveryConnection | undefined,
) {
  if (!connection?.googleEmail) {
    return undefined;
  }

  return connection.googleEmail;
}

function formatCacheSize(bytes: number) {
  if (bytes === 0) {
    return "0 MB";
  }

  const gib = bytes / 1024 / 1024 / 1024;
  if (gib >= 1) {
    return `${gib >= 10 ? gib.toFixed(1) : gib.toFixed(2)} GB`;
  }

  const mib = bytes / 1024 / 1024;
  if (mib < 0.1) {
    return "< 0.1 MB";
  }

  return `${mib >= 10 ? mib.toFixed(1) : mib.toFixed(2)} MB`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const styles = StyleSheet.create({
  container: {
    gap: 24,
  },
  header: {
    gap: 4,
    paddingTop: 4,
  },
  title: {
    color: palette.ink,
    fontSize: 28,
    fontWeight: "900",
  },
  subtitle: {
    color: palette.inkMuted,
    fontSize: 15,
    fontWeight: "700",
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    paddingHorizontal: 4,
    textTransform: "uppercase",
  },
  group: {
    overflow: "hidden",
    paddingHorizontal: 6,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 13,
    minHeight: 60,
    paddingHorizontal: 10,
  },
  rowDivider: {
    borderTopColor: "rgba(37,45,43,0.07)",
    borderTopWidth: 1,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  rowIcon: {
    alignItems: "center",
    width: 24,
  },
  wallIcon: {
    alignItems: "center",
    backgroundColor: "rgba(37,45,43,0.08)",
    borderRadius: radius.pill,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  wallIconActive: {
    backgroundColor: palette.ink,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "800",
  },
  rowMeta: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  rowLabel: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "800",
  },
  rowLabelDanger: {
    color: palette.berry,
  },
  rowDetail: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  rowValue: {
    color: palette.inkMuted,
    fontSize: 14,
    fontWeight: "800",
  },
  activePill: {
    alignItems: "center",
    backgroundColor: "rgba(91,126,102,0.14)",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  activePillText: {
    color: palette.moss,
    fontSize: 12,
    fontWeight: "900",
  },
});

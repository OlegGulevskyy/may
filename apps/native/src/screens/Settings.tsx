import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  AppState as NativeAppState,
  Modal,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  Bell,
  BellOff,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  Clock,
  CloudUpload,
  HardDrive,
  Image as ImageIcon,
  LogOut,
  MailCheck,
  MailPlus,
  Mic,
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
import {
  formatMemoryNudgeCadence,
  formatMemoryNudgeSummary,
  formatMemoryNudgeWindow,
  memoryNudgeCadenceDays,
  type MemoryNudgeScheduleState,
  type MemoryNudgeSettings,
} from "../services/memoryNudges";
import {
  getAppPermissionSummaries,
  openAppPermissionSettings,
  permissionNeedsSystemSettings,
  permissionStatusLabel,
  requestAppPermission,
  type AppPermissionId,
  type AppPermissionSummary,
  type AppPermissionStatus,
} from "../services/permissions";
import { palette, radius } from "../theme";

const maxCcEmailCount = 10;

const initialPermissionSummaries: AppPermissionSummary[] = [
  {
    canAskAgain: true,
    id: "notifications",
    label: "Notifications",
    status: "undetermined",
  },
  {
    canAskAgain: true,
    id: "microphone",
    label: "Audio recording",
    status: "undetermined",
  },
  {
    canAskAgain: true,
    id: "photoLibrary",
    label: "Photo library",
    status: "undetermined",
  },
  {
    canAskAgain: true,
    id: "camera",
    label: "Camera",
    status: "undetermined",
  },
];

export function SettingsPanel({
  activeFamilyId,
  childName,
  deliveryCcEmails,
  familyMemberships,
  googleDeliveryConnection,
  isMemoryNudgeBusy,
  memoryNudgeScheduleState,
  memoryNudgeSettings,
  onConnectGoogleDelivery,
  onInvite,
  onJoinFamily,
  onRefreshMemoryNudgeSchedule,
  onSetMemoryNudgesEnabled,
  onSignOut,
  onSwitchFamily,
  onUpdateDeliveryCcEmails,
  onUpdateMemoryNudgeSettings,
}: {
  activeFamilyId: string;
  childName: string;
  deliveryCcEmails?: string[];
  familyMemberships: FamilyMembership[];
  googleDeliveryConnection?: GoogleDeliveryConnection;
  isMemoryNudgeBusy: boolean;
  memoryNudgeScheduleState: MemoryNudgeScheduleState;
  memoryNudgeSettings: MemoryNudgeSettings;
  onConnectGoogleDelivery: () => Promise<unknown>;
  onInvite: () => void;
  onJoinFamily: () => void;
  onRefreshMemoryNudgeSchedule: () => Promise<unknown>;
  onSetMemoryNudgesEnabled: (enabled: boolean) => Promise<boolean>;
  onSignOut: () => void;
  onSwitchFamily: (familyId: string) => Promise<unknown>;
  onUpdateDeliveryCcEmails: (ccEmails: string[]) => Promise<unknown>;
  onUpdateMemoryNudgeSettings: (
    settings: Partial<MemoryNudgeSettings>,
  ) => Promise<unknown>;
}) {
  const [cacheSizeBytes, setCacheSizeBytes] = useState<number | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [ccBusy, setCcBusy] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [permissions, setPermissions] = useState<AppPermissionSummary[]>(
    initialPermissionSummaries,
  );
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const [timeWindowPickerVisible, setTimeWindowPickerVisible] = useState(false);
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

  const loadPermissions = useCallback(async () => {
    setPermissionsBusy(true);
    try {
      setPermissions(await getAppPermissionSummaries());
    } catch (error) {
      console.warn("[MaySync] permissions status failed", {
        error: getErrorMessage(error),
      });
    } finally {
      setPermissionsBusy(false);
    }
  }, []);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener("change", (state) => {
      if (state === "active") {
        loadPermissions();
      }
    });

    return () => subscription.remove();
  }, [loadPermissions]);

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

  const saveDeliveryCcEmails = useCallback(
    (nextCcEmails?: string | null) => {
      const { emails, invalidEmails } = parseEmailList(nextCcEmails ?? "");

      if (invalidEmails.length > 0) {
        Alert.alert(
          "Check CC addresses",
          `These do not look like valid email addresses: ${invalidEmails.join(", ")}`,
        );
        return;
      }

      if (emails.length > maxCcEmailCount) {
        Alert.alert(
          "Too many CC addresses",
          `Use ${maxCcEmailCount} CC addresses or fewer.`,
        );
        return;
      }

      setCcBusy(true);
      onUpdateDeliveryCcEmails(emails)
        .then(() =>
          Alert.alert(
            "CC addresses updated",
            emails.length > 0
              ? `Future delivery emails will copy ${formatEmailList(emails)}.`
              : "Future delivery emails will not include a CC address.",
          ),
        )
        .catch((error) =>
          Alert.alert("Could not update CC addresses", getErrorMessage(error)),
        )
        .finally(() => setCcBusy(false));
    },
    [onUpdateDeliveryCcEmails],
  );

  const editDeliveryCcEmails = useCallback(() => {
    Alert.prompt(
      "CC addresses",
      "Copy future delivery emails to these addresses. Separate multiple emails with commas.",
      [
        { text: "Cancel", style: "cancel" },
        ...(deliveryCcEmails?.length
          ? [
              {
                onPress: () => saveDeliveryCcEmails(""),
                style: "destructive" as const,
                text: "Remove all",
              },
            ]
          : []),
        {
          onPress: (value?: string) => saveDeliveryCcEmails(value),
          text: "Save",
        },
      ],
      "plain-text",
      deliveryCcEmails?.join(", ") ?? "",
      "email-address",
    );
  }, [deliveryCcEmails, saveDeliveryCcEmails]);

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

  const toggleMemoryNudges = useCallback(() => {
    const enabling = !memoryNudgeSettings.enabled;

    onSetMemoryNudgesEnabled(enabling)
      .then((enabled) => {
        if (enabling && !enabled) {
          Alert.alert(
            "Notifications are off",
            "Turn on notifications for Dinomay to schedule memory reminders.",
          );
        }
        return loadPermissions();
      })
      .catch((error) =>
        Alert.alert("Could not update reminders", getErrorMessage(error)),
      );
  }, [loadPermissions, memoryNudgeSettings.enabled, onSetMemoryNudgesEnabled]);

  const editMemoryNudgeCadence = useCallback(() => {
    Alert.alert("Reminder cadence", "The week runs Monday to Sunday.", [
      ...memoryNudgeCadenceDays.map((cadenceDays) => ({
        onPress: () =>
          onUpdateMemoryNudgeSettings({ cadenceDays }).catch((error) =>
            Alert.alert("Could not update cadence", getErrorMessage(error)),
          ),
        text: formatMemoryNudgeCadence(cadenceDays),
      })),
      { style: "cancel" as const, text: "Cancel" },
    ]);
  }, [onUpdateMemoryNudgeSettings]);

  const editMemoryNudgeWindow = useCallback(() => {
    setTimeWindowPickerVisible(true);
  }, []);

  const saveMemoryNudgeWindow = useCallback(
    (
      window: Pick<
        MemoryNudgeSettings,
        "endHour" | "endMinute" | "startHour" | "startMinute"
      >,
    ) => {
      onUpdateMemoryNudgeSettings(window)
        .then(() => setTimeWindowPickerVisible(false))
        .catch((error) =>
          Alert.alert("Could not update time window", getErrorMessage(error)),
        );
    },
    [onUpdateMemoryNudgeSettings],
  );

  const managePermission = useCallback(
    (permission: AppPermissionSummary) => {
      if (permissionNeedsSystemSettings(permission)) {
        Alert.alert(
          `${permission.label} permission`,
          "iOS manages changing or revoking this permission in Settings.",
          [
            { text: "Cancel", style: "cancel" },
            {
              onPress: () => {
                openAppPermissionSettings().catch((error) =>
                  Alert.alert(
                    "Could not open Settings",
                    getErrorMessage(error),
                  ),
                );
              },
              text: "Open Settings",
            },
          ],
        );
        return;
      }

      setPermissionsBusy(true);
      requestAppPermission(permission.id)
        .then(() => loadPermissions())
        .then(() =>
          permission.id === "notifications"
            ? onRefreshMemoryNudgeSchedule()
            : undefined,
        )
        .catch((error) =>
          Alert.alert("Could not update permission", getErrorMessage(error)),
        )
        .finally(() => setPermissionsBusy(false));
    },
    [loadPermissions, onRefreshMemoryNudgeSchedule],
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

      <Section title="Memory nudges">
        <Surface style={styles.group}>
          <Row
            disabled={isMemoryNudgeBusy}
            icon={
              memoryNudgeSettings.enabled ? (
                <Bell color={palette.moss} size={20} />
              ) : (
                <BellOff color={palette.inkMuted} size={20} />
              )
            }
            label="Random reminders"
            onPress={toggleMemoryNudges}
            showChevron
            value={
              isMemoryNudgeBusy
                ? "Saving"
                : memoryNudgePrimaryStatus(
                    memoryNudgeSettings,
                    memoryNudgeScheduleState,
                  )
            }
          />
          <Row
            disabled={isMemoryNudgeBusy}
            divider
            icon={<CalendarDays color={palette.moss} size={20} />}
            label="Cadence"
            onPress={editMemoryNudgeCadence}
            showChevron
            value={formatMemoryNudgeCadence(memoryNudgeSettings.cadenceDays)}
          />
          <Row
            disabled={isMemoryNudgeBusy}
            divider
            icon={<Clock color={palette.berry} size={20} />}
            label="Time window"
            onPress={editMemoryNudgeWindow}
            showChevron
            value={formatMemoryNudgeWindow(memoryNudgeSettings)}
          />
          {memoryNudgeSettings.enabled ? (
            <View style={styles.groupFooter}>
              <Text style={styles.groupFooterText}>
                {memoryNudgeDetail(
                  memoryNudgeSettings,
                  memoryNudgeScheduleState,
                )}
              </Text>
            </View>
          ) : null}
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
                <StatusChip label="Connected" />
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
          <Row
            disabled={ccBusy}
            detail={formatEmailList(deliveryCcEmails)}
            divider
            icon={<MailPlus color={palette.moss} size={20} />}
            label="CC addresses"
            onPress={editDeliveryCcEmails}
            showChevron
            value={
              ccBusy ? "Saving" : deliveryCcEmails?.length ? "Edit" : "Add"
            }
          />
        </Surface>
      </Section>

      <Section title="Permissions">
        <Surface style={styles.group}>
          {permissions.map((permission, index) => (
            <Row
              disabled={permissionsBusy}
              divider={index > 0}
              icon={permissionIcon(permission.id, permission.status)}
              key={permission.id}
              label={permission.label}
              onPress={() => managePermission(permission)}
              showChevron
              trailingAccessory={
                permissionsBusy ? undefined : permission.status === "granted" ||
                  permission.status === "limited" ? (
                  <StatusChip
                    label={permissionStatusLabel(permission.status)}
                  />
                ) : undefined
              }
              value={
                permissionsBusy
                  ? "Checking"
                  : permission.status === "granted" ||
                      permission.status === "limited"
                    ? undefined
                    : permissionStatusLabel(permission.status)
              }
            />
          ))}
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
      <TimeWindowPicker
        onCancel={() => setTimeWindowPickerVisible(false)}
        onSave={saveMemoryNudgeWindow}
        settings={memoryNudgeSettings}
        visible={timeWindowPickerVisible}
      />
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

function StatusChip({ label }: { label: string }) {
  return (
    <View style={styles.statusChip}>
      <Check color={palette.moss} size={13} strokeWidth={3} />
      <Text numberOfLines={1} style={styles.statusChipText}>
        {label}
      </Text>
    </View>
  );
}

function TimeWindowPicker({
  onCancel,
  onSave,
  settings,
  visible,
}: {
  onCancel: () => void;
  onSave: (
    window: Pick<
      MemoryNudgeSettings,
      "endHour" | "endMinute" | "startHour" | "startMinute"
    >,
  ) => void;
  settings: MemoryNudgeSettings;
  visible: boolean;
}) {
  const [startDate, setStartDate] = useState(() =>
    timeDate(settings.startHour, settings.startMinute),
  );
  const [endDate, setEndDate] = useState(() =>
    timeDate(settings.endHour, settings.endMinute),
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    setStartDate(timeDate(settings.startHour, settings.startMinute));
    setEndDate(timeDate(settings.endHour, settings.endMinute));
  }, [
    settings.endHour,
    settings.endMinute,
    settings.startHour,
    settings.startMinute,
    visible,
  ]);

  const save = useCallback(() => {
    const start = timeParts(startDate);
    const end = timeParts(endDate);

    if (end.totalMinutes < start.totalMinutes) {
      Alert.alert(
        "Check time window",
        "Choose a To time that is later than the From time.",
      );
      return;
    }

    onSave({
      endHour: end.hour,
      endMinute: end.minute,
      startHour: start.hour,
      startMinute: start.minute,
    });
  }, [endDate, onSave, startDate]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.timePickerSheet}>
          <View style={styles.timePickerHeader}>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={styles.timePickerAction}
            >
              <Text style={styles.timePickerActionText}>Cancel</Text>
            </Pressable>
            <Text style={styles.timePickerTitle}>Time window</Text>
            <Pressable
              accessibilityRole="button"
              onPress={save}
              style={styles.timePickerAction}
            >
              <Text style={[styles.timePickerActionText, styles.doneText]}>
                Done
              </Text>
            </Pressable>
          </View>
          <View style={styles.timePickerGrid}>
            <View style={styles.timePickerPanel}>
              <Text style={styles.timePickerLabel}>From</Text>
              <DateTimePicker
                display="spinner"
                mode="time"
                onChange={(_, date) => {
                  if (date) {
                    setStartDate(date);
                  }
                }}
                textColor={palette.ink}
                themeVariant="light"
                value={startDate}
              />
            </View>
            <View style={styles.timePickerPanel}>
              <Text style={styles.timePickerLabel}>To</Text>
              <DateTimePicker
                display="spinner"
                mode="time"
                onChange={(_, date) => {
                  if (date) {
                    setEndDate(date);
                  }
                }}
                textColor={palette.ink}
                themeVariant="light"
                value={endDate}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
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

function memoryNudgePrimaryStatus(
  settings: MemoryNudgeSettings,
  state: MemoryNudgeScheduleState,
) {
  if (!settings.enabled) {
    return "Off";
  }

  switch (state.status) {
    case "denied":
    case "needs-permission":
      return "Permission";
    case "error":
      return "Error";
    case "off":
      return "Off";
    case "scheduled":
      return "On";
    case "unavailable":
      return "Unavailable";
  }
}

function memoryNudgeDetail(
  settings: MemoryNudgeSettings,
  state: MemoryNudgeScheduleState,
) {
  const summary = formatMemoryNudgeSummary(settings);

  if (!settings.enabled) {
    return summary;
  }

  switch (state.status) {
    case "denied":
      return `${summary}. Notifications are denied.`;
    case "error":
      return `${summary}. ${state.message}`;
    case "needs-permission":
      return `${summary}. Notifications are not allowed yet.`;
    case "off":
      return summary;
    case "scheduled": {
      const next = formatNextNudgeAt(state.nextNotificationAt);
      return next ? `${summary}. Next: ${next}` : summary;
    }
    case "unavailable":
      return `${summary}. Rebuild the iOS app with notifications installed.`;
  }
}

function formatNextNudgeAt(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    weekday: "short",
  });
}

function timeDate(hour: number, minute: number) {
  const date = new Date(2000, 0, 1);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function timeParts(date: Date) {
  const hour = date.getHours();
  const minute = date.getMinutes();
  return {
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
  };
}

function permissionIcon(id: AppPermissionId, status: AppPermissionStatus) {
  const color =
    status === "granted" || status === "limited"
      ? palette.moss
      : status === "denied"
        ? palette.berry
        : palette.inkMuted;

  switch (id) {
    case "camera":
      return <Camera color={color} size={20} />;
    case "microphone":
      return <Mic color={color} size={20} />;
    case "notifications":
      return <Bell color={color} size={20} />;
    case "photoLibrary":
      return <ImageIcon color={color} size={20} />;
  }
}

function parseEmailList(value: string) {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalidEmails: string[] = [];

  for (const part of value.split(/[\s,;]+/)) {
    const email = part.trim();
    if (!email) {
      continue;
    }
    if (!looksLikeEmail(email)) {
      invalidEmails.push(email);
      continue;
    }
    const key = email.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      emails.push(email);
    }
  }

  return { emails, invalidEmails };
}

function formatEmailList(emails: string[] | undefined) {
  return emails?.length ? emails.join(", ") : undefined;
}

function looksLikeEmail(value: string) {
  return /^\S+@\S+\.\S+$/.test(value.trim());
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
    minHeight: 56,
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
    fontWeight: "700",
  },
  rowMeta: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  rowLabel: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  rowLabelDanger: {
    color: palette.berry,
  },
  rowDetail: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  rowValue: {
    color: palette.inkMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  groupFooter: {
    borderTopColor: "rgba(37,45,43,0.07)",
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  groupFooterText: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  statusChip: {
    alignItems: "center",
    backgroundColor: "rgba(91,126,102,0.14)",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusChipText: {
    color: palette.moss,
    fontSize: 12,
    fontWeight: "700",
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
    fontWeight: "700",
  },
  modalBackdrop: {
    backgroundColor: "rgba(37,45,43,0.18)",
    flex: 1,
    justifyContent: "flex-end",
  },
  timePickerSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 24,
  },
  timePickerHeader: {
    alignItems: "center",
    borderBottomColor: "rgba(37,45,43,0.08)",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: 16,
  },
  timePickerAction: {
    minWidth: 64,
    paddingVertical: 12,
  },
  timePickerActionText: {
    color: palette.inkMuted,
    fontSize: 16,
    fontWeight: "600",
  },
  doneText: {
    color: palette.moss,
    textAlign: "right",
  },
  timePickerTitle: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  timePickerGrid: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  timePickerPanel: {
    gap: 4,
  },
  timePickerLabel: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    paddingHorizontal: 4,
    textTransform: "uppercase",
  },
});

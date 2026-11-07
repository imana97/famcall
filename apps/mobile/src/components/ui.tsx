import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { LucideIcon } from "lucide-react-native";
import { ArrowLeft } from "lucide-react-native";
import { router } from "expo-router";
import { t } from "../i18n";

export function useTheme() {
  return useColorScheme() === "dark"
    ? {
        bg: "#131E1B",
        card: "#1D2B26",
        text: "#F6F4EA",
        muted: "#B0BDB6",
        line: "#34463E",
        primary: "#B8DFC2",
        onPrimary: "#142B21",
        danger: "#F08E82",
        avatar: "#334D3E",
      }
    : {
        bg: "#F7F6F0",
        card: "#FFFFFF",
        text: "#19372E",
        muted: "#67776F",
        line: "#DCE3DA",
        primary: "#254E3C",
        onPrimary: "#FFFFFF",
        danger: "#B34134",
        avatar: "#DFEBD8",
      };
}
export function Page({
  children,
  scroll = true,
  safeBottom = true,
}: React.PropsWithChildren<{ scroll?: boolean; safeBottom?: boolean }>) {
  const c = useTheme();
  return (
    <SafeAreaView
      edges={
        safeBottom ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]
      }
      style={{ flex: 1, backgroundColor: c.bg, direction: "ltr" }}
    >
      {scroll ? (
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.page}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={[styles.page, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}
export function Heading({
  title,
  subtitle,
  back = false,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 12, marginBottom: 26 }}>
      {back && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("back")}
          onPress={() => router.back()}
          hitSlop={12}
          style={{ width: 44, height: 44, justifyContent: "center" }}
        >
          <ArrowLeft color={c.text} size={24} />
        </Pressable>
      )}
      <Text
        accessibilityRole="header"
        style={{
          fontSize: 34,
          lineHeight: 40,
          fontWeight: "600",
          letterSpacing: -1,
          color: c.text,
          textAlign: "left",
        }}
      >
        {title}
      </Text>
      {subtitle && (
        <Text
          style={{
            fontSize: 16,
            lineHeight: 24,
            color: c.muted,
            textAlign: "left",
          }}
        >
          {subtitle}
        </Text>
      )}
    </View>
  );
}
export function Label({
  children,
  muted = false,
  style,
}: React.PropsWithChildren<{ muted?: boolean; style?: object }>) {
  const c = useTheme();
  return (
    <Text
      style={[
        {
          fontSize: 16,
          lineHeight: 24,
          color: muted ? c.muted : c.text,
          textAlign: "left",
          writingDirection: "ltr",
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Button({
  title,
  onPress,
  disabled = false,
  busy = false,
  secondary = false,
  danger = false,
  testID,
  icon: Icon,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondary?: boolean;
  danger?: boolean;
  testID?: string;
  icon?: LucideIcon;
}) {
  const c = useTheme();
  const color = secondary ? (danger ? c.danger : c.text) : c.onPrimary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 54,
        borderRadius: 18,
        backgroundColor: secondary ? c.card : danger ? c.danger : c.primary,
        borderWidth: secondary ? 1 : 0,
        borderColor: c.line,
        paddingHorizontal: 20,
        paddingVertical: 14,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 10,
        opacity: disabled || busy ? 0.5 : pressed ? 0.75 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        Icon && <Icon size={20} color={color} />
      )}
      <Text
        style={{
          fontSize: 16,
          fontWeight: "600",
          color,
          flexShrink: 1,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Label style={{ fontSize: 14, fontWeight: "500" }}>{label}</Label>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        style={[
          {
            minHeight: 58,
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 16,
            paddingHorizontal: 16,
            fontSize: 18,
            color: c.text,
            backgroundColor: c.card,
            textAlign: "left",
            writingDirection: "ltr",
          },
          props.style,
        ]}
      />
    </View>
  );
}
export function Avatar({ name, size = 52 }: { name: string; size?: number }) {
  const c = useTheme();
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return (
    <View
      style={{
        height: size,
        width: size,
        borderRadius: size / 2,
        backgroundColor: c.avatar,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: c.text, fontSize: size / 3, fontWeight: "500" }}>
        {initials}
      </Text>
    </View>
  );
}
export function Card({
  children,
  style,
}: React.PropsWithChildren<{ style?: ViewStyle }>) {
  const c = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderRadius: 22,
          padding: 20,
          borderWidth: 1,
          borderColor: c.line,
          gap: 12,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function ErrorBanner({
  message,
  retry,
}: {
  message: string | null;
  retry?: () => void;
}) {
  const c = useTheme();
  if (!message) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        borderLeftColor: c.danger,
        borderLeftWidth: 3,
        padding: 12,
        gap: 8,
        marginBottom: 16,
      }}
    >
      <Label>{message}</Label>
      {retry && <Button title={t("retry")} onPress={retry} secondary />}
    </View>
  );
}
const styles = StyleSheet.create({
  page: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32, gap: 18 },
});

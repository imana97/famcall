import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { LucideIcon } from "lucide-react-native";
import { ArrowLeft } from "lucide-react-native";
import { router } from "expo-router";
import { t } from "../i18n";
import { HapticPressable as Pressable } from "./HapticPressable";
import { useLanguage } from "../state/Language";

export function useTheme() {
  const { language } = useLanguage();
  const colors = useColorScheme() === "dark"
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
  return { ...colors, language };
}
export function Page({
  children,
  scroll = true,
  safeBottom = true,
  header,
  headerStyle,
  footer,
  contentStyle,
}: React.PropsWithChildren<{
  scroll?: boolean;
  safeBottom?: boolean;
  header?: React.ReactNode;
  headerStyle?: ViewStyle;
  footer?: React.ReactNode;
  contentStyle?: ViewStyle;
}>) {
  const c = useTheme();
  return (
    <SafeAreaView
      edges={
        safeBottom ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]
      }
      style={{ flex: 1, backgroundColor: c.bg, direction: "ltr" }}
    >
      {header && (
        <View style={[{
          paddingHorizontal: 24,
          paddingTop: 12,
          paddingBottom: 16,
          gap: 12,
          borderBottomWidth: 1,
          borderBottomColor: c.line,
          backgroundColor: c.bg,
        }, headerStyle]}>
          {header}
        </View>
      )}
      {scroll ? (
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.page, contentStyle]}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={[styles.page, { flex: 1 }]}>{children}</View>
      )}
      {footer && (
        <View
          style={{
            flexShrink: 0,
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: 8,
            gap: 8,
            borderTopWidth: 1,
            borderTopColor: c.line,
            backgroundColor: c.bg,
          }}
        >
          {footer}
        </View>
      )}
    </SafeAreaView>
  );
}
export function Heading({
  title,
  subtitle,
  back = false,
  bottomSpacing = 26,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  bottomSpacing?: number;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 12, marginBottom: bottomSpacing }}>
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
          writingDirection: "ltr",
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
            writingDirection: "ltr",
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
  style,
  textStyle,
  selected,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondary?: boolean;
  danger?: boolean;
  testID?: string;
  icon?: LucideIcon;
  style?: ViewStyle;
  textStyle?: TextStyle;
  selected?: boolean;
}) {
  const c = useTheme();
  const color = secondary ? (danger ? c.danger : c.text) : c.onPrimary;
  return (
    <Pressable
      testID={testID}
      haptic={danger ? "medium" : selected !== undefined || secondary ? "selection" : "light"}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy, selected }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [{
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
      }, style]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        Icon && <Icon size={20} color={color} />
      )}
      <Text
        style={[{
          fontSize: 16,
          fontWeight: "600",
          color,
          flexShrink: 1,
          textAlign: "center",
          writingDirection: "ltr",
        }, textStyle]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({ label, hideLabel = false, ...props }: TextInputProps & { label: string; hideLabel?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {!hideLabel && <Label style={{ fontSize: 14, fontWeight: "500" }}>{label}</Label>}
      <TextInput
        returnKeyType="done"
        inputAccessoryViewButtonLabel={t("done")}
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

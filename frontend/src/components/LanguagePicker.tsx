import { Check, Globe } from "lucide-react-native";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SUPPORTED, useTranslation } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/lib/theme";

/**
 * Reusable language picker shown as a bottom sheet modal. Use from anywhere:
 *   const [open, setOpen] = useState(false);
 *   <LanguagePicker visible={open} onClose={() => setOpen(false)} />
 */
export function LanguagePicker({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { locale, setLocale, t } = useTranslation();
  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Globe size={20} color={colors.primary} />
            <Text style={styles.title}>{t("common.change_language")}</Text>
          </View>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {SUPPORTED.map((lang) => {
            const active = locale === lang.code;
            return (
              <Pressable
                key={lang.code}
                testID={`lang-${lang.code}`}
                onPress={async () => {
                  await setLocale(lang.code);
                  onClose();
                }}
                style={[styles.row, active && styles.rowActive]}
              >
                <Text style={styles.flag}>{lang.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.native}>{lang.native}</Text>
                  <Text style={styles.english}>{lang.label}</Text>
                </View>
                {active ? <Check size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Compact pill button used in headers — opens the picker. */
export function LanguagePill({ onPress }: { onPress: () => void }) {
  const { locale } = useTranslation();
  const meta = SUPPORTED.find((s) => s.code === locale) || SUPPORTED[0];
  return (
    <Pressable
      testID="lang-pill"
      onPress={onPress}
      style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.pillFlag}>{meta.flag}</Text>
      <Text style={styles.pillText}>{meta.code.toUpperCase()}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: 8,
    paddingBottom: spacing.xl,
    gap: 6,
    maxHeight: "85%",
  },
  scroll: {
    flexGrow: 0,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
  },
  rowActive: { backgroundColor: colors.primarySoft },
  flag: { fontSize: 28 },
  native: { fontSize: 16, fontWeight: "800", color: colors.text },
  english: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillFlag: { fontSize: 14 },
  pillText: { fontSize: 11, fontWeight: "800", color: colors.text, letterSpacing: 0.3 },
});

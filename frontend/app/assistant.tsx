import { useRouter } from "expo-router";
import { ChevronLeft, RotateCcw, Send, Sparkles } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";
import { storage } from "@/src/utils/storage";

type Product = {
  id: string;
  name: string;
  image: string;
  price_nzd: number;
  category?: string;
  subcategory?: string | null;
  rating?: number;
  reviews_count?: number;
  seller_name?: string | null;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  products?: Product[];
};

const SESSION_KEY = "allsale_assistant_session_id";

const STARTERS = [
  "Show me sarees under $50",
  "Best gifts for Diwali",
  "What's on sale today?",
  "Help me pick a kurta",
];

export default function AssistantScreen() {
  const router = useRouter();
  const { show } = useToast();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const listRef = useRef<FlatList<Msg>>(null);

  // Restore session if present
  useEffect(() => {
    (async () => {
      try {
        const stored = await storage.getItem<string>(SESSION_KEY, "");
        if (stored) {
          setSessionId(stored);
          try {
            const d = await api<{ messages: Msg[] }>(
              `/assistant/sessions/${stored}`
            );
            setMessages(d.messages || []);
          } catch {
            // session not found / expired — fresh start
            await storage.removeItem(SESSION_KEY);
            setSessionId(null);
          }
        }
      } finally {
        setLoadingHistory(false);
      }
    })();
  }, []);

  // Scroll on new messages
  useEffect(() => {
    if (messages.length === 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages]);

  const send = useCallback(
    async (text?: string) => {
      const msg = (text ?? input).trim();
      if (!msg || sending) return;
      const optimistic: Msg = { role: "user", content: msg };
      setMessages((prev) => [...prev, optimistic]);
      setInput("");
      setSending(true);
      try {
        const d = await api<{
          session_id: string;
          reply: string;
          products: Product[];
        }>("/assistant/chat", {
          method: "POST",
          body: { message: msg, session_id: sessionId || undefined },
        });
        if (!sessionId) {
          setSessionId(d.session_id);
          await storage.setItem(SESSION_KEY, d.session_id);
        }
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: d.reply, products: d.products || [] },
        ]);
      } catch (e: any) {
        show({
          title: "Assistant unavailable",
          body: e?.message || "Try again.",
          kind: "error",
        });
      } finally {
        setSending(false);
      }
    },
    [input, sending, sessionId, show]
  );

  const resetChat = useCallback(async () => {
    setMessages([]);
    setSessionId(null);
    await storage.removeItem(SESSION_KEY);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Msg }) => {
      if (item.role === "user") {
        return (
          <View style={[styles.bubbleRow, { justifyContent: "flex-end" }]}>
            <View style={[styles.bubble, styles.userBubble]}>
              <Text style={styles.userText}>{item.content}</Text>
            </View>
          </View>
        );
      }
      return (
        <View style={styles.bubbleRow}>
          <View style={styles.avatar}>
            <Sparkles size={14} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[styles.bubble, styles.asstBubble]}>
              <Text style={styles.asstText}>{item.content}</Text>
            </View>
            {item.products && item.products.length > 0 ? (
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={item.products}
                keyExtractor={(p) => p.id}
                contentContainerStyle={{ gap: 8, paddingRight: 8 }}
                renderItem={({ item: p }) => (
                  <Pressable
                    testID={`assistant-product-${p.id}`}
                    onPress={() => router.push(`/product/${p.id}`)}
                    style={styles.productCard}
                  >
                    <Image
                      source={{ uri: p.image }}
                      style={styles.productImage}
                    />
                    <Text style={styles.productName} numberOfLines={2}>
                      {p.name}
                    </Text>
                    <Text style={styles.productPrice}>
                      ${p.price_nzd.toFixed(2)}
                    </Text>
                  </Pressable>
                )}
              />
            ) : null}
          </View>
        </View>
      );
    },
    [router]
  );

  const empty = useMemo(
    () => (
      <View style={styles.empty}>
        <View style={styles.heroIcon}>
          <Sparkles size={32} color={colors.primary} />
        </View>
        <Text style={styles.heroTitle}>How can I help you shop today?</Text>
        <Text style={styles.heroSub}>
          Ask anything — I can find products, suggest gifts, or help you pick
          between options. Powered by Claude Sonnet 4.5.
        </Text>
        <View style={styles.starterGrid}>
          {STARTERS.map((s) => (
            <Pressable
              key={s}
              testID={`assistant-starter-${s}`}
              onPress={() => send(s)}
              style={styles.starterChip}
            >
              <Text style={styles.starterText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    ),
    [send]
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="assistant-back"
          onPress={() => router.back()}
          style={styles.headerBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Allsale Assistant</Text>
          <Text style={styles.headerSub}>Powered by Claude Sonnet 4.5</Text>
        </View>
        {messages.length > 0 ? (
          <Pressable
            testID="assistant-reset"
            onPress={resetChat}
            style={styles.headerBtn}
          >
            <RotateCcw size={18} color={colors.textMuted} />
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        {loadingHistory ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : messages.length === 0 ? (
          empty
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(_, i) => `m${i}`}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: true })
            }
          />
        )}

        {sending ? (
          <View style={styles.typingRow}>
            <View style={styles.avatar}>
              <Sparkles size={14} color={colors.primary} />
            </View>
            <View style={[styles.bubble, styles.asstBubble]}>
              <ActivityIndicator color={colors.primary} size="small" />
            </View>
          </View>
        ) : null}

        <View style={styles.inputBar}>
          <TextInput
            testID="assistant-input"
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            maxLength={500}
            onSubmitEditing={() => send()}
            editable={!sending}
          />
          <Pressable
            testID="assistant-send"
            onPress={() => send()}
            disabled={!input.trim() || sending}
            style={[
              styles.sendBtn,
              (!input.trim() || sending) && { opacity: 0.4 },
            ]}
          >
            <Send size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#fff",
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontWeight: "800", color: colors.text, fontSize: 15 },
  headerSub: { color: colors.textMuted, fontSize: 11 },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  empty: { flex: 1, padding: spacing.xl, gap: 14, alignItems: "center", justifyContent: "center" },
  heroIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.primarySoft,
    alignItems: "center", justifyContent: "center",
  },
  heroTitle: {
    fontSize: 22, fontWeight: "800", color: colors.text, textAlign: "center",
  },
  heroSub: {
    fontSize: 13, color: colors.textMuted, textAlign: "center",
    lineHeight: 18, paddingHorizontal: spacing.md,
  },
  starterGrid: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "center",
    gap: 8, marginTop: 12,
  },
  starterChip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 999, backgroundColor: "#fff",
    borderWidth: 1, borderColor: colors.border,
  },
  starterText: { color: colors.text, fontWeight: "700", fontSize: 12 },

  listContent: { padding: spacing.md, gap: 12 },

  bubbleRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  avatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: "center", justifyContent: "center",
  },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: radius.md,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderTopRightRadius: 4,
  },
  userText: { color: "#fff", fontSize: 14, lineHeight: 20 },
  asstBubble: {
    backgroundColor: "#fff",
    borderWidth: 1, borderColor: colors.border,
    borderTopLeftRadius: 4,
  },
  asstText: { color: colors.text, fontSize: 14, lineHeight: 20 },

  productCard: {
    width: 140,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    gap: 4,
  },
  productImage: {
    width: "100%", height: 90, borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  productName: { color: colors.text, fontSize: 12, fontWeight: "700" },
  productPrice: { color: colors.text, fontSize: 13, fontWeight: "800" },

  typingRow: { flexDirection: "row", gap: 8, padding: spacing.md, paddingTop: 0 },

  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 14,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center",
  },
});

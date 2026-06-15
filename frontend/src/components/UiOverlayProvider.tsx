/**
 * UiOverlayProvider — web-safe replacement for React Native's Alert.alert.
 *
 * Exposes two hooks:
 *  - useConfirm() → opens a Modal with a promise-based confirmation. Works on web AND native.
 *  - useToast()   → shows a top banner toast (success / error / info). Auto-dismisses.
 *
 * Why this exists:
 *   Alert.alert is a no-op on react-native-web ~0.21 for multi-button dialogs,
 *   silently dropping destructive confirmations. This provider unifies both.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colors, radius, spacing } from "@/src/lib/theme";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export type ToastKind = "success" | "error" | "info";

export type ToastOptions = {
  title: string;
  body?: string;
  kind?: ToastKind;
  /** ms to auto-dismiss, defaults to 4000 (5000 for success) */
  duration?: number;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
type ToastShowFn = (opts: ToastOptions) => void;

const ConfirmCtx = createContext<ConfirmFn | null>(null);
const ToastCtx = createContext<ToastShowFn | null>(null);

export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm must be used inside <UiOverlayProvider>");
  return ctx;
};

export const useToast = (): { show: ToastShowFn } => {
  const show = useContext(ToastCtx);
  if (!show) throw new Error("useToast must be used inside <UiOverlayProvider>");
  return { show };
};

/* ------------------------------------------------------------------ */
/* Provider                                                           */
/* ------------------------------------------------------------------ */

type ConfirmState = ConfirmOptions & {
  visible: boolean;
  resolve: (v: boolean) => void;
};

type ToastState = ToastOptions & { id: number };

export function UiOverlayProvider({ children }: { children: React.ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const toastIdRef = useRef(0);

  /* ---------- Confirm ---------- */

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ ...opts, visible: true, resolve });
      }),
    []
  );

  const closeConfirm = useCallback(
    (result: boolean) => {
      if (!confirmState) return;
      confirmState.resolve(result);
      setConfirmState(null);
    },
    [confirmState]
  );

  /* ---------- Toast ---------- */

  const showToast = useCallback<ToastShowFn>((opts) => {
    const id = ++toastIdRef.current;
    const duration =
      opts.duration ??
      (opts.kind === "success" ? 5000 : opts.kind === "error" ? 6000 : 4000);
    setToasts((prev) => [...prev, { ...opts, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /* ---------- Memos ---------- */

  const confirmFn = useMemo(() => confirm, [confirm]);
  const toastFn = useMemo(() => showToast, [showToast]);

  return (
    <ConfirmCtx.Provider value={confirmFn}>
      <ToastCtx.Provider value={toastFn}>
        {children}

        {/* Confirm modal */}
        <Modal
          visible={!!confirmState?.visible}
          transparent
          animationType="fade"
          onRequestClose={() => closeConfirm(false)}
        >
          <Pressable
            style={overlay.backdrop}
            onPress={() => closeConfirm(false)}
            testID="confirm-backdrop"
          >
            <Pressable style={overlay.card} onPress={(e) => e.stopPropagation()}>
              <Text style={overlay.title}>{confirmState?.title}</Text>
              {!!confirmState?.message && (
                <Text style={overlay.message}>{confirmState.message}</Text>
              )}
              <View style={overlay.buttonRow}>
                <Pressable
                  testID="confirm-cancel"
                  onPress={() => closeConfirm(false)}
                  style={overlay.cancelBtn}
                >
                  <Text style={overlay.cancelText}>
                    {confirmState?.cancelLabel || "Cancel"}
                  </Text>
                </Pressable>
                <Pressable
                  testID="confirm-ok"
                  onPress={() => closeConfirm(true)}
                  style={[
                    overlay.okBtn,
                    confirmState?.destructive && overlay.dangerBtn,
                  ]}
                >
                  <Text
                    style={[
                      overlay.okText,
                      confirmState?.destructive && overlay.dangerText,
                    ]}
                  >
                    {confirmState?.confirmLabel ||
                      (confirmState?.destructive ? "Delete" : "Confirm")}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Toast stack */}
        {toasts.length > 0 && (
          <View pointerEvents="box-none" style={overlay.toastStack}>
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
            ))}
          </View>
        )}
      </ToastCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Toast item                                                         */
/* ------------------------------------------------------------------ */

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastState;
  onDismiss: () => void;
}) {
  const palette = TOAST_PALETTE[toast.kind || "info"];
  return (
    <Pressable
      onPress={onDismiss}
      testID={`toast-${toast.kind || "info"}`}
      style={[
        overlay.toast,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[overlay.toastTitle, { color: palette.title }]}>
          {toast.title}
        </Text>
        {!!toast.body && (
          <Text style={[overlay.toastBody, { color: palette.body }]}>
            {toast.body}
          </Text>
        )}
      </View>
      <Text style={[overlay.toastDismiss, { color: palette.title }]}>×</Text>
    </Pressable>
  );
}

const TOAST_PALETTE: Record<
  ToastKind,
  { bg: string; border: string; title: string; body: string }
> = {
  success: { bg: "#ecfdf5", border: "#a7f3d0", title: "#065f46", body: "#047857" },
  error: { bg: "#fef2f2", border: "#fecaca", title: "#991b1b", body: "#b91c1c" },
  info: { bg: "#eff6ff", border: "#bfdbfe", title: "#1e3a8a", body: "#1e40af" },
};

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const overlay = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "#fff",
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  message: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  buttonRow: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    backgroundColor: "#f1f5f9",
  },
  cancelText: { color: colors.text, fontWeight: "600", fontSize: 14 },
  okBtn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  okText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  dangerBtn: { backgroundColor: "#dc2626" },
  dangerText: { color: "#fff" },
  toastStack: {
    position: "absolute",
    top: 60,
    left: 12,
    right: 12,
    gap: 8,
    zIndex: 9999,
  },
  toast: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  toastTitle: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
  toastBody: { fontSize: 13, lineHeight: 18 },
  toastDismiss: { fontSize: 22, fontWeight: "700", paddingHorizontal: 4 },
});

import { useRouter } from "expo-router";
import {
  ChevronLeft,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AdminForbidden,
  AdminIdentity,
  AdminUnauthorized,
  adminApi,
  fetchCurrentAdmin,
  getAdminIdentity,
  bootstrapIdentity,
  getAdminSecret,
} from "@/src/lib/adminApi";
import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import { useTranslation } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/lib/theme";

type TeamMember = {
  id: string;
  email: string;
  full_name?: string | null;
  role: "owner" | "manager" | "support";
  is_active: boolean;
  created_at?: string | null;
  last_login_at?: string | null;
};

type RoleDef = {
  value: "owner" | "manager" | "support";
  label: string;
  description: string;
};

export default function AdminTeam() {
  const router = useRouter();
  const { t } = useTranslation();
  const { show } = useToast();
  const confirm = useConfirm();

  const [me, setMe] = useState<AdminIdentity | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<RoleDef["value"]>("support");
  const [creating, setCreating] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  // Reset password dialog
  const [resetForId, setResetForId] = useState<string | null>(null);
  const [resetEmail, setResetEmail] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Resolve identity (token first, then bootstrap-secret fallback).
      let identity: AdminIdentity | null = await getAdminIdentity();
      if (!identity) {
        identity = await fetchCurrentAdmin();
      }
      if (!identity) {
        // Maybe bootstrap secret session
        const sec = await getAdminSecret();
        if (sec) identity = bootstrapIdentity();
      }
      setMe(identity);

      const [team, rolesResp] = await Promise.all([
        adminApi<TeamMember[]>("/admin/team"),
        adminApi<{ roles: RoleDef[] }>("/admin/team/roles"),
      ]);
      setMembers(team);
      setRoles(rolesResp.roles || []);
    } catch (e: any) {
      if (e instanceof AdminUnauthorized) {
        show({ title: t("admin_team.login_required"), kind: "error" });
        router.replace("/admin");
        return;
      }
      if (e instanceof AdminForbidden) {
        show({ title: t("admin_team.owner_access_required"), kind: "error" });
        router.replace("/admin");
        return;
      }
      show({ title: e?.message || t("admin_team.failed_to_load"), kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [router, show, t]);

  useEffect(() => {
    load();
  }, [load]);

  // ------------------ CREATE ------------------
  const onCreate = async () => {
    const email = newEmail.trim().toLowerCase();
    const full_name = newName.trim();
    if (!email || !full_name) {
      show({ title: t("admin_team.email_name_required"), kind: "error" });
      return;
    }
    setCreating(true);
    try {
      const resp = await adminApi<TeamMember & { _initial_password?: string }>(
        "/admin/team",
        { method: "POST", body: { email, full_name, role: newRole } },
      );
      setCreatedEmail(resp.email);
      setCreatedPassword(resp._initial_password || "(see admin)");
      setNewEmail("");
      setNewName("");
      setNewRole("support");
      setCreateOpen(false);
      await load();
    } catch (e: any) {
      show({ title: e?.message || t("admin_team.create_failed"), kind: "error" });
    } finally {
      setCreating(false);
    }
  };

  // ------------------ TOGGLE ACTIVE ------------------
  const onToggleActive = async (m: TeamMember) => {
    try {
      await adminApi(`/admin/team/${m.id}`, {
        method: "PATCH",
        body: { is_active: !m.is_active },
      });
      await load();
    } catch (e: any) {
      show({ title: e?.message || t("admin_team.update_failed"), kind: "error" });
    }
  };

  // ------------------ CHANGE ROLE ------------------
  const onChangeRole = async (m: TeamMember, role: RoleDef["value"]) => {
    if (m.role === role) return;
    try {
      await adminApi(`/admin/team/${m.id}`, {
        method: "PATCH",
        body: { role },
      });
      show({ title: t("admin_team.role_updated_to", { role }), kind: "success" });
      await load();
    } catch (e: any) {
      show({ title: e?.message || t("admin_team.update_failed"), kind: "error" });
    }
  };

  // ------------------ RESET PASSWORD ------------------
  const onResetPassword = async (m: TeamMember) => {
    setResetForId(m.id);
    setResetEmail(m.email);
    setResetPassword(null);
    setResetBusy(true);
    try {
      const resp = await adminApi<{ new_password: string }>(
        `/admin/team/${m.id}/reset-password`,
        { method: "POST", body: {} },
      );
      setResetPassword(resp.new_password);
    } catch (e: any) {
      show({ title: e?.message || t("admin_team.reset_failed"), kind: "error" });
      setResetForId(null);
    } finally {
      setResetBusy(false);
    }
  };

  // ------------------ DELETE ------------------
  const onDelete = async (m: TeamMember) => {
    const ok = await confirm({
      title: t("admin_team.confirm_remove_title", { email: m.email }),
      message: t("admin_team.confirm_remove_msg"),
      confirmLabel: t("admin_team.confirm_remove_btn"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi(`/admin/team/${m.id}`, { method: "DELETE" });
      show({ title: t("admin_team.admin_deleted"), kind: "success" });
      await load();
    } catch (e: any) {
      show({ title: e?.message || t("admin_team.delete_failed"), kind: "error" });
    }
  };

  // ------------------ RENDER ------------------
  if (loading && !members.length) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Header title={t("admin_team.title")} onBack={() => router.back()} />
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const myId = me?.id;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Header title={t("admin_team.title_full")} onBack={() => router.back()} onRefresh={load} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.intro}>
          <ShieldCheck size={28} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>{t("admin_team.intro_title")}</Text>
            <Text style={styles.introBody}>
              {t("admin_team.intro_body")}
            </Text>
          </View>
        </View>

        <Pressable
          testID="admin-team-invite-btn"
          style={({ pressed }) => [styles.inviteBtn, pressed && { opacity: 0.85 }]}
          onPress={() => setCreateOpen(true)}
        >
          <Plus size={18} color="#fff" />
          <Text style={styles.inviteBtnText}>{t("admin_team.invite_btn")}</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>{t("admin_team.team_count", { count: members.length })}</Text>

        {members.map((m) => (
          <MemberCard
            key={m.id}
            member={m}
            isMe={m.id === myId}
            roles={roles}
            onToggleActive={() => onToggleActive(m)}
            onChangeRole={(r) => onChangeRole(m, r)}
            onResetPassword={() => onResetPassword(m)}
            onDelete={() => onDelete(m)}
            t={t}
          />
        ))}

        <Text style={styles.sectionLabel}>{t("admin_team.roles_section")}</Text>
        {roles.map((r) => (
          <View key={r.value} style={styles.roleCard}>
            <Text style={styles.roleLabelBig}>{r.label}</Text>
            <Text style={styles.roleDesc}>{r.description}</Text>
          </View>
        ))}
      </ScrollView>

      {/* CREATE MODAL */}
      <Modal visible={createOpen} animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{t("admin_team.modal_invite_title")}</Text>
              <Pressable onPress={() => setCreateOpen(false)} style={styles.modalClose}>
                <X size={20} color={colors.textMuted} />
              </Pressable>
            </View>
            <TextInput
              testID="team-new-email"
              placeholder={t("admin_team.placeholder_email")}
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              keyboardType="email-address"
              value={newEmail}
              onChangeText={setNewEmail}
              style={styles.modalInput}
            />
            <TextInput
              testID="team-new-name"
              placeholder={t("admin_team.placeholder_full_name")}
              placeholderTextColor={colors.textFaint}
              value={newName}
              onChangeText={setNewName}
              style={styles.modalInput}
            />
            <Text style={styles.modalLabel}>{t("admin_team.label_role")}</Text>
            <View style={styles.rolePicker}>
              {roles.map((r) => (
                <Pressable
                  key={r.value}
                  onPress={() => setNewRole(r.value)}
                  style={[styles.rolePill, newRole === r.value && styles.rolePillActive]}
                >
                  <Text style={[styles.rolePillText, newRole === r.value && styles.rolePillTextActive]}>
                    {r.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              testID="team-create-submit"
              disabled={creating || !newEmail.trim() || !newName.trim()}
              onPress={onCreate}
              style={[
                styles.modalSubmit,
                (creating || !newEmail.trim() || !newName.trim()) && { opacity: 0.5 },
              ]}
            >
              {creating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalSubmitText}>{t("admin_team.create_admin_btn")}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* CREATED PASSWORD MODAL */}
      <Modal visible={!!createdPassword} animationType="fade" transparent onRequestClose={() => setCreatedPassword(null)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{t("admin_team.created_title")}</Text>
            </View>
            <Text style={styles.passwordCalloutLabel}>{t("admin_team.initial_password_label")}</Text>
            <View style={styles.passwordCallout}>
              <Text style={styles.passwordValue} selectable>
                {createdPassword}
              </Text>
            </View>
            <Text style={styles.passwordBody}>
              {t("admin_team.email_prefix")}<Text style={{ fontWeight: "700" }}>{createdEmail}</Text>
              {"\n\n"}{t("admin_team.share_password_body")}
            </Text>
            <Pressable
              onPress={() => {
                setCreatedPassword(null);
                setCreatedEmail(null);
              }}
              style={styles.modalSubmit}
            >
              <Text style={styles.modalSubmitText}>{t("admin_team.got_it")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* RESET PASSWORD MODAL */}
      <Modal visible={!!resetForId} animationType="fade" transparent onRequestClose={() => setResetForId(null)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{t("admin_team.reset_title")}</Text>
            </View>
            {resetBusy ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
            ) : (
              <>
                <Text style={styles.passwordCalloutLabel}>{t("admin_team.new_password_label")}</Text>
                <View style={styles.passwordCallout}>
                  <Text style={styles.passwordValue} selectable>
                    {resetPassword}
                  </Text>
                </View>
                <Text style={styles.passwordBody}>
                  {t("admin_team.for_prefix")}<Text style={{ fontWeight: "700" }}>{resetEmail}</Text>
                  {"\n\n"}{t("admin_team.share_reset_body")}
                </Text>
                <Pressable
                  onPress={() => {
                    setResetForId(null);
                    setResetPassword(null);
                    setResetEmail(null);
                  }}
                  style={styles.modalSubmit}
                >
                  <Text style={styles.modalSubmitText}>{t("admin_team.got_it")}</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Header({
  title,
  onBack,
  onRefresh,
}: {
  title: string;
  onBack: () => void;
  onRefresh?: () => void;
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerBtn}>
        <ChevronLeft size={22} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      {onRefresh ? (
        <Pressable onPress={onRefresh} style={styles.headerBtn}>
          <RefreshCw size={18} color={colors.text} />
        </Pressable>
      ) : (
        <View style={{ width: 40 }} />
      )}
    </View>
  );
}

function MemberCard({
  member,
  isMe,
  roles,
  onToggleActive,
  onChangeRole,
  onResetPassword,
  onDelete,
  t,
}: {
  member: TeamMember;
  isMe: boolean;
  roles: RoleDef[];
  onToggleActive: () => void;
  onChangeRole: (role: RoleDef["value"]) => void;
  onResetPassword: () => void;
  onDelete: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <View style={styles.memberCard}>
      <View style={styles.memberHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.memberName}>
            {member.full_name || member.email} {isMe ? t("admin_team.you_suffix") : ""}
          </Text>
          <Text style={styles.memberEmail}>{member.email}</Text>
        </View>
        <View style={[styles.statusChip, member.is_active ? styles.chipOn : styles.chipOff]}>
          <Text style={styles.statusChipText}>
            {member.is_active ? t("admin_team.status_active") : t("admin_team.status_disabled")}
          </Text>
        </View>
      </View>

      <Text style={styles.memberLabel}>{t("admin_team.label_role")}</Text>
      <View style={styles.rolePicker}>
        {roles.map((r) => (
          <Pressable
            key={r.value}
            onPress={() => onChangeRole(r.value)}
            disabled={isMe && r.value !== "owner"}
            style={[
              styles.rolePill,
              member.role === r.value && styles.rolePillActive,
              isMe && r.value !== "owner" && { opacity: 0.4 },
            ]}
          >
            <Text style={[styles.rolePillText, member.role === r.value && styles.rolePillTextActive]}>
              {r.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.actionsRow}>
        <View style={styles.toggleRow}>
          <Text style={styles.memberLabel}>{t("admin_team.label_active")}</Text>
          <Switch
            value={member.is_active}
            onValueChange={onToggleActive}
            disabled={isMe}
            trackColor={{ false: "#E5E7EB", true: "#10B981" }}
          />
        </View>
        <Pressable onPress={onResetPassword} style={styles.smallBtn}>
          <KeyRound size={14} color={colors.text} />
          <Text style={styles.smallBtnText}>{t("admin_team.reset_password_btn")}</Text>
        </Pressable>
        {!isMe && (
          <Pressable onPress={onDelete} style={[styles.smallBtn, styles.smallBtnDanger]}>
            <Trash2 size={14} color="#DC2626" />
            <Text style={[styles.smallBtnText, { color: "#DC2626" }]}>{t("admin_team.remove_btn")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  scroll: { padding: spacing.md, paddingBottom: 64 },

  intro: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "#F8FAFC",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  introTitle: { fontWeight: "800", color: colors.text, fontSize: 14 },
  introBody: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  inviteBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  inviteBtnText: { color: "#fff", fontWeight: "800" },

  sectionLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 0.5,
    fontWeight: "700",
  },

  memberCard: {
    backgroundColor: "#fff",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  memberHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  memberName: { color: colors.text, fontWeight: "800", fontSize: 14 },
  memberEmail: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  memberLabel: { color: colors.textMuted, fontSize: 11, marginTop: 10, marginBottom: 4, fontWeight: "700" },
  statusChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  statusChipText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  chipOn: { backgroundColor: "#D1FAE5" },
  chipOff: { backgroundColor: "#FEE2E2" },

  rolePicker: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  rolePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "transparent",
  },
  rolePillActive: { backgroundColor: "#EEF2FF", borderColor: colors.primary },
  rolePillText: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  rolePillTextActive: { color: colors.primary },

  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallBtnDanger: { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" },
  smallBtnText: { fontWeight: "700", color: colors.text, fontSize: 12 },

  roleCard: {
    backgroundColor: "#fff",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  roleLabelBig: { fontWeight: "800", color: colors.text, fontSize: 13 },
  roleDesc: { color: colors.textMuted, fontSize: 12, marginTop: 4 },

  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: spacing.lg,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  modalHead: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  modalTitle: { flex: 1, fontWeight: "800", color: colors.text, fontSize: 16 },
  modalClose: { padding: 4 },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fff",
    color: colors.text,
    fontSize: 15,
    marginBottom: 10,
  },
  modalLabel: { color: colors.textMuted, fontSize: 11, marginTop: 6, marginBottom: 6, fontWeight: "700" },
  modalSubmit: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  modalSubmitText: { color: "#fff", fontWeight: "800" },

  passwordCalloutLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 6 },
  passwordCallout: {
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FCD34D",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  passwordValue: {
    color: "#92400E",
    fontWeight: "800",
    fontSize: 18,
    textAlign: "center",
    letterSpacing: 1,
  },
  passwordBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});

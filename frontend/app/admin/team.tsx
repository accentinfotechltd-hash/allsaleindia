import { useRouter } from "expo-router";
import {
  ChevronLeft,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCog,
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
        show({ title: "Login required", kind: "error" });
        router.replace("/admin");
        return;
      }
      if (e instanceof AdminForbidden) {
        show({ title: "Owner access required", kind: "error" });
        router.replace("/admin");
        return;
      }
      show({ title: e?.message || "Failed to load", kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [router, show]);

  useEffect(() => {
    load();
  }, [load]);

  // ------------------ CREATE ------------------
  const onCreate = async () => {
    const email = newEmail.trim().toLowerCase();
    const full_name = newName.trim();
    if (!email || !full_name) {
      show({ title: "Email + name required", kind: "error" });
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
      show({ title: e?.message || "Create failed", kind: "error" });
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
      show({ title: e?.message || "Update failed", kind: "error" });
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
      show({ title: `Role updated to ${role}`, kind: "success" });
      await load();
    } catch (e: any) {
      show({ title: e?.message || "Update failed", kind: "error" });
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
      show({ title: e?.message || "Reset failed", kind: "error" });
      setResetForId(null);
    } finally {
      setResetBusy(false);
    }
  };

  // ------------------ DELETE ------------------
  const onDelete = async (m: TeamMember) => {
    const ok = await confirm({
      title: `Remove ${m.email}?`,
      message: "This permanently deletes the admin account.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi(`/admin/team/${m.id}`, { method: "DELETE" });
      show({ title: "Admin deleted", kind: "success" });
      await load();
    } catch (e: any) {
      show({ title: e?.message || "Delete failed", kind: "error" });
    }
  };

  // ------------------ RENDER ------------------
  if (loading && !members.length) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Header title="Team" onBack={() => router.back()} />
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const myId = me?.id;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Header title="Team & Sub-admins" onBack={() => router.back()} onRefresh={load} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.intro}>
          <ShieldCheck size={28} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>Owner-only area</Text>
            <Text style={styles.introBody}>
              Invite team members and scope their access by role.
              Sub-admins log in with email + password at the admin screen.
            </Text>
          </View>
        </View>

        <Pressable
          testID="admin-team-invite-btn"
          style={({ pressed }) => [styles.inviteBtn, pressed && { opacity: 0.85 }]}
          onPress={() => setCreateOpen(true)}
        >
          <Plus size={18} color="#fff" />
          <Text style={styles.inviteBtnText}>Invite a new admin</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>Team ({members.length})</Text>

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
          />
        ))}

        <Text style={styles.sectionLabel}>Roles</Text>
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
              <Text style={styles.modalTitle}>Invite admin</Text>
              <Pressable onPress={() => setCreateOpen(false)} style={styles.modalClose}>
                <X size={20} color={colors.textMuted} />
              </Pressable>
            </View>
            <TextInput
              testID="team-new-email"
              placeholder="Email"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              keyboardType="email-address"
              value={newEmail}
              onChangeText={setNewEmail}
              style={styles.modalInput}
            />
            <TextInput
              testID="team-new-name"
              placeholder="Full name"
              placeholderTextColor={colors.textFaint}
              value={newName}
              onChangeText={setNewName}
              style={styles.modalInput}
            />
            <Text style={styles.modalLabel}>Role</Text>
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
                <Text style={styles.modalSubmitText}>Create admin</Text>
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
              <Text style={styles.modalTitle}>🎉 Admin created</Text>
            </View>
            <Text style={styles.passwordCalloutLabel}>Initial password — copy NOW (shown once)</Text>
            <View style={styles.passwordCallout}>
              <Text style={styles.passwordValue} selectable>
                {createdPassword}
              </Text>
            </View>
            <Text style={styles.passwordBody}>
              Email: <Text style={{ fontWeight: "700" }}>{createdEmail}</Text>
              {"\n\n"}Share this password with the new admin over a secure
              channel.  They should change it on first login.
            </Text>
            <Pressable
              onPress={() => {
                setCreatedPassword(null);
                setCreatedEmail(null);
              }}
              style={styles.modalSubmit}
            >
              <Text style={styles.modalSubmitText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* RESET PASSWORD MODAL */}
      <Modal visible={!!resetForId} animationType="fade" transparent onRequestClose={() => setResetForId(null)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>🔑 Password reset</Text>
            </View>
            {resetBusy ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
            ) : (
              <>
                <Text style={styles.passwordCalloutLabel}>New password — copy NOW (shown once)</Text>
                <View style={styles.passwordCallout}>
                  <Text style={styles.passwordValue} selectable>
                    {resetPassword}
                  </Text>
                </View>
                <Text style={styles.passwordBody}>
                  For: <Text style={{ fontWeight: "700" }}>{resetEmail}</Text>
                  {"\n\n"}Share via a secure channel.  The admin should rotate
                  it after logging in.
                </Text>
                <Pressable
                  onPress={() => {
                    setResetForId(null);
                    setResetPassword(null);
                    setResetEmail(null);
                  }}
                  style={styles.modalSubmit}
                >
                  <Text style={styles.modalSubmitText}>Got it</Text>
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
}: {
  member: TeamMember;
  isMe: boolean;
  roles: RoleDef[];
  onToggleActive: () => void;
  onChangeRole: (role: RoleDef["value"]) => void;
  onResetPassword: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.memberCard}>
      <View style={styles.memberHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.memberName}>
            {member.full_name || member.email} {isMe ? "(you)" : ""}
          </Text>
          <Text style={styles.memberEmail}>{member.email}</Text>
        </View>
        <View style={[styles.statusChip, member.is_active ? styles.chipOn : styles.chipOff]}>
          <Text style={styles.statusChipText}>
            {member.is_active ? "ACTIVE" : "DISABLED"}
          </Text>
        </View>
      </View>

      <Text style={styles.memberLabel}>Role</Text>
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
          <Text style={styles.memberLabel}>Active</Text>
          <Switch
            value={member.is_active}
            onValueChange={onToggleActive}
            disabled={isMe}
            trackColor={{ false: "#E5E7EB", true: "#10B981" }}
          />
        </View>
        <Pressable onPress={onResetPassword} style={styles.smallBtn}>
          <KeyRound size={14} color={colors.text} />
          <Text style={styles.smallBtnText}>Reset password</Text>
        </Pressable>
        {!isMe && (
          <Pressable onPress={onDelete} style={[styles.smallBtn, styles.smallBtnDanger]}>
            <Trash2 size={14} color="#DC2626" />
            <Text style={[styles.smallBtnText, { color: "#DC2626" }]}>Remove</Text>
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

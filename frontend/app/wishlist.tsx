import { useRouter } from "expo-router";
import {
  ArrowDownAZ,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Circle,
  Clock,
  Heart,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import { EmptyState } from "@/src/components/EmptyState";
import { WishlistListSkeleton } from "@/src/components/SkeletonRows";
import { useTranslation } from "@/src/i18n";
import { useAuth } from "@/src/contexts/AuthContext";
import { useCart } from "@/src/contexts/CartContext";
import { useRegion } from "@/src/contexts/RegionContext";
import { useWishlist } from "@/src/contexts/WishlistContext";
import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type WishItem = {
  product_id: string;
  name: string;
  image: string;
  price_nzd: number;
  price_inr: number;
  category: string;
  rating: number;
  reviews_count: number;
  in_stock: boolean;
  seller_name?: string | null;
  seller_city?: string | null;
  added_at: string;
};

type SortKey = "recent" | "price_asc" | "price_desc" | "name";

const SORT_OPTIONS: { key: SortKey; label: string; icon: React.ReactNode }[] = [
  { key: "recent", label: "Recently added", icon: <Clock size={14} color={colors.text} /> },
  { key: "price_asc", label: "Price · low to high", icon: <ArrowUpNarrowWide size={14} color={colors.text} /> },
  { key: "price_desc", label: "Price · high to low", icon: <ArrowDownNarrowWide size={14} color={colors.text} /> },
  { key: "name", label: "Name · A to Z", icon: <ArrowDownAZ size={14} color={colors.text} /> },
];

export default function WishlistScreen() {
  const router = useRouter();
  const { formatPrice, info } = useRegion();
  const { add, refresh: refreshCart } = useCart();
  const { user } = useAuth();
  const { toggle, refresh } = useWishlist();
  const { show } = useToast();
  const confirm = useConfirm();
  const { t } = useTranslation();

  const [items, setItems] = useState<WishItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<SortKey>("recent");
  const [sortOpen, setSortOpen] = useState(false);
  // Collections (Amazon-style named wishlists)
  type Collection = { id: string; name: string; item_count: number };
  const [collections, setCollections] = useState<Collection[]>([]);
  const [allSavedCount, setAllSavedCount] = useState<number>(0);
  const [activeCollection, setActiveCollection] = useState<string | null>(null); // null = All saved
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [moveListOpen, setMoveListOpen] = useState(false);

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const loadCollections = useCallback(async () => {
    if (!user) {
      setCollections([]);
      setAllSavedCount(0);
      return;
    }
    try {
      const d = await api<{
        all_saved_count: number;
        collections: Collection[];
      }>("/wishlist/collections");
      setCollections(d.collections || []);
      setAllSavedCount(d.all_saved_count || 0);
    } catch {
      setCollections([]);
    }
  }, [user]);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const colParam =
        activeCollection !== null
          ? `&collection_id=${encodeURIComponent(activeCollection)}`
          : "";
      const data = await api<WishItem[]>(
        `/wishlist?sort=${sort}${colParam}`
      );
      setItems(data || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, sort, activeCollection]);

  useEffect(() => {
    load();
    loadCollections();
  }, [load, loadCollections]);

  const createCollection = useCallback(async () => {
    const name = newListName.trim();
    if (!name) return;
    try {
      await api("/wishlist/collections", {
        method: "POST",
        body: { name },
      });
      show({ title: `Created "${name}"`, kind: "success" });
      setNewListName("");
      setNewListOpen(false);
      loadCollections();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't create list";
      show({ title: msg, kind: "error" });
    }
  }, [newListName, show, loadCollections]);

  const moveSelectedToCollection = useCallback(
    async (targetCollectionId: string | null) => {
      if (selected.size === 0) return;
      setBusy(true);
      try {
        await Promise.all(
          Array.from(selected).map((pid) =>
            api(`/wishlist/items/${pid}`, {
              method: "PATCH",
              body: { collection_id: targetCollectionId },
            })
          )
        );
        const name =
          targetCollectionId === null
            ? "All saved"
            : collections.find((c) => c.id === targetCollectionId)?.name ||
              "list";
        show({
          title: `Moved ${selected.size} item${selected.size === 1 ? "" : "s"} to ${name}`,
          kind: "success",
        });
        setMoveListOpen(false);
        setSelected(new Set());
        setSelectionMode(false);
        load();
        loadCollections();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Couldn't move items";
        show({ title: msg, kind: "error" });
      } finally {
        setBusy(false);
      }
    },
    [selected, collections, show, load, loadCollections]
  );


  const onPullRefresh = () => {
    if (!user) return;
    setRefreshing(true);
    Promise.all([refresh(), load()]);
  };

  const onRemove = async (pid: string) => {
    try {
      await toggle(pid);
      setItems((prev) => prev.filter((p) => p.product_id !== pid));
    } catch {
      /* silent */
    }
  };

  const onAddToCart = async (pid: string) => {
    try {
      await add(pid, 1);
      show({ title: "Added to cart", kind: "success" });
    } catch {
      /* context handles errors */
    }
  };

  // ---------------------- Selection mode helpers ----------------------
  const enterSelectionMode = (pid?: string) => {
    setSelectionMode(true);
    if (pid) {
      setSelected(new Set([pid]));
    }
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelected(new Set());
  };

  const toggleSelected = (pid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(items.map((i) => i.product_id)));
  };

  const selectAllInStock = () => {
    setSelectionMode(true);
    setSelected(
      new Set(items.filter((i) => i.in_stock).map((i) => i.product_id)),
    );
  };

  // ---------------------- Bulk actions ----------------------
  const inStockCount = useMemo(
    () => items.filter((i) => i.in_stock).length,
    [items],
  );
  const selectedInStock = useMemo(
    () => items.filter((i) => i.in_stock && selected.has(i.product_id)).length,
    [items, selected],
  );

  const onBulkMoveToCart = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const resp = await api<{
        moved: number;
        moved_ids: string[];
        skipped: { product_id: string; reason: string }[];
      }>("/wishlist/move-to-cart", {
        method: "POST",
        body: {
          product_ids: Array.from(selected),
          remove_after: true,
        },
      });
      const moved = resp.moved || 0;
      const skipped = resp.skipped || [];
      if (moved > 0) {
        setItems((prev) =>
          prev.filter((p) => !resp.moved_ids.includes(p.product_id)),
        );
        await refreshCart();
        await refresh();
      }
      const skipReason =
        skipped.length > 0
          ? ` · ${skipped.length} skipped (out of stock)`
          : "";
      show({
        title:
          moved > 0
            ? `Moved ${moved} item${moved === 1 ? "" : "s"} to cart`
            : "Nothing moved",
        body: skipReason || undefined,
        kind: moved > 0 ? "success" : "error",
      });
      exitSelectionMode();
    } catch (e: any) {
      show({
        title: "Move failed",
        body: e?.message || "Try again",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const onBulkRemove = async () => {
    if (selected.size === 0) return;
    const ok = await confirm({
      title: `Remove ${selected.size} item${selected.size === 1 ? "" : "s"}?`,
      message: "They'll be removed from your wishlist. You can add them back anytime.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const ids = Array.from(selected);
      await api("/wishlist/remove-bulk", {
        method: "POST",
        body: { product_ids: ids },
      });
      setItems((prev) => prev.filter((p) => !ids.includes(p.product_id)));
      await refresh();
      show({
        title: `Removed ${ids.length} item${ids.length === 1 ? "" : "s"}`,
        kind: "success",
      });
      exitSelectionMode();
    } catch (e: any) {
      show({ title: "Remove failed", body: e?.message, kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const onClearAll = async () => {
    if (items.length === 0) return;
    const ok = await confirm({
      title: "Clear entire wishlist?",
      message: `This removes all ${items.length} item${items.length === 1 ? "" : "s"}. You can re-add anytime.`,
      confirmLabel: "Clear all",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api("/wishlist", { method: "DELETE" });
      setItems([]);
      await refresh();
      show({ title: "Wishlist cleared", kind: "success" });
    } catch (e: any) {
      show({ title: "Clear failed", body: e?.message, kind: "error" });
    }
  };

  const onMoveAllInStock = async () => {
    if (inStockCount === 0) return;
    const ok = await confirm({
      title: `Move ${inStockCount} item${inStockCount === 1 ? "" : "s"} to cart?`,
      message: "Out-of-stock items will stay in your wishlist.",
      confirmLabel: "Move all",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const resp = await api<{ moved: number; moved_ids: string[] }>(
        "/wishlist/move-to-cart",
        {
          method: "POST",
          body: { product_ids: [], remove_after: true },
        },
      );
      const moved = resp.moved || 0;
      setItems((prev) =>
        prev.filter((p) => !resp.moved_ids?.includes(p.product_id)),
      );
      await refreshCart();
      await refresh();
      show({
        title: moved > 0 ? `Moved ${moved} item${moved === 1 ? "" : "s"} to cart` : "Nothing to move",
        kind: moved > 0 ? "success" : "error",
      });
    } catch (e: any) {
      show({ title: "Move failed", body: e?.message, kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const currentSort = SORT_OPTIONS.find((s) => s.key === sort) || SORT_OPTIONS[0];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="wishlist-back"
          onPress={selectionMode ? exitSelectionMode : () => router.back()}
          style={styles.backBtn}
        >
          {selectionMode ? (
            <X size={22} color={colors.text} />
          ) : (
            <ChevronLeft size={22} color={colors.text} />
          )}
        </Pressable>
        <Text style={styles.title}>
          {selectionMode
            ? `${selected.size} ${t("common.selected") || "selected"}`
            : `${t("wishlist.title")}${items.length > 0 ? ` · ${items.length}` : ""}`}
        </Text>
        {selectionMode ? (
          <Pressable
            testID="wishlist-select-all"
            onPress={selectAll}
            style={styles.headerRight}
          >
            <Text style={styles.headerLink}>All</Text>
          </Pressable>
        ) : items.length > 0 ? (
          <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
            <Pressable
              testID="wishlist-share-btn"
              onPress={async () => {
                try {
                  const r = await api<{ url: string; token: string }>(
                    "/wishlist/share",
                    { method: "POST" },
                  );
                  const { Share } = await import("react-native");
                  await Share.share({
                    title: "My Allsale wishlist",
                    message: `Check out my Allsale wishlist 🎁 ${r.url}`,
                    url: r.url,
                  });
                  show({ title: "Share link ready", body: r.url, kind: "success" });
                } catch (e: any) {
                  show({ title: e?.message || "Couldn't share", kind: "error" });
                }
              }}
              style={[styles.headerRight, { paddingRight: 2 }]}
            >
              <Text style={styles.headerLink}>Share</Text>
            </Pressable>
            <Pressable
              testID="wishlist-select-mode"
              onPress={() => enterSelectionMode()}
              style={styles.headerRight}
            >
              <Text style={styles.headerLink}>Select</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ width: 56 }} />
        )}
      </View>

      {/* Toolbar — sort + quick actions */}
      {!selectionMode && items.length > 0 ? (
        <View style={styles.toolbar}>
          <Pressable
            testID="wishlist-sort-btn"
            onPress={() => setSortOpen(true)}
            style={styles.sortBtn}
          >
            {currentSort.icon}
            <Text style={styles.sortBtnText} numberOfLines={1}>
              {currentSort.label}
            </Text>
            <ChevronDown size={14} color={colors.textMuted} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={styles.toolbarActions}>
            {inStockCount >= 2 ? (
              <Pressable
                testID="wishlist-move-all-btn"
                disabled={busy}
                onPress={onMoveAllInStock}
                style={styles.moveAllBtn}
              >
                <ShoppingCart size={12} color="#fff" />
                <Text style={styles.moveAllText} numberOfLines={1}>
                  Move {inStockCount}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              testID="wishlist-clear-all-btn"
              disabled={busy}
              onPress={onClearAll}
              style={styles.clearAllBtn}
              hitSlop={6}
            >
              <Trash2 size={13} color={colors.error} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {loading ? (
        <WishlistListSkeleton count={4} />
      ) : !user ? (
        <EmptyState
          icon={Heart}
          title={t("wishlist.signin_required")}
          subtitle={t("wishlist.signin_sub")}
          cta={{
            label: t("auth.sign_in"),
            onPress: () => router.push("/(auth)/login"),
            testID: "wishlist-signin-cta",
          }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Heart}
          title={t("wishlist.empty_title")}
          subtitle={t("wishlist.empty_sub")}
          cta={{
            label: t("wishlist.start_shopping"),
            onPress: () => router.push("/(tabs)/home"),
            testID: "wishlist-shop-cta",
          }}
          secondaryCta={{
            label: t("wishlist.todays_deals"),
            onPress: () => router.push("/deals"),
            testID: "wishlist-deals-cta",
          }}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.product_id}
          contentContainerStyle={[
            styles.list,
            selectionMode && { paddingBottom: 140 },
          ]}
          ListHeaderComponent={
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.collectionChipsRow}
            >
              <Pressable
                testID="wishlist-collection-all"
                onPress={() => setActiveCollection(null)}
                style={[
                  styles.collectionChip,
                  activeCollection === null && styles.collectionChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.collectionChipText,
                    activeCollection === null && styles.collectionChipTextActive,
                  ]}
                >
                  All saved · {allSavedCount}
                </Text>
              </Pressable>
              {collections.map((c) => (
                <Pressable
                  key={c.id}
                  testID={`wishlist-collection-${c.id}`}
                  onPress={() => setActiveCollection(c.id)}
                  style={[
                    styles.collectionChip,
                    activeCollection === c.id && styles.collectionChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.collectionChipText,
                      activeCollection === c.id &&
                        styles.collectionChipTextActive,
                    ]}
                  >
                    {c.name} · {c.item_count}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                testID="wishlist-new-list"
                onPress={() => setNewListOpen(true)}
                style={[styles.collectionChip, styles.collectionChipAdd]}
              >
                <Text
                  style={[
                    styles.collectionChipText,
                    { color: colors.primary },
                  ]}
                >
                  + New list
                </Text>
              </Pressable>
            </ScrollView>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />
          }
          renderItem={({ item }) => {
            const isLocal = info.currency === "NZD";
            const isSelected = selected.has(item.product_id);
            return (
              <Pressable
                testID={`wishlist-card-${item.product_id}`}
                onPress={() => {
                  if (selectionMode) toggleSelected(item.product_id);
                  else router.push(`/product/${item.product_id}`);
                }}
                onLongPress={() => enterSelectionMode(item.product_id)}
                style={[
                  styles.card,
                  isSelected && styles.cardSelected,
                ]}
              >
                {selectionMode ? (
                  <View style={styles.checkbox}>
                    {isSelected ? (
                      <CheckCircle2 size={22} color={colors.primary} fill="#fff" />
                    ) : (
                      <Circle size={22} color={colors.border} />
                    )}
                  </View>
                ) : null}
                <Image source={{ uri: item.image }} style={styles.thumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.category}>{item.category.toUpperCase()}</Text>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.name}
                  </Text>
                  {item.seller_name ? (
                    <Text style={styles.seller}>by {item.seller_name}</Text>
                  ) : null}
                  <Text style={styles.price}>
                    {isLocal
                      ? formatNZD(item.price_nzd)
                      : formatPrice(item.price_nzd)}{" "}
                    <Text style={styles.currCode}>{info.currency}</Text>
                  </Text>
                  {!item.in_stock ? (
                    <Text style={styles.oos}>Out of stock</Text>
                  ) : null}
                  {!selectionMode ? (
                    <View style={styles.cardActions}>
                      <Pressable
                        disabled={!item.in_stock}
                        testID={`wishlist-add-${item.product_id}`}
                        onPress={() => onAddToCart(item.product_id)}
                        style={[
                          styles.addBtn,
                          !item.in_stock && { opacity: 0.5 },
                        ]}
                      >
                        <Text style={styles.addBtnText}>Add to cart</Text>
                      </Pressable>
                      <Pressable
                        testID={`wishlist-remove-${item.product_id}`}
                        onPress={() => onRemove(item.product_id)}
                        style={styles.rmBtn}
                        hitSlop={6}
                      >
                        <Trash2 size={16} color={colors.error} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* SELECTION-MODE ACTION BAR */}
      {selectionMode && items.length > 0 ? (
        <View style={styles.actionBar}>
          <Pressable
            testID="wishlist-bulk-remove-btn"
            disabled={busy || selected.size === 0}
            onPress={onBulkRemove}
            style={[
              styles.bulkRemoveBtn,
              (busy || selected.size === 0) && { opacity: 0.5 },
            ]}
          >
            <Trash2 size={16} color={colors.error} />
            <Text style={styles.bulkRemoveText}>
              Remove ({selected.size})
            </Text>
          </Pressable>
          <Pressable
            testID="wishlist-bulk-tolist-btn"
            disabled={busy || selected.size === 0 || collections.length === 0}
            onPress={() => setMoveListOpen(true)}
            style={[
              styles.bulkRemoveBtn,
              {
                borderColor: colors.primary,
                backgroundColor: colors.primarySoft,
              },
              (busy || selected.size === 0 || collections.length === 0) && {
                opacity: 0.5,
              },
            ]}
          >
            <Text style={[styles.bulkRemoveText, { color: colors.primary }]}>
              Move to list ({selected.size})
            </Text>
          </Pressable>
          <Pressable
            testID="wishlist-bulk-move-btn"
            disabled={busy || selectedInStock === 0}
            onPress={onBulkMoveToCart}
            style={[
              styles.bulkMoveBtn,
              (busy || selectedInStock === 0) && { opacity: 0.5 },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <ShoppingCart size={16} color="#fff" />
                <Text style={styles.bulkMoveText}>
                  Move {selectedInStock} to cart
                </Text>
              </>
            )}
          </Pressable>
        </View>
      ) : null}

      {/* SORT SHEET */}
      <Modal
        visible={sortOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortOpen(false)}
      >
        <Pressable
          style={styles.sortScrim}
          onPress={() => setSortOpen(false)}
        >
          <Pressable
            style={styles.sortSheet}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.sortSheetTitle}>Sort by</Text>
            {SORT_OPTIONS.map((opt) => {
              const active = opt.key === sort;
              return (
                <Pressable
                  key={opt.key}
                  testID={`wishlist-sort-${opt.key}`}
                  onPress={() => {
                    setSort(opt.key);
                    setSortOpen(false);
                  }}
                  style={[styles.sortOption, active && styles.sortOptionActive]}
                >
                  {opt.icon}
                  <Text
                    style={[
                      styles.sortOptionText,
                      active && { color: colors.primary, fontWeight: "800" },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {active ? (
                    <CheckCircle2 size={16} color={colors.primary} />
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable
              testID="wishlist-select-all-in-stock"
              onPress={() => {
                setSortOpen(false);
                selectAllInStock();
              }}
              style={styles.quickActionRow}
            >
              <CheckCircle2 size={14} color={colors.primary} />
              <Text style={styles.quickActionText}>
                Select all in-stock items
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* New list modal */}
      <Modal
        visible={moveListOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMoveListOpen(false)}
      >
        <Pressable
          style={styles.newListBackdrop}
          onPress={() => setMoveListOpen(false)}
        >
          <Pressable
            style={styles.newListCard}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.newListTitle}>
              Move {selected.size} item{selected.size === 1 ? "" : "s"} to…
            </Text>
            <Text style={styles.newListHint}>Choose a destination list</Text>
            <View style={{ gap: 8, marginTop: 8 }}>
              <Pressable
                testID="wishlist-move-target-all"
                onPress={() => moveSelectedToCollection(null)}
                style={[styles.collectionChip, { alignSelf: "stretch", alignItems: "center" }]}
              >
                <Text style={styles.collectionChipText}>
                  All saved (no list)
                </Text>
              </Pressable>
              {collections.map((c) => (
                <Pressable
                  key={c.id}
                  testID={`wishlist-move-target-${c.id}`}
                  onPress={() => moveSelectedToCollection(c.id)}
                  style={[
                    styles.collectionChip,
                    { alignSelf: "stretch", alignItems: "center" },
                  ]}
                >
                  <Text style={styles.collectionChipText}>
                    {c.name} · {c.item_count}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => setMoveListOpen(false)}
              style={[styles.newListCancel, { marginTop: 16 }]}
            >
              <Text style={styles.newListCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* New list modal */}
      <Modal
        visible={newListOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNewListOpen(false)}
      >
        <Pressable
          style={styles.newListBackdrop}
          onPress={() => setNewListOpen(false)}
        >
          <Pressable
            style={styles.newListCard}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.newListTitle}>Create a new list</Text>
            <Text style={styles.newListHint}>
              e.g. Diwali · Wedding · Kids&apos; toys
            </Text>
            <TextInput
              testID="wishlist-new-list-input"
              value={newListName}
              onChangeText={setNewListName}
              placeholder="List name"
              placeholderTextColor={colors.textMuted}
              maxLength={40}
              autoFocus
              style={styles.newListInput}
            />
            <View style={styles.newListFooter}>
              <Pressable
                onPress={() => {
                  setNewListOpen(false);
                  setNewListName("");
                }}
                style={styles.newListCancel}
              >
                <Text style={styles.newListCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="wishlist-new-list-create"
                disabled={!newListName.trim()}
                onPress={createCollection}
                style={[
                  styles.newListCreate,
                  !newListName.trim() && { opacity: 0.4 },
                ]}
              >
                <Text style={styles.newListCreateText}>Create</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  headerRight: { width: 56, alignItems: "flex-end", paddingRight: 4 },
  headerLink: { color: colors.primary, fontWeight: "800", fontSize: 13 },

  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#fff",
  },
  toolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    flexShrink: 1,
    maxWidth: 180,
  },
  sortBtnText: { color: colors.text, fontWeight: "700", fontSize: 12, maxWidth: 120 },
  moveAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  moveAllText: { color: "#fff", fontWeight: "800", fontSize: 11 },
  clearAllBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    alignItems: "center",
    justifyContent: "center",
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: 10 },
  emptyTitle: { fontWeight: "800", fontSize: 18, color: colors.text, marginTop: spacing.md },
  emptySub: { color: colors.textMuted, textAlign: "center", paddingHorizontal: spacing.lg },
  cta: { backgroundColor: colors.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999, marginTop: spacing.md },
  ctaText: { color: "#fff", fontWeight: "800" },
  list: { padding: spacing.lg, gap: spacing.md },

  card: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: "#FFF7ED",
  },
  checkbox: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  thumb: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surface },
  category: { fontSize: 10, fontWeight: "800", color: colors.primary, letterSpacing: 1 },
  name: { fontWeight: "700", color: colors.text, fontSize: 14, marginTop: 4, lineHeight: 18 },
  seller: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  price: { fontWeight: "800", color: colors.text, fontSize: 15, marginTop: 6 },
  currCode: { color: colors.textFaint, fontWeight: "700", fontSize: 10, letterSpacing: 0.5 },
  oos: { color: colors.error, fontWeight: "700", fontSize: 11, marginTop: 2 },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  addBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  addBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  rmBtn: { padding: 6 },

  // Selection action bar
  actionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    padding: spacing.md,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  bulkRemoveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  bulkRemoveText: { color: colors.error, fontWeight: "800", fontSize: 13 },
  bulkMoveBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  bulkMoveText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  // Sort sheet
  sortScrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sortSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sortSheetTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sortOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: radius.md,
  },
  sortOptionActive: {
    backgroundColor: "#FFF7ED",
  },
  sortOptionText: { flex: 1, color: colors.text, fontWeight: "600", fontSize: 14 },
  quickActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  quickActionText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  // Collections
  collectionChipsRow: {
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 8,
    paddingBottom: 12,
  },
  collectionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  collectionChipActive: { backgroundColor: colors.text, borderColor: colors.text },
  collectionChipAdd: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  collectionChipText: { fontSize: 12, color: colors.text, fontWeight: "700" },
  collectionChipTextActive: { color: "#fff" },
  // New list modal
  newListBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  newListCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
  },
  newListTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  newListHint: { fontSize: 12, color: colors.textMuted, marginTop: 4, marginBottom: 12 },
  newListInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: colors.text,
  },
  newListFooter: { flexDirection: "row", gap: 8, marginTop: 16 },
  newListCancel: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: colors.surface, alignItems: "center" },
  newListCancelText: { color: colors.text, fontWeight: "700" },
  newListCreate: { flex: 2, padding: 12, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center" },
  newListCreateText: { color: "#fff", fontWeight: "800" },
});

// src/pages/InventoryManagement.tsx
import { useEffect, useRef, useState } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import { useLanguage } from "../i18n/LanguageContext";
import "./InventoryManagement.css";
import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";
import { matchesSearchQuery } from "../lib/searchUtils";
import { usePermissions } from "../lib/userPermissions";
import ConfirmationPopup from "./ConfirmationPopup";

// ─── Types ────────────────────────────────────────────────────────────────────
type InvCategory    = Schema["InventoryCategory"]["type"];
type InvSubcategory = Schema["InventorySubcategory"]["type"];
type InvProduct     = Schema["InventoryProduct"]["type"];
type InvTransaction = Schema["InventoryTransaction"]["type"];

type Tab          = "products" | "store";
type ProductsView = "categories" | "subcategories" | "products";
type StoreStep    = "category" | "subcategory" | "products";
type AddMode      = "quantity" | "scan";
type FieldType    = "string" | "number" | "boolean" | "date" | "email";

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
}

interface ScannedEntry {
  serial: string;
  name: string;
  notes: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseJSON<T>(raw: unknown): T | null {
  try {
    if (!raw) return null;
    if (typeof raw === "string") return JSON.parse(raw) as T;
    return raw as T;
  } catch {
    return null;
  }
}

function parseFields(raw: unknown): FieldDef[] {
  return parseJSON<FieldDef[]>(raw) ?? [];
}

function parseCustomFields(raw: unknown): Record<string, unknown> {
  return parseJSON<Record<string, unknown>>(raw) ?? {};
}

function stockClass(available: number): string {
  if (available <= 0) return "none";
  if (available <= 5) return "low";
  return "good";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function InventoryManagement({ permissions }: PageProps) {
  const { t } = useLanguage();
  if (!permissions.canRead) {
    return <div className="inv-page"><p style={{ padding: 24 }}>You do not have access to this page.</p></div>;
  }

  const client = getDataClient();
  const { canOption, isAdminGroup } = usePermissions();

  // ── RBAC shortcuts
  const canCreate = isAdminGroup || permissions.canCreate;
  const canDelete = isAdminGroup || permissions.canDelete;
  const canStoreCheckout = isAdminGroup || canOption("inventory", "inventory_checkout", true);
  const canScan = isAdminGroup || canOption("inventory", "inventory_scan", true);

  // ── Tab
  const [activeTab, setActiveTab] = useState<Tab>("products");

  // ── Products view
  const [productsView, setProductsView] = useState<ProductsView>("categories");
  const [selectedCategory, setSelectedCategory] = useState<InvCategory | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<InvSubcategory | null>(null);

  // ── Data
  const [categories, setCategories] = useState<InvCategory[]>([]);
  const [allSubcategories, setAllSubcategories] = useState<InvSubcategory[]>([]);
  const [subcategories, setSubcategories] = useState<InvSubcategory[]>([]);
  const [products, setProducts] = useState<InvProduct[]>([]);
  const [transactions, setTransactions] = useState<InvTransaction[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // ── UI
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ msg: string; type: "error" | "success" | "info" } | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Category modal
  const [showCatModal, setShowCatModal] = useState(false);
  const [editingCat, setEditingCat] = useState<InvCategory | null>(null);
  const [catName, setCatName]       = useState("");
  const [catDesc, setCatDesc]       = useState("");

  // ── Subcategory modal
  const [showSubModal, setShowSubModal] = useState(false);
  const [editingSub, setEditingSub]     = useState<InvSubcategory | null>(null);
  const [subName, setSubName]           = useState("");
  const [subDesc, setSubDesc]           = useState("");

  // ── Fields builder modal
  const [showFieldsModal, setShowFieldsModal] = useState(false);
  const [fieldsSub, setFieldsSub] = useState<InvSubcategory | null>(null);
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);

  // ── Add product modal
  const [showAddProdModal, setShowAddProdModal] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("quantity");
  const [modalCategory, setModalCategory] = useState<InvCategory | null>(null);
  const [modalSubcategoryId, setModalSubcategoryId] = useState("");
  const [prodName, setProdName]     = useState("");
  const [prodSerial, setProdSerial] = useState("");
  const [prodBarcode, setProdBarcode] = useState("");
  const [prodQty, setProdQty]       = useState(1);
  const [prodNotes, setProdNotes]   = useState("");
  const [prodCustom, setProdCustom] = useState<Record<string, string>>({});

  // Scan mode
  const [scanInput, setScanInput]     = useState("");
  const [scannedItems, setScannedItems] = useState<ScannedEntry[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);
  const [quickDrafts, setQuickDrafts] = useState<Record<string, { name: string; qty: number }>>({});

  // ── Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "category" | "subcategory" | "product";
    item: InvCategory | InvSubcategory | InvProduct;
    label: string;
  } | null>(null);

  // ── Store tab
  const [storeStep, setStoreStep]               = useState<StoreStep>("category");
  const [storeCategory, setStoreCategory]       = useState<InvCategory | null>(null);
  const [storeSubcategory, setStoreSubcategory] = useState<InvSubcategory | null>(null);
  const [storeSubcats, setStoreSubcats]         = useState<InvSubcategory[]>([]);
  const [storeProducts, setStoreProducts]       = useState<InvProduct[]>([]);
  const [checkoutQty, setCheckoutQty]           = useState<Record<string, number>>({});
  const [recentTx, setRecentTx]                 = useState<InvTransaction[]>([]);
  const [storeLoading, setStoreLoading]         = useState(false);
  const categoriesCacheRef = useRef<InvCategory[]>([]);
  const allSubcategoriesCacheRef = useRef<InvSubcategory[]>([]);
  const subcategoriesCacheRef = useRef<Map<string, InvSubcategory[]>>(new Map());
  const productsCacheRef = useRef<Map<string, { products: InvProduct[]; transactions: InvTransaction[] }>>(new Map());
  const recentTxCacheRef = useRef<InvTransaction[]>([]);

  // ────────────────────────────────────────────────────────────────────────────
  // LOAD FUNCTIONS
  // ────────────────────────────────────────────────────────────────────────────
  const loadCategories = async () => {
    if (categoriesCacheRef.current.length > 0) {
      setCategories(categoriesCacheRef.current);
      setAllSubcategories(allSubcategoriesCacheRef.current);
    }
    setLoading(true);
    try {
      const [catRes, subRes] = await Promise.all([
        client.models.InventoryCategory.list({ limit: 1000 }),
        client.models.InventorySubcategory.list({ limit: 5000 }),
      ]);
      const cats = (catRes.data ?? [])
        .filter((c) => c.isActive !== false)
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      categoriesCacheRef.current = cats;
      setCategories(cats);
      allSubcategoriesCacheRef.current = (subRes.data ?? []).filter((s) => s.isActive !== false);
      setAllSubcategories(allSubcategoriesCacheRef.current);
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Failed to load categories"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const loadSubcategories = async (categoryId: string) => {
    const cached = subcategoriesCacheRef.current.get(categoryId);
    if (cached) setSubcategories(cached);
    setLoading(true);
    try {
      const res = await client.models.InventorySubcategory.list({
        filter: { categoryId: { eq: categoryId }, isActive: { ne: false } },
        limit: 1000,
      });
      const subs = (res.data ?? []).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      subcategoriesCacheRef.current.set(categoryId, subs);
      setSubcategories(subs);
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Failed to load subcategories"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async (subcategoryId: string) => {
    const cached = productsCacheRef.current.get(subcategoryId);
    if (cached) {
      setProducts(cached.products);
      setTransactions(cached.transactions);
    }
    setLoading(true);
    try {
      const [prodRes, txRes] = await Promise.all([
        client.models.InventoryProduct.list({
          filter: { subcategoryId: { eq: subcategoryId } },
          limit: 1000,
        }),
        client.models.InventoryTransaction.list({
          filter: { subcategoryId: { eq: subcategoryId } },
          limit: 200,
        }),
      ]);
      const prods = (prodRes.data ?? []).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      setProducts(prods);
      const txs = (txRes.data ?? []).sort(
        (a, b) => new Date(b.createdAt ?? "").getTime() - new Date(a.createdAt ?? "").getTime()
      );
      const recent = txs.slice(0, 30);
      productsCacheRef.current.set(subcategoryId, { products: prods, transactions: recent });
      setTransactions(recent);
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Failed to load products"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const loadRecentTx = async () => {
    if (recentTxCacheRef.current.length > 0) setRecentTx(recentTxCacheRef.current);
    try {
      const res = await client.models.InventoryTransaction.list({ limit: 50 });
      const txs = (res.data ?? []).sort(
        (a, b) => new Date(b.createdAt ?? "").getTime() - new Date(a.createdAt ?? "").getTime()
      );
      recentTxCacheRef.current = txs.slice(0, 20);
      setRecentTx(recentTxCacheRef.current);
    } catch {
      /* silent */
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // NAVIGATION
  // ────────────────────────────────────────────────────────────────────────────
  const goToCategories = () => {
    setProductsView("categories");
    setSelectedCategory(null);
    setSelectedSubcategory(null);
    setSubcategories([]);
    setProducts([]);
    setTransactions([]);
    setSearchQuery("");
    loadCategories();
  };

  const goToSubcategories = (cat: InvCategory) => {
    setSelectedCategory(cat);
    setProductsView("subcategories");
    setSearchQuery("");
    const instantSubs = allSubcategoriesCacheRef.current
      .filter((s) => s.categoryId === cat.id && s.isActive !== false)
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    setSubcategories(instantSubs);
    void loadSubcategories(cat.id);
  };

  const goToProducts = (sub: InvSubcategory) => {
    setSelectedSubcategory(sub);
    setProductsView("products");
    setSearchQuery("");
    const cached = productsCacheRef.current.get(sub.id);
    if (cached) {
      setProducts(cached.products);
      setTransactions(cached.transactions);
    }
    void loadProducts(sub.id);
  };

  // ────────────────────────────────────────────────────────────────────────────
  // CATEGORY CRUD
  // ────────────────────────────────────────────────────────────────────────────
  const openAddCategory = () => {
    setEditingCat(null);
    setCatName(""); setCatDesc("");
    setShowCatModal(true);
  };

  const openEditCategory = (cat: InvCategory) => {
    setEditingCat(cat);
    setCatName(cat.name ?? ""); setCatDesc(cat.description ?? "");
    setShowCatModal(true);
  };

  const saveCategory = async () => {
    const name = catName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const actor = (await getCurrentUser()).signInDetails?.loginId ?? "";
      if (editingCat) {
        await client.models.InventoryCategory.update({
          id: editingCat.id,
          name,
          description: catDesc.trim() || undefined,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await client.models.InventoryCategory.create({
          name,
          description: catDesc.trim() || undefined,
          isActive: true,
          createdAt: new Date().toISOString(),
          createdBy: actor,
          updatedAt: new Date().toISOString(),
        });
      }
      setShowCatModal(false);
      setStatus({ msg: editingCat ? t("Category updated.") : t("Category created."), type: "success" });
      await loadCategories();
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Save failed"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteCategory = async () => {
    if (!deleteTarget || deleteTarget.type !== "category") return;
    setSaving(true);
    try {
      await client.models.InventoryCategory.update({
        id: (deleteTarget.item as InvCategory).id,
        isActive: false,
        updatedAt: new Date().toISOString(),
      });
      setDeleteTarget(null);
      setStatus({ msg: t("Category removed."), type: "success" });
      await loadCategories();
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Delete failed"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // SUBCATEGORY CRUD
  // ────────────────────────────────────────────────────────────────────────────
  const openAddSubcategory = () => {
    setEditingSub(null);
    setSubName(""); setSubDesc("");
    setShowSubModal(true);
  };

  const openEditSubcategory = (sub: InvSubcategory) => {
    setEditingSub(sub);
    setSubName(sub.name ?? ""); setSubDesc(sub.description ?? "");
    setShowSubModal(true);
  };

  const saveSubcategory = async () => {
    if (!selectedCategory) return;
    const name = subName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const actor = (await getCurrentUser()).signInDetails?.loginId ?? "";
      if (editingSub) {
        await client.models.InventorySubcategory.update({
          id: editingSub.id,
          name,
          description: subDesc.trim() || undefined,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await client.models.InventorySubcategory.create({
          categoryId: selectedCategory.id,
          categoryName: selectedCategory.name ?? "",
          name,
          description: subDesc.trim() || undefined,
          isActive: true,
          fieldsSchemaJson: JSON.stringify([]),
          createdAt: new Date().toISOString(),
          createdBy: actor,
          updatedAt: new Date().toISOString(),
        });
      }
      setShowSubModal(false);
      setStatus({ msg: editingSub ? t("Subcategory updated.") : t("Subcategory created."), type: "success" });
      await loadSubcategories(selectedCategory.id);
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Save failed"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteSubcategory = async () => {
    if (!deleteTarget || deleteTarget.type !== "subcategory") return;
    const sub = deleteTarget.item as InvSubcategory;
    setSaving(true);
    try {
      await client.models.InventorySubcategory.update({
        id: sub.id,
        isActive: false,
        updatedAt: new Date().toISOString(),
      });
      setDeleteTarget(null);
      setStatus({ msg: t("Subcategory removed."), type: "success" });
      if (selectedCategory) await loadSubcategories(selectedCategory.id);
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Delete failed"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // FIELDS BUILDER
  // ────────────────────────────────────────────────────────────────────────────
  const openFieldsModal = (sub: InvSubcategory) => {
    setFieldsSub(sub);
    setFieldDefs(parseFields(sub.fieldsSchemaJson));
    setShowFieldsModal(true);
  };

  const addFieldDef = () => {
    setFieldDefs((prev) => [
      ...prev,
      { key: `field_${Date.now()}`, label: "", type: "string", required: false },
    ]);
  };

  const updateFieldDef = (idx: number, patch: Partial<FieldDef>) => {
    setFieldDefs((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const removeFieldDef = (idx: number) => {
    setFieldDefs((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveFieldDefs = async () => {
    if (!fieldsSub) return;
    const cleaned = fieldDefs.filter((f) => f.label.trim());
    const keyed = cleaned.map((f, i) => ({
      ...f,
      key: f.key || `field_${i}`,
      label: f.label.trim(),
    }));
    setSaving(true);
    try {
      await client.models.InventorySubcategory.update({
        id: fieldsSub.id,
        fieldsSchemaJson: JSON.stringify(keyed),
        updatedAt: new Date().toISOString(),
      });
      setShowFieldsModal(false);
      setStatus({ msg: t("Field definitions saved."), type: "success" });
      if (selectedCategory) await loadSubcategories(selectedCategory.id);
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Save failed"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // ADD PRODUCT (by quantity)
  // ────────────────────────────────────────────────────────────────────────────
  const openAddProdModal = (context?: { category?: InvCategory | null; subcategory?: InvSubcategory | null }) => {
    const nextCategory = context?.category ?? selectedCategory ?? null;
    const nextSubcategory = context?.subcategory ?? selectedSubcategory ?? null;

    setModalCategory(nextCategory);
    setModalSubcategoryId(nextSubcategory?.id ?? "");
    setProdName(""); setProdSerial(""); setProdBarcode("");
    setProdQty(1); setProdNotes("");
    setProdCustom({});
    setScannedItems([]);
    setScanInput("");
    setAddMode("quantity");
    setShowAddProdModal(true);
  };

  const modalCategorySubcategories = (modalCategory
    ? allSubcategories.filter((s) => s.categoryId === modalCategory.id && s.isActive !== false)
    : []
  ).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  const activeModalSubcategory =
    modalCategorySubcategories.find((s) => s.id === modalSubcategoryId) ??
    (selectedSubcategory && modalCategory && selectedSubcategory.categoryId === modalCategory.id ? selectedSubcategory : null);

  const currentFieldDefs = (): FieldDef[] => {
    return parseFields(activeModalSubcategory?.fieldsSchemaJson);
  };

  const addProductByQuantity = async () => {
    if (!activeModalSubcategory || !modalCategory) return;
    const name = prodName.trim();
    if (!name) { setStatus({ msg: t("Please enter a product name."), type: "error" }); return; }
    const qty = Math.max(1, Number(prodQty) || 1);
    setSaving(true);
    try {
      const actor = (await getCurrentUser()).signInDetails?.loginId ?? "";
      const now = new Date().toISOString();
      const product = await client.models.InventoryProduct.create({
        categoryId: modalCategory.id,
        subcategoryId: activeModalSubcategory.id,
        subcategoryName: activeModalSubcategory.name ?? "",
        name,
        serialNumber: prodSerial.trim() || undefined,
        barcode: prodBarcode.trim() || undefined,
        quantity: qty,
        availableQuantity: qty,
        customFieldsJson: JSON.stringify(prodCustom),
        status: "ACTIVE",
        notes: prodNotes.trim() || undefined,
        createdAt: now,
        createdBy: actor,
        updatedAt: now,
      });

      if (product.data) {
        await client.models.InventoryTransaction.create({
          productId: product.data.id,
          productName: name,
          subcategoryId: activeModalSubcategory.id,
          categoryId: modalCategory.id,
          transactionType: "ADD",
          quantity: qty,
          notesText: `Initial stock addition of ${qty} unit(s)`,
          createdAt: now,
          createdBy: actor,
        });
      }

      setShowAddProdModal(false);
      setStatus({ msg: `${t("Added")} ${qty} ${t("unit(s) of")} "${name}".`, type: "success" });
      if (selectedSubcategory && selectedSubcategory.id === activeModalSubcategory.id && productsView === "products") {
        await loadProducts(activeModalSubcategory.id);
      } else if (modalCategory) {
        await loadSubcategories(modalCategory.id);
      }
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Failed to add product"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // ADD PRODUCT (by scan)
  // ────────────────────────────────────────────────────────────────────────────
  const handleScanSubmit = () => {
    const serial = scanInput.trim();
    if (!serial) return;
    if (scannedItems.some((s) => s.serial === serial)) {
      setStatus({ msg: `"${serial}" ${t("is already in the scan list.")}`, type: "info" });
      setScanInput("");
      return;
    }
    setScannedItems((prev) => [...prev, { serial, name: "", notes: "" }]);
    setScanInput("");
    setTimeout(() => scanRef.current?.focus(), 50);
  };

  const updateScannedItem = (idx: number, patch: Partial<ScannedEntry>) => {
    setScannedItems((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const removeScannedItem = (idx: number) => {
    setScannedItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const processScannedItems = async () => {
    if (!activeModalSubcategory || !modalCategory) return;
    const valid = scannedItems.filter((s) => s.serial.trim());
    if (!valid.length) { setStatus({ msg: t("No items to process."), type: "error" }); return; }
    setSaving(true);
    try {
      const actor = (await getCurrentUser()).signInDetails?.loginId ?? "";
      const now = new Date().toISOString();
      for (const entry of valid) {
        const name = entry.name.trim() || entry.serial;
        const product = await client.models.InventoryProduct.create({
          categoryId: modalCategory.id,
          subcategoryId: activeModalSubcategory.id,
          subcategoryName: activeModalSubcategory.name ?? "",
          name,
          serialNumber: entry.serial,
          quantity: 1,
          availableQuantity: 1,
          customFieldsJson: JSON.stringify({}),
          status: "ACTIVE",
          notes: entry.notes.trim() || undefined,
          createdAt: now,
          createdBy: actor,
          updatedAt: now,
        });
        if (product.data) {
          await client.models.InventoryTransaction.create({
            productId: product.data.id,
            productName: name,
            subcategoryId: activeModalSubcategory.id,
            categoryId: modalCategory.id,
            transactionType: "ADD",
            quantity: 1,
            notesText: `Added via serial number scan`,
            createdAt: now,
            createdBy: actor,
          });
        }
      }
      setShowAddProdModal(false);
      setStatus({ msg: `${valid.length} ${t("item(s) added via scan.")}`, type: "success" });
      if (selectedSubcategory && selectedSubcategory.id === activeModalSubcategory.id && productsView === "products") {
        await loadProducts(activeModalSubcategory.id);
      } else if (modalCategory) {
        await loadSubcategories(modalCategory.id);
      }
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Failed to process scan"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const setQuickDraft = (subcategoryId: string, patch: Partial<{ name: string; qty: number }>) => {
    setQuickDrafts((prev) => {
      const curr = prev[subcategoryId] ?? { name: "", qty: 1 };
      return {
        ...prev,
        [subcategoryId]: {
          name: patch.name ?? curr.name,
          qty: patch.qty ?? curr.qty,
        },
      };
    });
  };

  const quickAddProductToSubcategory = async (sub: InvSubcategory) => {
    if (!selectedCategory) return;
    const draft = quickDrafts[sub.id] ?? { name: "", qty: 1 };
    const name = draft.name.trim();
    const qty = Math.max(1, Number(draft.qty) || 1);

    if (!name) {
      setStatus({ msg: `${t("Enter a product name for")} ${sub.name ?? t("this subcategory")}.`, type: "error" });
      return;
    }

    setSaving(true);
    try {
      const actor = (await getCurrentUser()).signInDetails?.loginId ?? "";
      const now = new Date().toISOString();
      const product = await client.models.InventoryProduct.create({
        categoryId: selectedCategory.id,
        subcategoryId: sub.id,
        subcategoryName: sub.name ?? "",
        name,
        quantity: qty,
        availableQuantity: qty,
        customFieldsJson: JSON.stringify({}),
        status: "ACTIVE",
        createdAt: now,
        createdBy: actor,
        updatedAt: now,
      });

      if (product.data) {
        await client.models.InventoryTransaction.create({
          productId: product.data.id,
          productName: name,
          subcategoryId: sub.id,
          categoryId: selectedCategory.id,
          transactionType: "ADD",
          quantity: qty,
          notesText: `Quick add: ${qty} unit(s)`,
          createdAt: now,
          createdBy: actor,
        });
      }

      setQuickDraft(sub.id, { name: "", qty: 1 });
      setStatus({ msg: `${t("Quick added")} ${qty} ${t("unit(s) of")} "${name}" ${t("in")} ${sub.name}.`, type: "success" });
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Quick add failed"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // DELETE PRODUCT
  // ────────────────────────────────────────────────────────────────────────────
  const confirmDeleteProduct = async () => {
    if (!deleteTarget || deleteTarget.type !== "product") return;
    const prod = deleteTarget.item as InvProduct;
    setSaving(true);
    try {
      await client.models.InventoryProduct.update({
        id: prod.id,
        status: "INACTIVE",
        updatedAt: new Date().toISOString(),
      });
      setDeleteTarget(null);
      setStatus({ msg: t("Product removed."), type: "success" });
      if (selectedSubcategory) await loadProducts(selectedSubcategory.id);
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Delete failed"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "category")    confirmDeleteCategory();
    if (deleteTarget.type === "subcategory") confirmDeleteSubcategory();
    if (deleteTarget.type === "product")     confirmDeleteProduct();
  };

  // ────────────────────────────────────────────────────────────────────────────
  // STORE TAB – CHECKOUT FLOW
  // ────────────────────────────────────────────────────────────────────────────
  const selectStoreCategory = async (cat: InvCategory) => {
    setStoreCategory(cat);
    const instantSubs = allSubcategoriesCacheRef.current
      .filter((s) => s.categoryId === cat.id && s.isActive !== false)
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    if (instantSubs.length > 0) {
      setStoreSubcats(instantSubs);
      if (instantSubs.length === 1) {
        setStoreSubcategory(instantSubs[0]);
        setStoreStep("products");
        const cached = productsCacheRef.current.get(instantSubs[0].id);
        if (cached) {
          setStoreProducts(cached.products.filter((p) => (p.availableQuantity ?? 0) > 0));
          const initialCached: Record<string, number> = {};
          cached.products.forEach((p) => {
            initialCached[p.id] = 1;
          });
          setCheckoutQty(initialCached);
        }
      } else {
        setStoreStep("subcategory");
      }
    }
    setStoreLoading(true);
    try {
      const res = await client.models.InventorySubcategory.list({
        filter: { categoryId: { eq: cat.id }, isActive: { ne: false } },
        limit: 1000,
      });
      const subs = (res.data ?? []).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      setStoreSubcats(subs);
      if (subs.length === 1) {
        void selectStoreSubcategory(subs[0]);
      } else {
        setStoreStep("subcategory");
      }
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Load failed"), type: "error" });
    } finally {
      setStoreLoading(false);
    }
  };

  const selectStoreSubcategory = async (sub: InvSubcategory) => {
    setStoreSubcategory(sub);
    const cached = productsCacheRef.current.get(sub.id);
    if (cached) {
      setStoreProducts(cached.products.filter((p) => (p.availableQuantity ?? 0) > 0));
      const initialCached: Record<string, number> = {};
      cached.products.forEach((p) => { initialCached[p.id] = 1; });
      setCheckoutQty(initialCached);
      setStoreStep("products");
    }
    setStoreLoading(true);
    try {
      const res = await client.models.InventoryProduct.list({
        filter: { subcategoryId: { eq: sub.id }, status: { ne: "INACTIVE" } },
        limit: 1000,
      });
      const prods = (res.data ?? [])
        .filter((p) => (p.availableQuantity ?? 0) > 0)
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      setStoreProducts(prods);
      const initial: Record<string, number> = {};
      prods.forEach((p) => { initial[p.id] = 1; });
      setCheckoutQty(initial);
      setStoreStep("products");
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Load failed"), type: "error" });
    } finally {
      setStoreLoading(false);
    }
  };

  const checkoutProduct = async (product: InvProduct) => {
    const qty = checkoutQty[product.id] ?? 1;
    const available = product.availableQuantity ?? 0;
    if (qty < 1) { setStatus({ msg: t("Quantity must be at least 1."), type: "error" }); return; }
    if (qty > available) { setStatus({ msg: `${t("Only")} ${available} ${t("unit(s) available.")}`, type: "error" }); return; }
    setSaving(true);
    try {
      const actor = (await getCurrentUser()).signInDetails?.loginId ?? "";
      const now = new Date().toISOString();
      await client.models.InventoryProduct.update({
        id: product.id,
        availableQuantity: available - qty,
        updatedAt: now,
        updatedBy: actor,
      });
      await client.models.InventoryTransaction.create({
        productId: product.id,
        productName: product.name ?? "",
        subcategoryId: product.subcategoryId ?? "",
        categoryId: product.categoryId ?? "",
        transactionType: "CHECKOUT",
        quantity: qty,
        notesText: `Checked out ${qty} unit(s)`,
        checkedOutBy: actor,
        createdAt: now,
        createdBy: actor,
      });
      setStatus({ msg: `${t("Checked out")} ${qty} ${t("unit(s) of")} "${product.name}".`, type: "success" });
      // Refresh store products
      if (storeSubcategory) await selectStoreSubcategory(storeSubcategory);
      await loadRecentTx();
    } catch (e: any) {
      setStatus({ msg: e?.message ?? t("Checkout failed"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const resetStore = () => {
    setStoreStep("category");
    setStoreCategory(null);
    setStoreSubcategory(null);
    setStoreSubcats([]);
    setStoreProducts([]);
    setCheckoutQty({});
  };

  // Load recent transactions when switching to store tab
  useEffect(() => {
    if (activeTab === "store") loadRecentTx();
  }, [activeTab]);

  // ────────────────────────────────────────────────────────────────────────────
  // DERIVED DATA
  // ────────────────────────────────────────────────────────────────────────────
  const subcatCountByCategory = (categoryId: string): number =>
    allSubcategories.filter((s) => s.categoryId === categoryId).length;

  const filteredProducts = products.filter((p) =>
    matchesSearchQuery([p.name, p.serialNumber, p.barcode], searchQuery)
  );

  // ────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="inv-page">

      {/* ── TABS ─────────────────────────────────────────────────────────── */}
      <div className="inv-tabs">
        <button
          className={`inv-tab-btn${activeTab === "products" ? " active" : ""}`}
          onClick={() => setActiveTab("products")}
          type="button"
        >
          <i className="fas fa-boxes-stacked" aria-hidden="true" /> {t("products")}
        </button>
        {canStoreCheckout && (
          <button
            className={`inv-tab-btn${activeTab === "store" ? " active" : ""}`}
            onClick={() => setActiveTab("store")}
            type="button"
          >
            <i className="fas fa-cart-arrow-down" aria-hidden="true" /> {t("store")}
          </button>
        )}
      </div>

      {/* ── STATUS MESSAGE ────────────────────────────────────────────────── */}
      {status && (
        <div className={`inv-status ${status.type === "error" ? "error" : status.type === "success" ? "success" : ""}`}>
          {status.msg}
          <button
            type="button"
            onClick={() => setStatus(null)}
            style={{ marginLeft: 10, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/*  PRODUCTS TAB                                                        */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      {activeTab === "products" && (
        <div>
          {/* CATEGORIES VIEW */}
          {productsView === "categories" && (
            <>
              <div className="inv-section-header">
                <div className="inv-section-title">
                  <h2><i className="fas fa-layer-group" style={{ marginRight: 8 }} />{t("Product Inventory")}</h2>
                  <p>{t("Manage product categories, subcategories, and stock")}</p>
                </div>
                {canCreate && (
                  <div className="inv-header-actions">
                    <button className="inv-btn inv-btn-primary" type="button" onClick={openAddCategory}>
                      <i className="fas fa-plus" /> {t("Add Category")}
                    </button>
                    <button className="inv-btn inv-btn-secondary" type="button" onClick={loadCategories} disabled={loading}>
                      <i className="fas fa-rotate-right" /> {t("Refresh")}
                    </button>
                  </div>
                )}
              </div>

              {loading && <div className="inv-loading"><i className="fas fa-circle-notch fa-spin" /> {t("Loading...")}</div>}

              {!loading && categories.length === 0 && (
                <div className="inv-empty-state">
                  <i className="fas fa-boxes-stacked" />
                  <h4>{t("No categories yet")}</h4>
                  <p>{canCreate ? t('Click "Add Category" to create your first category.') : t("No inventory categories have been created.")}</p>
                </div>
              )}

              {!loading && categories.length > 0 && (
                <div className="inv-grid">
                  {categories.map((cat) => {
                    const subCount = subcatCountByCategory(cat.id);
                    return (
                      <div
                        key={cat.id}
                        className="inv-card"
                        onClick={() => goToSubcategories(cat)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && goToSubcategories(cat)}
                        aria-label={`Open category ${cat.name}`}
                      >
                        <div className="inv-card-header">
                          <div className="inv-card-icon cat">
                            <i className="fas fa-folder" />
                          </div>
                          <div>
                            <p className="inv-card-name">{cat.name}</p>
                            {cat.description && <p className="inv-card-desc">{cat.description}</p>}
                          </div>
                        </div>
                        <div className="inv-card-counts">
                          <span className="inv-count-badge">
                            <i className="fas fa-sitemap" /> {subCount} {subCount !== 1 ? t("Subcategories") : t("Subcategory")}
                          </span>
                        </div>
                        <div className="inv-card-footer" onClick={(e) => e.stopPropagation()}>
                          <span className="inv-card-enter-hint">{t("Click to explore")} →</span>
                          <div className="inv-card-actions">
                            {canCreate && (
                              <button
                                type="button"
                                className="inv-btn-icon"
                                title={t("Edit category")}
                                onClick={() => openEditCategory(cat)}
                              >
                                <i className="fas fa-pen" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                className="inv-btn-icon danger"
                                title={t("Delete category")}
                                onClick={() => setDeleteTarget({ type: "category", item: cat, label: cat.name ?? "" })}
                              >
                                <i className="fas fa-trash" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* SUBCATEGORIES VIEW */}
          {productsView === "subcategories" && selectedCategory && (
            <>
              <div className="inv-breadcrumb">
                <span
                  className="inv-breadcrumb-item clickable"
                  onClick={goToCategories}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && goToCategories()}
                >
                  <i className="fas fa-layer-group" /> Inventory
                </span>
                <span className="inv-breadcrumb-sep">/</span>
                <span className="inv-breadcrumb-item current">{selectedCategory.name}</span>
              </div>

              <div className="inv-section-header">
                <div className="inv-section-title">
                  <h2><i className="fas fa-sitemap" style={{ marginRight: 8 }} />{t("Subcategories")}</h2>
                  <p>{t("Subcategories inside")} <strong>{selectedCategory.name}</strong></p>
                </div>
                <div className="inv-header-actions">
                  <button className="inv-btn inv-btn-secondary" type="button" onClick={goToCategories}>
                    <i className="fas fa-arrow-left" /> {t("Back")}
                  </button>
                  {canCreate && (
                    <button className="inv-btn inv-btn-primary" type="button" onClick={openAddSubcategory}>
                      <i className="fas fa-plus" /> {t("Add Subcategory")}
                    </button>
                  )}
                  {canCreate && (
                    <button
                      className="inv-btn inv-btn-success"
                      type="button"
                      onClick={() => openAddProdModal({ category: selectedCategory, subcategory: subcategories[0] ?? null })}
                      disabled={subcategories.length === 0}
                      title={subcategories.length === 0 ? t("Create at least one subcategory first") : t("Add product directly in this category")}
                    >
                      <i className="fas fa-box-open" /> {t("Add Product")}
                    </button>
                  )}
                </div>
              </div>

              {loading && <div className="inv-loading"><i className="fas fa-circle-notch fa-spin" /> {t("Loading...")}</div>}

              {!loading && subcategories.length === 0 && (
                <div className="inv-empty-state">
                  <i className="fas fa-sitemap" />
                  <h4>{t("No subcategories yet")}</h4>
                  <p>{canCreate ? t('Click "Add Subcategory" to create one.') : t("No subcategories in this category.")}</p>
                </div>
              )}

              {!loading && subcategories.length > 0 && (
                <div className="inv-grid">
                  {subcategories.map((sub) => {
                    const fields = parseFields(sub.fieldsSchemaJson);
                    const quick = quickDrafts[sub.id] ?? { name: "", qty: 1 };
                    return (
                      <div
                        key={sub.id}
                        className="inv-card"
                        onClick={() => goToProducts(sub)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && goToProducts(sub)}
                        aria-label={`Open subcategory ${sub.name}`}
                      >
                        <div className="inv-card-header">
                          <div className="inv-card-icon sub">
                            <i className="fas fa-tag" />
                          </div>
                          <div>
                            <p className="inv-card-name">{sub.name}</p>
                            {sub.description && <p className="inv-card-desc">{sub.description}</p>}
                          </div>
                        </div>
                        <div className="inv-card-counts">
                          <span className="inv-count-badge green">
                            <i className="fas fa-sliders" /> {fields.length} {fields.length !== 1 ? t("Custom Fields") : t("Custom Field")}
                          </span>
                        </div>
                        {canCreate && (
                          <div className="inv-quick-add" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={quick.name}
                              placeholder={t("Quick product name")}
                              onChange={(e) => setQuickDraft(sub.id, { name: e.target.value })}
                            />
                            <input
                              type="number"
                              min={1}
                              value={quick.qty}
                              onChange={(e) => setQuickDraft(sub.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                            />
                            <button
                              type="button"
                              className="inv-btn inv-btn-success inv-btn-sm"
                              disabled={saving || !quick.name.trim()}
                              onClick={() => quickAddProductToSubcategory(sub)}
                            >
                              <i className="fas fa-bolt" /> {t("Quick Add")}
                            </button>
                          </div>
                        )}
                        <div className="inv-card-footer" onClick={(e) => e.stopPropagation()}>
                          <span className="inv-card-enter-hint">{t("Click to view products")} →</span>
                          <div className="inv-card-actions">
                            <button
                              type="button"
                              className="inv-btn-icon green"
                              title={t("Manage custom fields")}
                              onClick={() => openFieldsModal(sub)}
                            >
                              <i className="fas fa-sliders" />
                            </button>
                            {canCreate && (
                              <button
                                type="button"
                                className="inv-btn-icon"
                                title={t("Edit subcategory")}
                                onClick={() => openEditSubcategory(sub)}
                              >
                                <i className="fas fa-pen" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                className="inv-btn-icon danger"
                                title={t("Delete subcategory")}
                                onClick={() => setDeleteTarget({ type: "subcategory", item: sub, label: sub.name ?? "" })}
                              >
                                <i className="fas fa-trash" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* PRODUCTS VIEW */}
          {productsView === "products" && selectedSubcategory && selectedCategory && (
            <>
              <div className="inv-breadcrumb">
                <span
                  className="inv-breadcrumb-item clickable"
                  onClick={goToCategories}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && goToCategories()}
                >
                  <i className="fas fa-layer-group" /> Inventory
                </span>
                <span className="inv-breadcrumb-sep">/</span>
                <span
                  className="inv-breadcrumb-item clickable"
                  onClick={() => goToSubcategories(selectedCategory)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && goToSubcategories(selectedCategory)}
                >
                  {selectedCategory.name}
                </span>
                <span className="inv-breadcrumb-sep">/</span>
                <span className="inv-breadcrumb-item current">{selectedSubcategory.name}</span>
              </div>

              <div className="inv-section-header">
                <div className="inv-section-title">
                  <h2><i className="fas fa-box" style={{ marginRight: 8 }} />{t("Products")}</h2>
                  <p>{t("Showing products in")} <strong>{selectedSubcategory.name}</strong></p>
                </div>
                <div className="inv-header-actions">
                  <button
                    className="inv-btn inv-btn-secondary"
                    type="button"
                    onClick={() => goToSubcategories(selectedCategory)}
                  >
                    <i className="fas fa-arrow-left" /> {t("Back")}
                  </button>
                  {canCreate && (
                    <button
                      className="inv-btn inv-btn-success"
                      type="button"
                      onClick={() => openAddProdModal({ category: selectedCategory, subcategory: selectedSubcategory })}
                    >
                      <i className="fas fa-plus" /> {t("Add Products")}
                    </button>
                  )}
                  <button
                    className="inv-btn inv-btn-secondary"
                    type="button"
                    onClick={() => loadProducts(selectedSubcategory.id)}
                    disabled={loading}
                  >
                    <i className="fas fa-rotate-right" /> {t("Refresh")}
                  </button>
                </div>
              </div>

              <div className="inv-search-bar">
                <i className="fas fa-search" />
                <input
                  type="text"
                  placeholder={t("Search by name, serial or barcode...")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "#9ba8b9" }} onClick={() => setSearchQuery("")}>
                    <i className="fas fa-times" />
                  </button>
                )}
              </div>

              {loading && <div className="inv-loading"><i className="fas fa-circle-notch fa-spin" /> {t("Loading...")}</div>}

              {!loading && filteredProducts.length === 0 && (
                <div className="inv-empty-state">
                  <i className="fas fa-box-open" />
                  <h4>{searchQuery ? t("No products match your search") : t("No products yet")}</h4>
                  <p>{canCreate && !searchQuery ? t('Click "Add Products" to add stock.') : ""}</p>
                </div>
              )}

              {!loading && filteredProducts.length > 0 && (
                <div className="inv-table-wrap">
                  <table className="inv-table">
                    <thead>
                      <tr>
                        <th>{t("Product Name")}</th>
                        <th>{t("Serial / Barcode")}</th>
                        <th>{t("Available")}</th>
                        <th>{t("Total Added")}</th>
                        {currentFieldDefs().map((f) => (
                          <th key={f.key}>{f.label}</th>
                        ))}
                        <th>{t("Notes")}</th>
                        {canDelete && <th style={{ width: 60 }}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map((prod) => {
                        const available = prod.availableQuantity ?? 0;
                        const customFields = parseCustomFields(prod.customFieldsJson);
                        const fieldDefs2 = currentFieldDefs();
                        return (
                          <tr key={prod.id}>
                            <td style={{ fontWeight: 600 }}>{prod.name}</td>
                            <td className="mono">
                              {prod.serialNumber && <div>{t("S/N:")} {prod.serialNumber}</div>}
                              {prod.barcode && <div>{t("QR:")} {prod.barcode}</div>}
                              {!prod.serialNumber && !prod.barcode && <span style={{ color: "#9ba8b9" }}>—</span>}
                            </td>
                            <td>
                              <span className={`inv-stock-badge ${stockClass(available)}`}>
                                {available <= 0 && <i className="fas fa-circle-exclamation" />}
                                {available > 0 && available <= 5 && <i className="fas fa-triangle-exclamation" />}
                                {available > 5 && <i className="fas fa-check-circle" />}
                                {" "}{available} {available !== 1 ? t("units") : t("unit")}
                              </span>
                            </td>
                            <td style={{ color: "#6d7d90" }}>{prod.quantity ?? 0}</td>
                            {fieldDefs2.map((f) => (
                              <td key={f.key}>
                                {customFields[f.key] !== undefined ? String(customFields[f.key]) : <span style={{ color: "#9ba8b9" }}>—</span>}
                              </td>
                            ))}
                            <td style={{ color: "#6d7d90", maxWidth: 160, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {prod.notes || <span style={{ color: "#c9d2de" }}>—</span>}
                            </td>
                            {canDelete && (
                              <td>
                                <button
                                  type="button"
                                  className="inv-btn-icon danger"
                                  title={t("Delete product")}
                                  onClick={() => setDeleteTarget({ type: "product", item: prod, label: prod.name ?? "" })}
                                >
                                  <i className="fas fa-trash" />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Recent Transactions */}
              {transactions.length > 0 && (
                <div className="inv-tx-section">
                  <h3><i className="fas fa-clock-rotate-left" style={{ marginRight: 8 }} />{t("Recent Transactions")}</h3>
                  <div className="inv-table-wrap">
                    <table className="inv-table">
                      <thead>
                        <tr>
                          <th>{t("Product")}</th>
                          <th>{t("Type")}</th>
                          <th>{t("Quantity")}</th>
                          <th>{t("By")}</th>
                          <th>{t("Date")}</th>
                          <th>{t("Notes")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((tx) => (
                          <tr key={tx.id}>
                            <td style={{ fontWeight: 600 }}>{tx.productName || "—"}</td>
                            <td>
                              <span className={`inv-tx-badge ${tx.transactionType === "ADD" ? "add" : "checkout"}`}>
                                {tx.transactionType === "ADD" ? (
                                  <><i className="fas fa-plus" /> {t("Add Stock")}</>
                                ) : (
                                  <><i className="fas fa-cart-arrow-down" /> {t("Checkout")}</>
                                )}
                              </span>
                            </td>
                            <td>{tx.quantity}</td>
                            <td style={{ color: "#6d7d90" }}>{tx.createdBy || tx.checkedOutBy || "—"}</td>
                            <td style={{ color: "#6d7d90", whiteSpace: "nowrap" }}>{fmtDate(tx.createdAt)}</td>
                            <td style={{ color: "#6d7d90" }}>{tx.notesText || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/*  STORE TAB                                                           */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      {activeTab === "store" && canStoreCheckout && (
        <div className="inv-store">

          <div className="inv-section-header">
            <div className="inv-section-title">
              <h2><i className="fas fa-store" style={{ marginRight: 8 }} />{t("Store - Product Checkout")}</h2>
              <p>{t("Select a product category, then choose what to retrieve from inventory")}</p>
            </div>
            {storeStep !== "category" && (
              <button className="inv-btn inv-btn-secondary" type="button" onClick={resetStore}>
                <i className="fas fa-rotate-left" /> {t("Start Over")}
              </button>
            )}
          </div>

          {/* Wizard progress */}
          <div className="inv-store-wizard">
            <div className={`inv-wizard-step ${storeStep === "category" ? "active" : storeCategory ? "done" : ""}`}>
              <span className="inv-wizard-step-num">{storeCategory ? <i className="fas fa-check" /> : "1"}</span>
              {t("Select Category")}
            </div>
            <div className={`inv-wizard-step ${storeStep === "subcategory" ? "active" : storeSubcategory ? "done" : ""}`}>
              <span className="inv-wizard-step-num">{storeSubcategory ? <i className="fas fa-check" /> : "2"}</span>
              {t("Select Subcategory")}
            </div>
            <div className={`inv-wizard-step ${storeStep === "products" ? "active" : ""}`}>
              <span className="inv-wizard-step-num">3</span>
              {t("Checkout Products")}
            </div>
          </div>

          {/* ── Step 1: Category */}
          {storeStep === "category" && (
            <div className="inv-store-section">
              <h3>{t("Which category do you want to retrieve products from?")}</h3>
              {loading && <div className="inv-loading"><i className="fas fa-circle-notch fa-spin" /> {t("Loading...")}</div>}
              {!loading && categories.length === 0 && (
                <div className="inv-empty-state">
                  <i className="fas fa-box-open" />
                  <h4>{t("No inventory categories")}</h4>
                  <p>{t("Ask an admin to set up product categories first.")}</p>
                </div>
              )}
              <div className="inv-store-grid">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className={`inv-store-card${storeCategory?.id === cat.id ? " selected" : ""}`}
                    onClick={() => selectStoreCategory(cat)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && selectStoreCategory(cat)}
                  >
                    <div className="inv-store-card-icon"><i className="fas fa-folder-open" /></div>
                    <div className="inv-store-card-name">{cat.name}</div>
                    {cat.description && <div className="inv-store-card-desc">{cat.description}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: Subcategory */}
          {storeStep === "subcategory" && storeCategory && (
            <div className="inv-store-section">
              <div className="inv-store-breadcrumb">
                <strong><i className="fas fa-folder-open" /> {storeCategory.name}</strong>
                <span style={{ marginLeft: 8, color: "#9ba8b9" }}>›</span>
                <span style={{ marginLeft: 8 }}>{t("Select a subcategory")}</span>
              </div>
              <br />
              <h3>{t("Which subcategory do you want to retrieve products from?")}</h3>
              {storeLoading && <div className="inv-loading"><i className="fas fa-circle-notch fa-spin" /> {t("Loading...")}</div>}
              {!storeLoading && storeSubcats.length === 0 && (
                <div className="inv-empty-state">
                  <i className="fas fa-sitemap" />
                  <h4>{t("No subcategories")}</h4>
                  <p>{t("This category has no subcategories with products.")}</p>
                </div>
              )}
              <div className="inv-store-grid">
                {storeSubcats.map((sub) => (
                  <div
                    key={sub.id}
                    className={`inv-store-card${storeSubcategory?.id === sub.id ? " selected" : ""}`}
                    onClick={() => selectStoreSubcategory(sub)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && selectStoreSubcategory(sub)}
                  >
                    <div className="inv-store-card-icon"><i className="fas fa-tag" /></div>
                    <div className="inv-store-card-name">{sub.name}</div>
                    {sub.description && <div className="inv-store-card-desc">{sub.description}</div>}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16 }}>
                <button className="inv-btn inv-btn-secondary" type="button" onClick={resetStore}>
                  <i className="fas fa-arrow-left" /> {t("Back to Categories")}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Products & Checkout */}
          {storeStep === "products" && storeCategory && storeSubcategory && (
            <div className="inv-store-section">
              <div className="inv-store-breadcrumb">
                <strong><i className="fas fa-folder-open" /> {storeCategory.name}</strong>
                <span style={{ margin: "0 8px", color: "#9ba8b9" }}>›</span>
                <strong><i className="fas fa-tag" /> {storeSubcategory.name}</strong>
                <span style={{ margin: "0 8px", color: "#9ba8b9" }}>›</span>
                <span>{t("Available Products")}</span>
              </div>
              <br />
              <h3>{t("Select quantity to check out")}</h3>

              {storeLoading && <div className="inv-loading"><i className="fas fa-circle-notch fa-spin" /> {t("Loading...")}</div>}

              {!storeLoading && storeProducts.length === 0 && (
                <div className="inv-empty-state">
                  <i className="fas fa-box-open" />
                  <h4>{t("No products available for checkout")}</h4>
                  <p>{t("All products in this subcategory are out of stock or unavailable.")}</p>
                </div>
              )}

              {!storeLoading && storeProducts.map((prod) => {
                const available = prod.availableQuantity ?? 0;
                const qty = checkoutQty[prod.id] ?? 1;
                return (
                  <div key={prod.id} className="inv-checkout-row">
                    <div className="inv-checkout-name">
                      <div>{prod.name}</div>
                      {prod.serialNumber && (
                        <div style={{ fontSize: 11, color: "#9ba8b9", fontFamily: "monospace" }}>S/N: {prod.serialNumber}</div>
                      )}
                    </div>
                    <div className="inv-checkout-stock">
                      <span className={`inv-stock-badge ${stockClass(available)}`}>
                        {available} {t("available")}
                      </span>
                    </div>
                    <div className="inv-checkout-qty">
                      <label htmlFor={`qty-${prod.id}`} style={{ fontSize: 12, color: "#6d7d90" }}>{t("Qty:")}</label>
                      <input
                        id={`qty-${prod.id}`}
                        type="number"
                        min={1}
                        max={available}
                        value={qty}
                        onChange={(e) =>
                          setCheckoutQty((prev) => ({ ...prev, [prod.id]: Math.max(1, Number(e.target.value) || 1) }))
                        }
                      />
                    </div>
                    <button
                      className="inv-btn inv-btn-primary inv-btn-sm"
                      type="button"
                      disabled={saving || available <= 0}
                      onClick={() => checkoutProduct(prod)}
                    >
                      <i className="fas fa-cart-arrow-down" /> {t("Checkout")}
                    </button>
                  </div>
                );
              })}

              <div style={{ marginTop: 16 }}>
                <button
                  className="inv-btn inv-btn-secondary"
                  type="button"
                  onClick={() => { setStoreStep("subcategory"); setStoreSubcategory(null); }}
                >
                  <i className="fas fa-arrow-left" /> {t("Back to Subcategories")}
                </button>
              </div>
            </div>
          )}

          {/* Recent Transactions */}
          {recentTx.length > 0 && (
            <div className="inv-tx-section">
              <h3><i className="fas fa-clock-rotate-left" style={{ marginRight: 8 }} />{t("Recent Store Activity")}</h3>
              <div className="inv-table-wrap">
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th>{t("Product")}</th>
                      <th>{t("Type")}</th>
                      <th>{t("Qty")}</th>
                      <th>{t("Checked Out By")}</th>
                      <th>{t("Date")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTx.map((tx) => (
                      <tr key={tx.id}>
                        <td style={{ fontWeight: 600 }}>{tx.productName || "—"}</td>
                        <td>
                          <span className={`inv-tx-badge ${tx.transactionType === "ADD" ? "add" : "checkout"}`}>
                            {tx.transactionType === "ADD" ? t("Add Stock") : t("Checkout")}
                          </span>
                        </td>
                        <td>{tx.quantity}</td>
                        <td style={{ color: "#6d7d90" }}>{tx.checkedOutBy || tx.createdBy || "—"}</td>
                        <td style={{ color: "#6d7d90", whiteSpace: "nowrap" }}>{fmtDate(tx.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/*  MODALS                                                              */}
      {/* ──────────────────────────────────────────────────────────────────── */}

      {/* Category Modal */}
      {showCatModal && (
        <div className="inv-modal-overlay" onClick={() => !saving && setShowCatModal(false)}>
          <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modal-header">
              <h3>{editingCat ? t("Edit Category") : t("New Category")}</h3>
              <button type="button" className="inv-modal-close" onClick={() => !saving && setShowCatModal(false)}>✕</button>
            </div>
            <div className="inv-modal-body">
              <div className="inv-form-group">
                <label>{t("Category Name")} <span className="req">*</span></label>
                <input
                  type="text"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder={t("e.g. Electronics, Lubricants, Tools...")}
                  autoFocus
                />
              </div>
              <div className="inv-form-group">
                <label>{t("Description")}</label>
                <textarea
                  value={catDesc}
                  onChange={(e) => setCatDesc(e.target.value)}
                  placeholder={t("Optional description...")}
                  rows={3}
                />
              </div>
            </div>
            <div className="inv-modal-footer">
              <button type="button" className="inv-btn inv-btn-secondary" onClick={() => setShowCatModal(false)} disabled={saving}>
                {t("Cancel")}
              </button>
              <button type="button" className="inv-btn inv-btn-primary" onClick={saveCategory} disabled={saving || !catName.trim()}>
                {saving ? <><i className="fas fa-circle-notch fa-spin" /> {t("Saving...")}</> : editingCat ? t("Save Changes") : t("Create Category")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subcategory Modal */}
      {showSubModal && (
        <div className="inv-modal-overlay" onClick={() => !saving && setShowSubModal(false)}>
          <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modal-header">
              <h3>{editingSub ? t("Edit Subcategory") : t("New Subcategory")}</h3>
              <button type="button" className="inv-modal-close" onClick={() => !saving && setShowSubModal(false)}>✕</button>
            </div>
            <div className="inv-modal-body">
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "#6d7d90" }}>
                {t("Inside category:")} <strong>{selectedCategory?.name}</strong>
              </p>
              <div className="inv-form-group">
                <label>{t("Subcategory Name")} <span className="req">*</span></label>
                <input
                  type="text"
                  value={subName}
                  onChange={(e) => setSubName(e.target.value)}
                  placeholder={t("e.g. Motor Oil, Filters, Brake Pads...")}
                  autoFocus
                />
              </div>
              <div className="inv-form-group">
                <label>{t("Description")}</label>
                <textarea
                  value={subDesc}
                  onChange={(e) => setSubDesc(e.target.value)}
                  placeholder={t("Optional description...")}
                  rows={3}
                />
              </div>
              <p style={{ margin: "0", fontSize: 12, color: "#9ba8b9" }}>
                <i className="fas fa-info-circle" /> {t("You can define custom product fields for this subcategory after creating it.")}
              </p>
            </div>
            <div className="inv-modal-footer">
              <button type="button" className="inv-btn inv-btn-secondary" onClick={() => setShowSubModal(false)} disabled={saving}>
                {t("Cancel")}
              </button>
              <button type="button" className="inv-btn inv-btn-primary" onClick={saveSubcategory} disabled={saving || !subName.trim()}>
                {saving ? <><i className="fas fa-circle-notch fa-spin" /> {t("Saving...")}</> : editingSub ? t("Save Changes") : t("Create Subcategory")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fields Builder Modal */}
      {showFieldsModal && fieldsSub && (
        <div className="inv-modal-overlay" onClick={() => !saving && setShowFieldsModal(false)}>
          <div className="inv-modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modal-header">
              <h3><i className="fas fa-sliders" style={{ marginRight: 8 }} />{t("Custom Fields")} — {fieldsSub.name}</h3>
              <button type="button" className="inv-modal-close" onClick={() => !saving && setShowFieldsModal(false)}>✕</button>
            </div>
            <div className="inv-modal-body">
              <p style={{ margin: "0 0 14px", fontSize: 13, color: "#6d7d90" }}>
                {t("Define the data fields that will appear on every product in")} <strong>{fieldsSub.name}</strong>.
                {t("These fields will be available when adding products by quantity.")}
              </p>

              {fieldDefs.length === 0 && (
                <div className="inv-empty-state" style={{ padding: "20px 0" }}>
                  <i className="fas fa-th-list" />
                  <h4>{t("No custom fields defined")}</h4>
                  <p>{t('Click "Add Field" to add your first custom field.')}</p>
                </div>
              )}

              <div className="inv-fields-list">
                {fieldDefs.map((fd, idx) => (
                  <div key={fd.key} className="inv-field-row">
                    <input
                      type="text"
                      placeholder={t("Field label (e.g. Color)")}
                      value={fd.label}
                      onChange={(e) => updateFieldDef(idx, { label: e.target.value })}
                    />
                    <select
                      value={fd.type}
                      onChange={(e) => updateFieldDef(idx, { type: e.target.value as FieldType })}
                      title={t("Field type")}
                    >
                      <option value="string">{t("Text (string)")}</option>
                      <option value="number">{t("Number")}</option>
                      <option value="boolean">{t("Yes/No (boolean)")}</option>
                      <option value="date">{t("Date")}</option>
                      <option value="email">{t("Email")}</option>
                    </select>
                    <label className="inv-field-required-cb" title={t("Mark as required")}> 
                      <input
                        type="checkbox"
                        checked={fd.required}
                        onChange={(e) => updateFieldDef(idx, { required: e.target.checked })}
                      />
                      {t("Required")}
                    </label>
                    <button
                      type="button"
                      className="inv-btn-icon danger"
                      title={t("Remove field")}
                      onClick={() => removeFieldDef(idx)}
                    >
                      <i className="fas fa-times" />
                    </button>
                  </div>
                ))}
              </div>

              <button type="button" className="inv-btn inv-btn-secondary" onClick={addFieldDef} style={{ marginTop: 8 }}>
                <i className="fas fa-plus" /> {t("Add Field")}
              </button>
            </div>
            <div className="inv-modal-footer">
              <button type="button" className="inv-btn inv-btn-secondary" onClick={() => setShowFieldsModal(false)} disabled={saving}>
                {t("Cancel")}
              </button>
              <button type="button" className="inv-btn inv-btn-success" onClick={saveFieldDefs} disabled={saving}>
                {saving ? <><i className="fas fa-circle-notch fa-spin" /> {t("Saving...")}</> : <><i className="fas fa-save" /> {t("Save Field Definitions")}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Product Modal */}
      {showAddProdModal && modalCategory && (
        <div className="inv-modal-overlay" onClick={() => !saving && setShowAddProdModal(false)}>
          <div className="inv-modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modal-header">
              <h3>
                <i className="fas fa-plus-circle" style={{ marginRight: 8 }} />
                {t("Add Products")}{activeModalSubcategory ? ` ${t("to")} ${activeModalSubcategory.name}` : ` ${t("in")} ${modalCategory.name}`}
              </h3>
              <button type="button" className="inv-modal-close" onClick={() => !saving && setShowAddProdModal(false)}>✕</button>
            </div>
            <div className="inv-modal-body">
              <div className="inv-form-row" style={{ marginBottom: 10 }}>
                <div className="inv-form-group">
                  <label>{t("Category")}</label>
                  <input type="text" value={modalCategory.name ?? ""} readOnly />
                </div>
                <div className="inv-form-group">
                  <label>{t("Subcategory")} <span className="req">*</span></label>
                  <select
                    value={activeModalSubcategory?.id ?? ""}
                    onChange={(e) => setModalSubcategoryId(e.target.value)}
                  >
                    <option value="">{t("Select subcategory...")}</option>
                    {modalCategorySubcategories.map((sub) => (
                      <option key={sub.id} value={sub.id}>{sub.name}</option>
                    ))}
                  </select>
                  {modalCategorySubcategories.length === 0 && (
                    <p className="inv-form-hint">{t("No subcategories found. Create a subcategory first.")}</p>
                  )}
                </div>
              </div>

              {/* Mode switcher */}
              <div className="inv-mode-switcher">
                <button
                  type="button"
                  className={`inv-mode-btn${addMode === "quantity" ? " active" : ""}`}
                  onClick={() => setAddMode("quantity")}
                >
                  <i className="fas fa-hashtag" /> {t("By Quantity")}
                </button>
                {canScan && (
                  <button
                    type="button"
                    className={`inv-mode-btn${addMode === "scan" ? " active" : ""}`}
                    onClick={() => { setAddMode("scan"); setTimeout(() => scanRef.current?.focus(), 100); }}
                  >
                    <i className="fas fa-barcode" /> {t("By Scanning")}
                  </button>
                )}
              </div>

              {/* ── By Quantity Form */}
              {addMode === "quantity" && (
                <>
                  <div className="inv-form-row">
                    <div className="inv-form-group">
                      <label>Product Name <span className="req">*</span></label>
                      <input
                        type="text"
                        value={prodName}
                        onChange={(e) => setProdName(e.target.value)}
                        placeholder="Enter product name"
                        autoFocus
                      />
                    </div>
                    <div className="inv-form-group">
                      <label>Quantity to Add <span className="req">*</span></label>
                      <input
                        type="number"
                        min={1}
                        value={prodQty}
                        onChange={(e) => setProdQty(Math.max(1, Number(e.target.value) || 1))}
                      />
                      <p className="inv-form-hint">You can add multiple units at once (e.g. 100)</p>
                    </div>
                  </div>

                  <div className="inv-form-row">
                    <div className="inv-form-group">
                      <label>Serial Number</label>
                      <input
                        type="text"
                        value={prodSerial}
                        onChange={(e) => setProdSerial(e.target.value)}
                        placeholder="Optional serial number"
                      />
                    </div>
                    <div className="inv-form-group">
                      <label>Barcode / QR Code</label>
                      <input
                        type="text"
                        value={prodBarcode}
                        onChange={(e) => setProdBarcode(e.target.value)}
                        placeholder="Optional barcode/QR"
                      />
                    </div>
                  </div>

                  {/* Dynamic custom fields */}
                  {currentFieldDefs().length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#374151", margin: "0 0 10px" }}>
                        Custom Fields
                      </p>
                      <div className="inv-form-row" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                        {currentFieldDefs().map((fd) => (
                          <div key={fd.key} className="inv-form-group">
                            <label>
                              {fd.label}
                              {fd.required && <span className="req"> *</span>}
                              <span style={{ fontSize: 10, color: "#9ba8b9", marginLeft: 4 }}>({fd.type})</span>
                            </label>
                            {fd.type === "boolean" ? (
                              <select
                                value={prodCustom[fd.key] ?? ""}
                                onChange={(e) => setProdCustom((prev) => ({ ...prev, [fd.key]: e.target.value }))}
                              >
                                <option value="">— Select —</option>
                                <option value="true">Yes</option>
                                <option value="false">No</option>
                              </select>
                            ) : (
                              <input
                                type={fd.type === "number" ? "number" : fd.type === "date" ? "date" : fd.type === "email" ? "email" : "text"}
                                value={prodCustom[fd.key] ?? ""}
                                onChange={(e) => setProdCustom((prev) => ({ ...prev, [fd.key]: e.target.value }))}
                                placeholder={`Enter ${fd.label.toLowerCase()}`}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="inv-form-group">
                    <label>Notes</label>
                    <textarea
                      value={prodNotes}
                      onChange={(e) => setProdNotes(e.target.value)}
                      placeholder="Any additional notes…"
                      rows={2}
                    />
                  </div>
                </>
              )}

              {/* ── By Scan Form */}
              {addMode === "scan" && (
                <>
                  <div className="inv-scan-area">
                    <div className="inv-scan-icon"><i className="fas fa-barcode" /></div>
                    <h4>Scan or Enter Serial / Barcode</h4>
                    <p>Use a USB barcode scanner or type the code manually. Press Enter to add each item.</p>
                    <div className="inv-scan-input-wrap">
                      <input
                        ref={scanRef}
                        type="text"
                        className="inv-scan-input"
                        value={scanInput}
                        onChange={(e) => setScanInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleScanSubmit()}
                        placeholder="Scan or type serial / barcode…"
                        autoFocus
                      />
                      <button
                        type="button"
                        className="inv-btn inv-btn-primary"
                        onClick={handleScanSubmit}
                        disabled={!scanInput.trim()}
                      >
                        <i className="fas fa-plus" /> Add
                      </button>
                    </div>
                  </div>

                  {scannedItems.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#374151", margin: "0 0 8px" }}>
                        <i className="fas fa-list-check" style={{ marginRight: 6 }} />
                        {scannedItems.length} item{scannedItems.length !== 1 ? "s" : ""} scanned
                        — add a product name (optional):
                      </p>
                      <div className="inv-scanned-list">
                        {scannedItems.map((item, idx) => (
                          <div key={item.serial} className="inv-scanned-item">
                            <span className="inv-scanned-serial"><i className="fas fa-barcode" /> {item.serial}</span>
                            <input
                              type="text"
                              placeholder="Product name (optional)"
                              value={item.name}
                              onChange={(e) => updateScannedItem(idx, { name: e.target.value })}
                              style={{ flex: 1, padding: "4px 8px", border: "1px solid #d1d9e6", borderRadius: 6, fontSize: 12 }}
                            />
                            <button
                              type="button"
                              className="inv-btn-icon danger"
                              onClick={() => removeScannedItem(idx)}
                              title="Remove"
                            >
                              <i className="fas fa-times" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="inv-modal-footer">
              <button type="button" className="inv-btn inv-btn-secondary" onClick={() => setShowAddProdModal(false)} disabled={saving}>
                Cancel
              </button>
              {addMode === "quantity" ? (
                <button
                  type="button"
                  className="inv-btn inv-btn-success"
                  onClick={addProductByQuantity}
                  disabled={saving || !prodName.trim() || !activeModalSubcategory}
                >
                  {saving
                    ? <><i className="fas fa-circle-notch fa-spin" /> Adding…</>
                    : <><i className="fas fa-plus" /> Add {prodQty} Unit{prodQty !== 1 ? "s" : ""}</>}
                </button>
              ) : (
                <button
                  type="button"
                  className="inv-btn inv-btn-success"
                  onClick={processScannedItems}
                  disabled={saving || scannedItems.length === 0 || !activeModalSubcategory}
                >
                  {saving
                    ? <><i className="fas fa-circle-notch fa-spin" /> Processing…</>
                    : <><i className="fas fa-check" /> Add {scannedItems.length} Scanned Item{scannedItems.length !== 1 ? "s" : ""}</>}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmationPopup
        open={!!deleteTarget}
        title={`Delete ${deleteTarget?.type === "category" ? "Category" : deleteTarget?.type === "subcategory" ? "Subcategory" : "Product"}`}
        message={
          <span>
            Are you sure you want to delete <strong>{deleteTarget?.label}</strong>?
            {deleteTarget?.type === "category" && " All subcategories and products inside will also be hidden."}
            {deleteTarget?.type === "subcategory" && " All products inside will also be hidden."}
            {" This action cannot be undone."}
          </span>
        }
        confirmText="Delete"
        tone="danger"
        loading={saving}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

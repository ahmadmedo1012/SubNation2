import { useState } from "react";
import {
  useListAdminProducts, useCreateProduct, useUpdateProduct, useDeleteProduct,
  getListAdminProductsQueryKey
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, categoryLabel } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Edit2, Trash2, Package, X, CheckCircle, Upload, Search, Archive, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const EMPTY_FORM = { name: "", description: "", image_url: "", price: "", category: "", usage_terms: "", is_active: true };

const CATEGORY_OPTIONS = [
  { value: "",             label: "اختر الفئة" },
  { value: "streaming",    label: "بث مباشر" },
  { value: "music",        label: "موسيقى" },
  { value: "gaming",       label: "ألعاب" },
  { value: "productivity", label: "إنتاجية" },
];

const CATEGORY_FILTERS = [
  { value: "", label: "الكل" },
  { value: "streaming",    label: "🎬 بث مباشر" },
  { value: "music",        label: "🎵 موسيقى" },
  { value: "gaming",       label: "🎮 ألعاب" },
  { value: "productivity", label: "💼 إنتاجية" },
];

export default function AdminProductsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [inventoryProductId, setInventoryProductId] = useState<number | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [uploadLoading, setUploadLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const headers = { Authorization: adminToken ? `Bearer ${adminToken}` : "" };

  const { data: products = [], isLoading, refetch } = useListAdminProducts({
    query: { queryKey: getListAdminProductsQueryKey(), enabled: !!adminToken, refetchInterval: 60_000 },
    request: { headers },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });

  const createMutation = useCreateProduct({ request: { headers }, mutation: { onSuccess() { invalidate(); setShowForm(false); setForm({ ...EMPTY_FORM }); toast({ title: "تمت الإضافة" }); } } });
  const updateMutation = useUpdateProduct({ request: { headers }, mutation: { onSuccess() { invalidate(); setEditingId(null); setForm({ ...EMPTY_FORM }); setShowForm(false); toast({ title: "تم التحديث" }); } } });
  const deleteMutation = useDeleteProduct({ request: { headers }, mutation: { onSuccess() { invalidate(); toast({ title: "تمت الأرشفة" }); setDeleteConfirm(null); } } });

  if (!adminToken) { navigate("/admin/login"); return null; }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: form.name,
      description: form.description || undefined,
      image_url: form.image_url || undefined,
      price: parseFloat(form.price),
      category: form.category || undefined,
      usage_terms: form.usage_terms || undefined,
      is_active: form.is_active,
    };
    if (editingId) updateMutation.mutate({ id: editingId, data });
    else createMutation.mutate({ data });
  };

  const startEdit = (product: any) => {
    setEditingId(product.id);
    setForm({ name: product.name, description: product.description ?? "", image_url: product.image_url ?? "", price: String(product.price), category: product.category ?? "", usage_terms: product.usage_terms ?? "", is_active: product.is_active });
    setShowForm(true);
    setInventoryProductId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelForm = () => { setShowForm(false); setEditingId(null); setForm({ ...EMPTY_FORM }); };

  const handleInventoryUpload = async (productId: number) => {
    if (!bulkText.trim()) return;
    setUploadLoading(true);
    try {
      const res = await fetch(`/api/admin/products/${productId}/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ bulk_text: bulkText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "خطأ");
      toast({ title: "تم الرفع", description: data.message });
      setBulkText("");
      setInventoryProductId(null);
      invalidate();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setUploadLoading(false);
    }
  };

  const filtered = (products as any[]).filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || categoryLabel(p.category).includes(search);
    const matchCategory = !categoryFilter || p.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const lowStockCount = (products as any[]).filter(p => p.stock_count === 0 && p.is_active).length;

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black mb-0.5">المنتجات</h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{(products as any[]).length} منتج في الكتالوج</span>
              {lowStockCount > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  <span className="flex items-center gap-1 text-orange-400 font-bold">
                    <AlertTriangle className="w-3 h-3" />
                    {lowStockCount} نفد مخزونه
                  </span>
                </>
              )}
            </div>
          </div>
          <Button
            onClick={() => { setShowForm(true); setEditingId(null); setForm({ ...EMPTY_FORM }); setInventoryProductId(null); }}
            className="bg-primary hover:bg-primary/90 shadow-md shadow-primary/20 h-9 active:scale-[0.97] transition-transform"
          >
            <Plus className="w-4 h-4 ml-1.5" /> منتج جديد
          </Button>
        </div>

        {/* Create / Edit form */}
        {showForm && (
          <div className="bg-card border border-primary/20 rounded-2xl overflow-hidden shadow-lg shadow-primary/5">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/15">
              <h2 className="font-black text-sm">{editingId ? "تعديل المنتج" : "إضافة منتج جديد"}</h2>
              <button onClick={cancelForm} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">اسم المنتج *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="مثال: Netflix Premium" />
              </div>
              <div>
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">السعر (د.ل) *</Label>
                <Input type="number" min="0" step="0.5" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} required dir="ltr" placeholder="0.00" />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">الوصف</Label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="وصف مختصر للمنتج..." />
              </div>
              <div>
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">رابط الصورة</Label>
                <Input value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} dir="ltr" placeholder="https://..." />
              </div>
              <div>
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">الفئة</Label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary h-10"
                >
                  {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">شروط الاستخدام</Label>
                <Input value={form.usage_terms} onChange={e => setForm(f => ({ ...f, usage_terms: e.target.value }))} placeholder="ملاحظات مهمة تظهر بعد الشراء..." />
              </div>
              <div className="md:col-span-2 flex items-center gap-3 py-1">
                <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 accent-primary" />
                <Label htmlFor="is_active" className="cursor-pointer text-sm">منتج نشط (ظاهر للمستخدمين)</Label>
              </div>
              <div className="md:col-span-2 flex gap-3 justify-end pt-1 border-t border-border">
                <Button type="button" variant="outline" onClick={cancelForm} className="h-9 active:scale-[0.97] transition-transform">إلغاء</Button>
                <Button type="submit" className="h-9 bg-primary hover:bg-primary/90 active:scale-[0.97] transition-transform" disabled={createMutation.isPending || updateMutation.isPending}>
                  <CheckCircle className="w-4 h-4 ml-1.5" />
                  {editingId ? "حفظ التعديلات" : "إضافة المنتج"}
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Filters: search + category */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="بحث في المنتجات..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pr-9 h-9 w-52 text-sm"
            />
          </div>
          <div className="flex gap-1 bg-secondary/40 border border-border rounded-xl p-1 overflow-x-auto scrollbar-none">
            {CATEGORY_FILTERS.map(c => (
              <button
                key={c.value}
                onClick={() => setCategoryFilter(c.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  categoryFilter === c.value ? "bg-card shadow-sm text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {(search || categoryFilter) && (
            <button
              onClick={() => { setSearch(""); setCategoryFilter(""); }}
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              مسح
            </button>
          )}
          <span className="text-xs text-muted-foreground mr-auto">{filtered.length} منتج</span>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl h-40 skeleton-shimmer" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card border border-border rounded-xl">
            <div className="w-12 h-12 rounded-xl bg-muted mx-auto mb-3 flex items-center justify-center">
              <Package className="w-5 h-5 opacity-30" />
            </div>
            <p className="font-bold text-sm">لا توجد منتجات</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((product: any) => (
              <div key={product.id} className={`bg-card border rounded-xl overflow-hidden transition-all ${!product.is_active ? "opacity-55 border-border" : product.stock_count === 0 ? "border-orange-500/25" : "border-border"}`}>
                <div className="p-4">
                  {/* Product info */}
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center shrink-0 overflow-hidden border border-border/50">
                      {product.image_url
                        ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain p-1.5" onError={e => (e.currentTarget.style.display = "none")} />
                        : <Package className="w-5 h-5 text-muted-foreground/40" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm truncate">{product.name}</div>
                      <div className="text-xs text-muted-foreground">{categoryLabel(product.category)}</div>
                    </div>
                    <div className="flex flex-col gap-1 items-end shrink-0">
                      {!product.is_active && (
                        <span className="text-[9px] font-bold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">غير نشط</span>
                      )}
                      {product.stock_count === 0 && product.is_active && (
                        <span className="text-[9px] font-bold bg-orange-500/15 text-orange-400 border border-orange-500/20 px-1.5 py-0.5 rounded">نفذ المخزون</span>
                      )}
                    </div>
                  </div>

                  {/* Stats bar */}
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/25 border border-border/40 rounded-lg mb-3">
                    <span className="font-black text-primary tabular-nums">{formatCurrency(product.price)}</span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className={`font-bold tabular-nums ${product.stock_count === 0 ? "text-orange-400" : "text-emerald-400"}`}>
                        {product.stock_count} وحدة
                      </span>
                      <span className="text-muted-foreground/50">·</span>
                      <span className="text-muted-foreground">{product.order_count} طلب</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 h-8 text-xs active:scale-[0.97] transition-transform" onClick={() => startEdit(product)}>
                      <Edit2 className="w-3 h-3 ml-1" /> تعديل
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className={`flex-1 h-8 text-xs active:scale-[0.97] transition-transform ${inventoryProductId === product.id ? "border-primary/40 text-primary bg-primary/8" : "text-muted-foreground"}`}
                      onClick={() => { setInventoryProductId(prev => prev === product.id ? null : product.id); setBulkText(""); setShowForm(false); }}
                    >
                      <Upload className="w-3 h-3 ml-1" /> مخزون
                    </Button>
                    {deleteConfirm === product.id ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="px-2 h-8 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 active:scale-90" onClick={() => deleteMutation.mutate({ id: product.id })}>
                          <Archive className="w-3 h-3" />
                        </Button>
                        <Button size="sm" variant="outline" className="px-2 h-8 text-xs" onClick={() => setDeleteConfirm(null)}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="h-8 px-2 border-destructive/15 text-destructive/50 hover:border-destructive/35 hover:text-destructive hover:bg-destructive/8 active:scale-90" onClick={() => setDeleteConfirm(product.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Inventory panel */}
                {inventoryProductId === product.id && (
                  <div className="border-t border-border bg-muted/10 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Upload className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs font-bold">رفع مخزون جديد</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      كل سطر: <span className="font-mono bg-muted/60 border border-border/50 px-1 rounded text-[10px]">البريد|كلمةالمرور|تفاصيل</span>
                    </p>
                    <textarea
                      value={bulkText}
                      onChange={e => setBulkText(e.target.value)}
                      placeholder={"example@email.com|Password123\nuser2@mail.com|Pass456|extra"}
                      className="w-full h-20 bg-secondary border border-border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                      dir="ltr"
                    />
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" variant="outline" className="flex-1 h-8" onClick={() => setInventoryProductId(null)}>إلغاء</Button>
                      <Button size="sm" className="flex-1 h-8 bg-primary hover:bg-primary/90" onClick={() => handleInventoryUpload(product.id)} disabled={uploadLoading || !bulkText.trim()}>
                        {uploadLoading ? "جارٍ الرفع..." : `رفع (${bulkText.split("\n").filter(l => l.trim()).length} سطر)`}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

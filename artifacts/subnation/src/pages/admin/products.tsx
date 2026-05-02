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
import { Plus, Edit2, Trash2, Package, X, CheckCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const EMPTY_FORM = { name: "", description: "", image_url: "", price: "", category: "", usage_terms: "", is_active: true };

export default function AdminProductsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const headers = { Authorization: adminToken ? `Bearer ${adminToken}` : "" };

  const { data: products = [], isLoading } = useListAdminProducts({
    query: { queryKey: getListAdminProductsQueryKey(), enabled: !!adminToken },
    request: { headers },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });

  const createMutation = useCreateProduct({
    request: { headers },
    mutation: { onSuccess() { invalidate(); setShowForm(false); setForm({ ...EMPTY_FORM }); } },
  });

  const updateMutation = useUpdateProduct({
    request: { headers },
    mutation: { onSuccess() { invalidate(); setEditingId(null); setForm({ ...EMPTY_FORM }); } },
  });

  const deleteMutation = useDeleteProduct({
    request: { headers },
    mutation: { onSuccess() { invalidate(); } },
  });

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
    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate({ data });
    }
  };

  const startEdit = (product: any) => {
    setEditingId(product.id);
    setForm({
      name: product.name,
      description: product.description ?? "",
      image_url: product.image_url ?? "",
      price: String(product.price),
      category: product.category ?? "",
      usage_terms: product.usage_terms ?? "",
      is_active: product.is_active,
    });
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditingId(null); setForm({ ...EMPTY_FORM }); };

  return (
    <AdminLayout>
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-black">المنتجات</h1>
          <Button onClick={() => { setShowForm(true); setEditingId(null); setForm({ ...EMPTY_FORM }); }} className="bg-primary hover:bg-primary/90">
            <Plus className="w-4 h-4 ml-1" />
            إضافة منتج
          </Button>
        </div>

        {showForm && (
          <div className="bg-card border border-primary/30 rounded-2xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-black">{editingId ? "تعديل المنتج" : "إضافة منتج جديد"}</h2>
              <button onClick={cancelForm} className="p-1.5 rounded-lg hover:bg-secondary transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>اسم المنتج *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="mt-1" />
              </div>
              <div>
                <Label>السعر (د.ل) *</Label>
                <Input type="number" min="0" step="0.5" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} required className="mt-1" dir="ltr" />
              </div>
              <div className="md:col-span-2">
                <Label>الوصف</Label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>رابط الصورة</Label>
                <Input value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} className="mt-1" dir="ltr" />
              </div>
              <div>
                <Label>الفئة</Label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary mt-1">
                  <option value="">اختر الفئة</option>
                  <option value="streaming">بث مباشر</option>
                  <option value="music">موسيقى</option>
                  <option value="gaming">ألعاب</option>
                  <option value="productivity">إنتاجية</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <Label>شروط الاستخدام</Label>
                <Input value={form.usage_terms} onChange={e => setForm(f => ({ ...f, usage_terms: e.target.value }))} className="mt-1" />
              </div>
              <div className="md:col-span-2 flex items-center gap-3">
                <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 accent-primary" />
                <Label htmlFor="is_active">منتج نشط</Label>
              </div>
              <div className="md:col-span-2 flex gap-3 justify-end">
                <Button type="button" variant="outline" onClick={cancelForm}>إلغاء</Button>
                <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={createMutation.isPending || updateMutation.isPending}>
                  <CheckCircle className="w-4 h-4 ml-1" />
                  {editingId ? "حفظ التعديلات" : "إضافة المنتج"}
                </Button>
              </div>
            </form>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl h-24 animate-pulse" />)}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((product: any) => (
              <div key={product.id} className={`bg-card border border-border rounded-xl p-4 ${!product.is_active ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                    {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain p-1" onError={e => (e.currentTarget.style.display = "none")} /> : <Package className="w-5 h-5 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{product.name}</div>
                    <div className="text-xs text-muted-foreground">{categoryLabel(product.category)}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm mb-3">
                  <span className="font-black text-primary">{formatCurrency(product.price)}</span>
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    <span>{product.stock_count} في المخزون</span>
                    <span>·</span>
                    <span>{product.order_count} طلب</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => startEdit(product)}>
                    <Edit2 className="w-3.5 h-3.5 ml-1" />
                    تعديل
                  </Button>
                  <Button size="sm" variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => deleteMutation.mutate({ id: product.id })}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

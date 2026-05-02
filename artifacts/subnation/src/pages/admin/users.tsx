import { useState } from "react";
import { useListAdminUsers, getListAdminUsersQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, tierLabel, tierColor } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { Input } from "@/components/ui/input";
import { Users, Search } from "lucide-react";

export default function AdminUsersPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");

  const params: Record<string, string> = {};
  if (search) params.search = search;

  const { data: users = [], isLoading } = useListAdminUsers(params, {
    query: { queryKey: getListAdminUsersQueryKey(params), enabled: !!adminToken },
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
  });

  if (!adminToken) { navigate("/admin/login"); return null; }

  return (
    <AdminLayout>
      <div>
        <div className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-black">المستخدمون</h1>
          <div className="relative w-64">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="بحث برقم الهاتف..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pr-9"
              dir="ltr"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl h-16 animate-pulse" />)}</div>
        ) : users.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>لا يوجد مستخدمون</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">رقم الهاتف</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">الرصيد</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">المستوى</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">النقاط</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">الإجمالي المنفق</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">الطلبات</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">تاريخ التسجيل</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user: any) => (
                  <tr key={user.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold">{user.phone}</td>
                    <td className="px-4 py-3 font-bold text-primary">{formatCurrency(user.wallet_balance)}</td>
                    <td className="px-4 py-3">
                      <span className={`font-bold ${tierColor(user.loyalty_tier)}`}>{tierLabel(user.loyalty_tier)}</span>
                    </td>
                    <td className="px-4 py-3">{user.loyalty_points}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatCurrency(user.lifetime_spend)}</td>
                    <td className="px-4 py-3">{user.order_count}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{user.created_at ? formatDate(user.created_at) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

import { formatCount } from "@/lib/utils";
import { type AdminUser } from "@workspace/api-client-react";
import { USER_COUNT_FORMS } from "@/components/admin/users/user-directory-meta";
import { DesktopUserRow } from "@/components/admin/users/DesktopUserRow";

// R137 (FE) decomposition: extracted verbatim from pages/admin/users.tsx —
// the desktop directory table: the sticky scoped-header table (name /
// المصدر / الرصيد / المستوى / النقاط / الإجمالي المنفق / الطلبات /
// التسجيل / the edit column) plus the honest-count footer. `rows` is the
// page's memoized sorted directory and `onEdit` the page-owned openEdit
// callback — they flow straight through to the memoized rows. The move
// only changes its address; DOM, classes and aria are byte-identical.

export function UsersDesktopTable({
  rows,
  onEdit,
}: {
  rows: AdminUser[];
  onEdit: (user: AdminUser) => void;
}) {
  return (
    <div className="hidden md:block bg-card border border-border/60 rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-border bg-card/85 supports-[backdrop-filter]:bg-card/65 backdrop-blur-md">
              {/* 96-F7 (R96 A6 #15): scope="col" — screen readers
                  announce the header↔cell relation on vertical
                  sweeps instead of a bare "خلية". */}
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                المستخدم
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                المصدر
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                الرصيد
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                المستوى
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                النقاط
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                الإجمالي المنفق
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                الطلبات
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                التسجيل
              </th>
              <th scope="col" className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((user, idx: number) => (
              <DesktopUserRow key={user.id} user={user} idx={idx} onEdit={onEdit} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-border bg-muted/10 text-xs text-muted-foreground flex items-center justify-between">
        <span>{formatCount(rows.length, USER_COUNT_FORMS)}</span>
        <span className="text-muted-foreground">انقر على قلم التحرير للتعديل</span>
      </div>
    </div>
  );
}

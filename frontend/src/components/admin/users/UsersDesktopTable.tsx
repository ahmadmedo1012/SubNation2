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
        {/* R-140-l (semantics): Arabic aria-label — the directory
            announces itself (the page's «المستخدمون» h1 sits in the
            toolbar above) instead of a bare «جدول»; scope="col"
            already rode every th. No sortable headers exist here by
            design — the sort rides the filter panel's aria-pressed
            chips (client-side, the R120-B4 contract), so no th carries
            aria-sort. */}
        <table aria-label="جدول المستخدمين" className="w-full text-sm">
          <thead>
            <tr
              /* R139 (precision): the header band goes solid — the old
                 translucent bg-card pair + backdrop-blur support guard is
                 r138-retired glass (the OrdersTable twin's exact move);
                 bg-muted/30 is the admin header-band family and the seam
                 joins the /60 hairline rhythm the rows below speak. The
                 th cells already carry the quiet register (font-semibold +
                 muted ink + text-2xs). sticky/z-10 stay byte-identical
                 (z-10 = the documented local-stacking layer). */
              className="sticky top-0 z-10 border-b border-border/60 bg-muted/30"
            >
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
      {/* R139 (precision): receipt rhythm on the honest-count band — the
          boundary rule softens to the r138 hairline value (stacked on the
          last row's /60 seam it reads as the terminal double-rule of a
          slip) and tabular-nums rides the line: the count is digits.
          Emphasis stays weight-only — no color on the amount. */}
      <div className="px-4 py-2.5 border-t border-border/20 bg-muted/10 text-xs text-muted-foreground tabular-nums flex items-center justify-between">
        <span>{formatCount(rows.length, USER_COUNT_FORMS)}</span>
        <span className="text-muted-foreground">انقر على قلم التحرير للتعديل</span>
      </div>
    </div>
  );
}

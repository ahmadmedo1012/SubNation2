// R137 (FE decomposition): extracted verbatim from pages/admin/settings.tsx —
// the settings tab bar (the R124-I5 real-tab tablist). The page owns TABS,
// the tabAllowed filter (scope-honest: auth + integrations hide for
// scope-less admins) and the ?tab= URL sync; the FILTERED tab list,
// activeTab and selectTab ride down as values + a callback. The move only
// changes its address; DOM, classes, roles and Arabic copy are
// byte-identical.

interface SettingsTabItem {
  id: string;
  label: string;
  icon: React.ElementType;
}

export function SettingsTabBar({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: SettingsTabItem[];
  activeTab: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="أقسام الإعدادات"
      className="flex flex-wrap gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1 w-fit"
    >
      {/* R123 (E3 P3f): auth + integrations render only for
          settings-scoped admins (the tabAllowed gate above). */}
      {/* R139 (precision): the active tab joins the r138 calm-pill family
          (the OrdersFilters/StatusFilterTabs tray dialect 139-e shipped —
          one row, one language): bg-primary/15 + text-primary-text +
          border-primary/30 + font-bold replaces the bg-card + shadow-sm
          "raised segment" (a second selected-state vocabulary); the tray
          wash aligns to the family's bg-secondary/40. BOTH states carry
          the border box (inactive = transparent + muted/30 hover wash),
          killing the 1px label jitter the borderless inactive state
          caused on toggle. role/aria-selected/onClick byte-identical. */}
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          id={`settings-tab-${tab.id}`}
          aria-selected={activeTab === tab.id}
          onClick={() => onSelect(tab.id)}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${
            activeTab === tab.id
              ? "bg-primary/15 text-primary-text border border-primary/30 font-bold"
              : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <tab.icon className="w-3.5 h-3.5" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

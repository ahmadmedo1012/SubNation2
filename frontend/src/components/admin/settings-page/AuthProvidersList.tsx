import { ProviderCard, type AuthProvider } from "@/pages/admin/settings/provider-card";

// R137 (FE decomposition): extracted verbatim from pages/admin/settings.tsx —
// the «المصادقة» tab's provider stack. The cards themselves (the R126-L9
// split) keep their own save machinery; this extract only renders the list
// and forwards the page's optimistic setProviders updater as
// onUpdateProvider — every settings-scoped PATCH stays in the card module,
// never here. The move only changes its address; DOM byte-identical.

export function AuthProvidersList({
  providers,
  adminToken,
  onUpdateProvider,
}: {
  providers: AuthProvider[];
  adminToken: string;
  onUpdateProvider: (updated: AuthProvider) => void;
}) {
  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          adminToken={adminToken}
          onUpdate={onUpdateProvider}
        />
      ))}
    </div>
  );
}

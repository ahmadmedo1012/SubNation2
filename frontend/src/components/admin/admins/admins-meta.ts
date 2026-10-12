// R137 (FE decomposition): extracted verbatim from pages/admin/admins.tsx —
// the RBAC directory's shared row/option contracts moved to their own
// React-free module so the page file shrinks to orchestration and the
// extracts (the account card + the two dialogs + the scope grid) can
// import them by name. Byte-identical interfaces; ZERO behavior change.

export interface AdminAccount {
  id: number;
  username: string;
  display_name: string;
  role: string;
  permissions: string[];
  is_active: boolean;
  totp_enabled: boolean;
  created_at?: string;
}

export interface ScopeOption {
  id: string;
  label: string;
}

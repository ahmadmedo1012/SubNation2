import { View } from "react-native";

import { CategoryRail } from "@/components/category-rail";
import { spacing } from "@/theme";

import { CatalogScreen, sortLabel } from "./catalog-screen";
import { HomeHeader } from "./home-header";

/**
 * HomeScreen — the storefront catalog (the web home's native twin): the
 * header row (search entry + wallet/sign-in chip), the category rail, then
 * the catalog itself — inline search + متوفر فقط + sort + the 2-column
 * grid with all four states. The CatalogScreen engine owns the data.
 */
export function HomeScreen() {
  return (
    <CatalogScreen
      category={null}
      showSearchField
      showAvailableToggle
      headerTop={({ clearFilters }) => (
        <View>
          <HomeHeader />
          <CategoryRail
            activeSlug={null}
            onAllPress={clearFilters}
            style={{ marginTop: spacing.md }}
          />
        </View>
      )}
      titleFor={(filters) => {
        if (filters.search) return `نتائج البحث: ${filters.search}`;
        if (filters.sort !== "") return sortLabel(filters.sort);
        if (filters.availableOnly) return "المنتجات المتوفّرة فقط";
        return "كل الاشتراكات";
      }}
    />
  );
}

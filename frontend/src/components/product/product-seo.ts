import { KNOWN_CATEGORIES } from "@/components/product/category-presentation";
import type { SeoInput } from "@/components/seo/MetaTags";
import { buildBreadcrumbLd, buildFaqLd, buildProductLd } from "@/lib/seo-builders";
import { categoryLabel, formatCurrency } from "@/lib/utils";
import type { Product, ProductFaqItem, ProductVariant } from "@workspace/api-client-react";

// R137 (closing decomposition): extracted verbatim from pages/product.tsx —
// the three-branch useSeo input object (product / 404 / neutral) moved to
// this React-free module so the page file shrinks to orchestration. The
// page still calls useSeo (rules-of-hooks — the hook must fire
// unconditionally BEFORE the loading/not-found early returns); this
// builder only computes the argument, with zero behavior change: same
// branches, same fallbacks, same JSON-LD blocks, byte-identical values.
// The price-aware fallback keys off the SELECTED variant (the number the
// CTA charges), and the caller owns productFaqs because the FAQ accordion
// mount gates on the same array (one source in the page).

/** The useSeo argument for the product detail page — verbatim ternary. */
export function productSeoInput({
  product,
  selectedVariant,
  productFaqs,
  param,
  isNotFoundError,
}: {
  product: Product | undefined;
  selectedVariant: ProductVariant | null;
  /** The already-guarded non-empty curated FAQ list (null = suppressed). */
  productFaqs: ProductFaqItem[] | null;
  /** The raw route param — the 404 branch canonicalizes the phantom URL. */
  param: string;
  isNotFoundError: boolean;
}): SeoInput {
  // SEO price — the SELECTED option's price (or the product-level price
  // for variant-less products), neutral 0 while loading.
  const seoPrice = selectedVariant
    ? (selectedVariant.sale_price ?? selectedVariant.price)
    : product
      ? (product.sale_price ?? product.price)
      : 0;
  // 98-F9: every field below (description_long, faq, seo_title,
  // seo_description, features) now lives in the generated Product
  // contract — the spec gap (features missing) that forced this local
  // `any`-shaped cast is closed; plain property access on the typed
  // query data. Name kept to minimize the diff.
  const productAny = product;
  return product
    ? {
        title: productAny?.seo_title?.trim()
          ? productAny.seo_title
          : `${product.name} — ${formatCurrency(seoPrice)}`,
        description: (
          productAny?.seo_description?.trim() ||
          product.description ||
          // J-3 (R142): the static fallback used to claim «متوفر…تسليم
          // فوري» for ANY product with empty curated fields — including
          // OOS ones, whose own JSON-LD Offer (D2-F2) asserts
          // OutOfStock and whose page renders «نفد المخزون» (the F1
          // brand-availability-from-nothing class, at the crawler
          // surface). The OOS arm states only category-level truth.
          (product.is_available
            ? `${product.name} متوفر بالدينار الليبي على SubNation. تسليم فوري بعد الدفع.`
            : `${product.name} بالدينار الليبي على SubNation — راجع صفحة المنتج لمعرفة التوفر الحالي.`)
        ).slice(0, 160),
        image: product.image_url ?? undefined,
        type: "product",
        path: `/product/${product.slug ?? product.id}`,
        locale: "ar",
        jsonLd: [
          buildProductLd({
            id: product.id,
            slug: product.slug,
            name: product.name,
            description: product.description,
            descriptionLong: productAny?.description_long ?? null,
            imageUrl: product.image_url,
            price: seoPrice,
            category: product.category,
            isActive: product.is_active ?? true,
            // D2-F2 (R111): thread the REAL stock signal — the same
            // is_available the buy button gates on — so the Offer LD
            // asserts OutOfStock when the UI says «نفد المخزون».
            isAvailable: product.is_available,
          }),
          buildBreadcrumbLd([
            { name: "الرئيسية", href: "/" },
            {
              name: categoryLabel(product.category ?? "") || "المنتجات",
              href:
                product.category && KNOWN_CATEGORIES.has(product.category)
                  ? `/category/${product.category}`
                  : "/",
            },
            { name: product.name, href: `/product/${product.slug ?? product.id}` },
          ]),
          ...(productFaqs ? [buildFaqLd(productFaqs)] : []),
        ],
      }
    : isNotFoundError
      ? {
          /* R124 (A10-F1 P2): a 404 is definitive — the infinite
               /product/<anything> URL space must never consolidate
               against the homepage (Google flags homepage-canonicalized
               soft-404s; category.tsx's unknown-slug branch is the
               in-house pattern). noindex,follow + a SELF canonical: the
               phantom URL consolidates nowhere, and MetaTags' upsert
               keeps og:url honest for WhatsApp unfurls of dead product
               links. The block is rendered by the !product early return
               below (category.tsx A7-F1 pattern — an unrendered useSeo
               element owns nothing and the App fallback would win);
               the LOADING skeleton and the outage card deliberately
               render NO block, keeping the App fallback's index,follow
               + self canonical there (an outage on a REAL product URL
               must not deindex or re-canonicalize it). The neutral
               third branch below only covers the defensive null-data-
               without-error edge. */
          title: "المنتج غير موجود — SubNation",
          description:
            "المنتج المطلوب غير موجود أو لم يعد متوفراً. تصفّح باقي الاشتراكات الرقمية بالدينار الليبي من الصفحة الرئيسية.",
          path: `/product/${param}`,
          locale: "ar",
          robots: "noindex,follow",
        }
      : {
          title: "SubNation",
          description: "اشتراكات رقمية بالدينار الليبي.",
          path: "/",
          locale: "ar",
        };
}

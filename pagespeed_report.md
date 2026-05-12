# PageSpeed Insights Report

**URL:** `https://subnation2.onrender.com`  
**Device:** Desktop  
**Date:** 2026-05-13  

---

## 1. Performance Overview

- **Discover what your real users are experiencing**
- **Diagnose performance issues**

---

## 2. Accessibility Audit

### 2.1 Passed Audits

| Audit | Status |
|-------|--------|
| Interactive controls are keyboard focusable | ✅ Pass |
| Interactive elements indicate their purpose and state | ✅ Pass |
| The page has a logical tab order | ✅ Pass |
| Visual order on the page follows DOM order | ✅ Pass |
| User focus is not accidentally trapped in a region | ✅ Pass |
| The user's focus is directed to new content added to the page | ✅ Pass |
| HTML5 landmark elements are used to improve navigation | ✅ Pass |
| Offscreen content is hidden from assistive technology | ✅ Pass |
| Custom controls have associated labels | ✅ Pass |
| Custom controls have ARIA roles | ✅ Pass |
| `[aria-*]` attributes match their roles | ✅ Pass |
| `[aria-hidden="true"]` is not present on the document `<body>` | ✅ Pass |
| `[role]` s have all required `[aria-*]` attributes | ✅ Pass |
| `[aria-*]` attributes have valid values | ✅ Pass |
| `[aria-*]` attributes are valid and not misspelled | ✅ Pass |
| Buttons have an accessible name | ✅ Pass |
| Form elements have associated labels | ✅ Pass |
| Select elements have associated label elements | ✅ Pass |
| ARIA attributes are used as specified for the element's role | ✅ Pass |
| Elements use only permitted ARIA attributes | ✅ Pass |
| Document has a `<title>` element | ✅ Pass |
| `<html>` element has a `[lang]` attribute | ✅ Pass |
| `<html>` element has a valid value for its `[lang]` attribute | ✅ Pass |
| Links have a discernible name | ✅ Pass |
| Lists contain only `<li>` elements and script supporting elements | ✅ Pass |
| No element has a `[tabindex]` value greater than 0 | ✅ Pass |
| Touch targets have sufficient size and spacing | ✅ Pass |
| Heading elements appear in a sequentially-descending order | ✅ Pass |
| Document has a main landmark | ✅ Pass |
| Deprecated ARIA roles were not used | ✅ Pass |
| `[accesskey]` values are unique | ✅ Pass |
| `button`, `link`, and `menuitem` elements have accessible names | ✅ Pass |
| Elements with `role="dialog"` or `role="alertdialog"` have accessible names | ✅ Pass |
| ARIA input fields have accessible names | ✅ Pass |
| ARIA `meter` elements have accessible names | ✅ Pass |
| ARIA `progressbar` elements have accessible names | ✅ Pass |
| Elements with an ARIA `[role]` that require children to contain a specific `[role]` have all required children | ✅ Pass |
| `[role]` s are contained by their required parent element | ✅ Pass |
| Elements with the `role=text` attribute do not have focusable descendents | ✅ Pass |
| ARIA toggle fields have accessible names | ✅ Pass |
| ARIA `treeitem` elements have accessible names | ✅ Pass |
| The page contains a heading, skip link, or landmark region | ✅ Pass |
| `<dl>`'s contain only properly-ordered `<dt>` and `<dd>` groups | ✅ Pass |
| Definition list items are wrapped in `<dl>` elements | ✅ Pass |
| No form fields have multiple labels | ✅ Pass |
| `<frame>` or `<iframe>` elements have a title | ✅ Pass |
| `<html>` element has an `[xml:lang]` attribute with the same base language as the `[lang]` attribute | ✅ Pass |
| Image elements have `[alt]` attributes | ✅ Pass |
| Input buttons have discernible text | ✅ Pass |
| `<input type="image">` elements have `[alt]` text | ✅ Pass |
| Links are distinguishable without relying on color | ✅ Pass |
| List items (`<li>`) are contained within `<ul>`, `<ol>` or `<menu>` parent elements | ✅ Pass |
| `<object>` elements have alternate text | ✅ Pass |
| Skip links are focusable | ✅ Pass |
| `<th>` elements and elements with `[role="columnheader"/"rowheader"]` have data cells they describe | ✅ Pass |
| `[lang]` attributes have a valid value | ✅ Pass |
| `<video>` elements contain a `<track>` element with `[kind="captions"]` | ✅ Pass |
| Tables have different content in the summary attribute and `<caption>` | ✅ Pass |
| All heading elements contain content | ✅ Pass |
| Uses ARIA roles only on compatible elements | ✅ Pass |
| Image elements do not have `[alt]` attributes that are redundant text | ✅ Pass |
| Identical links have the same purpose | ✅ Pass |

### 2.2 Failed Audits

| Audit | Status | Details |
|-------|--------|---------|
| **Background and foreground colors do not have a sufficient contrast ratio** | ❌ Fail | **Failing Elements:**<br>• `Nation`<br>• `<span class="text-primary">`<br>• `SubNation`, `الكتالوج`, `دخول`, `حساب مجاني`<br>• `<header class="... sticky top-0 z-50 transition-all duration-300 bg-card/80 back…">`<br>• `SubNation`, `الكتالوج`, `دخول`, `حساب مجاني`, `ليبيا #1`, `سوق الاشتراكات الرقمية`, `اشتراكات رقم…`<br>• `<div class="min-h-screen bg-background text-foreground">` |

---

## 3. Best Practices Audit

### 3.1 Passed Audits

| Audit | Status |
|-------|--------|
| All sites should be protected with HTTPS | ✅ Pass |
| Avoids third-party cookies | ✅ Pass |
| Allows users to paste into input fields | ✅ Pass |
| Avoids requesting the geolocation permission on page load | ✅ Pass |
| Avoids requesting the notification permission on page load | ✅ Pass |
| Displays images with correct aspect ratio | ✅ Pass |
| Serves images with appropriate resolution | ✅ Pass |
| Page has the HTML doctype | ✅ Pass |
| Page has valid source maps | ✅ Pass |
| Redirects HTTP traffic to HTTPS | ✅ Pass |
| Deployment of the HSTS header | ✅ Pass |
| Ensure proper origin isolation with COOP | ✅ Pass |
| Mitigate clickjacking with XFO or CSP | ✅ Pass |
| Mitigate DOM-based XSS with Trusted Types | ✅ Pass |
| Detected JavaScript libraries | ✅ Pass |

### 3.2 Failed / Warning Audits

| Audit | Status | Details |
|-------|--------|---------|
| **Browser errors were logged to the console** | ⚠️ Warning | **Source:** `onrender.com` (1st party)  
**Description:** `Executing inline event handler violates the following Content Security Policy directive 'script-src-attr 'none''. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.` |
| **Issues were logged in the `Issues` panel in Chrome Devtools** | ⚠️ Warning | **Issue type:** Content security policy |
| **Ensure CSP is effective against XSS attacks** | ⚠️ Warning | **Description:** Host allowlists can frequently be bypassed. Consider using CSP nonces or hashes instead, along with `'strict-dynamic'` if necessary.  
**Directive:** `script-src`  
**Severity:** High |

---

## 4. SEO Audit

### 4.1 Passed Audits

| Audit | Status |
|-------|--------|
| Page isn't blocked from indexing | ✅ Pass |
| Document has a `<title>` element | ✅ Pass |
| Page has successful HTTP status code | ✅ Pass |
| Links have descriptive text | ✅ Pass |
| robots.txt is not malformed | ✅ Pass |
| Document has a valid `hreflang` | ✅ Pass |
| Image elements have `[alt]` attributes | ✅ Pass |
| Document has a valid `rel=canonical` | ✅ Pass |

---

## 5. Summary

| Category | Status |
|----------|--------|
| **Accessibility** | ⚠️ 1 failure (color contrast) |
| **Best Practices** | ⚠️ 3 warnings (CSP / console errors) |
| **SEO** | ✅ All passed |

### Key Recommendations

1. **Fix color contrast issues** — Ensure background and foreground colors meet WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text).
2. **Review CSP configuration** — Replace host allowlists with nonces/hashes and consider `strict-dynamic` for `script-src`.
3. **Investigate console errors** — Inline event handlers are being blocked by the current CSP; refactor to external scripts or add appropriate CSP directives.

---

*Report generated from PageSpeed Insights analysis.*

# Web Check Report

**URL:** `https://subnation2.onrender.com/`
**Date:** 2026-05-12
**Lighthouse Version:** 13.0.1

## Server Location

| Property | Value |
|----------|-------|
| City | San Francisco |
| Region | California |
| Country | United States (US) |
| Postcode | 94107 |
| Coordinates | 37.7775, -122.397 |
| ISP | Render |
| Timezone | America/Los_Angeles |
| Currency | United States dollar (USD) |

## SSL Certificate

| Property | Value |
|----------|-------|
| Subject CN | `onrender.com` |
| Issuer | Google Trust Services — `WE1` |
| Valid From | Mar 28 21:00:26 2026 GMT |
| Valid To | Jun 26 22:00:22 2026 GMT |
| Serial Number | `C3001B2ABCCC45830E8D0FA76D41A293` |
| Key Type | P-256 (256 bits) |
| Is Valid | ✅ Yes |

## Core Web Vitals & Performance

| Metric | Score | Value |
|--------|-------|-------|
| First Contentful Paint (FCP) | 0.54 | 2.9 s |
| Largest Contentful Paint (LCP) | 0.69 | 3.3 s |
| Speed Index | 0.82 | 3.9 s |
| Cumulative Layout Shift (CLS) | 0 | 0.125 |
| Max Potential FID | 1 | 50 ms |

## Diagnostics

| Property | Value |
|----------|-------|
| Total Requests | 26 |
| Total Transfer Size | 441,580 bytes |
| Scripts | 15 |
| Stylesheets | 2 |
| Fonts | 2 |
| Main Thread Tasks | 911 |
| Total Task Time | 684.7 ms |
| Max RTT | 4.512120000000001 ms |

## Resource Summary

| Type | Requests | Transfer Size |
|------|----------|---------------|
| Total | 26 | 441,580 bytes |
| Script | 15 | 341,835 bytes |
| Font | 2 | 55,780 bytes |
| Stylesheet | 2 | 32,370 bytes |
| Other | 5 | 8,073 bytes |
| Document | 2 | 3,522 bytes |
| Image | 0 | 0 bytes |
| Media | 0 | 0 bytes |
| Third-party | 9 | 194,339 bytes |

## Third-Party Resources

| Entity | Transfer Size | Main Thread Time |
|--------|---------------|------------------|
| Other Google APIs/SDKs | 42,357 bytes | 35.3 ms |
| Google Fonts | 57,319 bytes | 0.0 ms |

## Opportunities

### Reduce Unused JavaScript
- **Potential Savings:** Est savings of 20 KiB
- **Estimated LCP Improvement:** 150 ms
- `https://subnation2.onrender.com/assets/vendor-firebase-DwJqEEzr.js` — 20,501 bytes unused (61.8%)

### Layout Shifts (CLS)
- **Status:** 4 layout shifts found
- **Total CLS:** 0.125
- **Affected Elements:**
  - `body > div#root > div.min-h-screen > footer.border-t` — Score: 0.103281
  - `main > div.min-h-screen > div.max-w-6xl > div.grid` — Score: 0.016951
  - `main > div.min-h-screen > div.max-w-6xl > div.grid` — Score: 0.003519
  - `div.min-h-screen > footer.border-t > div.max-w-6xl > span.font-medium` — Score: 0.001167

### Non-Composited Animations
- **47 animated elements found**
- These animations may cause jank and increase CLS. Consider using `transform` and `opacity` for animations.

## Security

### Content Security Policy (CSP)
| Severity | Directive | Description |
|----------|-----------|-------------|
| High | `script-src` | Host allowlists can frequently be bypassed. Consider using CSP nonces or hashes instead, along with `'strict-dynamic'` if necessary. |
| High | `script-src` | `'unsafe-inline'` allows the execution of unsafe in-page scripts and event handlers. Consider using CSP nonces or hashes to allow scripts individually. |
| High | `script-src-attr` | `'unsafe-inline'` allows the execution of unsafe in-page scripts and event handlers. Consider using CSP nonces or hashes to allow scripts individually. |

### Trusted Types
- **High:** No `Content-Security-Policy` header with Trusted Types directive found

## Accessibility

| Audit | Score |
|-------|-------|
| HTML has lang attribute | ✅ 1 |
| Document has title | ✅ 1 |
| Form elements have labels | ✅ 1 |
| Select elements have labels | ✅ 1 |
| ARIA attributes are valid | ✅ 1 |
| ARIA attributes match roles | ✅ 1 |
| No prohibited ARIA attributes | ✅ 1 |
| No aria-hidden on body | ✅ 1 |
| Proper list structure | ✅ 1 |
| No tabindex > 0 | ✅ 1 |

## SEO

| Audit | Score |
|-------|-------|
| Successful HTTP status | ✅ 1 |
| Valid hreflang | ✅ 1 |
| Valid robots.txt | ✅ 1 |
| Document title present | ✅ 1 |

## Best Practices

| Audit | Score |
|-------|-------|
| Avoids third-party cookies | ✅ 1 |
| No geolocation on start | ✅ 1 |
| Correct image aspect ratio | ✅ 1 |
| No DevTools issues | ✅ 1 |
| Viewport optimized for mobile | ✅ 1 |

## Main Thread Work Breakdown

| Category | Time Spent |
|----------|------------|
| Script Evaluation | 290.7 ms |
| Other | 236.7 ms |
| Style & Layout | 171.9 ms |
| Rendering | 57.2 ms |
| Script Parsing & Compilation | 53.4 ms |
| Parse HTML & CSS | 11.8 ms |
| **Total** | **821.6 ms** |

## JavaScript Execution

| Script | Total CPU | Evaluation | Parse |
|--------|-----------|------------|-------|
| `https://subnation2.onrender.com/assets/vendor-r...` | 320.4 ms | 203.3 ms | 11.2 ms |
| `https://subnation2.onrender.com/` | 273.3 ms | 5.9 ms | 1.0 ms |
| `Unattributable` | 83.5 ms | 7.4 ms | 0.0 ms |
| `https://apis.google.com/_/scs/abc-static/_/js/k...` | 62.0 ms | 50.0 ms | 9.9 ms |
| **Total** | | | **288.7 ms** |

## Key Network Requests

| URL | Type | Status | Transfer Size | Time |
|-----|------|--------|---------------|------|
| `https://subnation2.onrender.com/` | Document | 200 | 2,798 bytes | 195 ms |
| `https://fonts.gstatic.com/s/readexpro/v27/SLXYc1bJ7HE5YDo...` | Font | 200 | 32,204 bytes | 229 ms |
| `https://fonts.googleapis.com/css2?family=Readex+Pro:wght@...` | Stylesheet | 200 | 1,539 bytes | 236 ms |
| `https://subnation2.onrender.com/assets/index-B_4w_rCG.js` | Script | 200 | 19,074 bytes | 1190 ms |
| `https://subnation2.onrender.com/assets/vendor-react-BwvgJ...` | Script | 200 | 60,550 bytes | 455 ms |
| `https://subnation2.onrender.com/assets/vendor-icons-B9VDT...` | Script | 200 | 9,881 bytes | 1281 ms |
| `https://subnation2.onrender.com/assets/vendor-router-CQiP...` | Script | 200 | 3,994 bytes | 1274 ms |
| `https://subnation2.onrender.com/assets/vendor-query-BjL0O...` | Script | 200 | 12,487 bytes | 427 ms |
| `https://subnation2.onrender.com/assets/vendor-firebase-Dw...` | Script | 200 | 34,848 bytes | 1287 ms |
| `https://subnation2.onrender.com/assets/vendor-utils-Qm4_4...` | Script | 200 | 10,323 bytes | 1287 ms |
| `https://subnation2.onrender.com/assets/vendor-radix-DA97L...` | Script | 200 | 22,356 bytes | 418 ms |
| `https://subnation2.onrender.com/assets/index-CRdLdoXI.css` | Stylesheet | 200 | 30,831 bytes | 1199 ms |
| `https://subnation2.onrender.com/assets/SocketInitializer-...` | Script | 200 | 6,918 bytes | 1521 ms |
| `https://subnation2.onrender.com/assets/vendor-socket-BkL6...` | Script | 200 | 15,255 bytes | 1526 ms |
| `https://subnation2.onrender.com/assets/home-ByTK-Q-o.js` | Script | 200 | 9,127 bytes | 1566 ms |

---

*Report generated from Lighthouse web-check results.*
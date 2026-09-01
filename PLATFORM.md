# SubNation2 Platform

## Production URLs
- Frontend (Vercel): https://subnation-seven.vercel.app
- Frontend (custom domain, once DNS propagates): https://subnation.ly
- Backend (Render): https://subnation2.onrender.com
- OpenWA Gateway: https://openwa-gateway-7aaa.onrender.com

## Render Service
- Service ID: srv-d7vv91tckfvc73evnccg
- Owner: tea-d1nfi36mcj7s73f4tdtg
- Region: oregon
- Plan: free
- Status: LIVE

## Admin Pages
- WhatsApp OTP session: /admin/whatsapp (requires admin role + settings scope)

## WhatsApp OTP Session
- Session name: subnation-otp
- Gateway base URL: https://openwa-gateway-7aaa.onrender.com
- API key: <server-side only, never exposed to browser>

## Render Services Inventory
| Service | ID | Status | Purpose |
|---------|-----|--------|---------|
| SubNation2 | srv-d7vv91tckfvc73evnccg | LIVE | Main API + SSR frontend |
| openwa-gateway | srv-da6piju7bikc739anbtg | LIVE | WhatsApp OTP gateway (Baileys) |
| SmartBot | srv-d94hn57aqgkc73ds0vhg | LIVE | Unrelated (Python) |
| POS | srv-d8sps3cmmk8c739eo6lg | SUSPENDED | Unrelated |
| Smart-Menu | srv-d8q9a768bjmc738hhh90 | SUSPENDED | Unrelated |
| zu-connect | srv-d8ne9tcm0tmc73e2c4b0 | SUSPENDED | Unrelated |
| lyosint | srv-d8ir0se47okc739lh3d0 | LIVE | Unrelated |

## Custom Domain Setup (subnation.ly)
1. ✅ Added to Vercel project `subnation` (team ahmadmedo1012-9441s-projects)
2. ⏳ Pending: user must add A records at Cloudflare:
   - `A` `subnation.ly` → `76.76.21.21`
   - `A` `www.subnation.ly` → `76.76.21.21`
3. ⏳ Pending: Vercel will auto-verify after DNS propagates

## Last Updated
2026-09-01

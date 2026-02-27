# Madurai Makkal Connect (Mobile)

Single civic platform for Android + iOS with role-based email/password auth, geo-verified disposal, AI validation, rewards, complaint tracking, fraud detection, and analytics.

## Implemented Feature Set

1. User Authentication & Identity
- Email/password login flow
- Role differentiation: citizen, worker, admin
- Session handling and user profile upsert
- Demo fallback credentials when Supabase auth user is unavailable

2. Location & Geo-Permission Engine
- Foreground location permission enforcement
- High-accuracy capture with quality thresholds
- Mock/stale/low-accuracy checks
- Client + server geo-validation hook

3. Smart Public Bin Registry
- Admin-managed bin model support (Supabase `bins`)
- Bin status handling (`available`, `reported_full`, `temporarily_disabled`)
- Report-full and suggest-next-bin flow

4. Scan-to-Earn Waste Disposal
- Bin QR match
- Geo-fence check (`<= 5m`)
- Live camera capture only
- AI validation + anti-fraud + cooldown
- Reward credit on successful verification

5. AI Image Validation
- Quality gate + object presence heuristics (MVP)
- Duplicate image hashing checks
- Failure reason feedback

6. Green Wallet (Reward Ledger)
- Dynamic point rules by waste size
- First-time user bonus
- Append-only wallet history

7. Reward Redemption (Coupon-Based)
- Reward marketplace
- Point deduction
- Unique mock coupon code generation

8. Smart Complaint Reporting (311)
- Live photo + auto GPS + category-based complaint reporting
- Complaint lifecycle with tracking

9. Proof-of-Cleanliness Upload
- Geo-locked cleanup proof capture
- Before/after mismatch checks
- Official verification flow

10. Fraud & Misuse Detection Engine
- Duplicate image, geo anomaly, cooldown, mock GPS checks
- Risk score and flagging
- Review actions for officials

11. Cleanliness Analytics Dashboard
- Disposal/complaint/reward KPIs
- Bin usage metrics
- Hotspot density summaries

## Supabase Setup

1. Create `.env` from `.env.example`.
2. Set:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
3. Apply schema:
- `supabase/schema.sql`
4. Deploy edge function:
- `supabase/functions/geo-validate/index.ts`

## Run

```bash
npm install
npm run start -- --clear
```

Android:

```bash
npm run android
```

iOS:

```bash
npm run ios
```

## Notes

- Without Supabase env, app runs in local demo mode with offline-first behavior.
- Backend sync calls are enabled automatically when authenticated and online.

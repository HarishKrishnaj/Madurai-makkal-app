# Madurai Makkal Connect

Cross-platform civic waste management app with Supabase-ready backend integration.

## Project Structure

- Mobile app: `civic-mobile/`
- Supabase schema and edge function: `civic-mobile/supabase/`

## Run

```bash
npm --prefix civic-mobile install
npm run dev:mobile
```

Or platform specific:

```bash
npm run android:mobile
npm run ios:mobile
```

## Feature Coverage

The current app includes:

- Phone OTP auth (Supabase Auth)
- Location + geo-verification engine
- Smart public bin registry and full-bin reporting
- Scan-to-earn disposal (QR + geo + AI checks)
- AI image validation and duplicate detection
- Green Wallet reward ledger
- Coupon-based reward redemption
- Smart complaint reporting (311)
- Proof-of-cleanliness upload and verification
- Fraud/misuse detection with risk scoring
- Cleanliness analytics dashboard

See `civic-mobile/README.md` for details.

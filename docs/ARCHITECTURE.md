# Architecture — data and trust boundaries

```text
Visitor → FastAPI (same-origin HTML/CSS/JS) → Auth/CSRF → Business API
                             ↓                    ↓
                        templates/trends       SQLite / PostgreSQL planned
                                                  ↓
YouTube Data API → Collector → Trend + Evidence + Discovery records
                                                  ↓
Photo upload → Pillow normalize JPEG → atomically debit credits → Job(queued)
                                                               ↓
                                            Worker atomic claim (queued→processing)
                                                               ↓
                                              Demo ffmpeg OR fal queue API
                                                               ↓
                                      Job(completed) / Failure+one-time refund

Stripe Checkout (server creates authoritative prices) → Stripe signed webhook
                                                ↓
                              Order / Subscription / Revenue Event
                                                ↓
                            CreditEntry(unique ref) + User.credits
                                                ↓
                                    Billing analytics (real only)
```

## Trust boundaries

- Admin role cannot be acquired through public sign-up.
- Passwords are Argon2-hashed; JWT are signed. Sessions are HttpOnly, SameSite=Lax; changing endpoints require double-submit CSRF headers.
- No user can download another user's private output via the API.
- Source photos are not exposed as static files. Input JPEG is normalized and stripped of EXIF data.
- Stripe webhook verifies timestamp and HMAC; no credit based on Checkout redirect alone.
- Atomic credits update checks balance in SQL to prevent negative balances; uniquely keyed ledger entries are retry safe.
- Trend video links come from official YouTube or manual HTTPS URLs. They are not treated as executable instructions.
- Financial dashboard represents payment-derived revenue; demo topups add credits but no revenue.
- Model cost is merely *estimated* until provider billing reconciliation.

## Limitations before production

- Content policy review, anti-spam CAPTCHA, email verification, full refund/dispute handling and self-service photo deletion are still necessary.
- Database schema migrations currently require deliberate maintenance; `create_all()` does not evolve existing SQL tables.
- One-off PaymentIntent refunds need reconciliation with both revenue and wallet balances.
- Real video inference depends on fal's actual supported image upload modality and availability.
- Template create/publish/unpublish and Markdown trend report are implemented via admin API; realistic English SEO content and full image asset management need further work.
- Multi-worker production should adopt PostgreSQL and a dedicated queue to handle retries safely.

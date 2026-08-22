# ThetaShield Mathematical Specification

## 1. Units and rounding

Normalized prices, markouts, dimensionless controller parameters, risk, and
confidence use WAD fixed point (`1e18 = 1`). Confidence may be displayed in
basis points (`10_000 = 100%`). Uniswap LP fees use fee pips (`1_000_000 =
100%`, so 5 bps is 500 fee pips).

Unsigned integer division rounds down. Signed integer division rounds toward
zero. Every Solidity formula and golden vector uses this convention.

## 2. Directional delayed markout

For execution price `Pexec`, delayed normalized reference price `Pref`, and
trader direction `d`:

```text
d = +1  trader buys base
d = -1  trader sells base
m = d * (Pref - Pexec) / Pexec
```

Positive `m` means the market subsequently moved in the trader's favor and is
adverse evidence for the LP. Negative `m` is favorable or inventory-rebalancing
evidence. It remains signed throughout filtering and aggregation.

`notional * markout` is an adverse-selection proxy, not exact LP loss or exact
LVR.

## 3. Strictly trailing volatility

For observation `i`, the window is half-open and excludes `i`:

```text
H_i = {m[max(0, i-W)], ..., m[i-1]}
mean_i = sum(H_i) / |H_i|
sigma_i = sqrt(sum((m_j - mean_i)^2) / |H_i|)
```

ThetaShield uses population standard deviation with integer square root. The
Solidity API accepts the complete series plus `currentIndex` and reads only
indices below it. This makes self-inclusion a structural error rather than a
caller convention.

During cold start (`|H_i| < minimumTrailingObservations`), sigma may be recorded
using a documented fixed fallback band, but the observation cannot activate a
toxic premium.

## 4. Signed dead band

For configurable width `k`:

```text
band_i = k * sigma_i
e_i = sign(m_i) * max(abs(m_i) - band_i, 0)
```

Inside-band observations become zero. Outside-band observations retain their
sign and contribute only their excess magnitude.

## 5. Bounded epoch aggregation

Each direction has an independent epoch. Observations below the minimum
notional are ignored. Eligible notional is capped per trade:

```text
n_i = min(notional_i, maximumTradeNotional)
M_t = sum(n_i * e_i) / sum(n_i)
```

The input count is bounded at 256, configuration sets a smaller operational
limit, and an epoch carries a separate `meetsMinimumEpochNotional` gate. Capping
limits oversized-trade influence; the minimum limits microtrade spam.

## 6. Reference-price dispersion

At most 16 reference sources are processed. Each supplies normalized price and
a confidence weight in `(0, 1]`. Sources are sorted by price and the weighted
median is the first price whose cumulative weight reaches half the total.

ThetaShield then calculates weighted mean absolute deviation around that robust
center and normalizes it by the median price:

```text
center = weightedMedian(prices, weights)
WMAD = sum(weight_i * abs(price_i - center)) / sum(weight_i)
referenceDispersion = WMAD / center
```

This documented estimator uses a robust center while avoiding the degenerate
zero median-absolute-deviation result that two equally weighted sources can
produce.

## 7. Mechanical confidence

```text
countScore = min(1, observationCount / targetObservationCount)
agreement = agreeingNotional / totalNotional
agreementScore = clamp((agreement - 0.5) / 0.5, 0, 1)
dispersionScore = clamp(1 - referenceDispersion / maximumDispersion, 0, 1)
wRaw = countScore * agreementScore * dispersionScore
w = min(wRaw, confidenceCap)
```

The initial documented single-source cap is `0.60`, but the cap remains
configurable. A single source can never create full confidence.

## 8. Persistence

Each direction stores one bit per epoch in a `K`-bit rolling bitmap:

```text
toxic_t = confidenceAdjustedRisk_t > toxicThreshold
active_t = popcount(last K toxic bits) >= n
```

The default research starting point is `n=3`, `K=5`. Toxic epochs need not be
consecutive. A neutral epoch shifts one zero into the bitmap but does not erase
the remaining history.

## 9. Directional magnitude smoothing

```text
direction_t = sign(M_t)
magnitude_t = alpha * abs(M_t) + (1-alpha) * magnitude_(t-1)
signedRisk_t = direction_t * magnitude_t * w_t
```

Only magnitude is smoothed. Direction always comes from the current signed
aggregate. A zero aggregate produces zero signed risk while decaying stored
magnitude.

## 10. Fee curve

For each side independently:

```text
fastPathActive = fastPathEnabled
                 and not coldStart
                 and epochMeetsMinimumNotional
                 and confidence >= fastPathConfidenceFloor
                 and aggregateMarkout * confidence > fastPathToxicThreshold
protectionActive = persistenceActive or fastPathActive
eligible = protectionActive and confidence >= confidenceFloor
premium = eligible * gain * max(signedRisk, 0)
targetFee = clamp(baseFee + premium, minimumFee, maximumFee)
nextFee = rateLimit(previousFee, targetFee, maximumIncrease, maximumDecrease)
```

Negative or zero signed risk cannot raise the fee. Expiry, cooldown, callback
authentication, sequence enforcement, pause, and baseline fallback are origin
controller responsibilities introduced in Phase 2.

Phase 6.1 adds the separately configurable fast path above. It bypasses only
the time-domain persistence wait; it does not bypass cold start, epoch-notional,
confidence, positive-risk, fee-bound, or rate-limit checks. An optional bounded
hold counter may keep this path active for a fixed number of later epochs.

## 11. Phase 1 research defaults

| Parameter | Starting value |
|---|---:|
| Markout horizon | 60 seconds |
| Epoch duration | 30 seconds |
| Trailing window | 32 observations/epochs, experiment-dependent |
| Dead-band `k` | 1.5 WAD |
| Persistence | 3 of 5 |
| EWMA alpha | 0.25 WAD |
| Baseline fee | 500 fee pips (5 bps) |
| Maximum fee | 10,000 fee pips (100 bps) |
| Recommendation TTL | 180 seconds |
| Minimum trailing observations | 32 in the Phase 1 experiment |

These are research starting points, not calibrated production claims. Every
important value remains configurable and will be sensitivity-tested in Phase 6.

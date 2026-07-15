# FIN AI v9 — Product and Data Contract Plan

Status: Phase 0 contract boundary implemented; provider registry and real feeds remain future phases.

## Objective

Keep market facts, bank catalogue facts, bank-policy decisions, and synthetic fixtures visibly separate. A SETSMART row must never be treated as proof of approved shelf, client eligibility, product readiness, or bank availability unless those facts arrive from their own authorised source.

## Canonical source classes

```ts
type ProductSource =
  | 'SETSMART'
  | 'BANK_PRODUCT_CATALOG'
  | 'BANK_POLICY'
  | 'FIXTURE';
```

Credentials are configuration, never a source type or product field.

## Phase 0 fact envelope

Every governed fact is represented as an envelope:

```ts
type GovernedFact<T> = {
  availability: 'AVAILABLE' | 'MISSING' | 'NOT_SUPPORTED';
  value: T | null;
  reasonCode?: string;
  source: {
    type: ProductSource;
    sourceRef: string;
    asOf: string;
    version?: string;
  };
};
```

Rules:

- `AVAILABLE` requires a non-null value.
- `MISSING` and `NOT_SUPPORTED` require `value: null` and a reason code.
- Every fact inherits or supplies an explicit source and as-of date.
- Unsupported SETSMART coverage is not converted to a default value.
- Bank policy may restrict a market product, but it may not rewrite the market fact.
- Fixture facts always remain labelled `FIXTURE`.

The runtime validator is `lib/v3/product-contracts.js`; the TypeScript contract is `lib/v3/product-contracts.d.ts`.

## Universal product record

Every product must carry:

- stable canonical product ID;
- product name and family;
- primary source/source reference/as-of;
- issuer or provider;
- currency;
- risk;
- tenor or liquidity;
- minimum investment;
- fees;
- payoff type;
- capital-protection status;
- eligibility;
- required accounts; and
- approved-shelf status.

The value may be unavailable, but the field itself may not disappear.

## Target provider registry

Phase 2 should add the following without changing the frontend framework:

```ts
interface ProductDataProvider {
  searchProducts(query: ProductQuery): Promise<ProductSummary[]>;
  getProduct(productId: string): Promise<ProductDetail>;
  getHistory(productId: string, startDate: string, endDate: string): Promise<PriceObservation[]>;
  getCorporateActions?(
    productId: string,
    startDate: string,
    endDate: string
  ): Promise<CorporateAction[]>;
}
```

Provider responsibilities:

| Provider | Allowed facts |
|---|---|
| SETSMART | Only fields and instruments proven by the authorised API contract |
| Bank product catalogue | Product availability, commercial terms, required accounts, bank-offered instruments |
| Bank policy | Approved shelf, suitability/eligibility/readiness rules, limits, policy versions |
| Fixture | Clearly labelled synthetic demo values only |

Insurance, lending, and planning services are not price-series instruments and must not be fabricated as SETSMART securities.

## Canonical identity migration

Current IDs come from four fixture catalogs. Migration order:

1. Introduce a canonical `productId` and immutable provider identifiers.
2. Create an explicit crosswalk with effective dates and source.
3. Resolve every holding for all 30 clients or mark `MISSING_PRODUCT_MAPPING`.
4. Group share classes under one master fund before diversification/risk calculations.
5. Reject ambiguous mappings; do not choose by name similarity in governed calculations.
6. Version the crosswalk and include its hash in calculation lineage.

## Join rule

The candidate universe is an intersection performed as of the decision date:

```text
market universe
∩ approved shelf
∩ client eligibility/suitability
∩ data quality/freshness
∩ actor/client permission
∩ product readiness
```

Each input must have an effective/publication time not later than the information-set date. A missing critical gate produces `CONFIRM_DATA` or exclusion; it never defaults to eligible.

## SETSMART live boundary

The repository currently has no authorised endpoint/schema contract. Therefore:

- setting a key does not enable live mode;
- no endpoint or field is guessed;
- the backend requires an injected `documented: true` operation contract and transport;
- normalised rows require source lineage and dated freshness;
- timeout, retry, rate-limit, cache, stale fallback, backoff, and status are server-side;
- errors and cached stale state are visible without exposing credentials; and
- the browser calls FIN AI only.

## Required Phase 2 tests

1. Registry routes by source/family without cross-source leakage.
2. SETSMART cannot populate bank-policy facts.
3. Missing/unsupported fields remain explicit.
4. Approved-shelf and eligibility joins are effective-date aware.
5. Every holding maps to one canonical product or a visible missing state.
6. Share classes group to one master-fund diversification unit.
7. Stale fallback remains labelled stale and never becomes fixture/live silently.
8. The SETSMART credential never appears in browser payloads, logs, errors, source, screenshots, or exports.

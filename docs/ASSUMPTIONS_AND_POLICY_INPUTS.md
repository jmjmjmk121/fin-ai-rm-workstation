# Assumptions and Missing Bank-Policy Inputs

## Safe demo assumptions

- All clients, holdings, NAV histories, conversations, decisions, and outcomes are synthetic.
- The application starts in fixture mode and makes no network call.
- Raw fixture NAV is labelled `NAV return`; no distribution-adjusted total-return claim is made.
- THB is the portfolio reporting currency. FX exposure is shown as a risk flag, not automatically hedged.
- Emergency liquidity is six months of confirmed monthly expense for the demo only.
- Named stresses are separate deterministic scenarios, not forecasts or probability-weighted expected loss.
- Goal success probabilities are model outputs for comparison and discussion, not promises.
- Product choices are an illustrative approved shelf and are never presented as a universal winner.
- The RM may review, edit, request information, hand off, or record no action. The demo cannot send, trade, change KYC/suitability, or bind a product.
- The Model & Audit view is read-only in the demo.
- Historical replay is validation, not an alpha-trading strategy or an optimisation to beat the market.
- Replay funds, NAV, classifications, factsheets, shelf histories, holdings, benchmarks, events and client snapshots are synthetic point-in-time fixtures.
- The replay seed and decision dates are deterministic. Similarity between a synthetic stress window and a real historical period does not make the output verified market performance.
- Walk-forward selection at date `t` may use only records published and effective by `t`; later observations are evaluation data, not selection inputs.
- Replay results, forward-looking synthetic scenarios and live pilot outcomes are three distinct result classes. The demo contains no live pilot outcome.
- Transaction cost, workload time and alert labels in replay are modelling assumptions, not observed bank economics or service levels.
- No revenue, AUM, retention or causal client-benefit uplift is inferred from replay or scenario results.

## Inputs required before any pilot

### Product and market data

- Official listed EOD contract/header is implemented; still required: authorised SETSMART open-end mutual-fund API Reference, schemas, rate limits, entitlements, and error contract.
- Fund master/share-class identifier mapping and corporate-action/distribution handling.
- Approved product shelf with effective dates, client eligibility, minimum ticket, settlement, cut-off, FX/hedging, fees, lock-up, and concentration rules.
- Approved benchmarks and whether each history is NAV return or adjusted/total return.
- Licensed storage/caching/redistribution policy and data-quality/freshness thresholds.
- Licensed point-in-time history for NAV/adjusted NAV, benchmarks, classifications, factsheets, shelf decisions, fund mergers/closures and corrections, including original publication timestamps.
- Survivorship-bias treatment, master/share-class lineage, dividend/distribution history, fee history and benchmark constituent/version history.

### Client and suitability policy

- System-of-record fields and ownership for KYC/CDD, suitability, mandate, loss capacity, horizon, liquidity, goal, holdings, debt, protection, consent, and interactions.
- Authoritative suitability bands and contradiction/expiry rules.
- Goal priority rules, emergency-reserve policy, restricted assets, liabilities, tax, and currency treatment.
- Client/product permission rules and the exact conditions that require confirmation, blocking, escalation, or no action.

### Attention and conduct policy

- P0-P3 definitions, mandatory-Care triggers, SLA, owner, override and dismissal policy.
- RM capacity assumptions, task handling times, contact limits, quiet hours, campaign overlap, and preferred-channel policy.
- Complaint/service-recovery isolation and cross-sell restrictions.
- Approved language, product-fact sources, prohibited claims, and required disclosures.
- Definition and adjudication process for a true/false Care alert, observation window, severity-specific tolerance and labels for cases where “no action” was correct.
- Approved mapping from market events to potentially affected clients, including event detection time and closure/recovery criteria.

### Roles and operations

- Production identity provider and role matrix for RM, specialist, supervisor, Product/CIO, Risk, Compliance, Model Owner, administrator, and auditor.
- Handoff specialist taxonomy, acceptance SLA, due-date rules, and escalation ownership.
- Record-retention, privacy, data residency, consent, export, incident, and legal-hold requirements.
- Durable database, append-only event store, idempotency window, backup, replay, and disaster-recovery design.
- Separation and access controls for production client data, replay datasets, synthetic training data and pilot outcome stores.

### Model governance

- Model/assumption/rule version owners and approval workflow.
- Benchmark/risk-free/MAR conventions, observation frequency and minimum history.
- Approved shrinkage method, PSD tolerance, scenario set, calibration, simulation count, convergence tolerance, and override rules.
- Validation dataset, tool-routing labels, numeric validators, monitoring limits, drift thresholds, and model-change procedure.
- Walk-forward training/lookback/holding windows, minimum observation rules, rebalancing calendar and the treatment of unavailable or suspended NAV.
- Policy benchmark construction, goal-based candidate constraints and approved-model effective-date history.
- Transaction-cost/slippage assumptions, turnover definition, liquidity-settlement test and treatment of taxes/fees/cash drag.
- Goal-success calibration target, normalised-shortfall definition and projection validation protocol.
- Replay acceptance thresholds for leakage, determinism, calculation reconciliation, suitability/liquidity violations, alert false positives and RM workload.

### Pilot evidence and economics

- Coded RM/advisor interviews and baseline preparation/workflow timing.
- Eligible client/action denominators and comparison/control design.
- Observed completion, handoff, client-benefit, incident, and complaint outcomes.
- Finance-approved margins, costs, attribution window, cannibalisation, and overlap policy.
- Pre-registered separation of replay/scenario evidence from live pilot endpoints, denominators and reporting language.

Until these inputs are supplied and approved, the application is a fixture-backed decision-workflow demonstration, not a production advisory or transaction system.

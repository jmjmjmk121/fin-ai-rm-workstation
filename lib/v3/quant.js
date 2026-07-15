"use strict";

// Governed, dependency-free portfolio calculations for FIN AI RM Cockpit v3.
//
// Conventions:
// - Rates are decimals (0.01 = 1%).
// - External cash flow is positive when money enters the portfolio.
// - XIRR cash flow is from the client's perspective (investment negative,
//   receipt/terminal value positive).
// - Loss is L = -return, so a positive VaR/CVaR number denotes a loss.
// - Calendar-day annualisation uses 365.25 days where the formula requires it.

const crypto = require("node:crypto");

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365.25;
const DEFAULT_MODEL_VERSION = "fin-ai-quant-v3";
const DEFAULT_ASSUMPTION_VERSION = "caller-supplied-inputs-v1";
const EPSILON = 1e-14;

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(name + " must be a finite number");
  }
  return value;
}

function assertPositiveNumber(value, name) {
  assertFiniteNumber(value, name);
  if (!(value > 0)) throw new RangeError(name + " must be greater than zero");
  return value;
}

function canonicalize(value) {
  if (value === null || value === undefined) return value == null ? value : null;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }
  return String(value);
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function auditContext(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return {};
  return options.metadata || options.audit || options.context || {};
}

function makeAudit(formulaId, input, options, derived) {
  const supplied = auditContext(options);
  const hash = supplied.inputHash || stableHash(input);
  const extra = derived || {};
  const reasonCodes = [
    ...(Array.isArray(supplied.reasonCodes) ? supplied.reasonCodes : []),
    ...(Array.isArray(extra.reasonCodes) ? extra.reasonCodes : []),
  ];
  return {
    formulaId,
    calculationId: supplied.calculationId || ("calc-" + hash.slice(0, 16)),
    modelVersion: supplied.modelVersion || DEFAULT_MODEL_VERSION,
    assumptionVersion: supplied.assumptionVersion || DEFAULT_ASSUMPTION_VERSION,
    inputHash: hash,
    asOf: supplied.asOf || extra.asOf || null,
    sourceRefs: Array.isArray(supplied.sourceRefs) ? supplied.sourceRefs.slice() : [],
    currency: supplied.currency || extra.currency || null,
    period: supplied.period || extra.period || null,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

function resultWithAudit(result, formulaId, input, options, derived) {
  return { ...result, audit: makeAudit(formulaId, input, options, derived) };
}

function parseDate(value, name) {
  const field = name || "date";
  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) throw new TypeError(field + " must be a valid date");
    return time;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(field + " must be a valid date");
  }
  const normalized = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value + "T00:00:00.000Z"
    : value;
  const time = new Date(normalized).getTime();
  if (!Number.isFinite(time)) throw new TypeError(field + " must be a valid date");
  return time;
}

function isoDate(value, name) {
  return new Date(parseDate(value, name)).toISOString().slice(0, 10);
}

function calendarDaysBetween(startDate, endDate) {
  const start = parseDate(startDate, "startDate");
  const end = parseDate(endDate, "endDate");
  const days = (end - start) / DAY_MS;
  if (!(days > 0)) throw new RangeError("endDate must be after startDate");
  return days;
}

function pickNumber(object, keys, name) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) {
      return assertFiniteNumber(Number(object[key]), name || key);
    }
  }
  throw new TypeError((name || keys[0]) + " is required");
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sampleVariance(values) {
  if (values.length < 2) throw new RangeError("at least two observations are required");
  const mean = average(values);
  let total = 0;
  for (const value of values) total += (value - mean) ** 2;
  return total / (values.length - 1);
}

function normalizeDatedObservations(observations, valueKeys, label) {
  if (!Array.isArray(observations)) throw new TypeError(label + " must be an array");
  const normalized = observations.map((observation, index) => {
    if (Array.isArray(observation)) {
      if (observation.length < 2) throw new TypeError(label + "[" + index + "] is invalid");
      return {
        date: isoDate(observation[0], label + "[" + index + "].date"),
        value: assertFiniteNumber(Number(observation[1]), label + "[" + index + "].value"),
      };
    }
    if (!observation || typeof observation !== "object") {
      throw new TypeError(label + "[" + index + "] must be an object");
    }
    const dateValue = observation.date ?? observation.asOf ?? observation.valuationDate;
    const date = isoDate(dateValue, label + "[" + index + "].date");
    const value = pickNumber(observation, valueKeys, label + "[" + index + "].value");
    return { ...observation, date, value };
  }).sort((a, b) => parseDate(a.date) - parseDate(b.date));

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].date === normalized[index - 1].date) {
      throw new RangeError(label + " contains duplicate date " + normalized[index].date);
    }
  }
  return normalized;
}

function deriveNavReturns(observations, options = {}) {
  if (!Array.isArray(observations) || observations.length < 2) {
    throw new RangeError("at least two NAV observations are required");
  }
  const sorted = observations.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new TypeError("observations[" + index + "] must be an object");
    }
    const date = isoDate(row.date ?? row.asOf ?? row.valuationDate, "observations[" + index + "].date");
    const rawNav = pickNumber(row, ["nav", "rawNav", "navPerUnit"], "observations[" + index + "].nav");
    if (!(rawNav > 0)) throw new RangeError("NAV must be greater than zero");
    const adjustedCandidate = row.adjustedNav ?? row.adjustedNAV ?? row.totalReturnNav;
    const adjustedNav = adjustedCandidate == null
      ? null
      : assertPositiveNumber(Number(adjustedCandidate), "observations[" + index + "].adjustedNav");
    return { date, rawNav, adjustedNav };
  }).sort((a, b) => parseDate(a.date) - parseDate(b.date));

  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].date === sorted[index - 1].date) {
      throw new RangeError("duplicate NAV date " + sorted[index].date);
    }
  }

  const adjustedComplete = sorted.every((row) => row.adjustedNav != null);
  const useAdjusted = options.preferAdjusted !== false && adjustedComplete;
  if (options.requireAdjusted === true && !adjustedComplete) {
    throw new RangeError("adjusted NAV is required but is missing for one or more dates");
  }
  const returns = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = useAdjusted ? sorted[index - 1].adjustedNav : sorted[index - 1].rawNav;
    const current = useAdjusted ? sorted[index].adjustedNav : sorted[index].rawNav;
    returns.push({
      date: sorted[index].date,
      previousDate: sorted[index - 1].date,
      return: current / previous - 1,
      sourceValue: current,
      previousSourceValue: previous,
    });
  }

  const returnType = useAdjusted ? "ADJUSTED_NAV_RETURN" : "NAV_RETURN";
  const warnings = [];
  if (!useAdjusted) {
    warnings.push("Raw NAV return only; distributions may be missing and this must not be labelled total return.");
  }
  if (!adjustedComplete && sorted.some((row) => row.adjustedNav != null)) {
    warnings.push("Adjusted NAV history is incomplete, so the full series consistently uses raw NAV.");
  }
  const result = {
    value: returns,
    returns,
    returnType,
    label: useAdjusted ? "Adjusted NAV return" : "NAV return",
    isTotalReturn: useAdjusted,
    navFieldUsed: useAdjusted ? "adjustedNav" : "nav",
    observationCount: sorted.length,
    returnCount: returns.length,
    startDate: sorted[0].date,
    endDate: sorted[sorted.length - 1].date,
    warnings,
    limitation: useAdjusted
      ? "Adjusted NAV is treated as distribution-adjusted only because the supplied field is explicitly identified as adjusted."
      : "Raw NAV may omit distributions; it is not total return.",
  };
  return resultWithAudit(result, "NAV_RETURN_V3", { observations: sorted, useAdjusted }, options, {
    asOf: result.endDate,
    period: result.startDate + "/" + result.endDate,
    reasonCodes: useAdjusted ? ["ADJUSTED_NAV_USED"] : ["RAW_NAV_NOT_TOTAL_RETURN"],
  });
}

function normalizeTwrPeriods(input) {
  const periods = input && !Array.isArray(input) && Array.isArray(input.periods)
    ? input.periods
    : (Array.isArray(input) && input.length && (
      input[0].startValue !== undefined || input[0].beginValue !== undefined
    ) ? input : null);

  if (periods) {
    if (!periods.length) throw new RangeError("at least one TWR subperiod is required");
    return periods.map((period, index) => {
      const startValue = pickNumber(period, ["startValue", "beginValue", "openingValue"], "periods[" + index + "].startValue");
      const endValue = pickNumber(period, ["endValue", "closingValue", "value"], "periods[" + index + "].endValue");
      const beginningFlow = Number(period.beginningFlow ?? period.startFlow ?? 0);
      const endingFlow = Number(period.endingFlow ?? period.externalFlow ?? period.cashFlow ?? period.netFlow ?? 0);
      assertFiniteNumber(beginningFlow, "periods[" + index + "].beginningFlow");
      assertFiniteNumber(endingFlow, "periods[" + index + "].endingFlow");
      return {
        startDate: period.startDate ? isoDate(period.startDate) : null,
        endDate: period.endDate ? isoDate(period.endDate) : null,
        startValue,
        endValue,
        beginningFlow,
        endingFlow,
      };
    });
  }

  const valuationsInput = Array.isArray(input) ? input : input && input.valuations;
  if (!Array.isArray(valuationsInput) || valuationsInput.length < 2) {
    throw new RangeError("TWR requires at least two valuations or one explicit subperiod");
  }
  const valuations = normalizeDatedObservations(
    valuationsInput,
    ["value", "portfolioValue", "marketValue"],
    "valuations"
  );
  const flowByDate = new Map();
  if (input && !Array.isArray(input) && Array.isArray(input.cashFlows)) {
    for (const [index, flow] of input.cashFlows.entries()) {
      const date = isoDate(flow.date ?? flow.asOf, "cashFlows[" + index + "].date");
      const amount = pickNumber(flow, ["amount", "externalFlow", "cashFlow"], "cashFlows[" + index + "].amount");
      flowByDate.set(date, (flowByDate.get(date) || 0) + amount);
    }
  }
  return valuations.slice(1).map((valuation, index) => {
    const prior = valuations[index];
    const embeddedFlow = Number(
      valuation.externalFlow ?? valuation.cashFlow ?? valuation.netFlow ?? 0
    );
    assertFiniteNumber(embeddedFlow, "valuations[" + (index + 1) + "].externalFlow");
    return {
      startDate: prior.date,
      endDate: valuation.date,
      startValue: prior.value,
      endValue: valuation.value,
      beginningFlow: 0,
      endingFlow: embeddedFlow + (flowByDate.get(valuation.date) || 0),
    };
  });
}

function calculateTWR(input, options = {}) {
  const periods = normalizeTwrPeriods(input);
  let growthFactor = 1;
  const subperiods = periods.map((period, index) => {
    const denominator = period.startValue + period.beginningFlow;
    if (!(denominator > 0)) {
      throw new RangeError("TWR subperiod " + index + " has a non-positive invested opening value");
    }
    const numerator = period.endValue - period.endingFlow;
    const periodReturn = numerator / denominator - 1;
    if (periodReturn < -1 - EPSILON) {
      throw new RangeError("TWR subperiod return cannot be below -100%");
    }
    growthFactor *= Math.max(0, 1 + periodReturn);
    return { ...period, return: periodReturn };
  });
  const twr = growthFactor - 1;
  const startDate = periods.find((period) => period.startDate)?.startDate || null;
  const datedPeriods = periods.filter((period) => period.endDate);
  const endDate = datedPeriods.length ? datedPeriods[datedPeriods.length - 1].endDate : null;
  return resultWithAudit({
    value: twr,
    twr,
    growthFactor,
    subperiods,
    subperiodCount: subperiods.length,
    cashFlowConvention: "positive = contribution; flows are removed at subperiod end unless beginningFlow is supplied",
    formula: "product((V_end - CF_end) / (V_start + CF_start)) - 1",
    startDate,
    endDate,
  }, "TWR_V3", { periods }, options, {
    asOf: endDate,
    period: startDate && endDate ? startDate + "/" + endDate : null,
  });
}

function normalizeXirrFlows(input) {
  const source = Array.isArray(input) ? input : input && input.cashFlows;
  if (!Array.isArray(source) || source.length < 2) {
    throw new RangeError("XIRR requires at least two dated cash flows");
  }
  const byDate = new Map();
  source.forEach((flow, index) => {
    if (!flow || typeof flow !== "object") throw new TypeError("cashFlows[" + index + "] must be an object");
    const date = isoDate(flow.date ?? flow.asOf, "cashFlows[" + index + "].date");
    const amount = pickNumber(flow, ["amount", "cashFlow", "value"], "cashFlows[" + index + "].amount");
    byDate.set(date, (byDate.get(date) || 0) + amount);
  });
  const flows = [...byDate.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .filter((flow) => Math.abs(flow.amount) > EPSILON)
    .sort((a, b) => parseDate(a.date) - parseDate(b.date));
  if (flows.length < 2) throw new RangeError("XIRR requires at least two non-zero dated cash flows");
  if (!flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) {
    throw new RangeError("XIRR requires at least one negative and one positive cash flow");
  }
  return flows;
}

function calculateXIRR(input, options = {}) {
  const flows = normalizeXirrFlows(input);
  const baseTime = parseDate(flows[0].date);
  const terms = flows.map((flow) => ({
    ...flow,
    years: (parseDate(flow.date) - baseTime) / DAY_MS / DAYS_PER_YEAR,
  }));
  const npvAtLogRate = (logGrowth) => terms.reduce(
    (total, flow) => total + flow.amount * Math.exp(-flow.years * logGrowth),
    0
  );
  const scale = terms.reduce((total, flow) => total + Math.abs(flow.amount), 0);
  const tolerance = Number(options.tolerance ?? 1e-12) * Math.max(1, scale);
  const minimumRate = Number(options.minimumRate ?? -0.999999999);
  const maximumRate = Number(options.maximumRate ?? 1e6);
  if (!(minimumRate > -1) || !(maximumRate > minimumRate)) {
    throw new RangeError("invalid XIRR search range");
  }

  const minLog = Math.log1p(minimumRate);
  const maxLog = Math.log1p(maximumRate);
  const scanSteps = Math.max(128, Math.floor(Number(options.scanSteps ?? 2048)));
  const brackets = [];
  let priorX = minLog;
  let priorValue = npvAtLogRate(priorX);
  for (let step = 1; step <= scanSteps; step += 1) {
    const x = minLog + (maxLog - minLog) * step / scanSteps;
    const value = npvAtLogRate(x);
    if (Math.abs(priorValue) <= tolerance) brackets.push([priorX, priorX]);
    if (priorValue * value < 0) brackets.push([priorX, x]);
    if (step === scanSteps && Math.abs(value) <= tolerance) brackets.push([x, x]);
    priorX = x;
    priorValue = value;
  }
  if (!brackets.length) {
    throw new RangeError("XIRR has no root in the configured search range");
  }

  const roots = [];
  let totalIterations = 0;
  for (const bracket of brackets) {
    let low = bracket[0];
    let high = bracket[1];
    let lowValue = npvAtLogRate(low);
    let root = low;
    if (low !== high) {
      for (let iteration = 0; iteration < 240; iteration += 1) {
        totalIterations += 1;
        root = (low + high) / 2;
        const value = npvAtLogRate(root);
        if (Math.abs(value) <= tolerance || Math.abs(high - low) <= 1e-13) break;
        if (lowValue * value <= 0) {
          high = root;
        } else {
          low = root;
          lowValue = value;
        }
      }
    }
    const rate = Math.expm1(root);
    if (!roots.some((candidate) => Math.abs(candidate.rate - rate) < 1e-9)) {
      roots.push({ rate, residual: npvAtLogRate(root) });
    }
  }
  roots.sort((a, b) => Math.abs(a.rate) - Math.abs(b.rate));
  const selected = roots[0];
  const startDate = terms[0].date;
  const endDate = terms[terms.length - 1].date;
  return resultWithAudit({
    value: selected.rate,
    xirr: selected.rate,
    residual: selected.residual,
    converged: Math.abs(selected.residual) <= tolerance * 1.01,
    iterations: totalIterations,
    rootsFound: roots.map((root) => root.rate),
    multipleRootWarning: roots.length > 1,
    dayCountConvention: "actual days / 365.25",
    cashFlowConvention: "client perspective: investments negative; receipts and terminal value positive",
    startDate,
    endDate,
    observationCount: terms.length,
  }, "XIRR_ACT_36525_V3", { flows: terms, minimumRate, maximumRate }, options, {
    asOf: endDate,
    period: startDate + "/" + endDate,
    reasonCodes: roots.length > 1 ? ["MULTIPLE_XIRR_ROOTS_CLOSEST_TO_ZERO_SELECTED"] : [],
  });
}

function normalizeCagrInput(input, endValue, startDate, endDate, options) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      startValue: pickNumber(input, ["startValue", "beginValue", "openingValue"], "startValue"),
      endValue: pickNumber(input, ["endValue", "closingValue", "value"], "endValue"),
      startDate: input.startDate,
      endDate: input.endDate,
      cashFlows: input.cashFlows || [],
      options: endValue && typeof endValue === "object" ? endValue : (options || {}),
    };
  }
  return {
    startValue: Number(input),
    endValue: Number(endValue),
    startDate,
    endDate,
    cashFlows: [],
    options: options || {},
  };
}

function calculateCAGRNoFlows(input, endValue, startDate, endDate, options = {}) {
  const normalized = normalizeCagrInput(input, endValue, startDate, endDate, options);
  assertPositiveNumber(normalized.startValue, "startValue");
  assertPositiveNumber(normalized.endValue, "endValue");
  if (normalized.cashFlows.some((flow) => Math.abs(Number(flow.amount ?? flow.cashFlow ?? flow)) > EPSILON)) {
    throw new RangeError("calculateCAGRNoFlows cannot be used when external cash flows exist");
  }
  const start = isoDate(normalized.startDate, "startDate");
  const end = isoDate(normalized.endDate, "endDate");
  const days = calendarDaysBetween(start, end);
  const cagr = (normalized.endValue / normalized.startValue) ** (DAYS_PER_YEAR / days) - 1;
  return resultWithAudit({
    value: cagr,
    cagr,
    startValue: normalized.startValue,
    endValue: normalized.endValue,
    startDate: start,
    endDate: end,
    elapsedCalendarDays: days,
    dayCountConvention: "actual days; exponent = 365.25 / elapsed days",
    formula: "(V_end / V_start)^(365.25 / calendar_days) - 1",
  }, "CAGR_NO_FLOWS_ACT_36525_V3", normalized, normalized.options, {
    asOf: end,
    period: start + "/" + end,
  });
}

function resolveFrequency(frequency) {
  if (typeof frequency === "number") {
    assertPositiveNumber(frequency, "periodsPerYear");
    return { frequency: "custom", periodsPerYear: frequency };
  }
  const key = String(frequency || "").toLowerCase().replace(/[_\s]/g, "-");
  const table = {
    daily: ["business-daily", 252],
    "business-daily": ["business-daily", 252],
    "calendar-daily": ["calendar-daily", DAYS_PER_YEAR],
    weekly: ["weekly", 52],
    biweekly: ["biweekly", 26],
    fortnightly: ["biweekly", 26],
    monthly: ["monthly", 12],
    quarterly: ["quarterly", 4],
    semiannual: ["semiannual", 2],
    "semi-annual": ["semiannual", 2],
    annual: ["annual", 1],
    yearly: ["annual", 1],
  };
  if (!table[key]) throw new RangeError("unsupported frequency " + frequency);
  return { frequency: table[key][0], periodsPerYear: table[key][1] };
}

function inferFrequency(dates, options = {}) {
  if (!Array.isArray(dates) || dates.length < 2) {
    throw new RangeError("at least two dates are required to infer frequency");
  }
  const unique = [...new Set(dates.map((date, index) => isoDate(date, "dates[" + index + "]")))]
    .sort((a, b) => parseDate(a) - parseDate(b));
  if (unique.length < 2) throw new RangeError("at least two unique dates are required");
  const spacings = [];
  for (let index = 1; index < unique.length; index += 1) {
    spacings.push((parseDate(unique[index]) - parseDate(unique[index - 1])) / DAY_MS);
  }
  const ordered = spacings.slice().sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const medianSpacingDays = ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
  let inferred;
  if (medianSpacingDays <= 3) inferred = { frequency: "business-daily", periodsPerYear: 252 };
  else if (medianSpacingDays <= 10) inferred = { frequency: "weekly", periodsPerYear: 52 };
  else if (medianSpacingDays <= 21) inferred = { frequency: "biweekly", periodsPerYear: 26 };
  else if (medianSpacingDays <= 45) inferred = { frequency: "monthly", periodsPerYear: 12 };
  else if (medianSpacingDays <= 100) inferred = { frequency: "quarterly", periodsPerYear: 4 };
  else if (medianSpacingDays <= 200) inferred = { frequency: "semiannual", periodsPerYear: 2 };
  else inferred = { frequency: "annual", periodsPerYear: 1 };
  const spanDays = (parseDate(unique[unique.length - 1]) - parseDate(unique[0])) / DAY_MS;
  const observedPeriodsPerYear = (unique.length - 1) * DAYS_PER_YEAR / spanDays;
  return resultWithAudit({
    value: inferred.periodsPerYear,
    ...inferred,
    annualizationFactor: Math.sqrt(inferred.periodsPerYear),
    medianSpacingDays,
    minSpacingDays: Math.min(...spacings),
    maxSpacingDays: Math.max(...spacings),
    observedPeriodsPerYear,
    observationCount: unique.length,
    startDate: unique[0],
    endDate: unique[unique.length - 1],
    method: "cadence inferred from median actual spacing; business-daily uses 252 observations per year",
  }, "FREQUENCY_INFERENCE_V3", { dates: unique }, options, {
    asOf: unique[unique.length - 1],
    period: unique[0] + "/" + unique[unique.length - 1],
  });
}

function normalizeReturnSeries(input, options = {}) {
  const source = Array.isArray(input)
    ? input
    : (input && (input.returns || input.observations || input.series));
  if (!Array.isArray(source) || !source.length) throw new RangeError("return series is required");
  const values = [];
  const dates = [];
  source.forEach((item, index) => {
    if (typeof item === "number") {
      values.push(assertFiniteNumber(item, "returns[" + index + "]"));
      if (Array.isArray(options.dates)) dates.push(isoDate(options.dates[index], "dates[" + index + "]"));
      return;
    }
    if (Array.isArray(item)) {
      dates.push(isoDate(item[0], "returns[" + index + "].date"));
      values.push(assertFiniteNumber(Number(item[1]), "returns[" + index + "].return"));
      return;
    }
    if (!item || typeof item !== "object") throw new TypeError("returns[" + index + "] is invalid");
    if (item.date !== undefined || item.asOf !== undefined) {
      dates.push(isoDate(item.date ?? item.asOf, "returns[" + index + "].date"));
    }
    values.push(pickNumber(item, ["return", "rate", "value"], "returns[" + index + "].return"));
  });
  if (dates.length && dates.length !== values.length) {
    throw new RangeError("every return must have a date when dated returns are used");
  }
  if (dates.length) {
    const rows = values.map((value, index) => ({ date: dates[index], value }))
      .sort((a, b) => parseDate(a.date) - parseDate(b.date));
    for (let index = 1; index < rows.length; index += 1) {
      if (rows[index].date === rows[index - 1].date) {
        throw new RangeError("duplicate return date " + rows[index].date);
      }
    }
    return { values: rows.map((row) => row.value), dates: rows.map((row) => row.date) };
  }
  return { values, dates: [] };
}

function frequencyForSeries(series, options) {
  if (options && options.periodsPerYear != null) return resolveFrequency(Number(options.periodsPerYear));
  if (options && options.frequency != null) return resolveFrequency(options.frequency);
  if (series.dates.length >= 2) return inferFrequency(series.dates, options);
  throw new RangeError("frequency or dated returns are required for annualisation");
}

function calculateAnnualizedVolatility(input, options = {}) {
  if (Array.isArray(options)) options = { dates: options };
  const series = normalizeReturnSeries(input, options);
  if (series.values.length < 2) throw new RangeError("at least two returns are required");
  const frequency = frequencyForSeries(series, options);
  const periodicVariance = sampleVariance(series.values);
  const periodicVolatility = Math.sqrt(periodicVariance);
  const annualizedVolatility = periodicVolatility * Math.sqrt(frequency.periodsPerYear);
  const startDate = series.dates[0] || null;
  const endDate = series.dates[series.dates.length - 1] || null;
  return resultWithAudit({
    value: annualizedVolatility,
    annualizedVolatility,
    periodicVolatility,
    periodicVariance,
    observationCount: series.values.length,
    frequency: frequency.frequency,
    periodsPerYear: frequency.periodsPerYear,
    annualizationFactor: Math.sqrt(frequency.periodsPerYear),
    startDate,
    endDate,
    formula: "sample standard deviation of periodic returns * sqrt(periods per year)",
  }, "ANNUALIZED_VOLATILITY_V3", { series, frequency }, options, {
    asOf: endDate,
    period: startDate && endDate ? startDate + "/" + endDate : null,
  });
}

function calculateDrawdownSeries(input, options = {}) {
  const sourceUnsorted = Array.isArray(input)
    ? input
    : (input && (input.series || input.returns || input.values || input.observations));
  if (!Array.isArray(sourceUnsorted) || !sourceUnsorted.length) throw new RangeError("drawdown series is required");
  const source = sourceUnsorted.slice();
  const datedCount = source.filter((item) => (
    Array.isArray(item)
      ? item[0] != null
      : item && typeof item === "object" && (item.date != null || item.asOf != null)
  )).length;
  if (datedCount && datedCount !== source.length) {
    throw new RangeError("every drawdown observation must have a date when dated data is used");
  }
  if (datedCount === source.length) {
    const dateFor = (item) => Array.isArray(item) ? item[0] : (item.date ?? item.asOf);
    source.sort((a, b) => parseDate(dateFor(a)) - parseDate(dateFor(b)));
    for (let index = 1; index < source.length; index += 1) {
      if (isoDate(dateFor(source[index])) === isoDate(dateFor(source[index - 1]))) {
        throw new RangeError("drawdown series contains a duplicate date");
      }
    }
  }
  const explicitType = options.inputType || (input && !Array.isArray(input) && input.inputType);
  const inferredType = explicitType || (
    typeof source[0] === "object" && !Array.isArray(source[0]) &&
    (source[0].wealth !== undefined || source[0].portfolioValue !== undefined || source[0].nav !== undefined)
      ? "wealth"
      : "returns"
  );
  if (!["returns", "wealth"].includes(inferredType)) {
    throw new RangeError("drawdown inputType must be returns or wealth");
  }

  let wealth = Number(options.initialWealth ?? 1);
  assertPositiveNumber(wealth, "initialWealth");
  let peak = wealth;
  let peakDate = options.initialDate ? isoDate(options.initialDate) : null;
  let maxDrawdown = 0;
  let maxPeakDate = peakDate;
  let troughDate = null;
  let troughIndex = -1;
  let peakValueForMax = peak;
  const rows = [];

  source.forEach((item, index) => {
    let date = null;
    let value;
    if (typeof item === "number") value = item;
    else if (Array.isArray(item)) {
      date = isoDate(item[0], "series[" + index + "].date");
      value = Number(item[1]);
    } else if (item && typeof item === "object") {
      if (item.date !== undefined || item.asOf !== undefined) {
        date = isoDate(item.date ?? item.asOf, "series[" + index + "].date");
      }
      value = inferredType === "wealth"
        ? pickNumber(item, ["wealth", "portfolioValue", "nav", "value"], "series[" + index + "].wealth")
        : pickNumber(item, ["return", "rate", "value"], "series[" + index + "].return");
    } else throw new TypeError("series[" + index + "] is invalid");
    assertFiniteNumber(Number(value), "series[" + index + "].value");

    if (inferredType === "wealth") {
      if (!(value > 0)) throw new RangeError("wealth observations must be greater than zero");
      wealth = value;
    } else {
      if (value < -1) throw new RangeError("return cannot be below -100%");
      wealth *= 1 + value;
    }
    if (wealth > peak) {
      peak = wealth;
      peakDate = date;
    }
    const drawdown = wealth / peak - 1;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxPeakDate = peakDate;
      peakValueForMax = peak;
      troughDate = date;
      troughIndex = index;
    }
    rows.push({ date, wealth, peak, drawdown });
  });

  let recoveryDate = null;
  if (troughIndex >= 0) {
    for (let index = troughIndex + 1; index < rows.length; index += 1) {
      if (rows[index].wealth >= peakValueForMax - EPSILON) {
        recoveryDate = rows[index].date;
        break;
      }
    }
  }
  const dated = rows.filter((row) => row.date);
  const startDate = dated.length ? dated[0].date : null;
  const endDate = dated.length ? dated[dated.length - 1].date : null;
  return resultWithAudit({
    value: maxDrawdown,
    maxDrawdown,
    series: rows,
    inputType: inferredType,
    observationCount: rows.length,
    peakDate: maxPeakDate,
    troughDate,
    recoveryDate,
    recovered: maxDrawdown === 0 || recoveryDate !== null,
    formula: "DD_t = W_t / max(W_u, u <= t) - 1; MaxDD = min(DD_t)",
    startDate,
    endDate,
  }, "MAX_DRAWDOWN_V3", { source, inputType: inferredType }, options, {
    asOf: endDate,
    period: startDate && endDate ? startDate + "/" + endDate : null,
  });
}

function periodicThreshold(annualRate, periodsPerYear, name) {
  assertFiniteNumber(annualRate, name);
  if (annualRate <= -1) throw new RangeError(name + " must be greater than -100%");
  return (1 + annualRate) ** (1 / periodsPerYear) - 1;
}

function calculateDownsideDeviation(input, options = {}) {
  const series = normalizeReturnSeries(input, options);
  const frequency = frequencyForSeries(series, options);
  const annualMar = Number(options.minimumAcceptableReturn ?? options.mar ?? 0);
  const marPeriodic = options.marIsPeriodic
    ? assertFiniteNumber(annualMar, "minimumAcceptableReturn")
    : periodicThreshold(annualMar, frequency.periodsPerYear, "minimumAcceptableReturn");
  const downsideSquares = series.values.map((value) => Math.min(value - marPeriodic, 0) ** 2);
  const periodicDownsideDeviation = Math.sqrt(average(downsideSquares));
  const annualizedDownsideDeviation = periodicDownsideDeviation * Math.sqrt(frequency.periodsPerYear);
  const endDate = series.dates.at(-1) || null;
  return resultWithAudit({
    value: annualizedDownsideDeviation,
    annualizedDownsideDeviation,
    periodicDownsideDeviation,
    minimumAcceptableReturnAnnual: options.marIsPeriodic ? null : annualMar,
    minimumAcceptableReturnPeriodic: marPeriodic,
    observationCount: series.values.length,
    downsideObservationCount: series.values.filter((value) => value < marPeriodic).length,
    frequency: frequency.frequency,
    periodsPerYear: frequency.periodsPerYear,
    formula: "sqrt(mean(min(r - MAR, 0)^2)) * sqrt(periods per year)",
  }, "DOWNSIDE_DEVIATION_V3", { series, annualMar, marPeriodic, frequency }, options, {
    asOf: endDate,
  });
}

function calculateSharpeRatio(input, options = {}) {
  const series = normalizeReturnSeries(input, options);
  if (series.values.length < 2) throw new RangeError("at least two returns are required");
  const frequency = frequencyForSeries(series, options);
  const riskFreeAnnual = Number(options.riskFreeRate ?? 0);
  const riskFreePeriodic = options.riskFreeIsPeriodic
    ? assertFiniteNumber(riskFreeAnnual, "riskFreeRate")
    : periodicThreshold(riskFreeAnnual, frequency.periodsPerYear, "riskFreeRate");
  const periodicMean = average(series.values);
  const periodicVolatility = Math.sqrt(sampleVariance(series.values));
  const annualizedExcessReturn = (periodicMean - riskFreePeriodic) * frequency.periodsPerYear;
  const annualizedVolatility = periodicVolatility * Math.sqrt(frequency.periodsPerYear);
  const sharpe = annualizedVolatility > 0 ? annualizedExcessReturn / annualizedVolatility : null;
  return resultWithAudit({
    value: sharpe,
    sharpe,
    periodicMeanReturn: periodicMean,
    riskFreeRateAnnual: options.riskFreeIsPeriodic ? null : riskFreeAnnual,
    riskFreeRatePeriodic: riskFreePeriodic,
    annualizedExcessReturn,
    annualizedVolatility,
    observationCount: series.values.length,
    frequency: frequency.frequency,
    periodsPerYear: frequency.periodsPerYear,
    limitation: "Arithmetic annualisation of the average periodic excess return; not a forecast.",
  }, "SHARPE_RATIO_V3", { series, riskFreeAnnual, riskFreePeriodic, frequency }, options, {
    asOf: series.dates.at(-1) || null,
  });
}

function calculateSortinoRatio(input, options = {}) {
  const series = normalizeReturnSeries(input, options);
  const frequency = frequencyForSeries(series, options);
  const annualMar = Number(options.minimumAcceptableReturn ?? options.mar ?? 0);
  const marPeriodic = options.marIsPeriodic
    ? assertFiniteNumber(annualMar, "minimumAcceptableReturn")
    : periodicThreshold(annualMar, frequency.periodsPerYear, "minimumAcceptableReturn");
  const downsideSquares = series.values.map((value) => Math.min(value - marPeriodic, 0) ** 2);
  const annualizedDownsideDeviation = Math.sqrt(average(downsideSquares)) * Math.sqrt(frequency.periodsPerYear);
  const annualizedExcessReturn = (average(series.values) - marPeriodic) * frequency.periodsPerYear;
  const sortino = annualizedDownsideDeviation > 0
    ? annualizedExcessReturn / annualizedDownsideDeviation
    : null;
  return resultWithAudit({
    value: sortino,
    sortino,
    annualizedExcessReturn,
    annualizedDownsideDeviation,
    minimumAcceptableReturnAnnual: options.marIsPeriodic ? null : annualMar,
    minimumAcceptableReturnPeriodic: marPeriodic,
    observationCount: series.values.length,
    frequency: frequency.frequency,
    periodsPerYear: frequency.periodsPerYear,
  }, "SORTINO_RATIO_V3", { series, annualMar, marPeriodic, frequency }, options, {
    asOf: series.dates.at(-1) || null,
  });
}

function compoundGrowth(returns) {
  return returns.reduce((growth, value) => growth * (1 + value), 1);
}

function calculateCalmarRatio(input, options = {}) {
  let cagr;
  let maxDrawdown;
  let derivedInput;
  if (input && !Array.isArray(input) && Number.isFinite(input.cagr) && Number.isFinite(input.maxDrawdown)) {
    cagr = input.cagr;
    maxDrawdown = input.maxDrawdown;
    derivedInput = input;
  } else {
    const series = normalizeReturnSeries(input, options);
    const frequency = frequencyForSeries(series, options);
    const growth = compoundGrowth(series.values);
    cagr = growth > 0 ? growth ** (frequency.periodsPerYear / series.values.length) - 1 : -1;
    maxDrawdown = calculateDrawdownSeries(series.values, options).maxDrawdown;
    derivedInput = { series, frequency, growth };
  }
  const calmar = maxDrawdown < 0 ? cagr / Math.abs(maxDrawdown) : null;
  return resultWithAudit({
    value: calmar,
    calmar,
    cagr,
    maxDrawdown,
    formula: "CAGR / abs(MaxDD)",
    limitation: maxDrawdown === 0 ? "Undefined because no drawdown was observed." : null,
  }, "CALMAR_RATIO_V3", derivedInput, options);
}

function calculateHistoricalVaRCVaR(input, options = {}) {
  if (typeof options === "number") options = { confidenceLevel: options };
  const source = Array.isArray(input) ? input : input && (input.returns || input.losses || input.series);
  if (!Array.isArray(source) || !source.length) throw new RangeError("returns or losses are required");
  const inputType = options.inputType || (
    input && !Array.isArray(input) && Array.isArray(input.losses) ? "losses" : "returns"
  );
  if (!["returns", "losses"].includes(inputType)) {
    throw new RangeError("inputType must be returns or losses");
  }
  const values = source.map((item, index) => {
    if (typeof item === "number") return assertFiniteNumber(item, "values[" + index + "]");
    if (Array.isArray(item)) return assertFiniteNumber(Number(item[1]), "values[" + index + "]");
    return pickNumber(item, inputType === "losses" ? ["loss", "value"] : ["return", "rate", "value"], "values[" + index + "]");
  });
  const losses = inputType === "returns" ? values.map((value) => -value) : values.slice();
  const confidenceLevel = Number(options.confidenceLevel ?? options.beta ?? 0.95);
  if (!(confidenceLevel > 0 && confidenceLevel < 1)) {
    throw new RangeError("confidenceLevel must be between zero and one");
  }
  const ordered = losses.slice().sort((a, b) => a - b);
  const orderStatistic = Math.max(1, Math.ceil(confidenceLevel * ordered.length));
  const index = orderStatistic - 1;
  const valueAtRisk = ordered[index];
  const tolerance = Math.max(1, Math.abs(valueAtRisk)) * Number.EPSILON * 8;
  const tailLosses = ordered.filter((loss) => loss >= valueAtRisk - tolerance);
  const conditionalValueAtRisk = average(tailLosses);
  return resultWithAudit({
    value: conditionalValueAtRisk,
    var: valueAtRisk,
    cvar: conditionalValueAtRisk,
    valueAtRisk,
    conditionalValueAtRisk,
    confidenceLevel,
    observationCount: ordered.length,
    orderStatistic,
    zeroBasedIndex: index,
    tailObservationCount: tailLosses.length,
    tailLosses,
    inputType,
    lossSignConvention: "L = -return; positive = loss",
    method: "empirical inverse CDF using ceil(beta*n), then mean of observed losses L >= VaR",
    limitation: "Finite-sample historical estimate; tail size can be small and tied VaR observations are all retained.",
  }, "EMPIRICAL_VAR_CVAR_V3", { losses, confidenceLevel }, options);
}

function validateSquareMatrix(matrix, name) {
  const label = name || "matrix";
  if (!Array.isArray(matrix) || !matrix.length) {
    throw new TypeError(label + " must be a non-empty square matrix");
  }
  const size = matrix.length;
  const copy = matrix.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== size) {
      throw new TypeError(label + " must be a square matrix");
    }
    return row.map((value, columnIndex) => assertFiniteNumber(
      Number(value),
      label + "[" + rowIndex + "][" + columnIndex + "]"
    ));
  });
  for (let row = 0; row < size; row += 1) {
    for (let column = row + 1; column < size; column += 1) {
      const scale = Math.max(
        Math.abs(copy[row][column]),
        Math.abs(copy[column][row]),
        Number.EPSILON
      );
      if (Math.abs(copy[row][column] - copy[column][row]) > scale * 1e-10) {
        throw new RangeError(label + " must be symmetric");
      }
    }
    if (copy[row][row] < -Number.EPSILON) {
      throw new RangeError(label + " diagonal cannot contain negative variances");
    }
  }
  return copy;
}

function symmetrize(matrix) {
  return matrix.map((row, i) => row.map((value, j) => (value + matrix[j][i]) / 2));
}

// Symmetric eigendecomposition using Jacobi rotations. Eigenvectors are stored
// by column: vectors[row][component].
function jacobiEigenInternal(input, relativeTolerance = 1e-14, maxIterations) {
  const matrix = symmetrize(input);
  const size = matrix.length;
  const vectors = Array.from(
    { length: size },
    (_, row) => Array.from({ length: size }, (__, column) => row === column ? 1 : 0)
  );
  const scale = Math.max(
    ...matrix.flat().map(Math.abs),
    Number.EPSILON
  );
  const tolerance = relativeTolerance * scale;
  const limit = maxIterations || Math.max(64, size * size * 100);
  let iterations = 0;
  for (; iterations < limit; iterations += 1) {
    let p = 0;
    let q = 0;
    let largest = 0;
    for (let row = 0; row < size - 1; row += 1) {
      for (let column = row + 1; column < size; column += 1) {
        const magnitude = Math.abs(matrix[row][column]);
        if (magnitude > largest) {
          largest = magnitude;
          p = row;
          q = column;
        }
      }
    }
    if (largest <= tolerance) break;

    const app = matrix[p][p];
    const aqq = matrix[q][q];
    const apq = matrix[p][q];
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    for (let index = 0; index < size; index += 1) {
      if (index === p || index === q) continue;
      const aip = matrix[index][p];
      const aiq = matrix[index][q];
      const newIp = cosine * aip - sine * aiq;
      const newIq = sine * aip + cosine * aiq;
      matrix[index][p] = newIp;
      matrix[p][index] = newIp;
      matrix[index][q] = newIq;
      matrix[q][index] = newIq;
    }
    matrix[p][p] = cosine * cosine * app
      - 2 * sine * cosine * apq
      + sine * sine * aqq;
    matrix[q][q] = sine * sine * app
      + 2 * sine * cosine * apq
      + cosine * cosine * aqq;
    matrix[p][q] = 0;
    matrix[q][p] = 0;

    for (let row = 0; row < size; row += 1) {
      const vip = vectors[row][p];
      const viq = vectors[row][q];
      vectors[row][p] = cosine * vip - sine * viq;
      vectors[row][q] = sine * vip + cosine * viq;
    }
  }

  const components = Array.from({ length: size }, (_, index) => ({
    value: matrix[index][index],
    vector: vectors.map((row) => row[index]),
  })).sort((a, b) => b.value - a.value);
  return {
    values: components.map((component) => component.value),
    vectors: Array.from(
      { length: size },
      (_, row) => components.map((component) => component.vector[row])
    ),
    iterations,
    converged: iterations < limit,
  };
}

function reconstructFromEigen(values, vectors) {
  const size = values.length;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let component = 0; component < size; component += 1) {
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        matrix[row][column] += vectors[row][component]
          * values[component]
          * vectors[column][component];
      }
    }
  }
  return symmetrize(matrix);
}

function verifyPositiveSemidefinite(matrix, options = {}) {
  const validated = validateSquareMatrix(matrix, "covariance");
  const relativeTolerance = Number(options.relativeTolerance ?? 1e-10);
  if (!(relativeTolerance >= 0)) throw new RangeError("relativeTolerance must be non-negative");
  const eigen = jacobiEigenInternal(validated);
  const scale = Math.max(...validated.map((row, index) => Math.abs(row[index])), Number.EPSILON);
  const tolerance = relativeTolerance * scale;
  const minEigenvalue = Math.min(...eigen.values);
  const isPSD = minEigenvalue >= -tolerance;
  return resultWithAudit({
    value: isPSD,
    isPSD,
    minEigenvalue,
    maxEigenvalue: Math.max(...eigen.values),
    eigenvalues: eigen.values,
    relativeTolerance,
    absoluteTolerance: tolerance,
    converged: eigen.converged,
  }, "PSD_EIGENVALUE_CHECK_V3", { matrix: validated, relativeTolerance }, options);
}

function repairCovariancePSD(matrix, options = {}) {
  const validated = validateSquareMatrix(matrix, "covariance");
  const before = verifyPositiveSemidefinite(validated, options);
  const scale = Math.max(...validated.map((row, index) => Math.abs(row[index])), Number.EPSILON);
  const eigenFloor = Number(options.eigenvalueFloor ?? 0);
  if (!(eigenFloor >= 0)) throw new RangeError("eigenvalueFloor must be non-negative");
  const absoluteFloor = eigenFloor * scale;
  const eigen = jacobiEigenInternal(validated);
  const clipped = eigen.values.map((value) => Math.max(value, absoluteFloor));
  let covariance = reconstructFromEigen(clipped, eigen.vectors);
  covariance = covariance.map((row, i) => row.map((value, j) => {
    if (i === j && value < 0 && Math.abs(value) <= scale * 1e-12) return 0;
    return value;
  }));
  let after = verifyPositiveSemidefinite(covariance, options);
  if (!after.isPSD) {
    const jitter = Math.abs(after.minEigenvalue) + scale * 1e-12;
    covariance = covariance.map((row, i) => row.map((value, j) => (
      i === j ? value + jitter : value
    )));
    after = verifyPositiveSemidefinite(covariance, options);
  }
  const repaired = !before.isPSD || eigen.values.some((value) => value < absoluteFloor);
  return resultWithAudit({
    value: covariance,
    covariance,
    repaired,
    method: "symmetric eigendecomposition with negative eigenvalue clipping",
    eigenvalueFloorRelativeToMaxVariance: eigenFloor,
    eigenvaluesBefore: eigen.values,
    eigenvaluesAfter: after.eigenvalues,
    minEigenvalueBefore: before.minEigenvalue,
    minEigenvalueAfter: after.minEigenvalue,
    isPSDAfter: after.isPSD,
  }, "COVARIANCE_PSD_REPAIR_V3", { matrix: validated, eigenFloor }, options, {
    reasonCodes: repaired ? ["COVARIANCE_PSD_REPAIRED"] : [],
  });
}

function covarianceToCorrelationInternal(covariance) {
  return covariance.map((row, i) => row.map((value, j) => {
    const denominator = Math.sqrt(Math.max(covariance[i][i], 0))
      * Math.sqrt(Math.max(covariance[j][j], 0));
    if (!(denominator > 0)) return null;
    const correlation = value / denominator;
    return Math.max(-1, Math.min(1, correlation));
  }));
}

function calculateCorrelationMatrix(covariance, options = {}) {
  const validated = validateSquareMatrix(covariance, "covariance");
  const correlation = covarianceToCorrelationInternal(validated);
  return resultWithAudit({
    value: correlation,
    correlation,
    undefinedEntries: correlation.reduce(
      (count, row) => count + row.filter((value) => value === null).length,
      0
    ),
    limitation: "Correlation is undefined when either variance is zero; those entries are null.",
  }, "CORRELATION_FROM_COVARIANCE_V3", { covariance: validated }, options);
}

function shrinkCovariance(matrix, options = {}) {
  const covariance = validateSquareMatrix(matrix, "covariance");
  const size = covariance.length;
  const observationCount = Number(options.observationCount ?? Math.max(size, 2));
  assertPositiveNumber(observationCount, "observationCount");
  let intensity;
  let intensityMethod;
  if (options.intensity !== undefined) {
    intensity = Number(options.intensity);
    if (!(intensity >= 0 && intensity <= 1)) {
      throw new RangeError("shrinkage intensity must be between zero and one");
    }
    intensityMethod = "caller supplied";
  } else {
    intensity = Math.min(0.6, Math.max(0.05, 0.1 + size / (2 * observationCount)));
    intensityMethod = "transparent heuristic clamp(0.1 + assets / (2 * observations), 0.05, 0.6)";
  }

  let sumCorrelation = 0;
  let correlationCount = 0;
  for (let row = 0; row < size - 1; row += 1) {
    for (let column = row + 1; column < size; column += 1) {
      const denominator = Math.sqrt(Math.max(covariance[row][row] * covariance[column][column], 0));
      if (denominator > 0) {
        sumCorrelation += covariance[row][column] / denominator;
        correlationCount += 1;
      }
    }
  }
  const rawAverageCorrelation = correlationCount ? sumCorrelation / correlationCount : 0;
  const minimumValidCorrelation = size > 1 ? -1 / (size - 1) : 0;
  const averageCorrelation = Math.max(
    minimumValidCorrelation,
    Math.min(1, rawAverageCorrelation)
  );
  const target = covariance.map((row, i) => row.map((value, j) => (
    i === j
      ? covariance[i][i]
      : averageCorrelation * Math.sqrt(Math.max(covariance[i][i] * covariance[j][j], 0))
  )));
  const shrunk = covariance.map((row, i) => row.map((value, j) => (
    (1 - intensity) * value + intensity * target[i][j]
  )));
  return resultWithAudit({
    value: shrunk,
    covariance: shrunk,
    sampleCovariance: covariance,
    target,
    method: "constant-correlation shrinkage",
    intensity,
    intensityMethod,
    averageCorrelation,
    rawAverageCorrelation,
    observationCount,
  }, "CONSTANT_CORRELATION_SHRINKAGE_V3", {
    covariance,
    observationCount,
    intensity,
  }, options);
}

function normalizeDatedReturnsBySymbol(input) {
  const grouped = {};
  if (Array.isArray(input)) {
    input.forEach((row, index) => {
      if (!row || typeof row !== "object") throw new TypeError("returns[" + index + "] must be an object");
      const symbol = String(row.symbol ?? row.fundId ?? row.assetId ?? "");
      if (!symbol) throw new TypeError("returns[" + index + "].symbol is required");
      if (!grouped[symbol]) grouped[symbol] = [];
      grouped[symbol].push(row);
    });
  } else if (input && typeof input === "object") {
    for (const [symbol, series] of Object.entries(input)) grouped[symbol] = series;
  } else {
    throw new TypeError("returnsBySymbol must be an object or long-form array");
  }

  const maps = {};
  for (const [symbol, source] of Object.entries(grouped)) {
    if (!Array.isArray(source)) throw new TypeError("returnsBySymbol." + symbol + " must be an array");
    const map = new Map();
    source.forEach((item, index) => {
      let date;
      let value;
      if (Array.isArray(item)) {
        date = isoDate(item[0], symbol + "[" + index + "].date");
        value = assertFiniteNumber(Number(item[1]), symbol + "[" + index + "].return");
      } else if (item && typeof item === "object") {
        date = isoDate(item.date ?? item.asOf ?? item.valuationDate, symbol + "[" + index + "].date");
        value = pickNumber(item, ["return", "rate", "value"], symbol + "[" + index + "].return");
      } else {
        throw new TypeError(symbol + "[" + index + "] must contain a date and return");
      }
      if (map.has(date)) throw new RangeError(symbol + " contains duplicate return date " + date);
      map.set(date, value);
    });
    maps[symbol] = map;
  }
  return maps;
}

function intersectDates(symbols, maps) {
  if (!symbols.length) return [];
  let dates = [...maps[symbols[0]].keys()];
  for (let index = 1; index < symbols.length; index += 1) {
    const available = maps[symbols[index]];
    dates = dates.filter((date) => available.has(date));
  }
  return dates.sort((a, b) => parseDate(a) - parseDate(b));
}

function sampleCovarianceMatrix(aligned) {
  const count = aligned[0].length;
  const means = aligned.map(average);
  return aligned.map((row, i) => aligned.map((column, j) => {
    let total = 0;
    for (let index = 0; index < count; index += 1) {
      total += (row[index] - means[i]) * (column[index] - means[j]);
    }
    return total / (count - 1);
  }));
}

function calculateCovarianceAndCorrelation(input, options = {}) {
  const maps = normalizeDatedReturnsBySymbol(input);
  const requestedSymbols = Array.isArray(options.symbols)
    ? options.symbols.map(String)
    : Object.keys(maps);
  const minObservations = Math.max(2, Math.floor(Number(options.minObservations ?? 2)));
  const excluded = [];
  let symbols = requestedSymbols.filter((symbol) => {
    if (!maps[symbol]) {
      excluded.push({ symbol, reason: "SYMBOL_NOT_SUPPLIED", availableObservations: 0 });
      return false;
    }
    if (maps[symbol].size < minObservations) {
      excluded.push({
        symbol,
        reason: "INSUFFICIENT_HISTORY",
        availableObservations: maps[symbol].size,
        requiredObservations: minObservations,
      });
      return false;
    }
    return true;
  });
  if (!symbols.length) throw new RangeError("no symbol has sufficient dated return history");

  let commonDates = intersectDates(symbols, maps);
  while (symbols.length > 1 && commonDates.length < minObservations) {
    const candidates = symbols.map((symbol, index) => {
      const remaining = symbols.filter((candidate) => candidate !== symbol);
      return {
        symbol,
        index,
        commonCountAfterRemoval: intersectDates(remaining, maps).length,
        availableObservations: maps[symbol].size,
      };
    }).sort((a, b) => (
      b.commonCountAfterRemoval - a.commonCountAfterRemoval
      || a.availableObservations - b.availableObservations
      || b.index - a.index
    ));
    const removed = candidates[0];
    symbols = symbols.filter((symbol) => symbol !== removed.symbol);
    excluded.push({
      symbol: removed.symbol,
      reason: "INSUFFICIENT_COMMON_DATES",
      availableObservations: removed.availableObservations,
      commonObservationsBeforeExclusion: commonDates.length,
      requiredObservations: minObservations,
    });
    commonDates = intersectDates(symbols, maps);
  }
  if (commonDates.length < minObservations) {
    throw new RangeError("insufficient actual common valuation dates after exclusions");
  }

  const aligned = symbols.map((symbol) => commonDates.map((date) => maps[symbol].get(date)));
  const periodicSampleCovariance = sampleCovarianceMatrix(aligned);
  let frequency;
  if (options.periodsPerYear != null) frequency = resolveFrequency(Number(options.periodsPerYear));
  else if (options.frequency != null) frequency = resolveFrequency(options.frequency);
  else frequency = inferFrequency(commonDates, options);
  const annualizationMultiplier = options.annualize === false ? 1 : frequency.periodsPerYear;
  const sampleCovariance = periodicSampleCovariance.map((row) => row.map(
    (value) => value * annualizationMultiplier
  ));

  let shrinkage;
  if (options.shrinkage === false) {
    shrinkage = {
      covariance: sampleCovariance.map((row) => row.slice()),
      target: null,
      method: "none",
      intensity: 0,
      intensityMethod: "disabled by caller",
      averageCorrelation: null,
      observationCount: commonDates.length,
    };
  } else {
    const shrinkageOptions = {
      ...options,
      observationCount: commonDates.length,
      intensity: options.shrinkageIntensity ?? options.intensity,
    };
    if (shrinkageOptions.intensity === undefined) delete shrinkageOptions.intensity;
    shrinkage = shrinkCovariance(sampleCovariance, shrinkageOptions);
  }
  const psdBefore = verifyPositiveSemidefinite(shrinkage.covariance, options);
  let covariance = shrinkage.covariance;
  let psdRepair = null;
  if (!psdBefore.isPSD) {
    if (options.repairPSD === false) {
      throw new RangeError("covariance is not positive semidefinite and PSD repair is disabled");
    }
    psdRepair = repairCovariancePSD(covariance, options);
    covariance = psdRepair.covariance;
  }
  const psdAfter = verifyPositiveSemidefinite(covariance, options);
  const correlation = covarianceToCorrelationInternal(covariance);
  const sampleCorrelation = covarianceToCorrelationInternal(sampleCovariance);
  const observationCounts = symbols.map(() => symbols.map(() => commonDates.length));
  const asOf = commonDates[commonDates.length - 1];
  const reasonCodes = [];
  if (excluded.length) reasonCodes.push("INSUFFICIENT_HISTORY_EXCLUDED");
  if (psdRepair && psdRepair.repaired) reasonCodes.push("COVARIANCE_PSD_REPAIRED");
  return resultWithAudit({
    value: covariance,
    symbols,
    requestedSymbols,
    excluded,
    excludedSymbols: excluded.map((item) => item.symbol),
    commonDates,
    observationCount: commonDates.length,
    observationCounts,
    alignment: "listwise intersection of actual valuation dates; no forward-filled returns",
    periodicSampleCovariance,
    sampleCovariance,
    covariance,
    sampleCorrelation,
    correlation,
    annualized: options.annualize !== false,
    covarianceUnit: options.annualize === false ? "periodic return squared" : "annualized return squared",
    frequency: frequency.frequency,
    periodsPerYear: frequency.periodsPerYear,
    shrinkage: {
      method: shrinkage.method,
      intensity: shrinkage.intensity,
      intensityMethod: shrinkage.intensityMethod,
      averageCorrelation: shrinkage.averageCorrelation,
      target: shrinkage.target,
    },
    psd: {
      beforeRepair: psdBefore.isPSD,
      afterRepair: psdAfter.isPSD,
      minEigenvalueBefore: psdBefore.minEigenvalue,
      minEigenvalueAfter: psdAfter.minEigenvalue,
      repaired: Boolean(psdRepair && psdRepair.repaired),
    },
    startDate: commonDates[0],
    endDate: asOf,
  }, "DATED_COVARIANCE_CORRELATION_V3", {
    symbols,
    commonDates,
    aligned,
    minObservations,
    annualizationMultiplier,
    shrinkageIntensity: shrinkage.intensity,
  }, options, {
    asOf,
    period: commonDates[0] + "/" + asOf,
    reasonCodes,
  });
}

function normalizeWeights(weights, symbols) {
  let labels;
  let values;
  if (Array.isArray(weights)) {
    values = weights.map((value, index) => assertFiniteNumber(Number(value), "weights[" + index + "]"));
    labels = symbols || values.map((_, index) => String(index));
  } else if (weights && typeof weights === "object") {
    labels = symbols || Object.keys(weights);
    values = labels.map((symbol) => assertFiniteNumber(Number(weights[symbol] ?? 0), "weights." + symbol));
  } else {
    throw new TypeError("weights must be an array or object");
  }
  if (!Array.isArray(labels) || labels.length !== values.length) {
    throw new RangeError("symbols must match the number of weights");
  }
  if (values.some((value) => value < 0)) {
    throw new RangeError("effective holdings requires non-negative weights");
  }
  const sum = values.reduce((total, value) => total + value, 0);
  if (!(sum > 0)) throw new RangeError("weights must have a positive sum");
  return {
    symbols: labels.map(String),
    originalWeights: values,
    normalizedWeights: values.map((value) => value / sum),
    originalWeightSum: sum,
  };
}

function groupHoldingsByMasterFund(holdings, options = {}) {
  if (!Array.isArray(holdings) || !holdings.length) {
    throw new RangeError("holdings are required");
  }
  const grouped = new Map();
  holdings.forEach((holding, index) => {
    if (!holding || typeof holding !== "object") {
      throw new TypeError("holdings[" + index + "] must be an object");
    }
    const fundId = String(holding.fundId ?? holding.shareClassId ?? holding.symbol ?? "");
    const masterFundId = String(holding.masterFundId ?? holding.masterId ?? fundId);
    if (!fundId) throw new TypeError("holdings[" + index + "].fundId is required");
    if (!masterFundId) throw new TypeError("holdings[" + index + "].masterFundId is required");
    const weight = pickNumber(holding, ["weight", "portfolioWeight", "value"], "holdings[" + index + "].weight");
    if (weight < 0) throw new RangeError("holding weights must be non-negative");
    const prior = grouped.get(masterFundId) || {
      masterFundId,
      weight: 0,
      shareClassIds: [],
    };
    prior.weight += weight;
    prior.shareClassIds.push(fundId);
    grouped.set(masterFundId, prior);
  });
  const groups = [...grouped.values()];
  return resultWithAudit({
    value: groups,
    groups,
    masterFundCount: groups.length,
    shareClassCount: holdings.length,
    groupedShareClassCount: holdings.length - groups.length,
    formula: "sum share-class weights by masterFundId before concentration measurement",
  }, "MASTER_FUND_WEIGHT_GROUPING_V3", { holdings }, options, {
    reasonCodes: holdings.length > groups.length ? ["SHARE_CLASSES_GROUPED_BY_MASTER_FUND"] : [],
  });
}

function calculateEffectiveHoldings(weights, options = {}) {
  let grouping = null;
  let governedWeights = weights;
  let governedOptions = options;
  if (
    Array.isArray(weights)
    && weights.length
    && weights[0]
    && typeof weights[0] === "object"
    && !Array.isArray(weights[0])
  ) {
    grouping = groupHoldingsByMasterFund(weights, options);
    governedWeights = Object.fromEntries(
      grouping.groups.map((group) => [group.masterFundId, group.weight])
    );
    governedOptions = { ...options, symbols: grouping.groups.map((group) => group.masterFundId) };
  }
  const normalized = normalizeWeights(governedWeights, governedOptions.symbols);
  const concentration = normalized.normalizedWeights.reduce(
    (total, weight) => total + weight * weight,
    0
  );
  const effectiveHoldings = 1 / concentration;
  return resultWithAudit({
    value: effectiveHoldings,
    effectiveHoldings,
    concentration,
    symbols: normalized.symbols,
    normalizedWeights: normalized.normalizedWeights,
    originalWeightSum: normalized.originalWeightSum,
    groupedByMasterFund: Boolean(grouping),
    grouping: grouping ? grouping.groups : null,
    formula: "N_weight = 1 / sum(w_i^2)",
    limitation: "Weight concentration only; correlated share classes can still represent the same underlying bet.",
  }, "EFFECTIVE_HOLDINGS_WEIGHT_V3", {
    normalized,
    grouping: grouping ? grouping.groups : null,
  }, options, {
    reasonCodes: grouping ? ["SHARE_CLASSES_GROUPED_BY_MASTER_FUND"] : [],
  });
}

function calculatePcaDiversification(weights, covariance, options = {}) {
  let suppliedWeights = weights;
  let suppliedCovariance = covariance;
  let suppliedOptions = options;
  if (
    weights && typeof weights === "object" && !Array.isArray(weights)
    && weights.weights !== undefined && weights.covariance !== undefined
  ) {
    suppliedWeights = weights.weights;
    suppliedCovariance = weights.covariance;
    suppliedOptions = {
      ...(weights.symbols ? { symbols: weights.symbols } : {}),
      ...(weights.options || {}),
      ...(covariance && !Array.isArray(covariance) ? covariance : {}),
    };
  }
  const validatedCovariance = validateSquareMatrix(suppliedCovariance, "covariance");
  const normalized = normalizeWeights(suppliedWeights, suppliedOptions.symbols);
  if (normalized.normalizedWeights.length !== validatedCovariance.length) {
    throw new RangeError("weights and covariance dimensions must match");
  }
  const psd = verifyPositiveSemidefinite(validatedCovariance, suppliedOptions);
  const repair = psd.isPSD ? null : repairCovariancePSD(validatedCovariance, suppliedOptions);
  const governedCovariance = repair ? repair.covariance : validatedCovariance;
  const eigen = jacobiEigenInternal(governedCovariance);
  const components = eigen.values.map((eigenvalue, component) => {
    let exposure = 0;
    for (let index = 0; index < normalized.normalizedWeights.length; index += 1) {
      exposure += eigen.vectors[index][component] * normalized.normalizedWeights[index];
    }
    const varianceContribution = exposure * exposure * Math.max(eigenvalue, 0);
    return {
      component: component + 1,
      eigenvalue: Math.max(eigenvalue, 0),
      exposure,
      varianceContribution,
    };
  });
  const portfolioVariance = components.reduce(
    (total, component) => total + component.varianceContribution,
    0
  );
  let effectivePcaDimensions = null;
  if (portfolioVariance > EPSILON) {
    let entropy = 0;
    for (const component of components) {
      component.varianceShare = component.varianceContribution / portfolioVariance;
      if (component.varianceShare > EPSILON) {
        entropy -= component.varianceShare * Math.log(component.varianceShare);
      }
    }
    effectivePcaDimensions = Math.exp(entropy);
  } else {
    for (const component of components) component.varianceShare = null;
  }
  return resultWithAudit({
    value: effectivePcaDimensions,
    effectivePcaDimensions,
    status: effectivePcaDimensions == null ? "UNDEFINED_ZERO_VARIANCE" : "CALCULATED",
    symbols: normalized.symbols,
    normalizedWeights: normalized.normalizedWeights,
    portfolioVariance,
    components,
    covarianceRepaired: Boolean(repair && repair.repaired),
    formula: "v_k=(e_k' w)^2 lambda_k; p_k=v_k/(w' Sigma w); N_PCA=exp(-sum(p_k ln p_k))",
    limitation: "PCA dimensions are covariance-model dependent. This does not use entropy of Euler risk contributions, which may be negative.",
  }, "EFFECTIVE_PCA_DIMENSIONS_V3", {
    weights: normalized.normalizedWeights,
    covariance: governedCovariance,
  }, suppliedOptions, {
    reasonCodes: repair && repair.repaired ? ["COVARIANCE_PSD_REPAIRED"] : [],
  });
}

function calculateDiversification(weights, covariance, options = {}) {
  const effectiveHoldings = calculateEffectiveHoldings(weights, options);
  let pcaWeights = weights;
  let pcaOptions = options;
  if (
    Array.isArray(weights)
    && weights.length
    && weights[0]
    && typeof weights[0] === "object"
    && !Array.isArray(weights[0])
  ) {
    const grouped = groupHoldingsByMasterFund(weights, options);
    pcaWeights = Object.fromEntries(
      grouped.groups.map((group) => [group.masterFundId, group.weight])
    );
    pcaOptions = { ...options, symbols: grouped.groups.map((group) => group.masterFundId) };
  }
  const pca = calculatePcaDiversification(pcaWeights, covariance, pcaOptions);
  return resultWithAudit({
    value: {
      effectiveHoldings: effectiveHoldings.value,
      effectivePcaDimensions: pca.value,
    },
    effectiveHoldings,
    pca,
    warning: "Different share classes of one master fund must be grouped before these weights are supplied.",
  }, "DIVERSIFICATION_SUMMARY_V3", { weights, covariance }, options);
}

function calculatePerformance(input, options = {}) {
  if (!input || typeof input !== "object") throw new TypeError("performance input is required");
  const returnsInput = input.returns || input.series || input.observations;
  const metricOptions = {
    ...options,
    frequency: options.frequency ?? input.frequency,
    periodsPerYear: options.periodsPerYear ?? input.periodsPerYear,
    riskFreeRate: options.riskFreeRate ?? input.riskFreeRate ?? 0,
    minimumAcceptableReturn: options.minimumAcceptableReturn
      ?? input.minimumAcceptableReturn
      ?? 0,
    confidenceLevel: options.confidenceLevel ?? input.confidenceLevel ?? 0.95,
  };
  if (metricOptions.frequency == null) delete metricOptions.frequency;
  if (metricOptions.periodsPerYear == null) delete metricOptions.periodsPerYear;
  const series = normalizeReturnSeries(returnsInput, metricOptions);
  const frequency = frequencyForSeries(series, metricOptions);
  const completeOptions = {
    ...metricOptions,
    periodsPerYear: frequency.periodsPerYear,
  };
  const growthFactor = compoundGrowth(series.values);
  const periodReturn = growthFactor - 1;
  const annualizedGeometricReturn = growthFactor > 0
    ? growthFactor ** (frequency.periodsPerYear / series.values.length) - 1
    : -1;
  const volatility = calculateAnnualizedVolatility(returnsInput, completeOptions);
  const drawdown = calculateDrawdownSeries(returnsInput, completeOptions);
  const downsideDeviation = calculateDownsideDeviation(returnsInput, completeOptions);
  const sharpe = calculateSharpeRatio(returnsInput, completeOptions);
  const sortino = calculateSortinoRatio(returnsInput, completeOptions);
  const calmar = calculateCalmarRatio({
    cagr: annualizedGeometricReturn,
    maxDrawdown: drawdown.maxDrawdown,
  }, completeOptions);
  const historicalRisk = calculateHistoricalVaRCVaR(returnsInput, {
    ...completeOptions,
    inputType: "returns",
  });

  let twr = null;
  if (input.twrInput || input.valuations) {
    twr = calculateTWR(input.twrInput || {
      valuations: input.valuations,
      cashFlows: input.portfolioCashFlows || input.cashFlows || [],
    }, completeOptions);
  }
  let xirr = null;
  if (input.xirrCashFlows) xirr = calculateXIRR(input.xirrCashFlows, completeOptions);
  let cagrNoFlows = null;
  if (input.cagrNoFlowsInput) {
    cagrNoFlows = calculateCAGRNoFlows(input.cagrNoFlowsInput, completeOptions);
  } else if (Array.isArray(input.valuations) && input.valuations.length >= 2) {
    const candidateFlows = input.portfolioCashFlows || input.cashFlows || [];
    const portfolioFlows = Array.isArray(candidateFlows) ? candidateFlows : [];
    const embeddedFlowExists = input.valuations.some((valuation) => Math.abs(Number(
      valuation.externalFlow ?? valuation.cashFlow ?? valuation.netFlow ?? 0
    )) > EPSILON);
    const separateFlowExists = portfolioFlows.some((flow) => Math.abs(Number(
      flow.amount ?? flow.cashFlow ?? flow.externalFlow ?? flow
    )) > EPSILON);
    if (!embeddedFlowExists && !separateFlowExists) {
      const valuations = normalizeDatedObservations(
        input.valuations,
        ["value", "portfolioValue", "marketValue"],
        "valuations"
      );
      cagrNoFlows = calculateCAGRNoFlows({
        startValue: valuations[0].value,
        endValue: valuations[valuations.length - 1].value,
        startDate: valuations[0].date,
        endDate: valuations[valuations.length - 1].date,
      }, completeOptions);
    }
  }

  const returnType = input.returnType || "UNSPECIFIED_RETURN";
  const rawNav = returnType === "NAV_RETURN";
  const adjustedNav = returnType === "ADJUSTED_NAV_RETURN";
  const startDate = series.dates[0] || null;
  const endDate = series.dates.at(-1) || null;
  return resultWithAudit({
    value: periodReturn,
    periodReturn,
    growthFactor,
    annualizedGeometricReturn,
    returnType,
    returnLabel: rawNav
      ? "NAV return"
      : (adjustedNav ? "Adjusted NAV return" : "Return type not supplied"),
    isTotalReturn: adjustedNav,
    warnings: rawNav
      ? ["Raw NAV return is not labelled total return; distributions may be missing."]
      : (adjustedNav ? [] : ["Return type was not supplied; do not describe it as total return."]),
    observationCount: series.values.length,
    startDate,
    endDate,
    frequency: frequency.frequency,
    periodsPerYear: frequency.periodsPerYear,
    twr,
    xirr,
    cagrNoFlows,
    volatility,
    drawdown,
    downsideDeviation,
    sharpe,
    sortino,
    calmar,
    historicalRisk,
  }, "PORTFOLIO_PERFORMANCE_COMPOSITION_V3", {
    series,
    returnType,
    frequency,
    metricInputs: {
      riskFreeRate: completeOptions.riskFreeRate,
      minimumAcceptableReturn: completeOptions.minimumAcceptableReturn,
      confidenceLevel: completeOptions.confidenceLevel,
    },
  }, completeOptions, {
    asOf: endDate,
    period: startDate && endDate ? startDate + "/" + endDate : null,
    reasonCodes: rawNav ? ["RAW_NAV_NOT_TOTAL_RETURN"] : [],
  });
}

module.exports = {
  deriveNavReturns,
  calculateNavReturns: deriveNavReturns,
  calculateTWR,
  calculateXIRR,
  calculateCAGRNoFlows,
  inferFrequency,
  calculateAnnualizedVolatility,
  annualizedVolatility: calculateAnnualizedVolatility,
  calculateDrawdownSeries,
  calculateMaxDrawdown: calculateDrawdownSeries,
  calculateDownsideDeviation,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateCalmarRatio,
  calculateHistoricalVaRCVaR,
  calculateVaRCVaR: calculateHistoricalVaRCVaR,
  calculateCovarianceAndCorrelation,
  calculateDatedCovariance: calculateCovarianceAndCorrelation,
  calculateCorrelationMatrix,
  shrinkCovariance,
  verifyPositiveSemidefinite,
  verifyPSD: verifyPositiveSemidefinite,
  repairCovariancePSD,
  groupHoldingsByMasterFund,
  calculateEffectiveHoldings,
  calculatePcaDiversification,
  calculateDiversification,
  calculatePerformance,
};

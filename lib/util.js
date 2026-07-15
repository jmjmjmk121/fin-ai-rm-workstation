function seededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pct(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function sum(values) {
  return values.reduce((acc, item) => acc + item, 0);
}

function dot(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i] * b[i];
  return total;
}

function matrixVector(matrix, vector) {
  return matrix.map((row) => dot(row, vector));
}

function normalize(weights) {
  const total = Object.values(weights).reduce((acc, value) => acc + Math.max(0, value), 0) || 1;
  const result = {};
  for (const [key, value] of Object.entries(weights)) result[key] = Math.max(0, value) / total;
  return result;
}

function average(values) {
  return values.length ? sum(values) / values.length : 0;
}

module.exports = { seededRandom, mulberry32, clamp, pct, sum, dot, matrixVector, normalize, average };

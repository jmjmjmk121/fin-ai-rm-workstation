'use strict';

const $ = (selector) => document.querySelector(selector);

function pct(value, digits = 2) { return `${(Number(value) * 100).toFixed(digits)}%`; }

async function loadFrontier(clientId) {
  try {
    const response = await fetch(`/api/frontier?clientId=${encodeURIComponent(clientId)}`);
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.json();
  } catch (_error) {
    const response = await fetch('./demo-data.json');
    if (!response.ok) throw new Error('เปิดข้อมูล technical appendix ไม่สำเร็จ');
    const demo = await response.json();
    return demo.frontier[clientId] || demo.frontier.global;
  }
}

function point(ctx, x, y, radius, fill) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
}

function draw(data) {
  const canvas = $('#frontierChart');
  const cssWidth = Math.max(540, canvas.clientWidth || 980);
  const cssHeight = Math.max(360, canvas.clientHeight || 470);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio); canvas.height = Math.round(cssHeight * ratio);
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  const margin = { left: 72, right: 28, top: 27, bottom: 58 };
  const all = [...data.cloud, ...data.frontier, ...data.models];
  if (data.client?.current) all.push(data.client.current);
  if (data.client?.caseStudyModel) all.push(data.client.caseStudyModel);
  const maxX = Math.ceil(Math.max(...all.map((p) => p.volatility)) * 1.12 * 100) / 100;
  const maxY = Math.ceil(Math.max(...all.map((p) => p.expectedReturn)) * 1.12 * 100) / 100;
  const x = (value) => margin.left + (value / maxX) * (cssWidth - margin.left - margin.right);
  const y = (value) => cssHeight - margin.bottom - (value / maxY) * (cssHeight - margin.top - margin.bottom);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#687188'; ctx.strokeStyle = '#e2e6ed'; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i += 1) {
    const xv = maxX * i / 5; const yv = maxY * i / 5;
    ctx.beginPath(); ctx.moveTo(x(xv), margin.top); ctx.lineTo(x(xv), cssHeight - margin.bottom); ctx.stroke();
    ctx.fillText(pct(xv, 0), x(xv) - 10, cssHeight - 34);
    ctx.beginPath(); ctx.moveTo(margin.left, y(yv)); ctx.lineTo(cssWidth - margin.right, y(yv)); ctx.stroke();
    ctx.fillText(pct(yv, 1), 18, y(yv) + 4);
  }
  ctx.fillStyle = '#465169'; ctx.fillText('ความผันผวนต่อปี (annualized volatility)', cssWidth / 2 - 105, cssHeight - 11);
  ctx.save(); ctx.translate(15, cssHeight / 2 + 90); ctx.rotate(-Math.PI / 2); ctx.fillText('ผลตอบแทนคาดหมายต่อปี', 0, 0); ctx.restore();
  for (const p of data.cloud) point(ctx, x(p.volatility), y(p.expectedReturn), 1.8, 'rgba(110,121,143,.25)');
  ctx.strokeStyle = '#ef7622'; ctx.lineWidth = 3; ctx.beginPath();
  data.frontier.forEach((p, index) => index ? ctx.lineTo(x(p.volatility), y(p.expectedReturn)) : ctx.moveTo(x(p.volatility), y(p.expectedReturn)));
  ctx.stroke();
  for (const model of data.models) point(ctx, x(model.volatility), y(model.expectedReturn), 4.5, '#315ea8');
  if (data.client?.current) point(ctx, x(data.client.current.volatility), y(data.client.current.expectedReturn), 6, '#b23b3b');
  if (data.client?.caseStudyModel) point(ctx, x(data.client.caseStudyModel.volatility), y(data.client.caseStudyModel.expectedReturn), 6, '#17745a');

  const gmv = data.globalMinimumVariance;
  const current = data.client?.current;
  const model = data.client?.caseStudyModel;
  $('#frontierFacts').innerHTML = [
    ['Global minimum variance', `${pct(gmv.expectedReturn)} return · ${pct(gmv.volatility)} vol`],
    ['พอร์ตปัจจุบัน', current ? `${pct(current.expectedReturn)} return · ${pct(current.volatility)} vol` : 'ไม่ได้เลือกลูกค้า'],
    ['กรอบหลายเป้าหมายสาธิต', model ? `${pct(model.expectedReturn)} return · ${pct(model.volatility)} vol` : 'ไม่ได้เลือกลูกค้า'],
  ].map(([label, value]) => `<div class="fact"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

async function refresh() { draw(await loadFrontier($('#clientSelect').value)); }
$('#clientSelect').addEventListener('change', refresh);
window.addEventListener('resize', () => { clearTimeout(refresh.timer); refresh.timer = setTimeout(refresh, 120); });
refresh().catch((error) => { $('#frontierFacts').textContent = error.message; });

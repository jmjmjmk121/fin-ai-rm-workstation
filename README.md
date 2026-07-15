# FIN AI RM Workstation v9 — Phase 0 + SETSMART Live/P&L patch

เว็บภาษาไทยสำหรับ Relationship Manager ที่เชื่อมเคสที่ต้องดูแล เป้าหมายลูกค้า พอร์ต Thai mutual funds หลักฐาน และการตัดสินใจของคนไว้ใน workflow เดียว ระบบใช้ข้อมูลผสม: SETSMART Listed EOD จริงสำหรับ security types ที่ contract และ entitlement ส่งกลับ และ fixture ที่ติดป้ายชัดสำหรับพอร์ตลูกค้า/กองทุนเปิดที่ยังไม่มี API contract

## สถานะและขอบเขตความปลอดภัย

- ข้อมูลลูกค้า พอร์ต กองทุนเปิด เป้าหมาย เหตุการณ์ และผลลัพธ์ยังเป็นข้อมูลสังเคราะห์
- หน้า `เหตุการณ์ตลาด > SETSMART Live` ใช้ Listed-company EOD API จริงจาก backend เป็นคลัง asset แบบ dynamic พร้อมค้นหา กรอง และแบ่งหน้า
- credential ที่เคยเปิดเผยนอกแอปต้องถือว่าใช้ต่อไม่ได้ ต้อง revoke/rotate ก่อนการเชื่อมต่อจริง
- browser เรียก backend ของ FIN AI เท่านั้น และไม่มีทางได้รับ SETSMART key
- listed provider ใช้เฉพาะ endpoint/header/field จาก Company Fundamental Data API Specification V1.0; ไม่อนุมาน mutual-fund endpoint เพิ่ม
- `close` ติดป้าย price return และ `bvps` ใช้เป็น NAV เฉพาะ listed UT/ETF ตาม contract; ไม่เรียก total return
- live-provider boundary รองรับ timeout, bounded retry, rate-limit mapping, TTL cache และ visible stale fallback
- market facts, bank catalogue, bank policy และ fixture facts ใช้ source classes คนละชนิดและห้ามผสมโดยไม่มี field-level provenance
- ไม่มีปุ่ม “อนุมัติ & ส่ง”, auto-send, auto-trade, การแก้ KYC/suitability หรือการข้าม eligibility

รายละเอียดการเชื่อมข้อมูลอยู่ที่ [SETSMART_SETUP.md](SETSMART_SETUP.md) และรายการ policy ที่ยังต้องขอจากธนาคารอยู่ที่ [docs/ASSUMPTIONS_AND_POLICY_INPUTS.md](docs/ASSUMPTIONS_AND_POLICY_INPUTS.md)

## เปิดระบบ

ต้องใช้ Node.js 18 ขึ้นไป ตัวโครงการไม่มี runtime dependency ภายนอก

```bash
npm start
```

เปิด `http://127.0.0.1:4187`

Fixture mode เป็นค่าเริ่มต้น จึงไม่ต้องสร้าง `.env.local` และไม่ต้องมี API key หากต้อง override configuration ให้ copy `.env.example` เป็น `.env.local`; ไฟล์นี้ถูก ignore โดย Git และค่าทั้งหมดในตัวอย่างเป็น placeholder เท่านั้น สำหรับเดโมให้คง:

```text
MUTUAL_FUND_DATA_MODE=fixture
SETSMART_LISTED_DATA_MODE=fixture
```

เมื่อต้องการข้อมูล listed EOD จริง ให้ตั้ง `SETSMART_LISTED_DATA_MODE=live` พร้อม rotated key ฝั่ง server โดยไม่เปลี่ยน `MUTUAL_FUND_DATA_MODE`

รันทดสอบทั้งหมดด้วย package script:

```bash
npm test
```

Regression ปัจจุบันมี 174 tests และต้องผ่านทั้งหมดก่อนเปิดแอปเดโม

สร้าง demo export ของระบบเดิมเมื่อจำเป็นด้วย:

```bash
npm run regen
```

## หน้าใช้งาน

| หน้า | สิ่งที่ RM ใช้ตัดสินใจ |
|---|---|
| `วันนี้` | P0/P1 Care, Growth, เคสข้อมูลไม่ครบ, handoff ล่าช้า, กำลังโทรที่เหลือ และ 5 เคสแรก |
| `ลูกค้า` | ค้นหา Client 360 โดยใช้ชื่อหรือรหัสที่แสดงต่อ RM โดยไม่โชว์ database ID หลัก |
| `เป้าหมาย` | Goal Ledger: เงินสำรอง การศึกษา เกษียณ บ้าน สุขภาพ การเติบโต และมรดก |
| `พอร์ตและการจัดสรร` | รายชื่อลูกค้า 30 ราย → unified client workspace สำหรับ overview, performance, risk, RM Draft, comparison, goal impact และ draft history |
| `เหตุการณ์ตลาด` | SETSMART Live asset universe พร้อมค้นหา/กรอง/แบ่งหน้า และแท็บกองทุน Demo, เหตุการณ์, คุณภาพข้อมูลที่แยก source |
| `คิวและการส่งต่อ` | โทร นัดหมาย ข้อความที่ RM ตรวจแล้ว handoff งานล่าช้า และข้อจำกัดการติดต่อ |
| `ตรวจสอบย้อนหลัง` | เวอร์ชันกติกา/โมเดล, calculation reference และ audit events แบบอ่านอย่างเดียวสำหรับ RM |

หน้า `technical.html` และ API รุ่นเดิมยังคงอยู่เพื่อ regression compatibility ไม่ใช่ workflow หลักของ v3

## Demo end to end

1. กดชื่อ RM มุมขวาบนเพื่อสลับมุมมองข้อมูลสาธิตระหว่าง RM 5 คน; แต่ละคนมีลูกค้า 6 ราย การสลับนี้ไม่ใช่การเปลี่ยนสิทธิ์ login จริง
2. เปิด `วันนี้` และดู P0 Care ก่อน Growth
3. กด `ดูเหตุผล` เพื่ออ่านว่าเกิดอะไรขึ้น ทำไมสำคัญ เป้าหมายใดได้รับผล และเหตุใดเคสถัดไปจึงต่ำกว่า
4. เปิดเคสการศึกษาของลูกค้าและทำตาม 5 ขั้น: เข้าใจ ตรวจข้อมูล เตรียม ตัดสินใจ บันทึก
5. เปิด `พอร์ตและการจัดสรร` แล้วเลือก `ดูและจัดพอร์ต`; URL `/portfolios?clientId=...&workspace=...` เก็บลูกค้าและ sub-workspace ที่เลือก
6. กลับขั้น `เตรียม` เพื่อดูคำถาม 3 ข้อ talking points คำเตือน และเปรียบเทียบทางเลือกที่ eligible ไม่เกิน 3 รายการ
7. กด `อธิบายให้ฉันเข้าใจ` เพื่อดูคำอธิบายกองทุน 60 วินาทีและรายละเอียดค่าธรรมเนียม สภาพคล่อง ความเสี่ยง และแหล่งข้อมูล
8. เลือกอนุมัติร่าง แก้ไข ขอข้อมูลเพิ่ม ส่งต่อผู้เชี่ยวชาญ หรือไม่มีการดำเนินการ
9. ระบุเหตุผล เจ้าของ ผลลัพธ์ และวันทบทวน แล้วบันทึก audit event; การอนุมัติร่างยังไม่ส่งข้อความและไม่ทำรายการ

ถ้าข้อมูลสำคัญขาด ตัวเลือกที่อนุญาตมีเพียง `ขอข้อมูลเพิ่ม/ยืนยันข้อมูล`

## ส่งให้เพื่อนทดลองผ่าน GitHub

ผู้สร้าง repository อัปโหลดไฟล์ทั้งหมดใน source bundle ได้โดยไม่ต้องใส่ `.env.local` จากนั้นผู้ทดลองใช้:

```bash
git clone <repository-url>
cd FIN_AI_RM_Workstation
npm test
npm start
```

เปิด `http://127.0.0.1:4187` ระบบเริ่มใน fixture mode จึงทดลอง UI, RM switcher, ลูกค้า 30 ราย, Portfolio Builder และ Historical Replay ได้โดยไม่ต้องมี API key หากต้องการ SETSMART Live ให้แต่ละคนสร้าง `.env.local` ของตนเองจาก `.env.example`; ห้าม commit หรือส่งต่อ credential จริง

## Backend API v3

| Method | Path | หน้าที่ |
|---|---|---|
| `GET` | `/api/health` | สถานะบริการ, server-side credential configuration และ provider/cache health โดยไม่คืนค่า key |
| `GET` | `/api/v3/bootstrap` | payload เริ่มต้นของ Today, clients, goals, funds, queue, performance และ audit |
| `GET` | `/api/v3/performance` | portfolio series, cash flows, drawdown, allocation, goal attribution และ governed metrics |
| `GET` | `/api/v3/market/setsmart-listed` | SETSMART EOD จริงตาม security type โดย key อยู่เฉพาะ backend |
| `GET` | `/api/v3/market/setsmart-assets` | คลังสินทรัพย์ SETSMART EOD แบบค้นหา/กรอง/แบ่งหน้า; browser รับสูงสุด 200 รายการต่อครั้ง |
| `GET` | `/api/v3/market/setsmart-history/:symbol` | ประวัติราคาตาม symbol และช่วงวันที่จาก endpoint ที่ contract ยืนยัน |
| `GET` | `/api/v3/products` | Product Provider Registry search พร้อม source/as-of และ MISSING/NOT_SUPPORTED สำหรับ field ที่ contract ไม่มี |
| `GET` | `/api/v3/products/:productId` | รายละเอียด market facts ของ product ID ที่ขึ้นต้น `SETSMART:` |
| `GET` | `/api/v3/products/:productId/history` | ประวัติราคาผ่าน Product Provider Registry |
| `GET` | `/api/v3/replay` | ผล historical replay แบบสรุป; ใช้ `?detail=full` สำหรับร่องรอยเต็มของ deterministic walk-forward run |
| `GET` | `/api/v3/actions/:actionId` | Action Card, Client 360, verification, Conversation Coach และ eligible comparison |
| `POST` | `/api/v3/actions/:actionId/decisions` | บันทึก human decision ด้วย idempotency key; response ยืนยัน `sent: false` และ `traded: false` |
| `GET` | `/api/v3/funds/:fundId` | product explanation จากข้อมูล fixture/approved evidence |

API รุ่นเดิมใต้ `/api/workbench`, `/api/frontier`, `/api/analytics/*`, `/api/simulation/*` และ `/api/clients/*` ถูกเก็บไว้เพื่อไม่ทำลายของเดิม

## โครงสร้าง v3

- `lib/v3/mutual-funds.js` — `SetSmartMutualFundAdapter`, fixture, mock, cache และ candidate-universe gates
- `lib/v3/mutual-funds.d.ts` — interface `MutualFundDataProvider` และชนิดข้อมูลที่ backend คาดหวัง
- `lib/v3/product-contracts.js` / `.d.ts` — `ProductSource` และ universal product-fact envelope ที่บังคับ source/as-of/MISSING/NOT_SUPPORTED
- `lib/v3/product-registry.js` / `.d.ts` — provider registry สำหรับค้นหา asset จำนวนมาก ประวัติราคา source lineage และ unsupported bank-policy facts แบบ fail closed
- `lib/v3/setsmart-listed.js` — official-contract SETSMART listed EOD provider สำหรับ security type ที่ entitlement ส่งกลับ พร้อม retry/cache/stale fallback
- `lib/v3/mutual-fund-fixtures.js` — Thai mutual-fund fixtures ที่ deterministic และไม่มีข้อมูลจริง
- `lib/v3/quant.js` — NAV return, TWR, XIRR, no-flow CAGR, volatility, drawdown, Sharpe/Sortino/Calmar, empirical VaR/CVaR, dated covariance และ diversification
- `lib/v3/cockpit.js` — Client 360, Goal Ledger, Care/Growth ordering, contact/data gates, Action Card lifecycle, handoff และ append-only audit
- `lib/v3/application.js` — ประกอบ engine และ provider เป็น payload ที่ UI/API ใช้
- `lib/v3/replay-fixtures.js` — point-in-time fixtures สำหรับ historical replay validation
- `lib/v3/replay.js` — deterministic monthly walk-forward engine, four comparators, stress windows และ result separation
- `lib/v3/controlled-ai.js` — approved-tool allowlist, numeric validation, explanation binding และ human decision gate; ยังไม่ใช่ live LLM integration
- `public/cockpit-v3.js` / `public/cockpit-v3.css` — guided RM interface ภาษาไทยและกราฟที่คลิกได้

## หลักการคำนวณและหลักฐาน

- Raw NAV ถูกเรียก `NAV return` และมีคำเตือนว่าอาจไม่รวม distributions; ไม่เรียก total return
- TWR ใช้ดู performance ที่แยก external cash flows; XIRR ใช้ดูประสบการณ์เงินของลูกค้า; CAGR แสดงเฉพาะเมื่อเงื่อนไข no-flow ถูกต้อง
- P&L ของช่วง = มูลค่าปลายงวด − มูลค่าต้นงวด − เงินเติม + เงินถอน; realized/unrealized P&L แสดง unavailable จนมีต้นทุนราย lot และธุรกรรมที่ตรวจสอบได้
- Unified Portfolio Workspace แสดง P&L ย้อนหลังของ Current / RM Draft / AI Model Diagnostic / No-action จากมูลค่าเริ่มต้นสาธิต × price return ของช่วง พร้อมป้ายว่าเป็นสมมติฐาน no-flow และไม่ใช่ realized/unrealized P&L
- Current Portfolio และ Draft Proposal เป็นคนละ object; draft บันทึก/โหลดซ้ำได้ใน demo process และไม่มี auto-approve หรือ auto-trade
- covariance/correlation จับคู่ actual common valuation dates โดยไม่ forward-fill return และตรวจ PSD หลัง shrinkage
- share classes ของ master fund เดียวกันถูกรวมก่อนแปลผล diversification
- metric สำคัญมีค่า หน่วย as-of แหล่งข้อมูล formula/calculation ID เวอร์ชัน assumptions input hash reason code และข้อจำกัด
- summary, evidence detail และ audit ใช้ governed result ชุดเดียวกัน
- ผลหลัง action ของ goal จะแสดง `ยังไม่คำนวณ` จนมี tested goal calculator; ระบบไม่บวกเปอร์เซ็นต์สาธิตเอง

รายละเอียดการ audit ของ repository และรายการ Round-1 ที่ retain/correct/remove อยู่ที่ [docs/REPOSITORY_AUDIT.md](docs/REPOSITORY_AUDIT.md)

## Historical replay ไม่ใช่ backtest หา alpha

Historical replay ใช้ตรวจความถูกต้องและความเสถียรของ calculation, goal projection, approved-model comparison, Care/Growth ordering, alerts และ market-event impact ไม่ได้ optimize เพื่อชนะตลาดและไม่ใช้สรุปรายได้หรือ retention

ชุด fixture ของ replay มี 12 master funds ไทยสังเคราะห์, raw business-day NAV ระหว่าง `2020-01-01` ถึง `2024-12-31` (แต่ละกองมีประวัติ 3–5 ปีตามวันจัดตั้ง), 59 monthly decision dates ตั้งแต่ `2020-02-01` ถึง `2024-12-01`, deterministic seed และ stress windows 3 ช่วง ข้อมูล classification, factsheet, approved shelf, quality, holdings, benchmark และ market event มี effective/published timing เพื่อทดสอบว่า ณ เวลา `t` ระบบเห็นเฉพาะข้อมูลที่มีอยู่แล้ว ไม่มี future NAV หรือ revision ที่ยังไม่เผยแพร่

ผลที่รายงานต้องแยกเป็นสามกลุ่มเสมอ:

| กลุ่มผล | ความหมาย |
|---|---|
| `HISTORICAL_REPLAY` | walk-forward บน point-in-time synthetic records ใช้ตรวจระบบ ไม่ใช่ผลกองทุนจริง |
| `SYNTHETIC_SCENARIO` | shock/เส้นทางสมมติ ใช้สนทนาเรื่องความเสี่ยง ไม่ใช่เหตุการณ์ที่สังเกตจริงหรือ forecast |
| `LIVE_PILOT` | ยังไม่มีใน repository นี้ ต้องเก็บภายใต้ pilot design และ governance ที่อนุมัติ |

Replay ปัจจุบันรายงาน on-track/shortfall, CVaR, maximum drawdown, turnover, transaction cost, liquidity/suitability violations, Care alerts, false-positive rate และ RM workload พร้อม dataset/seed/calculation IDs อย่างไรก็ตาม on-track observation rate ยังไม่ใช่ probability of goal success, turnover ยังเป็นระดับ bucket และ historical stress windows ยังต้องแยกจาก named shocks ก่อนใช้เชิงกำกับ ดู [repository audit](docs/REPOSITORY_AUDIT.md) และ [implementation plan](docs/IMPLEMENTATION_PLAN.md)

## เอกสาร Phase 0

- [Repository audit, current-state diagram, file map, calculation disposition](docs/REPOSITORY_AUDIT.md)
- [Product/data contract plan](docs/DATA_CONTRACT_PLAN.md)
- [Phased implementation, migration, and test plan](docs/IMPLEMENTATION_PLAN.md)
- [Assumptions and missing bank-policy inputs](docs/ASSUMPTIONS_AND_POLICY_INPUTS.md)

## ข้อจำกัดก่อน production

ระบบมี live contract เฉพาะ SETSMART listed EOD แต่ยังไม่มี documented contract สำหรับ fund master/share class/NAV history ของกองทุนเปิดทั่วไป รวมถึง bank identity/role integration, durable database/event store, policy-approved product shelf, production eligibility/suitability rules, licensed point-in-time history หรือ live pilot evidence จึงยังไม่ใช่ระบบ advisory หรือ transaction production ดูรายการที่ต้องปิดให้ครบใน [docs/ASSUMPTIONS_AND_POLICY_INPUTS.md](docs/ASSUMPTIONS_AND_POLICY_INPUTS.md)

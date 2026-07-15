# SETSMART setup — live listed data + contract-gated open-end funds

Repository ใช้ contract ทางการที่เผยแพร่แล้วสำหรับ SETSMART Listed-company EOD API และเรียกข้อมูล `UT`/`ETF` จริงจาก backend ได้ ส่วน fund master, share class และ NAV history ของกองทุนเปิดทั่วไปยังไม่มี public contract จึงคง fixture แยกไว้และไม่เดา endpoint หรือ schema

Contract ที่ใช้จริง: [Company Fundamental Data API Specification V1.0](https://media.set.or.th/set/Documents/2022/Oct/05_1_Company_Fundamental_Specification.pdf)

- `GET https://www.setsmart.com/api/listed-company-api/eod-price-by-security-type`
- `GET https://www.setsmart.com/api/listed-company-api/eod-price-by-symbol`
- authentication header: `api-key`
- `close` คือราคาซื้อขายของหลักทรัพย์จดทะเบียน ไม่ใช่ NAV
- `bvps` ใช้เป็น NAV สำหรับ listed UT/ETF ตาม contract แต่ไม่ใช่ total return

## 1. ถือว่า key เดิมใช้ต่อไม่ได้

credential ที่เคยถูกเปิดเผยนอกแอปต้อง revoke/rotate ที่ผู้ให้บริการก่อน ห้ามนำค่าดังกล่าวมาใส่ repository, browser JavaScript, screenshot, log หรือข้อความ error

Fixture mode ไม่ต้องมี `.env.local` หรือ API key เปิดเดโมได้ทันทีด้วย `npm start` หากกำลังเตรียม server-side configuration ให้ใช้ไฟล์ตัวอย่างซึ่งมี placeholder เท่านั้น:

```bash
cp .env.example .env.local
```

เก็บ credential ที่ rotate แล้วเฉพาะใน `.env.local` หรือ secret manager. เปิด live เฉพาะ listed EOD contract และคง open-end mutual funds เป็น fixture:

```text
MUTUAL_FUND_DATA_MODE=fixture
SETSMART_LISTED_DATA_MODE=live
SETSMART_API_KEY=replace_with_newly_rotated_key
```

`.env.local` ถูก ignore โดย Git อย่า commit ไฟล์นี้

## 2. Data path ที่อนุญาต

```text
Browser
  -> FIN AI backend
  -> SetSmartListedEodProvider -> SETSMART Listed-company EOD API (live types returned by entitlement)
  -> CachedMutualFundProvider
  -> Fixture/Mock adapter (เดโม)
     หรือ SetSmartMutualFundAdapter (เมื่อมี documented contract)
  -> SETSMART
```

- browser ไม่เรียก SETSMART โดยตรง
- backend ไม่คืน key ให้ browser; health endpoint คืนเฉพาะ configuration/provider status
- adapter ลบค่าลับจาก result/error ก่อนส่งต่อและไม่ log request credential
- live provider ใช้ timeout, bounded retry, rate-limit mapping, TTL cache, visible stale fallback และ failure backoff โดยไม่เปลี่ยน security boundary

## 3. เปิดระบบแบบข้อมูลผสม

```bash
npm start
```

เปิด `http://127.0.0.1:4187` แล้วเข้า `เหตุการณ์ตลาด > SETSMART Live` เพื่อค้นหา/กรอง listed EOD asset จริง ส่วนพอร์ตลูกค้าและกองทุนเปิดยังติดป้าย `Fixture / Demo` อย่างชัดเจน

ทดสอบด้วย:

```bash
npm test
```

## 4. เงื่อนไขก่อนเปิด SETSMART mutual-fund mode

ห้ามเปลี่ยน `MUTUAL_FUND_DATA_MODE` เป็น `setsmart` จนมีครบทุกข้อ:

1. key ที่ rotate แล้วอยู่ใน server-side environment เท่านั้น
2. เอกสาร SETSMART mutual-fund API ที่องค์กรมีสิทธิ์ใช้
3. reviewed contract ที่ map operation ทั้งหกของ `MutualFundDataProvider`
4. server-side transport ที่กำหนด base URL และ authentication ตามเอกสารจริง; shared provider boundary บังคับ timeout/retry/rate-limit/cache/stale/backoff เพิ่มเติม
5. response validator/fixture ที่มาจากตัวอย่าง payload ที่ได้รับอนุญาต
6. สิทธิ์ cache, storage, redistribution และ data-retention ที่ยืนยันแล้ว
7. approved shelf และ client eligibility/permission effective dates จากธนาคาร

เงื่อนไขนี้ใช้กับ fund master/share class/NAV history ของกองทุนเปิดทั่วไป ไม่ใช่ listed EOD provider ที่มี public contract แล้ว `SetSmartMutualFundAdapter` จะยัง fail closed หากไม่มี `documented: true` contract, operation implementation หรือ transport ที่ถูก inject จาก backend

## 5. Provider contract

Backend ใช้ interface ต่อไปนี้โดยไม่สมมติ URL หรือ schema ภายนอก:

```ts
interface MutualFundDataProvider {
  getFundMaster(query: FundQuery): Promise<FundMaster[]>;
  getFundProfile(fundId: string): Promise<FundProfile>;
  getShareClasses(masterFundId: string): Promise<FundShareClass[]>;
  getNavHistory(fundId: string, startDate: string, endDate: string): Promise<NavObservation[]>;
  getFundDocuments(fundId: string): Promise<FundDocumentReference[]>;
  getFundAllocation(fundId: string, asOf: string): Promise<FundAllocationSnapshot | null>;
}
```

Implementation อยู่ใน `lib/v3/mutual-funds.js` และ type contract อยู่ใน `lib/v3/mutual-funds.d.ts`

## 6. Candidate universe และ share classes

กองทุนที่จะถูกเปรียบเทียบต้องผ่านพร้อมกัน:

- อยู่ใน universe ที่ provider คืนตามวันที่
- approved shelf มีผล ณ วันนั้น
- เหมาะกับ client eligibility/suitability
- ผ่าน data-quality/freshness rule
- มี permission ที่ต้องใช้

Share classes ของ master fund เดียวกันถูกรวมเป็น exposure เดียวก่อนคำนวณ diversification และไม่ถูกนับเป็น independent bets

## 7. ขอบเขต live ที่ต้องไม่ตีความเกินจริง

`lib/v3/setsmart-listed.js`, `/api/v3/market/setsmart-assets` และ Product Provider Registry เป็น live integration สำหรับ listed EOD เท่านั้น Backend ขอ `securityType=All` เพื่อสร้างคลังตามประเภทที่ entitlement ส่งกลับ แล้วค้นหา/กรอง/แบ่งหน้าก่อนส่งให้ browser (ไม่เกิน 200 รายการต่อ request) ข้อมูล `UT` หมายถึง Unit Trust ที่เป็นหลักทรัพย์จดทะเบียน และ `ETF` หมายถึง ETF ตาม security type ของ contract ไม่ใช่หลักฐานว่า API ครอบคลุมกองทุนเปิดไทยทุก share class

หน้า `เหตุการณ์ตลาด > SETSMART Live` แสดงจำนวนและ facet ตามผลจริงแบบ dynamic พร้อม as-of/cache status ไม่ hard-code ว่าประเภทใดต้องมีเสมอ และไม่เติม issuer, currency, risk, approved shelf, eligibility หรือ readiness จาก market API เมื่อ contract ไม่รองรับ

โค้ดรุ่นเดิมใน `lib/setsmart.js` และ `/api/market/thai` ถูกเก็บไว้เพื่อ regression compatibility ของ market-context demo ไม่ใช่ mutual-fund contract ของ v3

ก่อน push ให้ตรวจว่าไม่มี `.env.local`, raw licensed snapshot หรือ key อยู่ใน staged changes และใช้ key-management/secret-scanning ขององค์กรใน CI

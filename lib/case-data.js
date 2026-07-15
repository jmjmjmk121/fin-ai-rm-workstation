'use strict';

const ASSET_LABELS = {
  cash: 'เงินพร้อมใช้',
  thaiGovBond: 'พันธบัตรรัฐบาลไทย',
  thaiCorpBond: 'ตราสารหนี้ไทยคุณภาพดี',
  thaiEquityCore: 'หุ้นไทยขนาดใหญ่',
  thaiEquityDividend: 'หุ้นไทยปันผล',
  thaiReit: 'อสังหาฯ และโครงสร้างพื้นฐานไทย',
};

const APPROVED_SHELF = [
  {
    id: 'SHELF-CASH', asset: 'cash', displayName: 'กองทุนตลาดเงินไทย', role: 'พักเงินและสำรองสภาพคล่อง',
    riskLevel: 1, settlement: 'ตรวจตาม factsheet ของ share class', fee: 'แสดงจาก SEC/approved shelf เมื่อเชื่อมจริง',
    benefit: 'มูลค่าผันผวนน้อยและนำเงินไปใช้ได้ง่ายกว่าสินทรัพย์เสี่ยง', mainRisk: 'ผลตอบแทนอาจไม่ชนะเงินเฟ้อและยังมีความเสี่ยงของกองทุน',
    suitableFor: 'เงินสำรองหรือเงินที่มีแผนใช้ในระยะสั้น', notFor: 'เป้าหมายเติบโตระยะยาวที่ต้องการผลตอบแทนสูง',
    talkingPoint: 'ส่วนนี้มีหน้าที่ให้ลูกค้ามีเงินพร้อมใช้ ไม่ได้มีหน้าที่เร่งผลตอบแทน',
    source: 'SEC Fund Factsheet fixture', proxy: null, shelfStatus: 'case-study-approved',
  },
  {
    id: 'SHELF-THGOV', asset: 'thaiGovBond', displayName: 'กองทุนพันธบัตรรัฐบาลไทย', role: 'ลดความผันผวนและรองรับเป้าหมายระยะกลาง',
    riskLevel: 3, settlement: 'ตรวจตาม factsheet ของ share class', fee: 'แสดงจาก SEC/approved shelf เมื่อเชื่อมจริง',
    benefit: 'ช่วยลดความผันผวนของพอร์ตและจับคู่เป้าหมายระยะกลาง', mainRisk: 'ราคาลดได้เมื่ออัตราดอกเบี้ยเพิ่ม และผลตอบแทนไม่รับประกัน',
    suitableFor: 'เงินเป้าหมายที่ต้องการความมั่นคงมากกว่าส่วนหุ้น', notFor: 'ผู้ที่ต้องใช้เงินทันทีโดยไม่ได้ตรวจวันรับเงินคืน',
    talkingPoint: 'ใช้เป็นตัวลดแรงเหวี่ยงของพอร์ต แต่ยังต้องตรวจอายุพันธบัตรและสภาพคล่องจากเอกสารข้อมูลกองทุน',
    source: 'SEC Fund Factsheet fixture', proxy: 'ABFTH', shelfStatus: 'case-study-approved',
  },
  {
    id: 'SHELF-THCORP', asset: 'thaiCorpBond', displayName: 'กองทุนตราสารหนี้ไทยคุณภาพดี', role: 'สร้างกระแสผลตอบแทนภายใต้กรอบเครดิต',
    riskLevel: 4, settlement: 'ตรวจตาม factsheet ของ share class', fee: 'แสดงจาก SEC/approved shelf เมื่อเชื่อมจริง',
    benefit: 'เพิ่มโอกาสรับผลตอบแทนจากตราสารหนี้ภายใต้กรอบเครดิต', mainRisk: 'ผู้ออกอาจผิดนัดและราคาปรับลงเมื่อเครดิตหรือดอกเบี้ยเปลี่ยน',
    suitableFor: 'ลูกค้าที่รับความเสี่ยงเครดิตได้และไม่ต้องใช้เงินทันที', notFor: 'ผู้ที่ต้องการคุ้มครองเงินต้นแบบรับประกัน',
    talkingPoint: 'ผลตอบแทนที่เพิ่มขึ้นแลกกับความเสี่ยงเครดิต จึงต้องอยู่ในรายชื่อและเพดานที่ธนาคารอนุมัติ',
    source: 'SEC Fund Factsheet fixture', proxy: null, shelfStatus: 'case-study-approved',
  },
  {
    id: 'SHELF-THEQ', asset: 'thaiEquityCore', displayName: 'กองทุนหุ้นไทยแกนหลัก', role: 'การเติบโตระยะยาวจากหุ้นไทยขนาดใหญ่',
    riskLevel: 6, settlement: 'ตรวจตาม factsheet ของ share class', fee: 'แสดงจาก SEC/approved shelf เมื่อเชื่อมจริง',
    benefit: 'สร้างการเติบโตระยะยาวจากหุ้นไทยหลายบริษัท', mainRisk: 'มูลค่าลดลงมากได้ในช่วงตลาดตกและอาจใช้เวลาฟื้น',
    suitableFor: 'เงินที่ไม่ต้องใช้เร็วและลูกค้ารับการขาดทุนระหว่างทางได้', notFor: 'เป้าหมายใกล้ถึงกำหนดหรือเงินสำรองฉุกเฉิน',
    talkingPoint: 'ส่วนนี้ใช้เพื่อการเติบโต ไม่ควรนำเงินที่จะใช้ในไม่กี่ปีมารับความผันผวนทั้งหมด',
    source: 'SEC Fund Factsheet fixture', proxy: 'TDEX', shelfStatus: 'case-study-approved',
  },
  {
    id: 'SHELF-THDIV', asset: 'thaiEquityDividend', displayName: 'กองทุนหุ้นไทยปันผล', role: 'กระจายรูปแบบผลตอบแทนในส่วนหุ้นไทย',
    riskLevel: 6, settlement: 'ตรวจตาม factsheet ของ share class', fee: 'แสดงจาก SEC/approved shelf เมื่อเชื่อมจริง',
    benefit: 'กระจายรูปแบบหุ้นไปยังบริษัทที่มีลักษณะจ่ายปันผล', mainRisk: 'เงินปันผลไม่รับประกันและราคาหุ้นยังลดลงได้',
    suitableFor: 'ส่วนเติบโตระยะยาวที่ต้องการกระจายสไตล์การลงทุน', notFor: 'ผู้ที่เข้าใจว่าปันผลเท่ากับรายได้แน่นอน',
    talkingPoint: 'ปันผลเป็นเพียงแหล่งหนึ่งของผลตอบแทน ไม่ได้ป้องกันการขาดทุนของราคา',
    source: 'SEC Fund Factsheet fixture', proxy: '1DIV', shelfStatus: 'case-study-approved',
  },
  {
    id: 'SHELF-THREIT', asset: 'thaiReit', displayName: 'กองทุนอสังหาฯ และโครงสร้างพื้นฐานไทย', role: 'กระจายแหล่งรายได้และความเสี่ยง',
    riskLevel: 8, settlement: 'ตรวจตาม factsheet ของ share class', fee: 'แสดงจาก SEC/approved shelf เมื่อเชื่อมจริง',
    benefit: 'เพิ่มแหล่งรายได้และกระจายจากหุ้นกับตราสารหนี้บางส่วน', mainRisk: 'อ่อนไหวต่อดอกเบี้ย สภาพคล่อง และรายได้ค่าเช่า/โครงการ',
    suitableFor: 'เงินระยะยาวที่รับความผันผวนและข้อจำกัดสภาพคล่องได้', notFor: 'เงินฉุกเฉินหรือผู้ที่คิดว่าอสังหาริมทรัพย์ไม่ขาดทุน',
    talkingPoint: 'เป็นสินทรัพย์เสี่ยงอีกประเภทหนึ่ง ไม่ใช่เงินฝาก และต้องดูคุณภาพทรัพย์สินกับหนี้ของกอง',
    source: 'SEC Fund Factsheet fixture', proxy: null, shelfStatus: 'case-study-approved',
  },
];

const MODELS = {
  preserve: {
    id: 'preserve', name: 'รักษาเงินต้นและสภาพคล่อง', riskRange: '2-4',
    weights: { cash: 0.20, thaiGovBond: 0.35, thaiCorpBond: 0.25, thaiEquityCore: 0.12, thaiEquityDividend: 0.03, thaiReit: 0.05 },
  },
  balanced: {
    id: 'balanced', name: 'สมดุลเพื่อหลายเป้าหมาย', riskRange: '4-6',
    weights: { cash: 0.10, thaiGovBond: 0.25, thaiCorpBond: 0.20, thaiEquityCore: 0.30, thaiEquityDividend: 0.10, thaiReit: 0.05 },
  },
  growth: {
    id: 'growth', name: 'เติบโตระยะยาว', riskRange: '6-7',
    weights: { cash: 0.05, thaiGovBond: 0.10, thaiCorpBond: 0.15, thaiEquityCore: 0.45, thaiEquityDividend: 0.15, thaiReit: 0.10 },
  },
};

const SCENARIOS = {
  tariff: {
    id: 'tariff', name: 'US Tariff escalation', plainName: 'กำแพงภาษีการค้ารุนแรงขึ้น', horizon: 'ฉับพลัน 1-3 เดือน',
    shocks: { cash: 0.00, thaiGovBond: 0.02, thaiCorpBond: -0.02, thaiEquityCore: -0.12, thaiEquityDividend: -0.09, thaiReit: -0.08 },
    narrative: 'การค้าโลกชะลอและความผันผวนเพิ่ม หุ้นไทยที่พึ่งพาการส่งออกอาจถูกกดดัน',
    calibration: 'ค่าความเสียหายเป็นสมมติฐานสาธิต ต้องให้ฝ่ายการลงทุนและความเสี่ยงอนุมัติก่อนใช้งานจริง',
  },
  hormuz: {
    id: 'hormuz', name: 'Hormuz / US-Iran escalation', plainName: 'พลังงานสะดุดจากความขัดแย้งช่องแคบฮอร์มุซ', horizon: 'ฉับพลัน 1-6 เดือน',
    shocks: { cash: 0.00, thaiGovBond: -0.01, thaiCorpBond: -0.03, thaiEquityCore: -0.10, thaiEquityDividend: -0.07, thaiReit: -0.08 },
    narrative: 'ต้นทุนพลังงานและเงินเฟ้อเพิ่ม กระทบกำไรบริษัทและความสามารถชำระหนี้บางกลุ่ม',
    calibration: 'ค่าความเสียหายเป็นสมมติฐานสาธิต ต้องให้ฝ่ายการลงทุนและความเสี่ยงอนุมัติก่อนใช้งานจริง',
  },
  border: {
    id: 'border', name: 'Thailand-Cambodia regional escalation', plainName: 'ความขัดแย้งชายแดนไทย-กัมพูชารุนแรงขึ้น', horizon: 'เหตุการณ์เฉพาะภูมิภาค 1-3 เดือน',
    shocks: { cash: 0.00, thaiGovBond: 0.01, thaiCorpBond: -0.01, thaiEquityCore: -0.08, thaiEquityDividend: -0.06, thaiReit: -0.05 },
    narrative: 'ความเชื่อมั่นและธุรกิจที่เกี่ยวข้องกับการค้า การเดินทาง และชายแดนอาจถูกกระทบ',
    calibration: 'สถานการณ์สมมติสำหรับกรณีศึกษา ไม่ใช่การคาดการณ์หรือการประเมินทางการเมือง',
  },
  covid: {
    id: 'covid', name: 'COVID-like pandemic shock', plainName: 'โรคระบาดรุนแรงแบบ COVID', horizon: 'ฉับพลันและยืดเยื้อ 6-18 เดือน',
    shocks: { cash: 0.00, thaiGovBond: 0.04, thaiCorpBond: -0.06, thaiEquityCore: -0.30, thaiEquityDividend: -0.25, thaiReit: -0.35 },
    narrative: 'กิจกรรมเศรษฐกิจและรายได้หยุดชะงัก พร้อมแรงขายสินทรัพย์เสี่ยงและความต้องการเงินสดสูงขึ้น',
    calibration: 'สถานการณ์สาธิตที่อิงรูปแบบเหตุการณ์ในอดีต ไม่ใช่การคาดการณ์',
  },
};

const CLIENTS = [
  {
    id: 'C-1048', name: 'คุณณรินทร์ ว.', initials: 'ณว', segment: '15-50 ล้านบาท', aum: 48_500_000,
    lane: 'relationship', channel: 'call', due: 'ภายใน 3 วัน', callMinutes: 8,
    reason: 'มีเงินพร้อมใช้ประมาณ 6.2 ล้านบาทนาน 5 เดือน และเคยถามเรื่องเงินทุนธุรกิจ แต่ยังไม่มีข้อมูลความคุ้มครอง',
    objective: 'ยืนยันแผนใช้เงิน 12 เดือน แล้วเปิดบทสนทนาเรื่องสภาพคล่อง สินเชื่อ และความคุ้มครอง',
    channelWhy: 'เคสมีหลายเรื่องเชื่อมกันและมูลค่าความสัมพันธ์สูง จึงควรใช้ RM โทรแทนข้อความทั่วไป',
    clientBenefit: 'high', businessPotential: 'high', mandatory: false, dataReady: true, profileFresh: true,
    riskLevel: 5, modelId: 'balanced', liquidCash: 6_208_000, monthlyExpense: 280_000,
    kyc: { status: 'พร้อมใช้', lastReviewed: '2026-02-10', source: 'KYC/CRM fixture', clientConfirmed: true, missingFields: [], referralConsent: 'ต้องขอใหม่ก่อนส่งต่อผู้เชี่ยวชาญ', referralConsentGranted: false },
    goal: { name: 'เกษียณและสำรองเงินธุรกิจ', target: 70_000_000, years: 10, currentCapital: 34_000_000, annualContribution: 1_200_000, currency: 'THB' },
    portfolio: { cash: 0.128, thaiGovBond: 0.262, thaiCorpBond: 0.22, thaiEquityCore: 0.28, thaiEquityDividend: 0.08, thaiReit: 0.03 },
    wealth: [
      ['เงินพร้อมใช้', 'ควรทบทวน', 'เงินนิ่งสูงกว่าที่จำเป็น แต่ยังไม่ทราบแผนใช้เงิน'],
      ['เป้าหมายและการลงทุน', 'ปกติ', 'พอร์ตอยู่ในกรอบโดยรวม'],
      ['ความคุ้มครอง', 'ยังไม่ได้ประเมิน', 'มีผู้พึ่งพารายได้ 2 คน'],
      ['ภาระและสินเชื่อ', 'ต้องยืนยัน', 'เคยถามเรื่อง funding ธุรกิจ'],
    ],
    questions: [
      ['เงิน 6.2 ล้านบาทมีแผนใช้เมื่อใด', 'เพื่อกันเงินที่ต้องใช้จริงออกจากพอร์ตก่อน'],
      ['รายได้ครอบครัวต้องพึ่งคุณกี่คน', 'เพื่อคัดกรอง protection need โดยยังไม่เลือกผลิตภัณฑ์'],
      ['ยังต้องการวงเงินสำหรับธุรกิจหรือไม่', 'เพื่อส่งต่อผู้เชี่ยวชาญสินเชื่อพร้อมบริบท'],
    ],
    aiSignals: [
      { source: 'บันทึกหลังการคุยครั้งก่อน', evidence: '“อาจซื้อเครื่องจักรปลายปี และอยากรู้ว่าครอบครัวมีความคุ้มครองพอหรือไม่”', finding: 'มีทั้งแผนใช้เงินธุรกิจและคำถามด้านความคุ้มครองที่ยังไม่ได้ปิด' },
    ],
    carePaths: [
      { need: 'ความคุ้มครองรายได้ครอบครัว', nextQuestion: 'มีผู้พึ่งพารายได้และความคุ้มครองเดิมเท่าใด', owner: 'ผู้เชี่ยวชาญด้านความคุ้มครอง', sla: 'รับเคสภายใน 1 วันทำการ', consent: 'ต้องขอความยินยอมก่อนส่งต่อ' },
      { need: 'เงินทุนสำหรับธุรกิจ', nextQuestion: 'ต้องการวงเงิน จำนวน และช่วงเวลาใด', owner: 'ผู้เชี่ยวชาญสินเชื่อธุรกิจ', sla: 'รับเคสภายใน 1 วันทำการ', consent: 'ต้องขอความยินยอมก่อนส่งต่อ' },
    ],
  },
  {
    id: 'C-2012', name: 'คุณวรัญญา ส.', initials: 'วส', segment: '2-5 ล้านบาท', aum: 2_100_000,
    lane: 'care', channel: 'message', due: 'วันนี้', callMinutes: 2,
    reason: 'พอร์ตลดลงประมาณ 9.8% แต่ยังอยู่ในกรอบความเสี่ยง และเป้าหมายระยะยาวยังไม่หลุด',
    objective: 'สื่อสารให้ลูกค้าทราบว่าเราติดตามอยู่ และเปิดทางให้นัด RM หากความต้องการเปลี่ยน',
    channelWhy: 'เป็นเหตุการณ์ตลาดที่อธิบายได้ด้วยข้อความส่วนบุคคล จึงไม่แย่งเวลาสายจากเคสที่ต้องใช้การตัดสินใจหลายมิติ',
    clientBenefit: 'medium', businessPotential: 'low', mandatory: false, dataReady: true, profileFresh: true,
    riskLevel: 6, modelId: 'growth', liquidCash: 105_000, monthlyExpense: 65_000,
    kyc: { status: 'พร้อมใช้', lastReviewed: '2025-10-18', source: 'KYC/CRM fixture', clientConfirmed: true, missingFields: [], referralConsent: 'ยังไม่มี referral ในเคสนี้' },
    goal: { name: 'เกษียณ', target: 8_000_000, years: 18, currentCapital: 1_700_000, annualContribution: 120_000, currency: 'THB' },
    portfolio: { cash: 0.05, thaiGovBond: 0.10, thaiCorpBond: 0.15, thaiEquityCore: 0.44, thaiEquityDividend: 0.16, thaiReit: 0.10 },
    wealth: [
      ['เงินพร้อมใช้', 'ปกติ', 'สำรองประมาณ 2.3 เดือน'], ['เป้าหมายและการลงทุน', 'ควรทบทวน', 'ตลาดลดลงแต่กรอบยังไม่แตก'],
      ['ความคุ้มครอง', 'ยังไม่ได้ประเมิน', 'ยังไม่มีข้อมูลพอ'], ['ภาระและสินเชื่อ', 'ปกติ', 'ไม่พบภาระผิดปกติ'],
    ],
    questions: [['เป้าหมายและเวลาลงทุนยังเหมือนเดิมหรือไม่', 'หากไม่เปลี่ยน อาจยังไม่ต้องซื้อขาย']],
  },
  {
    id: 'C-3091', name: 'คุณธนภพ ก.', initials: 'ธก', segment: '2-5 ล้านบาท', aum: 3_400_000,
    lane: 'mandatory', channel: 'call', due: 'ภายใน 24 ชั่วโมง', callMinutes: 6,
    reason: 'ข้อร้องเรียนเรื่องค่าธรรมเนียมค้าง 5 วันและใกล้เกิน SLA',
    objective: 'รับผิดชอบเคส อธิบายขั้นตอน และนัดเวลาตอบกลับที่ชัดเจน โดยไม่เสนอผลิตภัณฑ์',
    channelWhy: 'เป็นหน้าที่แก้ไขข้อร้องเรียน จึงลัดคิวไม่ว่ามูลค่าทรัพย์สินเท่าใด',
    clientBenefit: 'mandatory', businessPotential: 'medium', mandatory: true, dataReady: true, profileFresh: true,
    riskLevel: 4, modelId: 'balanced', liquidCash: 408_000, monthlyExpense: 80_000,
    kyc: { status: 'พร้อมใช้สำหรับดูแลบริการ', lastReviewed: '2026-03-04', source: 'KYC/CRM fixture', clientConfirmed: true, missingFields: [], referralConsent: 'ปิด cross-sell ระหว่าง service recovery' },
    goal: { name: 'ซื้อบ้าน', target: 5_000_000, years: 6, currentCapital: 2_800_000, annualContribution: 240_000, currency: 'THB' },
    portfolio: { cash: 0.12, thaiGovBond: 0.25, thaiCorpBond: 0.23, thaiEquityCore: 0.27, thaiEquityDividend: 0.08, thaiReit: 0.05 },
    wealth: [['การบริการ', 'ต้องดำเนินการ', 'ข้อร้องเรียนค้างเกินเป้าหมายตอบกลับ']],
    questions: [['ขอยืนยันประเด็นและผลลัพธ์ที่ลูกค้าคาดหวัง', 'เพื่อแก้ไขข้อร้องเรียนให้ตรงกับสิ่งที่ลูกค้าต้องการ']],
  },
  {
    id: 'C-4124', name: 'คุณชญานิน อ.', initials: 'ชอ', segment: '5-15 ล้านบาท', aum: 12_400_000,
    lane: 'portfolio', channel: 'call', due: 'ภายใน 5 วัน', callMinutes: 10,
    reason: 'หุ้นไทยและสินทรัพย์เสี่ยงรวมอยู่ในสัดส่วนสูง ขณะที่เป้าการศึกษาบุตรเหลือ 4 ปี',
    objective: 'ยืนยันวันใช้เงินและเสนอทางเลือกปรับพอร์ตที่ลดความเสี่ยงโดยไม่ขายเกินจำเป็น',
    channelWhy: 'ต้องยืนยันเป้าหมายและอธิบายข้อดีข้อเสียก่อนตัดสินใจซื้อขาย',
    clientBenefit: 'high', businessPotential: 'medium', mandatory: false, dataReady: true, profileFresh: true,
    riskLevel: 5, modelId: 'balanced', liquidCash: 620_000, monthlyExpense: 145_000,
    kyc: { status: 'พร้อมใช้', lastReviewed: '2026-01-22', source: 'KYC/CRM fixture', clientConfirmed: true, missingFields: [], referralConsent: 'ไม่ต้องส่งต่อในขั้นตอนนี้' },
    goal: { name: 'การศึกษาบุตร', target: 6_500_000, years: 4, currentCapital: 4_800_000, annualContribution: 300_000, currency: 'THB' },
    portfolio: { cash: 0.05, thaiGovBond: 0.10, thaiCorpBond: 0.15, thaiEquityCore: 0.50, thaiEquityDividend: 0.10, thaiReit: 0.10 },
    wealth: [
      ['เงินพร้อมใช้', 'ควรทบทวน', 'เงินสำรองต่ำกว่า 6 เดือน'], ['เป้าหมายและการลงทุน', 'ควรทบทวน', 'หุ้นสูงและเป้าหมายใกล้ขึ้น'],
      ['ความคุ้มครอง', 'ปกติ', 'ทบทวนเมื่อ 8 เดือนก่อน'], ['ภาระและสินเชื่อ', 'ปกติ', 'ไม่มีข้อมูลเตือน'],
    ],
    questions: [
      ['ยอดและวันจ่ายค่าเรียนยังเป็น 6.5 ล้านบาทในอีก 4 ปีหรือไม่', 'กำหนดความเสี่ยงที่พอร์ตยังรับได้'],
      ['มีเงินใหม่ที่จะทยอยเติมใน 12 เดือนหรือไม่', 'พิจารณาใช้เงินใหม่ปรับก่อนขายกองเดิม'],
    ],
  },
  {
    id: 'C-5078', name: 'คุณปิยะดา ล.', initials: 'ปล', segment: '5-15 ล้านบาท', aum: 7_800_000,
    lane: 'data', channel: 'confirm', due: 'ก่อนให้คำแนะนำ', callMinutes: 3,
    reason: 'ข้อมูลรายได้ เป้าหมาย และผู้รับผลประโยชน์เก่าหรือขัดกัน 3 จุด',
    objective: 'ส่งรายการสั้นให้ลูกค้ายืนยันก่อน ระบบจะยังไม่แสดงกองทุนหรือพอร์ตแนะนำ',
    channelWhy: 'ข้อมูลยังไม่พร้อม จึงใช้คำขอยืนยันแทนการโทรขายหรือแนะนำผลิตภัณฑ์',
    clientBenefit: 'high', businessPotential: 'medium', mandatory: false, dataReady: false, profileFresh: false,
    riskLevel: 5, modelId: 'balanced', liquidCash: 936_000, monthlyExpense: 120_000,
    kyc: { status: 'ต้องให้ลูกค้ายืนยัน', lastReviewed: '2024-08-11', source: 'KYC/CRM fixture', clientConfirmed: false, missingFields: ['รายได้ปัจจุบัน', 'เป้าหมายเกษียณ', 'ผู้รับผลประโยชน์'], referralConsent: 'ยังไม่เปิด referral จนกว่าข้อมูลพร้อม' },
    goal: { name: 'เกษียณ', target: 20_000_000, years: 12, currentCapital: 6_500_000, annualContribution: 300_000, currency: 'THB' },
    portfolio: { cash: 0.12, thaiGovBond: 0.22, thaiCorpBond: 0.20, thaiEquityCore: 0.31, thaiEquityDividend: 0.10, thaiReit: 0.05 },
    wealth: [['ข้อมูลลูกค้า', 'ต้องยืนยัน', 'ยังไม่พร้อมให้คำแนะนำ']],
    questions: [
      ['รายได้ต่อเดือนยังอยู่ในช่วงเดิมหรือไม่', 'ใช้ประเมิน loss capacity'],
      ['เป้าหมายเกษียณและอายุที่ต้องการยังเหมือนเดิมหรือไม่', 'ใช้กำหนด horizon'],
      ['ผู้รับผลประโยชน์ยังเป็นข้อมูลล่าสุดหรือไม่', 'ใช้ปรับข้อมูลที่เกี่ยวข้อง'],
    ],
  },
  {
    id: 'C-6312', name: 'คุณกิตติศักดิ์ พ.', initials: 'กพ', segment: '15-50 ล้านบาท', aum: 31_200_000,
    lane: 'goal', channel: 'call', due: 'ภายใน 7 วัน', callMinutes: 7,
    reason: 'ลูกค้าเพิ่มเป้าหมายค่าเรียนต่างประเทศ 4.5 ล้านบาทในปี 2572 ผ่านแอป',
    objective: 'ยืนยันจำนวนเงิน สกุลเงิน และวันที่ ก่อนคำนวณพอร์ตหลายเป้าหมายใหม่',
    channelWhy: 'เป้าหมายใหม่เปลี่ยนทั้งสภาพคล่องและความเสี่ยงค่าเงิน จึงต้องคุยก่อนคำนวณคำแนะนำ',
    clientBenefit: 'high', businessPotential: 'high', mandatory: false, dataReady: true, profileFresh: true, goalReady: false,
    riskLevel: 6, modelId: 'growth', liquidCash: 2_496_000, monthlyExpense: 210_000,
    kyc: { status: 'KYC พร้อม แต่เป้าหมายใหม่ยังไม่ยืนยัน', lastReviewed: '2026-04-09', source: 'KYC/CRM fixture + goal event', clientConfirmed: true, missingFields: ['สกุลเงินเป้าหมาย', 'วันจ่ายงวดแรก'], referralConsent: 'ต้องขอก่อนส่งต่อผู้เชี่ยวชาญ FX', referralConsentGranted: false },
    goal: { name: 'การศึกษาต่างประเทศ', target: 4_500_000, years: 3, currentCapital: 3_200_000, annualContribution: 400_000, currency: 'ยังไม่ยืนยัน' },
    portfolio: { cash: 0.08, thaiGovBond: 0.12, thaiCorpBond: 0.16, thaiEquityCore: 0.42, thaiEquityDividend: 0.13, thaiReit: 0.09 },
    wealth: [
      ['เงินพร้อมใช้', 'ต้องยืนยัน', 'เป้าหมายใหม่อาจใช้เงินเร็ว'], ['เป้าหมายและการลงทุน', 'ควรทบทวน', 'ต้องแยกเงินค่าเรียนออกจากเงินระยะยาว'],
      ['ความคุ้มครอง', 'ปกติ', 'ไม่มีข้อมูลเตือน'], ['ภาระและสินเชื่อ', 'ปกติ', 'ไม่มีข้อมูลเตือน'],
    ],
    questions: [
      ['4.5 ล้านบาทรวมค่าใช้จ่ายทั้งหมดแล้วหรือไม่', 'กำหนดยอดเป้าหมาย'],
      ['ต้องจ่ายเป็นสกุลเงินใดและงวดแรกเมื่อใด', 'ประเมินความเสี่ยงค่าเงินและสภาพคล่อง'],
    ],
    aiSignals: [
      { source: 'เป้าหมายที่ลูกค้าเพิ่มผ่านแอป', evidence: '“ค่าเรียนต่างประเทศ 4.5 ล้านบาท ปี 2572”', finding: 'เป้าหมายใหม่มีทั้งกำหนดใช้เงินใกล้และความเสี่ยงสกุลเงิน จึงต้องยืนยันก่อนแยกส่วนเงินตามเป้าหมาย' },
    ],
    carePaths: [
      { need: 'การใช้เงินต่างประเทศ', nextQuestion: 'สกุลเงิน วันจ่ายงวดแรก และแหล่งเงินเติม', owner: 'ผู้เชี่ยวชาญด้านเงินตราต่างประเทศ/การวางแผนเป้าหมาย', sla: 'รับเคสภายใน 1 วันทำการ', consent: 'ต้องขอความยินยอมก่อนส่งต่อ' },
    ],
  },
];

const FOLLOW_UPS = [
  { id: 'F-01', clientId: 'C-1048', client: 'คุณณรินทร์ ว.', topic: 'รอผู้เชี่ยวชาญสินเชื่อรับเคส', owner: 'Business Lending Specialist', due: 'พรุ่งนี้ 15:00', status: 'รอรับงาน' },
  { id: 'F-02', clientId: 'C-4124', client: 'คุณชญานิน อ.', topic: 'นัดทบทวนพอร์ต', owner: 'RM คุณพลอย', due: '18 ก.ค. 10:30', status: 'นัดแล้ว' },
  { id: 'F-03', clientId: 'C-5078', client: 'คุณปิยะดา ล.', topic: 'รอลูกค้ายืนยันข้อมูล 3 ข้อ', owner: 'ลูกค้า', due: 'ภายใน 2 วัน', status: 'ส่งคำขอแล้ว' },
];

module.exports = { ASSET_LABELS, APPROVED_SHELF, MODELS, SCENARIOS, CLIENTS, FOLLOW_UPS };

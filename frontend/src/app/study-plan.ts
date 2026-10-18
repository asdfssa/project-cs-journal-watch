/**
 * แปลงรหัสระดับการศึกษา / แผนการเรียนจาก backend เป็นภาษาไทยสำหรับแสดงผล
 * รหัสแผนการเรียนแปลตามรูปแบบชื่อ: P1/P2 = แผน 1/2 · A1/A2 = แบบ ก1/ก2 · B = แบบ ข · ตัวเลข = แบบ x.y
 * รหัสที่ไม่รู้จัก แสดงรหัสเดิม
 */
const DEGREE_TH: Record<string, string> = {
  Master:   'ปริญญาโท',
  Doctoral: 'ปริญญาเอก',
};

const STUDY_PLAN_TH: Record<string, string> = {
  Master_A1:   'แผน ก แบบ ก1',
  Master_A2:   'แผน ก แบบ ก2',
  Master_B:    'แผน ข',
  Master_P1A1: 'แผน 1 แบบ ก1',
  Master_P1A2: 'แผน 1 แบบ ก2',
  Master_P2B:  'แผน 2 แบบ ข',
  Doc_1_1:     'แบบ 1.1',
  Doc_1_2:     'แบบ 1.2',
  Doc_2_1:     'แบบ 2.1',
  Doc_2_2:     'แบบ 2.2',
  Doc_P1_1_1:  'แผน 1 แบบ 1.1',
  Doc_P1_1_2:  'แผน 1 แบบ 1.2',
  Doc_P2_2_1:  'แผน 2 แบบ 2.1',
  Doc_P2_2_2:  'แผน 2 แบบ 2.2',
};

export function degreeLevelTh(code: string | null | undefined): string {
  return code ? (DEGREE_TH[code] ?? code) : '';
}

export function studyPlanTh(code: string | null | undefined): string {
  return code ? (STUDY_PLAN_TH[code] ?? code) : '';
}

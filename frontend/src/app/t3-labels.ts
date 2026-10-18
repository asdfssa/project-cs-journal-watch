/**
 * X31: ค่า enum ของ T3 จาก backend → ข้อความที่แสดงบนหน้าจอ (ใช้ร่วมกันทุกหน้า)
 * ค่าที่ไม่รู้จัก (เช่นข้อมูลเก่าที่เก็บเป็นข้อความไทยไว้แล้ว) แสดงตามเดิม ไม่ปล่อยให้ว่าง
 */

/** publication_details.status — backend ส่ง 'Published' | 'Accepted' (ตัวใหญ่) แต่หน้าจอเทียบตัวเล็ก */
export function normalizePubStatus(v: string | null | undefined): string {
  return (v ?? '').toLowerCase();
}

/** publication_details.type — backend คำนวณจาก Pre-T3 (B31) · ยืนยันรายการ enum แล้ว 9-10-2569 */
const PUB_TYPE_LABELS: Record<string, string> = {
  International_Journal: 'วารสารวิชาการระดับนานาชาติ',
  National_TCI_Tier1:    'วารสารวิชาการระดับชาติ (TCI กลุ่ม 1)',
  National_TCI_Tier2:    'วารสารวิชาการระดับชาติ (TCI กลุ่ม 2)',
  // มีใน ENUM ของ DB แต่ backend ปัจจุบันไม่สร้างแล้ว (ข้อมูลเก่าอาจยังมี)
  International_Conference:        'การประชุมวิชาการระดับนานาชาติ',
  National_Conference:             'การประชุมวิชาการระดับชาติ',
  Intl_Journal_Faculty_Recognized: 'วารสารนานาชาติที่คณะรับรอง',
};

export function pubTypeLabel(v: string | null | undefined): string {
  if (!v) return '';
  return PUB_TYPE_LABELS[v] ?? v;
}

/** paper_and_research_details.innovation_type */
const INNOVATION_TYPE_LABELS: Record<string, string> = {
  Commercial:      'การนำไปใช้ประโยชน์เชิงพาณิชย์',
  Social_Economic: 'การนำไปใช้ประโยชน์เชิงสังคม/เศรษฐกิจ',
  Policy_Public:   'การนำไปใช้ประโยชน์เชิงนโยบายสาธารณะ',
  None:            'ไม่มี',
};

export function innovationTypeLabel(v: string | null | undefined): string {
  if (!v) return '';
  return INNOVATION_TYPE_LABELS[v] ?? v;
}

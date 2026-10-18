/**
 * สาขาวิชาของนิสิต (users.department) — backend เก็บเป็น ENUM ต้องส่งข้อความไทยตรงตัวอักษร ห้ามใช้ตัวย่อ
 * ปริญญาเอก (Doctoral) เลือกได้แค่ 3 สาขาแรก — 2 สาขาท้ายมีเฉพาะปริญญาโท
 */
export const DEPARTMENTS = [
  'วิทยาการคอมพิวเตอร์',
  'เทคโนโลยีสารสนเทศ',
  'สื่อนฤมิต',
  'สารสนเทศและนวัตกรรมดิจิทัล',
  'นิเทศศาสตร์สร้างสรรค์ดิจิทัล',
] as const;

// array คงที่ (ไม่สร้างใหม่ทุกครั้ง) — ใช้ใน template ทุกรอบ change detection
const ALL_DEPARTMENTS: string[] = [...DEPARTMENTS];
const DOCTORAL_DEPARTMENTS: string[] = ALL_DEPARTMENTS.slice(0, 3);

/** ตัวเลือกสาขาตามระดับการศึกษา (ยังไม่เลือกระดับ = แสดงทั้งหมด) */
export function departmentOptions(degreeLevel: string | null | undefined): string[] {
  return degreeLevel === 'Doctoral' ? DOCTORAL_DEPARTMENTS : ALL_DEPARTMENTS;
}

/** สาขาที่เลือกไว้ยังใช้ได้กับระดับนี้ไหม — ค่าว่าง (ไม่ระบุ) ใช้ได้เสมอ */
export function departmentFits(department: string | null | undefined, degreeLevel: string | null | undefined): boolean {
  return !department || departmentOptions(degreeLevel).includes(department);
}

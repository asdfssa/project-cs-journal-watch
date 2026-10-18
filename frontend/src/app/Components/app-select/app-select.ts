import { Component, ElementRef, HostListener, Input, OnDestroy, ViewChild, computed, forwardRef, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export type SelectOption = string | { value: string; label: string };
export interface SelectGroup { group: string; values: SelectOption[] }

interface FlatOption { value: string; label: string; group?: string }

/**
 * Dropdown แทน <select> ของเบราว์เซอร์ (รายการตัวเลือกแบบ native ตกแต่งไม่ได้)
 * ใช้กับ [(ngModel)] ได้เหมือน <select> เดิม — ส่ง options หรือ groups (แทน optgroup) เข้ามา
 * panel ใช้ position: fixed เพื่อไม่ให้ถูกตัดใน modal ที่ overflow: hidden/auto
 */
@Component({
  selector: 'app-select',
  standalone: true,
  templateUrl: './app-select.html',
  styleUrl: './app-select.scss',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AppSelect), multi: true }],
})
export class AppSelect implements ControlValueAccessor, OnDestroy {
  @Input() set options(v: SelectOption[] | null | undefined) { this._options.set(v ?? []); }
  @Input() set groups(v: SelectGroup[] | null | undefined) { this._groups.set(v ?? []); }
  /** ข้อความของตัวเลือกค่าว่าง — ส่ง null ถ้าไม่ต้องการให้เลือกค่าว่างได้ */
  @Input() emptyLabel: string | null = '— ไม่ระบุ —';

  @ViewChild('trigger', { static: true }) trigger!: ElementRef<HTMLButtonElement>;

  private _options = signal<SelectOption[]>([]);
  private _groups  = signal<SelectGroup[]>([]);

  readonly value    = signal('');
  readonly open     = signal(false);
  readonly disabled = signal(false);
  readonly active   = signal(-1);
  readonly panelStyle = signal<Record<string, string>>({});

  /** รายการทั้งหมดเรียงตามที่แสดง (รวมค่าว่างไว้ตัวแรก) ใช้กับคีย์บอร์ด */
  readonly flat = computed<FlatOption[]>(() => {
    const norm = (o: SelectOption, group?: string): FlatOption =>
      typeof o === 'string' ? { value: o, label: o, group } : { ...o, group };
    const list: FlatOption[] = [];
    if (this.emptyLabel !== null) list.push({ value: '', label: this.emptyLabel });
    list.push(...this._options().map(o => norm(o)));
    for (const g of this._groups()) list.push(...g.values.map(o => norm(o, g.group)));
    return list;
  });

  readonly selectedLabel = computed(() => {
    const hit = this.flat().find(o => o.value === this.value());
    return hit ? hit.label : this.value();
  });

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private host: ElementRef<HTMLElement>) {}

  writeValue(v: unknown): void { this.value.set(v == null ? '' : String(v)); }
  registerOnChange(fn: (v: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.disabled.set(d); }

  toggle() {
    if (this.open()) this.close();
    else this.openPanel();
  }

  private openPanel() {
    if (this.disabled()) return;
    const r = this.trigger.nativeElement.getBoundingClientRect();
    const maxH = 260;
    const below = window.innerHeight - r.bottom;
    const up = below < Math.min(maxH, this.flat().length * 40) + 16 && r.top > below;
    this.panelStyle.set({
      left:  `${r.left}px`,
      width: `${r.width}px`,
      maxHeight: `${Math.min(maxH, (up ? r.top : below) - 16)}px`,
      ...(up ? { bottom: `${window.innerHeight - r.top + 6}px` } : { top: `${r.bottom + 6}px` }),
    });
    this.active.set(Math.max(0, this.flat().findIndex(o => o.value === this.value())));
    this.open.set(true);
    window.addEventListener('scroll', this.onScroll, true);
  }

  close() {
    if (!this.open()) return;
    window.removeEventListener('scroll', this.onScroll, true);
    this.open.set(false);
    this.onTouched();
  }

  pick(o: FlatOption) {
    this.value.set(o.value);
    this.onChange(o.value);
    this.close();
    this.trigger.nativeElement.focus();
  }

  onKeydown(e: KeyboardEvent) {
    const list = this.flat();
    if (!this.open()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); this.openPanel(); }
      return;
    }
    if (e.key === 'ArrowDown')      { e.preventDefault(); this.active.set(Math.min(list.length - 1, this.active() + 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); this.active.set(Math.max(0, this.active() - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const o = list[this.active()]; if (o) this.pick(o); }
    else if (e.key === 'Escape' || e.key === 'Tab') { this.close(); }
  }

  /**
   * เลื่อนหน้า/modal แล้ว panel (fixed) จะลอยหลุดจากช่อง — ปิดทิ้ง ยกเว้นเลื่อนภายใน panel เอง
   * ต้องฟังแบบ capture เพราะ scroll ของ element ข้างใน (เช่น body ของ modal) ไม่ bubble ขึ้น window
   */
  private readonly onScroll = (e: Event) => {
    if (!this.host.nativeElement.contains(e.target as Node)) this.close();
  };

  ngOnDestroy() { window.removeEventListener('scroll', this.onScroll, true); }

  @HostListener('window:resize')
  onResize() { this.close(); }

  showGroupHeader(i: number): boolean {
    const list = this.flat();
    return !!list[i].group && list[i].group !== list[i - 1]?.group;
  }
}

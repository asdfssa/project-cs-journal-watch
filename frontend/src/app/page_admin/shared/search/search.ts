import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin, of, Observable } from 'rxjs';
import { catchError, shareReplay, switchMap } from 'rxjs/operators';
import { AuthService, readStoredAdmin } from '../../../auth.service';
import { renderTurnstile, resetTurnstile, removeTurnstile } from '../../../turnstile';
import { Constants } from '../../../comfig/constants';
import { ScrapeScopusRes, Data } from '../../../model/res/Scrape_Scopus_res';
import { ScrapeTCIRes, Data as TciData } from '../../../model/res/Scrape_TCI_res';
import { CheckMsuUnwantedRes } from '../../../model/res/check_msu_Unwanted_res';

type FetchMethod = 'scraping' | 'api';
type DegreeLevel = 'doctoral' | 'master';
type ActiveDb = 'scopus' | 'tci' | 'conflict';

interface TciJournalResult {
  journal: string;
  journalTh: string | null;
  issn: string;
  eissn: string | null;
  publisher: string;
  publisherTh: string;
  abbrev: string;
  tier: number;
  status: string;
  inactive: boolean;
  majorArea: string;
  website: string;
  issuePerVolume: string;
  isUnwanted: boolean;
  passForDoctoral: boolean;
  passForMaster: boolean;
  checkDate: string;
  cachedAt: string | null; // เวลาที่ดึงข้อมูลจริง เมื่อผลมาจาก cache (null = ดึงสดจากต้นทาง)
}

interface JournalResult {
  journal: string;
  issn: string;
  eissn: string | null;
  publisher: string;
  database: string;
  quartile: string;
  quartileYear: string;
  quartileField: string;
  status: string;
  sjr: number;
  citeScore: number;
  snip: number;
  percentile: number;
  citesPerDoc2y: number | null;
  totalDocs: number | null;
  subjectAreaMain: string | null;
  subjectAreaSub: string | null;
  country: string | null;
  openAccess: string | null;
  openAccessType: string | null;
  isUnwanted: boolean;
  isPredatory: boolean;
  coverageStart: string;
  coverageEnd: string;
  case: number;
  caseColor: string;
  caseLabel: string;
  bannerIcon: string;
  bannerDesc: string;
  blacklistReasons: string[];
  passForDoctoral: boolean;
  passForMaster: boolean;
  checkDate: string;
  cachedAt: string | null; // เวลาที่ดึงข้อมูลจริง เมื่อผลมาจาก cache (null = ดึงสดจากต้นทาง)
}

@Component({
  standalone: true,
  selector: 'app-search',
  imports: [CommonModule, FormsModule],
  templateUrl: './search.html',
  styleUrls: ['./search.scss'],
})
export class Search implements OnInit, OnDestroy {
  ngOnInit(): void {
    window.scrollTo({ top: 0 });
  }
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);
  private router    = inject(Router);

  issn = '';
  degree: DegreeLevel = 'doctoral';
  /* ไม่ให้ผู้ใช้เลือกเองอีกต่อไป — เริ่มค้นหาด้วย API เสมอ แล้วสลับไป Web Scraping
     ให้อัตโนมัติถ้า API ติด rate limit/quota (ดู runSearch()) ค่านี้ยังคงไว้เพื่อ
     ให้ loading-sub ในเทมเพลตแสดงข้อความที่ตรงกับ method ที่กำลังใช้งานจริง ณ ขณะนั้น */
  method: FetchMethod = 'api';
  isLoading    = signal(false);
  // true ช่วงที่ API ติด rate limit/quota แล้วกำลังลองใหม่ด้วย Web Scraping อัตโนมัติ
  // ใช้โชว์ข้อความแยกให้ผู้ใช้เห็นว่าทำไมถึงรอนานกว่าปกติ ไม่ใช่แค่ loading เฉยๆ
  isRetrying   = signal(false);
  hasSearched  = signal(false);
  result       = signal<JournalResult | null>(null);
  tciResult    = signal<TciJournalResult | null>(null);
  errorMessage = signal('');
  tciError     = signal('');
  /** X37: เช็ครายการ MSU Unwanted ไม่สำเร็จ — ห้ามสรุปว่า "ไม่ติด" / "ผ่านเกณฑ์" */
  unwantedUnknown = signal(false);
  activeDb     = signal<ActiveDb>('scopus');

  // ── DEGREE DROPDOWN ──
  showDegreeMenu = signal(false);

  selectDegree(value: DegreeLevel): void {
    this.degree = value;
    this.showDegreeMenu.set(false);
  }

  get degreeOptions(): { value: DegreeLevel; label: string }[] {
    return [
      { value: 'doctoral', label: 'ป.เอก (Doctoral)' },
      { value: 'master',   label: 'ป.โท (Master)' },
    ];
  }

  get selectedDegreeLabel(): string {
    return this.degreeOptions.find(o => o.value === this.degree)?.label ?? '';
  }

  comparison = [
    { label: 'API Key',     scraping: 'ไม่ต้องใช้',  api: 'ต้องใช้',         scrapingOk: true,  apiOk: false },
    { label: 'ความเร็ว',   scraping: '3–8 วินาที',   api: '< 1 วินาที',      scrapingOk: false, apiOk: true  },
    { label: 'Rate Limit',  scraping: 'ไม่มี',        api: '20,000/สัปดาห์', scrapingOk: true,  apiOk: false },
    { label: 'ค่าใช้จ่าย', scraping: 'ฟรี',          api: 'ฟรี (สถาบัน)',   scrapingOk: true,  apiOk: true  },
  ];

  legends = [
    // กลุ่มผ่านเกณฑ์
    { color: '#1A5FAB', label: 'ผ่านเกณฑ์สากล (Scopus)' },
    { color: '#1A7A42', label: 'ผ่านเกณฑ์มาตรฐาน (TCI กลุ่ม 1–2)' },
    // กลุ่มเฝ้าระวัง
    { color: '#D35400', label: 'ข้อมูลขัดแย้งระหว่างระบบ (Scopus / TCI)' },
    { color: '#C07800', label: 'แจ้งเตือน: MSU Unwanted แต่ Scopus Active' },
    // กลุ่มปฏิเสธ
    { color: '#962D2D', label: 'ปฏิเสธ: MSU Unwanted (ไม่อนุมัติการจบ)' },
    { color: '#7B1C1C', label: 'ปฏิเสธ: อยู่ในรายการเฝ้าระวัง (Watchlist)' },
  ];

  // ── CAPTCHA (Cloudflare Turnstile) ──
  // ค้นได้ฟรีตามโควตาของ backend (captchaIfFrequent) เกินแล้วจะได้ 428 CAPTCHA_REQUIRED
  // → ค่อยโชว์ widget "ฉันไม่ใช่บอท" ได้ token แล้วยิงคำค้นเดิมซ้ำพร้อม header X-Captcha-Token
  // ผ่านแล้ว backend ให้โควตารอบใหม่ ไม่ต้องขอ token ทุกครั้ง
  captchaOpen    = signal(false);
  captchaMessage = signal('');
  captchaError   = signal('');
  private captchaWidgetId: string | null = null;
  private pendingMethod: FetchMethod = 'api';

  /* widget อยู่ใน @if (captchaOpen()) — element โผล่มาเมื่อไหร่ค่อยวาด Turnstile ลงไป */
  @ViewChild('captchaBox') set captchaBox(ref: ElementRef<HTMLElement> | undefined) {
    if (!ref || this.captchaWidgetId) return;
    renderTurnstile(ref.nativeElement, {
      onToken:   token => this.onCaptchaToken(token),
      onExpired: () => this.captchaError.set('การยืนยันหมดอายุ กรุณายืนยันใหม่อีกครั้ง'),
      onError:   () => this.captchaError.set('โหลด CAPTCHA ไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองใหม่'),
    }).then(id => {
      if (this.captchaOpen()) this.captchaWidgetId = id;
      else removeTurnstile(id);             // ปิดไปก่อนที่สคริปต์จะโหลดเสร็จ
    }).catch(() => this.captchaError.set('โหลด CAPTCHA ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'));
  }

  ngOnDestroy(): void {
    removeTurnstile(this.captchaWidgetId);
  }

  private isCaptchaError(err: any): boolean {
    const code = err?.error?.code as string | undefined;
    return err?.status === 428 || code === 'CAPTCHA_REQUIRED' || code === 'CAPTCHA_INVALID' || code === 'CAPTCHA_UNAVAILABLE';
  }

  private openCaptcha(method: FetchMethod, err: any): void {
    const code = err?.error?.code as string | undefined;
    this.pendingMethod = method;
    this.captchaMessage.set(
      code === 'CAPTCHA_REQUIRED' && err?.error?.message
        ? err.error.message
        : 'คุณค้นหาบ่อยเกินไป กรุณายืนยันว่าไม่ใช่บอท');
    this.captchaError.set(
      code === 'CAPTCHA_INVALID'     ? 'ยืนยันไม่ผ่าน กรุณายืนยันใหม่อีกครั้ง' :
      code === 'CAPTCHA_UNAVAILABLE' ? 'ยืนยัน CAPTCHA ไม่ได้ตอนนี้ ลองใหม่อีกครั้ง' : '');
    resetTurnstile(this.captchaWidgetId);   // token ใช้ได้ครั้งเดียว — ให้ผู้ใช้ยืนยันใหม่
    this.captchaOpen.set(true);
    this.isLoading.set(false);
    this.isRetrying.set(false);
  }

  private onCaptchaToken(token: string): void {
    this.captchaError.set('');
    this.isLoading.set(true);
    this.runSearch(this.pendingMethod, token);
  }

  private closeCaptcha(): void {
    removeTurnstile(this.captchaWidgetId);
    this.captchaWidgetId = null;
    this.captchaOpen.set(false);
    this.captchaError.set('');
  }

  search(): void {
    this.doSearch();
  }

  /**
   * N18: การค้นหาแต่ละครั้งมีเลขลำดับ + ISSN ของตัวเอง — กด Enter ซ้ำระหว่างกำลังค้น (ปุ่มกดไม่ได้แต่ Enter ยังได้)
   * ผลของการค้นหาเก่าที่กลับมาทีหลังต้องไม่ทับผลใหม่ ไม่งั้นหน้าจอโชว์ผลวารสาร A ขณะที่ช่องค้นหาเป็น B
   * (และ fallback ไป scraping / ยิงซ้ำหลัง CAPTCHA ใช้ ISSN ตอนกดค้นหา ไม่ใช่ที่พิมพ์ค้างในช่องภายหลัง)
   */
  private searchSeq    = 0;
  private searchedIssn = '';

  doSearch(): void {
    if (!this.issn.trim()) return;
    this.searchSeq++;
    this.searchedIssn = this.issn.trim();
    this.isLoading.set(true);
    this.isRetrying.set(false);
    this.hasSearched.set(false);
    this.result.set(null);
    this.tciResult.set(null);
    this.errorMessage.set('');
    this.tciError.set('');
    this.unwantedUnknown.set(false);

    // เริ่มค้นหาด้วย API เสมอ — runSearch() จะสลับไป Web Scraping ให้เองถ้า API ติด limit
    this.method = 'api';
    this.runSearch('api');
  }

  /* X25: ตัดสินจาก code ก่อน แล้วค่อยดู HTTP status — ไม่พึ่ง debug.raw_message
     (production ไม่ส่ง debug) และไม่พึ่งคำว่า "quota" ในข้อความ (ข้อความเปลี่ยนได้)
     - Scopus API: 503 SCOPUS_QUOTA_EXCEEDED = โควตาหมด/key ถูกล็อก/ชน throttle → สลับไป scraping
     - TCI API: ไม่มีโควตา ถ้าพัง (5xx SERVER_ERROR) ก็สลับไป scraping ได้เหมือนกัน */
  private shouldFallbackToScraping(err: any, db: 'scopus' | 'tci'): boolean {
    if (!err) return false;
    if (err?.error?.code === 'SCOPUS_QUOTA_EXCEEDED') return true;
    if (db === 'scopus' && err?.status === 503)       return true;
    if (db === 'tci'    && err?.status >= 500)        return true;
    return false;
  }

  /* ข้อความ error ที่แสดงในการ์ดผลค้นหา — message จาก backend เป็นภาษาไทยแสดงตรงได้
     ยกเว้น 404 (ไม่พบวารสาร) และ 400 (ISSN ผิด) ที่ backend ยังส่งภาษาอังกฤษ */
  private searchErrorMessage(err: any, dbLabel: string): string {
    const code   = err?.error?.code as string | undefined;
    const status = err?.status as number | undefined;
    const thaiMsg = (err?.error?.message as string | undefined) ?? '';

    if (code === 'SCRAPER_BUSY' || code === 'SCRAPER_USER_BUSY')
      return thaiMsg || 'ระบบค้นหาไม่ว่างในขณะนี้ (มีผู้ใช้งานจำนวนมาก) กรุณารอประมาณ 10 วินาทีแล้วลองใหม่';
    if (code === 'RATE_LIMIT') {
      const wait = Number(err?.headers?.get?.('Retry-After'));
      return (thaiMsg || 'ค้นหาบ่อยเกินไป') + (wait > 0 ? ` (ลองใหม่ได้ในอีก ${Math.ceil(wait / 60)} นาที)` : '');
    }
    if (code === 'CAPTCHA_REQUIRED' || code === 'CAPTCHA_INVALID')
      return thaiMsg || 'กรุณายืนยันว่าไม่ใช่บอทก่อนค้นหาต่อ';
    if (status === 404) return `ไม่พบข้อมูลวารสารใน ${dbLabel}`;
    if (status === 400) return 'รูปแบบ ISSN ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง (เช่น 1234-5678)';
    if (!status)        return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง';
    if (status >= 500)  return thaiMsg || `ระบบค้นหา ${dbLabel} ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง`;
    return thaiMsg || `ไม่พบข้อมูลวารสารใน ${dbLabel}`;
  }

  private runSearch(method: FetchMethod, captchaToken?: string): void {
    const seq = this.searchSeq;
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const issn = encodeURIComponent(this.searchedIssn);
    const issnDashed = encodeURIComponent(this.toDashedIssn(this.searchedIssn));

    const scopusUrl = method === 'api'
      ? `${this.constants.API_ENDPOINT}/journal/scopus?issn=${issn}`
      : `${this.constants.API_ENDPOINT}/journal/scopus/scrape?issn=${issn}`;

    const tciUrl = method === 'api'
      ? `${this.constants.API_ENDPOINT}/journal/tci?issn=${issn}`
      : `${this.constants.API_ENDPOINT}/journal/tci/scrape?issn=${issn}`;

    // เก็บ error ดิบไว้ด้วย (ไม่ใช่แค่ null) เพื่อเอาไปตรวจว่าเป็น quota error หรือเปล่า
    const withRawError = <T>(obs: Observable<T>) =>
      obs.pipe(catchError(err => of({ __httpError: err } as any)));

    // token ของ Turnstile verify ได้ครั้งเดียว — ถ้ามี token ให้ยิง scopus (แนบ token) ก่อน
    // พอ backend ให้โควตารอบใหม่แล้วค่อยยิง tci/unwanted ตาม ไม่งั้นสอง request ถือ token เดียวกันจะชนกัน
    const scopus$ = withRawError(this.http.get<ScrapeScopusRes>(scopusUrl, {
      headers: captchaToken ? headers.set('X-Captcha-Token', captchaToken) : headers,
    })).pipe(shareReplay(1));
    const afterScopus = <T>(obs: Observable<T>) => captchaToken ? scopus$.pipe(switchMap(() => obs)) : obs;

    forkJoin({
      scopus:   scopus$,
      tci:      afterScopus(withRawError(this.http.get<ScrapeTCIRes>(tciUrl, { headers }))),
      unwanted: afterScopus(withRawError(this.http.get<CheckMsuUnwantedRes>(
        `${this.constants.API_ENDPOINT}/unwanted-journals/check/${issnDashed}`, { headers }))),
    }).subscribe(({ scopus, tci, unwanted }) => {
      if (seq !== this.searchSeq) return;   // N18: มีการค้นหาใหม่กว่าแล้ว — ทิ้งผลเก่า
      const scopusErr   = (scopus as any)?.__httpError;
      const tciErr      = (tci as any)?.__httpError;
      const unwantedErr = (unwanted as any)?.__httpError;

      // เกินโควตาค้นหา (428) / token ไม่ผ่าน / Cloudflare ล่ม (503) → ให้ยืนยัน CAPTCHA แล้วค่อยยิงซ้ำ
      // ต้องเช็คก่อน fallback เพราะ 503 CAPTCHA_UNAVAILABLE จะถูกตีความเป็น Scopus quota หมด
      const captchaErr = [scopusErr, tciErr, unwantedErr].find(e => this.isCaptchaError(e));
      if (captchaErr) {
        this.openCaptcha(method, captchaErr);
        return;
      }
      if (this.captchaOpen()) this.closeCaptcha();

      // ถ้ายังใช้ API อยู่ และเจอสัญญาณ key ติด limit/quota จากฝั่งไหนก็ตาม
      // ให้ลองค้นหาใหม่ทั้งชุดด้วย Web Scraping แทนโดยอัตโนมัติ ไม่ต้องให้ผู้ใช้ทำอะไร
      if (method === 'api' && (this.shouldFallbackToScraping(scopusErr, 'scopus') || this.shouldFallbackToScraping(tciErr, 'tci'))) {
        this.method = 'scraping';
        this.isRetrying.set(true); // โชว์ข้อความแจ้งว่ากำลังสลับไป Web Scraping ให้ผู้ใช้เห็น
        this.runSearch('scraping');
        return;
      }

      this.isRetrying.set(false);

      const scopusRes = scopusErr ? null : (scopus as ScrapeScopusRes | null);
      const tciRes    = tciErr    ? null : (tci as ScrapeTCIRes | null);


      const unwantedRes = unwantedErr ? null : (unwanted as CheckMsuUnwantedRes | null);
      const isUnwanted  = unwantedRes?.success ? unwantedRes.data.isUnwanted : false;
      // X37: เดิมเช็คไม่สำเร็จ (5xx/เน็ตหลุด) = ถือว่าไม่ติด → วารสารต้องห้ามขึ้นว่าผ่านเกณฑ์
      const unwantedUnknown = !unwantedRes?.success;
      this.unwantedUnknown.set(unwantedUnknown);

      if (scopusRes?.success && scopusRes.data && (scopusRes.data as any).journal_name) {
        this.result.set(this.mapResult(scopusRes.data as unknown as Data, isUnwanted, unwantedUnknown));
      } else {
        this.errorMessage.set(scopusErr ? this.searchErrorMessage(scopusErr, 'Scopus') : 'ไม่พบข้อมูลวารสารใน Scopus');
      }

      if (tciRes?.success && tciRes.data && (tciRes.data as any).journal_name) {
        this.tciResult.set(this.mapTciResult(tciRes.data as unknown as TciData, isUnwanted, unwantedUnknown));
      } else {
        this.tciError.set(tciErr ? this.searchErrorMessage(tciErr, 'TCI') : 'ไม่พบข้อมูลวารสารใน TCI');
      }

      this.hasSearched.set(true);
      this.isLoading.set(false);

      if (this.hasConflict) this.activeDb.set('conflict');
      else if (!this.result() && this.tciResult()) this.activeDb.set('tci');
      else this.activeDb.set('scopus');

      this.scrollToResultsOnMobile();
    });
  }

  /* บนมือถือ ฟอร์มค้นหา + legend กินพื้นที่เกือบเต็มจอ พอได้ผลลัพธ์แล้วผู้ใช้ต้อง
     เลื่อนจอเองถึงจะเห็น — เลื่อนลงไปที่ผลลัพธ์ให้อัตโนมัติ เฉพาะจอแคบ (มือถือ)
     เท่านั้น ไม่ยุ่งกับเดสก์ท็อปที่เห็นผลลัพธ์อยู่แล้วโดยไม่ต้องเลื่อน */
  private scrollToResultsOnMobile(): void {
    if (window.innerWidth > 768) return;
    setTimeout(() => {
      document.querySelector('.db-toggle-row')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  /* ป้าย "ข้อมูลจาก cache": backend ส่ง fromCache + cached_at (เวลาที่ดึงข้อมูลจริง) · ดึงสด = null */
  private cachedAtLabel(data: { fromCache?: boolean; cached_at?: string | null }): string | null {
    if (!data.fromCache) return null;
    if (!data.cached_at) return 'ไม่ทราบเวลา';
    return new Date(data.cached_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' น.';
  }

  private mapResult(data: Data, isUnwanted: boolean, unwantedUnknown = false): JournalResult {
    const extra     = data as any;
    const quartile  = data.scopus_best_quartile ?? '';
    const isActive  = !data.scopus_discontinued;
    const isPredatory: boolean =
      extra.is_predatory ?? extra.is_blacklisted ?? extra.predatory ?? false;

    const qEntry = data.scopus_quartile_data?.[0];
    const quartileField = qEntry?.field ?? '';
    const quartileYear  = qEntry?.year  ?? '';

    const qNum = parseInt(quartile.replace('Q', '')) || 99;
    const passForDoctoral = qNum <= 2 && isActive && !isUnwanted && !isPredatory && !unwantedUnknown;
    const passForMaster   = qNum <= 3 && isActive && !isUnwanted && !isPredatory && !unwantedUnknown;

    let caseNum    = 1;
    let caseColor  = '#1A5FAB';
    let caseLabel  = '';
    let bannerIcon = 'ti ti-check';
    let bannerDesc = '';
    let blacklistReasons: string[] =
      extra.blacklist_reasons ?? extra.predatory_reasons ?? [];

    if (isPredatory) {
      caseNum   = 3;
      caseColor = '#7B1C1C';
      caseLabel = 'ปฏิเสธ: อยู่ในรายการเฝ้าระวัง (Watchlist)';
      bannerIcon = 'ti ti-ban';
      bannerDesc = 'วารสารนี้ถูกระบุว่าเป็น Predatory Journal ห้ามนำไปใช้ยื่นเอกสาร Pre-T3 / T3 โดยเด็ดขาด และอาจส่งผลต่อการพิจารณาการสำเร็จการศึกษา';
      if (blacklistReasons.length === 0) {
        blacklistReasons = [
          'ปรากฏใน Beall\'s List of Predatory Journals (ฉบับปรับปรุง 2025)',
          'ไม่มีกระบวนการ Peer Review ที่ถูกต้องและโปร่งใส',
          'มีพฤติกรรมเรียกเก็บค่าตีพิมพ์ (APC) โดยไม่มีมาตรฐาน',
          'ไม่ปรากฏใน Scopus, Web of Science หรือ TCI',
          'ข้อมูล Impact Factor ที่แสดงเป็นการกล่าวอ้างที่ไม่มีหลักฐาน',
        ];
      }
    } else if (isUnwanted && isActive) {
      caseNum   = 5;
      caseColor = '#C07800';
      caseLabel = 'MSU Unwanted (Scopus Active)';
      bannerIcon = 'ti ti-alert-triangle';
      bannerDesc = `วารสารนี้ได้รับการจัดอยู่ใน Scopus Quartile ${quartile} มีสถานะ Active แต่ปรากฏในรายการ MSU Unwanted Journals ไม่สามารถนำไปยื่น Pre-T3 / T3 ได้`;
    } else if (isUnwanted) {
      caseNum   = 4;
      caseColor = '#962D2D';
      caseLabel = 'ปฏิเสธ: MSU Unwanted (ไม่อนุมัติการจบ)';
      bannerIcon = 'ti ti-alert-triangle';
      bannerDesc = 'วารสารนี้ปรากฏในรายการ MSU Unwanted Journals ไม่สามารถนำไปยื่น Pre-T3 / T3 ได้';
    } else if (!isActive) {
      caseColor = '#888888';
      caseLabel = 'วารสาร Scopus หยุดตีพิมพ์แล้ว (Discontinued)';
      bannerIcon = 'ti ti-alert-triangle';
      bannerDesc = `วารสารนี้ได้รับการจัดอยู่ใน Scopus Quartile ${quartile} แต่มีสถานะ Discontinued ณ ปีปัจจุบัน ไม่สามารถนำไปยื่น Pre-T3 / T3 ได้`;
    } else if (unwantedUnknown) {
      caseColor  = '#C07800';
      caseLabel  = 'ยังสรุปผลไม่ได้ — ตรวจสอบรายการ MSU Unwanted ไม่สำเร็จ';
      bannerIcon = 'ti ti-alert-triangle';
      bannerDesc = `วารสารนี้อยู่ใน Scopus Quartile ${quartile} แต่ระบบตรวจสอบรายการวารสารต้องห้าม (MSU Unwanted) ไม่สำเร็จ จึงยังยืนยันไม่ได้ว่านำไปยื่น Pre-T3 / T3 ได้ กรุณาค้นหาใหม่อีกครั้ง`;
    } else if (passForDoctoral) {
      
      caseColor  = '#1A5FAB';
      caseLabel  = 'พบในฐานข้อมูล Scopus — ผ่านเกณฑ์ทุกระดับ';
      bannerIcon = 'ti ti-check';
      bannerDesc = `วารสารนี้ได้รับการจัดอยู่ใน Scopus Quartile ${quartile} มีสถานะ Active และไม่ปรากฏในรายการ MSU Unwanted Journals สามารถนำไปยื่น Pre-T3 / T3 ได้ทั้ง ป.เอก และ ป.โท`;
    } else if (passForMaster) {
      caseColor  = '#1A5FAB';
      caseLabel  = 'Scopus Q3 — ผ่านเกณฑ์เฉพาะ ป.โท';
      bannerIcon = 'ti ti-alert-circle';
      bannerDesc = `วารสารนี้ได้รับการจัดอยู่ใน Scopus Quartile ${quartile} มีสถานะ Active ผ่านเกณฑ์สำหรับ ป.โท แผน 2 แต่ไม่ผ่านเกณฑ์สำหรับ ป.เอก (ต้องการ Q2 ขึ้นไป)`;
    } else {
      
      caseColor  = '#64748B';
      caseLabel  = `Scopus ${quartile} — ไม่ผ่านเกณฑ์ Quartile`;
      bannerIcon = 'ti ti-x';
      bannerDesc = `วารสารนี้ได้รับการจัดอยู่ใน Scopus Quartile ${quartile} มีสถานะ Active แต่ไม่ผ่านเกณฑ์ Quartile ที่ มมส. กำหนด (ต้องการ Q2 สำหรับ ป.เอก หรือ Q3 สำหรับ ป.โท)`;
    }

    const now = new Date();

    return {
      journal: data.journal_name,
      issn: data.issn,
      eissn: data.eissn,
      publisher: data.publisher,
      database: data.database_source,
      quartile,
      quartileYear,
      quartileField,
      status: isActive ? 'Active' : 'Discontinued',
      sjr: data.scopus_sjr,
      citeScore: data.scopus_citescore,
      snip: data.scopus_snip,
      percentile: data.scopus_best_percentile,
      citesPerDoc2y: extra.scopus_cites_per_doc ?? null,
      totalDocs: extra.scopus_total_docs ?? null,
      // main_area / major_area เป็นฟิลด์ของ TCI จึงว่างเสมอสำหรับ Scopus — Scopus ส่งมาใน subject_areas (array)
      subjectAreaMain: extra.subject_areas?.[0]?.area ?? null,
      subjectAreaSub: extra.subject_areas?.[1]?.area ?? null,
      country: extra.country ?? null,
      openAccess: extra.open_access ?? extra.openAccess ?? null,
      openAccessType: extra.open_access_type ?? extra.openAccessType ?? null,
      isUnwanted,
      isPredatory,
      coverageStart: data.coverage_start_year,
      coverageEnd: data.coverage_end_year,
      case: caseNum,
      caseColor,
      caseLabel,
      bannerIcon,
      bannerDesc,
      blacklistReasons,
      passForDoctoral,
      passForMaster,
      checkDate: now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }),
      cachedAt: this.cachedAtLabel(data),
    };
  }

  private mapTciResult(data: TciData, isUnwanted: boolean, unwantedUnknown = false): TciJournalResult {
    const tier     = data.tci_tier ?? 99;
    const inactive = data.tci_inactive ?? false;
    // ป.เอก ยื่นด้วยวารสาร TCI ไม่ได้ทุกกลุ่ม — ต้องเป็น Scopus (Q1–Q2) เท่านั้น · ป.โท ใช้ได้ทั้ง Scopus และ TCI กลุ่ม 1–2
    const passForDoctoral = false;
    const passForMaster   = tier <= 2 && !inactive && !isUnwanted && !unwantedUnknown;
    const now = new Date();
    return {
      journal:        data.journal_name,
      journalTh:      data.journal_name_th,
      issn:           data.issn,
      eissn:          data.eissn,
      publisher:      data.publisher,
      publisherTh:    data.publisher_th,
      abbrev:         data.abbrev_name,
      tier,
      status:         data.tci_status,
      inactive,
      majorArea:      data.major_area,
      website:        data.website,
      issuePerVolume: data.issue_per_volume,
      isUnwanted,
      passForDoctoral,
      passForMaster,
      checkDate: now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }),
      cachedAt: this.cachedAtLabel(data),
    };
  }

  get passForCurrentDegree(): boolean {
    const r = this.result();
    if (!r) return false;
    return this.degree === 'doctoral' ? r.passForDoctoral : r.passForMaster;
  }

  get criteriaQuartileOk(): boolean {
    const r = this.result();
    if (!r) return false;
    const qNum = parseInt(r.quartile.replace('Q', '')) || 99;
    return this.degree === 'doctoral' ? qNum <= 2 : qNum <= 3;
  }

  get requiredQuartile(): string {
    return this.degree === 'doctoral' ? 'Q2' : 'Q3';
  }

  get degreeLabel(): string {
    return this.degree === 'doctoral' ? 'ป.เอก แผน 2 แบบ 2.1' : 'ป.โท แผน 2';
  }

  get isStudent(): boolean {
    const role = this.auth.user?.role
      ?? (readStoredAdmin() as any)?.role;
    return role?.toLowerCase() === 'student';
  }

  get hasConflict(): boolean {
    const r = this.result();
    const t = this.tciResult();
    if (!r || !t) return false;
    return r.status === 'Discontinued' && !t.inactive;
  }

  goToPreT3Scopus(): void {
    const r = this.result();
    if (!r || !this.passForCurrentDegree) return;
    this.router.navigate(['/pre-t3'], { state: {
      journalName:   r.journal,
      journalNameTh: '',
      issn:          r.issn,
      eissn:         r.eissn ?? '',
      database:      'Scopus',
      quartile:      r.quartile,
      sjr:           r.sjr?.toString() ?? '',
      citeScore:     r.citeScore?.toString() ?? '',
      journalUrl:     '',
      isDiscontinued: r.status === 'Discontinued',
    }});
  }

  goToPreT3Tci(): void {
    const t = this.tciResult();
    if (!t) return;
    this.router.navigate(['/pre-t3'], { state: {
      journalName:   t.journal,
      journalNameTh: t.journalTh ?? '',
      issn:          t.issn,
      eissn:         t.eissn ?? '',
      database:      'TCI',
      quartile:      `กลุ่มที่ ${t.tier}`,
      sjr:           '',
      citeScore:     '',
      journalUrl:     t.website ?? '',
      isDiscontinued: t.inactive,
    }});
  }

  formatIssn(issn: string | null): string {
    if (!issn) return '—';
    const clean = issn.replace(/[^0-9Xx]/g, '');
    return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : issn;
  }

  private toDashedIssn(issn: string): string {
    const digits = issn.replace(/-/g, '');
    return /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4)}` : issn;
  }

  printResult(): void {
    window.print();
  }
}

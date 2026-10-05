import { Component, inject, signal, ViewChild, ElementRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin, of, Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '../../../auth.service';
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
  hIndex: number | null;
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
}

@Component({
  standalone: true,
  selector: 'app-search',
  imports: [CommonModule, FormsModule],
  templateUrl: './search.html',
  styleUrls: ['./search.scss'],
})
export class Search implements OnInit {
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

  // ── CAPTCHA (slider puzzle) ──
  private readonly CAPTCHA_KEY = 'jw_captcha_ts';
  private readonly CAPTCHA_TTL = 60 * 60 * 1000;

  readonly CW = 320; readonly CH = 160;
  readonly PS = 60;  readonly TR = 12;

  showCaptcha  = signal(false);
  puzzlePieceX = signal(0);
  puzzleError  = signal(false);

  private puzzleTargetX = 0;

  @ViewChild('bgCanvas')    bgCvs!:    ElementRef<HTMLCanvasElement>;
  @ViewChild('pieceCanvas') pieceCvs!: ElementRef<HTMLCanvasElement>;

  private isCaptchaValid(): boolean {
    const ts = localStorage.getItem(this.CAPTCHA_KEY);
    if (!ts) return false;
    return Date.now() - parseInt(ts) < this.CAPTCHA_TTL;
  }

  refreshCaptcha(): void {
    this.puzzlePieceX.set(0);
    this.puzzleError.set(false);
    setTimeout(() => this.initPuzzle(), 10);
  }

  puzzleStartDrag(e: MouseEvent | TouchEvent): void {
    e.preventDefault();
    const startX = 'touches' in e
      ? (e as TouchEvent).touches[0].clientX
      : (e as MouseEvent).clientX;
    const startPX = this.puzzlePieceX();

    const onMove = (me: Event) => {
      me.preventDefault();
      const cx = 'touches' in me
        ? (me as TouchEvent).touches[0].clientX
        : (me as MouseEvent).clientX;
      this.puzzlePieceX.set(Math.max(0, Math.min(this.CW - this.PS, startPX + cx - startX)));
    };

    const onEnd = () => {
      document.removeEventListener('mousemove', onMove as EventListener);
      document.removeEventListener('touchmove', onMove as EventListener);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchend', onEnd);
      this.verifyPuzzle();
    };

    document.addEventListener('mousemove', onMove as EventListener);
    document.addEventListener('touchmove', onMove as EventListener, { passive: false } as AddEventListenerOptions);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);
  }

  private verifyPuzzle(): void {
    if (Math.abs(this.puzzlePieceX() - this.puzzleTargetX) <= 8) {
      localStorage.setItem(this.CAPTCHA_KEY, Date.now().toString());
      this.showCaptcha.set(false);
      this.doSearch();
    } else {
      this.puzzleError.set(true);
      setTimeout(() => {
        this.puzzleError.set(false);
        this.puzzlePieceX.set(0);
        setTimeout(() => this.initPuzzle(), 80);
      }, 1000);
    }
  }

  private initPuzzle(): void {
    this.puzzleTargetX = 100 + Math.floor(Math.random() * (this.CW - this.PS - 120));
    this.drawPuzzle();
  }

  private drawPuzzle(): void {
    const bg = this.bgCvs?.nativeElement;
    const pc = this.pieceCvs?.nativeElement;
    if (!bg || !pc) return;

    const bx = bg.getContext('2d')!;
    const px = pc.getContext('2d')!;
    px.clearRect(0, 0, this.PS, this.CH);

    // Background gradient
    const grad = bx.createLinearGradient(0, 0, this.CW, this.CH);
    grad.addColorStop(0, '#1C2744');
    grad.addColorStop(0.5, '#2A3A6E');
    grad.addColorStop(1, '#1C2744');
    bx.fillStyle = grad;
    bx.fillRect(0, 0, this.CW, this.CH);

    // Dot grid decoration
    bx.save();
    bx.globalAlpha = 0.13;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 17; col++) {
        bx.beginPath();
        bx.arc(col * 20 + 10, row * 21 + 10, 2, 0, Math.PI * 2);
        bx.fillStyle = '#E8A800';
        bx.fill();
      }
    }
    bx.restore();

    // Capture piece pixels BEFORE drawing hole
    const ty  = (this.CH - this.PS) / 2;
    const tx  = this.puzzleTargetX;
    const capH = this.PS + this.TR * 2;
    const imgData = bx.getImageData(tx, ty - this.TR, this.PS, capH);

    // Draw dark hole overlay
    const holePath = this.getPiecePath(tx, ty);
    bx.save();
    bx.fillStyle = 'rgba(0,0,0,0.58)';
    bx.fill(holePath);
    bx.strokeStyle = 'rgba(255,255,255,0.35)';
    bx.lineWidth = 1.5;
    bx.setLineDash([4, 3]);
    bx.stroke(holePath);
    bx.restore();

    // Draw piece via offscreen canvas (putImageData ignores clip)
    const off = document.createElement('canvas');
    off.width = this.PS; off.height = capH;
    off.getContext('2d')!.putImageData(imgData, 0, 0);

    const piecePath = this.getPiecePath(0, ty);

    px.save();
    px.clip(piecePath);
    px.drawImage(off, 0, ty - this.TR);
    px.restore();

    // Piece border
    px.save();
    px.strokeStyle = 'rgba(255,255,255,0.9)';
    px.lineWidth = 1.5;
    px.shadowColor = 'rgba(0,0,0,0.4)';
    px.shadowBlur = 4;
    px.stroke(piecePath);
    px.restore();

    // Piece highlight (top-to-bottom gradient overlay)
    px.save();
    px.clip(piecePath);
    const hl = px.createLinearGradient(0, ty, 0, ty + this.PS);
    hl.addColorStop(0, 'rgba(255,255,255,0.22)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    px.fillStyle = hl;
    px.fillRect(0, ty, this.PS, this.PS);
    px.restore();
  }

  private getPiecePath(x: number, y: number): Path2D {
    const s = this.PS, r = this.TR;
    const p = new Path2D();
    p.moveTo(x, y);
    // Top: tab bumps UP in center
    p.lineTo(x + s / 2 - r, y);
    p.arc(x + s / 2, y, r, Math.PI, 0, true);
    p.lineTo(x + s, y);
    // Right straight
    p.lineTo(x + s, y + s);
    // Bottom: notch cut inward (upward arc)
    p.lineTo(x + s / 2 + r, y + s);
    p.arc(x + s / 2, y + s, r, 0, Math.PI, true);
    p.lineTo(x, y + s);
    p.closePath();
    return p;
  }

  comparison = [
    { label: 'API Key',     scraping: 'ไม่ต้องใช้',  api: 'ต้องใช้',         scrapingOk: true,  apiOk: false },
    { label: 'ความเร็ว',   scraping: '3–8 วินาที',   api: '< 1 วินาที',      scrapingOk: false, apiOk: true  },
    { label: 'Rate Limit',  scraping: 'ไม่มี',        api: '20,000/สัปดาห์', scrapingOk: true,  apiOk: false },
    { label: 'ค่าใช้จ่าย', scraping: 'ฟรี',          api: 'ฟรี (สถาบัน)',   scrapingOk: true,  apiOk: true  },
  ];

  legends = [
    //  กลุ่มผ่านเกณฑ์
    { color: '#1A5FAB', label: 'ผ่านเกณฑ์สากล (Scopus)' },
    { color: '#1A7A42', label: 'ผ่านเกณฑ์มาตรฐาน (TCI กลุ่ม 1–2)' },
    //  กลุ่มเฝ้าระวัง
    { color: '#D35400', label: 'ข้อมูลขัดแย้งระหว่างระบบ (Scopus / TCI)' },
    { color: '#C07800', label: 'แจ้งเตือน: MSU Unwanted แต่ Scopus Active' },
    //  กลุ่มปฏิเสธ
    { color: '#962D2D', label: 'ปฏิเสธ: MSU Unwanted (ไม่อนุมัติการจบ)' },
    { color: '#7B1C1C', label: 'ปฏิเสธ: อยู่ในรายการเฝ้าระวัง (Watchlist)' },
  ];

  search(): void {
    if (!this.issn.trim()) return;
    if (!this.isCaptchaValid()) {
      this.puzzlePieceX.set(0);
      this.puzzleError.set(false);
      this.showCaptcha.set(true);
      setTimeout(() => this.initPuzzle(), 50);
      return;
    }
    this.doSearch();
  }

  doSearch(): void {
    if (!this.issn.trim()) return;
    this.isLoading.set(true);
    this.isRetrying.set(false);
    this.hasSearched.set(false);
    this.result.set(null);
    this.tciResult.set(null);
    this.errorMessage.set('');
    this.tciError.set('');

    // เริ่มค้นหาด้วย API เสมอ — runSearch() จะสลับไป Web Scraping ให้เองถ้า API ติด limit
    this.method = 'api';
    this.runSearch('api');
  }

  /* ตรวจจาก response error ว่าเป็นกรณี Scopus API key ถูก throttle/rate-limit/หมด quota
     หรือไม่ (โครงสร้างตรงกับ debug.raw_message ที่ backend ส่งกลับตอน API key มีปัญหา) */
  private isApiQuotaError(err: any): boolean {
    const raw: string = err?.error?.debug?.raw_message ?? err?.error?.message ?? '';
    return /throttled|rate.?limit|quota/i.test(raw);
  }

  private runSearch(method: FetchMethod): void {
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const issn = encodeURIComponent(this.issn.trim());
    const issnDashed = encodeURIComponent(this.toDashedIssn(this.issn.trim()));

    const scopusUrl = method === 'api'
      ? `${this.constants.API_ENDPOINT}/journal/scopus?issn=${issn}`
      : `${this.constants.API_ENDPOINT}/journal/scopus/scrape?issn=${issn}`;

    const tciUrl = method === 'api'
      ? `${this.constants.API_ENDPOINT}/journal/tci?issn=${issn}`
      : `${this.constants.API_ENDPOINT}/journal/tci/scrape?issn=${issn}`;

    // เก็บ error ดิบไว้ด้วย (ไม่ใช่แค่ null) เพื่อเอาไปตรวจว่าเป็น quota error หรือเปล่า
    const withRawError = <T>(obs: Observable<T>) =>
      obs.pipe(catchError(err => of({ __httpError: err } as any)));

    forkJoin({
      scopus:   withRawError(this.http.get<ScrapeScopusRes>(scopusUrl, { headers })),
      tci:      withRawError(this.http.get<ScrapeTCIRes>(tciUrl, { headers })),
      unwanted: this.http.get<CheckMsuUnwantedRes>
      (`${this.constants.API_ENDPOINT}/unwanted-journals/check/${issnDashed}`,
        { headers }).pipe(catchError(() => of(null))),
    }).subscribe(({ scopus, tci, unwanted }) => {
      const scopusErr = (scopus as any)?.__httpError;
      const tciErr     = (tci as any)?.__httpError;

      // ถ้ายังใช้ API อยู่ และเจอสัญญาณ key ติด limit/quota จากฝั่งไหนก็ตาม
      // ให้ลองค้นหาใหม่ทั้งชุดด้วย Web Scraping แทนโดยอัตโนมัติ ไม่ต้องให้ผู้ใช้ทำอะไร
      if (method === 'api' && ((scopusErr && this.isApiQuotaError(scopusErr)) || (tciErr && this.isApiQuotaError(tciErr)))) {
        this.method = 'scraping';
        this.isRetrying.set(true); // โชว์ข้อความแจ้งว่ากำลังสลับไป Web Scraping ให้ผู้ใช้เห็น
        this.runSearch('scraping');
        return;
      }

      this.isRetrying.set(false);

      const scopusRes = scopusErr ? null : (scopus as ScrapeScopusRes | null);
      const tciRes    = tciErr    ? null : (tci as ScrapeTCIRes | null);

      console.log('[Scopus res]', scopusRes);
      console.log('[TCI res]', tciRes);
      console.log('[Unwanted res]', unwanted);

      const isUnwanted = unwanted?.success ? unwanted.data.isUnwanted : false;

      if (scopusRes?.success && scopusRes.data && (scopusRes.data as any).journal_name) {
        this.result.set(this.mapResult(scopusRes.data as unknown as Data, isUnwanted));
      } else {
        this.errorMessage.set('ไม่พบข้อมูลวารสารใน Scopus');
      }

      if (tciRes?.success && tciRes.data && (tciRes.data as any).journal_name) {
        this.tciResult.set(this.mapTciResult(tciRes.data as unknown as TciData, isUnwanted));
      } else {
        this.tciError.set('ไม่พบข้อมูลวารสารใน TCI');
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

  private mapResult(data: Data, isUnwanted: boolean): JournalResult {
    const extra     = data as any;
    const quartile  = data.scopus_best_quartile ?? '';
    const isActive  = !data.scopus_discontinued;
    const isPredatory: boolean =
      extra.is_predatory ?? extra.is_blacklisted ?? extra.predatory ?? false;

    const qEntry = data.scopus_quartile_data?.[0];
    const quartileField = qEntry?.field ?? '';
    const quartileYear  = qEntry?.year  ?? '';

    const qNum = parseInt(quartile.replace('Q', '')) || 99;
    const passForDoctoral = qNum <= 2 && isActive && !isUnwanted && !isPredatory;
    const passForMaster   = qNum <= 3 && isActive && !isUnwanted && !isPredatory;

    let caseNum    = 1;
    let caseColor  = '#1A5FAB';
    let caseLabel  = '';
    let bannerIcon = '✓';
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
    } else if (passForDoctoral) {
      
      caseColor  = '#1A5FAB';
      caseLabel  = 'พบในฐานข้อมูล Scopus — ผ่านเกณฑ์ทุกระดับ';
      bannerIcon = '✓';
      bannerDesc = `วารสารนี้ได้รับการจัดอยู่ใน Scopus Quartile ${quartile} มีสถานะ Active และไม่ปรากฏในรายการ MSU Unwanted Journals สามารถนำไปยื่น Pre-T3 / T3 ได้ทั้ง ป.เอก และ ป.โท`;
    } else if (passForMaster) {
      caseColor  = '#1A5FAB';
      caseLabel  = 'Scopus Q3 — ผ่านเกณฑ์เฉพาะ ป.โท';
      bannerIcon = '〜';
      bannerDesc = `วารสารนี้ได้รับการจัดอยู่ใน Scopus Quartile ${quartile} มีสถานะ Active ผ่านเกณฑ์สำหรับ ป.โท แผน 2 แต่ไม่ผ่านเกณฑ์สำหรับ ป.เอก (ต้องการ Q2 ขึ้นไป)`;
    } else {
      
      caseColor  = '#64748B';
      caseLabel  = `Scopus ${quartile} — ไม่ผ่านเกณฑ์ Quartile`;
      bannerIcon = '✗';
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
      hIndex: data.scopus_h_index,
      citesPerDoc2y: extra.scopus_cites_per_doc ?? null,
      totalDocs: extra.scopus_total_docs ?? null,
      subjectAreaMain: data.main_area,
      subjectAreaSub: data.major_area,
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
    };
  }

  private mapTciResult(data: TciData, isUnwanted: boolean): TciJournalResult {
    const tier     = data.tci_tier ?? 99;
    const inactive = data.tci_inactive ?? false;
    const passForDoctoral = tier === 1 && !inactive && !isUnwanted;
    const passForMaster   = tier <= 2 && !inactive && !isUnwanted;
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
    return this.auth.user?.role?.toLowerCase() === 'student';
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

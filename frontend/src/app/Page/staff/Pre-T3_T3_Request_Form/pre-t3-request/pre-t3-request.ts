import { Component, OnInit, inject, ChangeDetectorRef, NgZone, ApplicationRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../../auth.service';
import { Constants } from '../../../../comfig/constants';
import { GetPreT3RequestStaffRes, Datum } from '../../../../model/res/get_Pre-T3_request_staff_res';
import { PreT3DetailsRes, Data as PreT3ApiDetail } from '../../../../model/res/Pre-T3_details_res';
import { StaffActionReq } from '../../../../model/req/staff_action_req';
import { StaffActionRejectReq } from '../../../../model/req/staff_action_reject_req';

interface PreT3Card {
  initials:      string;
  avatarColor:   string;
  name:          string;
  degree:        string;
  degreeType:    'phd' | 'master';
  studentId:     string;
  title:         string;
  journal:       string;
  issn:          string;
  database:      string;
  quartile:      string;
  journalStatus: 'active' | 'discontinued' | 'unwanted';
  status:        'pending' | 'meeting' | 'approved' | 'rejected' | 'auto-rejected';
  dateLabel:     string;
  advisorTime?:  string;
  daysAgo?:      number;
  requestId:     string;
  pre_t3_id:     number;
}

interface TimelineStep {
  label:  string;
  date:   string;
  status: 'done' | 'active' | 'pending';
  note?:  string;
}

interface PreT3Detail {
  requestId:       string;
  studentName:     string;
  studentId:       string;
  level:           string;
  advisor:         string;
  email:           string;
  curriculumYear:  string;
  journalName:     string;
  issn:            string;
  database:        string;
  quartile:        string;
  sjr:             string;
  citescore:       string;
  journalActive:   boolean;
  msuUnwanted:     boolean;
  systemCheck:     boolean;
  criteria:        string;
  articleTitle:    string;
  authors:         string;
  articleStatus:   string;
  checklistPassed: boolean;
  advisorOpinion:  string;
  advisorSignDate: string;
  advisorRemark:   string;
  timeline:        TimelineStep[];
  cardStatus:      'pending' | 'meeting' | 'approved' | 'rejected' | 'auto-rejected';
  statusText:      string;
  submittedMeta:   string;
}

const AVATAR_COLORS = [
  '#1B3A6B', '#1C3560', '#1A5247', '#7A3A1A',
  '#1E3B6E', '#3A3E4A', '#2D4A1E', '#6B1A3A',
];

@Component({
  selector: 'app-pre-t3-request',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './pre-t3-request.html',
  styleUrl: './pre-t3-request.scss',
})
export class PreT3Request implements OnInit {
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);
  private cdr       = inject(ChangeDetectorRef);
  private ngZone    = inject(NgZone);
  private appRef    = inject(ApplicationRef);
  private router    = inject(Router);

  // ── list state ────────────────────────────────────
  isLoading         = true;
  activeFilter      = 'all';
  cards: PreT3Card[]= [];

  // ── detail panel state ────────────────────────────
  selectedDetail: PreT3Detail | null = null;
  isDetailLoading   = false;
  activeCard: PreT3Card | null = null;

  // ── record-meeting modal (from detail panel) ──────
  showMeetingModal  = false;
  meetingDecision: 'approved' | 'rejected' | null = null;
  meetingRemark     = '';

  // ── inline review (inside modal-panel) ────────────
  inlineDecision: 'approved' | 'rejected' | null = 'approved';
  inlineMeetingNo      = '';
  inlineMeetingDate    = '';
  inlineRejectReason   = '';
  showRejectReasonError = false;
  isSubmittingDecision  = false;
  showInlineConfirm     = false;
  pendingAction: 'approved' | 'rejected' | null = null;

  // ── send-to-meeting modal (from card button) ──────
  showSendMeetingModal = false;
  sendMeetingCard: PreT3Card | null = null;
  sendMeetingDate = '';
  sendMeetingNo   = '';
  isSending       = false;

  // ── toast notification ────────────────────────────
  toastMessage = '';
  toastType: 'success' | 'error' = 'success';
  private toastTimer: any;

  showToast(message: string, type: 'success' | 'error' = 'success'): void {
    this.toastMessage = message;
    this.toastType    = type;
    this.cdr.detectChanges();
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastMessage = '';
      this.cdr.detectChanges();
    }, 3000);
  }

  // ── instant-reject modal (from card button) ───────
  showRejectModal   = false;
  rejectCard: PreT3Card | null = null;
  rejectReason      = '';
  isRejecting       = false;

  private datumMap  = new Map<string, Datum>();


  filters = [
    { key: 'all',           label: 'ทั้งหมด'    },
    { key: 'pending',       label: 'รอดำเนินการ' },
    { key: 'approved',      label: 'อนุมัติ'     },
    { key: 'rejected',      label: 'ไม่อนุมัติ'  },
    { key: 'auto-rejected', label: 'ระบบปฏิเสธ' },
  ];

  get filtered(): PreT3Card[] {
    if (this.activeFilter === 'all') return this.cards;
    return this.cards.filter(c => c.status === this.activeFilter);
  }

  ngOnInit(): void {
    window.scrollTo({ top: 0 });
    this.loadCards();
    /* .tab-bar มี overflow-x:auto สำหรับจอมือถือ (3 แท็บรวมกันกว้างเกินจอแคบ) —
       พอกดมาแท็บนี้ต้องเลื่อนแท็บที่ active เข้ามาให้เห็นในจอเอง ไม่งั้นผู้ใช้จะไม่เห็น
       ว่าแท็บไหนกำลัง active อยู่เพราะมันตกขอบจอไปแล้ว */
    setTimeout(() => {
      document.querySelector('.tab-item.tab-active')
        ?.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }, 0);
  }

  loadCards(): void {
    this.isLoading = true;
    const headers  = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetPreT3RequestStaffRes>(`${this.constants.API_ENDPOINT}/pre-t3/pending`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isLoading = false;
        if (res?.success) {
          this.cards = res.data.map((d, i) => this.mapDatum(d, i));
        }
        this.cdr.detectChanges();
      });
  }

  private mapDatum(d: Datum, index: number): PreT3Card {
    const createdAt = new Date(d.created_at);
    const now       = new Date();
    const daysAgo   = Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
    const studentId = d.student_email.replace('@msu.ac.th', '');
    const snap      = d.journal_snapshot;
    const facCom    = d.faculty_com_approval;
    const advisor   = d.advisor_approval;

    const overall = d.overall_status?.toLowerCase() ?? '';
    let status: PreT3Card['status'] = 'pending';
    if (snap.is_hijacked || snap.is_discontinued) {
      if (overall.includes('reject')) status = 'auto-rejected';
    }
    if (status === 'pending') {
      if (overall.includes('approv'))      status = 'approved';
      else if (overall.includes('reject')) status = 'rejected';
      else if (facCom?.meeting_date)       status = 'meeting';
    }

    let journalStatus: PreT3Card['journalStatus'] = 'active';
    if (snap.is_discontinued) journalStatus = 'discontinued';
    if (snap.is_hijacked)     journalStatus = 'unwanted';

    const fmt = (v: Date | null) =>
      v ? new Date(v).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
    const fmtTime = (v: any) =>
      v ? new Date(v).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
    let dateLabel = '';
    if (status === 'approved') {
      dateLabel = facCom?.approved_at ? `อนุมัติ ${fmt(facCom.approved_at as any)}` : 'อนุมัติแล้ว';
    } else if (status === 'rejected') {
      dateLabel = facCom?.approved_at ? `ไม่อนุมัติ ${fmt(facCom.approved_at as any)}` : 'ไม่อนุมัติ';
    } else if (status === 'meeting') {
      dateLabel = facCom?.meeting_date ? `ประชุม ${fmt(facCom.meeting_date as any)}` : 'ส่งที่ประชุมแล้ว';
    } else if (status === 'auto-rejected') {
      dateLabel = `ปฏิเสธ ${fmt(createdAt)}`;
    } else {
      const advisorDate = advisor?.approved_at ? fmt(advisor.approved_at as any) : fmt(createdAt);
      dateLabel = `อาจารย์ส่งมา ${advisorDate}`;
    }
    const advisorTime = advisor?.approved_at
      ? fmtTime(advisor.approved_at)
      : (status === 'pending' ? fmtTime(createdAt) : undefined);

    const stripped = d.student_name.replace(/^(นาย|น\.ส\.|นาง(?:สาว)?|ดร\.|ผศ\.|รศ\.|ศ\.)\s*/u, '').trim();
    const parts    = stripped.split(/\s+/);
    const initials = parts.slice(0, 2).map(p => [...p][0] ?? '').join('') || '??';

    const requestId = `PRE-T3-${d.pre_t3_id}`;
    this.datumMap.set(requestId, d);

    return {
      initials,
      avatarColor:   AVATAR_COLORS[index % AVATAR_COLORS.length],
      name:          d.student_name,
      degree:        '',
      degreeType:    'master',
      studentId,
      title:         '',
      journal:       snap.journal_name,
      issn:          snap.issn || snap.eissn || '-',
      database:      snap.indexed_database,
      quartile:      snap.quartile_or_tier,
      journalStatus,
      status,
      dateLabel,
      advisorTime,
      daysAgo:       status === 'pending' ? daysAgo : undefined,
      requestId,
      pre_t3_id:     d.pre_t3_id,
    };
  }

  // ── Detail panel ──────────────────────────────────
  openDetail(card: PreT3Card): void {
    this.activeCard           = card;
    this.showMeetingModal     = false;
    this.inlineDecision        = 'approved';
    this.inlineMeetingNo       = '';
    this.inlineMeetingDate     = '';
    this.inlineRejectReason    = '';
    this.showRejectReasonError = false;
    this.showInlineConfirm     = false;
    this.pendingAction         = null;

    // แสดง fallback ทันทีจาก datumMap (ไม่ต้องรอ API)
    this.selectedDetail  = this.buildDetailFallback(card);
    this.isDetailLoading = true;

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const url     = `${this.constants.API_ENDPOINT}/pre-t3/${card.pre_t3_id}`;
    const t0      = performance.now();
    console.log('[openDetail] GET', url);
    this.http
      .get<PreT3DetailsRes>(url, { headers })
      .pipe(catchError(err => {
        console.error('[openDetail] Error:', err?.status, err?.error);
        return of(null);
      }))
      .subscribe(res => {
        const ms = (performance.now() - t0).toFixed(0);
        console.log(`[openDetail] Response in ${ms}ms — success:`, res?.success);
        this.isDetailLoading = false;
        if (res?.success) {
          this.selectedDetail = this.buildDetailFromApi(res.data, card);
        }
        this.cdr.detectChanges();
      });
  }

  closeDetail(): void {
    this.selectedDetail   = null;
    this.activeCard       = null;
    this.showMeetingModal = false;
  }

  submitInlineDecision(action: 'approved' | 'rejected'): void {
    console.log('[submitInlineDecision] called', action, {
      meetingNo: this.inlineMeetingNo,
      meetingDate: this.inlineMeetingDate,
      rejectReason: this.inlineRejectReason,
    });
    if (action === 'approved' && (!this.inlineMeetingNo || !this.inlineMeetingDate)) {
      console.warn('[submitInlineDecision] blocked — missing meeting info');
      return;
    }
    if (action === 'rejected') {
      if (!this.inlineRejectReason.trim()) {
        console.warn('[submitInlineDecision] blocked — missing reject reason');
        this.showRejectReasonError = true;
        return;
      }
      this.showRejectReasonError = false;
    }
    this.pendingAction     = action;
    this.showInlineConfirm = true;
    console.log('[submitInlineDecision] showInlineConfirm =', this.showInlineConfirm, 'selectedDetail =', !!this.selectedDetail);
    this.cdr.detectChanges();
  }

  cancelInlineConfirm(): void {
    this.showInlineConfirm = false;
    this.pendingAction     = null;
    this.cdr.detectChanges();
  }

  confirmAndSubmit(): void {
    const card   = this.activeCard;
    const action = this.pendingAction;
    if (!card || !action || this.isSubmittingDecision) return;

    this.isSubmittingDecision = true;
    const headers = new HttpHeaders({
      Authorization:  `Bearer ${this.auth.token}`,
      'Content-Type': 'application/json',
    });
    const body: any = action === 'approved'
      ? { action: 'approve', meeting_no: this.inlineMeetingNo, meeting_date: this.inlineMeetingDate }
      : { action: 'reject', remark: this.inlineRejectReason };

    this.http
      .patch(`${this.constants.API_ENDPOINT}/pre-t3/${card.pre_t3_id}/faculty-review`, body, { headers })
      .pipe(catchError(err => { console.error('[confirmAndSubmit]', err); return of(null); }))
      .subscribe(res => {
        this.isSubmittingDecision = false;
        this.showInlineConfirm    = false;
        if (res) {
          this.closeDetail();
          this.router.navigate(['/staff/history'], {
            queryParams: {
              type:   'PreT3',
              status: action === 'approved' ? 'approved' : 'rejected',
            },
          });
        } else {
          this.showToast('เกิดข้อผิดพลาด กรุณาลองใหม่', 'error');
        }
      });
  }

  // ── Record-meeting modal (from detail panel) ──────
  openMeetingModal(): void {
    this.meetingDecision  = null;
    this.meetingRemark    = '';
    this.showMeetingModal = true;
  }
  closeMeetingModal(): void { this.showMeetingModal = false; }
  saveMeeting(): void       { this.closeMeetingModal(); }

  // ── Send-to-meeting modal ─────────────────────────
  openSendMeetingModal(card: PreT3Card, event: Event): void {
    event.stopPropagation();
    this.sendMeetingCard = card;
    this.sendMeetingDate = '';
    this.sendMeetingNo   = '';
    this.showSendMeetingModal = true;
  }

  closeSendMeetingModal(): void { this.showSendMeetingModal = false; }

  confirmSendMeeting(): void {
    if (!this.sendMeetingDate || this.isSending) return;
    this.isSending = true;
    const headers  = new HttpHeaders({
      Authorization:  `Bearer ${this.auth.token}`,
      'Content-Type': 'application/json',
    });
    const card = this.sendMeetingCard!;
    const body = {
      action:       'approve',
      meeting_no:   this.sendMeetingNo,
      meeting_date: this.sendMeetingDate, // ส่งเป็น string "YYYY-MM-DD" ตรงๆ
    };
    const url = `${this.constants.API_ENDPOINT}/pre-t3/${card.pre_t3_id}/faculty-review`;
    console.log('[confirmSendMeeting] PATCH', url);
    console.log('[confirmSendMeeting] Body:', body);
    this.http
      .patch(url, body, { headers })
      .pipe(catchError(err => {
        console.error('[confirmSendMeeting] Error:', err?.status, err?.error);
        return of(null);
      }))
      .subscribe(res => {
        console.log('[confirmSendMeeting] Response:', res);
        this.isSending = false;
        if (res) {
          this.cards = this.cards.map(c =>
            c.pre_t3_id === card.pre_t3_id ? { ...c, status: 'approved' as const } : c
          );
          this.closeSendMeetingModal();
          this.showToast(`✅ อนุมัติสำเร็จ — ${card.requestId} · ${card.name}`);
        } else {
          this.showToast('❌ เกิดข้อผิดพลาด กรุณาลองใหม่', 'error');
        }
        this.appRef.tick();
      });
  }

  // ── Instant-reject modal ──────────────────────────
  openRejectModal(card: PreT3Card, event: Event): void {
    event.stopPropagation();
    this.rejectCard   = card;
    this.rejectReason = '';
    this.showRejectModal = true;
  }

  closeRejectModal(): void { this.showRejectModal = false; }

  confirmReject(): void {
    if (!this.rejectReason.trim() || this.isRejecting) return;
    this.isRejecting = true;
    const headers    = new HttpHeaders({
      Authorization:  `Bearer ${this.auth.token}`,
      'Content-Type': 'application/json',
    });
    const card = this.rejectCard!;
    const body: StaffActionRejectReq = { action: 'reject', remark: this.rejectReason.trim() };
    const url  = `${this.constants.API_ENDPOINT}/pre-t3/${card.pre_t3_id}/faculty-review`;
    console.log('[confirmReject] URL  :', url);
    console.log('[confirmReject] Body :', body);
    this.http
      .patch(url, body, { headers })
      .pipe(catchError(err => {
        console.error('[confirmReject] HTTP status :', err?.status);
        console.error('[confirmReject] Error body  :', err?.error);
        return of(null);
      }))
      .subscribe(res => {
        console.log('[confirmReject] Response:', res);
        this.isRejecting = false;
        if (res) {
          this.cards = this.cards.map(c =>
            c.pre_t3_id === card.pre_t3_id ? { ...c, status: 'rejected' as const } : c
          );
          this.closeRejectModal();
          this.showToast(`❌ ไม่อนุมัติสำเร็จ — ${card.requestId} · ${card.name}`, 'error');
        } else {
          this.showToast('❌ เกิดข้อผิดพลาด กรุณาลองใหม่', 'error');
        }
        this.appRef.tick();
      });
  }

  // ── Build detail from API data ────────────────────
  private buildDetailFromApi(d: PreT3ApiDetail, card: PreT3Card): PreT3Detail {
    const snap = d.journal_snapshot;
    const snap2 = d.student_snapshot;
    const si   = d.student_info;
    const ai   = d.advisor_info;
    const art  = d.article_info;
    const adv  = d.advisor_approval;
    const fac  = d.faculty_com_approval;

    const fmt = (v: any) =>
      v ? new Date(v).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

    const checklistPassed = Object.values(d.checklist_data ?? {}).every(v => v === true);
    const advisorStatus   = adv?.status?.toLowerCase() ?? '';
    const advisorOpinion  = advisorStatus.includes('approv') ? 'เห็นชอบ'
                          : advisorStatus.includes('reject') ? 'ไม่เห็นชอบ' : '-';

    const db = snap.indexed_database;
    const q  = snap.quartile_or_tier;
    const criteria = db.toLowerCase().includes('tci')
      ? `ป.โท/เอก: TCI ${q} + Active`
      : `ป.โท: Q2 ขึ้นไป + Active / ป.เอก: Q1 + Active`;

    return {
      requestId:       card.requestId,
      studentName:     d.student_name,
      studentId:       d.student_email?.replace('@msu.ac.th', '') ?? card.studentId,
      level:           si?.degree_level ?? snap2?.degree_level ?? '-',
      advisor:         ai?.main_advisor_name
                         ? `${ai.main_advisor_position ?? ''} ${ai.main_advisor_name}`.trim()
                         : '-',
      email:           si?.msu_mail ?? d.student_email,
      curriculumYear:  snap2?.curriculum_year ?? '-',
      journalName:     snap.journal_name,
      issn:            snap.issn || snap.eissn || '-',
      database:        db,
      quartile:        q,
      sjr:             snap.sjr_score != null ? String(snap.sjr_score) : '-',
      citescore:       snap.cite_score != null ? String(snap.cite_score) : '-',
      journalActive:   !snap.is_discontinued,
      msuUnwanted:     snap.is_hijacked,
      systemCheck:     !snap.is_discontinued && !snap.is_hijacked,
      criteria,
      articleTitle:    art?.title_en ?? art?.title_th ?? '-',
      authors:         art?.authors ?? '-',
      articleStatus:   '-',
      checklistPassed,
      advisorOpinion,
      advisorSignDate: adv?.approved_at ? fmt(adv.approved_at) : '-',
      advisorRemark:   adv?.remark ?? '-',
      timeline:        this.buildTimelineFromApi(card, d),
      cardStatus:      card.status,
      statusText:      this.statusText(card.status),
      submittedMeta:   `${card.dateLabel} · ${snap.journal_name} ${q} ${db}`,
    };
  }

  private buildDetailFallback(card: PreT3Card): PreT3Detail {
    const d    = this.datumMap.get(card.requestId);
    const snap = d?.journal_snapshot;
    const adv  = d?.advisor_approval;

    const fmt = (v: any) =>
      v ? new Date(v).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

    const checklistPassed = d ? Object.values(d.checklist_data ?? {}).every(v => v === true) : false;
    const advisorStatus   = adv?.status?.toLowerCase() ?? '';
    const advisorOpinion  = advisorStatus.includes('approv') ? 'เห็นชอบ'
                          : advisorStatus.includes('reject') ? 'ไม่เห็นชอบ' : '-';

    const db = snap?.indexed_database ?? card.database;
    const q  = snap?.quartile_or_tier ?? card.quartile;
    const criteria = db.toLowerCase().includes('tci')
      ? `ป.โท/เอก: TCI ${q} + Active`
      : `ป.โท: Q2 ขึ้นไป + Active / ป.เอก: Q1 + Active`;

    return {
      requestId:       card.requestId,
      studentName:     card.name,
      studentId:       card.studentId,
      level:           '-', advisor: '-',
      email:           d?.student_email ?? `${card.studentId}@msu.ac.th`,
      curriculumYear:  '-',
      journalName:     snap?.journal_name ?? card.journal,
      issn:            snap?.issn || snap?.eissn || card.issn,
      database:        db, quartile: q,
      sjr:             snap?.sjr_score != null ? String(snap.sjr_score) : '-',
      citescore:       snap?.cite_score != null ? String(snap.cite_score) : '-',
      journalActive:   !snap?.is_discontinued,
      msuUnwanted:     snap?.is_hijacked ?? false,
      systemCheck:     !snap?.is_discontinued && !snap?.is_hijacked,
      criteria,
      articleTitle:    '-', authors: '-', articleStatus: '-',
      checklistPassed,
      advisorOpinion,
      advisorSignDate: adv?.approved_at ? fmt(adv.approved_at) : '-',
      advisorRemark:   adv?.remark ?? '-',
      timeline:        this.buildTimeline(card, d),
      cardStatus:      card.status,
      statusText:      this.statusText(card.status),
      submittedMeta:   `${card.dateLabel} · ${snap?.journal_name ?? card.journal} ${q} ${db}`,
    };
  }

  private statusText(s: string): string {
    return ({
      pending:         '○ รอดำเนินการ',
      meeting:         '● ส่งที่ประชุมแล้ว',
      approved:        '✅ อนุมัติแล้ว',
      rejected:        '❌ ไม่อนุมัติ',
      'auto-rejected': '🚫 ระบบปฏิเสธ',
    } as any)[s] ?? s;
  }

  private buildTimelineFromApi(card: PreT3Card, d: PreT3ApiDetail): TimelineStep[] {
    const fmt = (v: any) =>
      v ? new Date(v).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-';

    const submittedDate = fmt(d.created_at);
    const advisorDate   = d.advisor_approval?.approved_at ? fmt(d.advisor_approval.approved_at) : '-';
    const meetingDate   = d.faculty_com_approval?.meeting_date ? fmt(d.faculty_com_approval.meeting_date) : '-';
    const resultDate    = d.faculty_com_approval?.approved_at ? fmt(d.faculty_com_approval.approved_at) : '-';

    const submitted: TimelineStep     = { label: 'นิสิตยื่นคำร้อง', date: submittedDate, status: 'done' };
    const advisorSigned: TimelineStep = {
      label:  'อาจารย์ลงนาม',
      date:   advisorDate !== '-' ? advisorDate : 'รอลงนาม',
      status: advisorDate !== '-' ? 'done' : 'pending',
    };

    return this.buildSteps(card.status, submitted, advisorSigned, meetingDate, resultDate);
  }

  private buildTimeline(card: PreT3Card, d: Datum | undefined): TimelineStep[] {
    const fmt = (v: any) =>
      v ? new Date(v).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-';

    const submittedDate = d ? fmt(d.created_at) : '-';
    const advisorDate   = d?.advisor_approval?.approved_at ? fmt(d.advisor_approval.approved_at) : '-';
    const meetingDate   = d?.faculty_com_approval?.meeting_date ? fmt(d.faculty_com_approval.meeting_date) : '-';
    const resultDate    = d?.faculty_com_approval?.approved_at ? fmt(d.faculty_com_approval.approved_at) : '-';

    const submitted: TimelineStep     = { label: 'นิสิตยื่นคำร้อง', date: submittedDate, status: 'done' };
    const advisorSigned: TimelineStep = {
      label:  'อาจารย์ลงนาม',
      date:   advisorDate !== '-' ? advisorDate : 'รอลงนาม',
      status: advisorDate !== '-' ? 'done' : 'pending',
    };

    return this.buildSteps(card.status, submitted, advisorSigned, meetingDate, resultDate);
  }

  private buildSteps(
    status: string,
    submitted: TimelineStep,
    advisorSigned: TimelineStep,
    meetingDate: string,
    resultDate: string,
  ): TimelineStep[] {
    if (status === 'auto-rejected') {
      return [submitted, advisorSigned,
        { label: 'ระบบปฏิเสธอัตโนมัติ', date: submitted.date, status: 'done' },
      ];
    }
    if (status === 'pending') {
      return [submitted, advisorSigned,
        { label: 'มติที่ประชุม', date: '-', status: 'pending' },
      ];
    }
    if (status === 'meeting') {
      return [submitted, advisorSigned,
        { label: 'มติที่ประชุม', date: 'รอผล', status: 'active' },
      ];
    }
    if (status === 'approved') {
      return [submitted, advisorSigned,
        { label: 'มติที่ประชุม', date: resultDate !== '-' ? `อนุมัติ ${resultDate}` : 'อนุมัติแล้ว', status: 'done' },
      ];
    }
    return [submitted, advisorSigned,
      { label: 'มติที่ประชุม', date: resultDate !== '-' ? `ไม่อนุมัติ ${resultDate}` : 'ไม่อนุมัติ', status: 'done' },
    ];
  }
}

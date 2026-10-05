import { Routes } from '@angular/router';
import { Login } from './Login/login/login';
import { RegisterStaff } from './Login/register-staff/register-staff';
import { AboutJournalWatch } from './Page/shared/about-journal-watch/about-journal-watch';
import { Manual } from './Page/shared/manual/manual';
import { Contact } from './Page/shared/contact/contact';
import { authGuard } from './auth.guard';
import { adminGuard } from './admin.guard';

import { MsuUnwanted } from './Page/shared/msu-unwanted/msu-unwanted';
import { Search } from './Page/shared/search/search';
import { PreT3 } from './Page/Student/pre-t3/pre-t3/pre-t3';
import { PreT3Status } from './Page/Student/pre-t3/pre-t3-status/pre-t3-status';
import { PreT3History } from './Page/Student/pre-t3/pre-t3-history/pre-t3-history';
import { Profile } from './Page/Student/profile/profile';
export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: Login },
  { path: 'register', component: RegisterStaff },
  { path: 'about', component: AboutJournalWatch },
  { path: 'manual', component: Manual },
  { path: 'contact', component: Contact },

  // ── Admin Login Flow ──
  {
    path: 'login-admin',
    loadComponent: () => import('./Login/login_admin/login').then(m => m.Login),
  },
  {
    path: 'req-otp',
    loadComponent: () => import('./page_admin/shared/req-otp/req-otp').then(m => m.ReqOTP),
  },

  // ── Admin Routes ──
  {
    path: 'admin/dashboard',
    loadComponent: () => import('./page_admin/admin/dashboard/dashboard').then(m => m.Dashboard),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/profile',
    loadComponent: () => import('./page_admin/admin/profile/profile').then(m => m.Profile),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/search',
    loadComponent: () => import('./page_admin/shared/search/search').then(m => m.Search),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/msu-unwanted',
    loadComponent: () => import('./page_admin/shared/msu-unwanted/msu-unwanted').then(m => m.MsuUnwanted),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/manage-users',
    loadComponent: () => import('./page_admin/shared/manage-users/manage-users').then(m => m.ManageUsers),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/bug-reports',
    loadComponent: () => import('./page_admin/shared/bug-reports/bug-reports').then(m => m.BugReports),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/backup-restore',
    loadComponent: () => import('./page_admin/shared/backup-restore/backup-restore').then(m => m.BackupRestore),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/reports',
    loadComponent: () => import('./page_admin/shared/reports/reports').then(m => m.Reports),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/about',
    loadComponent: () => import('./page_admin/shared/about-journal-watch/about-journal-watch').then(m => m.AboutJournalWatch),
    canActivate: [adminGuard],
  },
  {
    path: 'admin/manual',
    loadComponent: () => import('./page_admin/shared/manual/manual').then(m => m.Manual),
    canActivate: [adminGuard],
  },

  // ── Super-Admin Routes ──
  {
    path: 'super-admin/dashboard',
    loadComponent: () => import('./page_admin/super-admin/dashboard/dashboard').then(m => m.Dashboard),
    canActivate: [adminGuard],
  },
  {
    path: 'super-admin/profile',
    loadComponent: () => import('./page_admin/super-admin/profile/profile').then(m => m.Profile),
    canActivate: [adminGuard],
  },
  {
    path: 'super-admin/search',
    loadComponent: () => import('./page_admin/shared/search/search').then(m => m.Search),
    canActivate: [adminGuard],
  },
  {
    path: 'super-admin/msu-unwanted',
    loadComponent: () => import('./page_admin/shared/msu-unwanted/msu-unwanted').then(m => m.MsuUnwanted),
    canActivate: [adminGuard],
  },
  {
    path: 'super-admin/manage-users',
    loadComponent: () => import('./page_admin/shared/manage-users/manage-users').then(m => m.ManageUsers),
    canActivate: [adminGuard],
  },
  {
    path: 'super-admin/bug-reports',
    loadComponent: () => import('./page_admin/shared/bug-reports/bug-reports').then(m => m.BugReports),
    canActivate: [adminGuard],
  },
  {
    path: 'super-admin/backup-restore',
    loadComponent: () => import('./page_admin/shared/backup-restore/backup-restore').then(m => m.BackupRestore),
    canActivate: [adminGuard],
  },
  {
    path: 'super-admin/reports',
    loadComponent: () => import('./page_admin/shared/reports/reports').then(m => m.Reports),
    canActivate: [adminGuard],
  },
  {
    path: 'super-admin/about',
    loadComponent: () => import('./page_admin/shared/about-journal-watch/about-journal-watch').then(m => m.AboutJournalWatch),
    canActivate: [adminGuard],
  },
  {
    path: 'super-admin/manual',
    loadComponent: () => import('./page_admin/shared/manual/manual').then(m => m.Manual),
    canActivate: [adminGuard],
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./Page/Student/dashboard/dashboard').then(m => m.Dashboard),
    canActivate: [authGuard],
  },
  { path: 'search', component: Search, canActivate: [authGuard] },
  { path: 'msu-unwanted', component: MsuUnwanted, canActivate: [authGuard] },
  { path: 'pre-t3', component: PreT3, canActivate: [authGuard] },
  { path: 'pre-t3-status', component: PreT3Status, canActivate: [authGuard] },
  { path: 'pre-t3-history', component: PreT3History, canActivate: [authGuard] },
  {
    path: 't3',
    loadComponent: () =>
      import('./Page/Student/t3/send-t3/send-t3').then(m => m.SendT3),
    canActivate: [authGuard],
  },
  {
    path: 'send-t3',
    loadComponent: () =>
      import('./Page/Student/t3/send-t3/send-t3').then(m => m.SendT3),
    canActivate: [authGuard],
  },
  {
    path: 'status-t3',
    loadComponent: () =>
      import('./Page/Student/t3/status-t3/status-t3').then(m => m.StatusT3),
    canActivate: [authGuard],
  },
  {
    path: 't3-history',
    loadComponent: () =>
      import('./Page/Student/t3/t3-history/t3-history').then(m => m.T3History),
    canActivate: [authGuard],
  },
{ path: 'profile', component: Profile, canActivate: [authGuard] },

  {
    path: 'staff/pre-t3-request',
    loadComponent: () =>
      import('./Page/staff/Pre-T3_T3_Request_Form/pre-t3-request/pre-t3-request').then(m => m.PreT3Request),
    canActivate: [authGuard],
  },
  {
    path: 'staff/t3-request',
    loadComponent: () =>
      import('./Page/staff/Pre-T3_T3_Request_Form/t3-request/t3-request').then(m => m.T3Request),
    canActivate: [authGuard],
  },
  {
    path: 'staff/history',
    loadComponent: () =>
      import('./Page/staff/Pre-T3_T3_Request_Form/history/history').then(m => m.History),
    canActivate: [authGuard],
  },
  {
    path: 'staff/dashboard',
    loadComponent: () =>
      import('./Page/staff/dashboard/dashboard').then(m => m.Dashboard),
    canActivate: [authGuard],
  },
  {
    path: 'staff/profile',
    loadComponent: () =>
      import('./Page/staff/profile/profile').then(m => m.Profile),
    canActivate: [authGuard],
  },
  {
    path: 'staff/user-management',
    loadComponent: () =>
      import('./Page/staff/manage-users/manage-users').then(m => m.ManageUsers),
    canActivate: [authGuard],
  },
  {
    path: 'advisor/dashboard',
    loadComponent: () =>
      import('./Page/Advisor/dashboard/dashboard').then(m => m.Dashboard),
    canActivate: [authGuard],
  },
  {
    path: 'advisor/profile',
    loadComponent: () =>
      import('./Page/Advisor/profile/profile').then(m => m.Profile),
    canActivate: [authGuard],
  },
  {
    path: 'advisor/pre-t3-request',
    loadComponent: () =>
      import('./Page/Advisor/Student_request/pre-t3-request/pre-t3-request').then(m => m.PreT3Request),
    canActivate: [authGuard],
  },
  {
    path: 'advisor/t3-request',
    loadComponent: () =>
      import('./Page/Advisor/Student_request/t3-request/t3-request').then(m => m.T3Request),
    canActivate: [authGuard],
  },
  {
    path: 'advisor/history',
    loadComponent: () =>
      import('./Page/Advisor/Student_request/history/history').then(m => m.History),
    canActivate: [authGuard],
  },

  {
    path: 'bug-reports',
    loadComponent: () =>
      import('./Page/shared/bug-reports/bug-reports').then(m => m.BugReports),
    canActivate: [authGuard],
  },

  { path: '**', redirectTo: 'login' },
];
/**
 * Typed calls for the admin console. Shapes mirror backend/server/admin.go
 * and backend/store; the server validates everything again, so these types
 * are a convenience, not a security boundary.
 */
import { api, downloadFrom } from '../../platform/api.ts';
import type { Level } from '../../content/types.ts';
import type { Role } from '../../platform/backend.ts';

export interface LearnerSummary {
  doneCount: number;
  total: number;
  byRound: Record<string, number>;
  dueCount: number;
  lastActiveAt: number;
  lastSectionId: string | null;
}

export interface Person {
  id: number;
  login: string;
  name: string;
  avatarUrl: string;
  role: Role;
  disabled: boolean;
  invitedBy: number | null;
  createdAt: string;
  lastSeenAt: string;
  summary: LearnerSummary;
  progressUpdatedAt: string | null;
}

export interface PeopleResponse {
  users: Person[];
  rounds: Array<{ id: string; title: string; total: number }>;
}

export type InviteStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface Invite {
  id: number;
  role: 'admin' | 'learner';
  note: string;
  maxUses: number;
  uses: number;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: InviteStatus;
}

export interface AdminQuestionMeta {
  id: string;
  sectionId: string;
  title: string;
  level: Level;
  tags: string[];
  minutes: number;
  summary: string;
  published: boolean;
  revision: number;
  updatedAt: string;
}

export interface AdminSection {
  id: string;
  title: string;
  description: string;
  published: boolean;
  updatedAt: string;
  questions: AdminQuestionMeta[];
}

export interface AdminContent {
  version: number;
  sections: AdminSection[];
}

export interface QuestionInput {
  id: string;
  sectionId: string;
  title: string;
  level: Level;
  tags: string[];
  minutes: number;
  body: string;
  published: boolean;
}

export interface QuestionRecord extends QuestionInput {
  revision: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface Revision {
  id: number;
  revision: number;
  action: 'update' | 'delete';
  title: string;
  editedBy: string | null;
  editedAt: string;
}

export interface DeletedQuestion extends Revision {
  questionId: string;
  sectionId: string;
}

export interface Preview {
  html: string;
  summary: string;
  problems: Array<{ field: string; message: string }>;
}

export interface SyncPlan {
  newSections: string[];
  newQuestions: string[];
  changedQuestions: string[];
  unchanged: number;
  onlyInDatabase: number;
}

export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  default: boolean;
}

export interface AnnouncementSetting {
  message: string;
  tone: 'info' | 'success' | 'warning';
  linkUrl: string;
  linkLabel: string;
  updatedAt: number;
}

export interface SiteSetting {
  name: string;
  tagline: string;
  registration: 'invite' | 'open';
  contentAccess: 'public' | 'members';
}

export interface SettingsResponse {
  site: SiteSetting;
  features: Record<string, boolean>;
  featureList: FeatureDef[];
  announcement: AnnouncementSetting;
}

export interface AuditEntry {
  id: number;
  actor: string | null;
  action: string;
  target: string;
  detail: Record<string, unknown>;
  at: string;
}

export type SubmissionStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/** A question proposed by a community member (backend/store/submissions.go). */
export interface Submission {
  id: number;
  submitter: string;
  submitterName: string;
  sectionId: string;
  newSectionTitle: string;
  title: string;
  level: Level;
  tags: string[];
  minutes: number;
  body: string;
  context: string;
  credit: boolean;
  status: SubmissionStatus;
  reviewNote: string;
  reviewer: string | null;
  questionId: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface SubmissionInput {
  sectionId: string;
  newSectionTitle: string;
  title: string;
  level: Level;
  tags: string[];
  minutes: number;
  body: string;
  context: string;
  credit: boolean;
}

const json = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => ({ method, body });

export const consoleApi = {
  people: () => api<PeopleResponse>('/admin/users'),
  updatePerson: (id: number, patch: { role?: Role; disabled?: boolean }) => api(`/admin/users/${id}`, json('PATCH', patch)),
  removePerson: (id: number) => api(`/admin/users/${id}`, json('DELETE')),

  invites: () => api<Invite[]>('/admin/invites'),
  createInvite: (input: { role: 'admin' | 'learner'; note: string; maxUses: number; expiresInDays: number }) =>
    api<{ invite: Invite; url: string }>('/admin/invites', json('POST', input)),
  revokeInvite: (id: number) => api(`/admin/invites/${id}`, json('DELETE')),

  content: () => api<AdminContent>('/admin/content'),
  createSection: (input: { id: string; title: string; description: string; published: boolean }) => api('/admin/sections', json('POST', input)),
  updateSection: (id: string, patch: { title?: string; description?: string; published?: boolean }) =>
    api(`/admin/sections/${encodeURIComponent(id)}`, json('PATCH', patch)),
  deleteSection: (id: string) => api(`/admin/sections/${encodeURIComponent(id)}`, json('DELETE')),
  reorderSections: (ids: string[]) => api('/admin/sections/order', json('PUT', { ids })),
  reorderQuestions: (sectionId: string, ids: string[]) => api(`/admin/sections/${encodeURIComponent(sectionId)}/order`, json('PUT', { ids })),

  question: (id: string) => api<QuestionRecord>(`/admin/questions/${encodeURIComponent(id)}`),
  createQuestion: (input: QuestionInput) => api<QuestionRecord>('/admin/questions', json('POST', input)),
  updateQuestion: (input: QuestionInput & { revision: number }) =>
    api<QuestionRecord>(`/admin/questions/${encodeURIComponent(input.id)}`, json('PUT', input)),
  deleteQuestion: (id: string) => api(`/admin/questions/${encodeURIComponent(id)}`, json('DELETE')),
  revisions: (id: string) => api<Revision[]>(`/admin/questions/${encodeURIComponent(id)}/revisions`),
  revision: (id: string, rev: number) => api<QuestionInput>(`/admin/questions/${encodeURIComponent(id)}/revisions/${rev}`),
  restore: (id: string, rev: number) => api<QuestionRecord>(`/admin/questions/${encodeURIComponent(id)}/revisions/${rev}/restore`, json('POST')),
  trash: () => api<DeletedQuestion[]>('/admin/trash'),
  preview: (input: QuestionInput, signal?: AbortSignal) => api<Preview>('/admin/preview', { method: 'POST', body: input, signal }),

  syncPlan: () => api<SyncPlan>('/admin/sync'),
  applySync: (overwrite: boolean) => api<SyncPlan>('/admin/sync', json('POST', { overwrite })),
  exportSection: (id: string) => downloadFrom(`/admin/sections/${encodeURIComponent(id)}/export`, `${id}.md`),
  exportAll: () => downloadFrom('/admin/export', 'frontend-loop-content.zip'),

  submissions: (status: SubmissionStatus | 'all' = 'pending') => api<Submission[]>(`/admin/submissions?status=${status}`),
  approveSubmission: (id: number, question: QuestionInput, note: string) =>
    api<Submission>(`/admin/submissions/${id}/approve`, json('POST', { question, note })),
  rejectSubmission: (id: number, note: string) => api<Submission>(`/admin/submissions/${id}/reject`, json('POST', { note })),

  settings: () => api<SettingsResponse>('/admin/settings'),
  putSetting: (key: 'site' | 'features' | 'announcement', value: unknown) => api(`/admin/settings/${key}`, json('PUT', value)),

  audit: (before?: number) => api<AuditEntry[]>(`/admin/audit${before ? `?before=${before}` : ''}`),
};

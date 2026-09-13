export interface StoredField<T = string> {
  value: T;
  source: string;
  updatedAt: string;
}

export interface ClientRecord {
  nif: string;
  fields: Record<string, StoredField>;
  conflicts: Record<string, StoredField[]>;
}

export interface ClientDirectoryFile {
  schemaVersion: 1;
  clients: Record<string, ClientRecord>;
  updatedAt: string;
}

export interface VerifiedFieldInput {
  value: string;
  verified: boolean;
}

export interface VerifiedClientInput {
  nif: string;
  fields: Record<string, VerifiedFieldInput | undefined>;
}

export interface PersistedCaptureItem {
  id: string;
  fileId: string;
  status: 'pending' | 'processing' | 'review' | 'failed';
  attempts: number;
  error?: string;
  createdAt?: string;
  jointId?: string;
}

export interface GroupingOverride {
  id: string;
  kind: 'merge' | 'split';
  noticeIds: string[];
  groupId: string;
  assignments?: Record<string, string>;
  createdAt: string;
}

export interface ArchivedNotice {
  id: string;
  archivedAt: string;
  cliente_nombre: string;
  cliente_nif: string;
  models: string[];
  periods: string[];
  noticeIds: string[];
  captureIds?: string[];
  snapshot: unknown;
}

export interface NoticeState {
  schemaVersion: 1;
  queue: PersistedCaptureItem[];
  activeNotices: unknown[];
  archivedNotices: ArchivedNotice[];
  groupingOverrides: GroupingOverride[];
  selectedJointId?: string | null;
  draft?: unknown;
  updatedAt: string;
}

export interface NoticeSearchFilters {
  query?: string;
  model?: string;
  period?: string;
  from?: string;
  to?: string;
}

export interface BackupManifest {
  product: 'avisos-fiscales';
  schemaVersion: 1;
  exportedAt: string;
}

export interface NoticeBackup {
  manifest: BackupManifest;
  state: NoticeState;
  clients: ClientDirectoryFile | null;
  captures: Record<string, string>;
}

import type { ArchivedNotice, GroupingOverride, NoticeSearchFilters } from './storage/types';
import type { JointNotice, TaxNotice } from './types';
import { normalizeNifKey } from './validation';
import { jointTotals } from './summary';

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, ' ')
  .trim()
  .toUpperCase();

export function groupNotices(notices: TaxNotice[], overrides: GroupingOverride[]): JointNotice[] {
  const assignedGroup = (notice: TaxNotice): string => {
    let groupId = normalizeNifKey(notice.cliente_nif, notice.cliente_nombre);
    for (const override of overrides) {
      if (override.assignments?.[notice.id]) groupId = override.assignments[notice.id];
      else if (override.noticeIds.includes(notice.id)) groupId = override.groupId;
    }
    return groupId;
  };
  const groups = new Map<string, TaxNotice[]>();
  for (const notice of notices) {
    const groupId = assignedGroup(notice);
    groups.set(groupId, [...(groups.get(groupId) || []), notice]);
  }

  return Array.from(groups, ([id, group]) => {
    const taxes = [...group].sort((a, b) => b.timestamp - a.timestamp);
    const first = taxes[0];
    const noteSource = taxes.find((tax) => tax.mostrarNotaAsesoria) || taxes.find((tax) => tax.notaAsesoria?.trim());
    return {
      id,
      cliente_nombre: first.cliente_nombre,
      cliente_nif: first.cliente_nif,
      notices: taxes,
      ...jointTotals(taxes),
      notaAsesoria: noteSource?.notaAsesoria || '',
      mostrarNotaAsesoria: noteSource?.mostrarNotaAsesoria || false,
    };
  });
}

export function createSplitOverride(joint: JointNotice, createdAt = new Date().toISOString()): GroupingOverride {
  return {
    id: `split-${createdAt}-${joint.id}`,
    kind: 'split',
    noticeIds: joint.notices.map((notice) => notice.id),
    groupId: joint.id,
    assignments: Object.fromEntries(joint.notices.map((notice) => [notice.id, `${joint.id}:${notice.id}`])),
    createdAt,
  };
}

export function createMergeOverride(first: JointNotice, second: JointNotice, createdAt = new Date().toISOString()): GroupingOverride {
  const noticeIds = [...first.notices, ...second.notices].map((notice) => notice.id);
  return {
    id: `merge-${createdAt}-${first.id}`,
    kind: 'merge',
    noticeIds,
    groupId: first.id,
    assignments: Object.fromEntries(noticeIds.map((noticeId) => [noticeId, first.id])),
    createdAt,
  };
}

export function undoGroupingOverride(overrides: GroupingOverride[]): GroupingOverride[] {
  return overrides.slice(0, -1);
}

export function searchArchivedNotices(items: ArchivedNotice[], filters: NoticeSearchFilters): ArchivedNotice[] {
  const query = normalize(filters.query || '');
  const model = normalize(filters.model || '');
  const period = normalize(filters.period || '');
  const from = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
  return items.filter((item) => {
    const haystack = normalize(`${item.cliente_nombre} ${item.cliente_nif} ${item.models.join(' ')} ${item.periods.join(' ')}`);
    const archivedAt = new Date(item.archivedAt).getTime();
    return (!query || haystack.includes(query))
      && (!model || item.models.some((value) => normalize(value) === model))
      && (!period || item.periods.some((value) => normalize(value) === period))
      && archivedAt >= from
      && archivedAt <= to;
  });
}

export async function completeAndContinue({
  joint,
  mode,
  exportText,
  exportImage,
  archive,
  pendingJointIds,
}: {
  joint: JointNotice;
  mode: 'text' | 'image';
  exportText: (joint: JointNotice) => Promise<void>;
  exportImage: (joint: JointNotice) => Promise<void>;
  archive: (joint: JointNotice) => Promise<void>;
  pendingJointIds: string[];
}): Promise<string | null> {
  if (mode === 'text') await exportText(joint);
  else await exportImage(joint);
  await archive(joint);
  const currentIndex = pendingJointIds.indexOf(joint.id);
  return pendingJointIds.slice(currentIndex + 1).find((id) => id !== joint.id)
    || pendingJointIds.find((id) => id !== joint.id)
    || null;
}

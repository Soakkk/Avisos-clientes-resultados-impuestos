import type { TaxNotice } from './types';

export interface EditorDraft {
  jointId: string;
  clientName: string;
  clientNif: string;
  taxes: TaxNotice[];
}

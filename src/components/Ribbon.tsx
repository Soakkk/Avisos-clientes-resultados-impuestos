import type { ReactNode } from 'react';
import {
  Archive, CalendarDays, ClipboardPaste, Copy, Download, Edit2, FolderOpen, History, Image as ImageIcon,
  LifeBuoy, Settings2, Split, Trash2, Undo2, XCircle,
} from 'lucide-react';

function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ribbon-group" role="group" aria-label={label}>
      <div className="ribbon-group-items">{children}</div>
      <div className="ribbon-group-label">{label}</div>
    </div>
  );
}

function LargeButton({ icon, label, onClick, disabled, tone, shortcut }: {
  icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; tone?: 'primary' | 'success'; shortcut?: string;
}) {
  return (
    <button type="button" className="ribbon-large" data-tone={tone} onClick={onClick} disabled={disabled} title={shortcut ? `${label} (${shortcut})` : label}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SmallButton({ icon, label, onClick, disabled, danger }: {
  icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button type="button" className="ribbon-small" data-danger={danger} onClick={onClick} disabled={disabled}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

export interface RibbonProps {
  hasSelection: boolean;
  hasNotices: boolean;
  canSplit: boolean;
  canUndoGrouping: boolean;
  onPaste: () => void;
  onOpenFile: () => void;
  onCopyImage: () => void;
  onCopyText: () => void;
  onDownload: () => void;
  onComplete: () => void;
  onEdit: () => void;
  onSplit: () => void;
  onUndoGrouping: () => void;
  onDiscard: () => void;
  onClearAll: () => void;
  onHistory: () => void;
  onCalendar: () => void;
  onSettings: () => void;
  onExample: () => void;
}

export function Ribbon(props: RibbonProps) {
  const selected = props.hasSelection;
  return (
    <div className="ribbon" role="toolbar" aria-label="Herramientas">
      <RibbonGroup label="Captura">
        <LargeButton icon={<ClipboardPaste aria-hidden="true" />} label="Pegar captura" onClick={props.onPaste} tone="primary" shortcut="Ctrl+V" />
        <div className="ribbon-stack">
          <SmallButton icon={<FolderOpen aria-hidden="true" />} label="Abrir imagen…" onClick={props.onOpenFile} />
          <SmallButton icon={<LifeBuoy aria-hidden="true" />} label="Cargar ejemplo" onClick={props.onExample} />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Enviar al cliente">
        <LargeButton icon={<Archive aria-hidden="true" />} label="Copiar y siguiente" onClick={props.onComplete} disabled={!selected} tone="success" />
        <div className="ribbon-stack">
          <SmallButton icon={<ImageIcon aria-hidden="true" />} label="Copiar imagen" onClick={props.onCopyImage} disabled={!selected} />
          <SmallButton icon={<Copy aria-hidden="true" />} label="Copiar texto" onClick={props.onCopyText} disabled={!selected} />
          <SmallButton icon={<Download aria-hidden="true" />} label="Guardar PNG" onClick={props.onDownload} disabled={!selected} />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Aviso">
        <LargeButton icon={<Edit2 aria-hidden="true" />} label="Editar datos" onClick={props.onEdit} disabled={!selected} />
        <div className="ribbon-stack">
          <SmallButton icon={<Split aria-hidden="true" />} label="Separar impuestos" onClick={props.onSplit} disabled={!props.canSplit} />
          <SmallButton icon={<Undo2 aria-hidden="true" />} label="Deshacer agrupación" onClick={props.onUndoGrouping} disabled={!props.canUndoGrouping} />
          <SmallButton icon={<Trash2 aria-hidden="true" />} label="Descartar aviso" onClick={props.onDiscard} disabled={!selected} danger />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Herramientas">
        <LargeButton icon={<Settings2 aria-hidden="true" />} label="Ajustes" onClick={props.onSettings} />
        <div className="ribbon-stack">
          <SmallButton icon={<CalendarDays aria-hidden="true" />} label="Calendario AEAT" onClick={props.onCalendar} />
          <SmallButton icon={<History aria-hidden="true" />} label="Historial" onClick={props.onHistory} />
          <SmallButton icon={<XCircle aria-hidden="true" />} label="Vaciar bandeja" onClick={props.onClearAll} disabled={!props.hasNotices} danger />
        </div>
      </RibbonGroup>
    </div>
  );
}

import { CalendarDays, ExternalLink, RotateCcw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { searchArchivedNotices } from '../history';
import type { ArchivedNotice } from '../storage/types';

export function NoticeHistory({
  items,
  onReopen,
  onViewCapture,
}: {
  items: ArchivedNotice[];
  onReopen: (notice: ArchivedNotice) => void;
  onViewCapture: (captureId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [model, setModel] = useState('');
  const [period, setPeriod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const results = useMemo(() => searchArchivedNotices(items, { query, model, period, from, to }), [from, items, model, period, query, to]);
  const models = Array.from(new Set(items.flatMap((item) => item.models))).sort();
  const periods = Array.from(new Set(items.flatMap((item) => item.periods))).sort();

  return (
    <section className="history-panel" aria-labelledby="history-heading">
      <div className="panel-heading">
        <div>
          <h2 id="history-heading">Historial</h2>
          <p>Avisos archivados y capturas originales</p>
        </div>
        <span className="history-count">{results.length} resultados</span>
      </div>
      <div className="history-filters">
        <label className="search-field"><span>Buscar</span><span className="field-control"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre o NIF" /></span></label>
        <label><span>Modelo</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="">Todos</option>{models.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Periodo</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="">Todos</option>{periods.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Desde</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>Hasta</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      {results.length === 0 ? (
        <p className="empty-copy">No hay avisos archivados que coincidan con estos filtros.</p>
      ) : (
        <div className="history-table" role="table" aria-label="Avisos archivados">
          {results.map((item) => (
            <article key={item.id} role="row">
              <div className="history-client"><strong>{item.cliente_nombre}</strong><span>{item.cliente_nif}</span></div>
              <div><strong>{item.models.join(', ')}</strong><span>{item.periods.join(', ')}</span></div>
              <time dateTime={item.archivedAt}><CalendarDays aria-hidden="true" />{new Date(item.archivedAt).toLocaleDateString('es-ES')}</time>
              <div className="history-actions">
                <button type="button" onClick={() => onReopen(item)}><RotateCcw aria-hidden="true" />Reabrir</button>
                <button type="button" disabled={!item.captureIds?.[0]} onClick={() => item.captureIds?.[0] && onViewCapture(item.captureIds[0])}><ExternalLink aria-hidden="true" />Captura</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

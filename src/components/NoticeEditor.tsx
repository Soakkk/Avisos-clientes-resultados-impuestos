import React, { useEffect, useState } from 'react';
import type { EditorDraft } from '../editorDraft';
import { TaxNotice, JointNotice, withDeadlines, normalizeTaxResult } from '../types';
import { Save, Trash2, Plus, X } from 'lucide-react';
import { jointTotals } from '../summary';

interface NoticeEditorProps {
  notice: JointNotice;
  onSave: (updatedNotice: JointNotice) => void;
  onCancel: () => void;
  initialDraft?: EditorDraft | null;
  onDraftChange?: (draft: EditorDraft) => void;
}

export const NoticeEditor: React.FC<NoticeEditorProps> = ({ notice, onSave, onCancel, initialDraft, onDraftChange }) => {
  const restored = initialDraft?.jointId === notice.id ? initialDraft : null;
  const [clientName, setClientName] = useState(restored?.clientName ?? notice.cliente_nombre);
  const [clientNif, setClientNif] = useState(restored?.clientNif ?? notice.cliente_nif);
  const [taxes, setTaxes] = useState<TaxNotice[]>(restored?.taxes ?? [...notice.notices]);
  useEffect(() => {
    onDraftChange?.({ jointId: notice.id, clientName, clientNif, taxes });
  }, [clientName, clientNif, taxes, notice.id, onDraftChange]);

  const handleTaxChange = (index: number, field: keyof TaxNotice, value: any) => {
    const updatedTaxes = [...taxes];
    let updatedTax = {
      ...updatedTaxes[index],
      [field]: value,
    };
    if (field === 'tipo_resultado') {
      updatedTax.tipo_resultado = normalizeTaxResult(updatedTax.modelo, value);
    }
    if (field === 'modelo' || field === 'periodo' || field === 'ejercicio') {
      updatedTax = withDeadlines(updatedTax);
    }
    updatedTaxes[index] = updatedTax;
    setTaxes(updatedTaxes);
  };

  const handleRemoveTax = (index: number) => {
    const updatedTaxes = taxes.filter((_, i) => i !== index);
    setTaxes(updatedTaxes);
  };

  const handleAddTax = () => {
    const now = new Date();
    const currentQuarter = `${Math.floor(now.getMonth() / 3) + 1}T`;
    const exercise = now.getFullYear().toString();
    const newTax: TaxNotice = withDeadlines({
      id: Math.random().toString(36).substr(2, 9),
      modelo: '303',
      modelo_nombre: 'Impuesto sobre el Valor Añadido',
      periodo: currentQuarter,
      ejercicio: exercise,
      cliente_nif: clientNif,
      cliente_nombre: clientName,
      importe: 0,
      tipo_resultado: 'Domiciliación',
      iban: taxes[0]?.iban || '',
      fechaCargo: '',
      fechaLimiteDomiciliacion: '',
      timestamp: Date.now(),
    });
    setTaxes([...taxes, newTax]);
  };

  const [error, setError] = useState('');

  const handleSave = () => {
    if (!clientName.trim() || !clientNif.trim()) {
      setError('Rellene el nombre y el NIF del cliente.');
      return;
    }
    if (taxes.length === 0) {
      setError('El aviso necesita al menos una declaración.');
      return;
    }

    const cleanNif = clientNif.replace(/[\s.-]+/g, '').toUpperCase();
    const updatedTaxes = taxes.map((t) => ({
      ...t,
      cliente_nombre: clientName.trim(),
      cliente_nif: cleanNif,
      iban: (t.iban || '').replace(/\s+/g, '').toUpperCase(),
    }));
    const updatedJointNotice: JointNotice = {
      ...notice,
      cliente_nombre: clientName.trim(),
      cliente_nif: cleanNif,
      notices: updatedTaxes,
      ...jointTotals(updatedTaxes),
    };
    onSave(updatedJointNotice);
  };

  return (
    <div className="editor">
      <div className="section-heading">
        <h3>Editar datos del aviso</h3>
        <button type="button" onClick={onCancel} className="icon-btn" id="btn-cancel-edit" aria-label="Cerrar sin guardar">
          <X aria-hidden="true" />
        </button>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Nombre completo del cliente</span>
          <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </label>
        <label className="field">
          <span>NIF / CIF / NIE</span>
          <input type="text" className="mono" value={clientNif} onChange={(e) => setClientNif(e.target.value)} />
        </label>
      </div>

      <div className="section-heading">
        <h3>Declaraciones</h3>
        <button type="button" onClick={handleAddTax} className="link-btn" id="btn-add-tax">
          <Plus aria-hidden="true" /> Añadir declaración
        </button>
      </div>

      {taxes.length === 0 ? (
        <p className="muted">No hay declaraciones en este aviso.</p>
      ) : (
        <div className="editor-taxes">
          {taxes.map((tax, index) => {
            const needsAccount = tax.tipo_resultado === 'Domiciliación' || tax.tipo_resultado === 'Devolución';
            const noPayment = ['A compensar', 'Resultado negativo', 'Resultado cero / Sin actividad'].includes(tax.tipo_resultado);
            return (
              <fieldset key={tax.id} className="editor-tax">
                <legend>Declaración {index + 1}</legend>
                {taxes.length > 1 && (
                  <button type="button" onClick={() => handleRemoveTax(index)} className="icon-btn editor-remove" title="Quitar esta declaración" aria-label="Quitar esta declaración">
                    <Trash2 aria-hidden="true" />
                  </button>
                )}
                <div className="field-grid field-grid-4">
                  <label className="field">
                    <span>Modelo</span>
                    <input type="text" inputMode="numeric" value={tax.modelo} onChange={(e) => handleTaxChange(index, 'modelo', e.target.value.trim())} />
                  </label>
                  <label className="field">
                    <span>Periodo</span>
                    <input type="text" list="periodos-aeat" value={tax.periodo} onChange={(e) => handleTaxChange(index, 'periodo', e.target.value.toUpperCase().trim())} placeholder="1T, 01, 1P, 0A" />
                  </label>
                  <label className="field">
                    <span>Ejercicio</span>
                    <input type="text" inputMode="numeric" value={tax.ejercicio} onChange={(e) => handleTaxChange(index, 'ejercicio', e.target.value.trim())} />
                  </label>
                  <label className="field">
                    <span>Importe (€)</span>
                    <input
                      type="number"
                      step="0.01"
                      className="num"
                      value={Number.isFinite(tax.importe) ? tax.importe : 0}
                      onChange={(e) => handleTaxChange(index, 'importe', parseFloat(e.target.value) || 0)}
                    />
                  </label>
                </div>
                <div className="field-grid field-grid-3">
                  <label className="field field-span-2">
                    <span>Nombre del impuesto</span>
                    <input type="text" value={tax.modelo_nombre} onChange={(e) => handleTaxChange(index, 'modelo_nombre', e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Resultado</span>
                    <select value={tax.tipo_resultado} onChange={(e) => handleTaxChange(index, 'tipo_resultado', e.target.value)}>
                      <option value="Domiciliación">Domiciliación</option>
                      <option value="A ingresar">A ingresar</option>
                      <option value="A compensar">A compensar</option>
                      <option value="Resultado negativo">Negativa (no paga, se descuenta)</option>
                      <option value="Resultado cero / Sin actividad">Sin actividad</option>
                      <option value="Devolución">Devolución (la AEAT le ingresa)</option>
                    </select>
                  </label>
                </div>
                <div className="field-grid">
                  {needsAccount && (
                    <label className="field">
                      <span>{tax.tipo_resultado === 'Devolución' ? 'IBAN de abono' : 'IBAN de cargo'}</span>
                      <input type="text" className="mono" value={tax.iban || ''} onChange={(e) => handleTaxChange(index, 'iban', e.target.value)} placeholder="ES00 0000 0000 0000 0000 0000" />
                    </label>
                  )}
                  <label className="field">
                    <span>Nº de justificante <small>(opcional)</small></span>
                    <input type="text" className="mono" value={tax.numero_justificante || ''} onChange={(e) => handleTaxChange(index, 'numero_justificante', e.target.value.replace(/\s+/g, ''))} />
                  </label>
                  {/* La fecha de presentación solo se enseña en los avisos que no
                      hay que pagar, que es donde sustituye al importe. */}
                  {noPayment && (
                    <label className="field">
                      <span>Fecha de presentación <small>(vacía = no se muestra)</small></span>
                      <input
                        type="date"
                        value={tax.fechaPresentacion ? tax.fechaPresentacion.slice(0, 10) : ''}
                        onChange={(e) =>
                          handleTaxChange(
                            index,
                            'fechaPresentacion',
                            // El input da 'aaaa-mm-dd'; se guarda a mediodía para que
                            // ningún huso horario mueva la fecha un día atrás.
                            e.target.value ? new Date(e.target.value + 'T12:00:00').toISOString() : '',
                          )
                        }
                      />
                    </label>
                  )}
                </div>
              </fieldset>
            );
          })}
        </div>
      )}
      <datalist id="periodos-aeat">
        {['1T', '2T', '3T', '4T', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '1P', '2P', '3P', '0A'].map((value) => <option key={value} value={value} />)}
      </datalist>

      {error && <p className="inline-result" data-ok="false" role="alert">{error}</p>}
      <div className="details-footer">
        <button type="button" onClick={onCancel} className="btn" id="btn-edit-cancel">Cancelar</button>
        <button type="button" onClick={handleSave} className="btn btn-primary" id="btn-edit-save">
          <Save aria-hidden="true" /> Guardar cambios
        </button>
      </div>
    </div>
  );
};

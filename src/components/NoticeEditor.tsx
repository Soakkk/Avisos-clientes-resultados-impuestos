import React, { useState } from 'react';
import { TaxNotice, JointNotice } from '../types';
import { Save, Trash2, Plus, X } from 'lucide-react';

interface NoticeEditorProps {
  notice: JointNotice;
  onSave: (updatedNotice: JointNotice) => void;
  onCancel: () => void;
}

export const NoticeEditor: React.FC<NoticeEditorProps> = ({ notice, onSave, onCancel }) => {
  const [clientName, setClientName] = useState(notice.cliente_nombre);
  const [clientNif, setClientNif] = useState(notice.cliente_nif);
  const [taxes, setTaxes] = useState<TaxNotice[]>([...notice.notices]);

  const handleTaxChange = (index: number, field: keyof TaxNotice, value: any) => {
    const updatedTaxes = [...taxes];
    updatedTaxes[index] = {
      ...updatedTaxes[index],
      [field]: value,
    };
    setTaxes(updatedTaxes);
  };

  const handleRemoveTax = (index: number) => {
    const updatedTaxes = taxes.filter((_, i) => i !== index);
    setTaxes(updatedTaxes);
  };

  const handleAddTax = () => {
    const newTax: TaxNotice = {
      id: Math.random().toString(36).substr(2, 9),
      modelo: '303',
      modelo_nombre: 'Impuesto sobre el Valor Añadido',
      periodo: '2T',
      ejercicio: new Date().getFullYear().toString(),
      cliente_nif: clientNif,
      cliente_nombre: clientName,
      importe: 0,
      tipo_resultado: 'Domiciliación',
      iban: taxes[0]?.iban || '',
      fechaCargo: new Date().toISOString(),
      fechaLimiteDomiciliacion: new Date().toISOString(),
      timestamp: Date.now(),
    };
    setTaxes([...taxes, newTax]);
  };

  const handleSave = () => {
    if (!clientName.trim() || !clientNif.trim()) {
      alert("Por favor, rellene el nombre y NIF del cliente.");
      return;
    }

    const updatedJointNotice: JointNotice = {
      ...notice,
      cliente_nombre: clientName,
      cliente_nif: clientNif,
      notices: taxes.map(t => ({
        ...t,
        cliente_nombre: clientName,
        cliente_nif: clientNif,
      })),
      total_importe: taxes.reduce((acc, curr) => acc + curr.importe, 0),
      iban: taxes.find(t => t.iban)?.iban || '',
      todosDomiciliados: taxes.length > 0 && taxes.every(t => t.tipo_resultado === 'Domiciliación'),
    };
    onSave(updatedJointNotice);
  };

  return (
    <div className="bg-stone-50 rounded-xl p-5 border border-stone-200 mt-4">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-display font-bold text-sm text-slate-900">Editar Datos del Aviso</h4>
        <button 
          onClick={onCancel}
          className="text-slate-400 hover:text-slate-600 p-1"
          id="btn-cancel-edit"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1">Nombre Completo Cliente</label>
          <input
            type="text"
            className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg focus:outline-slate-800 bg-white"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1">NIF / CIF</label>
          <input
            type="text"
            className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg focus:outline-slate-800 bg-white"
            value={clientNif}
            onChange={(e) => setClientNif(e.target.value)}
          />
        </div>
      </div>

      <div className="border-t border-stone-200 pt-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <label className="block text-xs font-bold text-stone-700">Desglose de Impuestos</label>
          <button
            onClick={handleAddTax}
            className="flex items-center gap-1 text-[11px] font-bold text-slate-800 hover:text-black"
            id="btn-add-tax"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Añadir Impuesto</span>
          </button>
        </div>

        {taxes.length === 0 ? (
          <p className="text-xs text-stone-500 italic py-2">No hay impuestos registrados para este cliente.</p>
        ) : (
          <div className="space-y-4">
            {taxes.map((tax, index) => (
              <div key={tax.id} className="bg-white p-3 rounded-lg border border-stone-200 relative">
                {taxes.length > 1 && (
                  <button
                    onClick={() => handleRemoveTax(index)}
                    className="absolute top-2 right-2 text-rose-500 hover:text-rose-700 p-1"
                    title="Eliminar este impuesto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Modelo</label>
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-xs border border-stone-300 rounded focus:outline-slate-800"
                      value={tax.modelo}
                      onChange={(e) => handleTaxChange(index, 'modelo', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Periodo (ej. 2T, 01)</label>
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-xs border border-stone-300 rounded focus:outline-slate-800"
                      value={tax.periodo}
                      onChange={(e) => handleTaxChange(index, 'periodo', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Año</label>
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-xs border border-stone-300 rounded focus:outline-slate-800"
                      value={tax.ejercicio}
                      onChange={(e) => handleTaxChange(index, 'ejercicio', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Importe (€)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full px-2 py-1 text-xs border border-stone-300 rounded focus:outline-slate-800"
                      value={tax.importe}
                      onChange={(e) => handleTaxChange(index, 'importe', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Concepto / Nombre del Impuesto</label>
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-xs border border-stone-300 rounded focus:outline-slate-800"
                      value={tax.modelo_nombre}
                      onChange={(e) => handleTaxChange(index, 'modelo_nombre', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Tipo Resultado</label>
                    <select
                      className="w-full px-2 py-1 text-xs border border-stone-300 rounded focus:outline-slate-800 bg-white"
                      value={tax.tipo_resultado}
                      onChange={(e) => handleTaxChange(index, 'tipo_resultado', e.target.value)}
                    >
                      <option value="Domiciliación">Domiciliación</option>
                      <option value="A ingresar">A ingresar</option>
                      <option value="A compensar">A compensar</option>
                      <option value="Resultado cero / Sin actividad">Sin actividad</option>
                      <option value="Devolución">Devolución</option>
                    </select>
                  </div>
                </div>

                {tax.tipo_resultado === 'Domiciliación' && (
                  <div className="mt-2">
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">IBAN de Cargo</label>
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-xs border border-stone-300 rounded focus:outline-slate-800 font-mono"
                      value={tax.iban || ''}
                      onChange={(e) => handleTaxChange(index, 'iban', e.target.value)}
                      placeholder="ES00 0000..."
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
          id="btn-edit-cancel"
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white bg-slate-800 hover:bg-slate-900 transition-colors"
          id="btn-edit-save"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Guardar Cambios</span>
        </button>
      </div>
    </div>
  );
};

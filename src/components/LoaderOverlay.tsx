import React from 'react';
import { Loader2, Info } from 'lucide-react';
import { motion } from 'motion/react';

interface LoaderOverlayProps {
  step: number;
  takingLong?: boolean;
}

const STEPS = [
  "Leyendo imagen del portapapeles...",
  "Conectando de forma segura con el servidor...",
  "Gemini está analizando la estructura del modelo fiscal...",
  "Extrayendo NIF, nombre, periodo e importe tributario...",
  "Calculando plazos oficiales de la AEAT...",
  "Generando aviso personalizado..."
];

export const LoaderOverlay: React.FC<LoaderOverlayProps> = ({ step, takingLong }) => {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
    >
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full border border-slate-100 flex flex-col items-center text-center">
        <div className="relative mb-6">
          <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
            <Loader2 className="w-8 h-8 text-slate-800 animate-spin" />
          </div>
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white">
            AI
          </div>
        </div>
        
        <h3 className="font-display text-lg font-bold text-slate-900 mb-2">
          Procesando Declaración
        </h3>
        
        <p className="text-slate-500 text-sm mb-6 h-10 flex items-center justify-center font-medium">
          {STEPS[Math.min(step, STEPS.length - 1)]}
        </p>

        {/* Progress indicator */}
        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
          <motion.div 
            className="bg-slate-800 h-full rounded-full"
            animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        
        <div className="mt-4 text-[11px] font-mono text-slate-400">
          Paso {step + 1} de {STEPS.length}
        </div>

        {takingLong && (
          <div className="mt-5 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-left">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 leading-relaxed">
              Gemini está tardando más de lo normal. La app lo está reintentando sola, no cierres esta ventana. Un momento…
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
};

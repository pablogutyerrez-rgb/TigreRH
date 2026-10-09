export interface TrainingVariableCalculationInput {
  formula_version?: number;
  porcentaje_rotacion?: number;
  porcentaje_retencion: number;
  porcentaje_produccion_individual: number;
  porcentaje_produccion_grupal: number;
  porcentaje_satisfaccion: number;
  porcentaje_administrativo: number;
  observacion_administrativa?: string;
}

const toBasisPoints = (value: number) => Math.round(Number(value || 0) * 100);
const fromBasisPoints = (value: number) => Math.round(value) / 100;
const divideRound = (numerator: number, denominator: number) => Math.round(numerator / denominator);
const moneyFromCents = (cents: number) => Math.round(cents) / 100;
const META_RETENCION_BP = 7000;
const PESO_RETENCION_BP = 3000;
const PESO_PRODUCCION_BP = 5000;
const META_SATISFACCION_BP = 9000;
const PESO_SATISFACCION_BP = 1000;
const PESO_ADMINISTRATIVO_BP = 1000;
const MINIMO_PAGO_GLOBAL_BP = 8500;

export const calculateTrainingVariablePreview = (input: TrainingVariableCalculationInput) => {
  if (input.formula_version === 2) return calculateCurrentVariable(input);
  const retencionBp = toBasisPoints(input.porcentaje_retencion);
  const produccionGrupalBp = toBasisPoints(input.porcentaje_produccion_grupal);
  const satisfaccionBp = toBasisPoints(input.porcentaje_satisfaccion);
  const administrativoBp = toBasisPoints(input.porcentaje_administrativo);

  const cumplimientoRetencionBp = divideRound(retencionBp * 10000, META_RETENCION_BP);
  const aporteRetencionBp = divideRound(cumplimientoRetencionBp * PESO_RETENCION_BP, 10000);
  const aporteProduccionBp = divideRound(produccionGrupalBp * PESO_PRODUCCION_BP, 10000);
  const cumplimientoSatisfaccionBp = divideRound(satisfaccionBp * 10000, META_SATISFACCION_BP);
  const aporteSatisfaccionBp = divideRound(cumplimientoSatisfaccionBp * PESO_SATISFACCION_BP, 10000);
  const aporteAdministrativoBp = divideRound(administrativoBp * PESO_ADMINISTRATIVO_BP, 10000);
  const cumplimientoTotalBp =
    aporteRetencionBp + aporteProduccionBp + aporteSatisfaccionBp + aporteAdministrativoBp;

  const bloques = cumplimientoTotalBp > 10000 ? Math.floor((cumplimientoTotalBp - 10000) / 1000) : 0;
  const bonoCents = bloques * 5000;
  const comisionCents = cumplimientoTotalBp < MINIMO_PAGO_GLOBAL_BP
    ? 0
    : cumplimientoTotalBp <= 10000
      ? divideRound(30000 * cumplimientoTotalBp, 10000)
      : 30000 + bonoCents;

  return {
    cumplimiento_retencion: fromBasisPoints(cumplimientoRetencionBp),
    aporte_retencion: fromBasisPoints(aporteRetencionBp),
    aporte_produccion: fromBasisPoints(aporteProduccionBp),
    cumplimiento_satisfaccion: fromBasisPoints(cumplimientoSatisfaccionBp),
    aporte_satisfaccion: fromBasisPoints(aporteSatisfaccionBp),
    aporte_administrativo: fromBasisPoints(aporteAdministrativoBp),
    cumplimiento_total: fromBasisPoints(cumplimientoTotalBp),
    comision_base: 300,
    bloques_sobrecumplimiento: bloques,
    bono_sobrecumplimiento: moneyFromCents(bonoCents),
    comision_total: moneyFromCents(comisionCents),
  };
};

const calculateCurrentVariable = (input: TrainingVariableCalculationInput) => {
  const rotation = input.porcentaje_rotacion ?? 0;
  const values = [input.porcentaje_retencion, input.porcentaje_produccion_grupal, input.porcentaje_satisfaccion, input.porcentaje_administrativo];
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new Error('Los resultados deben estar entre 0 y 100%.');
  }
  if (rotation == null || !Number.isFinite(rotation) || rotation < 0 || rotation > 100) {
    throw new Error('La rotación debe estar entre 0 y 100%.');
  }
  const retention = Math.min(10000, divideRound(toBasisPoints(input.porcentaje_retencion) * 10000, 5000));
  const satisfaction = Math.min(10000, divideRound(toBasisPoints(input.porcentaje_satisfaccion) * 10000, 9000));
  const r = divideRound(retention * 3000, 10000);
  const p = divideRound(Math.min(10000, toBasisPoints(input.porcentaje_produccion_grupal)) * 5000, 10000);
  const s = divideRound(satisfaction * 1000, 10000);
  const administrative = Math.min(10000, toBasisPoints(input.porcentaje_administrativo));
  const a = divideRound(administrative * 1000, 10000);
  const total = r + p + s + a;
  const commissionApplicable = total < 9000 ? 0 : moneyFromCents(Math.min(30000, divideRound(30000 * total, 10000)));
  const rotationDiscount = rotation > 10 ? moneyFromCents(Math.round(commissionApplicable * 20)) : 0;
  const commission = moneyFromCents(Math.round((commissionApplicable - rotationDiscount) * 100));
  return {
    cumplimiento_retencion: fromBasisPoints(retention), aporte_retencion: fromBasisPoints(r),
    aporte_produccion: fromBasisPoints(p), cumplimiento_satisfaccion: fromBasisPoints(s),
    aporte_satisfaccion: fromBasisPoints(s), aporte_administrativo: fromBasisPoints(a),
    cumplimiento_total: fromBasisPoints(total), comision_base: 300,
    bloques_sobrecumplimiento: 0, bono_sobrecumplimiento: 0,
    comision_aplicable: commissionApplicable,
    descuento_rotacion: rotationDiscount,
    comision_total: commission,
  };
};

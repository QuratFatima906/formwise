import type { BuildingModel } from './domain/model';
import { heatLossSummary } from './domain/geometry';
import { f2 } from './domain/validate';

export const METHOD_NOTE = 'H_T = sum(U_i * A_i). Simplified estimate, not an official GEG/DIN V 18599 calculation. No thermal-bridge surcharge.';

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** One row per envelope element plus a TOTAL row; values rounded to 2 dp. */
export function summaryCsv(m: BuildingModel): string {
  const s = heatLossSummary(m);
  const lines = [
    'element_type,element_id,name,storey,area_m2,u_value_W_m2K,ua_W_K',
    ...s.rows.map((r) => [r.kind, r.id, csvCell(r.name), r.storeyId, f2(r.area), f2(r.uValue), f2(r.ua)].join(',')),
    ['TOTAL', '', '', '', f2(s.area), '', f2(s.total)].join(','),
  ];
  return lines.join('\n') + '\n';
}

export function summaryJson(m: BuildingModel, generatedAt: Date): string {
  const s = heatLossSummary(m);
  const round = (v: number) => Number(v.toFixed(4));
  return JSON.stringify({
    project: m.name,
    generatedAt: generatedAt.toISOString(),
    units: { length: 'm', area: 'm2', uValue: 'W/m2K', ua: 'W/K' },
    method: METHOD_NOTE,
    elements: s.rows.map((r) => ({ type: r.kind, id: r.id, name: r.name, storey: r.storeyId, area_m2: round(r.area), u_value_W_m2K: r.uValue, ua_W_K: round(r.ua) })),
    totals: { area_m2: round(s.area), H_T_W_K: round(s.total) },
  }, null, 2);
}

/** Binary glTF of the model; mesh names are `<elementId>:<role>`, extras carry elementId/elementType. */
export async function modelGlb(m: BuildingModel): Promise<ArrayBuffer> {
  const [{ GLTFExporter }, { buildBuilding }] = await Promise.all([import('three/addons/exporters/GLTFExporter.js'), import('./scene')]);
  const { group } = buildBuilding(m, { forExport: true });
  return (await new GLTFExporter().parseAsync(group, { binary: true })) as ArrayBuffer;
}

export function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

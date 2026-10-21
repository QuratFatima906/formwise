import type { BuildingModel } from './domain/model';
import { validate } from './domain/validate';
import { parseModel } from './persistence';

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_ELEMENTS = 2000;
/** `accept` hint for the file picker; the checks below are what actually enforce it. */
export const ACCEPT = '.json,application/json';
export const PROJECT_FORMAT = 'formwise.project';
export const PROJECT_VERSION = 1;

/** Browsers report "" for unknown types; anything else must be a JSON type. */
const ACCEPTED_MIME = new Set(['', 'application/json', 'text/json']);

export type ImportResult =
  | { ok: true; format: 'formwise'; model: BuildingModel; issues: number; warnings: string[] }
  | { ok: false; error: string };

const fail = (error: string): ImportResult => ({ ok: false, error });
const byteCount = (n: number) => `${n.toLocaleString('en-US')} bytes`;

/** Checks name, size and MIME type before any bytes are read. Returns an error or null. */
export function checkFileMeta(name: string, size: number, type: string): string | null {
  if (!name.toLowerCase().endsWith('.json')) return `“${name}” is not a .json file. Formwise opens Formwise project files (.formwise.json).`;
  if (!ACCEPTED_MIME.has(type)) return `“${name}” has type ${type}, not JSON.`;
  if (size === 0) return `“${name}” is empty.`;
  if (size > MAX_IMPORT_BYTES) return `“${name}” is ${byteCount(size)}; the limit is 1 MB (${byteCount(MAX_IMPORT_BYTES)}).`;
  return null;
}

/** Strict UTF-8 → JSON → known format → validated model. */
export function parseImportBytes(bytes: ArrayBuffer): ImportResult {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('The file is not valid UTF-8 text.');
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return fail(`The file is not valid JSON (${(e as Error).message}).`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return fail('The file must contain a JSON object.');
  const d = data as Record<string, unknown>;

  if (d.format !== PROJECT_FORMAT) return fail(`Unrecognised file: expected "format": "${PROJECT_FORMAT}".`);
  if (d.version !== PROJECT_VERSION) return fail(`Project file version ${String(d.version)} is not supported; this app reads version ${PROJECT_VERSION}.`);
  const model = parseModel(d.model);
  if (!model) return fail('The project data is malformed: missing fields, wrong types, duplicate IDs or unknown storeys.');
  const n = Object.keys(model.elements).length;
  if (n === 0) return fail('The project contains no elements.');
  if (n > MAX_IMPORT_ELEMENTS) return fail(`The project has ${n} elements; the limit is ${MAX_IMPORT_ELEMENTS}.`);
  return { ok: true, format: 'formwise', model, issues: validate(model).length, warnings: [] };
}

export async function readImportFile(file: File): Promise<ImportResult> {
  const err = checkFileMeta(file.name, file.size, file.type);
  if (err) return fail(err);
  try {
    return parseImportBytes(await file.arrayBuffer());
  } catch (e) {
    return fail(`The file could not be read (${(e as Error).message}).`);
  }
}

/** Serialises the model as a project file that `parseImportBytes` reads back. */
export function projectFile(m: BuildingModel): string {
  return JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, model: m }, null, 2);
}

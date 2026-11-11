'use client';

import { useState, type ReactNode } from 'react';
import { Box, Button, Flex, Input, Text, Textarea } from '@chakra-ui/react';

export const PARAM_TYPES = [
  'int', 'bigint', 'decimal', 'nvarchar', 'varchar', 'bit', 'datetime', 'date', 'uniqueidentifier',
] as const;
export type ParamType = (typeof PARAM_TYPES)[number];
export type ParamValue = string | number | boolean | null;
export type ExecParam = { name: string; type: ParamType; value: ParamValue; output?: boolean };
export type ExecTarget =
  | { kind: 'procedure'; name: string; params: ExecParam[] }
  | { kind: 'batch'; sql: string };

export type ParamRow = { id: number; name: string; type: ParamType; value: string; isNull: boolean; output: boolean };
export type TargetDraft = { name: string; params: ParamRow[]; sql: string };

export const emptyDraft = (): TargetDraft => ({ name: '', params: [], sql: '' });

let nextId = 1;
export const newParamRow = (): ParamRow => ({ id: nextId++, name: '', type: 'nvarchar', value: '', isNull: false, output: false });

const NAME_RE = /^@?[A-Za-z_][A-Za-z0-9_]*$/;
const PROC_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

const label = (row: ParamRow) => `Parameter ${row.name.trim() || '(unnamed)'}`;

/** The first problem with one parameter row, or null. Shown under the field and used to block the run. */
export function rowError(row: ParamRow): string | null {
  if (!row.name.trim()) return 'Enter the parameter name, for example @StartDate';
  if (!NAME_RE.test(row.name.trim())) return 'Name must look like @StartDate: a letter or underscore, then letters, digits or underscores';
  if (row.isNull) return null;
  const text = row.value.trim();
  switch (row.type) {
    case 'int':
    case 'bigint': {
      const n = Number(text);
      if (text === '' || !Number.isFinite(n)) return `${label(row)} must be a number`;
      if (!Number.isInteger(n)) return `${label(row)} must be a whole number`;
      if (row.type === 'int' && (n < INT_MIN || n > INT_MAX)) return `${label(row)} is outside the int range`;
      return null;
    }
    case 'decimal':
      return text === '' || !Number.isFinite(Number(text)) ? `${label(row)} must be a number` : null;
    case 'bit': {
      const v = text.toLowerCase();
      return v === '1' || v === '0' || v === 'true' || v === 'false' ? null : `${label(row)} must be true/false or 1/0`;
    }
    case 'date':
    case 'datetime': {
      const hint = row.type === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS';
      const m = DATE_RE.exec(text);
      if (!m || (row.type === 'date' && text.length !== 10)) return `${label(row)} must be a date: ${hint}`;
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const [hh, mm, ss] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
      const real = new Date(Date.UTC(y, mo - 1, d));
      const calendarOk = real.getUTCFullYear() === y && real.getUTCMonth() === mo - 1 && real.getUTCDate() === d;
      if (!calendarOk || hh > 23 || mm > 59 || ss > 59) return `${label(row)} must be a real date: ${hint}`;
      return null;
    }
    default:
      return null;
  }
}

/** The value as sent to the server: dates in SQL form, numbers and bits converted. Call after rowError is null. */
function normalise(row: ParamRow): ParamValue {
  if (row.isNull) return null;
  const text = row.value.trim();
  switch (row.type) {
    case 'int':
    case 'bigint':
    case 'decimal':
      return Number(text);
    case 'bit':
      return text.toLowerCase() === '1' || text.toLowerCase() === 'true';
    case 'datetime': {
      const m = DATE_RE.exec(text);
      if (!m) return text;
      return `${m[1]}-${m[2]}-${m[3]} ${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
    }
    default:
      return text;
  }
}

/** The first problem with the whole target, or null. Empty drafts are handled by the caller. */
export function targetError(kind: 'procedure' | 'batch', draft: TargetDraft): string | null {
  if (kind === 'batch') return null;
  if (!draft.name.trim()) return null;
  if (!PROC_RE.test(draft.name.trim())) return 'Procedure name must look like dbo.MyProcedure';
  for (const row of draft.params) {
    const e = rowError(row);
    if (e) return e;
  }
  return null;
}

/** Build the C12 ExecTarget from a draft, or return a user-facing error. */
export function buildTarget(
  kind: 'procedure' | 'batch',
  draft: TargetDraft
): { ok: true; target: ExecTarget } | { ok: false; error: string } {
  if (kind === 'batch') return { ok: true, target: { kind, sql: draft.sql } };
  const error = targetError(kind, draft);
  if (error) return { ok: false, error };
  const params: ExecParam[] = draft.params.map((row) => ({
    name: row.name.trim(), type: row.type, value: normalise(row), ...(row.output ? { output: true } : {}),
  }));
  return { ok: true, target: { kind, name: draft.name.trim(), params } };
}

export function isDraftEmpty(kind: 'procedure' | 'batch', draft: TargetDraft): boolean {
  return kind === 'batch' ? !draft.sql.trim() : !draft.name.trim();
}

/** The HTML input type for a parameter's value box. */
function inputTypeFor(type: ParamType): string {
  // FIX-3: a date-time is typed as text in 24-hour form. The native datetime-local box follows the
  // browser's clock, and in a 12-hour setting typing 23 can come out as 02.
  if (type === 'date') return 'date';
  return 'text';
}

function Field({ caption, error, hint, children }: { caption: string; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <Box flex="1" minW={{ md: '120px' }}>
      <Text fontSize="xs" color="fg.muted" mb={1}>{caption}</Text>
      {children}
      {error && <Text fontSize="xs" color="status.bad" mt={1}>{error}</Text>}
      {!error && hint && <Text fontSize="xs" color="fg.muted" mt={1}>{hint}</Text>}
    </Box>
  );
}

export function TargetEditor({
  kind, draft, onChange, placeholder, color, onLoadParams, loadNote, setNames, onSaveSet, onLoadSet, onDeleteSet,
}: {
  kind: 'procedure' | 'batch';
  draft: TargetDraft;
  onChange: (d: TargetDraft) => void;
  placeholder: string;
  color: string;
  /** UX-2: read the procedure's parameters from the database into the rows. */
  onLoadParams?: () => void;
  loadNote?: string | null;
  /** UX-3: named parameter sets for this procedure, kept in this browser. */
  setNames?: string[];
  onSaveSet?: (name: string) => void;
  onLoadSet?: (name: string) => void;
  onDeleteSet?: (name: string) => void;
}) {
  const [chosen, setChosen] = useState('');
  const [newSetName, setNewSetName] = useState('');
  if (kind === 'batch') {
    return (
      <Textarea
        value={draft.sql}
        onChange={(e) => onChange({ ...draft, sql: e.target.value })}
        placeholder={placeholder}
        minH="240px" fontFamily="mono" fontSize="sm" bg="bg.canvas" color={color}
        borderColor="border.subtle" _placeholder={{ color: 'fg.muted' }} resize="vertical"
      />
    );
  }
  const setRow = (id: number, patch: Partial<ParamRow>) =>
    onChange({ ...draft, params: draft.params.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const procError = draft.name.trim() && !PROC_RE.test(draft.name.trim()) ? 'Use a name such as dbo.MyProcedure' : null;
  return (
    <Box>
      <Field caption="Procedure name" error={procError}>
        <Input
          size="md" value={draft.name} aria-label="Procedure name" aria-invalid={!!procError}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="dbo.MyProcedure" bg="bg.canvas" borderColor="border.subtle" color="fg.default" mb={4}
        />
      </Field>
      <Flex align="center" justify="space-between" gap={3} mb={2} wrap="wrap">
        <Text fontSize="xs" color="fg.muted">Parameters</Text>
        {onLoadParams && (
          <Button size="sm" variant="outline" colorPalette="brand" onClick={onLoadParams} disabled={!draft.name.trim()}>
            Load parameters from database
          </Button>
        )}
      </Flex>
      {loadNote && <Text fontSize="xs" color="status.warn" mb={2}>{loadNote}</Text>}
      {onSaveSet && onLoadSet && onDeleteSet && (
        <Flex gap={2} wrap="wrap" align="center" mb={3}>
          <select
            aria-label="Saved parameter sets" value={chosen} onChange={(e) => setChosen(e.target.value)}
            className="rounded-md border border-[var(--panel-border)] bg-[var(--panel-strong)] px-3 py-2 text-[var(--text)]" style={{ minHeight: 40 }}
          >
            <option value="">Saved sets</option>
            {(setNames ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={!chosen} onClick={() => onLoadSet(chosen)}>Load set</Button>
          <Button size="sm" variant="ghost" color="status.bad" disabled={!chosen} onClick={() => { onDeleteSet(chosen); setChosen(''); }}>Delete set</Button>
          <Input
            size="md" aria-label="New set name" placeholder="Name this set" value={newSetName}
            onChange={(e) => setNewSetName(e.target.value)} bg="bg.canvas" borderColor="border.subtle" color="fg.default" w={{ base: '100%', md: '200px' }}
          />
          <Button
            size="sm" variant="outline" color="accent.default"
            disabled={!newSetName.trim() || draft.params.length === 0}
            onClick={() => { onSaveSet(newSetName.trim()); setChosen(newSetName.trim()); setNewSetName(''); }}
          >
            Save set
          </Button>
          <Text fontSize="xs" color="fg.muted" w="100%">Saved in this browser only. Passwords and connection details are never saved.</Text>
        </Flex>
      )}
      <Box display="flex" flexDirection="column" gap={3} mb={3}>
        {draft.params.map((row, i) => {
          const nameError = row.name.trim() && !NAME_RE.test(row.name.trim()) ? 'Use a name such as @StartDate' : null;
          const valueError = row.name.trim() && !nameError ? rowError(row) : null;
          return (
            <Flex
              key={row.id} direction={{ base: 'column', md: 'row' }} gap={3}
              align={{ base: 'stretch', md: 'flex-end' }} wrap="wrap" p={3} bg="bg.panel" borderRadius="lg"
              borderWidth="1px" borderColor={valueError || nameError ? 'status.bad' : 'border.subtle'}
            >
              <Field caption="Name" error={nameError}>
                <Input
                  size="md" value={row.name} aria-label={`Parameter ${i + 1} name`} placeholder="@StartDate"
                  aria-invalid={!!nameError}
                  onChange={(e) => setRow(row.id, { name: e.target.value })}
                  bg="bg.canvas" borderColor="border.subtle" color="fg.default"
                />
              </Field>
              <Field caption="Type">
                <select
                  aria-label={`Parameter ${i + 1} type`} value={row.type}
                  onChange={(e) => setRow(row.id, { type: e.target.value as ParamType })}
                  className="w-full rounded-md border border-[var(--panel-border)] bg-[var(--panel-strong)] px-3 py-2 text-[var(--text)]"
                  style={{ minHeight: 40 }}
                >
                  {PARAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field caption="Value" error={valueError} hint={row.type === 'datetime' ? '24-hour time, for example 23:59' : undefined}>
                <Input
                  size="md" type={inputTypeFor(row.type)} value={row.value}
                  aria-label={`Parameter ${i + 1} value`} aria-invalid={!!valueError}
                  placeholder={row.type === 'date' ? 'YYYY-MM-DD' : row.type === 'datetime' ? 'YYYY-MM-DD HH:MM or HH:MM:SS' : row.type === 'bit' ? 'true or false' : 'value'}
                  inputMode={row.type === 'int' || row.type === 'bigint' || row.type === 'decimal' ? 'decimal' : undefined}
                  disabled={row.isNull}
                  onChange={(e) => setRow(row.id, { value: e.target.value })}
                  bg="bg.canvas" borderColor="border.subtle" color="fg.default"
                />
              </Field>
              <Flex gap={4} align="center" minH="40px">
                <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                  <input
                    type="checkbox" checked={row.isNull} aria-label={`Parameter ${i + 1} is NULL`}
                    onChange={(e) => setRow(row.id, { isNull: e.target.checked })}
                    style={{ width: 18, height: 18 }}
                  />
                  NULL
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                  <input
                    type="checkbox" checked={row.output} aria-label={`Parameter ${i + 1} is OUTPUT`}
                    onChange={(e) => setRow(row.id, { output: e.target.checked })}
                    style={{ width: 18, height: 18 }}
                  />
                  OUTPUT
                </label>
              </Flex>
              <Button
                size="md" variant="ghost" color="status.bad" aria-label={`Remove parameter ${i + 1}`}
                onClick={() => onChange({ ...draft, params: draft.params.filter((r) => r.id !== row.id) })}
              >
                Remove
              </Button>
            </Flex>
          );
        })}
      </Box>
      <Button size="md" variant="outline" w={{ base: '100%', md: 'auto' }} onClick={() => onChange({ ...draft, params: [...draft.params, newParamRow()] })}>
        Add parameter
      </Button>
    </Box>
  );
}

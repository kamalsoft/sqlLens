'use client';

import { Box, Button, Flex, Input, Text, Textarea } from '@chakra-ui/react';

export const PARAM_TYPES = [
  'int', 'bigint', 'decimal', 'nvarchar', 'varchar', 'bit', 'datetime', 'date', 'uniqueidentifier',
] as const;
export type ParamType = (typeof PARAM_TYPES)[number];
export type ParamValue = string | number | boolean | null;
export type ExecParam = { name: string; type: ParamType; value: ParamValue };
export type ExecTarget =
  | { kind: 'procedure'; name: string; params: ExecParam[] }
  | { kind: 'batch'; sql: string };

export type ParamRow = { id: number; name: string; type: ParamType; value: string; isNull: boolean };
export type TargetDraft = { name: string; params: ParamRow[]; sql: string };

export const emptyDraft = (): TargetDraft => ({ name: '', params: [], sql: '' });

let nextId = 1;
export const newParamRow = (): ParamRow => ({ id: nextId++, name: '', type: 'nvarchar', value: '', isNull: false });

function coerce(row: ParamRow): { ok: true; value: ParamValue } | { ok: false; error: string } {
  if (row.isNull) return { ok: true, value: null };
  switch (row.type) {
    case 'int':
    case 'bigint':
    case 'decimal': {
      const n = Number(row.value);
      if (row.value.trim() === '' || !Number.isFinite(n)) return { ok: false, error: `Parameter ${row.name || '(unnamed)'} must be a number` };
      return { ok: true, value: n };
    }
    case 'bit': {
      const v = row.value.trim().toLowerCase();
      if (v === '1' || v === 'true') return { ok: true, value: true };
      if (v === '0' || v === 'false') return { ok: true, value: false };
      return { ok: false, error: `Parameter ${row.name || '(unnamed)'} must be true/false or 1/0` };
    }
    default:
      return { ok: true, value: row.value };
  }
}

/** Build the C12 ExecTarget from a draft, or return a user-facing error. */
export function buildTarget(
  kind: 'procedure' | 'batch',
  draft: TargetDraft
): { ok: true; target: ExecTarget } | { ok: false; error: string } {
  if (kind === 'batch') return { ok: true, target: { kind, sql: draft.sql } };
  const params: ExecParam[] = [];
  for (const row of draft.params) {
    const c = coerce(row);
    if (!c.ok) return c;
    params.push({ name: row.name.trim(), type: row.type, value: c.value });
  }
  return { ok: true, target: { kind, name: draft.name.trim(), params } };
}

export function isDraftEmpty(kind: 'procedure' | 'batch', draft: TargetDraft): boolean {
  return kind === 'batch' ? !draft.sql.trim() : !draft.name.trim();
}

export function TargetEditor({
  kind, draft, onChange, placeholder, color,
}: {
  kind: 'procedure' | 'batch';
  draft: TargetDraft;
  onChange: (d: TargetDraft) => void;
  placeholder: string;
  color: string;
}) {
  if (kind === 'batch') {
    return (
      <Textarea
        value={draft.sql}
        onChange={(e) => onChange({ ...draft, sql: e.target.value })}
        placeholder={placeholder}
        minH="240px" fontFamily="mono" fontSize="sm" bg="gray.950" color={color}
        borderColor="gray.600" _placeholder={{ color: 'gray.600' }} resize="vertical"
      />
    );
  }
  const setRow = (id: number, patch: Partial<ParamRow>) =>
    onChange({ ...draft, params: draft.params.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  return (
    <Box>
      <Input
        size="sm" value={draft.name} aria-label="Procedure name"
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        placeholder="dbo.MyProcedure" bg="gray.950" borderColor="gray.600" color="white" mb={3}
      />
      <Text fontSize="xs" color="gray.400" mb={2}>Parameters</Text>
      {draft.params.map((row, i) => (
        <Flex key={row.id} gap={2} mb={2} align="center">
          <Input
            size="xs" value={row.name} aria-label={`Parameter ${i + 1} name`} placeholder="@name"
            onChange={(e) => setRow(row.id, { name: e.target.value })}
            bg="gray.950" borderColor="gray.600" color="white"
          />
          <select
            aria-label={`Parameter ${i + 1} type`} value={row.type}
            onChange={(e) => setRow(row.id, { type: e.target.value as ParamType })}
            className="rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-white"
          >
            {PARAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <Input
            size="xs" value={row.value} aria-label={`Parameter ${i + 1} value`} placeholder="value"
            disabled={row.isNull}
            onChange={(e) => setRow(row.id, { value: e.target.value })}
            bg="gray.950" borderColor="gray.600" color="white"
          />
          <label className="flex items-center gap-1 text-xs text-gray-400">
            <input
              type="checkbox" checked={row.isNull} aria-label={`Parameter ${i + 1} is NULL`}
              onChange={(e) => setRow(row.id, { isNull: e.target.checked })}
            />
            NULL
          </label>
          <Button
            size="xs" variant="ghost" colorPalette="red" aria-label={`Remove parameter ${i + 1}`}
            onClick={() => onChange({ ...draft, params: draft.params.filter((r) => r.id !== row.id) })}
          >
            Remove
          </Button>
        </Flex>
      ))}
      <Button size="xs" variant="outline" onClick={() => onChange({ ...draft, params: [...draft.params, newParamRow()] })}>
        Add parameter
      </Button>
    </Box>
  );
}

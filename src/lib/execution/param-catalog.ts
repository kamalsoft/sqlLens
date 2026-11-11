import type { ParamType } from './types';

/** UX-2: the SQL Server type names that the parameter editor supports, mapped to its types. */
const SQL_TO_PARAM: Record<string, ParamType> = {
  int: 'int', smallint: 'int', tinyint: 'int',
  bigint: 'bigint',
  decimal: 'decimal', numeric: 'decimal', money: 'decimal', smallmoney: 'decimal', float: 'decimal', real: 'decimal',
  bit: 'bit',
  nvarchar: 'nvarchar', nchar: 'nvarchar', ntext: 'nvarchar',
  varchar: 'varchar', char: 'varchar', text: 'varchar',
  datetime: 'datetime', datetime2: 'datetime', smalldatetime: 'datetime',
  date: 'date',
  uniqueidentifier: 'uniqueidentifier',
};

/** The editor type for a SQL Server type name, or null when the editor cannot send it. */
export function paramTypeFor(sqlTypeName: string): ParamType | null {
  return SQL_TO_PARAM[sqlTypeName.trim().toLowerCase()] ?? null;
}

/** A procedure name the catalog query accepts: a name or schema.name, plain identifiers only. */
export const PROCEDURE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

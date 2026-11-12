import { describe, expect, it } from 'vitest';
import { parseConnection } from '@/lib/execution/request';
import { buildMssqlConfig } from '@/lib/execution/mssql';
import { scrubConnection } from '@/lib/sp-executor';

const base = { host: 'sql01.corp.local', database: 'TestDB', username: 'kamal', password: 'Sup3rSecret!' };

describe('Windows (NTLM) login for SQL Server (P9-01, D-038)', () => {
  it('keeps SQL authentication as the default', () => {
    const r = parseConnection(base);
    expect(r.ok && r.value.authType).toBeUndefined();
    const { config } = buildMssqlConfig(r.ok ? r.value : (null as never), 1000);
    expect(config).not.toHaveProperty('domain');
    expect(config.user).toBe('kamal');
  });

  it('requires a domain for Windows authentication', () => {
    const r = parseConnection({ ...base, authType: 'windows' }, 'connection', { engine: 'mssql' });
    expect(r).toMatchObject({ ok: false, field: 'connection.domain' });
  });

  it.each(['CORP\\x', 'corp domain', '-corp', '', 'a'.repeat(256)])('rejects the domain %j', (domain) => {
    expect(parseConnection({ ...base, authType: 'windows', domain }, 'connection', { engine: 'mssql' }).ok).toBe(false);
  });

  it('rejects an unknown authentication type', () => {
    expect(parseConnection({ ...base, authType: 'kerberos' })).toMatchObject({ ok: false, field: 'connection.authType' });
  });

  it('passes the domain to the driver, which then logs in with NTLM', () => {
    const r = parseConnection({ ...base, authType: 'windows', domain: 'CORP' }, 'connection', { engine: 'mssql' });
    expect(r.ok && r.value).toMatchObject({ authType: 'windows', domain: 'CORP', username: 'kamal' });
    const { config } = buildMssqlConfig(r.ok ? r.value : (null as never), 1000);
    expect(config).toMatchObject({ domain: 'CORP', user: 'kamal', password: 'Sup3rSecret!' });
  });

  it('ignores a domain sent with SQL authentication', () => {
    const r = parseConnection({ ...base, domain: 'CORP' });
    expect(r.ok && r.value).not.toHaveProperty('domain');
  });

  it('lets a database list request leave the database empty, but not a run', () => {
    const { database: _drop, ...noDb } = base;
    void _drop;
    expect(parseConnection(noDb).ok).toBe(false);
    const r = parseConnection(noDb, 'connection', { databaseOptional: true });
    expect(r.ok && r.value.database).toBe('');
    expect(buildMssqlConfig(r.ok ? r.value : (null as never), 1000).config.database).toBeUndefined();
  });

  it('scrubs the domain from driver errors, as it does the host and login', () => {
    const msg = scrubConnection("Login failed for user 'CORP\\kamal' on sql01.corp.local", { ...base, domain: 'CORP' });
    expect(msg).not.toMatch(/CORP|kamal|sql01/);
  });

  it('refuses Windows authentication for any engine but SQL Server', () => {
    const windows = { ...base, authType: 'windows', domain: 'CORP' };
    expect(parseConnection(windows, 'connection', { engine: 'postgres' })).toMatchObject({ ok: false, field: 'connection.authType' });
    expect(parseConnection(windows)).toMatchObject({ ok: false, field: 'connection.authType' });
  });

  it('refuses Windows authentication over an unencrypted connection', () => {
    const r = parseConnection({ ...base, authType: 'windows', domain: 'CORP', encrypt: false }, 'connection', { engine: 'mssql' });
    expect(r).toMatchObject({ ok: false, field: 'connection.encrypt' });
  });

  it('warns when a Windows login goes to a server whose certificate is not checked', () => {
    const r = parseConnection({ ...base, authType: 'windows', domain: 'CORP', trustServerCertificate: true }, 'connection', { engine: 'mssql' });
    expect(buildMssqlConfig(r.ok ? r.value : (null as never), 1000).warnings).toContain('Windows login sent to a server whose TLS certificate is not verified');
    const sqlLogin = parseConnection({ ...base, trustServerCertificate: true });
    expect(buildMssqlConfig(sqlLogin.ok ? sqlLogin.value : (null as never), 1000).warnings).not.toContain('Windows login sent to a server whose TLS certificate is not verified');
  });
});

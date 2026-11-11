import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfgPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'sqllens-features-cfg-')), 'appconfig.json');
process.env.SQLLENS_CONFIG_PATH = cfgPath;

import CompareLayout from '@/app/compare/layout';
import RefactorLayout from '@/app/refactor/layout';
import { FeatureOff } from '@/components/FeatureOff';

const page = <p>the page</p>;
const write = (config: object) => writeFileSync(cfgPath, JSON.stringify(config));

beforeEach(() => write({}));

describe('Compare and Refactor are off unless Settings switches them on (UX-A)', () => {
  it('shows the turned-off notice by default, not the page', async () => {
    const compare = (await CompareLayout({ children: page })) as React.ReactElement<{ name: string }>;
    const refactor = (await RefactorLayout({ children: page })) as React.ReactElement<{ name: string }>;
    expect(compare.type).toBe(FeatureOff);
    expect(compare.props.name).toBe('Compare');
    expect(refactor.type).toBe(FeatureOff);
  });

  it('shows each page only when its own switch is on', async () => {
    write({ showCompare: true });
    expect(await CompareLayout({ children: page })).toBe(page);
    expect(((await RefactorLayout({ children: page })) as React.ReactElement).type).toBe(FeatureOff);
    write({ showRefactor: true });
    expect(await RefactorLayout({ children: page })).toBe(page);
  });
});

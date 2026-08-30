// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { AirfoilEditor, CaseEditor } from '@/components/design/Editors';
import { createBaselineDesign, createDefaultProject } from '@/lib/domain/defaults';
import type { DomainResult, WingGeometry } from '@/lib/domain/types';

const successfulUpdate = (patch: Partial<WingGeometry>): DomainResult<unknown> => ({ ok: true, replayed: false, data: patch });

afterEach(cleanup);

describe('case and configured-check editor', () => {
  it('renders all five configured checks, including required static convergence', () => {
    const project = createDefaultProject();
    render(<CaseEditor flightCase={project.flightCase} constraints={project.constraints} editable onUpdate={() => ({ ok: true, replayed: false, data: {} })} />);
    const heading = screen.getByRole('heading', { name: 'Configured trade-study checks' });
    const section = heading.closest('section');
    if (!section) throw new Error('Missing configured-check section.');
    const rows = section.querySelectorAll('.section-facts > div');
    expect(rows).toHaveLength(5);
    expect(within(section).getByText('Static convergence')).toBeVisible();
    expect(within(section).getByText('Required')).toBeVisible();
  });
});

describe('V4/V5 airfoil and polar editor', () => {
  it('offers named Clark, S, SG, and NASA SC(2) profiles and applies their validated coordinates', () => {
    const design = createBaselineDesign();
    const onUpdate = vi.fn(successfulUpdate);
    render(<AirfoilEditor design={design} editable changedFields={[]} changedActor={null} onUpdate={onUpdate} />);

    const profile = screen.getByRole('combobox', { name: 'Airfoil profile at eta 0.000' });
    expect(within(profile).getByRole('option', { name: 'Clark Y' })).toBeInTheDocument();
    expect(within(profile).getByRole('option', { name: 'S1223' })).toBeInTheDocument();
    expect(within(profile).getByRole('option', { name: 'SG6043' })).toBeInTheDocument();
    expect(within(profile).getByRole('option', { name: 'NASA SC(2)-0412' })).toBeInTheDocument();
    fireEvent.change(profile, { target: { value: 'sg6043' } });

    const patch = onUpdate.mock.calls[0][0];
    if (!patch.airfoilStations) throw new Error('Expected an airfoil-station patch.');
    const applied = patch.airfoilStations[0].airfoil;
    expect(applied).toMatchObject({ kind: 'COORDINATES', name: 'SG6043', source: expect.stringContaining('UIUC Airfoil Data Site') });
    if (applied.kind !== 'COORDINATES') throw new Error('Expected catalogue coordinates.');
    expect(applied.points).toHaveLength(81);
  });

  it('does not submit an unchanged NACA field on blur', () => {
    const design = createBaselineDesign();
    const onUpdate = vi.fn(successfulUpdate);
    render(<AirfoilEditor design={design} editable changedFields={[]} changedActor={null} onUpdate={onUpdate} />);

    const rootCode = screen.getByRole('textbox', { name: 'NACA code at eta 0.000' });
    fireEvent.focus(rootCode);
    fireEvent.blur(rootCode);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('adds a bounded intermediate airfoil station without changing the endpoints', () => {
    const design = createBaselineDesign();
    const onUpdate = vi.fn(successfulUpdate);
    render(<AirfoilEditor design={design} editable changedFields={[]} changedActor={null} onUpdate={onUpdate} />);

    expect(screen.getAllByRole('img', { name: /airfoil section/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '＋ Add intermediate section' }));
    const patch = onUpdate.mock.calls[0][0];
    if (!patch.airfoilStations) throw new Error('Expected an airfoil-station patch.');
    expect(patch.airfoilStations).toHaveLength(3);
    expect(patch.airfoilStations.map((station) => station.eta)).toEqual([0, 0.5, 1]);
    expect(patch.airfoilStations.map((station) => station.id)).toEqual(['afs_root', 'afs_mid1', 'afs_tip']);
  });

  it('edits a station section and clears incompatible user polars in the same patch', () => {
    const design = createBaselineDesign();
    design.geometry.polarModel = { kind: 'USER_TABLES', tables: [] };
    const onUpdate = vi.fn(successfulUpdate);
    render(<AirfoilEditor design={design} editable changedFields={[]} changedActor={null} onUpdate={onUpdate} />);

    const rootCode = screen.getByRole('textbox', { name: 'NACA code at eta 0.000' });
    fireEvent.change(rootCode, { target: { value: '4415' } });
    fireEvent.blur(rootCode);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const patch = onUpdate.mock.calls[0][0];
    if (!patch.airfoilStations) throw new Error('Expected an airfoil-station patch.');
    expect(patch.airfoilStations[0].airfoil).toEqual({ kind: 'NACA4', code: '4415' });
    expect(patch.polarModel).toEqual({ kind: 'ANALYTIC_ATTACHED', tables: [] });
    expect(screen.getByText(/Polar consistency guard/)).toBeVisible();
  });

  it('fails visibly on malformed polar JSON and supports an explicit read-only editor state', () => {
    const design = createBaselineDesign();
    const onUpdate = vi.fn(successfulUpdate);
    const { rerender } = render(<AirfoilEditor design={design} editable changedFields={[]} changedActor={null} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Section polar JSON' }), { target: { value: '{bad json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate & use tables' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/JSON/);
    expect(onUpdate).not.toHaveBeenCalled();

    rerender(<AirfoilEditor design={design} editable={false} changedFields={[]} changedActor={null} onUpdate={onUpdate} />);
    expect(screen.getByRole('button', { name: '＋ Add intermediate section' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'NACA code at eta 0.000' })).toBeDisabled();
    expect(screen.getByText(/This design is read-only/)).toBeVisible();
  });
});

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

  it('keeps sweep guidance behind an accessible info button', () => {
    const project = createDefaultProject();
    render(<CaseEditor flightCase={project.flightCase} constraints={project.constraints} editable onUpdate={() => ({ ok: true, replayed: false, data: {} })} />);
    const info = screen.getByRole('button', { name: 'Show angle-of-attack sweep information' });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    fireEvent.click(info);
    expect(info).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('note')).toHaveTextContent(/Choose the shared range before running/);
    fireEvent.click(info);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('V4/V5 airfoil and polar editor', () => {
  it('shows the generated NACA profile option', () => {
    const design = createBaselineDesign();
    const onUpdate = vi.fn(successfulUpdate);
    render(<AirfoilEditor design={design} editable changedFields={[]} changedActor={null} onUpdate={onUpdate} />);

    const profile = screen.getByRole('combobox', { name: 'Airfoil profile at eta 0.000' });
    expect(within(profile).getByRole('option', { name: 'NACA four-digit · custom code' })).toBeInTheDocument();
    expect(Array.from(profile.querySelectorAll('option'), (option) => option.textContent)).toEqual(['NACA four-digit · custom code']);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps the custom coordinate contour import available', () => {
    const design = createBaselineDesign();
    design.geometry.airfoilStations[0].airfoil = {
      kind: 'COORDINATES',
      name: 'Imported contour',
      points: [[0, 0], [0.05, 0.01], [0.1, 0.018], [0.15, 0.024], [0.2, 0.029], [0.25, 0.033], [0.3, 0.036], [0.35, 0.038], [0.4, 0.039], [0.45, 0.04], [0.5, 0.04], [0.55, 0.039], [0.6, 0.037], [0.65, 0.034], [0.7, 0.03], [0.75, 0.025], [0.8, 0.02], [0.85, 0.015], [0.9, 0.01], [0.95, 0.005], [1, 0], [0.95, -0.005], [0.9, -0.01], [0.85, -0.015], [0.8, -0.02], [0.75, -0.025], [0.7, -0.03], [0.65, -0.034], [0.6, -0.037], [0.55, -0.039], [0.5, -0.04], [0.45, -0.04], [0.4, -0.039], [0.35, -0.038], [0.3, -0.036], [0.25, -0.033], [0.2, -0.029], [0.15, -0.024], [0.1, -0.018], [0.05, -0.01], [0, 0]],
    };
    const onUpdate = vi.fn(successfulUpdate);
    render(<AirfoilEditor design={design} editable changedFields={[]} changedActor={null} onUpdate={onUpdate} />);

    const profile = screen.getByRole('combobox', { name: 'Airfoil profile at eta 0.000' });
    expect(within(profile).getByRole('option', { name: 'Custom imported contour' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Imported contour airfoil section' })).toBeVisible();
    expect(screen.getAllByText('Import coordinate contour')).toHaveLength(1);
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

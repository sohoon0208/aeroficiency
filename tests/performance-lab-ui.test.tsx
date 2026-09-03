// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerformanceLab } from '@/components/flow/PerformanceLab';
import { createDefaultProject } from '@/lib/domain/defaults';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';

afterEach(cleanup);

function fixture() {
  const project = createDefaultProject();
  const design = project.designs[project.activeDesignId];
  return { project, design, analysis: buildAnalysisSnapshot(project, design, 'standard') };
}

describe('V5 Reynolds and drag evidence lab', () => {
  it('renders decomposed drag, exact local polar evidence, provenance, and linked plots', () => {
    const { project, design, analysis } = fixture();
    const onSelectEta = vi.fn();
    render(<PerformanceLab design={design} analysis={analysis} flightCase={project.flightCase} selectedEta={0.333} onSelectEta={onSelectEta} />);

    expect(screen.getByRole('heading', { name: /Profile \+ induced drag evidence at α/ })).toBeVisible();
    expect(screen.getByText('Induced')).toBeVisible();
    expect(screen.getByText('Profile')).toBeVisible();
    expect(screen.getByText('Combined wing')).toBeVisible();
    expect(screen.getByText('Estimated wing L/D')).toBeVisible();
    expect(screen.getAllByRole('img')).toHaveLength(7);
    expect(screen.getByRole('img', { name: /Wing lift curve/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /Wing drag curve/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /Wing efficiency/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /Tip deflection response/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /Spanwise Reynolds number/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /Profile drag distribution/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /Profile drag distribution/ })).toHaveTextContent('0.0');
    expect(screen.getByRole('img', { name: /Local section polar/ })).toBeVisible();
    expect(screen.getByText(/attached-flow surrogate, not XFOIL or experiment/)).toBeVisible();
    expect(screen.getByText('All stations in declared range')).toBeVisible();
    expect(screen.getByText(/Aeroficiency attached-flow analytic estimate/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider', { name: /Linked span station/ }), { target: { value: '0.7' } });
    expect(onSelectEta).toHaveBeenCalledWith(0.7);
  });

  it('fails closed when no current converged analysis is supplied', () => {
    const { project, design } = fixture();
    render(<PerformanceLab design={design} analysis={null} flightCase={project.flightCase} selectedEta={0.5} onSelectEta={() => undefined} />);
    expect(screen.getByText('A current converged wing analysis is required.')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows the nearest sampled values while hovering and supports keyboard inspection', () => {
    const { project, design, analysis } = fixture();
    render(<PerformanceLab design={design} analysis={analysis} flightCase={project.flightCase} selectedEta={0.333} onSelectEta={() => undefined} />);

    const plots = screen.getAllByRole('img').map((element) => element as unknown as SVGSVGElement);
    const firstPlot = plots[0];
    vi.spyOn(firstPlot, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 520, height: 190, right: 520, bottom: 190, toJSON: () => ({}) } as DOMRect);
    const hitArea = firstPlot.querySelector<SVGRectElement>('.plot-hit-area')!;
    const firstPoint = analysis.angleSweep.points.find((point) => point.status === 'converged')!;

    fireEvent.pointerMove(hitArea, { clientX: 42, clientY: 90 });
    expect(screen.getByTestId('plot-tooltip')).toHaveTextContent(`α (deg) ${firstPoint.alphaDeg.toFixed(2)}`);
    expect(screen.getByTestId('plot-tooltip')).toHaveTextContent('CL');
    expect(firstPlot.querySelector('.plot-hover-guide.vertical')).toBeInTheDocument();
    expect(firstPlot.querySelector('.plot-hover-point')).toBeInTheDocument();

    fireEvent.pointerLeave(hitArea);
    expect(screen.queryByTestId('plot-tooltip')).not.toBeInTheDocument();

    fireEvent.focus(firstPlot);
    expect(screen.getByTestId('plot-tooltip')).toBeInTheDocument();
    fireEvent.keyDown(firstPlot, { key: 'End' });
    expect(screen.getByTestId('plot-tooltip')).toHaveTextContent(`α (deg) ${analysis.angleSweep.points.at(-1)!.alphaDeg.toFixed(2)}`);
    fireEvent.blur(firstPlot);
    expect(screen.queryByTestId('plot-tooltip')).not.toBeInTheDocument();
  });
});

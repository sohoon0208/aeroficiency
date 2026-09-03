import { RELEASE_IDENTITY } from '@/lib/release';
import { sha256 } from '@/lib/domain/ids';
import type {
  AnalysisSnapshot,
  AngleSweepPoint,
  ConstraintResult,
  ProjectState,
  SpanStationResult,
  WingDesign,
} from '@/lib/domain/types';
import {
  AIRFOIL_COORDINATE_HEADERS,
  AIRFOIL_STATION_HEADERS,
  ANALYSIS_SUMMARY_HEADERS,
  ANGLE_SWEEP_HEADERS,
  ANGLE_SWEEP_SPANWISE_HEADERS,
  COMPARISON_HEADERS,
  CONSTRAINT_HEADERS,
  CONVERGENCE_HEADERS,
  DATA_DICTIONARY_HEADERS,
  DESIGN_INPUT_HEADERS,
  DIAGNOSTIC_SUMMARY_HEADERS,
  EXPORT_OMISSIONS,
  EXPORT_STATUS_HEADERS,
  POLAR_DIAGNOSTIC_HEADERS,
  POLAR_TABLE_HEADERS,
  ROOT_EXPORT_FILES,
  SPANWISE_HEADERS,
  SUMMARY_HEADERS,
  WARNING_HEADERS,
  RESULTS_EXPORT_SCHEMA_VERSION,
} from './constants';
import { classifyDesigns, compatibleAnalyses, summarizeExportCounts } from './classifyResults';
import { jsonText, textByteLength, toCsv, type CsvValue } from './csv';
import type { ClassifiedDesign, ResultsExportBundle, ResultsExportFile, ResultsManifest, ResultsManifestFile } from './types';

type Row = Record<string, CsvValue>;

function csvFile<T extends string>(path: string, headers: readonly T[], rows: readonly Row[]): ResultsExportFile {
  const content = toCsv(headers, rows);
  return { path, content, contentType: 'text/csv', sizeBytes: textByteLength(content) };
}

function textFile(path: string, content: string, contentType: ResultsExportFile['contentType'] = 'text/plain'): ResultsExportFile {
  return { path, content, contentType, sizeBytes: textByteLength(content) };
}

function normalizeTimestamp(value?: string) {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function filenameTimestamp(timestamp: string) {
  return timestamp.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

function designRoot(item: ClassifiedDesign) {
  return `${item.design.kind === 'baseline' ? 'baseline' : 'candidates'}/${item.folder}`;
}

function rowForDesignInputs(state: ProjectState, item: ClassifiedDesign): Row {
  const { design } = item;
  const { geometry, structure } = design;
  const { flightCase, constraints } = state;
  return {
    candidate_code: item.code,
    design_id: design.designId,
    design_label: design.label,
    design_role: design.kind,
    design_revision: design.revision,
    source_design_id: design.sourceDesignId,
    source_design_revision: design.sourceDesignRevision,
    span_m: geometry.spanM,
    root_chord_m: geometry.rootChordM,
    tip_chord_m: geometry.tipChordM,
    root_twist_deg: geometry.rootTwistDeg,
    tip_twist_deg: geometry.tipTwistDeg,
    skin_thickness_mm: structure.skinThicknessMm,
    front_web_thickness_mm: structure.frontWebThicknessMm,
    rear_web_thickness_mm: structure.rearWebThicknessMm,
    front_spar_x_over_c: structure.frontSparXOverC,
    rear_spar_x_over_c: structure.rearSparXOverC,
    elastic_axis_x_over_c: structure.elasticAxisXOverC,
    material: structure.material,
    flight_case_revision: flightCase.revision,
    target_lift_n: flightCase.targetLiftN,
    velocity_mps: flightCase.velocityMps,
    altitude_m: flightCase.altitudeM,
    air_density_kg_m3: flightCase.airDensityKgM3,
    dynamic_viscosity_pa_s: flightCase.dynamicViscosityPaS,
    sweep_min_alpha_deg: flightCase.sweepMinAlphaDeg,
    sweep_max_alpha_deg: flightCase.sweepMaxAlphaDeg,
    sweep_step_alpha_deg: flightCase.sweepStepAlphaDeg,
    constraints_revision: constraints.revision,
    min_mass_reduction_pct: constraints.minMassReductionPct,
    min_yield_margin: constraints.minYieldMargin,
    max_tip_deflection_m: constraints.maxTipDeflectionM,
    max_induced_drag_increase_pct: constraints.maxInducedDragIncreasePct,
    design_created_at_utc: design.createdAt,
    design_updated_at_utc: design.updatedAt,
    latest_analysis_id: design.latestAnalysisId,
    export_classification: item.classification,
  };
}

function rowForAirfoilStation(station: WingDesign['geometry']['airfoilStations'][number], index: number): Row {
  return {
    station_index: index,
    station_id: station.id,
    eta: station.eta,
    airfoil_kind: station.airfoil.kind,
    naca_code: station.airfoil.kind === 'NACA4' ? station.airfoil.code : null,
    custom_airfoil_name: station.airfoil.kind === 'COORDINATES' ? station.airfoil.name : null,
    blend_to_next: station.blendToNext,
    coordinate_count: station.airfoil.kind === 'COORDINATES' ? station.airfoil.points.length : 0,
    source: station.airfoil.kind === 'COORDINATES' ? station.airfoil.source : null,
  };
}

function rowForPolarTable(table: WingDesign['geometry']['polarModel']['tables'][number], row: WingDesign['geometry']['polarModel']['tables'][number]['rows'][number]): Row {
  return {
    polar_id: table.polarId,
    station_id: table.airfoilStationId,
    reynolds: table.reynolds,
    mach: table.mach,
    transition_model: table.transitionModel,
    source: table.provenance.source,
    provenance_label: table.provenance.label,
    provenance_licence: table.provenance.licence,
    alpha_deg: row.alphaDeg,
    cl: row.cl,
    cd: row.cd,
    cm: row.cm,
  };
}

function rowForAnalysisSummary(analysis: AnalysisSnapshot): Row {
  const { metrics } = analysis;
  return {
    analysis_id: analysis.analysisId,
    analysis_status: analysis.status,
    analysis_freshness: 'current',
    analysis_created_at_utc: analysis.createdAt,
    design_revision: analysis.designRevision,
    flight_case_revision: analysis.flightCaseRevision,
    constraints_revision: analysis.constraintsRevision,
    fidelity: analysis.fidelity,
    solver_version: analysis.solverVersion,
    input_fingerprint: analysis.inputFingerprint,
    wing_area_m2: metrics.wingAreaM2,
    aspect_ratio: metrics.aspectRatio,
    modeled_wall_mass_kg: metrics.structuralMassKg,
    lift_n: metrics.liftN,
    lift_coefficient: metrics.liftCoefficient,
    trim_alpha_deg: metrics.trimmedAlphaDeg,
    wake_induced_drag_n: metrics.inducedDragN,
    wake_induced_drag_coefficient: metrics.inducedDragCoefficientEstimate,
    profile_drag_n: metrics.profileDragEstimateN,
    profile_drag_coefficient: metrics.profileDragCoefficientEstimate,
    combined_wing_drag_n: metrics.combinedWingDragEstimateN,
    combined_drag_coefficient: metrics.combinedDragCoefficientEstimate,
    estimated_wing_l_to_d: metrics.estimatedWingLiftToDrag,
    span_efficiency_estimate: metrics.spanEfficiencyEstimate,
    tip_deflection_m: metrics.tipDeflectionM,
    tip_elastic_twist_deg: metrics.tipElasticTwistDeg,
    modeled_min_yield_ratio: metrics.minYieldMargin,
    max_bending_stress_pa: metrics.maxBendingStressPa,
    max_torsional_shear_pa: metrics.maxTorsionalShearPa,
  };
}

function rowForDiagnosticSummary(analysis: AnalysisSnapshot, reason: string): Row {
  const convergedSweepPoints = analysis.angleSweep.points.filter((point) => point.status === 'converged').length;
  return {
    analysis_id: analysis.analysisId,
    analysis_status: analysis.status,
    analysis_created_at_utc: analysis.createdAt,
    design_revision: analysis.designRevision,
    flight_case_revision: analysis.flightCaseRevision,
    constraints_revision: analysis.constraintsRevision,
    fidelity: analysis.fidelity,
    solver_version: analysis.solverVersion,
    input_fingerprint: analysis.inputFingerprint,
    iterations: analysis.convergence.iterations,
    equilibrium_residual: analysis.convergence.equilibriumResidual,
    twist_change_deg: analysis.convergence.twistChangeDeg,
    relative_load_change: analysis.convergence.relativeLoadChange,
    target_lift_error_pct: analysis.convergence.targetLiftErrorPct,
    sweep_point_count: analysis.angleSweep.points.length,
    converged_sweep_points: convergedSweepPoints,
    warning_count: analysis.warnings.length,
    polar_model: analysis.polarDiagnostics.model,
    reason,
  };
}

function rowForConstraint(constraint: ConstraintResult): Row {
  return {
    check_key: constraint.key,
    check_label: constraint.label,
    state: constraint.state,
    actual: constraint.actual,
    limit: constraint.limit,
    unit: constraint.unit,
    detail: constraint.detail,
  };
}

function rowForConvergence(phase: string, analysisId: string, alphaDeg: number, status: string, convergence: AnalysisSnapshot['convergence']): Row {
  return {
    phase,
    analysis_id: analysisId,
    alpha_deg: alphaDeg,
    status,
    iterations: convergence.iterations,
    equilibrium_residual: convergence.equilibriumResidual,
    twist_change_deg: convergence.twistChangeDeg,
    relative_load_change: convergence.relativeLoadChange,
    target_lift_error_pct: convergence.targetLiftErrorPct,
  };
}

function rowForStation(station: SpanStationResult): Row {
  return {
    eta: station.eta,
    y_m: station.yM,
    chord_m: station.chordM,
    geometric_twist_deg: station.geometricTwistDeg,
    airfoil_label: station.airfoilLabel,
    zero_lift_angle_deg: station.zeroLiftAngleDeg,
    pitching_moment_coefficient: station.pitchingMomentCoefficient,
    reynolds_number: station.reynoldsNumber,
    polar_state: station.polarState,
    lift_per_span_n_per_m: station.liftPerSpanNpm,
    circulation_m2_per_s: station.circulationM2s,
    downwash_m_per_s: station.downwashMps,
    induced_angle_deg: station.inducedAngleDeg,
    induced_drag_per_span_n_per_m: station.inducedDragPerSpanNpm,
    sectional_lift_coefficient: station.sectionalLiftCoefficient,
    profile_drag_coefficient: station.profileDragCoefficient,
    profile_drag_per_span_n_per_m: station.profileDragPerSpanNpm,
    shear_n: station.shearN,
    bending_moment_nm: station.bendingMomentNm,
    torque_nm: station.torqueNm,
    deflection_m: station.deflectionM,
    elastic_twist_deg: station.elasticTwistDeg,
    bending_stiffness_nm2: station.bendingStiffnessNm2,
    torsional_stiffness_nm2: station.torsionalStiffnessNm2,
    von_mises_stress_pa: station.vonMisesStressPa,
    modeled_yield_ratio: station.yieldMargin,
  };
}

function rowForAngleSweepPoint(point: AngleSweepPoint): Row {
  const { convergence, metrics } = point;
  return {
    alpha_deg: point.alphaDeg,
    status: point.status,
    iterations: convergence.iterations,
    equilibrium_residual: convergence.equilibriumResidual,
    twist_change_deg: convergence.twistChangeDeg,
    relative_load_change: convergence.relativeLoadChange,
    target_lift_error_pct: convergence.targetLiftErrorPct,
    lift_n: metrics.liftN,
    lift_coefficient: metrics.liftCoefficient,
    wake_induced_drag_n: metrics.inducedDragN,
    profile_drag_n: metrics.profileDragEstimateN,
    combined_wing_drag_n: metrics.combinedWingDragEstimateN,
    estimated_wing_l_to_d: metrics.estimatedWingLiftToDrag,
    tip_deflection_m: metrics.tipDeflectionM,
    tip_elastic_twist_deg: metrics.tipElasticTwistDeg,
    modeled_min_yield_ratio: metrics.minYieldMargin,
  };
}

function rowForSweepStation(alphaDeg: number, station: SpanStationResult): Row {
  return {
    alpha_deg: alphaDeg,
    eta: station.eta,
    y_m: station.yM,
    chord_m: station.chordM,
    geometric_twist_deg: station.geometricTwistDeg,
    airfoil_label: station.airfoilLabel,
    lift_per_span_n_per_m: station.liftPerSpanNpm,
    circulation_m2_per_s: station.circulationM2s,
    downwash_m_per_s: station.downwashMps,
    induced_angle_deg: station.inducedAngleDeg,
    reynolds_number: station.reynoldsNumber,
    sectional_lift_coefficient: station.sectionalLiftCoefficient,
    profile_drag_coefficient: station.profileDragCoefficient,
    profile_drag_per_span_n_per_m: station.profileDragPerSpanNpm,
    deflection_m: station.deflectionM,
    elastic_twist_deg: station.elasticTwistDeg,
    von_mises_stress_pa: station.vonMisesStressPa,
    modeled_yield_ratio: station.yieldMargin,
  };
}

function rowForPolarDiagnostics(scope: string, alphaDeg: number, analysisId: string, diagnostics: AnalysisSnapshot['polarDiagnostics']): Row {
  return {
    scope,
    alpha_deg: alphaDeg,
    analysis_id: analysisId,
    model: diagnostics.model,
    profile_drag_available: diagnostics.profileDragAvailable,
    within_range_stations: diagnostics.withinRangeStations,
    analytic_estimate_stations: diagnostics.analyticEstimateStations,
    extrapolated_alpha_stations: diagnostics.extrapolatedAlphaStations,
    outside_reynolds_stations: diagnostics.outsideReynoldsStations,
    outside_alpha_stations: diagnostics.outsideAlphaStations,
    reynolds_min: diagnostics.reynoldsRange[0],
    reynolds_max: diagnostics.reynoldsRange[1],
    effective_alpha_min_deg: diagnostics.effectiveAlphaRangeDeg[0],
    effective_alpha_max_deg: diagnostics.effectiveAlphaRangeDeg[1],
    provenance: diagnostics.provenance.join(' | '),
  };
}

function percentDelta(value: number, reference: number) {
  return reference === 0 ? null : 100 * (value - reference) / reference;
}

function analysisForComparison(item: ClassifiedDesign, baseline: ClassifiedDesign | null) {
  if (!baseline?.analysis || !item.analysis || item.classification !== 'current_converged' || baseline.classification !== 'current_converged') return null;
  return compatibleAnalyses(baseline.analysis, item.analysis) ? { baseline: baseline.analysis, candidate: item.analysis } : null;
}

function summaryRow(item: ClassifiedDesign, baseline: ClassifiedDesign | null): Row {
  const analysis = item.analysis;
  const latest = item.latestAnalysis;
  const comparison = analysisForComparison(item, baseline);
  const current = item.classification === 'current_converged' && analysis;
  const checks = current ? analysis.constraints : [];
  const metrics = current ? analysis.metrics : null;
  const referenceMetrics = comparison?.baseline.metrics ?? null;
  return {
    candidate_code: item.code,
    design_id: item.design.designId,
    design_label: item.design.label,
    design_role: item.design.kind,
    design_revision: item.design.revision,
    export_classification: item.classification,
    analysis_id: analysis?.analysisId ?? latest?.analysisId,
    analysis_status: analysis?.status ?? latest?.status,
    analysis_freshness: item.analysisFreshness,
    check_pass_count: current ? checks.filter((check) => check.state === 'pass').length : null,
    check_total: current ? checks.length : null,
    all_checks_pass: current ? checks.length > 0 && checks.every((check) => check.state === 'pass') : null,
    modeled_wall_mass_kg: metrics?.structuralMassKg,
    mass_delta_vs_baseline_pct: metrics && referenceMetrics ? percentDelta(metrics.structuralMassKg, referenceMetrics.structuralMassKg) : null,
    induced_drag_n: metrics?.inducedDragN,
    induced_drag_delta_vs_baseline_pct: metrics && referenceMetrics ? percentDelta(metrics.inducedDragN, referenceMetrics.inducedDragN) : null,
    combined_wing_drag_n: metrics?.combinedWingDragEstimateN,
    estimated_wing_l_to_d: metrics?.estimatedWingLiftToDrag,
    min_yield_margin: metrics?.minYieldMargin,
    tip_deflection_m: metrics?.tipDeflectionM,
    trimmed_alpha_deg: metrics?.trimmedAlphaDeg,
    best_lift_to_drag_alpha_deg: current ? analysis.angleSweep.bestLiftToDragAlphaDeg : null,
    sweep_points_solved: current ? analysis.angleSweep.points.filter((point) => point.status === 'converged').length : null,
    export_reason: item.reason,
  };
}

function comparisonRow(item: ClassifiedDesign, baseline: ClassifiedDesign | null): Row {
  const pair = analysisForComparison(item, baseline);
  const candidate = item.analysis;
  const baselineAnalysis = baseline?.analysis;
  const excluded = !pair;
  const exclusionReason = !baseline
    ? 'No Baseline design is retained.'
    : baseline.classification !== 'current_converged'
      ? `Baseline is ${baseline.classification}; a current converged Baseline is required.`
      : item.classification !== 'current_converged'
        ? `Candidate is ${item.classification}; a current converged candidate is required.`
        : 'Baseline and candidate analyses use incompatible shared settings.';
  const candidateChecks = pair?.candidate.constraints ?? [];
  return {
    candidate_code: item.code,
    candidate_design_id: item.design.designId,
    candidate_label: item.design.label,
    comparison_status: excluded ? 'excluded' : 'included',
    exclusion_reason: excluded ? exclusionReason : null,
    baseline_analysis_id: baselineAnalysis?.analysisId,
    candidate_analysis_id: candidate?.analysisId,
    compatible: pair ? true : baselineAnalysis && candidate ? compatibleAnalyses(baselineAnalysis, candidate) : false,
    candidate_checks_passed: pair ? candidateChecks.filter((check) => check.state === 'pass').length : null,
    candidate_checks_total: pair ? candidateChecks.length : null,
    wall_mass_delta_pct: pair ? percentDelta(pair.candidate.metrics.structuralMassKg, pair.baseline.metrics.structuralMassKg) : null,
    induced_drag_delta_pct: pair ? percentDelta(pair.candidate.metrics.inducedDragN, pair.baseline.metrics.inducedDragN) : null,
    tip_deflection_delta_pct: pair ? percentDelta(pair.candidate.metrics.tipDeflectionM, pair.baseline.metrics.tipDeflectionM) : null,
    yield_margin_delta: pair ? pair.candidate.metrics.minYieldMargin - pair.baseline.metrics.minYieldMargin : null,
    baseline_structural_mass_kg: pair?.baseline.metrics.structuralMassKg,
    candidate_structural_mass_kg: pair?.candidate.metrics.structuralMassKg,
    baseline_induced_drag_n: pair?.baseline.metrics.inducedDragN,
    candidate_induced_drag_n: pair?.candidate.metrics.inducedDragN,
  };
}

function designFiles(state: ProjectState, item: ClassifiedDesign): ResultsExportFile[] {
  const { design } = item;
  const root = designRoot(item);
  const files: ResultsExportFile[] = [
    csvFile(`${root}/export_status.csv`, EXPORT_STATUS_HEADERS, [{
      export_classification: item.classification,
      reason: item.reason,
      design_id: design.designId,
      design_revision: design.revision,
      latest_analysis_id: design.latestAnalysisId,
      analysis_id: item.analysis?.analysisId,
      analysis_status: item.analysis?.status ?? item.latestAnalysis?.status,
      analysis_freshness: item.analysisFreshness,
      analysis_created_at_utc: item.analysis?.createdAt ?? item.latestAnalysis?.createdAt,
      solver_version: item.analysis?.solverVersion ?? item.latestAnalysis?.solverVersion ?? state.solverVersion,
      fidelity: item.analysis?.fidelity ?? item.latestAnalysis?.fidelity,
      input_fingerprint: item.analysis?.inputFingerprint ?? item.latestAnalysis?.inputFingerprint,
      flight_case_revision: item.analysis?.flightCaseRevision ?? state.flightCase.revision,
      constraints_revision: item.analysis?.constraintsRevision ?? state.constraints.revision,
    }]),
    csvFile(`${root}/design_inputs.csv`, DESIGN_INPUT_HEADERS, [rowForDesignInputs(state, item)]),
    csvFile(`${root}/airfoil_stations.csv`, AIRFOIL_STATION_HEADERS, design.geometry.airfoilStations.slice().sort((left, right) => left.eta - right.eta).map(rowForAirfoilStation)),
    csvFile(`${root}/polar_tables.csv`, POLAR_TABLE_HEADERS, design.geometry.polarModel.tables.slice().sort((left, right) => left.polarId.localeCompare(right.polarId)).flatMap((table) => table.rows.slice().sort((left, right) => left.alphaDeg - right.alphaDeg).map((row) => rowForPolarTable(table, row)))),
  ];

  const coordinates = design.geometry.airfoilStations
    .slice().sort((left, right) => left.eta - right.eta)
    .flatMap((station, stationIndex) => station.airfoil.kind === 'COORDINATES'
      ? station.airfoil.points.map(([xOverC, zOverC], pointIndex): Row => ({ station_index: stationIndex, station_id: station.id, point_index: pointIndex, x_over_c: xOverC, z_over_c: zOverC }))
      : []);
  if (coordinates.length) files.push(csvFile(`${root}/airfoil_coordinates.csv`, AIRFOIL_COORDINATE_HEADERS, coordinates));

  if (item.classification === 'current_converged' && item.analysis) {
    const analysis = item.analysis;
    files.push(
      csvFile(`${root}/analysis_summary.csv`, ANALYSIS_SUMMARY_HEADERS, [rowForAnalysisSummary(analysis)]),
      csvFile(`${root}/configured_checks.csv`, CONSTRAINT_HEADERS, analysis.constraints.map(rowForConstraint)),
      csvFile(`${root}/convergence.csv`, CONVERGENCE_HEADERS, [
        rowForConvergence('target_lift_trim', analysis.analysisId, analysis.metrics.trimmedAlphaDeg, analysis.status, analysis.convergence),
        ...analysis.angleSweep.points.map((point) => rowForConvergence('fixed_angle_sweep', analysis.analysisId, point.alphaDeg, point.status, point.convergence)),
      ]),
      csvFile(`${root}/trim_spanwise_results.csv`, SPANWISE_HEADERS, analysis.stations.slice().sort((left, right) => left.eta - right.eta).map(rowForStation)),
      csvFile(`${root}/angle_sweep_results.csv`, ANGLE_SWEEP_HEADERS, analysis.angleSweep.points.slice().sort((left, right) => left.alphaDeg - right.alphaDeg).map(rowForAngleSweepPoint)),
      csvFile(`${root}/angle_sweep_spanwise_results.csv`, ANGLE_SWEEP_SPANWISE_HEADERS, analysis.angleSweep.points.slice().sort((left, right) => left.alphaDeg - right.alphaDeg).flatMap((point) => point.stations.slice().sort((left, right) => left.eta - right.eta).map((station) => rowForSweepStation(point.alphaDeg, station)))),
      csvFile(`${root}/polar_diagnostics.csv`, POLAR_DIAGNOSTIC_HEADERS, [
        rowForPolarDiagnostics('target_lift_trim', analysis.metrics.trimmedAlphaDeg, analysis.analysisId, analysis.polarDiagnostics),
        ...analysis.angleSweep.points.slice().sort((left, right) => left.alphaDeg - right.alphaDeg).map((point) => rowForPolarDiagnostics('fixed_angle_sweep', point.alphaDeg, analysis.analysisId, point.polarDiagnostics)),
      ]),
      csvFile(`${root}/warnings.csv`, WARNING_HEADERS, analysis.warnings.map((warning, index) => ({ warning_index: index + 1, warning }))),
    );
  } else if (item.classification === 'diagnostic_not_converged' && item.analysis) {
    files.push(csvFile(`${root}/diagnostic_summary.csv`, DIAGNOSTIC_SUMMARY_HEADERS, [rowForDiagnosticSummary(item.analysis, item.reason)]));
    files.push(csvFile(`${root}/warnings.csv`, WARNING_HEADERS, item.analysis.warnings.map((warning, index) => ({ warning_index: index + 1, warning }))));
  }
  return files;
}

const FIELD_DESCRIPTIONS: Record<string, string> = {
  candidate_code: 'Stable export code assigned to a retained design.',
  design_id: 'Immutable design identifier.',
  design_label: 'User-facing design label.',
  export_classification: 'Conservative export eligibility classification.',
  analysis_freshness: 'Whether numerical analysis is current, diagnostic-only, stale, or unavailable.',
  input_fingerprint: 'Fingerprint of the design and shared solver inputs.',
  alpha_deg: 'Angle of attack for a sweep point.',
  eta: 'Right-semispan normalized station coordinate.',
  polar_state: 'Section-polar range/provenance state.',
  comparison_status: 'Whether a compatible current baseline/candidate pair was included.',
};

const FIELD_UNITS: Record<string, string> = {
  span_m: 'm', root_chord_m: 'm', tip_chord_m: 'm', altitude_m: 'm', max_tip_deflection_m: 'm',
  chord_m: 'm', y_m: 'm', deflection_m: 'm', tip_deflection_m: 'm',
  skin_thickness_mm: 'mm', front_web_thickness_mm: 'mm', rear_web_thickness_mm: 'mm',
  target_lift_n: 'N', lift_n: 'N', wake_induced_drag_n: 'N', profile_drag_n: 'N', combined_wing_drag_n: 'N',
  induced_drag_per_span_n_per_m: 'N/m', lift_per_span_n_per_m: 'N/m', profile_drag_per_span_n_per_m: 'N/m',
  shear_n: 'N', bending_moment_nm: 'N·m', torque_nm: 'N·m',
  bending_stiffness_nm2: 'N·m²', torsional_stiffness_nm2: 'N·m²', max_bending_stress_pa: 'Pa',
  max_torsional_shear_pa: 'Pa', von_mises_stress_pa: 'Pa', reynolds: '1', reynolds_number: '1',
  alpha_deg: 'deg', root_twist_deg: 'deg', tip_twist_deg: 'deg', trim_alpha_deg: 'deg', trimmed_alpha_deg: 'deg',
  induced_angle_deg: 'deg', geometric_twist_deg: 'deg', elastic_twist_deg: 'deg', tip_elastic_twist_deg: 'deg',
  twist_change_deg: 'deg', sweep_min_alpha_deg: 'deg', sweep_max_alpha_deg: 'deg', sweep_step_alpha_deg: 'deg',
  effective_alpha_min_deg: 'deg', effective_alpha_max_deg: 'deg', equilibrium_residual: 'rad',
  mass_delta_vs_baseline_pct: '%', induced_drag_delta_vs_baseline_pct: '%', tip_deflection_delta_pct: '%',
  induced_drag_delta_pct: '%', wall_mass_delta_pct: '%', target_lift_error_pct: '%',
  min_mass_reduction_pct: '%', max_induced_drag_increase_pct: '%', air_density_kg_m3: 'kg/m³',
  dynamic_viscosity_pa_s: 'Pa·s', modeled_wall_mass_kg: 'kg', structural_mass_kg: 'kg',
  wing_area_m2: 'm²', aspect_ratio: '1', lift_coefficient: '1', wake_induced_drag_coefficient: '1',
  profile_drag_coefficient: '1', combined_drag_coefficient: '1', sectional_lift_coefficient: '1',
  estimated_wing_l_to_d: '1', span_efficiency_estimate: '1',
  modeled_min_yield_ratio: '1', min_yield_margin: '1', yield_margin_delta: '1',
  front_spar_x_over_c: 'x/c', rear_spar_x_over_c: 'x/c', elastic_axis_x_over_c: 'x/c',
  x_over_c: 'x/c', z_over_c: 'z/c', cm: '1', cl: '1', cd: '1', mach: '1',
};

function fieldDescription(field: string) {
  if (FIELD_DESCRIPTIONS[field]) return FIELD_DESCRIPTIONS[field];
  return field.replaceAll('_', ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function availability(filePattern: string) {
  if (filePattern.includes('design_inputs') || filePattern.includes('airfoil') || filePattern.includes('polar_tables')) return 'Every retained design';
  if (filePattern.includes('export_status') || filePattern.includes('diagnostic') || filePattern.includes('warnings')) return 'Status/diagnostic-eligible designs';
  if (filePattern.includes('summary') || filePattern.includes('comparison')) return 'All designs; numerical values require current compatible analyses';
  return 'Current converged analyses only';
}

function buildDataDictionary() {
  const groups: Array<[string, readonly string[]]> = [
    ['*/design_inputs.csv', DESIGN_INPUT_HEADERS],
    ['*/airfoil_stations.csv', AIRFOIL_STATION_HEADERS],
    ['*/airfoil_coordinates.csv', AIRFOIL_COORDINATE_HEADERS],
    ['*/polar_tables.csv', POLAR_TABLE_HEADERS],
    ['*/analysis_summary.csv', ANALYSIS_SUMMARY_HEADERS],
    ['*/diagnostic_summary.csv', DIAGNOSTIC_SUMMARY_HEADERS],
    ['*/configured_checks.csv', CONSTRAINT_HEADERS],
    ['*/convergence.csv', CONVERGENCE_HEADERS],
    ['*/trim_spanwise_results.csv', SPANWISE_HEADERS],
    ['*/angle_sweep_results.csv', ANGLE_SWEEP_HEADERS],
    ['*/angle_sweep_spanwise_results.csv', ANGLE_SWEEP_SPANWISE_HEADERS],
    ['*/polar_diagnostics.csv', POLAR_DIAGNOSTIC_HEADERS],
    ['*/warnings.csv', WARNING_HEADERS],
    ['*/export_status.csv', EXPORT_STATUS_HEADERS],
    ['all_designs_summary.csv', SUMMARY_HEADERS],
    ['baseline_comparisons.csv', COMPARISON_HEADERS],
  ];
  return groups.flatMap(([filePattern, headers]) => headers.map((field) => ({
    file_pattern: filePattern,
    field,
    description: fieldDescription(field),
    unit: FIELD_UNITS[field] ?? '',
    availability: availability(filePattern),
  })));
}

function buildReadme(timestamp: string, counts: ReturnType<typeof summarizeExportCounts>) {
  return [
    'Aeroficiency Full Results export',
    '===============================',
    '',
    `Generated at (UTC): ${timestamp}`,
    'This ZIP is a local, allowlisted snapshot of the engineering workspace at export time.',
    'Nothing is uploaded; the archive excludes telemetry, internal application state, browser UI state, and raw upload bytes.',
    '',
    'Archive contents',
    `- ${counts.totalDesigns} retained design(s), ordered with the Baseline first and candidates after it.`,
    `- ${counts.currentConverged} current converged analysis/analyses with detailed CSV evidence.`,
    `- ${counts.diagnosticNotConverged} matching non-converged diagnostic result(s) with status and convergence evidence only.`,
    `- ${counts.stale} stale design(s) and ${counts.unanalysed + counts.snapshotMissing} design(s) without a usable current analysis; their inputs and export status are retained without stale performance numbers.`,
    '- all_designs_summary.csv provides one row per design.',
    '- baseline_comparisons.csv includes only compatible current converged comparisons; excluded candidates include a reason.',
    '- data_dictionary.csv defines the CSV fields and units.',
    '',
    'Design folders',
    '- Each design has design_inputs.csv, airfoil_stations.csv, polar_tables.csv, and export_status.csv.',
    '- Coordinate-defined airfoils also have airfoil_coordinates.csv.',
    '- Current converged analyses additionally include target-lift, convergence, checks, spanwise, AoA sweep, polar, and warning tables.',
    '',
    'Deliberate omissions',
    '- Complete 2D Hess–Smith streamline, velocity-vector, and Cp presentation fields are regenerated by the UI and are not stored in immutable analysis snapshots.',
    '- Rendered charts, 3D images, screenshots, video, raw Zustand state, activities, idempotency records, local paths, and original upload bytes are not included.',
    '',
    'Interpretation',
    'Blank numerical cells mean that the value is unavailable for the exported classification. Do not treat stale or diagnostic-only status as current engineering evidence.',
    '',
  ].join('\n');
}

function manifestInventory(files: readonly ResultsExportFile[]): ResultsManifestFile[] {
  return files.map((file) => ({
    path: file.path,
    size_bytes: file.sizeBytes,
    sha256: sha256(file.content),
  }));
}

function manifestFile(snapshot: ProjectState, classifications: readonly ClassifiedDesign[], counts: ReturnType<typeof summarizeExportCounts>, generatedAt: string, files: readonly ResultsExportFile[]) {
  const baseInventory = manifestInventory(files);
  const base: Omit<ResultsManifest, 'files'> = {
    schema_version: RESULTS_EXPORT_SCHEMA_VERSION,
    exported_at_utc: generatedAt,
    application: {
      name: 'Aeroficiency',
      version: RELEASE_IDENTITY.appVersion,
      solver_version: snapshot.solverVersion,
      tool_schema_version: RELEASE_IDENTITY.toolSchemaVersion,
      build_commit: RELEASE_IDENTITY.buildCommit,
    },
    source: 'local_client_snapshot',
    project: {
      project_id: snapshot.projectId,
      project_revision: snapshot.projectRevision,
      flight_case: { ...snapshot.flightCase },
      constraints: { ...snapshot.constraints },
    },
    counts,
    designs: classifications.map((item) => ({
      candidate_code: item.code,
      design_id: item.design.designId,
      design_label: item.design.label,
      design_role: item.design.kind,
      folder: designRoot(item),
      classification: item.classification,
      analysis_id: item.analysis?.analysisId ?? null,
      reason: item.reason,
    })),
    omissions: EXPORT_OMISSIONS,
  };
  let selfBytes = 0;
  let manifest: ResultsManifest = { ...base, files: [] };
  let content = '';
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const selfEntry: ResultsManifestFile = { path: 'manifest.json', size_bytes: selfBytes, sha256: null };
    const inventory = [baseInventory[0], selfEntry, ...baseInventory.slice(1)];
    manifest = { ...base, files: inventory };
    content = jsonText(manifest);
    const nextBytes = textByteLength(content);
    if (nextBytes === selfBytes) break;
    selfBytes = nextBytes;
  }
  return { manifest, file: textFile('manifest.json', content, 'application/json') };
}

export function buildFullResultsExport(project: ProjectState, generatedAt?: string): ResultsExportBundle {
  const snapshot = structuredClone(project);
  const timestamp = normalizeTimestamp(generatedAt);
  const classifications = classifyDesigns(snapshot);
  const counts = summarizeExportCounts(classifications);
  const baseline = classifications.find((item) => item.design.kind === 'baseline') ?? null;
  const readme = textFile('README.txt', buildReadme(timestamp, counts));
  const summary = csvFile('all_designs_summary.csv', SUMMARY_HEADERS, classifications.map((item) => summaryRow(item, baseline)));
  const comparisons = csvFile('baseline_comparisons.csv', COMPARISON_HEADERS, classifications.filter((item) => item.design.kind === 'candidate').map((item) => comparisonRow(item, baseline)));
  const dictionary = csvFile('data_dictionary.csv', DATA_DICTIONARY_HEADERS, buildDataDictionary());
  const perDesign = classifications.flatMap((item) => designFiles(snapshot, item));
  const nonManifestFiles = [readme, summary, comparisons, dictionary, ...perDesign];
  const { manifest, file: manifestFileResult } = manifestFile(snapshot, classifications, counts, timestamp, nonManifestFiles);
  const files = [readme, manifestFileResult, summary, comparisons, dictionary, ...perDesign];
  return {
    filename: `aeroficiency-full-results-${filenameTimestamp(timestamp)}.zip`,
    generatedAt: timestamp,
    files,
    classifications,
    counts,
    manifest,
  };
}

export const RESULTS_EXPORT_ROOT_FILE_ORDER = ROOT_EXPORT_FILES;

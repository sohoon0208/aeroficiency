export const RESULTS_EXPORT_SCHEMA_VERSION = 'aeroficiency-results-export-1.0';
export const RESULTS_EXPORT_MEDIA_TYPE = 'application/zip';

export const RESULTS_EXPORT_LIMITS = {
  maxFiles: 128,
  maxTotalUncompressedBytes: 64 * 1024 * 1024,
  maxFileBytes: 16 * 1024 * 1024,
} as const;

export const ROOT_EXPORT_FILES = [
  'README.txt',
  'manifest.json',
  'all_designs_summary.csv',
  'baseline_comparisons.csv',
  'data_dictionary.csv',
] as const;

export const DESIGN_INPUT_HEADERS = [
  'candidate_code', 'design_id', 'design_label', 'design_role', 'design_revision',
  'source_design_id', 'source_design_revision', 'span_m', 'root_chord_m', 'tip_chord_m',
  'root_twist_deg', 'tip_twist_deg', 'skin_thickness_mm', 'front_web_thickness_mm',
  'rear_web_thickness_mm', 'front_spar_x_over_c', 'rear_spar_x_over_c', 'elastic_axis_x_over_c',
  'material', 'flight_case_revision', 'target_lift_n', 'velocity_mps', 'altitude_m',
  'air_density_kg_m3', 'dynamic_viscosity_pa_s', 'sweep_min_alpha_deg', 'sweep_max_alpha_deg',
  'sweep_step_alpha_deg', 'constraints_revision', 'min_mass_reduction_pct', 'min_yield_margin',
  'max_tip_deflection_m', 'max_induced_drag_increase_pct', 'design_created_at_utc',
  'design_updated_at_utc', 'latest_analysis_id', 'export_classification',
] as const;

export const AIRFOIL_STATION_HEADERS = [
  'station_index', 'station_id', 'eta', 'airfoil_kind', 'naca_code', 'custom_airfoil_name',
  'blend_to_next', 'coordinate_count', 'source',
] as const;

export const AIRFOIL_COORDINATE_HEADERS = [
  'station_index', 'station_id', 'point_index', 'x_over_c', 'z_over_c',
] as const;

export const POLAR_TABLE_HEADERS = [
  'polar_id', 'station_id', 'reynolds', 'mach', 'transition_model', 'source',
  'provenance_label', 'provenance_licence', 'alpha_deg', 'cl', 'cd', 'cm',
] as const;

export const ANALYSIS_SUMMARY_HEADERS = [
  'analysis_id', 'analysis_status', 'analysis_freshness', 'analysis_created_at_utc',
  'design_revision', 'flight_case_revision', 'constraints_revision', 'fidelity', 'solver_version',
  'input_fingerprint', 'wing_area_m2', 'aspect_ratio', 'modeled_wall_mass_kg', 'lift_n',
  'lift_coefficient', 'trim_alpha_deg', 'wake_induced_drag_n', 'wake_induced_drag_coefficient',
  'profile_drag_n', 'profile_drag_coefficient', 'combined_wing_drag_n', 'combined_drag_coefficient',
  'estimated_wing_l_to_d', 'span_efficiency_estimate', 'tip_deflection_m', 'tip_elastic_twist_deg',
  'modeled_min_yield_ratio', 'max_bending_stress_pa', 'max_torsional_shear_pa',
] as const;

export const DIAGNOSTIC_SUMMARY_HEADERS = [
  'analysis_id', 'analysis_status', 'analysis_created_at_utc', 'design_revision',
  'flight_case_revision', 'constraints_revision', 'fidelity', 'solver_version', 'input_fingerprint',
  'iterations', 'equilibrium_residual', 'twist_change_deg', 'relative_load_change',
  'target_lift_error_pct', 'sweep_point_count', 'converged_sweep_points', 'warning_count',
  'polar_model', 'reason',
] as const;

export const CONSTRAINT_HEADERS = [
  'check_key', 'check_label', 'state', 'actual', 'limit', 'unit', 'detail',
] as const;

export const CONVERGENCE_HEADERS = [
  'phase', 'analysis_id', 'alpha_deg', 'status', 'iterations', 'equilibrium_residual',
  'twist_change_deg', 'relative_load_change', 'target_lift_error_pct',
] as const;

export const SPANWISE_HEADERS = [
  'eta', 'y_m', 'chord_m', 'geometric_twist_deg', 'airfoil_label', 'zero_lift_angle_deg',
  'pitching_moment_coefficient', 'reynolds_number', 'polar_state', 'lift_per_span_n_per_m',
  'circulation_m2_per_s', 'downwash_m_per_s', 'induced_angle_deg', 'induced_drag_per_span_n_per_m',
  'sectional_lift_coefficient', 'profile_drag_coefficient', 'profile_drag_per_span_n_per_m',
  'shear_n', 'bending_moment_nm', 'torque_nm', 'deflection_m', 'elastic_twist_deg',
  'bending_stiffness_nm2', 'torsional_stiffness_nm2', 'von_mises_stress_pa', 'modeled_yield_ratio',
] as const;

export const ANGLE_SWEEP_HEADERS = [
  'alpha_deg', 'status', 'iterations', 'equilibrium_residual', 'twist_change_deg',
  'relative_load_change', 'target_lift_error_pct', 'lift_n', 'lift_coefficient',
  'wake_induced_drag_n', 'profile_drag_n', 'combined_wing_drag_n', 'estimated_wing_l_to_d',
  'tip_deflection_m', 'tip_elastic_twist_deg', 'modeled_min_yield_ratio',
] as const;

export const ANGLE_SWEEP_SPANWISE_HEADERS = [
  'alpha_deg', 'eta', 'y_m', 'chord_m', 'geometric_twist_deg', 'airfoil_label',
  'lift_per_span_n_per_m', 'circulation_m2_per_s', 'downwash_m_per_s', 'induced_angle_deg',
  'reynolds_number', 'sectional_lift_coefficient', 'profile_drag_coefficient',
  'profile_drag_per_span_n_per_m', 'deflection_m', 'elastic_twist_deg', 'von_mises_stress_pa',
  'modeled_yield_ratio',
] as const;

export const POLAR_DIAGNOSTIC_HEADERS = [
  'scope', 'alpha_deg', 'analysis_id', 'model', 'profile_drag_available', 'within_range_stations',
  'analytic_estimate_stations', 'extrapolated_alpha_stations', 'outside_reynolds_stations',
  'outside_alpha_stations', 'reynolds_min', 'reynolds_max', 'effective_alpha_min_deg',
  'effective_alpha_max_deg', 'provenance',
] as const;

export const WARNING_HEADERS = ['warning_index', 'warning'] as const;

export const EXPORT_STATUS_HEADERS = [
  'export_classification', 'reason', 'design_id', 'design_revision', 'latest_analysis_id',
  'analysis_id', 'analysis_status', 'analysis_freshness', 'analysis_created_at_utc',
  'solver_version', 'fidelity', 'input_fingerprint', 'flight_case_revision', 'constraints_revision',
] as const;

export const SUMMARY_HEADERS = [
  'candidate_code', 'design_id', 'design_label', 'design_role', 'design_revision',
  'export_classification', 'analysis_id', 'analysis_status', 'analysis_freshness',
  'check_pass_count', 'check_total', 'all_checks_pass', 'modeled_wall_mass_kg',
  'mass_delta_vs_baseline_pct', 'induced_drag_n', 'induced_drag_delta_vs_baseline_pct',
  'combined_wing_drag_n', 'estimated_wing_l_to_d', 'min_yield_margin', 'tip_deflection_m',
  'trimmed_alpha_deg', 'best_lift_to_drag_alpha_deg', 'sweep_points_solved', 'export_reason',
] as const;

export const COMPARISON_HEADERS = [
  'candidate_code', 'candidate_design_id', 'candidate_label', 'comparison_status',
  'exclusion_reason', 'baseline_analysis_id', 'candidate_analysis_id', 'compatible',
  'candidate_checks_passed', 'candidate_checks_total', 'wall_mass_delta_pct',
  'induced_drag_delta_pct', 'tip_deflection_delta_pct', 'yield_margin_delta',
  'baseline_structural_mass_kg', 'candidate_structural_mass_kg', 'baseline_induced_drag_n',
  'candidate_induced_drag_n',
] as const;

export const DATA_DICTIONARY_HEADERS = ['file_pattern', 'field', 'description', 'unit', 'availability'] as const;

export const EXPORT_OMISSIONS = [
  'Complete 2D Hess–Smith streamline, velocity-vector, and Cp presentation fields are regenerable diagnostics and are not stored in immutable analysis snapshots.',
  'Rendered 2D charts, 3D images, screenshots, video, browser UI state, and the selected tab are not included.',
  'Raw Zustand state, activities, idempotency records, local paths, and original upload bytes are not included.',
] as const;

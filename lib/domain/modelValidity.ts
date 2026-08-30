import {
  DESIGN_LIMITS,
  MAX_AIRFOIL_COORDINATE_POINTS,
  MAX_AIRFOIL_STATIONS,
  MAX_POLAR_ROWS,
  MAX_POLAR_TABLES,
  MIN_AIRFOIL_STATION_SEPARATION,
  SOLVER_SETTINGS,
} from './limits';

export const MODEL_VALIDITY_STATUS = 'PRELIMINARY' as const;
export const MODEL_METHOD = 'LOW_ORDER_REYNOLDS_POLAR_TORSION_COUPLED_STATIC' as const;
export const WAKE_MODEL = 'FIXED_POSITIVE_X_BODY_AXIS' as const;

export const MODEL_ASSUMPTION_CODES = [
  'TARGET_LIFT_TRIM',
  'INCOMPRESSIBLE_NONLINEAR_SECTION_POLAR_LIFTING_LINE',
  'LOCAL_REYNOLDS_PROFILE_DRAG_INTEGRATION',
  'SPANWISE_CAMBER_THICKNESS_ZERO_LIFT_AND_MOMENT',
  'ZERO_SWEEP_ZERO_DIHEDRAL',
  'LINEAR_ELASTIC_WING_BOX_WALLS',
  'TORSION_COUPLED_BENDING_ONE_WAY',
] as const;

export const MODEL_OMISSION_CODES = [
  'FIRST_PRINCIPLES_STALL_SEPARATION_TRANSITION_AND_TURBULENCE',
  'FUSELAGE_INTERFERENCE_AND_FULL_AIRCRAFT_DRAG',
  'COMPRESSIBILITY_TRANSONIC_EFFECTS_AND_FREE_WAKE_ROLLUP',
  'HIGH_FIDELITY_CFD_FEA_AND_EXPERIMENTAL_CORRELATION',
  'BENDING_FEEDBACK_TO_AERODYNAMICS',
  'SELF_WEIGHT_GRAVITY_AND_INERTIAL_LOADS',
  'DIVERGENCE_FLUTTER_AND_DYNAMIC_AEROELASTICITY',
  'BUCKLING_FATIGUE_LOCAL_FAILURE_AND_STRESS_CONCENTRATIONS',
  'JOINTS_FASTENERS_MANUFACTURING_AND_CERTIFICATION_LOAD_CASES',
] as const;

export const SUMMARY_MODEL_ASSUMPTION_CODES = [
  'INCOMPRESSIBLE_POLAR_LIFTING_LINE',
  'REYNOLDS_PROFILE_DRAG_SECTION_MOMENT',
  'TORSION_COUPLED_BENDING_ONE_WAY',
] as const;

export const SUMMARY_MODEL_OMISSION_CODES = [
  'STALL_TRANSITION_SEPARATION_UNMODELED',
  'FULL_AIRCRAFT_DRAG_UNMODELED',
  'COMPRESSIBILITY_TRANSONIC_FREE_WAKE',
  'BENDING_FEEDBACK_WEIGHT_INERTIA',
  'DIVERGENCE_FLUTTER_DYNAMICS',
  'BUCKLING_FATIGUE_LOCAL_FAILURE',
  'JOINTS_MANUFACTURING_CERTIFICATION',
] as const;

export const MODEL_SCOPE_SECTIONS = [
  {
    title: 'Method and supported model bounds',
    items: [
      'Low-order target-lift, torsion-coupled static analysis for straight, unswept, zero-dihedral fixed-wing concepts.',
      `Span ${DESIGN_LIMITS.spanM[0]}–${DESIGN_LIMITS.spanM[1]} m; root chord ${DESIGN_LIMITS.rootChordM[0]}–${DESIGN_LIMITS.rootChordM[1]} m; tip chord ${DESIGN_LIMITS.tipChordM[0]}–${DESIGN_LIMITS.tipChordM[1]} m.`,
      `Taper ratio ${DESIGN_LIMITS.taperRatio[0]}–${DESIGN_LIMITS.taperRatio[1]}; aspect ratio ${DESIGN_LIMITS.aspectRatio[0]}–${DESIGN_LIMITS.aspectRatio[1]}; root twist fixed at 0°.`,
      `Two to ${MAX_AIRFOIL_STATIONS} ordered airfoil stations cover root to tip with at least ${MIN_AIRFOIL_STATION_SEPARATION.toFixed(2)} η separation.`,
      `Each station accepts a supported NACA four-digit section or ${24}–${MAX_AIRFOIL_COORDINATE_POINTS} finite coordinate points; imported contours are normalized, checked, and cosine-resampled.`,
      `User polar mode accepts up to ${MAX_POLAR_TABLES} station/Reynolds tables with 7–${MAX_POLAR_ROWS} increasing-alpha rows each, Reynolds 50,000–50,000,000, and Mach metadata 0–0.30.`,
      `Front/rear spars fixed at 0.20c/0.65c; elastic axis above ${DESIGN_LIMITS.elasticAxisXOverC[0]}c through ${DESIGN_LIMITS.elasticAxisXOverC[1]}c; Aluminum 2024-T3 only.`,
      `Target lift ${DESIGN_LIMITS.targetLiftN[0] / 1000}–${DESIGN_LIMITS.targetLiftN[1] / 1000} kN; speed ${DESIGN_LIMITS.velocityMps[0]}–${DESIGN_LIMITS.velocityMps[1]} m/s; altitude ${DESIGN_LIMITS.altitudeM[0] / 1000}–${DESIGN_LIMITS.altitudeM[1] / 1000} km.`,
      `Air density ${DESIGN_LIMITS.airDensityKgM3[0]}–${DESIGN_LIMITS.airDensityKgM3[1]} kg/m³; dynamic viscosity ${DESIGN_LIMITS.dynamicViscosityPaS[0]}–${DESIGN_LIMITS.dynamicViscosityPaS[1]} Pa·s.`,
      `The combined case must require target CL ${SOLVER_SETTINGS.requiredTargetCl[0]}–${SOLVER_SETTINGS.requiredTargetCl[1].toFixed(2)}.`,
      `Elastic twist is limited to ${SOLVER_SETTINGS.maxElasticTwistDeg}° and tip deflection to ${100 * SOLVER_SETTINGS.maxTipDeflectionSemispanFraction}% of semispan.`,
      `Trim search is bounded to ${SOLVER_SETTINGS.alphaBracketDeg[0]}° through ${SOLVER_SETTINGS.alphaBracketDeg[1]}° angle of attack.`,
    ],
  },
  {
    title: 'Key assumptions',
    items: [
      'Incompressible nonlinear lifting-line aerodynamics couples local Reynolds number and induced angle to the active SectionPolar source while trimming to target lift.',
      'The built-in polar is a transparent attached-flow estimate; user XFOIL or experimental tables retain provenance and explicit alpha/Reynolds range states.',
      'Profile drag is integrated spanwise from section Cd. Combined wing drag is induced plus profile drag and is not whole-aircraft drag.',
      'Local camber and half-thickness drive the 3D loft and wing box; zero-lift angle and quarter-chord moment drive aerodynamic and torsional loading.',
      'Linear-elastic aluminum wing-box walls are used; torsional deformation feeds back to aerodynamic loading.',
      'Bending deformation is reported but does not feed back to the aerodynamic lattice.',
    ],
  },
  {
    title: 'Key omissions',
    items: [
      'No first-principles boundary layer, transition, turbulence, separation, or stall prediction; the analytic polar must not be presented as XFOIL or experiment.',
      'No fuselage, tail, nacelle, control-surface, interference, wave, or other full-aircraft drag; no compressibility, transonic effects, ground effect, or free-wake roll-up.',
      'No high-fidelity CFD/FEA or experimental correlation is claimed.',
      'Aeroelastic divergence, flutter, gust response, manoeuvre dynamics, and other time-dependent effects.',
      'Structural self-weight, gravity, manoeuvre inertia, and other inertial load cases.',
      'Buckling, fatigue, local failure, stress concentrations, joints, fasteners, manufacturing constraints, and certification load cases.',
    ],
  },
] as const;

export function modelValidityStatus() {
  return { status: MODEL_VALIDITY_STATUS };
}

export function compactModelValidity() {
  return {
    status: MODEL_VALIDITY_STATUS,
    method: MODEL_METHOD,
    wakeModel: WAKE_MODEL,
    omissions: MODEL_OMISSION_CODES,
  };
}

export function completeModelValidity() {
  return {
    status: MODEL_VALIDITY_STATUS,
    method: MODEL_METHOD,
    wakeModel: WAKE_MODEL,
    supportedBounds: {
      spanM: DESIGN_LIMITS.spanM,
      requiredCl: SOLVER_SETTINGS.requiredTargetCl,
      maxAbsTwistDeg: SOLVER_SETTINGS.maxElasticTwistDeg,
      maxTipDeflectionToSemispan: SOLVER_SETTINGS.maxTipDeflectionSemispanFraction,
    },
    trimAlphaBracketDeg: SOLVER_SETTINGS.alphaBracketDeg,
    assumptions: SUMMARY_MODEL_ASSUMPTION_CODES,
    omissions: SUMMARY_MODEL_OMISSION_CODES,
  };
}

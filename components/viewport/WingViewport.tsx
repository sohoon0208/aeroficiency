'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { AnalysisSnapshot, WingDesign } from '@/lib/domain/types';
import { interpolateStationValue } from '@/lib/domain/stations';
import { localAirfoilSection, resolvedAirfoilStations, sectionSurfaceAtX } from '@/lib/solver/airfoilSections';
import { chordAtY } from '@/lib/solver/planform';

export type ViewMode = 'geometry' | 'aero' | 'section' | 'performance' | 'structure';

const ATTITUDE_DAMPING = 11;
const MAX_ANIMATION_DELTA_S = 0.05;
const FLOW_ARROW_LENGTH_M = 2.6;
const FLOW_ARROW_LEADING_EDGE_GAP_M = 0.12;
const WING_SPAN_AXIS = new THREE.Vector3(0, 0, 1);

function attitudeRotationRad(angleOfAttackDeg: number | null) {
  return -THREE.MathUtils.degToRad(Number.isFinite(angleOfAttackDeg) ? angleOfAttackDeg as number : 0);
}

function transformedPoint(design: WingDesign, analysis: AnalysisSnapshot | null, spanCoordinate: number, xOverC: number, zOverC: number, deformed: boolean) {
  const halfSpan = design.geometry.spanM / 2;
  const eta = Math.abs(spanCoordinate) / halfSpan;
  const chord = chordAtY(design.geometry, spanCoordinate);
  const geometric = (design.geometry.rootTwistDeg + (design.geometry.tipTwistDeg - design.geometry.rootTwistDeg) * eta) * Math.PI / 180;
  const elastic = Number(analysis ? interpolateStationValue(analysis, eta, 'elasticTwistDeg') : 0) * Math.PI / 180;
  const twist = geometric + (deformed ? elastic : 0);
  const deflection = deformed ? Number(analysis ? interpolateStationValue(analysis, eta, 'deflectionM') : 0) * 6 : 0;
  const x = (xOverC - 0.25) * chord;
  const z = zOverC * chord;
  return new THREE.Vector3(
    x * Math.cos(twist) + z * Math.sin(twist),
    deflection - x * Math.sin(twist) + z * Math.cos(twist),
    spanCoordinate,
  );
}

function modeColor(analysis: AnalysisSnapshot | null, mode: ViewMode, eta: number, yieldLimit: number) {
  const color = new THREE.Color('#58d0ff');
  if (mode === 'aero' && analysis) {
    const maxLoad = Math.max(...analysis.stations.map((station) => Math.abs(station.liftPerSpanNpm)), 1);
    const load = Number(interpolateStationValue(analysis, eta, 'liftPerSpanNpm'));
    return color.lerp(new THREE.Color(load >= 0 ? '#f2b866' : '#b89cff'), Math.min(1, Math.abs(load) / maxLoad));
  }
  if (mode === 'structure' && analysis) {
    const margin = interpolateStationValue(analysis, eta, 'yieldMargin');
    if (margin === null) return color.set('#718492');
    if (margin < yieldLimit) return color.set('#ff6b7b').lerp(new THREE.Color('#f5c15e'), Math.max(0, margin / yieldLimit));
    const safe = Math.min(1, (margin - yieldLimit) / Math.max(yieldLimit * 0.5, 0.01));
    return color.set('#f5c15e').lerp(new THREE.Color('#46d39a'), safe);
  }
  return color;
}

function surfaceGeometry(design: WingDesign, analysis: AnalysisSnapshot | null, mode: ViewMode, deformed: boolean, yieldLimit: number) {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const spanStationCount = 32;
  const chordIntervals = 24;
  const chordCount = chordIntervals + 1;
  const verticesPerStation = 2 * chordCount;
  const halfSpan = design.geometry.spanM / 2;

  for (let spanIndex = 0; spanIndex <= spanStationCount; spanIndex += 1) {
    const spanCoordinate = -halfSpan + design.geometry.spanM * spanIndex / spanStationCount;
    const eta = Math.abs(spanCoordinate) / halfSpan;
    const color = modeColor(analysis, mode, eta, yieldLimit);
    const section = localAirfoilSection(design.geometry, eta, chordIntervals);
    for (const surface of ['upper', 'lower'] as const) {
      for (const [xOverC, zOverC] of section[surface]) {
        const transformed = transformedPoint(
          design,
          analysis,
          spanCoordinate,
          xOverC,
          zOverC,
          deformed,
        );
        positions.push(transformed.x, transformed.y, transformed.z);
        colors.push(color.r, color.g, color.b);
      }
    }
    if (spanIndex >= spanStationCount) continue;
    for (let surface = 0; surface < 2; surface += 1) {
      for (let chordIndex = 0; chordIndex < chordCount - 1; chordIndex += 1) {
        const base = spanIndex * verticesPerStation + surface * chordCount + chordIndex;
        const nextSpan = base + verticesPerStation;
        if (surface === 0) indices.push(base, base + 1, nextSpan, base + 1, nextSpan + 1, nextSpan);
        else indices.push(base, nextSpan, base + 1, base + 1, nextSpan, nextSpan + 1);
      }
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function WingSurface({ design, analysis, mode, deformed, yieldLimit, wireframe = false }: { design: WingDesign; analysis: AnalysisSnapshot | null; mode: ViewMode; deformed: boolean; yieldLimit: number; wireframe?: boolean }) {
  const geometry = useMemo(() => surfaceGeometry(design, analysis, mode, deformed, yieldLimit), [design, analysis, mode, deformed, yieldLimit]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry}><meshStandardMaterial vertexColors={!wireframe} color={wireframe ? '#79a7ff' : '#ffffff'} wireframe={wireframe} transparent opacity={wireframe ? 0.3 : 0.9} roughness={0.62} metalness={0.2} side={THREE.DoubleSide} /></mesh>;
}

function SparLines({ design, analysis, deformed }: { design: WingDesign; analysis: AnalysisSnapshot | null; deformed: boolean }) {
  const geometry = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const halfSpan = design.geometry.spanM / 2;
    for (const fraction of [design.structure.frontSparXOverC, design.structure.rearSparXOverC]) {
      for (const surface of ['zUpper', 'zLower'] as const) {
        for (let index = 0; index < 32; index += 1) {
          const start = -halfSpan + design.geometry.spanM * index / 32;
          const end = -halfSpan + design.geometry.spanM * (index + 1) / 32;
          const startSection = sectionSurfaceAtX(localAirfoilSection(design.geometry, Math.abs(start) / halfSpan, 40), fraction);
          const endSection = sectionSurfaceAtX(localAirfoilSection(design.geometry, Math.abs(end) / halfSpan, 40), fraction);
          points.push(
            transformedPoint(design, analysis, start, fraction, startSection[surface], deformed),
            transformedPoint(design, analysis, end, fraction, endSection[surface], deformed),
          );
        }
      }
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [design, analysis, deformed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineSegments geometry={geometry}><lineBasicMaterial color="#d9f6ff" transparent opacity={0.7} /></lineSegments>;
}

function SectionOutline({ design, analysis, eta, deformed, side = 1, color, opacity = 1, emphasis = false }: { design: WingDesign; analysis: AnalysisSnapshot | null; eta: number; deformed: boolean; side?: -1 | 1; color: string; opacity?: number; emphasis?: boolean }) {
  const points = useMemo(() => {
    const section = localAirfoilSection(design.geometry, eta, 40);
    const contour = [...section.upper, ...[...section.lower].reverse()];
    const points: THREE.Vector3[] = [];
    const spanCoordinate = side * eta * design.geometry.spanM / 2;
    for (let index = 0; index < contour.length; index += 1) {
      const current = contour[index];
      points.push(transformedPoint(design, analysis, spanCoordinate, current[0], current[1], deformed));
    }
    return points;
  }, [analysis, deformed, design, eta, side]);
  const geometry = useMemo(() => {
    const segments: THREE.Vector3[] = [];
    for (let index = 0; index < points.length; index += 1) {
      segments.push(points[index], points[(index + 1) % points.length]);
    }
    return new THREE.BufferGeometry().setFromPoints(segments);
  }, [points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (emphasis) {
    const closedPoints = points.length > 0 ? [...points, points[0]] : points;
    return <group renderOrder={3}>
      <Line points={closedPoints} color="#fff0b8" lineWidth={5} transparent opacity={0.28} depthWrite={false} />
      <Line points={closedPoints} color={color} lineWidth={2.25} transparent opacity={Math.max(opacity, 0.96)} depthWrite={false} />
    </group>;
  }
  return <lineSegments geometry={geometry}><lineBasicMaterial color={color} transparent opacity={opacity} /></lineSegments>;
}

function AirfoilStationMarkers({ design, analysis, deformed }: { design: WingDesign; analysis: AnalysisSnapshot | null; deformed: boolean }) {
  const locations = [...new Set(resolvedAirfoilStations(design.geometry).flatMap((station) => station.eta === 0 ? [0] : [station.eta, -station.eta]))];
  return <>{locations.map((eta) => <SectionOutline key={eta} design={design} analysis={analysis} eta={Math.abs(eta)} side={eta < 0 ? -1 : 1} deformed={deformed} color="#b89cff" opacity={0.58} />)}</>;
}

/**
 * Animates the view-only wing attitude without rebuilding the wing geometry.
 * Positive aerodynamic angle raises the leading edge, matching the section
 * diagnostic's wind-axis convention; the solver values remain body-axis data.
 */
function AnimatedWingAttitude({ angleOfAttackDeg, children }: { angleOfAttackDeg: number | null; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const initialized = useRef(false);
  useFrame((_, delta) => {
    if (!group.current) return;
    const target = attitudeRotationRad(angleOfAttackDeg);
    if (!initialized.current) {
      group.current.rotation.z = target;
      initialized.current = true;
      return;
    }
    group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, target, ATTITUDE_DAMPING, Math.min(delta, MAX_ANIMATION_DELTA_S));
  });
  return <group ref={group}>{children}</group>;
}

function FlowDirectionIndicator({ design, analysis, deformed, angleOfAttackDeg }: { design: WingDesign; analysis: AnalysisSnapshot | null; deformed: boolean; angleOfAttackDeg: number | null }) {
  const group = useRef<THREE.Group>(null);
  const currentRotation = useRef<number | null>(null);
  const direction = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const localOrigin = useMemo(() => new THREE.Vector3(), []);
  const animatedLeadingEdge = useMemo(() => new THREE.Vector3(), []);
  const rootLeadingEdge = useMemo(() => transformedPoint(design, analysis, 0, 0, 0, deformed), [analysis, deformed, design]);
  useFrame((_, delta) => {
    if (!group.current) return;
    const targetRotation = attitudeRotationRad(angleOfAttackDeg);
    currentRotation.current = currentRotation.current === null
      ? targetRotation
      : THREE.MathUtils.damp(currentRotation.current, targetRotation, ATTITUDE_DAMPING, Math.min(delta, MAX_ANIMATION_DELTA_S));
    animatedLeadingEdge.copy(rootLeadingEdge).applyAxisAngle(WING_SPAN_AXIS, currentRotation.current);
    group.current.position.set(
      animatedLeadingEdge.x - FLOW_ARROW_LENGTH_M - FLOW_ARROW_LEADING_EDGE_GAP_M,
      animatedLeadingEdge.y,
      animatedLeadingEdge.z,
    );
  });
  return <group ref={group}><arrowHelper args={[direction, localOrigin, FLOW_ARROW_LENGTH_M, '#58d0ff', 0.34, 0.2]} /></group>;
}

function Legend({ design, analysis, mode, yieldLimit, selectedEta }: { design: WingDesign; analysis: AnalysisSnapshot | null; mode: ViewMode; yieldLimit: number; selectedEta: number }) {
  if (mode === 'geometry') return <div className="viewport-scale"><span className="scale-cyan" />{resolvedAirfoilStations(design.geometry).length} airfoil stations<b>{localAirfoilSection(design.geometry, selectedEta, 40).label} · spars .20c / .65c</b></div>;
  if (mode === 'aero') {
    const range = analysis ? [Math.min(...analysis.stations.map((station) => station.liftPerSpanNpm)), Math.max(...analysis.stations.map((station) => station.liftPerSpanNpm))] : null;
    return <div className="viewport-scale"><span className="scale-aero" />Signed lift / span<b>{range === null ? 'Analysis required' : `${range[0].toFixed(0)} → 0 → ${range[1].toFixed(0)} N/m`}</b></div>;
  }
  return <div className="viewport-scale"><span className="scale-structure" />Modeled yield ratio<b>red &lt; {yieldLimit.toFixed(2)}× · green ≥ {(yieldLimit * 1.5).toFixed(2)}×</b></div>;
}

export function WingViewport({ design, baseline, analysis, mode, deformed, selectedEta, yieldLimit, angleOfAttackDeg = null }: { design: WingDesign; baseline: WingDesign | null; analysis: AnalysisSnapshot | null; mode: ViewMode; deformed: boolean; selectedEta: number; yieldLimit: number; angleOfAttackDeg?: number | null }) {
  const stateLabel = analysis?.status === 'converged' ? `${deformed ? 'deformed' : 'undeformed'} ${mode} model at analysis ${analysis.analysisId}` : `undeformed ${mode} model without a current analysis`;
  const angleLabel = Number.isFinite(angleOfAttackDeg) ? ` at ${angleOfAttackDeg!.toFixed(2)} degrees angle of attack` : '';
  return (
    <div className="wing-viewport" role="group" aria-label={`Three-dimensional wing visualization: ${stateLabel}${angleLabel}. Equivalent values are available in the selected-station readout and chart table. Selected right-semispan station eta ${selectedEta.toFixed(2)}.`}>
      <Canvas dpr={[1, 2]} camera={{ position: [8, 5.8, 10], fov: 34 }} gl={{ antialias: true, alpha: false }}>
        <color attach="background" args={['#061019']} /><ambientLight intensity={1.1} /><directionalLight position={[5, 9, 4]} intensity={2.2} color="#d9f4ff" /><directionalLight position={[-5, 2, -6]} intensity={0.8} color="#79a7ff" /><gridHelper args={[24, 24, '#294253', '#142533']} position={[0, -1.35, 0]} />
        <FlowDirectionIndicator design={design} analysis={analysis} deformed={deformed} angleOfAttackDeg={angleOfAttackDeg} />
        <AnimatedWingAttitude angleOfAttackDeg={angleOfAttackDeg}>
          {baseline && baseline.designId !== design.designId && <WingSurface design={baseline} analysis={null} mode="geometry" deformed={false} yieldLimit={yieldLimit} wireframe />}
          <WingSurface design={design} analysis={analysis} mode={mode} deformed={deformed} yieldLimit={yieldLimit} />
          {mode === 'geometry' && <><SparLines design={design} analysis={analysis} deformed={deformed} /><AirfoilStationMarkers design={design} analysis={analysis} deformed={deformed} /></>}
          <SectionOutline design={design} analysis={analysis} eta={selectedEta} deformed={deformed} color="#f2b866" emphasis />
        </AnimatedWingAttitude>
        <OrbitControls makeDefault enablePan={false} minDistance={8} maxDistance={24} target={[0.6, 0, 0]} />
      </Canvas>
      <div className="viewport-hud top"><span>3D VIEW</span><span>α {Number.isFinite(angleOfAttackDeg) ? `${angleOfAttackDeg!.toFixed(2)}°` : '—'}</span><span>η {selectedEta.toFixed(2)}</span></div>
      <div className="viewport-hud flow"><span><i className="flow-key" /> U∞ · WIND AXIS</span></div>
      <Legend design={design} analysis={analysis} mode={mode} yieldLimit={yieldLimit} selectedEta={selectedEta} />
      <div className="viewport-hud bottom"><span><i className="candidate-key" /> {design.kind === 'baseline' ? 'Baseline' : design.label}</span>{baseline && design.kind === 'candidate' && <span><i className="baseline-key" /> Baseline reference</span>}<span>{deformed ? 'Bending ×6 · twist ×1' : 'Undeformed'}</span></div>
    </div>
  );
}

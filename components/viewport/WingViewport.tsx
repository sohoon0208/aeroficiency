'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { AnalysisSnapshot, WingDesign } from '@/lib/domain/types';
import { interpolateStationValue } from '@/lib/domain/stations';
import { nacaSurfacePoint, parseNaca4, sampleNaca4 } from '@/lib/solver/naca';
import { chordAtY } from '@/lib/solver/planform';

export type ViewMode = 'geometry' | 'aero' | 'structure';

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
    return color.lerp(new THREE.Color('#f2b866'), Math.min(1, Math.abs(Number(interpolateStationValue(analysis, eta, 'liftPerSpanNpm'))) / maxLoad));
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
  const section = sampleNaca4(design.geometry.nacaCode, 16);
  const chordCount = section.length;
  const verticesPerStation = 2 * chordCount;
  const halfSpan = design.geometry.spanM / 2;

  for (let spanIndex = 0; spanIndex <= spanStationCount; spanIndex += 1) {
    const spanCoordinate = -halfSpan + design.geometry.spanM * spanIndex / spanStationCount;
    const eta = Math.abs(spanCoordinate) / halfSpan;
    const color = modeColor(analysis, mode, eta, yieldLimit);
    for (const surface of ['upper', 'lower'] as const) {
      for (const point of section) {
        const transformed = transformedPoint(
          design,
          analysis,
          spanCoordinate,
          surface === 'upper' ? point.xUpper : point.xLower,
          surface === 'upper' ? point.zUpper : point.zLower,
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
    const definition = parseNaca4(design.geometry.nacaCode);
    const halfSpan = design.geometry.spanM / 2;
    for (const fraction of [design.structure.frontSparXOverC, design.structure.rearSparXOverC]) {
      const section = nacaSurfacePoint(fraction, definition);
      for (const zOverC of [section.zUpper, section.zLower]) {
        for (let index = 0; index < 32; index += 1) {
          const start = -halfSpan + design.geometry.spanM * index / 32;
          const end = -halfSpan + design.geometry.spanM * (index + 1) / 32;
          points.push(
            transformedPoint(design, analysis, start, fraction, zOverC, deformed),
            transformedPoint(design, analysis, end, fraction, zOverC, deformed),
          );
        }
      }
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [design, analysis, deformed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineSegments geometry={geometry}><lineBasicMaterial color="#d9f6ff" transparent opacity={0.7} /></lineSegments>;
}

function SelectedStation({ design, analysis, eta, deformed }: { design: WingDesign; analysis: AnalysisSnapshot | null; eta: number; deformed: boolean }) {
  const points = useMemo(() => {
    const spanCoordinate = eta * design.geometry.spanM / 2;
    return [
      transformedPoint(design, analysis, spanCoordinate, 0, 0, deformed),
      transformedPoint(design, analysis, spanCoordinate, 1, 0, deformed),
    ];
  }, [design, analysis, eta, deformed]);
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineSegments geometry={geometry}><lineBasicMaterial color="#f2b866" /></lineSegments>;
}

function Legend({ design, analysis, mode, yieldLimit }: { design: WingDesign; analysis: AnalysisSnapshot | null; mode: ViewMode; yieldLimit: number }) {
  if (mode === 'geometry') return <div className="viewport-scale"><span className="scale-cyan" />NACA {design.geometry.nacaCode}<b>Spars .20c / .65c</b></div>;
  if (mode === 'aero') {
    const peak = analysis ? Math.max(...analysis.stations.map((station) => Math.abs(station.liftPerSpanNpm))) : null;
    return <div className="viewport-scale"><span className="scale-aero" />Lift / span<b>{peak === null ? 'Analysis required' : `0 → ${peak.toFixed(0)} N/m`}</b></div>;
  }
  return <div className="viewport-scale"><span className="scale-structure" />Modeled yield margin<b>red &lt; {yieldLimit.toFixed(2)}× · green ≥ {(yieldLimit * 1.5).toFixed(2)}×</b></div>;
}

export function WingViewport({ design, baseline, analysis, mode, deformed, selectedEta, yieldLimit }: { design: WingDesign; baseline: WingDesign | null; analysis: AnalysisSnapshot | null; mode: ViewMode; deformed: boolean; selectedEta: number; yieldLimit: number }) {
  const stateLabel = analysis?.status === 'converged' ? `${deformed ? 'deformed' : 'undeformed'} ${mode} model at analysis ${analysis.analysisId}` : `undeformed ${mode} model without a current analysis`;
  return (
    <div className="wing-viewport" role="img" aria-label={`Three-dimensional wing visualization: ${stateLabel}. Equivalent values are available in the selected-station readout and chart table. Selected right-semispan station eta ${selectedEta.toFixed(2)}.`}>
      <Canvas dpr={[1, 2]} camera={{ position: [8, 5.8, 10], fov: 34 }} gl={{ antialias: true, alpha: false }}>
        <color attach="background" args={['#061019']} /><ambientLight intensity={1.1} /><directionalLight position={[5, 9, 4]} intensity={2.2} color="#d9f4ff" /><directionalLight position={[-5, 2, -6]} intensity={0.8} color="#79a7ff" /><gridHelper args={[24, 24, '#294253', '#142533']} position={[0, -1.35, 0]} />
        {baseline && baseline.designId !== design.designId && <WingSurface design={baseline} analysis={null} mode="geometry" deformed={false} yieldLimit={yieldLimit} wireframe />}
        <WingSurface design={design} analysis={analysis} mode={mode} deformed={deformed} yieldLimit={yieldLimit} />
        {mode === 'geometry' && <SparLines design={design} analysis={analysis} deformed={deformed} />}
        <SelectedStation design={design} analysis={analysis} eta={selectedEta} deformed={deformed} />
        <OrbitControls makeDefault enablePan={false} minDistance={8} maxDistance={24} target={[0.6, 0, 0]} />
      </Canvas>
      <div className="viewport-hud top"><span>3D VIEW</span><span>η {selectedEta.toFixed(2)}</span></div>
      <Legend design={design} analysis={analysis} mode={mode} yieldLimit={yieldLimit} />
      <div className="viewport-hud bottom"><span><i className="candidate-key" /> {design.kind === 'baseline' ? 'Baseline' : design.label}</span>{baseline && design.kind === 'candidate' && <span><i className="baseline-key" /> Baseline reference</span>}<span>{deformed ? 'Bending ×6 · twist ×1' : 'Undeformed'}</span></div>
    </div>
  );
}

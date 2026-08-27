import type { WingGeometry } from '@/lib/domain/types';
import { radians } from './math';

export const wingArea = (geometry: WingGeometry) => geometry.spanM * (geometry.rootChordM + geometry.tipChordM) / 2;
export const wingAspectRatio = (geometry: WingGeometry) => geometry.spanM ** 2 / wingArea(geometry);
export const taperRatio = (geometry: WingGeometry) => geometry.tipChordM / geometry.rootChordM;
export const meanAerodynamicChord = (geometry: WingGeometry) => {
  const taper = taperRatio(geometry);
  return 2 / 3 * geometry.rootChordM * (1 + taper + taper ** 2) / (1 + taper);
};
export const chordAtY = (geometry: WingGeometry, yM: number) => geometry.rootChordM - (geometry.rootChordM - geometry.tipChordM) * 2 * Math.abs(yM) / geometry.spanM;
export const geometricTwistAtY = (geometry: WingGeometry, yM: number) => radians(geometry.rootTwistDeg + (geometry.tipTwistDeg - geometry.rootTwistDeg) * 2 * Math.abs(yM) / geometry.spanM);
export const cosineSpanNodes = (spanM: number, fullSpanPanelCount: number) => Array.from({ length: fullSpanPanelCount + 1 }, (_, index) => -spanM / 2 * Math.cos(Math.PI * index / fullSpanPanelCount));

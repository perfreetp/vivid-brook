// ---------- 太阳位置(夏至/冬至) ----------

export interface SunPos {
  altitude: number; // 高度角 rad
  azimuth: number;  // 方位角 rad, 自正北顺时针
}

/**
 * 简化太阳位置: 忽略均时差与经度修正, 正午取 12:00。
 * date: 'summer' 夏至(赤纬+23.44°) | 'winter' 冬至(赤纬-23.44°)
 * hour: 9..21, latitude: 度
 */
export function sunPosition(date: 'summer' | 'winter', hour: number, latitude: number): SunPos {
  const decl = (date === 'summer' ? 23.44 : -23.44) * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const H = (hour - 12) * 15 * Math.PI / 180; // 时角

  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  const cosAz = (Math.sin(decl) - Math.sin(altitude) * Math.sin(lat)) /
    Math.max(1e-6, Math.cos(altitude) * Math.cos(lat));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (H > 0) azimuth = 2 * Math.PI - azimuth; // 下午偏西

  return { altitude, azimuth };
}

/** 太阳方向单位向量(从地面点指向太阳), 世界坐标 x东 y南(屏幕向下) */
export function sunDir(az: number): { x: number; y: number } {
  return { x: Math.sin(az), y: -Math.cos(az) };
}

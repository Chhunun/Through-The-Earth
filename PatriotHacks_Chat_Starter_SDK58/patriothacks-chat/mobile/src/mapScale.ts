// Projection stays in meters. Ruler intervals use feet and fractional feet.
const metersPerFoot = 0.3048;

export function mapRulerStep(scale: number) {
  const desiredFeet = 64 / scale / metersPerFoot;
  const power = 10 ** Math.floor(Math.log10(desiredFeet));
  const normalized = desiredFeet / power;
  const multiple = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiple * power * metersPerFoot;
}

export function mapDistance(meters: number) {
  const totalInches = Math.round(meters / 0.0254);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (!feet && inches) return inches + ' in';
  return feet.toLocaleString() + ' ft' + (inches ? ' ' + inches + ' in' : '');
}

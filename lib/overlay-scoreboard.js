// Shared, strictly bounded 1920 x 1080 OBS layout.
export const OVERLAY_WIDTH = 1920;
export const OVERLAY_HEIGHT = 1080;
export const DEFAULT_OVERLAY_DESIGN = {
  version: 1,
  mirror: true,
  scoreShape: 'square',
  nameShape: 'square',
  roundedNames: false,
  nameWidth: 320,
  nameHeight: 55,
  nameFontSize: 26,
  scoreSize: 55,
  scoreFontSize: 35,
  roundWidth: 104,
  roundHeight: 55,
  roundFontSize: 18,
  boFontSize: 15,
  titleWidth: 400,
  titleHeight: 30,
  titleFontSize: 17,
  borderWidth: 2,
  nameBg: '#ffffff',
  nameText: '#24232b',
  nameBorder: '#5e45a8',
  scoreBg: '#5e45a8',
  scoreText: '#ffffff',
  metaBg: '#f0ebfb',
  metaText: '#453487',
  titleBg: '#5e45a8',
  titleText: '#ffffff',
  images: { name: '', score: '', round: '', title: '' },
  positions: {
    name1: { x: 505, y: 32 },
    name2: { x: 1095, y: 32 },
    score1: { x: 839, y: 32 },
    score2: { x: 1026, y: 32 },
    round: { x: 908, y: 32 },
    title: { x: 760, y: 98 },
  },
};
const sizeFor = (design, key) => {
  if (key.startsWith('name')) return { width: design.nameWidth, height: design.nameHeight };
  if (key.startsWith('score')) return { width: design.scoreSize, height: design.scoreSize };
  if (key === 'round') return { width: design.roundWidth, height: design.roundHeight };
  return { width: design.titleWidth, height: design.titleHeight };
};
const clamp = (n, lo, hi, defaultValue) => {
  const numeric = Number(n);
  return Number.isFinite(numeric) ? Math.round(Math.max(lo, Math.min(hi, numeric))) : defaultValue;
};
const color = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
export const OVERLAY_IMAGE_BUCKET = 'overlay-scoreboard-assets';
export const OVERLAY_IMAGE_CATEGORIES = ['name', 'score', 'round', 'title'];
export const OVERLAY_SLOTS = [1, 2, 3];
export const overlayImageCategory = part => part.startsWith('name') ? 'name' : part.startsWith('score') ? 'score' : part;
export const validOverlayImagePath = path => typeof path === 'string' &&
  /^[0-9a-f-]{36}\/([123])\/(name|score|round|title)\/[0-9a-f-]{36}\.webp$/i.test(path);
export function overlayImageUrl(design, part) {
  const category = overlayImageCategory(part);
  const value = design?.images?.[category];
  if (!validOverlayImagePath(value)) return '';
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? base.replace(/\/$/, '') + '/storage/v1/object/public/' + OVERLAY_IMAGE_BUCKET + '/' +
    value.split('/').map(encodeURIComponent).join('/') : '';
}
export function normalizeOverlayPresets(stored, legacy) {
  const slots = OVERLAY_SLOTS.map((slot, index) => {
    const value = stored?.slots?.[index] || (index === 0 ? legacy : null);
    return value?.version === 1 ? normalizeOverlayDesign(value) : null;
  });
  const activeSlot = OVERLAY_SLOTS.includes(stored?.activeSlot) ? stored.activeSlot : 1;
  return { version: 1, activeSlot, slots };
}

export function normalizeOverlayDesign(input) {
  const base = DEFAULT_OVERLAY_DESIGN;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {
    ...base, images: { ...base.images },
    positions: Object.fromEntries(Object.entries(base.positions).map(([k,v]) => [k,{...v}])),
  };
  const design = {
    version: 1,
    mirror: input.mirror !== false,
    scoreShape: ['circle', 'rounded', 'square'].includes(input.scoreShape) ? input.scoreShape : base.scoreShape,
    // Legacy designs used a roundedNames boolean; keep them unchanged.
    nameShape: ['square', 'rounded', 'parallelogram'].includes(input.nameShape)
      ? input.nameShape : input.roundedNames === true ? 'rounded' : 'square',
    roundedNames: ['square', 'rounded', 'parallelogram'].includes(input.nameShape)
      ? input.nameShape === 'rounded' : input.roundedNames === true,
    nameWidth: clamp(input.nameWidth, 100, 700, base.nameWidth),
    nameHeight: clamp(input.nameHeight, 30, 160, base.nameHeight),
    nameFontSize: clamp(input.nameFontSize, 12, 68, base.nameFontSize),
    scoreSize: clamp(input.scoreSize, 30, 150, base.scoreSize),
    scoreFontSize: clamp(input.scoreFontSize, 16, 90, base.scoreFontSize),
    roundWidth: clamp(input.roundWidth, 70, 400, base.roundWidth),
    roundHeight: clamp(input.roundHeight, 35, 150, base.roundHeight),
    roundFontSize: clamp(input.roundFontSize, 11, 50, base.roundFontSize),
    boFontSize: clamp(input.boFontSize, 11, 50, base.boFontSize),
    titleWidth: clamp(input.titleWidth, 130, 900, base.titleWidth),
    titleHeight: clamp(input.titleHeight, 24, 130, base.titleHeight),
    titleFontSize: clamp(input.titleFontSize, 11, 55, base.titleFontSize),
    borderWidth: clamp(input.borderWidth, 0, 12, base.borderWidth),
  };
  for (const field of ['nameBg','nameText','nameBorder','scoreBg','scoreText','metaBg','metaText','titleBg','titleText']) design[field] = color(input[field], base[field]);
  design.images = {};
  for (const category of OVERLAY_IMAGE_CATEGORIES) {
    const image = input.images?.[category];
    design.images[category] = validOverlayImagePath(image) ? image : '';
  }
  design.positions = {};
  for (const key of Object.keys(base.positions)) {
    const size = sizeFor(design, key);
    const raw = input.positions?.[key] || base.positions[key];
    design.positions[key] = {
      x: clamp(raw.x, 0, OVERLAY_WIDTH - size.width, Math.min(base.positions[key].x, OVERLAY_WIDTH - size.width)),
      y: clamp(raw.y, 0, OVERLAY_HEIGHT - size.height, Math.min(base.positions[key].y, OVERLAY_HEIGHT - size.height)),
    };
  }
  return design;
}
export function overlayPartSize(design, key) { return sizeFor(design, key); }
export function overlayPartPosition(design, key) {
  if (design.mirror && (key === 'name2' || key === 'score2')) {
    const left = design.positions[key === 'name2' ? 'name1' : 'score1'];
    const size = sizeFor(design, key);
    return { x: OVERLAY_WIDTH - left.x - size.width, y: left.y };
  }
  return design.positions[key];
}
export function moveOverlayPart(current, key, x, y) {
  const design = normalizeOverlayDesign(current);
  const size = sizeFor(design, key);
  const safeX = clamp(x, 0, OVERLAY_WIDTH - size.width, 0);
  const safeY = clamp(y, 0, OVERLAY_HEIGHT - size.height, 0);
  if (design.mirror && (key === 'name2' || key === 'score2')) {
    const counterpart = key === 'name2' ? 'name1' : 'score1';
    return { ...design, positions: { ...design.positions, [counterpart]: { x: OVERLAY_WIDTH - safeX - size.width, y: safeY } } };
  }
  return { ...design, positions: { ...design.positions, [key]: { x: safeX, y: safeY } } };
}
export function setOverlayMirror(current, enabled) {
  const design = normalizeOverlayDesign(current);
  if (!enabled && design.mirror) {
    return { ...design, mirror: false, positions: {
      ...design.positions, name2: overlayPartPosition(design, 'name2'), score2: overlayPartPosition(design, 'score2'),
    } };
  }
  return { ...design, mirror: Boolean(enabled) };
}

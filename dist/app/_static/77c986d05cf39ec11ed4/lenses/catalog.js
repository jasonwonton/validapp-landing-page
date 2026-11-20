// Bundled face lenses, in the iOS carousel's order (CameraLensDescriptor
// .bundled). Colours are the recipe's [highlight, shadow] gradient; art is
// the iOS asset-catalog artwork re-encoded as WebP (assets/lenses/README.md).
// Skipped on web: Tung Tung Tung Sahur (needs body pose), John Pork, GigaChad
// and Make Me Bald (face warps / segmentation), and the pet glow-up skin pass.
const ART = '/assets/lenses/art/';
const ICON = '/assets/lenses/icons/';

export const ORIGINAL_LENS = Object.freeze({ id: 'original', name: 'Original', kind: null, colors: ['rgba(0,0,0,.62)', 'rgba(128,128,128,.76)'], icon: null, art: {} });

export const FACE_LENSES = Object.freeze([
    { id: 'dog', name: 'Dog', kind: 'puppy', colors: ['#F3B38B', '#9C5A2A'], icon: `${ICON}dog.webp`,
        art: { ears: `${ART}dog_filter_ears.webp`, nose: `${ART}dog_filter_nose.webp`, tongue: `${ART}dog_filter_tongue.webp` } },
    { id: 'cat', name: 'Cat', kind: 'cat', colors: ['#EFA3AC', '#4A4749'], icon: `${ICON}cat.webp`,
        art: { ears: `${ART}cat_filter_ears.webp`, face: `${ART}cat_filter_face.webp` } },
    { id: 'bear', name: 'Bear', kind: 'bear', colors: ['#E6C49A', '#6B4424'], icon: `${ICON}bear.webp`,
        art: { ears: `${ART}bear_filter_ears.webp`, snout: `${ART}bear_filter_snout.webp`, honey: `${ART}bear_filter_honey.webp` } },
    { id: 'crown', name: 'Crown', kind: 'crown', colors: ['#FFD34D', '#B86E12'], icon: `${ICON}crown.webp`,
        art: { art: `${ART}crown_filter_crown.webp` } },
    { id: 'heart-shades', name: 'Heart Shades', kind: 'heartShades', colors: ['#FF7DBE', '#9E0F52'], icon: `${ICON}heart_shades.webp`,
        art: { art: `${ART}heart_shades_filter_glasses.webp` } },
    { id: 'halo', name: 'Halo', kind: 'halo', colors: ['#FFF3B0', '#F2B124'], icon: `${ICON}halo.webp`,
        art: { art: `${ART}halo_filter_ring.webp` } },
    // Drawn every frame with gradients and shadows: the first to go when a
    // device cannot keep up.
    { id: 'crying', name: 'Crying', kind: 'crying', colors: ['#A8E6FF', '#2A8FE0'], icon: `${ICON}crying.webp`, art: {}, heavy: true },
].map(lens => Object.freeze(lens)));

export const LENSES = Object.freeze([ORIGINAL_LENS, ...FACE_LENSES]);

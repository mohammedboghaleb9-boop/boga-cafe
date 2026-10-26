/**
 * Every approved photo of the site, in one place.
 * Width/height are stored so the browser reserves the space before loading
 * (no layout jump). To replace a photo: overwrite the file, update its size here.
 * Source files and rules: docs/08-visual-assets.md
 */
import label from '@/assets/brand/label.webp';
import seal from '@/assets/brand/seal.webp';
import bagOpen from '@/assets/photos/bag-open.webp';
import heroPoster from '@/assets/photos/hero-poster.webp';
import heroPosterPortrait from '@/assets/photos/hero-poster-mobile.webp';
import barista from '@/assets/photos/barista.webp';
import greenBeans from '@/assets/photos/green-beans.webp';
import harvest from '@/assets/photos/harvest.webp';
import packshot from '@/assets/photos/packshot.webp';
import ritualTray from '@/assets/photos/ritual-tray.webp';
import roaster from '@/assets/photos/roaster.webp';
import roastery from '@/assets/photos/roastery.webp';
import blendFlatlay from '@/assets/photos/blend-flatlay.webp';
import blendBackdrop from '@/assets/photos/blend-backdrop.webp';
import roastLight from '@/assets/photos/roast-light.webp';
import roastMedium from '@/assets/photos/roast-medium.webp';
import roastMediumDark from '@/assets/photos/roast-medium-dark.webp';
import roastDark from '@/assets/photos/roast-dark.webp';

interface Media {
  src: string;
  width: number;
  height: number;
}

export const media = {
  /** 1 kg pouch, front view, approved label composited on the plain template. */
  packshot: { src: packshot, width: 1000, height: 1250 },
  /** Stills of the home video (beans turning in the roaster's cooling tray), wide and upright. */
  heroPoster: { src: heroPoster, width: 1920, height: 1080 },
  heroPosterPortrait: { src: heroPosterPortrait, width: 608, height: 1080 },
  bagOpen: { src: bagOpen, width: 900, height: 1125 },
  ritualTray: { src: ritualTray, width: 900, height: 1125 },
  barista: { src: barista, width: 1400, height: 788 },
  roaster: { src: roaster, width: 1400, height: 787 },
  roastery: { src: roastery, width: 1000, height: 563 },
  greenBeans: { src: greenBeans, width: 1400, height: 788 },
  /** A picker harvesting coffee cherries (owner's photo, illustrative: not a BOGA supplier). Original: brand/photos. */
  harvest: { src: harvest, width: 1046, height: 1300 },
  /** Approved hexagon label, transparent outside the hexagon. */
  label: { src: label, width: 720, height: 1218 },
  /** Custom Blend round seal, transparent outside the circle. */
  seal: { src: seal, width: 640, height: 640 },
  /** Three piles, light to dark, a brass scale and a copper scoop: the Custom Blend idea. */
  blendFlatlay: { src: blendFlatlay, width: 1600, height: 893 },
  /** The home's Custom Blend band: the round Custom Blend badge on the right of a dark, empty field (owner's file; original in brand/photos). */
  blendBackdrop: { src: blendBackdrop, width: 1672, height: 941 },
  /** Close-ups of roasted beans, one per roast level (illustrative, not a specific origin). */
  roastLight: { src: roastLight, width: 480, height: 480 },
  roastMedium: { src: roastMedium, width: 480, height: 480 },
  roastMediumDark: { src: roastMediumDark, width: 480, height: 480 },
  roastDark: { src: roastDark, width: 480, height: 480 },
} satisfies Record<string, Media>;

export type MediaName = keyof typeof media;

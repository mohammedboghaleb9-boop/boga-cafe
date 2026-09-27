/**
 * Every approved photo of the site, in one place.
 * Width/height are stored so the browser reserves the space before loading
 * (no layout jump). To replace a photo: overwrite the file, update its size here.
 * Source files and rules: docs/08-visual-assets.md
 */
import label from '@/assets/brand/label.webp';
import seal from '@/assets/brand/seal.webp';
import bagOpen from '@/assets/photos/bag-open.webp';
import bagsTrio from '@/assets/photos/bags-trio.webp';
import barista from '@/assets/photos/barista.webp';
import greenBeans from '@/assets/photos/green-beans.webp';
import packshot from '@/assets/photos/packshot.webp';
import ritualTray from '@/assets/photos/ritual-tray.webp';
import roaster from '@/assets/photos/roaster.webp';
import roastery from '@/assets/photos/roastery.webp';

export interface Media {
  src: string;
  width: number;
  height: number;
}

export const media = {
  /** 1 kg pouch, front view, approved label composited on the plain template. */
  packshot: { src: packshot, width: 1000, height: 1250 },
  bagsTrio: { src: bagsTrio, width: 1586, height: 992 },
  bagOpen: { src: bagOpen, width: 900, height: 1125 },
  ritualTray: { src: ritualTray, width: 900, height: 1125 },
  barista: { src: barista, width: 1400, height: 788 },
  roaster: { src: roaster, width: 1400, height: 787 },
  roastery: { src: roastery, width: 1000, height: 563 },
  greenBeans: { src: greenBeans, width: 1400, height: 788 },
  /** Approved hexagon label, transparent outside the hexagon. */
  label: { src: label, width: 720, height: 1218 },
  /** Custom Blend round seal, transparent outside the circle. */
  seal: { src: seal, width: 640, height: 640 },
} satisfies Record<string, Media>;

export type MediaName = keyof typeof media;

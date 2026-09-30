/**
 * Home page = a list of independent sections.
 * Reorder, remove or add a section here; each one lives in ./sections.
 */
import { B2BTeaser } from './sections/B2BTeaser';
import { BlendTeaser } from './sections/BlendTeaser';
import { BrandStory } from './sections/BrandStory';
import { Featured } from './sections/Featured';
import { Follow } from './sections/Follow';
import { Hero } from './sections/Hero';
import { OriginsBand } from './sections/OriginsBand';
import './home.css';
import { usePageTitle } from '@/shared/layout/usePageTitle';

const sections = [Hero, Featured, BlendTeaser, OriginsBand, B2BTeaser, BrandStory, Follow];

export function HomePage() {
  usePageTitle();
  return (
    <>
      {sections.map((Section, i) => (
        <Section key={i} />
      ))}
    </>
  );
}
